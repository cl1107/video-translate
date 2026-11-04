/**
 * 深层文本变换模块：翻译批处理走 Completion 接缝。
 * 润色见 polish-service（同一 TextCompletionPort）。
 */
import {
  languageDisplayName,
  normalizeGlossary,
  type GlossaryEntry,
} from '../../../shared/settings'
import {
  type BatchTransformOptions,
  cleanModelText,
  isPunctuationOnly,
  type TextCompletionPort,
  throwIfAborted,
} from './completion-port'

/** 空结果/瞬时失败时的默认重试次数（含首次） */
export const DEFAULT_TRANSLATE_MAX_ATTEMPTS = 2

export interface TranslateSegmentIssue {
  index: number
  total: number
  source: string
  reason: string
  /** retry = 将再试；fallback = 已回退原文；error = 硬错误将终止批次 */
  action: 'retry' | 'fallback' | 'error'
  attempt: number
  maxAttempts: number
}

export interface TranslateSegmentResult {
  /** 当前批次中的 0-based 段索引，便于断点代理直接落库。 */
  index: number
  total: number
  source: string
  translated: string
  translationStatus: 'translated' | 'fallback'
}

export interface TranslateBatchOptions extends BatchTransformOptions {
  sourceLanguage: string
  targetLanguage: string
  client: TextCompletionPort
  /** 单段最大尝试次数，默认 2 */
  maxAttempts?: number
  /** 单段重试 / 回退 / 终止时的观测回调 */
  onSegmentIssue?: (issue: TranslateSegmentIssue) => void
  /** 翻译时采用的术语对照表。 */
  glossary?: GlossaryEntry[]
  /** 批次外的前文/后文，数组末尾/开头分别视为最近上下文。 */
  contextBefore?: string[]
  contextAfter?: string[]
  /** 每段使用的前后文数量，默认各 1 段。 */
  contextRadius?: number
  /** 与texts等长的完整原文；续跑时空占位仍可作为相邻段上下文。 */
  contextTexts?: string[]
  /** 一段完成后调用；支持异步落盘，index 为 0-based。 */
  onSegmentComplete?: (result: TranslateSegmentResult) => void | Promise<void>
}

export const TRANSLATE_CONTEXT_RADIUS = 1

function buildTranslateSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string,
  glossary: GlossaryEntry[]
): string {
  const src = languageDisplayName(sourceLanguage)
  const tgt = languageDisplayName(targetLanguage)
  const glossaryRule = glossary.length
    ? '术语表中的源词出现时，必须优先使用对应的指定译法。'
    : ''
  return `你是专业字幕翻译。把用户给出的文本从${src}翻译成${tgt}。只输出译文，不要解释，不要原文，不要引号。若原文无需翻译（代码、专有名词、已是目标语言），原样输出原文。${glossaryRule}`
}

function buildTranslateUserPrompt(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  glossary: GlossaryEntry[],
  previous: string[],
  following: string[]
): string {
  const src = languageDisplayName(sourceLanguage)
  const tgt = languageDisplayName(targetLanguage)
  const parts = [`源语言：${src}`, `目标语言：${tgt}`]
  if (glossary.length) {
    parts.push(
      `术语表（源词 → 指定译法）：\n${glossary
        .map(entry => `${entry.source} → ${entry.target}`)
        .join('\n')}`
    )
  }
  if (previous.length) {
    parts.push(`前文参考（只读，不要翻译输出）：\n${previous.join('\n')}`)
  }
  parts.push(`待翻译原文：\n${text}`)
  if (following.length) {
    parts.push(`后文参考（只读，不要翻译输出）：\n${following.join('\n')}`)
  }
  parts.push('译文：')
  return parts.join('\n\n')
}

function previewSource(text: string, max = 80): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

function isEmptyTranslationError(error: unknown): boolean {
  return error instanceof Error && error.message === '翻译结果为空'
}

/**
 * 逐段翻译。
 * - 空结果：重试后仍空则回退原文，不中断整批
 * - 服务/模型错误：重试后仍失败则终止整批并报告段落位置
 * - 支持 AbortSignal
 */
