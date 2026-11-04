import { promises as fs } from 'node:fs'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AsrEngineId } from '../../../shared/constants'
import { DEFAULT_ASR_ENGINE } from '../../../shared/constants'
import { normalizeDetectedLanguage } from '../../../shared/language'
import type { TranscriptionSegment } from '../../../shared/types/video'
import { ffmpegProcessor } from '../ffmpeg/processor'
import { asrWorkerHost } from './asr-worker-host'
import {
  getAsrModelStatus,
  resolveFunAsrNanoPaths,
  resolveSenseVoicePaths,
} from './model-paths'
import {
  buildSegmentsFromAsrResult,
  type RawAsrResult,
} from './segment-builder'
import {
  loadAsrChunkCheckpoint,
  saveAsrChunkCheckpoint,
  type AsrChunkCheckpointChunk,
  type AsrChunkCheckpointConfig,
} from './chunk-checkpoint'

export interface AsrTranscribeOptions {
  engine?: AsrEngineId
  language?: string
  /** 超过该秒数则切分再识别，默认 90 */
  chunkThresholdSec?: number
  maxChunkSec?: number
  numThreads?: number
  provider?: 'cpu' | 'coreml' | 'cuda'
  /** 任务级临时目录；分段音频将写入此处 */
  workDir?: string
  /** 持久化 ASR 分块断点的目录；需同时提供 checkpointKey 才启用 */
  checkpointDir?: string
  /** 由 pipeline 根据源文件/任务生成的稳定指纹，不能使用临时音频 stat */
  checkpointKey?: string
  /** 协作式取消；当前 worker 块会等待完成，但不会发布其结果 */
  signal?: AbortSignal
  /**
   * 流式回传：每个分段块识别完即回调（只含该块新增的段落），
   * 供任务层边识别边入库/推送 UI；最终结果仍以 transcribe 返回值为准。
   */
  onPartialSegments?: (newSegments: TranscriptionSegment[]) => void
}

export interface AsrTranscriptionResult {
  segments: TranscriptionSegment[]
  engine: AsrEngineId
  language?: string
  rawText?: string
}

/**
 * ASR 客户端门面：分块编排留在主进程（FFmpeg 静音切分、临时文件、进度），
 * 原生推理全部经 asrWorkerHost 在独立 utilityProcess 中执行——
 * 原生层崩溃只影响当前任务，不再拖垮整个 Electron。
 */
export class SherpaTranscriber {
  async isAvailable(
    engine: AsrEngineId = DEFAULT_ASR_ENGINE
  ): Promise<boolean> {
    try {
      require.resolve('sherpa-onnx-node')
    } catch {
      return false
    }

    if (engine === 'sensevoice') {
      return Boolean(resolveSenseVoicePaths())
    }
    if (engine === 'funasr-nano') {
      return Boolean(resolveFunAsrNanoPaths())
    }
    return false
  }

  getStatus() {
    return getAsrModelStatus()
  }

  private recognizeFile(
    request: {
      engine: AsrEngineId
      language: string
      numThreads: number
      provider: string
    },
    audioPath: string
  ): Promise<RawAsrResult> {
    return asrWorkerHost.recognize({
      type: 'recognize',
      ...request,
      wavePath: audioPath,
    })
  }

