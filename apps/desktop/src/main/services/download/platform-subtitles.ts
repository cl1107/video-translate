/**
 * 平台原生字幕：从 yt-dlp 下载产物中选取最合适的字幕轨。
 * 优先人工字幕、匹配源语言；无合适字幕时返回 null，由流水线回退 ASR。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { toLanguageCode } from '../../../shared/language'

/** 不应作为正文源的字幕轨 */
const SKIP_LANG_CODES = new Set([
  'live_chat',
  'live-chat',
  'danmaku',
  'cc_asr', // 个别站点噪声轨
])

/** 语言别名组：匹配源语 / 排除目标语时使用 */
const LANGUAGE_ALIAS_GROUPS: string[][] = [
  ['zh', 'zho', 'chi', 'cmn', 'yue', 'wuu', 'zh-cn', 'zh-tw', 'zh-hans', 'zh-hant'],
  ['en', 'eng', 'en-us', 'en-gb', 'en-orig'],
  ['ja', 'jpn', 'jp'],
  ['ko', 'kor', 'kr'],
  ['fr', 'fra', 'fre'],
  ['de', 'deu', 'ger'],
  ['es', 'spa'],
  ['pt', 'por', 'pt-br'],
  ['ru', 'rus'],
  ['it', 'ita'],
  ['ar', 'ara'],
  ['hi', 'hin'],
  ['th', 'tha'],
  ['vi', 'vie'],
]

export interface PlatformSubtitleCandidate {
  path: string
  /** 从文件名解析的语言码，如 en、zh-Hans */
  language: string
  /** 是否像自动字幕（文件名含 auto / a.xx 等启发） */
  likelyAuto: boolean
}

export interface SelectedPlatformSubtitle {
  path: string
  language: string
  likelyAuto: boolean
}

/**
 * yt-dlp --sub-langs 参数：优先源语，并带上常见语言与 all 兜底。
 */
export function buildYtDlpSubLangs(
  sourceLanguage?: string | null,
  targetLanguage?: string | null
): string {
  const source = toLanguageCode(sourceLanguage)
  const target = toLanguageCode(targetLanguage)
  const parts: string[] = []

  if (source && source !== 'auto') {
    const aliases = languageAliases(source)
    for (const code of aliases) {
      parts.push(`${code}.*`, code)
    }
  }

  // 常见源语（排除与目标语同组时可仍下载，选取阶段再过滤）
  const commons = ['en.*', 'zh.*', 'ja.*', 'ko.*', 'yue.*', 'es.*', 'fr.*', 'de.*']
  for (const c of commons) {
    if (!parts.includes(c)) parts.push(c)
  }

  // all 作为兜底；排除 live_chat
  parts.push('all')
  parts.push('-live_chat')

  // 若目标语明确，不必禁止下载（可能只有目标语字幕），选取时再偏好源语
  void target
  return parts.join(',')
}

/**
 * 扫描目录中的字幕文件（.srt / .vtt）。
 */
export async function listSubtitleCandidates(
  dir: string
): Promise<PlatformSubtitleCandidate[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }

  const candidates: PlatformSubtitleCandidate[] = []
  for (const name of entries) {
    if (!/\.(srt|vtt)$/i.test(name)) continue
    const full = path.join(dir, name)
    try {
      const stat = await fs.stat(full)
      if (!stat.isFile() || stat.size <= 0) continue
    } catch {
      continue
    }

    const language = parseLanguageFromSubtitleFilename(name)
    if (!language || SKIP_LANG_CODES.has(language.toLowerCase())) continue

    candidates.push({
      path: full,
      language,
      likelyAuto: isLikelyAutoSubtitle(name, language),
    })
  }

  return candidates
}

/**
 * 从 `video.en.srt` / `video.zh-Hans.vtt` / `video.en-orig.srt` 解析语言码。
 */
