/**
 * Translation Pipeline：深层流水线模块。
 * 接口：run / 协作式 AbortSignal；阶段进度与依赖检查内化。
 */
import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { createTextPartCache } from './text-part-cache'
import path from 'node:path'
import dayjs from 'dayjs'
import { DEFAULT_ASR_ENGINE } from '../../shared/constants'
import {
  normalizeDetectedLanguage,
  resolveSubtitleLanguageSuffixes,
  toLanguageCode,
} from '../../shared/language'
import type { SubtitleBurnMode } from '../../shared/settings'
import type {
  SubtitleEntry,
  TaskOutputArtifacts,
  TaskRuntimeOptions,
  TranscriptionSegment,
  TranslationTask,
} from '../../shared/types/video'
import { TaskStatus } from '../../shared/types/video'
import {
  type DisplaySegment,
  buildDisplaySegments,
} from '../utils/display-segment-builder'
import {
  getDisplaySource,
  getPolishInput,
  getTranslateInput,
} from '../utils/segment-text'
import {
  selectBurnSubtitleContent,
  type SubtitleColors,
  validateSubtitleArtifacts,
  writeOriginalSubtitleArtifact,
  writeSubtitleArtifacts,
} from '../utils/subtitle-artifacts'
import { SubtitleGenerator } from '../utils/subtitle-generator'
import { resolveSubtitleOutputDirectory } from '../utils/subtitle-output-directory'
import { ensureSenseVoiceModel } from './asr/model-downloader'
import {
  type AsrTranscriptionResult,
  sherpaTranscriber,
} from './asr/sherpa-transcriber'
import { databaseManager } from './database/manager'
import { ffmpegProcessor } from './ffmpeg/processor'
import { throwIfAborted } from './llm/completion-port'
import { resolveLlmCompletionConfig } from './llm/llm-config'
import { createCompletionClient } from './llm/openai-completion-client'
import { polishTranscriptBatch } from './llm/polish-service'
import { translateTextBatch } from './llm/text-transform'
import { tempWorkspace } from './temp-workspace'
import {
  createCheckpointFingerprint,
  getTaskCheckpoint,
  isCheckpointFingerprintValid,
  markAsrComplete,
  markPolishComplete,
  saveTranslationProgress,
  seedTaskTranscript,
} from './checkpoint'
export interface PipelineHooks {
  onLog: (
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
    details?: string
  ) => void
  onStatus: (
    status: TaskStatus,
    progress?: number,
    errorMessage?: string
  ) => Promise<void>
  onArtifacts: (artifacts: TaskOutputArtifacts) => void
  onSegments: (segments: TranscriptionSegment[]) => void
  /** 转录流式回传：每块识别完的新段落（可选；用于边识别边入库/推送 UI） */
  onTranscriptionPartial?: (newSegments: TranscriptionSegment[]) => void
  onDetectedLanguage: (language: TranslationTask['detectedLanguage']) => void
  /** 模型服务 API Key（secure store 注入；本地推理服务可为空） */
  resolveLlmApiKey: () => string | undefined
}

