/**
 * 文稿流水线：共享 FFmpeg/ASR，整篇润色为 Markdown（不写字幕、不翻译）。
 */
import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { createTextPartCache } from './text-part-cache'
import path from 'node:path'
import dayjs from 'dayjs'
import { DEFAULT_ASR_ENGINE } from '../../shared/constants'
import {
  normalizeDetectedLanguage,
  toLanguageCode,
} from '../../shared/language'
import type {
  TaskOutputArtifacts,
  TaskRuntimeOptions,
  TranscriptionSegment,
  TranslationTask,
} from '../../shared/types/video'
import { TaskStatus } from '../../shared/types/video'
import { SubtitleGenerator } from '../utils/subtitle-generator'
import { buildDocumentChaptersMarkdown } from './document-chapters'
import { ensureSenseVoiceModel } from './asr/model-downloader'
import {
  type AsrTranscriptionResult,
  sherpaTranscriber,
} from './asr/sherpa-transcriber'
import { databaseManager } from './database/manager'
import { ffmpegProcessor } from './ffmpeg/processor'
import { throwIfAborted } from './llm/completion-port'
import { polishDocumentToMarkdown } from './llm/document-polish-service'
import { resolveLlmCompletionConfig } from './llm/llm-config'
import { tempWorkspace } from './temp-workspace'
import type { PipelineHooks } from './translation-pipeline'
import {
  createCheckpointFingerprint,
  getTaskCheckpoint,
  isCheckpointFingerprintValid,
  markAsrComplete,
  markDocumentComplete,
  seedTaskTranscript,
} from './checkpoint'

export interface DocumentPipelineContext {
  task: TranslationTask
  options: TaskRuntimeOptions
  workDir?: string
  audioPath?: string
  transcription?: AsrTranscriptionResult
  rawText?: string
  polishedMarkdown?: string
  outputArtifacts?: TaskOutputArtifacts
}

function mediaBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName || 'document'
}

function resolveOutputDir(task: TranslationTask): string {
  return path.join(path.dirname(task.videoFile.path), 'output')
}

async function writeMarkdownWithoutOverwrite(
  outputDir: string,
  baseName: string,
  markdown: string
): Promise<string> {
  const stamp = dayjs().format('YYYYMMDD_HHmmss')
  for (let index = 0; ; index += 1) {
    const suffix = index === 0 ? '' : `-${index + 1}`
    const filePath = path.join(outputDir, `${baseName}-${stamp}${suffix}.md`)
    try {
      const handle = await fs.open(filePath, 'wx')
      try {
        await handle.writeFile(markdown, 'utf-8')
      } finally {
        await handle.close()
      }
      return filePath
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      ) {
        throw error
      }
    }
  }
}

/**
 * 将段落拼为润色用原文（保留换行分段）。
 */
