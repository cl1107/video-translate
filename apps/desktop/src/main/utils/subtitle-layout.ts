/**
 * 字幕显示布局：按显示宽度换行、横竖屏自适应字号/边距。
 * 换行只插入布局断点，不增删字符。
 */

export interface VideoDisplaySize {
  width: number
  height: number
}

export interface SubtitleLayout {
  playResX: number
  playResY: number
  sourceFontSize: number
  targetFontSize: number
  bottomMargin: number
  marginX: number
  sourceColumns: number
  targetColumns: number
  positionX: number
  positionY: number
  portrait: boolean
}

export type SubtitleBurnMode = 'bilingual' | 'translated' | 'original'

/** 横屏 16:9 参考：原文 42 / 译文 46 对应约 68 / 62 半角列 */
const ASS_PLAY_RES_Y = 1080
const ASS_MARGIN_X = 80
const LANDSCAPE_SOURCE_FONT = 42
const LANDSCAPE_TARGET_FONT = 46
const LANDSCAPE_BOTTOM_MARGIN = 50
const PORTRAIT_SOURCE_FONT = 36
const PORTRAIT_TARGET_FONT = 40
const PORTRAIT_BOTTOM_MARGIN = 120
const SOURCE_WRAP_COLUMNS = 68
const TARGET_WRAP_COLUMNS = 62
const DEFAULT_SIZE: VideoDisplaySize = { width: 1920, height: 1080 }

/**
 * 单个字形簇的显示宽度（半角=1，全角/CJK=2）。
 */
function clusterWidth(cluster: string): number {
  if (cluster === '\t') return 4
  if (cluster === '\n') return 0

  const widths: number[] = []
  for (const character of cluster) {
    if (character === '\u200d' || /[\u0300-\u036f]/.test(character)) continue
    const code = character.codePointAt(0) ?? 0
    // 组合标记 / 格式控制
    if (
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0xfe00 && code <= 0xfe0f)
    ) {
      continue
    }
    // East Asian Wide / Fullwidth 近似：CJK、全角标点、emoji 区间
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    widths.push(isWide ? 2 : 1)
  }
  return widths.length === 0 ? 0 : widths.reduce((a, b) => a + b, 0)
}

/**
 * 将文本拆成可断行的簇序列（按码点，尽量保留 ZWJ 序列）。
 */
function clusterSpans(
  text: string
): Array<{ start: number; end: number; cluster: string }> {
  const spans: Array<{ start: number; end: number; cluster: string }> = []
  let index = 0
  while (index < text.length) {
    const code = text.codePointAt(index)
    if (code === undefined) break
    const size = code > 0xffff ? 2 : 1
    let end = index + size
    // 吞掉后续组合标记
    while (end < text.length) {
      const next = text.codePointAt(end)
      if (next === undefined) break
      if (
        (next >= 0x0300 && next <= 0x036f) ||
        next === 0x200d ||
        (next >= 0xfe00 && next <= 0xfe0f)
      ) {
        end += next > 0xffff ? 2 : 1
        continue
      }
      break
    }
    spans.push({ start: index, end, cluster: text.slice(index, end) })
    index = end
  }
  return spans
}

export function displayWidth(text: string): number {
  return clusterSpans(text).reduce(
    (sum, item) => sum + clusterWidth(item.cluster),
    0
  )
}

function wrapSingleLineExact(text: string, maxColumns: number): string[] {
  if (!text) return ['']
  if (maxColumns < 1) {
    throw new Error('maxColumns must be positive')
  }

  const clusters = clusterSpans(text)
  const pieces: string[] = []
  let startCluster = 0

  while (startCluster < clusters.length) {
    let width = 0
    let index = startCluster
    let lastSpaceBoundary: number | null = null

    while (index < clusters.length) {
      const cluster = clusters[index].cluster
      const nextWidth = clusterWidth(cluster)
      if (index > startCluster && width + nextWidth > maxColumns) {
        break
      }
      width += nextWidth
      index += 1
      if (/\s/u.test(cluster)) {
        lastSpaceBoundary = index
      }
      if (width > maxColumns && index === startCluster + 1) {
        break
      }
    }

    if (index >= clusters.length) {
      pieces.push(text.slice(clusters[startCluster].start))
      break
    }

    const cutCluster =
      lastSpaceBoundary !== null && lastSpaceBoundary > startCluster
        ? lastSpaceBoundary
        : index
    const cutEnd = clusters[cutCluster - 1].end
    pieces.push(text.slice(clusters[startCluster].start, cutEnd))
    startCluster = cutCluster
  }

  return pieces.length > 0 ? pieces : ['']
}