export interface PipelineContext {
  task: TranslationTask
  options: TaskRuntimeOptions
  workDir?: string
  audioPath?: string
  transcription?: AsrTranscriptionResult
  displaySegments?: DisplaySegment[]
  translatedSegments?: DisplaySegment[]
  subtitles?: SubtitleEntry[]
  videoSize?: { width: number; height: number }
  outputArtifacts?: TaskOutputArtifacts
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function createAbortError(message = '操作已取消'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * 运行完整翻译流水线。signal  abort 时协作式退出。
 */
export async function runTranslationPipeline(
  task: TranslationTask,
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal
): Promise<PipelineContext> {
  const context: PipelineContext = { task, options }

  try {
    throwIfAborted(signal)
    await tempWorkspace.removeTaskDir(task.id)
    context.workDir = await tempWorkspace.ensureTaskDir(task.id)

    const checkpoint = getTaskCheckpoint(task.id)
    const storedSegments = databaseManager.getTranscriptionSegments(task.id)
    const mediaStat = ['srt', 'vtt'].includes(
      task.videoFile.format.toLowerCase()
    )
      ? null
      : await getReadableMediaStat(task.videoFile.path)
    const mediaAvailable = mediaStat !== null
    const asrFingerprint = createCheckpointFingerprint({
      engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
      sourceLanguage: task.sourceLanguage,
      mediaPath: task.videoFile.path,
      mediaSize: mediaStat?.size,
      mediaMtimeMs: mediaStat?.mtimeMs,
      platformSubtitlePath: task.platformSubtitlePath,
    })
    const storedTranscriptComplete =
      storedSegments.length > 0 &&
      checkpoint.asrComplete &&
      // 媒体被删除不应让已有完整转录失效；媒体重新存在时才校验 size/mtime。
      (!mediaStat ||
        isCheckpointFingerprintValid(checkpoint, 'asr', asrFingerprint))
    const legacyCompletedTranscript =
      !mediaAvailable &&
      task.status === TaskStatus.COMPLETED &&
      task.segments.length > 0 &&
      storedSegments.length > 0

    // 平台原生字幕优先；已有完整断点或无媒体的已完成导入任务不再读取媒体。
    const platformSegments = storedTranscriptComplete
      ? null
      : await tryLoadPlatformSubtitleSegments(task, hooks)
    const usePlatformSubtitles = Boolean(
      platformSegments && platformSegments.length > 0
    )
    const originalOnly = options.subtitleProcessingMode === 'extract'
    if (options.burnSubtitles && !mediaAvailable) {
      throw new Error('媒体文件不存在，无法烧录硬字幕；可关闭烧录后导出字幕')
    }
    await ensurePipelineDependencies(options, hooks, signal, {
      requireAsr:
        !usePlatformSubtitles &&
        !storedTranscriptComplete &&
        !legacyCompletedTranscript,
      requireLlm: !originalOnly,
      requireFfmpeg: mediaAvailable || options.burnSubtitles,
    })

    if (mediaAvailable) {
      const videoInfo = await ffmpegProcessor.getVideoInfo(task.videoFile.path)
      context.videoSize = { width: videoInfo.width, height: videoInfo.height }
    } else {
      // 导入 SRT/VTT 或仅剩完整转录时没有媒体，字幕仍可导出。
      context.videoSize = { width: 1920, height: 1080 }
    }

    if (storedTranscriptComplete || legacyCompletedTranscript) {
      const segments = storedTranscriptComplete
        ? storedSegments
        : seedTaskTranscript(task.id, task.segments)
      context.transcription = {
        segments,
        engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
        language: task.detectedLanguage || toLanguageCode(task.sourceLanguage),
        rawText: segments.map(s => s.originalText).join('\n'),
      }
      hooks.onSegments(segments)
      hooks.onLog(
        'info',
        '已恢复完整转录断点，跳过音频提取与语音识别',
        `${segments.length} 段`
      )
    } else if (usePlatformSubtitles && platformSegments) {
      const segments = seedTaskTranscript(task.id, platformSegments)
      markAsrComplete(task.id, asrFingerprint)
      context.transcription = {
        segments,
        engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
        language:
          task.platformSubtitleLanguage || toLanguageCode(task.sourceLanguage),
        rawText: segments.map(s => s.originalText).join('\n'),
      }
      await hooks.onStatus(TaskStatus.TRANSCRIBING, 55)
      hooks.onSegments(segments)
      hooks.onLog(
        'success',
        '已采用平台字幕作为原文，跳过音频提取与语音识别',
        `${segments.length} 段` +
          (task.platformSubtitleLanguage
            ? ` · 语言 ${task.platformSubtitleLanguage}`
            : '')
      )
    } else {
      context.audioPath = await extractAudioStage(
        task,
        context.workDir,
        hooks,
        signal
      )

      const asrEngine = options.asrEngine ?? DEFAULT_ASR_ENGINE
      context.transcription = await transcribeStage(
        task,
        context.audioPath,
        asrEngine,
        context.workDir,
        hooks,
        signal,
        asrFingerprint
      )
      markAsrComplete(task.id, asrFingerprint)
    }

    const detectedLanguage = normalizeDetectedLanguage(
      context.transcription.language
    )
    task.detectedLanguage = detectedLanguage
    hooks.onDetectedLanguage(detectedLanguage)
    if (detectedLanguage) {
      hooks.onLog('info', '检测到原文语言', detectedLanguage)
    }
    const restoreOneToOneSegments =
      storedTranscriptComplete &&
      (checkpoint.polishComplete ||
        checkpoint.translationComplete ||
        checkpoint.manualReviewed)
    context.displaySegments = restoreOneToOneSegments
      ? context.transcription.segments.map(segment => ({
          ...segment,
          sourceSegmentIds: [segment.id],
        }))
      : buildDisplaySegments(context.transcription.segments, {
          maxDisplayColumns:
            context.videoSize.width < context.videoSize.height ? 42 : 68,
        })
    hooks.onLog(
      'info',
      '显示段整理完成',
      `${usePlatformSubtitles ? '平台字幕' : '识别'} ${context.transcription.segments.length} 段 → 显示 ${context.displaySegments.length} 段`
    )

    // 显示段成为新的权威集合，必须原子替换，避免合并前的残留段再次出现。
    databaseManager.replaceTranscriptionSegments(
      task.id,
      context.displaySegments
    )
    hooks.onSegments(context.displaySegments)

    if (originalOnly) {
      hooks.onLog('info', '已选择仅提取原文字幕，跳过润色与翻译')
      context.translatedSegments = context.displaySegments
    } else {
      context.displaySegments = await polishStage(
        task,
        context.displaySegments,
        options,
        hooks,
        signal
      )

      context.translatedSegments = await translateStage(
        task,
        context.displaySegments,
        options,
        hooks,
        signal
      )
    }

    context.subtitles = SubtitleGenerator.segmentsToSubtitles(
      context.translatedSegments.map(segment => ({
        ...segment,
        // 内存预览字幕用 displaySource（润色优先），与文件「原文」轨策略分离
        originalText: getDisplaySource(segment),
      }))
    )

    context.outputArtifacts = await generateSubtitleStage(
      task,
      context.translatedSegments,
      context.videoSize,
      options,
      hooks,
      signal,
      originalOnly
    )

    if (options.burnSubtitles) {
      const burnMode = originalOnly ? 'original' : options.burnSubtitleMode
      const burnPath = await prepareBurnSubtitleFile(
        task.id,
        context.translatedSegments,
        burnMode,
        context.videoSize,
        context.workDir,
        resolveSubtitleColors(options),
        hooks
      )
      const burnedVideo = await burnHardSubtitlesStage(
        task,
        burnPath,
        context.workDir,
        hooks,
        signal
      )
      context.outputArtifacts = {
        ...context.outputArtifacts,
        burnedVideo,
      }
      hooks.onArtifacts(context.outputArtifacts)
    }

    return context
  } finally {
    await tempWorkspace.removeTaskDir(task.id)
  }
}

async function getReadableMediaStat(
  filePath: string
): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile() && stat.size > 0
      ? { size: stat.size, mtimeMs: stat.mtimeMs }
      : null
  } catch {
    return null
  }
}

