import type { TranscriptionSegment } from '../../shared/types/video'

const MAX_CHAPTER_TITLE_LENGTH = 80

function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  const end = normalized.search(/[。！？!?]|\.(?=\s|$)/)
  return (end === -1 ? normalized : normalized.slice(0, end + 1)).trim()
}

function chapterTitle(text: string): string {
  const sentence = firstSentence(text)
  if (sentence.length <= MAX_CHAPTER_TITLE_LENGTH) return sentence
  return `${sentence.slice(0, MAX_CHAPTER_TITLE_LENGTH)}…`
}

function escapeLinkLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/[[\]]/g, '\\$&')
}

function formatStartSeconds(start: number): string {
  return Number.isFinite(start) && start >= 0 ? String(start) : '0'
}

/**
 * 从转录原文生成可附加到文稿末尾的章节来源索引。
 * 章节标题只取每段原文的首句，不调用模型；点击链接可跳转到媒体的对应时间。
 */
export function buildDocumentChaptersMarkdown(
  segments: TranscriptionSegment[]
): string {
  const entries = segments.flatMap(segment => {
    const title = chapterTitle(segment.originalText)
    if (!title) return []
    return [
      `- [${escapeLinkLabel(title)}](#t=${formatStartSeconds(segment.start)})`,
    ]
  })

  if (entries.length === 0) return ''
  return `## 章节来源索引\n\n${entries.join('\n')}\n`
}
