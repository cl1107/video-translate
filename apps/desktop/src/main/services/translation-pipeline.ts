/**
 * Translation Pipeline：深层流水线模块。
 * 接口：run / 协作式 AbortSignal；阶段进度与依赖检查内化。
 */
import { promises as fs } from 'node:fs'
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

    // 平台原生字幕优先：有可读字幕则跳过 ASR（仍可能烧录硬字幕，需 FFmpeg）
    const platformSegments = await tryLoadPlatformSubtitleSegments(task, hooks)
    const usePlatformSubtitles = Boolean(
      platformSegments && platformSegments.length > 0
    )

    const originalOnly = options.subtitleProcessingMode === 'extract'
    await ensurePipelineDependencies(options, hooks, signal, {
      requireAsr: !usePlatformSubtitles,
      requireLlm: !originalOnly,
    })

    const videoInfo = await ffmpegProcessor.getVideoInfo(task.videoFile.path)
    context.videoSize = {
      width: videoInfo.width,
      height: videoInfo.height,
    }

    if (usePlatformSubtitles && platformSegments) {
      context.transcription = {
        segments: platformSegments,
        engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
        language:
          task.platformSubtitleLanguage || toLanguageCode(task.sourceLanguage),
        rawText: platformSegments.map(s => s.originalText).join('\n'),
      }
      await hooks.onStatus(TaskStatus.TRANSCRIBING, 55)
      databaseManager.saveTranscriptionSegments(task.id, platformSegments)
      hooks.onSegments(platformSegments)
      hooks.onLog(
        'success',
        '已采用平台字幕作为原文，跳过音频提取与语音识别',
        `${platformSegments.length} 段` +
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
        signal
      )
    }

    const detectedLanguage = normalizeDetectedLanguage(
      context.transcription.language
    )
    task.detectedLanguage = detectedLanguage
    hooks.onDetectedLanguage(detectedLanguage)
    if (detectedLanguage) {
      hooks.onLog('info', '检测到原文语言', detectedLanguage)
    }
    context.displaySegments = buildDisplaySegments(
      context.transcription.segments,
      {
        maxDisplayColumns:
          context.videoSize.width < context.videoSize.height ? 42 : 68,
      }
    )
    hooks.onLog(
      'info',
      '显示段整理完成',
      `${usePlatformSubtitles ? '平台字幕' : '识别'} ${context.transcription.segments.length} 段 → 显示 ${context.displaySegments.length} 段`
    )

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

async function ensurePipelineDependencies(
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal,
  opts?: { requireAsr?: boolean; requireLlm?: boolean }
): Promise<void> {
  throwIfAborted(signal)
  hooks.onLog('info', '检查 FFmpeg 可用性...')
  if (!(await ffmpegProcessor.isAvailable())) {
    throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
  }
  hooks.onLog('success', 'FFmpeg 可用性检查通过')

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
  signal?: AbortSignal
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

  databaseManager.saveTranscriptionSegments(task.id, transcription.segments)
  hooks.onSegments(transcription.segments)
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
  if (!polishRequested) {
    return segments.map(segment => ({
      ...segment,
      polishedText: getAsrOrSelf(segment),
    }))
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
    return segments.map(segment => ({
      ...segment,
      polishedText: getAsrOrSelf(segment),
    }))
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
    onProgress: (completed, total) => {
      const normalized = 60 + (completed / total) * 5
      void hooks.onStatus(TaskStatus.POLISHING, normalized)
    },
  })

  const merged = segments.map((segment, index) => ({
    ...segment,
    polishedText: polished[index] || getAsrOrSelf(segment),
  }))

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
  let fallbackCount = 0
  const translated = await translateTextBatch(texts, {
    client,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    signal,
    onProgress: (completed, total) => {
      const normalized = 65 + (completed / total) * 20
      void hooks.onStatus(TaskStatus.TRANSLATING, normalized)
    },
    onSegmentIssue: issue => {
      if (issue.action === 'retry') {
        hooks.onLog(
          'warn',
          `翻译第 ${issue.index}/${issue.total} 段将重试`,
          `${issue.reason}（第 ${issue.attempt}/${issue.maxAttempts} 次）原文：${issue.source}`
        )
        return
      }
      if (issue.action === 'fallback') {
        fallbackCount += 1
        hooks.onLog(
          'warn',
          `翻译第 ${issue.index}/${issue.total} 段回退原文`,
          `${issue.reason}；已保留原文：${issue.source}`
        )
        return
      }
      hooks.onLog(
        'error',
        `翻译第 ${issue.index}/${issue.total} 段失败`,
        `${issue.reason}；原文：${issue.source}`
      )
    },
  })

  const merged = segments.map((segment, index) => ({
    ...segment,
    translatedText: translated[index] ?? getDisplaySource(segment),
  }))

  const taskSegments: TranscriptionSegment[] = merged.map(segment => ({
    id: segment.id,
    start: segment.start,
    end: segment.end,
    originalText: segment.originalText,
    polishedText: segment.polishedText,
    translatedText: segment.translatedText,
    confidence: segment.confidence,
  }))
  databaseManager.replaceTranscriptionSegments(task.id, taskSegments)
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