async function ensurePipelineDependencies(
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal,
  opts?: {
    requireAsr?: boolean
    requireLlm?: boolean
    requireFfmpeg?: boolean
  }
): Promise<void> {
  throwIfAborted(signal)
  if (opts?.requireFfmpeg !== false) {
    hooks.onLog('info', '检查 FFmpeg 可用性...')
    if (!(await ffmpegProcessor.isAvailable())) {
      throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
    }
    hooks.onLog('success', 'FFmpeg 可用性检查通过')
  } else {
    hooks.onLog('info', '无媒体文件，仅使用已保存转录结果')
  }

  const requireAsr = opts?.requireAsr !== false
  if (requireAsr) {
    hooks.onLog('info', '检查 sherpa-onnx ASR 可用性...')
    let asrOk =
      (await sherpaTranscriber.isAvailable('sensevoice')) ||
      (await sherpaTranscriber.isAvailable('funasr-nano'))
    if (!asrOk) {
      hooks.onLog('info', 'SenseVoice 模型缺失，开始自动下载...')
      const ensured = await ensureSenseVoiceModel(p => {
        if (p.message) hooks.onLog('info', p.message)
      })
      asrOk = ensured.available
      if (!asrOk) {
        throw new Error(
          `ASR 模型不可用：${ensured.error || '自动下载失败，请检查网络后重试'}`
        )
      }
    }
    hooks.onLog('success', 'ASR 可用性检查通过')
  } else {
    hooks.onLog('info', '已有平台字幕，跳过 ASR 依赖检查')
  }

  if (opts?.requireLlm !== false) {
    // 只校验配置完整，不发探测请求：连接/模型错误在首次调用时自然暴露
    const resolved = resolveLlmCompletionConfig(
      { llmBaseUrl: options.llmBaseUrl, model: options.translateModel },
      '翻译'
    )
    if (!resolved.ok) {
      throw new Error(
        `翻译未就绪：${resolved.reason}。请到 设置 › 模型服务 配置`
      )
    }
    hooks.onLog('success', '模型服务配置检查通过', resolved.label)
  } else {
    hooks.onLog('info', '仅提取原文字幕，不需要模型服务')
  }
}

