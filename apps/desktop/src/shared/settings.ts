import {
  DEFAULT_ASR_ENGINE,
  DEFAULT_OLLAMA_MODEL,
  type AsrEngineId,
} from './constants'

export type SubtitleBurnMode = 'bilingual' | 'translated' | 'original'

/** 硬字幕 / ASS 默认色：原文白、译文黄（与历史 ASS 硬编码一致） */
export const DEFAULT_ORIGINAL_SUBTITLE_COLOR = '#FFFFFF'
export const DEFAULT_TRANSLATED_SUBTITLE_COLOR = '#FFFF00'

export interface AppSettings {
  asrEngine: AsrEngineId
  ollamaModel: string
  sourceLanguage: string
  targetLanguage: string
  outputFormat: 'srt' | 'vtt' | 'txt'
  burnSubtitles: boolean
  /** 烧录内容：双语堆叠 / 仅译文 / 仅原文 */
  burnSubtitleMode: SubtitleBurnMode
  /** 识别结果先经大模型润色再翻译 */
  polishTranscript: boolean
  /** 原文字幕颜色（#RRGGBB），用于 ASS / 硬字幕烧录 */
  originalSubtitleColor: string
  /** 译文字幕颜色（#RRGGBB），用于 ASS / 硬字幕烧录 */
  translatedSubtitleColor: string
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  asrEngine: DEFAULT_ASR_ENGINE,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  outputFormat: 'srt',
  burnSubtitles: false,
  burnSubtitleMode: 'bilingual',
  polishTranscript: true,
  originalSubtitleColor: DEFAULT_ORIGINAL_SUBTITLE_COLOR,
  translatedSubtitleColor: DEFAULT_TRANSLATED_SUBTITLE_COLOR,
}

function normalizeBurnSubtitleMode(value?: string | null): SubtitleBurnMode {
  if (value === 'translated' || value === 'original' || value === 'bilingual') {
    return value
  }
  return DEFAULT_APP_SETTINGS.burnSubtitleMode
}

/**
 * 规范化为 #RRGGBB（大写）。支持 #RGB / #RRGGBB；非法值回退默认。
 */
export function normalizeHexColor(
  value?: string | null,
  fallback = DEFAULT_ORIGINAL_SUBTITLE_COLOR
): string {
  if (!value || typeof value !== 'string') return fallback
  const trimmed = value.trim()
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (full) return `#${full[1]}`.toUpperCase()
  return fallback
}

/**
 * #RRGGBB → ASS 内联色 `&HBBGGRR&`（用于 \1c 等 override）。
 */
export function hexToAssBgr(hex: string): string {
  const normalized = normalizeHexColor(hex)
  const rr = normalized.slice(1, 3)
  const gg = normalized.slice(3, 5)
  const bb = normalized.slice(5, 7)
  return `&H${bb}${gg}${rr}&`
}

/**
 * #RRGGBB → ASS Style PrimaryColour `&HAABBGGRR`（AA=00 不透明）。
 */
export function hexToAssPrimaryColour(hex: string): string {
  const normalized = normalizeHexColor(hex)
  const rr = normalized.slice(1, 3)
  const gg = normalized.slice(3, 5)
  const bb = normalized.slice(5, 7)
  return `&H00${bb}${gg}${rr}`
}

export function normalizeOllamaModel(name?: string | null): string {
  const trimmed = (name ?? '').trim()
  return trimmed || DEFAULT_OLLAMA_MODEL
}

export function normalizeAsrEngine(value?: string | null): AsrEngineId {
  if (value === 'funasr-nano' || value === 'sensevoice') return value
  return DEFAULT_ASR_ENGINE
}

/**
 * 合并并清洗 localStorage / 上传用的设置，保证有合法默认值。
 */
export function normalizeAppSettings(
  raw?: Partial<AppSettings> | null
): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APP_SETTINGS }
  }

  const asrEngine = normalizeAsrEngine(raw.asrEngine)

  return {
    asrEngine,
    ollamaModel: normalizeOllamaModel(raw.ollamaModel),
    sourceLanguage: raw.sourceLanguage || DEFAULT_APP_SETTINGS.sourceLanguage,
    targetLanguage: raw.targetLanguage || DEFAULT_APP_SETTINGS.targetLanguage,
    outputFormat: raw.outputFormat || DEFAULT_APP_SETTINGS.outputFormat,
    burnSubtitles: Boolean(raw.burnSubtitles),
    burnSubtitleMode: normalizeBurnSubtitleMode(raw.burnSubtitleMode),
    polishTranscript:
      raw.polishTranscript === undefined
        ? DEFAULT_APP_SETTINGS.polishTranscript
        : Boolean(raw.polishTranscript),
    originalSubtitleColor: normalizeHexColor(
      raw.originalSubtitleColor,
      DEFAULT_ORIGINAL_SUBTITLE_COLOR
    ),
    translatedSubtitleColor: normalizeHexColor(
      raw.translatedSubtitleColor,
      DEFAULT_TRANSLATED_SUBTITLE_COLOR
    ),
  }
}

/** 语言代码 → 翻译提示用自然语言名 */
export function languageDisplayName(code: string): string {
  const map: Record<string, string> = {
    auto: '自动检测',
    zh: '中文',
    'zh-cn': '中文',
    'zh-tw': '繁体中文',
    en: '英语',
    ja: '日语',
    ko: '韩语',
    yue: '粤语',
    es: '西班牙语',
    fr: '法语',
    de: '德语',
    it: '意大利语',
    pt: '葡萄牙语',
    ru: '俄语',
    中文: '中文',
    English: '英语',
    Japanese: '日语',
    Chinese: '中文',
  }
  return map[code] || map[code.toLowerCase()] || code
}
