import { promises as fs } from 'node:fs'
import type {
  SubtitleEntry,
  TranscriptionSegment,
} from '../../shared/types/video'

/**
 * 将转录段落转换为字幕条目
 */
function segmentsToSubtitles(
  segments: TranscriptionSegment[]
): SubtitleEntry[] {
  return segments.map((segment, index) => ({
    index: index + 1,
    start: formatTime(segment.start, 'srt'),
    end: formatTime(segment.end, 'srt'),
    text: segment.translatedText || segment.originalText,
  }))
}

/**
 * 格式化时间戳
 */
function formatTime(seconds: number, format: 'srt' | 'vtt' = 'srt'): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const milliseconds = Math.floor((seconds % 1) * 1000)

  if (format === 'vtt') {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${milliseconds
      .toString()
      .padStart(3, '0')}`
  }

  // SRT 格式
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds
    .toString()
    .padStart(3, '0')}`
}

/**
 * 生成 SRT 格式字幕
 */
function generateSRT(subtitles: SubtitleEntry[]): string {
  return subtitles
    .map(subtitle => {
      return `${subtitle.index}\n${subtitle.start} --> ${subtitle.end}\n${subtitle.text}\n`
    })
    .join('\n')
}

/**
 * 生成 VTT 格式字幕
 */
function generateVTT(subtitles: SubtitleEntry[]): string {
  const header = 'WEBVTT\n\n'
  const content = subtitles
    .map(subtitle => {
      const start = subtitle.start.replace(',', '.')
      const end = subtitle.end.replace(',', '.')
      return `${start} --> ${end}\n${subtitle.text}\n`
    })
    .join('\n')

  return header + content
}

/**
 * 生成纯文本格式
 */
function generateTXT(subtitles: SubtitleEntry[]): string {
  return subtitles.map(subtitle => subtitle.text).join('\n\n')
}

/**
 * 保存字幕文件
 */
async function saveSubtitle(
  subtitles: SubtitleEntry[],
  outputPath: string,
  format: 'srt' | 'vtt' | 'txt' = 'srt'
): Promise<string> {
  let content: string
  let extension: string

  switch (format) {
    case 'vtt':
      content = generateVTT(subtitles)
      extension = '.vtt'
      break
    case 'txt':
      content = generateTXT(subtitles)
      extension = '.txt'
      break
    default:
      content = generateSRT(subtitles)
      extension = '.srt'
  }

  const finalPath = outputPath.endsWith(extension)
    ? outputPath
    : outputPath.replace(/\.[^.]+$/, extension)

  await fs.writeFile(finalPath, content, 'utf-8')
  return finalPath
}

/**
 * 解析时间字符串为秒数
 */
function parseTime(timeStr: string): number {
  const parts = timeStr.replace(',', '.').split(':')
  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  const seconds = Number.parseFloat(parts[2])

  return hours * 3600 + minutes * 60 + seconds
}

/**
 * 解析 SRT 文本为字幕条目。
 * 兼容常见变体：空行、多行文本、BOM、可选序号。
 */
function parseSRT(content: string): SubtitleEntry[] {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const blocks = text.split(/\n\s*\n/)
  const entries: SubtitleEntry[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0)
    if (lines.length < 2) continue

    let timeLineIdx = 0
    // 可选序号行
    if (/^\d+$/.test(lines[0].trim()) && lines.length >= 3) {
      timeLineIdx = 1
    }

    const timeLine = lines[timeLineIdx]
    const timeMatch = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/
    )
    if (!timeMatch) continue

    const start = normalizeSrtTimestamp(timeMatch[1])
    const end = normalizeSrtTimestamp(timeMatch[2])
    const body = lines
      .slice(timeLineIdx + 1)
      .join('\n')
      // 去掉简单 HTML / ASS 标签
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .trim()

    if (!body) continue
    if (!(parseTime(start) < parseTime(end))) continue

    entries.push({
      index: entries.length + 1,
      start,
      end,
      text: body,
    })
  }

  return entries
}

/** 解析 VTT（忽略 STYLE/NOTE/头信息） */
function parseVTT(content: string): SubtitleEntry[] {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  // 去掉 WEBVTT 头
  const body = text.replace(/^WEBVTT[^\n]*\n+/i, '')
  // 复用 SRT 块逻辑，时间戳用点或逗号
  return parseSRT(body)
}

/**
 * 按扩展名解析字幕文件内容为条目。
 */
function parseSubtitleContent(
  content: string,
  formatHint?: 'srt' | 'vtt' | string
): SubtitleEntry[] {
  const hint = (formatHint || '').toLowerCase()
  if (hint === 'vtt' || content.trimStart().startsWith('WEBVTT')) {
    return parseVTT(content)
  }
  return parseSRT(content)
}

function normalizeSrtTimestamp(raw: string): string {
  const normalized = raw.trim().replace('.', ',')
  const match = normalized.match(/^(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})$/)
  if (!match) return normalized
  const hh = match[1].padStart(2, '0')
  const mm = match[2]
  const ss = match[3]
  const ms = match[4].padEnd(3, '0').slice(0, 3)
  return `${hh}:${mm}:${ss},${ms}`
}

/**
 * 计算两个时间点之间的持续时间
 */
function parseDuration(start: string, end: string): number {
  return parseTime(end) - parseTime(start)
}

/**
 * 合并相邻的短字幕
 */