/**
 * 尝试读取任务上的平台字幕并转为 TranscriptionSegment。
 * 文件缺失或解析失败时返回 null，由调用方回退 ASR。
 */
async function tryLoadPlatformSubtitleSegments(
  task: TranslationTask,
  hooks: PipelineHooks
): Promise<TranscriptionSegment[] | null> {
  const subtitlePath = task.platformSubtitlePath
  if (!subtitlePath) return null

  try {
    await fs.access(subtitlePath)
  } catch {
    hooks.onLog('warn', '平台字幕文件不存在，将回退到 ASR', subtitlePath)
    return null
  }

  try {
    const content = await fs.readFile(subtitlePath, 'utf-8')
    const ext = path.extname(subtitlePath).replace(/^\./, '').toLowerCase()
    const entries = SubtitleGenerator.parseSubtitleContent(content, ext)
    if (entries.length === 0) {
      hooks.onLog('warn', '平台字幕为空或无法解析，将回退到 ASR', subtitlePath)
      return null
    }

    return entries.map((entry, index) => ({
      id: `platform-${index + 1}`,
      start: SubtitleGenerator.parseTime(entry.start),
      end: SubtitleGenerator.parseTime(entry.end),
      originalText: entry.text,
      confidence: 1,
    }))
  } catch (error) {
    hooks.onLog(
      'warn',
      '读取平台字幕失败，将回退到 ASR',
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

async function extractAudioStage(
  task: TranslationTask,
  workDir: string,
  hooks: PipelineHooks,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal)
  await hooks.onStatus(TaskStatus.EXTRACTING_AUDIO, 10)
  hooks.onLog('info', '开始提取音频...', `视频: ${task.videoFile.path}`)

  const outputPath = path.join(workDir, `audio_${Date.now()}.wav`)
  const audioPath = await ffmpegProcessor.extractAudio(
    task.videoFile.path,
    outputPath,
    progress => {
      if (signal?.aborted) return
      const normalized = 10 + (progress / 100) * 20
      void hooks.onStatus(TaskStatus.EXTRACTING_AUDIO, normalized)
    },
    workDir
  )

  throwIfAborted(signal)
  hooks.onLog('success', '音频提取完成', `音频文件: ${audioPath}`)
  return audioPath
}

async function transcribeStage(
  task: TranslationTask,
  audioPath: string,
  asrEngine: TaskRuntimeOptions['asrEngine'],
  workDir: string,
  hooks: PipelineHooks,
  signal?: AbortSignal,
  checkpointKey?: string
): Promise<AsrTranscriptionResult> {
  throwIfAborted(signal)
  await hooks.onStatus(TaskStatus.TRANSCRIBING, 35)
  hooks.onLog(
    'info',
    '开始进行语音识别',
    `ASR 引擎: ${asrEngine}, 源语言: ${task.sourceLanguage}`
  )

  const transcription = await sherpaTranscriber.transcribe(
    audioPath,
    {
      engine: asrEngine,
      language: toLanguageCode(task.sourceLanguage),
      workDir,
      checkpointDir: path.join(
        app.getPath('userData'),
        'asr-checkpoints',
        task.id
      ),
      checkpointKey,
      signal,
      onPartialSegments: partial => {
        if (signal?.aborted) return
        hooks.onTranscriptionPartial?.(partial)
      },
    },
    progress => {
      if (signal?.aborted) return
      const normalized = 35 + (progress / 100) * 25
      void hooks.onStatus(TaskStatus.TRANSCRIBING, normalized)
    }
  )

  throwIfAborted(signal)
  if (transcription.segments.length === 0) {
    throw new Error('语音识别未产生任何结果')
  }

  const completeSegments = seedTaskTranscript(task.id, transcription.segments)
  transcription.segments = completeSegments
  hooks.onSegments(completeSegments)
  hooks.onLog(
    'success',
    '语音识别完成',
    `引擎 ${transcription.engine}，生成 ${transcription.segments.length} 个字幕段落`
  )
  return transcription
}

async function polishStage(
  task: TranslationTask,
  segments: DisplaySegment[],
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal
): Promise<DisplaySegment[]> {
  throwIfAborted(signal)
  const polishRequested = options.polishTranscript !== false
  const polishFingerprint = createCheckpointFingerprint({
    baseUrl: options.llmBaseUrl,
    model: options.polishModel || options.translateModel,
    sourceLanguage: task.sourceLanguage,
    enabled: polishRequested,
  })
  const checkpoint = getTaskCheckpoint(task.id)
  if (checkpoint.manualReviewed) return segments
  if (isCheckpointFingerprintValid(checkpoint, 'polish', polishFingerprint)) {
    return segments
  }
  if (
    polishRequested &&
    checkpoint.polishComplete &&
    checkpoint.polishFingerprint !== polishFingerprint
  ) {
    databaseManager.clearPolishAndTranslation(task.id)
    for (const segment of segments) {
      segment.polishedText = undefined
      segment.translatedText = undefined
      segment.translationStatus = undefined
    }
  }
  if (!polishRequested) {
    const result = segments.map(segment => ({
      ...segment,
      polishedText: getAsrOrSelf(segment),
      translatedText: undefined,
      translationStatus: undefined,
    }))
    databaseManager.replaceTranscriptionSegments(task.id, result)
    markPolishComplete(task.id, polishFingerprint)
    return result
  }

  // 润色模型为空 = 跟随翻译模型
  const polishResolved = resolveLlmCompletionConfig(
    {
      llmBaseUrl: options.llmBaseUrl,
      model: options.polishModel || options.translateModel,
      apiKey: hooks.resolveLlmApiKey(),
    },
    '润色'
  )

  if (!polishResolved.ok) {
    hooks.onLog('warn', '已跳过识别文本润色', polishResolved.reason)
    const result = segments.map(segment => ({
      ...segment,
      polishedText: getAsrOrSelf(segment),
    }))
    databaseManager.saveTranscriptionSegments(task.id, result)
    markPolishComplete(task.id, polishFingerprint)
    return result
  }

  await hooks.onStatus(TaskStatus.POLISHING, 60)
  hooks.onLog(
    'info',
    '开始润色识别文本',
    `${polishResolved.label}（滑动窗口上下文，纠错/补标点后再翻译）`
  )

  const texts = segments.map(segment => getPolishInput(segment))
  const polished = await polishTranscriptBatch(texts, {
    sourceLanguage: task.sourceLanguage,
    config: polishResolved.config,
    signal,
    ...createTextPartCache(
      path.join(
        app.getPath('userData'),
        'text-checkpoints',
        task.id,
        'subtitle-polish'
      ),
      { polishFingerprint, texts }
    ),
    onProgress: (completed, total) => {
      const normalized = 60 + (completed / total) * 5
      void hooks.onStatus(TaskStatus.POLISHING, normalized)
    },
  })

  const merged = segments.map((segment, index) => ({
    ...segment,
    polishedText: polished[index] || getAsrOrSelf(segment),
  }))

  databaseManager.saveTranscriptionSegments(
    task.id,
    merged.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      originalText: segment.originalText,
      polishedText: segment.polishedText,
      translatedText: segment.translatedText,
      confidence: segment.confidence,
    }))
  )
  markPolishComplete(task.id, polishFingerprint)
  hooks.onLog('success', '识别文本润色完成', `润色 ${merged.length} 个显示段`)
  return merged
}

