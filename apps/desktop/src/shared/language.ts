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