export function joinSegmentsToRawText(
  segments: TranscriptionSegment[]
): string {
  return segments
    .map(s => (s.originalText ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

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

async function ensureDocumentDependencies(
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal: AbortSignal | undefined,
  opts: {
    requireAsr: boolean
    requireFfmpeg: boolean
    requireLlm: boolean
    llmApiKey?: string
  }
): Promise<ReturnType<typeof resolveLlmCompletionConfig> & { ok: true }> {
  throwIfAborted(signal)

  if (opts.requireFfmpeg) {
    hooks.onLog('info', '检查 FFmpeg 可用性...')
    if (!(await ffmpegProcessor.isAvailable())) {
      throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
    }
    hooks.onLog('success', 'FFmpeg 可用性检查通过')
  }

  if (opts.requireAsr) {
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
  }

  const polishResolved = resolveLlmCompletionConfig(
    {
      llmBaseUrl: options.llmBaseUrl,
      model: options.polishModel || options.translateModel,
      apiKey: opts.llmApiKey,
    },
    '润色'
  )
  if (!polishResolved.ok) {
    throw new Error(
      `文稿润色未就绪：${polishResolved.reason}。请到 设置 › 模型服务 配置。`
    )
  }

  hooks.onLog('info', '文稿润色后端', polishResolved.label)
  return polishResolved
}

/**
 * 运行文稿流水线：识别 → 整篇润色 → 写入 polished.md。
 */
export async function runDocumentPipeline(
  task: TranslationTask,
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal?: AbortSignal
): Promise<DocumentPipelineContext> {
  const context: DocumentPipelineContext = { task, options }

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
      (!mediaStat ||
        isCheckpointFingerprintValid(checkpoint, 'asr', asrFingerprint))
    const legacyCompletedTranscript =
      !mediaAvailable &&
      task.status === TaskStatus.COMPLETED &&
      task.segments.length > 0 &&
      storedSegments.length > 0
    const sourceFingerprint =
      !mediaStat && checkpoint.asrFingerprint
        ? checkpoint.asrFingerprint
        : asrFingerprint
    const documentFingerprint = createCheckpointFingerprint({
      baseUrl: options.llmBaseUrl,
      model: options.polishModel || options.translateModel,
      sourceLanguage: task.sourceLanguage,
      title: mediaBaseName(task.videoFile.name),
      sourceFingerprint,
      transcript: storedTranscriptComplete
        ? storedSegments.map(s => [s.start, s.end, s.originalText])
        : undefined,
    })
    const restoredDocument =
      isCheckpointFingerprintValid(
        checkpoint,
        'document',
        documentFingerprint
      ) && Boolean(checkpoint.documentMarkdown)

    let polishResolved: Awaited<
      ReturnType<typeof ensureDocumentDependencies>
    > | null = null
    if (!restoredDocument) {
      const platformSegments = storedTranscriptComplete
        ? null
        : await tryLoadPlatformSubtitleSegments(task, hooks)
      const usePlatform = Boolean(
        platformSegments && platformSegments.length > 0
      )
      if (
        !mediaAvailable &&
        !usePlatform &&
        !storedTranscriptComplete &&
        !legacyCompletedTranscript
      ) {
        throw new Error('媒体文件不存在，且没有完整转录断点可恢复')
      }
      polishResolved = await ensureDocumentDependencies(
        options,
        hooks,
        signal,
        {
          requireAsr:
            !usePlatform &&
            !storedTranscriptComplete &&
            !legacyCompletedTranscript,
          requireFfmpeg: mediaAvailable,
          requireLlm: true,
          llmApiKey: hooks.resolveLlmApiKey(),
        }
      )

      if (storedTranscriptComplete || legacyCompletedTranscript) {
        const segments = storedTranscriptComplete
          ? storedSegments
          : seedTaskTranscript(task.id, task.segments)
        context.transcription = {
          segments,
          engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
          language:
            task.detectedLanguage || toLanguageCode(task.sourceLanguage),
          rawText: joinSegmentsToRawText(segments),
        }
        hooks.onSegments(segments)
        hooks.onLog(
          'info',
          '已恢复完整转录断点，跳过音频提取与语音识别',
          `${segments.length} 段`
        )
      } else if (usePlatform && platformSegments) {
        const segments = seedTaskTranscript(task.id, platformSegments)
        markAsrComplete(task.id, asrFingerprint)
        context.transcription = {
          segments,
          engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
          language:
            task.platformSubtitleLanguage ||
            toLanguageCode(task.sourceLanguage),
          rawText: joinSegmentsToRawText(segments),
        }
        await hooks.onStatus(TaskStatus.TRANSCRIBING, 50)
        hooks.onSegments(segments)
        hooks.onLog(
          'success',
          '已采用平台字幕作为原文，跳过音频提取与语音识别',
          `${segments.length} 段`
        )
      } else {
        await hooks.onStatus(TaskStatus.EXTRACTING_AUDIO, 10)
        hooks.onLog('info', '开始提取音频...', task.videoFile.path)
        const audioPath = path.join(context.workDir, `audio_${Date.now()}.wav`)
        context.audioPath = await ffmpegProcessor.extractAudio(
          task.videoFile.path,
          audioPath,
          progress => {
            if (signal?.aborted) return
            void hooks.onStatus(
              TaskStatus.EXTRACTING_AUDIO,
              10 + (progress / 100) * 20
            )
          },
          context.workDir
        )
        throwIfAborted(signal)
        hooks.onLog('success', '音频提取完成')

        await hooks.onStatus(TaskStatus.TRANSCRIBING, 35)
        const asrEngine = options.asrEngine ?? DEFAULT_ASR_ENGINE
        hooks.onLog('info', '开始语音识别', `引擎 ${asrEngine}`)
        let lastAsrLogPct = -25
        try {
          context.transcription = await sherpaTranscriber.transcribe(
            context.audioPath,
            {
              engine: asrEngine,
              language: toLanguageCode(task.sourceLanguage),
              workDir: context.workDir,
              checkpointDir: path.join(
                app.getPath('userData'),
                'asr-checkpoints',
                task.id
              ),
              checkpointKey: asrFingerprint,
              signal,
              onPartialSegments: partial => {
                if (signal?.aborted) return
                hooks.onTranscriptionPartial?.(partial)
              },
            },
            progress => {
              if (signal?.aborted) return
              void hooks.onStatus(
                TaskStatus.TRANSCRIBING,
                35 + (progress / 100) * 30
              )
              if (progress - lastAsrLogPct >= 25) {
                lastAsrLogPct = progress
                hooks.onLog('info', `语音识别进行中 ${Math.round(progress)}%`)
              }
            }
          )
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error
          const message = error instanceof Error ? error.message : String(error)
          hooks.onLog('error', '语音识别失败', message)
          throw new Error(`语音识别失败：${message}`)
        }
        throwIfAborted(signal)
        if (context.transcription.segments.length === 0) {
          throw new Error('语音识别未产生任何结果')
        }
        const segments = seedTaskTranscript(
          task.id,
          context.transcription.segments
        )
        context.transcription.segments = segments
        markAsrComplete(task.id, asrFingerprint)
        hooks.onSegments(segments)
        hooks.onLog('success', '语音识别完成', `${segments.length} 段`)
      }
    } else {
      const segments = storedSegments
      context.transcription = {
        segments,
        engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
        language: task.detectedLanguage || toLanguageCode(task.sourceLanguage),
        rawText: joinSegmentsToRawText(segments),
      }
      context.polishedMarkdown = checkpoint.documentMarkdown
      hooks.onSegments(segments)
      hooks.onLog('info', '已恢复完整文稿断点，跳过模型调用')
    }

    const detectedLanguage = normalizeDetectedLanguage(
      context.transcription?.language
    )
    task.detectedLanguage = detectedLanguage
    hooks.onDetectedLanguage(detectedLanguage)
    if (detectedLanguage) {
      hooks.onLog('info', '检测到原文语言', detectedLanguage)
    }
    context.rawText =
      context.transcription?.rawText?.trim() ||
      joinSegmentsToRawText(context.transcription?.segments ?? [])

    if (!context.rawText.trim()) {
      throw new Error('识别原文为空，无法生成文稿')
    }

    const rawChars = context.rawText.length
    hooks.onLog('info', '识别原文已就绪，准备整理文稿', `约 ${rawChars} 字`)

    if (!restoredDocument) {
      if (!polishResolved) {
        throw new Error('文稿润色配置未就绪')
      }
      await hooks.onStatus(TaskStatus.POLISHING, 70)
      hooks.onLog('info', '开始整理为 Markdown 文稿', polishResolved.label)

      try {
        context.polishedMarkdown = await polishDocumentToMarkdown(
          context.rawText,
          {
            title: mediaBaseName(task.videoFile.name),
            sourceLanguage: task.sourceLanguage,
            durationSeconds: task.videoFile.duration,
            config: polishResolved.config,
            signal,
            ...createTextPartCache(
              path.join(
                app.getPath('userData'),
                'text-checkpoints',
                task.id,
                'document-polish'
              ),
              documentFingerprint
            ),
            onProgress: (done, total) => {
              if (signal?.aborted) return
              const pct = 70 + Math.round((done / total) * 25)
              void hooks.onStatus(TaskStatus.POLISHING, pct)
              hooks.onLog(
                'info',
                total > 1
                  ? `文稿润色进度 ${done}/${total} 块`
                  : '文稿润色生成中…'
              )
            },
          }
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        const message = error instanceof Error ? error.message : String(error)
        hooks.onLog('error', '文稿润色失败', message)
        throw error
      }

      throwIfAborted(signal)
      const chapters = buildDocumentChaptersMarkdown(
        context.transcription?.segments ?? []
      )
      if (chapters) {
        context.polishedMarkdown = `${context.polishedMarkdown.trim()}\n\n${chapters}`
      }
      if (!context.polishedMarkdown) {
        throw new Error('文稿润色结果为空')
      }
      markDocumentComplete(
        task.id,
        documentFingerprint,
        context.polishedMarkdown
      )
      hooks.onLog(
        'success',
        '文稿润色完成',
        `约 ${context.polishedMarkdown.length} 字符`
      )
    }

    const outputDir = resolveOutputDir(task)
    await fs.mkdir(outputDir, { recursive: true })
    const polishedMarkdown = context.polishedMarkdown ?? ''
    const mdPath = await writeMarkdownWithoutOverwrite(
      outputDir,
      mediaBaseName(task.videoFile.name),
      polishedMarkdown
    )

    context.outputArtifacts = {
      polishedMarkdown: mdPath,
      outputDirectory: outputDir,
    }
    hooks.onArtifacts(context.outputArtifacts)
    hooks.onLog('success', '文稿已写入', path.basename(mdPath))

    return context
  } finally {
    await tempWorkspace.removeTaskDir(task.id)
  }
}
