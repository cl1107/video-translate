/**
 * 在线视频链接的校验、规范化与脱敏。
 *
 * - 校验：只接受 http(s)，不接受空链接、控制字符、以 `-` 开头的参数式输入
 *   以及带用户名 / 密码的链接。
 * - 规范化：去掉片段与常见跟踪参数，保留标识内容所需参数；存库与重试都用
 *   规范化后的链接，避免把分享来源、会话 id 一类的参数写进任务记录。
 * - 脱敏：日志与报错里只出现 origin + path，不带 query / hash。
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 明确无内容含义的跟踪参数（精确匹配，大小写不敏感）。 */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'si',
  'feature',
  'ref',
  'ref_src',
  'ref_url',
  'spm',
  'spm_id_from',
  'vd_source',
  'from_source',
  'from_spmid',
  'share_source',
  'share_medium',
  'share_plat',
  'share_session_id',
  'share_tag',
  'share_times',
  'unique_k',
  'bbid',
  'buvid',
  'seid',
  'sessionid',
  'up_id',
  'is_story_h5',
  '_hsenc',
  '_hsmi',
  'yclid',
  'trk',
  'ts',
])

/** 前缀匹配的跟踪参数（utm_*、spm_* 等）。 */
const TRACKING_PREFIXES = ['utm_', 'spm_', 'vd_', 'share_', 'from_']

export class VideoLinkError extends Error {
  readonly code = 'INVALID_LINK'

  constructor(message: string) {
    super(message)
    this.name = 'VideoLinkError'
  }
}

export interface CheckedVideoLink {
  /** 用户原样输入（已去首尾空白），仅在内存中使用。 */
  raw: string
  /** 规范化后的链接：存库、写日志、重试都用它。 */
  canonical: string
  host: string
}

/** 校验并规范化用户粘贴的视频链接。 */
export function checkVideoLink(input: string): CheckedVideoLink {
  const raw = input.trim()
  if (!raw) throw new VideoLinkError('请输入视频链接')
  if (CONTROL_CHARS.test(raw)) {
    throw new VideoLinkError('链接包含非法控制字符')
  }
  // yt-dlp 的参数位置放在 `--` 之后；这里再拒绝一次，避免其它调用方漏掉 `--`。
  if (raw.startsWith('-')) {
    throw new VideoLinkError('链接不能以 - 开头')
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new VideoLinkError('链接格式无效，请使用完整的 http(s) 地址')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new VideoLinkError('仅支持 http:// 或 https:// 链接')
  }
  if (!parsed.hostname) {
    throw new VideoLinkError('链接缺少主机名')
  }
  if (parsed.username || parsed.password) {
    throw new VideoLinkError('链接不能包含用户名或密码')
  }

  return {
    raw,
    canonical: canonicalizeUrl(parsed),
    host: parsed.hostname.toLowerCase(),
  }
}

/** 去掉片段与跟踪参数后的链接。 */
export function canonicalizeUrl(input: URL | string): string {
  const url = typeof input === 'string' ? new URL(input) : new URL(input.href)
  url.username = ''
  url.password = ''
  url.hash = ''

  const kept: Array<[string, string]> = []
  for (const [key, value] of url.searchParams.entries()) {
    if (isTrackingParam(key)) continue
    kept.push([key, value])
  }
  url.search = ''
  for (const [key, value] of kept) {
    url.searchParams.append(key, value)
  }
  return url.toString()
}

/** 日志用链接：只保留 origin + path，隐藏 query / hash。 */
export function redactUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '<redacted-url>'
    }
    return `${url.origin}${url.pathname}`
  } catch {
    return '<redacted-url>'
  }
}

/** 把一段文本里的每个 http(s) 链接都换成脱敏写法。 */
export function redactUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s'"<>]+/gi, match => redactUrl(match))
}

function isTrackingParam(key: string): boolean {
  const normalized = key.toLowerCase()
  if (TRACKING_PARAMS.has(normalized)) return true
  return TRACKING_PREFIXES.some(prefix => normalized.startsWith(prefix))
}
