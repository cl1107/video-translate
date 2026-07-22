/**
 * 统一语言码映射：UI 展示名 / 代码 → ASR 与路径后缀用的短码。
 * 避免 TaskManager / sherpa / settings 三套 map。
 */

const LANGUAGE_CODE_MAP: Record<string, string> = {
  auto: 'auto',
  en: 'en',
  English: 'en',
  english: 'en',
  zh: 'zh',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  Chinese: 'zh',
  chinese: 'zh',
  中文: 'zh',
  ja: 'ja',
  Japanese: 'ja',
  japanese: 'ja',
  日本語: 'ja',
  日语: 'ja',
  ko: 'ko',
  Korean: 'ko',
  korean: 'ko',
  한국어: 'ko',
  韩语: 'ko',
  yue: 'yue',
  Cantonese: 'yue',
  cantonese: 'yue',
  粤语: 'yue',
  es: 'es',
  Spanish: 'es',
  fr: 'fr',
  French: 'fr',
  de: 'de',
  German: 'de',
  it: 'it',
  Italian: 'it',
  pt: 'pt',
  Portuguese: 'pt',
  ru: 'ru',
  Russian: 'ru',
  ar: 'ar',
  Arabic: 'ar',
  hi: 'hi',
  Hindi: 'hi',
  th: 'th',
  Thai: 'th',
  vi: 'vi',
  Vietnamese: 'vi',
}

/** 解析为短语言码（ASR / 文件后缀） */
export function toLanguageCode(language: string | undefined | null): string {
  if (!language) return 'auto'
  const trimmed = language.trim()
  if (!trimmed) return 'auto'
  return (
    LANGUAGE_CODE_MAP[trimmed] ||
    LANGUAGE_CODE_MAP[trimmed.toLowerCase()] ||
    trimmed
  )
}

/** 字幕文件名后缀 */
export function toLanguageSuffix(language: string | undefined | null): string {
  const code = toLanguageCode(language)
  return code === 'auto' ? 'auto' : code
}

export type DetectedLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'yue'

const DETECTED_LANGUAGE_CODES = new Set<DetectedLanguage>([
  'zh',
  'en',
  'ja',
  'ko',
  'yue',
])

/** 将 SenseVoice / 平台字幕语言标记规范化为支持的检测语言。 */
export function normalizeDetectedLanguage(
  language: string | undefined | null
): DetectedLanguage | undefined {
  if (!language?.trim()) return undefined

  const tagged = [...language.matchAll(/<\|([^|>]+)\|>/g)].map(
    match => match[1]
  )
  const candidates = [...tagged, language]

  for (const candidate of candidates) {
    const code = toLanguageCode(candidate).toLowerCase().replaceAll('_', '-')
    const base = code.split('-')[0] as DetectedLanguage
    if (DETECTED_LANGUAGE_CODES.has(base)) return base
  }

  return undefined
}
export interface SubtitleLanguageSuffixes {
  sourceSuffix: string
  targetSuffix: string
}

/** 生成原文/译文后缀；同语言时保证两个文件名不会冲突。 */
export function resolveSubtitleLanguageSuffixes(
  sourceLanguage: string | undefined | null,
  targetLanguage: string | undefined | null
): SubtitleLanguageSuffixes {
  const sourceSuffix = toLanguageSuffix(sourceLanguage)
  const targetSuffix = toLanguageSuffix(targetLanguage)

  if (sourceSuffix === targetSuffix) {
    return {
      sourceSuffix: `${sourceSuffix}_source`,
      targetSuffix: `${targetSuffix}_translated`,
    }
  }

  return { sourceSuffix, targetSuffix }
}