function mergeShortSubtitles(
  subtitles: SubtitleEntry[],
  minDuration = 2, // 最小持续时间（秒）
  maxLength = 100 // 最大字符数
): SubtitleEntry[] {
  if (subtitles.length === 0) return []

  const merged: SubtitleEntry[] = []
  let current = { ...subtitles[0] }

  for (let i = 1; i < subtitles.length; i++) {
    const next = subtitles[i]
    const currentDuration = parseDuration(current.start, current.end)
    const gap = parseTime(next.start) - parseTime(current.end)

    // 如果当前字幕太短，且与下一个字幕间隔很小，且合并后不会太长
    if (
      currentDuration < minDuration &&
      gap < 1 && // 间隔小于1秒
      `${current.text} ${next.text}`.length <= maxLength
    ) {
      // 合并字幕
      current.end = next.end
      current.text = `${current.text} ${next.text}`
    } else {
      // 添加当前字幕，开始新的字幕
      merged.push(current)
      current = { ...next, index: merged.length + 1 }
    }
  }

  // 添加最后一个字幕
  merged.push(current)

  // 重新编号
  return merged.map((subtitle, index) => ({
    ...subtitle,
    index: index + 1,
  }))
}

/**
 * 分割过长的字幕
 */
function splitLongSubtitles(
  subtitles: SubtitleEntry[],
  maxLength = 80, // 最大字符数
  maxDuration = 5 // 最大持续时间（秒）
): SubtitleEntry[] {
  const result: SubtitleEntry[] = []

  for (const subtitle of subtitles) {
    const duration = parseDuration(subtitle.start, subtitle.end)

    if (subtitle.text.length <= maxLength && duration <= maxDuration) {
      result.push(subtitle)
      continue
    }

    // 需要分割
    const words = subtitle.text.split(' ')
    const chunks: string[] = []
    let currentChunk = ''

    for (const word of words) {
      if (`${currentChunk} ${word}`.length <= maxLength) {
        currentChunk = currentChunk ? `${currentChunk} ${word}` : word
      } else {
        if (currentChunk) {
          chunks.push(currentChunk)
          currentChunk = word
        } else {
          // 单个词就超长，强制分割
          chunks.push(word)
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk)
    }

    // 为每个分片分配时间
    const chunkDuration = duration / chunks.length
    const startTime = parseTime(subtitle.start)

    chunks.forEach((chunk, index) => {
      const chunkStart = startTime + index * chunkDuration
      const chunkEnd = startTime + (index + 1) * chunkDuration

      result.push({
        index: 0, // 稍后重新编号
        start: formatTime(chunkStart, 'srt'),
        end: formatTime(chunkEnd, 'srt'),
        text: chunk,
      })
    })
  }

  // 重新编号
  return result.map((subtitle, index) => ({
    ...subtitle,
    index: index + 1,
  }))
}

/**
 * 优化字幕时间轴，确保没有重叠
 */
function optimizeTimeline(subtitles: SubtitleEntry[]): SubtitleEntry[] {
  if (subtitles.length === 0) return []

  const optimized = [...subtitles]

  for (let i = 0; i < optimized.length - 1; i++) {
    const current = optimized[i]
    const next = optimized[i + 1]

    const currentEnd = parseTime(current.end)
    const nextStart = parseTime(next.start)

    // 如果有重叠，调整当前字幕的结束时间
    if (currentEnd > nextStart) {
      const gap = 0.1 // 保持100毫秒的间隔
      current.end = formatTime(nextStart - gap, 'srt')
    }
  }

  return optimized
}

/**
 * 检查时间格式是否有效
 */
function isValidTimeFormat(timeStr: string): boolean {
  const srtPattern = /^\d{2}:\d{2}:\d{2},\d{3}$/
  const vttPattern = /^\d{2}:\d{2}:\d{2}\.\d{3}$/

  return srtPattern.test(timeStr) || vttPattern.test(timeStr)
}

/**
 * 验证字幕格式
 */
function validateSubtitles(subtitles: SubtitleEntry[]): string[] {
  const errors: string[] = []

  for (let i = 0; i < subtitles.length; i++) {
    const subtitle = subtitles[i]

    // 检查时间格式
    if (!isValidTimeFormat(subtitle.start)) {
      errors.push(`字幕 ${subtitle.index}: 开始时间格式无效`)
    }

    if (!isValidTimeFormat(subtitle.end)) {
      errors.push(`字幕 ${subtitle.index}: 结束时间格式无效`)
    }

    // 检查时间逻辑
    if (parseTime(subtitle.start) >= parseTime(subtitle.end)) {
      errors.push(`字幕 ${subtitle.index}: 开始时间不能晚于或等于结束时间`)
    }

    // 检查文本内容
    if (!subtitle.text.trim()) {
      errors.push(`字幕 ${subtitle.index}: 文本内容为空`)
    }

    // 检查与下一个字幕的时间关系
    if (i < subtitles.length - 1) {
      const nextSubtitle = subtitles[i + 1]
      if (parseTime(subtitle.end) > parseTime(nextSubtitle.start)) {
        errors.push(`字幕 ${subtitle.index} 与 ${nextSubtitle.index} 时间重叠`)
      }
    }
  }

  return errors
}

export const SubtitleGenerator = {
  segmentsToSubtitles,
  formatTime,
  generateSRT,
  generateVTT,
  generateTXT,
  saveSubtitle,
  parseSRT,
  parseVTT,
  parseSubtitleContent,
  mergeShortSubtitles,
  splitLongSubtitles,
  optimizeTimeline,
  validateSubtitles,
  parseTime,
  parseDuration,
}