  async transcribe(
    audioPath: string,
    options: AsrTranscribeOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<AsrTranscriptionResult> {
    const engine = options.engine ?? DEFAULT_ASR_ENGINE
    const language = options.language ?? 'auto'
    const chunkThresholdSec = options.chunkThresholdSec ?? 90
    const maxChunkSec = options.maxChunkSec ?? 45
    const numThreads = options.numThreads ?? Math.min(4, os.cpus().length || 2)
    const provider = options.provider ?? 'cpu'
    const onPartialSegments = options.onPartialSegments
    const signal = options.signal

    throwIfAborted(signal)
    onProgress?.(5)

    if (!(await this.isAvailable(engine))) {
      // 自动回退
      if (engine !== 'sensevoice' && (await this.isAvailable('sensevoice'))) {
        return this.transcribe(
          audioPath,
          { ...options, engine: 'sensevoice' },
          onProgress
        )
      }
      throw new Error(
        `ASR 引擎 ${engine} 不可用：请确认已安装 sherpa-onnx-node 且模型文件存在`
      )
    }
    throwIfAborted(signal)

    const workDir = options.workDir
    if (workDir) {
      await fs.mkdir(workDir, { recursive: true })
    }

    const duration = await ffmpegProcessor.getMediaDuration(audioPath)
    throwIfAborted(signal)
    onProgress?.(15)

    const recognizeRequest = {
      engine,
      language: this.normalizeSenseVoiceLanguage(language),
      numThreads,
      provider,
    }
    const checkpointConfig: AsrChunkCheckpointConfig = {
      engine,
      language: recognizeRequest.language,
      provider,
      maxChunkSec,
    }
    const checkpointEnabled = Boolean(
      options.checkpointDir && options.checkpointKey
    )

    let segments: TranscriptionSegment[] = []
    let rawText = ''
    let detectedLang: string | undefined

    const emitPartial = (newSegments: TranscriptionSegment[]) => {
      if (newSegments.length === 0) return
      segments.push(...newSegments)
      try {
        onPartialSegments?.(newSegments)
      } catch (error) {
        console.error('onPartialSegments 回调失败:', error)
      }
    }

    const hasTokenTimestamps = (result: RawAsrResult): boolean =>
      (result.tokens?.length ?? 0) > 0 && (result.timestamps?.length ?? 0) > 0

    const consumeChunk = async (chunk: {
      path: string
      startTime: number
      duration: number
      enforceSafetyLimit: boolean
    }): Promise<void> => {
      throwIfAborted(signal)
      if (chunk.enforceSafetyLimit && chunk.duration > maxChunkSec * 2) {
        throw new Error(
          `分段过长 (${chunk.duration.toFixed(1)}s)，超过安全上限`
        )
      }

      const checkpointOptions =
        checkpointEnabled && options.checkpointDir && options.checkpointKey
          ? {
              checkpointDir: options.checkpointDir,
              checkpointKey: options.checkpointKey,
              chunk: {
                start: chunk.startTime,
                duration: chunk.duration,
              } satisfies AsrChunkCheckpointChunk,
              config: checkpointConfig,
            }
          : undefined

      const cached = checkpointOptions
        ? await loadAsrChunkCheckpoint(checkpointOptions)
        : null
      let result: RawAsrResult
      let part: TranscriptionSegment[]

      if (cached) {
        result = cached.result
        part = cached.segments
      } else {
        // 当前 worker 块允许自然完成；完成后立即检查 signal，取消时不发布/不写入结果。
        result = await this.recognizeFile(recognizeRequest, chunk.path)
        throwIfAborted(signal)
        const speechSpans = hasTokenTimestamps(result)
          ? undefined
          : await this.getChunkSpeechSpans(chunk.path, chunk.duration)
        throwIfAborted(signal)
        part = buildSegmentsFromAsrResult(result, {
          timeOffset: chunk.startTime,
          speechSpans,
        })
        throwIfAborted(signal)
        if (checkpointOptions) {
          await saveAsrChunkCheckpoint({
            ...checkpointOptions,
            result,
            segments: part,
          })
        }
      }

      throwIfAborted(signal)
      emitPartial(part)
      if (result.text) {
        rawText += `${result.text} `
      }
      if (
        !detectedLang &&
        result.lang &&
        part.some(segment => cleanAsrText(segment.originalText).length > 0)
      ) {
        detectedLang = result.lang
      }
    }

    const failures: Array<{ index: number; error: string }> = []
    const chunks: Array<{
      path: string
      startTime: number
      duration: number
      removeAfter: boolean
      enforceSafetyLimit: boolean
    }> = []

    if (duration <= chunkThresholdSec) {
      chunks.push({
        path: audioPath,
        startTime: 0,
        duration,
        removeAfter: false,
        enforceSafetyLimit: false,
      })
      onProgress?.(30)
    } else {
      // 静音切分 + 强制 maxChunkSec，避免超长段一次送入原生 ASR 导致 worker 崩溃
      let audioChunks = await ffmpegProcessor.segmentAudio(
        audioPath,
        maxChunkSec,
        -40,
        workDir
      )
      throwIfAborted(signal)

      // 安全网：任何仍超长的段再次整轨固定时长切分（并清理上一轮临时文件）
      const safeMax = maxChunkSec * 1.25
      const oversized = audioChunks.filter(c => c.duration > safeMax)
      if (oversized.length > 0) {
        console.warn(
          `ASR: ${oversized.length} 个分段超过 ${safeMax}s，重新固定时长切分`
        )
        await Promise.all(
          audioChunks.map(c => fs.unlink(c.path).catch(() => {}))
        )
        audioChunks = await ffmpegProcessor.segmentAudio(
          audioPath,
          maxChunkSec,
          // 极低阈值弱化静音依赖，最终仍强制按 maxChunkSec 切
          -90,
          workDir
        )
        throwIfAborted(signal)
      }

      console.log(
        `ASR: 共 ${audioChunks.length} 段，最长 ${Math.max(...audioChunks.map(c => c.duration), 0).toFixed(1)}s`
      )
      chunks.push(
        ...audioChunks.map(chunk => ({
          path: chunk.path,
          startTime: chunk.startTime,
          duration: chunk.duration,
          removeAfter: true,
          enforceSafetyLimit: true,
        }))
      )
      onProgress?.(25)
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      try {
        await consumeChunk(chunk)
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
          throw createAbortError()
        }
        const message = error instanceof Error ? error.message : String(error)
        console.error(`ASR 分段 ${i} 失败:`, error)
        failures.push({ index: i, error: message })
      } finally {
        if (chunk.removeAfter) {
          await fs.unlink(chunk.path).catch(() => {})
        }
      }

      onProgress?.(25 + ((i + 1) / chunks.length) * 60)
    }

    if (failures.length > 0) {
      const details = failures
        .map(failure => `分段 ${failure.index + 1}: ${failure.error}`)
        .join('；')
      throw new Error(
        `ASR 有 ${failures.length} 个分段失败，任务未完成；已保留成功分段断点：${details}`
      )
    }

    segments.sort((a, b) => a.start - b.start)

    if (segments.length === 0 && rawText.trim()) {
      segments = [
        {
          id: randomUUID(),
          start: 0,
          end: Math.max(duration, 1),
          originalText: rawText.trim(),
          confidence: 0.8,
        },
      ]
    }

    // 清理 SenseVoice 可能带的特殊标签
    segments = segments
      .map(s => ({
        ...s,
        originalText: cleanAsrText(s.originalText),
      }))
      .filter(s => s.originalText.length > 0)

    onProgress?.(100)

    return {
      segments,
      engine,
      language:
        segments.length > 0
          ? normalizeDetectedLanguage(detectedLang)
          : undefined,
      rawText: rawText.trim(),
    }
  }