function getAsrOrSelf(segment: DisplaySegment): string {
  return segment.originalText
}

async function translateStage(
  task: TranslationTask,
  segments: DisplaySegment[],
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal
): Promise<DisplaySegment[]> {
  throwIfAborted(signal)
  const translationFingerprint = createCheckpointFingerprint({
    baseUrl: options.llmBaseUrl,
    model: options.translateModel,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    glossary: options.glossary || [],
  })
  const checkpoint = getTaskCheckpoint(task.id)
  if (checkpoint.manualReviewed && checkpoint.translationComplete)
    return segments
  if (
    isCheckpointFingerprintValid(
      checkpoint,
      'translation',
      translationFingerprint
    )
  ) {
    return segments
  }
  if (
    checkpoint.translationFingerprint &&
    checkpoint.translationFingerprint !== translationFingerprint
  ) {
    databaseManager.clearTranslationResults(task.id)
    for (const segment of segments) {
      segment.translatedText = undefined
      segment.translationStatus = undefined
    }
  }
  await hooks.onStatus(TaskStatus.TRANSLATING, 65)

  const resolved = resolveLlmCompletionConfig(
    {
      llmBaseUrl: options.llmBaseUrl,
      model: options.translateModel,
      apiKey: hooks.resolveLlmApiKey(),
    },
    '翻译'
  )
  if (!resolved.ok) {
    throw new Error(`翻译未就绪：${resolved.reason}。请到 设置 › 模型服务 配置`)
  }
  const client = createCompletionClient(resolved.config)
  hooks.onLog(
    'info',
    '开始翻译字幕',
    `模型: ${resolved.label}, 目标语言: ${task.targetLanguage}`
  )

  const texts = segments.map(segment => getTranslateInput(segment))
  const translated = segments.map(segment => segment.translatedText)
  const statuses: Array<TranscriptionSegment['translationStatus']> =
    segments.map(
      segment =>
        segment.translationStatus ||
        (segment.translatedText ? 'translated' : undefined)
    )
  const requestTexts = texts.map((text, index) => (statuses[index] ? '' : text))
  let completedCount = statuses.filter(Boolean).length
  let fallbackCount = statuses.filter(status => status === 'fallback').length
  const persistResult = (
    index: number,
    value: string,
    status: 'translated' | 'fallback'
  ) => {
    const segment = segments[index]
    if (!segment) return
    translated[index] = value
    statuses[index] = status
    completedCount += 1
    const saved: TranscriptionSegment = {
      id: segment.id,
      start: segment.start,
      end: segment.end,
      originalText: segment.originalText,
      polishedText: segment.polishedText,
      translatedText: value,
      translationStatus: status,
      confidence: segment.confidence,
    }
    databaseManager.saveTranscriptionSegments(task.id, [saved])
    saveTranslationProgress(
      task.id,
      translationFingerprint,
      completedCount,
      false
    )
  }

  // 使用 translateTextBatch 的真实逐段回调；兼容旧实现时在批次返回后补齐落盘。
  const translateOptions = {
    client,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    glossary: options.glossary || [],
    contextTexts: texts,
    signal,
    onSegmentComplete: async (result: {
      index: number
      total: number
      source: string
      translated: string
      translationStatus: 'translated' | 'fallback'
    }) => {
      if (result.index < 0 || result.index >= segments.length) return
      if (statuses[result.index]) return
      if (result.translationStatus === 'fallback') fallbackCount += 1
      persistResult(result.index, result.translated, result.translationStatus)
    },
    onProgress: (completed: number, total: number) => {
      const normalized = 65 + (completed / total) * 20
      void hooks.onStatus(TaskStatus.TRANSLATING, normalized)
    },
    onSegmentIssue: (issue: {
      action: 'retry' | 'fallback' | 'error'
      index: number
      total: number
      reason: string
      attempt: number
      maxAttempts: number
      source: string
    }) => {
      if (issue.action === 'retry') {
        hooks.onLog(
          'warn',
          `翻译第 ${issue.index}/${issue.total} 段将重试`,
          `${issue.reason}（第 ${issue.attempt}/${issue.maxAttempts} 次）原文：${issue.source}`
        )
      } else if (issue.action === 'fallback') {
        hooks.onLog(
          'warn',
          `翻译第 ${issue.index}/${issue.total} 段回退原文`,
          `${issue.reason}；已保留原文：${issue.source}`
        )
      } else {
        hooks.onLog(
          'error',
          `翻译第 ${issue.index}/${issue.total} 段失败`,
          `${issue.reason}；原文：${issue.source}`
        )
      }
    },
  }
  const results = await translateTextBatch(requestTexts, translateOptions)

  // 当前安装的旧 text-transform 没有 onSegmentComplete 时，仍按返回顺序逐段落库。
  for (let index = 0; index < results.length; index++) {
    if (!statuses[index]) {
      const value = results[index] ?? getDisplaySource(segments[index]!)
      persistResult(
        index,
        value,
        value === texts[index] ? 'fallback' : 'translated'
      )
    }
  }

  const merged = segments.map((segment, index) => ({
    ...segment,
    translatedText: translated[index] ?? getDisplaySource(segment),
    translationStatus: statuses[index] || 'translated',
  }))
  const taskSegments: TranscriptionSegment[] = merged.map(segment => ({
    id: segment.id,
    start: segment.start,
    end: segment.end,
    originalText: segment.originalText,
    polishedText: segment.polishedText,
    translatedText: segment.translatedText,
    translationStatus: segment.translationStatus,
    confidence: segment.confidence,
  }))
  saveTranslationProgress(
    task.id,
    translationFingerprint,
    taskSegments.length,
    true
  )
  hooks.onSegments(taskSegments)

  if (fallbackCount > 0) {
    hooks.onLog(
      'warn',
      '字幕翻译完成（含回退）',
      `共 ${merged.length} 段，其中 ${fallbackCount} 段空结果已回退为原文`
    )
  } else {
    hooks.onLog('success', '字幕翻译完成', `翻译 ${merged.length} 个段落`)
  }
  return merged
}