export async function translateTextBatch(
  texts: string[],
  options: TranslateBatchOptions
): Promise<string[]> {
  const results: string[] = []
  const glossary = normalizeGlossary(options.glossary)
  const contextRadius = Math.max(
    0,
    options.contextRadius ?? TRANSLATE_CONTEXT_RADIUS
  )
  const system = buildTranslateSystemPrompt(
    options.sourceLanguage,
    options.targetLanguage,
    glossary
  )
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_TRANSLATE_MAX_ATTEMPTS
  )

  for (let i = 0; i < texts.length; i++) {
    throwIfAborted(options.signal)
    const trimmed = (texts[i] ?? '').trim()
    if (!trimmed) {
      results.push('')
      await options.onSegmentComplete?.({
        index: i,
        total: texts.length,
        source: '',
        translated: '',
        translationStatus: 'translated',
      })
      options.onProgress?.(i + 1, texts.length)
      continue
    }
    if (isPunctuationOnly(trimmed)) {
      results.push(trimmed)
      await options.onSegmentComplete?.({
        index: i,
        total: texts.length,
        source: trimmed,
        translated: trimmed,
        translationStatus: 'translated',
      })
      options.onProgress?.(i + 1, texts.length)
      continue
    }

    const previous = [
      ...(options.contextBefore ?? []).map(text => text.trim()),
      ...(options.contextTexts ?? texts)
        .slice(Math.max(0, i - contextRadius), i)
        .map(text => text.trim()),
    ]
      .filter(Boolean)
      .slice(-contextRadius)
    const following = [
      ...(options.contextTexts ?? texts)
        .slice(i + 1, i + 1 + contextRadius)
        .map(text => text.trim()),
      ...(options.contextAfter ?? []).map(text => text.trim()),
    ]
      .filter(Boolean)
      .slice(0, contextRadius)
    const translated = await translateOneSegment(trimmed, {
      index: i,
      total: texts.length,
      system,
      maxAttempts,
      options,
      glossary,
      previous,
      following,
    })
    results.push(translated.translated)
    await options.onSegmentComplete?.({
      index: i,
      total: texts.length,
      source: trimmed,
      translated: translated.translated,
      translationStatus: translated.translationStatus,
    })
    options.onProgress?.(i + 1, texts.length)
  }

  return results
}

async function translateOneSegment(
  source: string,
  args: {
    index: number
    total: number
    system: string
    maxAttempts: number
    options: TranslateBatchOptions
    glossary: GlossaryEntry[]
    previous: string[]
    following: string[]
  }
): Promise<Pick<TranslateSegmentResult, 'translated' | 'translationStatus'>> {
  const {
    index,
    total,
    system,
    maxAttempts,
    options,
    glossary,
    previous,
    following,
  } = args
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(options.signal)
    try {
      const response = await options.client.complete({
        system,
        user: buildTranslateUserPrompt(
          source,
          options.sourceLanguage,
          options.targetLanguage,
          glossary,
          previous,
          following
        ),
        temperature: 0.1,
        maxTokens: 2000,
      })
      const translated = cleanModelText(response, 'translation')
      if (translated) {
        return { translated, translationStatus: 'translated' }
      }
      lastError = new Error('翻译结果为空')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      lastError = error instanceof Error ? error : new Error(String(error))
    }

    const willRetry = attempt < maxAttempts
    if (willRetry) {
      options.onSegmentIssue?.({
        index: index + 1,
        total,
        source: previewSource(source),
        reason: lastError?.message ?? '未知错误',
        action: 'retry',
        attempt,
        maxAttempts,
      })
      continue
    }

    // 最后一次仍为空：回退原文，任务继续
    if (lastError && isEmptyTranslationError(lastError)) {
      options.onSegmentIssue?.({
        index: index + 1,
        total,
        source: previewSource(source),
        reason: lastError.message,
        action: 'fallback',
        attempt,
        maxAttempts,
      })
      return { translated: source, translationStatus: 'fallback' }
    }

    // 硬错误：终止整批
    const message = lastError?.message ?? '未知错误'
    options.onSegmentIssue?.({
      index: index + 1,
      total,
      source: previewSource(source),
      reason: message,
      action: 'error',
      attempt,
      maxAttempts,
    })
    throw new Error(
      `translateBatch segment ${index + 1}/${total} failed: ${message}`
    )
  }

  // 理论上不可达；防御性回退
  return { translated: source, translationStatus: 'fallback' }
}

export { cleanModelText, isPunctuationOnly }
