import type { TranscriptionSegment } from './types/video'

export const MIN_SUBTITLE_DURATION_SECONDS = 0.5
export const MAX_SUBTITLE_DURATION_SECONDS = 8
export const MAX_SUBTITLE_LINE_WIDTH = 84

export type SubtitleReviewIssueKind =
  | 'empty-translation'
  | 'fallback-translation'
  | 'overlap'
  | 'too-short'
  | 'too-long'
  | 'line-too-long'

export interface SubtitleReviewIssue {
  kind: SubtitleReviewIssueKind
  segmentId: string
  message: string
  relatedSegmentId?: string
}

function durationOf(segment: TranscriptionSegment): number {
  return segment.end - segment.start
}

function displayWidth(text: string): number {
  return Array.from(text).reduce(
    (width, character) => width + (/[^\x00-\x7f]/u.test(character) ? 2 : 1),
    0
  )
}

function longestLineWidth(text: string): number {
  return Math.max(0, ...text.split(/\r?\n/u).map(displayWidth))
}

/**
 * 计算校对工作台需要优先处理的问题。
 * 保留字幕原始顺序：重叠检查只比较相邻段，避免排序改变用户看到的索引。
 */
export function collectSubtitleReviewIssues(
  segments: TranscriptionSegment[],
  limits: {
    minDuration?: number
    maxDuration?: number
    maxLineWidth?: number
    requireTranslation?: boolean
  } = {}
): SubtitleReviewIssue[] {
  const minDuration = limits.minDuration ?? MIN_SUBTITLE_DURATION_SECONDS
  const maxDuration = limits.maxDuration ?? MAX_SUBTITLE_DURATION_SECONDS
  const maxLineWidth = limits.maxLineWidth ?? MAX_SUBTITLE_LINE_WIDTH
  const requireTranslation = limits.requireTranslation ?? true
  const issues: SubtitleReviewIssue[] = []

  segments.forEach((segment, index) => {
    if (requireTranslation && !(segment.translatedText ?? '').trim()) {
      issues.push({
        kind: 'empty-translation',
        segmentId: segment.id,
        message: '译文为空',
      })
    } else if (segment.translationStatus === 'fallback') {
      issues.push({
        kind: 'fallback-translation',
        segmentId: segment.id,
        message: '译文回退为原文',
      })
    }

    const lineWidth = Math.max(
      longestLineWidth(segment.originalText),
      longestLineWidth(segment.translatedText ?? '')
    )
    if (lineWidth > maxLineWidth) {
      issues.push({
        kind: 'line-too-long',
        segmentId: segment.id,
        message: `单行过长（${lineWidth} 列）`,
      })
    }

    const duration = durationOf(segment)
    if (duration < minDuration) {
      issues.push({
        kind: 'too-short',
        segmentId: segment.id,
        message: `时长过短（${duration.toFixed(2)} 秒）`,
      })
    } else if (duration > maxDuration) {
      issues.push({
        kind: 'too-long',
        segmentId: segment.id,
        message: `时长过长（${duration.toFixed(2)} 秒）`,
      })
    }

    const previous = segments[index - 1]
    if (previous && segment.start < previous.end) {
      issues.push({
        kind: 'overlap',
        segmentId: segment.id,
        relatedSegmentId: previous.id,
        message: `与上一段重叠 ${Math.max(0, previous.end - segment.start).toFixed(2)} 秒`,
      })
    }
  })

  return issues
}

export const getSubtitleReviewIssues = collectSubtitleReviewIssues

/** 合并 IPC 远程更新时保留尚未保存的本地段落草稿。 */
export function mergeSegmentsPreservingDirtyDrafts(
  remote: TranscriptionSegment[],
  local: TranscriptionSegment[],
  dirtyIds: ReadonlySet<string>
): TranscriptionSegment[] {
  return remote.map(segment => {
    if (!dirtyIds.has(segment.id)) return segment
    return local.find(draft => draft.id === segment.id) ?? segment
  })
}

export function formatSubtitleTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`
}

export function parseSubtitleTime(value: string): number | null {
  const trimmed = value.trim().replace(',', '.')
  const parts = trimmed.split(':')
  if (parts.length !== 2 && parts.length !== 3) return null
  const numbers = parts.map(Number)
  if (numbers.some(number => !Number.isFinite(number) || number < 0)) {
    return null
  }
  const offset = numbers.length === 2 ? 0 : numbers[0] * 3600
  const minuteIndex = numbers.length === 2 ? 0 : 1
  const minutes = numbers[minuteIndex]
  const seconds = numbers[minuteIndex + 1]
  if (minutes >= 60 || seconds >= 60) return null
  return offset + minutes * 60 + seconds
}
