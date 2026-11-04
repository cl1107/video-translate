import { describe, expect, it } from 'vitest'
import type { TranscriptionSegment } from '../../shared/types/video'
import { buildDocumentChaptersMarkdown } from './document-chapters'

function segment(
  start: number,
  originalText: string,
  polishedText?: string
): TranscriptionSegment {
  return {
    id: `segment-${start}`,
    start,
    end: start + 1,
    originalText,
    polishedText,
    confidence: 1,
  }
}

describe('buildDocumentChaptersMarkdown', () => {
  it('按原文首句生成带媒体时间链接的章节索引', () => {
    const markdown = buildDocumentChaptersMarkdown([
      segment(0, '第一段内容。这里不应进入标题。', '模型润色后的标题。'),
      segment(12.5, 'This is the first sentence. The rest is omitted.'),
    ])

    expect(markdown).toBe(
      '## 章节来源索引\n\n' +
        '- [第一段内容。](#t=0)\n' +
        '- [This is the first sentence.](#t=12.5)\n'
    )
    expect(markdown).not.toContain('模型润色后的标题')
  })

  it('截断过长首句并清理空白段', () => {
    const longSentence = `${'很长的章节标题'.repeat(20)}。后续内容`
    const markdown = buildDocumentChaptersMarkdown([
      segment(3, '  '),
      segment(8, longSentence),
    ])

    expect(markdown).toMatch(new RegExp(`^- \\[.{80}…\\]\\(#t=8\\)$`, 'm'))
    expect(markdown).not.toContain('后续内容')
  })

  it('空输入不生成空章节', () => {
    expect(buildDocumentChaptersMarkdown([])).toBe('')
    expect(buildDocumentChaptersMarkdown([segment(1, '\n\t')])).toBe('')
  })
})
