import { v4 as uuidv4 } from 'uuid'
import type { TranscriptionSegment } from '../../shared/types/video'
import { displayWidth } from './subtitle-layout'

export interface DisplaySegment extends TranscriptionSegment {
  /** 来源识别段 ID（可一对多合并） */
  sourceSegmentIds: string[]
  /** 润色后的显示原文；缺省时用 originalText */
  polishedText?: string
}

export interface DisplaySegmentOptions {
  /** 相邻段最大间隙（秒），超过则不合并 */
  maxGapSeconds?: number
  /** 合并后最大时长（秒） */
  maxDurationSeconds?: number
  /** 合并后最大显示宽度（半角列） */
  maxDisplayColumns?: number
  /** 过短段阈值（秒） */
  minDurationSeconds?: number
}

const SENTENCE_END = /[.!?。！？…]["'”’)）\]】》]*\s*$/u

const DEFAULT_OPTIONS: Required<DisplaySegmentOptions> = {
  maxGapSeconds: 0.75,
  maxDurationSeconds: 7,
  maxDisplayColumns: 68,
  minDurationSeconds: 0.4,
}

/**
 * 将识别段整理为更适合阅读的显示段。
 * - 过碎短句合并
 * - 在句末/静音间隙/宽度预算处断开
 * - 不改写单段内部文本，只做整段拼接
 */
export function buildDisplaySegments(
  segments: TranscriptionSegment[],
  options: DisplaySegmentOptions = {}
): DisplaySegment[] {
  if (segments.length === 0) return []

  const opts = { ...DEFAULT_OPTIONS, ...options }
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const result: DisplaySegment[] = []

  let current: DisplaySegment | null = null

  const flush = () => {
    if (current) {
      result.push(current)
      current = null
    }
  }

  for (const segment of sorted) {
    const text = segment.originalText.trim()
    if (!text) continue

    if (!current) {
      current = {
        ...segment,
        originalText: text,
        sourceSegmentIds: [segment.id],
      }
      continue
    }

    const gap = segment.start - current.end
    const combinedText: string = `${current.originalText}${needsSpace(current.originalText, text) ? ' ' : ''}${text}`
    const combinedDuration = segment.end - current.start
    const endsSentence = SENTENCE_END.test(current.originalText)
    const tooWide = displayWidth(combinedText) > opts.maxDisplayColumns
    const tooLong = combinedDuration > opts.maxDurationSeconds
    const gapTooLarge = gap > opts.maxGapSeconds

    const shouldMerge =
      !endsSentence &&
      !gapTooLarge &&
      !tooLong &&
      !tooWide &&
      (gap <= opts.maxGapSeconds ||
        current.end - current.start < opts.minDurationSeconds ||
        text.length <= 2)

    if (shouldMerge) {
      current = {
        ...current,
        end: segment.end,
        originalText: combinedText,
        confidence: Math.min(current.confidence, segment.confidence),
        sourceSegmentIds: [...current.sourceSegmentIds, segment.id],
        translatedText: undefined,
        polishedText: undefined,
      }
    } else {
      flush()
      current = {
        ...segment,
        originalText: text,
        sourceSegmentIds: [segment.id],
      }
    }
  }

  flush()
  return result
}

function needsSpace(left: string, right: string): boolean {
  if (!left || !right) return false
  const leftLast = left[left.length - 1]
  const rightFirst = right[0]
  const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u
  if (cjk.test(leftLast) || cjk.test(rightFirst)) return false
  if (/\s/u.test(leftLast) || /\s/u.test(rightFirst)) return false
  if (/[，。！？、,.!?;；：:]$/u.test(leftLast)) return false
  return true
}

/**
 * 将显示段 ID 映射回原始识别段，便于回写翻译结果。
 */
export function expandDisplayTranslations(
  displaySegments: DisplaySegment[],
  translations: string[]
): Map<string, string> {
  const map = new Map<string, string>()
  displaySegments.forEach((segment, index) => {
    const text = translations[index] ?? segment.translatedText ?? ''
    for (const sourceId of segment.sourceSegmentIds) {
      // 合并段：译文写在第一个源段；其余源段保留空译文由调用方决定
      if (!map.has(sourceId)) {
        map.set(sourceId, text)
      }
    }
  })
  return map
}

export function cloneAsDisplaySegments(
  segments: TranscriptionSegment[]
): DisplaySegment[] {
  return segments.map(segment => ({
    ...segment,
    id: segment.id || uuidv4(),
    sourceSegmentIds: [segment.id],
  }))
}
