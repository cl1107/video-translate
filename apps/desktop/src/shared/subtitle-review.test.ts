import { describe, expect, it } from 'vitest'
import {
  collectSubtitleReviewIssues,
  formatSubtitleTime,
  mergeSegmentsPreservingDirtyDrafts,
  parseSubtitleTime,
} from './subtitle-review'
import type { TranscriptionSegment } from './types/video'

const segment = (
  id: string,
  start: number,
  end: number,
  translatedText = '译文',
  translationStatus?: TranscriptionSegment['translationStatus']
): TranscriptionSegment => ({
  id,
  start,
  end,
  originalText: `原文 ${id}`,
  translatedText,
  translationStatus,
  confidence: 1,
})

describe('subtitle review', () => {
  it('finds empty, fallback, overlap, short and long segments', () => {
    const issues = collectSubtitleReviewIssues([
      segment('empty', 0, 1, ''),
      segment('fallback', 1.2, 2, 'same', 'fallback'),
      segment('overlap', 1.8, 3),
      segment('short', 3, 3.2),
      segment('long', 4, 13),
    ])

    expect(issues.map(issue => `${issue.segmentId}:${issue.kind}`)).toEqual([
      'empty:empty-translation',
      'fallback:fallback-translation',
      'overlap:overlap',
      'short:too-short',
      'long:too-long',
    ])
  })

  it('finds long display lines and can skip translation requirements for extract mode', () => {
    const long = segment('long-line', 0, 2, 'x'.repeat(85))
    expect(collectSubtitleReviewIssues([long])).toEqual([
      expect.objectContaining({
        kind: 'line-too-long',
        segmentId: 'long-line',
      }),
    ])

    expect(
      collectSubtitleReviewIssues([segment('extract', 0, 2, '')], {
        requireTranslation: false,
      })
    ).toEqual([])
  })

  it('allows custom duration limits', () => {
    expect(
      collectSubtitleReviewIssues([segment('one', 0, 2)], {
        minDuration: 2,
        maxDuration: 2,
      })
    ).toEqual([])
  })

  it('preserves dirty local drafts while applying clean remote updates', () => {
    const remote = [
      segment('one', 0, 1, '远程一'),
      segment('two', 1, 2, '远程二'),
    ]
    const local = [
      segment('one', 0, 1, '本地草稿'),
      segment('two', 1, 2, '本地二'),
    ]

    expect(
      mergeSegmentsPreservingDirtyDrafts(remote, local, new Set(['one']))
    ).toEqual([local[0], remote[1]])
  })

  it('parses and formats media timestamps', () => {
    expect(parseSubtitleTime('01:02,500')).toBe(62.5)
    expect(parseSubtitleTime('00:01:02.500')).toBe(62.5)
    expect(parseSubtitleTime('01:60,000')).toBeNull()
    expect(formatSubtitleTime(62.5)).toBe('00:01:02.500')
  })
})