export function parseLanguageFromSubtitleFilename(filename: string): string | null {
  const base = path.basename(filename)
  // 去掉扩展名后，取最后一个「像语言码」的点分段
  // 例: Title_id.en.srt → en；Title.zh-Hans.srt → zh-Hans
  const withoutExt = base.replace(/\.(srt|vtt)$/i, '')
  const parts = withoutExt.split('.')
  if (parts.length < 2) return null

  // 从右往左找语言段（可能是 en / zh-Hans / a-en）
  for (let i = parts.length - 1; i >= 1; i--) {
    const part = parts[i]
    if (!part) continue
    if (/^(live_chat|live-chat|danmaku)$/i.test(part)) return part.toLowerCase()
    // yt-dlp 自动字幕偶发 a-en / en-orig
    if (/^[a-z]{1,3}(-[a-z0-9]+)*$/i.test(part) || /^a-[a-z]{2,3}/i.test(part)) {
      return part
    }
  }
  return null
}

export function isLikelyAutoSubtitle(filename: string, language: string): boolean {
  const lower = filename.toLowerCase()
  const lang = language.toLowerCase()
  return (
    lower.includes('.auto.') ||
    lower.includes('_auto.') ||
    lang.startsWith('a-') ||
    lang.includes('auto') ||
    /-orig$/i.test(lang)
  )
}

/**
 * 选取最佳平台字幕：源语匹配 > 非目标语 > 人工优先于自动。
 */
export function selectBestPlatformSubtitle(
  candidates: PlatformSubtitleCandidate[],
  options: {
    sourceLanguage?: string | null
    targetLanguage?: string | null
  }
): SelectedPlatformSubtitle | null {
  if (candidates.length === 0) return null

  const source = toLanguageCode(options.sourceLanguage)
  const target = toLanguageCode(options.targetLanguage)
  const sourceAliases = source && source !== 'auto' ? languageAliases(source) : []
  const targetAliases =
    target && target !== 'auto' ? languageAliases(target) : []

  const scored = candidates.map(c => {
    const lang = normalizeLang(c.language)
    let score = 0

    // 源语精确/别名匹配
    if (sourceAliases.length > 0) {
      if (sourceAliases.includes(lang) || sourceAliases.some(a => lang.startsWith(`${a}-`))) {
        score += 100
      } else if (sourceAliases.some(a => lang.startsWith(a))) {
        score += 80
      }
    }

    // 目标语轨降权（优先「原文」轨，避免用已译字幕再译）
    if (
      targetAliases.length > 0 &&
      (targetAliases.includes(lang) ||
        targetAliases.some(a => lang.startsWith(`${a}-`) || lang.startsWith(a)))
    ) {
      score -= 40
    }

    // 人工字幕优先
    if (!c.likelyAuto) score += 25
    else score += 5

    // 常见通用语小幅加分（auto 源语时）
    if (source === 'auto' || !source) {
      if (['en', 'eng'].some(a => lang === a || lang.startsWith(`${a}-`))) score += 10
      if (['zh', 'ja', 'ko'].some(a => lang === a || lang.startsWith(`${a}-`))) score += 8
    }

    return { candidate: c, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  // 只要有候选就返回最高分者（即便只有目标语轨，也强于无字幕）
  if (!best) return null

  return {
    path: best.candidate.path,
    language: best.candidate.language,
    likelyAuto: best.candidate.likelyAuto,
  }
}

/**
 * 扫描目录并选取最佳字幕。
 */
export async function findBestPlatformSubtitle(
  dir: string,
  options: {
    sourceLanguage?: string | null
    targetLanguage?: string | null
  }
): Promise<SelectedPlatformSubtitle | null> {
  const candidates = await listSubtitleCandidates(dir)
  return selectBestPlatformSubtitle(candidates, options)
}

function languageAliases(code: string): string[] {
  const normalized = normalizeLang(code)
  for (const group of LANGUAGE_ALIAS_GROUPS) {
    if (group.some(g => g === normalized || normalized.startsWith(`${g}-`))) {
      return group
    }
  }
  return [normalized]
}

function normalizeLang(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, '-')
}
