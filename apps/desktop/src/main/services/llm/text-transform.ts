/**
 * 深层文本变换模块：翻译批处理走 Completion 接缝。
 * 润色见 polish-service（同一 TextCompletionPort）。
 */
import { languageDisplayName } from '../../../shared/settings'
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

export interface TranslateBatchOptions extends BatchTransformOptions {
  sourceLanguage: string
  targetLanguage: string
  client: TextCompletionPort
  /** 单段最大尝试次数，默认 2 */
  maxAttempts?: number
  /** 单段重试 / 回退 / 终止时的观测回调 */
  onSegmentIssue?: (issue: TranslateSegmentIssue) => void
}

function buildTranslateSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string
): string {
  const src = languageDisplayName(sourceLanguage)
  const tgt = languageDisplayName(targetLanguage)
  return `你是专业字幕翻译。把用户给出的文本从${src}翻译成${tgt}。只输出译文，不要解释，不要原文，不要引号。若原文无需翻译（代码、专有名词、已是目标语言），原样输出原文。`
}

function buildTranslateUserPrompt(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): string {
  const src = languageDisplayName(sourceLanguage)
  const tgt = languageDisplayName(targetLanguage)
  return [
    `源语言：${src}`,
    `目标语言：${tgt}`,
    `待翻译原文：\n${text}`,
    '译文：',
  ].join('\n\n')
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
  const system = buildTranslateSystemPrompt(
    options.sourceLanguage,
    options.targetLanguage
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
      options.onProgress?.(i + 1, texts.length)
      continue
    }
    if (isPunctuationOnly(trimmed)) {
      results.push(trimmed)
      options.onProgress?.(i + 1, texts.length)
      continue
    }

    const translated = await translateOneSegment(trimmed, {
      index: i,
      total: texts.length,
      system,
      maxAttempts,
      options,
    })
    results.push(translated)
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
  }
): Promise<string> {
  const { index, total, system, maxAttempts, options } = args
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(options.signal)
    try {
      const response = await options.client.complete({
        system,
        user: buildTranslateUserPrompt(
          source,
          options.sourceLanguage,
          options.targetLanguage
        ),
        temperature: 0.1,
        maxTokens: 2000,
      })
      const translated = cleanModelText(response, 'translation')
      if (translated) {
        return translated
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
      return source
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
  return source
}

export { cleanModelText, isPunctuationOnly }