async function generateSubtitleStage(
  task: TranslationTask,
  segments: DisplaySegment[],
  videoSize: { width: number; height: number } | undefined,
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal,
  originalOnly = false
): Promise<TaskOutputArtifacts> {
  throwIfAborted(signal)
  await hooks.onStatus(TaskStatus.GENERATING_SUBTITLES, 90)
  hooks.onLog(
    'info',
    originalOnly
      ? '开始生成原文 SRT...'
      : '开始生成字幕文件（原文/译文/双语 SRT + ASS）...'
  )

  const outputDir = resolveSubtitleOutputDirectory(
    task.videoFile.path,
    options.subtitleOutputLocation
  )
  const baseName = path.basename(
    task.videoFile.path,
    path.extname(task.videoFile.path)
  )
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const artifactBase = `${baseName}_${timestamp}`
  const suffixes = resolveSubtitleLanguageSuffixes(
    task.detectedLanguage ?? task.sourceLanguage,
    task.targetLanguage
  )

  if (originalOnly) {
    const result = await writeOriginalSubtitleArtifact({
      segments,
      outputDir,
      baseName: artifactBase,
      sourceSuffix: suffixes.sourceSuffix,
      videoSize,
    })
    const artifacts: TaskOutputArtifacts = {
      originalSubtitle: result.original,
      outputDirectory: result.outputDirectory,
    }
    hooks.onArtifacts(artifacts)
    hooks.onLog('success', '原文字幕文件生成完成', result.original)
    return artifacts
  }

  const paths = await writeSubtitleArtifacts({
    segments,
    outputDir,
    baseName: artifactBase,
    sourceSuffix: suffixes.sourceSuffix,
    targetSuffix: suffixes.targetSuffix,
    videoSize,
    colors: resolveSubtitleColors(options),
  })

  const validation = await validateSubtitleArtifacts(paths, segments)
  if (!validation.ok) {
    throw new Error(`字幕产物校验失败: ${validation.errors.join('; ')}`)
  }

  const artifacts: TaskOutputArtifacts = {
    originalSubtitle: paths.original,
    translatedSubtitle: paths.translated,
    bilingualSubtitle: paths.bilingual,
    bilingualAss: paths.bilingualAss,
    outputDirectory: paths.outputDirectory,
  }
  hooks.onArtifacts(artifacts)
  hooks.onLog(
    'success',
    '字幕文件生成完成',
    [
      `原文: ${paths.original}`,
      `翻译: ${paths.translated}`,
      `双语: ${paths.bilingual}`,
      `ASS: ${paths.bilingualAss}`,
    ].join('\n')
  )
  return artifacts
}

