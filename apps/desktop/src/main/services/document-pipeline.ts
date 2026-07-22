/**
 * 文稿流水线：共享 FFmpeg/ASR，整篇润色为 Markdown（不写字幕、不翻译）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEFAULT_ASR_ENGINE } from '../../shared/constants'
import { normalizeDetectedLanguage, toLanguageCode } from '../../shared/language'
import type {
  TaskOutputArtifacts,
  TaskRuntimeOptions,
  TranscriptionSegment,
  TranslationTask,
} from '../../shared/types/video'
import { TaskStatus } from '../../shared/types/video'
import { SubtitleGenerator } from '../utils/subtitle-generator'
import { ensureSenseVoiceModel } from './asr/model-downloader'
import {
  type AsrTranscriptionResult,
  sherpaTranscriber,
} from './asr/sherpa-transcriber'
import { databaseManager } from './database/manager'
import { ffmpegProcessor } from './ffmpeg/processor'
import { throwIfAborted } from './llm/completion-port'
import { polishDocumentToMarkdown } from './llm/document-polish-service'
import { resolvePolishCompletionConfig } from './llm/polish-service'
import { ollamaClient } from './ollama/client'
import { tempWorkspace } from './temp-workspace'
import type { PipelineHooks } from './translation-pipeline'

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

/**
 * 将段落拼为润色用原文（保留换行分段）。
 */
export function joinSegmentsToRawText(segments: TranscriptionSegment[]): string {
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

async function ensureDocumentDependencies(
  options: TaskRuntimeOptions,
  hooks: PipelineHooks,
  signal: AbortSignal | undefined,
  opts: { requireAsr: boolean; byokApiKey?: string }
): Promise<ReturnType<typeof resolvePolishCompletionConfig> & { ok: true }> {
  throwIfAborted(signal)

  hooks.onLog('info', '检查 FFmpeg 可用性...')
  if (!(await ffmpegProcessor.isAvailable())) {
    throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
  }
  hooks.onLog('success', 'FFmpeg 可用性检查通过')

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

  const polishResolved = resolvePolishCompletionConfig({
    polishProvider: options.polishProvider ?? 'ollama',
    polishOllamaModel: options.polishOllamaModel,
    byokBaseUrl: options.byokBaseUrl,
    byokModelId: options.byokModelId,
    byokApiKey: opts.byokApiKey,
  })
  if (!polishResolved.ok) {
    throw new Error(
      `文稿润色未就绪：${polishResolved.reason}。请到设置配置润色模型（Ollama 或 BYOK）。`
    )
  }

  if ((options.polishProvider ?? 'ollama') === 'ollama') {
    hooks.onLog('info', '检查 Ollama 服务状态...')
    if (!(await ollamaClient.isAvailable())) {
      throw new Error('Ollama 服务不可用，请先启动 Ollama 或改用 BYOK 润色')
    }
    hooks.onLog('success', 'Ollama 可用性检查通过')
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

    const platformSegments = await tryLoadPlatformSubtitleSegments(task, hooks)
    const usePlatform = Boolean(platformSegments && platformSegments.length > 0)

    const polishResolved = await ensureDocumentDependencies(
      options,
      hooks,
      signal,
      {
        requireAsr: !usePlatform,
        byokApiKey: hooks.resolveByokApiKey(),
      }
    )

    if (usePlatform && platformSegments) {
      context.transcription = {
        segments: platformSegments,
        engine: options.asrEngine ?? DEFAULT_ASR_ENGINE,
        language:
          task.platformSubtitleLanguage || toLanguageCode(task.sourceLanguage),
        rawText: joinSegmentsToRawText(platformSegments),
      }
      await hooks.onStatus(TaskStatus.TRANSCRIBING, 50)
      databaseManager.saveTranscriptionSegments(task.id, platformSegments)
      hooks.onSegments(platformSegments)
      hooks.onLog(
        'success',
        '已采用平台字幕作为原文，跳过音频提取与语音识别',
        `${platformSegments.length} 段`
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
          },
          progress => {
            if (signal?.aborted) return
            void hooks.onStatus(
              TaskStatus.TRANSCRIBING,
              35 + (progress / 100) * 30
            )
            // 约每 25% 记一条，避免长视频识别期间日志“卡住”
            if (progress - lastAsrLogPct >= 25) {
              lastAsrLogPct = progress
              hooks.onLog(
                'info',
                `语音识别进行中 ${Math.round(progress)}%`
              )
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
      databaseManager.saveTranscriptionSegments(
        task.id,
        context.transcription.segments
      )
      hooks.onSegments(context.transcription.segments)
      hooks.onLog(
        'success',
        '语音识别完成',
        `${context.transcription.segments.length} 段`
      )
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
    hooks.onLog(
      'info',
      '识别原文已就绪，准备整理文稿',
      `约 ${rawChars} 字`
    )

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
    hooks.onLog(
      'success',
      '文稿润色完成',
      `约 ${context.polishedMarkdown.length} 字符`
    )

    const outputDir = resolveOutputDir(task)
    await fs.mkdir(outputDir, { recursive: true })
    const mdPath = path.join(
      outputDir,
      `${mediaBaseName(task.videoFile.name)}.md`
    )
    await fs.writeFile(mdPath, context.polishedMarkdown, 'utf-8')

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
