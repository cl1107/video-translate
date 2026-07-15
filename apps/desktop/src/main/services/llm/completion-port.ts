/**
 * Completion 接缝：润色与翻译共用的最小文本完成接口。
 * 两个适配器（OpenAI chat / Ollama generate）证明接缝真实存在。
 */

export interface CompleteOptions {
  system: string
  user: string
  temperature?: number
  maxTokens?: number
}

/** 调用方与测试共用的完成接口 */
export interface TextCompletionPort {
  complete(options: CompleteOptions): Promise<string>
}

export interface BatchTransformOptions {
  onProgress?: (completed: number, total: number) => void
  signal?: AbortSignal
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('操作已取消')
    error.name = 'AbortError'
    throw error
  }
}

const PUNCTUATION_ONLY =
  /^[\s。！？!?；;…、，,.．:：\-—～~「」『』（）()【】[\]]+$/u

export function isPunctuationOnly(text: string): boolean {
  return PUNCTUATION_ONLY.test(text.trim())
}

/**
 * 清洗模型输出中的标签/回显前缀。
 * kind 控制优先匹配的字段名。
 */
export function cleanModelText(
  raw: string,
  kind: 'translation' | 'polish' = 'translation'
): string {
  let text = (raw || '').trim()
  if (!text) return ''

  text = text.replace(/^["「『]|["」』]$/g, '').trim()

  if (kind === 'polish') {
    const polishedMatch = text.match(
      /(?:^|\n)\s*(?:润色结果|校对结果|结果|Output)\s*[:：]\s*([\s\S]+)$/i
    )
    if (polishedMatch?.[1]) {
      text = polishedMatch[1].trim()
    } else if (/识别原文\s*[:：]/.test(text) || /语言\s*[:：]/.test(text)) {
      text = text
        .split('\n')
        .filter(
          line =>
            !/^\s*(语言|识别原文|润色结果|校对结果|结果|Output|上文|下文|当前段)\s*[:：]/.test(
              line
            )
        )
        .join('\n')
        .trim()
    }
    text = text
      .replace(/^(润色结果|校对结果|结果|Output)\s*[:：]\s*/i, '')
      .trim()
  } else {
    const translationMatch = text.match(
      /(?:^|\n)\s*(?:译文|翻译|Translation)\s*[:：]\s*([\s\S]+)$/i
    )
    if (translationMatch?.[1]) {
      text = translationMatch[1].trim()
    } else if (
      /源语言\s*[:：]/.test(text) ||
      /目标语言\s*[:：]/.test(text) ||
      /原文\s*[:：]/.test(text)
    ) {
      const originalField = text.match(
        /原文\s*[:：]\s*([\s\S]+?)(?=\n\s*(?:译文|翻译|Translation)\s*[:：]|$)/i
      )
      if (originalField?.[1]?.trim()) {
        text = originalField[1].trim()
      } else {
        text = text
          .split('\n')
          .filter(
            line =>
              !/^\s*(源语言|目标语言|原文|译文|翻译|Translation)\s*[:：]/.test(
                line
              )
          )
          .join('\n')
          .trim()
      }
    }
    text = text.replace(/^(译文|翻译|Translation)\s*[:：]\s*/i, '').trim()
  }

  text = text.replace(/^["「『]|["」』]$/g, '').trim()
  return text
}