  /**
   * 块内语音区间（无 token 时间戳的模型用）：静音检测的补集，
   * end 钳到块时长；失败返回 undefined，分段器回退均匀切分。
   */
  private async getChunkSpeechSpans(
    audioPath: string,
    durationSec: number
  ): Promise<Array<{ start: number; end: number }>> {
    const spans = await ffmpegProcessor.detectSpeechSpans(audioPath)
    return spans.map(span => ({
      start: span.start,
      end: Math.min(span.end, durationSec),
    }))
  }

  private normalizeSenseVoiceLanguage(language: string): string {
    const map: Record<string, string> = {
      auto: 'auto',
      zh: 'zh',
      'zh-cn': 'zh',
      'zh-tw': 'zh',
      中文: 'zh',
      chinese: 'zh',
      en: 'en',
      english: 'en',
      ja: 'ja',
      japanese: 'ja',
      日本語: 'ja',
      ko: 'ko',
      korean: 'ko',
      한국어: 'ko',
      yue: 'yue',
      cantonese: 'yue',
      粤语: 'yue',
    }
    const key = (language || 'auto').toLowerCase()
    return map[key] || map[language] || 'auto'
  }

  cleanup(): void {
    asrWorkerHost.dispose()
  }
}

function cleanAsrText(text: string): string {
  return text
    .replace(/<\|[^|>]+\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function createAbortError(): Error {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export const sherpaTranscriber = new SherpaTranscriber()