/**
 * 按显示列宽切行；`chunks.join('') === text`。
 */
export function wrapLayoutChunks(text: string, maxColumns: number): string[] {
  if (maxColumns < 1) {
    throw new Error('maxColumns must be positive')
  }

  const chunks = ['']
  let cursor = 0
  while (cursor <= text.length) {
    const newline = text.indexOf('\n', cursor)
    const atEnd = newline < 0
    const content = atEnd ? text.slice(cursor) : text.slice(cursor, newline)
    const delimiter = atEnd ? '' : '\n'
    const pieces = wrapSingleLineExact(content, maxColumns)
    chunks[chunks.length - 1] += pieces[0]
    chunks.push(...pieces.slice(1))
    chunks[chunks.length - 1] += delimiter
    if (atEnd) break
    cursor = newline + 1
  }

  const joined = chunks.join('')
  if (joined !== text) {
    throw new Error('layout wrapping changed source text')
  }
  return chunks
}

export function wrapForDisplay(text: string, maxColumns: number): string {
  return wrapLayoutChunks(text, maxColumns).join('\n')
}

export function resolveVideoDisplaySize(
  size?: Partial<VideoDisplaySize> | null
): VideoDisplaySize {
  const width = size?.width
  const height = size?.height
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  return { ...DEFAULT_SIZE }
}

/**
 * 由视频宽高推导 ASS PlayRes 与换行列宽。
 */
export function computeSubtitleLayout(
  size?: Partial<VideoDisplaySize> | null
): SubtitleLayout {
  const { width, height } = resolveVideoDisplaySize(size)
  const playResY = ASS_PLAY_RES_Y
  const playResX = Math.max(320, Math.round((playResY * width) / height))
  const portrait = width < height
  const sourceFontSize = portrait ? PORTRAIT_SOURCE_FONT : LANDSCAPE_SOURCE_FONT
  const targetFontSize = portrait ? PORTRAIT_TARGET_FONT : LANDSCAPE_TARGET_FONT
  const bottomMargin = portrait
    ? PORTRAIT_BOTTOM_MARGIN
    : LANDSCAPE_BOTTOM_MARGIN
  const available = Math.max(160, playResX - 2 * ASS_MARGIN_X)

  return {
    playResX,
    playResY,
    sourceFontSize,
    targetFontSize,
    bottomMargin,
    marginX: ASS_MARGIN_X,
    sourceColumns: Math.max(
      12,
      Math.min(
        SOURCE_WRAP_COLUMNS,
        Math.floor((2 * available) / sourceFontSize)
      )
    ),
    targetColumns: Math.max(
      8,
      Math.min(
        TARGET_WRAP_COLUMNS,
        Math.floor((2 * available) / targetFontSize)
      )
    ),
    positionX: Math.floor(playResX / 2),
    positionY: playResY - bottomMargin,
    portrait,
  }
}

export function escapeAssText(text: string): string {
  // 反斜杠后加 WORD JOINER，避免 \N 等被当 ASS 命令；换行用 \N
  const wordJoiner = '\u2060'
  let output = ''
  for (const character of text) {
    if (character === '\\') {
      output += `\\${wordJoiner}`
    } else if (character === '{') {
      output += '\\{{}'
    } else if (character === '\n') {
      output += '\\N'
    } else {
      output += character
    }
  }
  return output
}

export function formatAssTimestamp(seconds: number, end = false): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000 + (end ? 0 : 0)))
  const adjusted = end ? Math.max(totalMs, 10) : totalMs
  const hours = Math.floor(adjusted / 3_600_000)
  const minutes = Math.floor((adjusted % 3_600_000) / 60_000)
  const secs = Math.floor((adjusted % 60_000) / 1000)
  const cs = Math.floor((adjusted % 1000) / 10)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export {
  ASS_MARGIN_X,
  ASS_PLAY_RES_Y,
  SOURCE_WRAP_COLUMNS,
  TARGET_WRAP_COLUMNS,
}
