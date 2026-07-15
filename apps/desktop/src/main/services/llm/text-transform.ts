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

export interface TranslateBatchOptions extends BatchTransformOptions {
  sourceLanguage: string
  targetLanguage: string
  client: TextCompletionPort
}

function buildTranslateSystemPrompt(
  sourceLanguage: string,
  targetLanguage: string
): string {
  const src = languageDisplayName(sourceLanguage)
  const tgt = languageDisplayName(targetLanguage)
  return `你是专业字幕翻译。把用户给出的文本从${src}翻译成${tgt}。只输出译文，不要解释，不要原文，不要引号。`
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

/**
 * 逐段翻译；任一段失败终止整批。支持 AbortSignal。
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

    try {
      const response = await options.client.complete({
        system,
        user: buildTranslateUserPrompt(
          trimmed,
          options.sourceLanguage,
          options.targetLanguage
        ),
        temperature: 0.1,
        maxTokens: 2000,
      })
      const translated = cleanModelText(response, 'translation')
      if (!translated) {
        throw new Error('翻译结果为空')
      }
      results.push(translated)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `translateBatch segment ${i + 1}/${texts.length} failed: ${message}`
      )
    }

    options.onProgress?.(i + 1, texts.length)
  }

  return results
}

export { cleanModelText, isPunctuationOnly }