export function resolveSubtitleColors(
  options?: Pick<
    TaskRuntimeOptions,
    'originalSubtitleColor' | 'translatedSubtitleColor'
  > | null
): SubtitleColors {
  return {
    originalColor: options?.originalSubtitleColor,
    translatedColor: options?.translatedSubtitleColor,
  }
}

export async function prepareBurnSubtitleFile(
  taskId: string,
  segments: Array<DisplaySegment | TranscriptionSegment>,
  mode: SubtitleBurnMode,
  videoSize: { width: number; height: number } | undefined,
  workDir: string | undefined,
  colors: SubtitleColors | null | undefined,
  hooks?: Pick<PipelineHooks, 'onLog'>
): Promise<string> {
  const dir = workDir || (await tempWorkspace.ensureTaskDir(taskId))
  const selected = selectBurnSubtitleContent(mode, segments, videoSize, colors)
  const burnPath = path.join(dir, `burn_${mode}.${selected.extension}`)
  await fs.writeFile(burnPath, selected.content, 'utf-8')
  hooks?.onLog('info', '已准备烧录字幕', `模式: ${mode}, 文件: ${burnPath}`)
  return burnPath
}

export async function burnHardSubtitlesStage(
  task: TranslationTask,
  subtitlePath: string,
  workDir: string | undefined,
  hooks: PipelineHooks,
  signal?: AbortSignal,
  progressOptions?: {
    progressStatus?: TaskStatus
    progressBase?: number
    progressSpan?: number
  }
): Promise<string> {
  throwIfAborted(signal)
  const videoPath = task.videoFile.path
  // 旧任务可能尚无 outputArtifacts，按任务创建时保存的位置规则解析。
  const outputDir =
    task.outputArtifacts?.outputDirectory ??
    resolveSubtitleOutputDirectory(
      videoPath,
      task.options?.subtitleOutputLocation
    )
  await fs.mkdir(outputDir, { recursive: true })

  const baseName = path.basename(videoPath, path.extname(videoPath))
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const outputVideo = path.join(
    outputDir,
    `${baseName}_${timestamp}_burned.mp4`
  )

  hooks.onLog('info', '开始烧录硬字幕', `输出: ${outputVideo}`)

  const progressStatus =
    progressOptions?.progressStatus ?? TaskStatus.GENERATING_SUBTITLES
  const progressBase = progressOptions?.progressBase ?? 90
  const progressSpan = progressOptions?.progressSpan ?? 9

  const result = await ffmpegProcessor.burnSubtitles(
    videoPath,
    subtitlePath,
    outputVideo,
    progress => {
      if (signal?.aborted) return
      const normalized = progressBase + (progress / 100) * progressSpan
      void hooks.onStatus(progressStatus, normalized)
    },
    workDir
  )

  throwIfAborted(signal)
  const stat = await fs.stat(result)
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`烧录视频产物无效: ${result}`)
  }

  hooks.onLog('success', '烧录硬字幕完成', `输出视频: ${result}`)
  return result
}
