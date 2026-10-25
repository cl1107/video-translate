import { randomUUID } from 'node:crypto'
import type { TranscriptionSegment } from '../../../shared/types/video'

export interface RawAsrResult {
  text?: string
  tokens?: string[]
  timestamps?: number[]
  lang?: string
}

const SENTENCE_END = /[。！？!?；;…]/
const PUNCT_ONLY =
  /^[\s。！？!?；;…、，,.．:：\-—～~「」『』（）()【】[\]""''《》〈〉]+$/u

/**
 * 将 sherpa-onnx 的 token 级时间戳合并为字幕段落。
 */
export function buildSegmentsFromAsrResult(
  result: RawAsrResult,
  options: {
    timeOffset?: number
    maxDuration?: number
    silenceGap?: number
    /**
     * 块内语音区间（静音检测的补集，end 已按块时长钳为有限值）。
     * 仅在模型没有 token 时间戳时用于把句子分布到真实语音段上；
     * 缺省或为空时回退按句均分。
     */
    speechSpans?: Array<{ start: number; end: number }>
  } = {}
): TranscriptionSegment[] {
  const timeOffset = options.timeOffset ?? 0
  const maxDuration = options.maxDuration ?? 7
  const silenceGap = options.silenceGap ?? 0.55

  const tokens = result.tokens ?? []
  const timestamps = result.timestamps ?? []
  const fullText = (result.text ?? '').trim()

  if (tokens.length === 0 || timestamps.length === 0) {
    if (!fullText) return []
    const speechSpans = options.speechSpans ?? []
    if (speechSpans.length > 0) {
      const distributed = distributeTextAcrossSpans(
        fullText,
        speechSpans,
        timeOffset
      )
      if (distributed.length > 0) return mergeTinySegments(distributed)
    }
    return splitTextFallback(fullText, timeOffset, maxDuration)
  }

  const segments: TranscriptionSegment[] = []
  let buffer = ''
  let segStart = timestamps[0] ?? 0
  let lastTs = segStart

  const flush = (end: number) => {
    const text = normalizeSubtitleText(buffer)
    buffer = ''
    if (!text) return

    // 纯标点并入上一段，避免单独一条「？」
    if (PUNCT_ONLY.test(text) && segments.length > 0) {
      const prev = segments[segments.length - 1]
      prev.originalText = normalizeSubtitleText(`${prev.originalText}${text}`)
      prev.end = timeOffset + Math.max(end, segStart + 0.15)
      return
    }

    const start = timeOffset + segStart
    const endTime = timeOffset + Math.max(end, segStart + 0.25)
    segments.push({
      id: randomUUID(),
      start,
      end: endTime,
      originalText: text,
      confidence: 0.9,
    })
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    const ts = timestamps[i] ?? lastTs
    const gap = ts - lastTs

    // 长静音或超长段：在静音处切分
    if (buffer && (gap >= silenceGap || ts - segStart >= maxDuration)) {
      // 尽量在空白后切，避免词中间断开
      flush(lastTs + 0.12)
      segStart = ts
    }

    buffer += token
    lastTs = ts

    if (SENTENCE_END.test(token)) {
      flush(ts + 0.18)
      if (i + 1 < timestamps.length) {
        segStart = timestamps[i + 1] ?? ts
      } else {
        segStart = ts
      }
    }
  }

  if (buffer.trim()) {
    flush(lastTs + 0.25)
  }

  return mergeTinySegments(segments)
}

function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([。！？!?；;…、，,])/g, '$1')
    .trim()
}

/**
 * 按语音区间加权分布句子：句长占比 × 总语音时长 = 该句耗时，
 * 在「语音时间轴」上顺次消费（跳过静音），再映射回真实时间。
 * 时间戳缺省模型（Fun-ASR-Nano 等）的时间轴精度由此从「均匀切分」
 * 提升到「跟随实际说话位置」。
 */
export function distributeTextAcrossSpans(
  fullText: string,
  spans: Array<{ start: number; end: number }>,
  timeOffset: number
): TranscriptionSegment[] {
  const parts = fullText
    .split(/(?<=[。！？!?])/)
    .map(p => p.trim())
    .filter(Boolean)
  const usable = spans.filter(span => span.end > span.start)
  if (parts.length === 0 || usable.length === 0) return []

  const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1
  const cumulative: number[] = [0]
  for (const span of usable) {
    cumulative.push(cumulative[cumulative.length - 1] + (span.end - span.start))
  }
  const totalSpeech = cumulative[cumulative.length - 1] || 1
  const timelineEnd = usable[usable.length - 1].end
  // 长静音（>0.6s）：句子墙钟区间跨过它时，视为这句话在停顿之后说的
  const longGaps = usable
    .slice(0, -1)
    .map((span, i) => ({ start: span.end, end: usable[i + 1].start }))
    .filter(gap => gap.end - gap.start > 0.6)

  // 语音时间轴坐标 → 真实时间
  const speechToWall = (t: number): number => {
    for (let i = 0; i < usable.length; i++) {
      if (t <= cumulative[i + 1]) {
        return usable[i].start + (t - cumulative[i])
      }
    }
    return timelineEnd
  }

  const segments: TranscriptionSegment[] = []
  let cursorSpeech = 0
  for (const part of parts) {
    const durationSpeech = (part.length / totalChars) * totalSpeech
    let start = speechToWall(cursorSpeech)
    let end = speechToWall(cursorSpeech + durationSpeech)
    const crossed = longGaps.find(gap => gap.start > start && gap.end < end)
    if (crossed) {
      // 不让字幕横跨长静音：吸附到静音后的语音段起点
      start = crossed.end
      end = Math.min(start + durationSpeech, timelineEnd)
    }
    segments.push({
      id: randomUUID(),
      start: timeOffset + start,
      end: timeOffset + Math.max(end, start + 0.15),
      originalText: part,
      confidence: 0.85,
    })
    cursorSpeech += durationSpeech
  }
  return segments
}

function splitTextFallback(
  fullText: string,
  timeOffset: number,
  maxDuration: number
): TranscriptionSegment[] {
  // 按句号等粗分，时间均分
  const parts = fullText
    .split(/(?<=[。！？!?])/)
    .map(p => p.trim())
    .filter(Boolean)

  if (parts.length <= 1) {
    return [
      {
        id: randomUUID(),
        start: timeOffset,
        end: timeOffset + Math.max(1, maxDuration / 2),
        originalText: fullText,
        confidence: 0.85,
      },
    ]
  }

  const slice = maxDuration / parts.length
  return parts.map((text, i) => ({
    id: randomUUID(),
    start: timeOffset + i * slice,
    end: timeOffset + (i + 1) * slice,
    originalText: text,
    confidence: 0.85,
  }))
}

function mergeTinySegments(
  segments: TranscriptionSegment[]
): TranscriptionSegment[] {
  if (segments.length <= 1) return segments

  const merged: TranscriptionSegment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    const text = seg.originalText

    if (prev && PUNCT_ONLY.test(text)) {
      prev.originalText = normalizeSubtitleText(`${prev.originalText}${text}`)
      prev.end = seg.end
      continue
    }

    // 过短片段并入上一段
    if (
      prev &&
      (text.length <= 2 || seg.end - seg.start < 0.4) &&
      prev.originalText.length < 40
    ) {
      prev.originalText = normalizeSubtitleText(`${prev.originalText}${text}`)
      prev.end = seg.end
      continue
    }

    merged.push({ ...seg })
  }
  return merged
}
