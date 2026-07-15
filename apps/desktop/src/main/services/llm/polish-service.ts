import {
  languageDisplayName,
  type PolishProvider,
} from '../../../shared/settings'
import {
  type CompletionClientConfig,
  createCompletionClient,
  OLLAMA_OPENAI_BASE_URL,
  OLLAMA_OPENAI_DUMMY_KEY,
  type OpenAiCompletionClient,
} from './openai-completion-client'

/**
 * 上下文策略：滑动窗口（prev/next N 段只读上下文，输出仅当前段）。
 * 选择原因：与现有 1:1 显示段 / fail-fast 批处理对齐，解析失败面更小；
 * 微批量合并虽少 round-trip，但对齐与失败半径更难控，v1 不采用。
 */
export const POLISH_CONTEXT_RADIUS = 1

export function supportsTranscriptPolish(model: string): boolean {
  return !/hy-mt/i.test(model)
}

const PUNCTUATION_ONLY =
  /^[\s。！？!?；;…、，,.．:：\-—～~「」『』（）()【】[\]]+$/u

export function cleanPolishedText(raw: string): string {
  let text = (raw || '').trim()
  if (!text) return ''

  text = text.replace(/^["「『]|["」』]$/g, '').trim()

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

  text = text.replace(/^(润色结果|校对结果|结果|Output)\s*[:：]\s*/i, '').trim()
  text = text.replace(/^["「『]|["」』]$/g, '').trim()

  return text
}

/**
 * 组装带前后文的用户提示：上下文只读，要求只输出当前段润色结果。
 */
export function buildPolishUserPrompt(
  texts: string[],
  index: number,
  sourceLanguage: string,
  contextRadius = POLISH_CONTEXT_RADIUS
): string {
  const src = languageDisplayName(sourceLanguage)
  const current = (texts[index] ?? '').trim()
  const prev = texts
    .slice(Math.max(0, index - contextRadius), index)
    .map(t => t.trim())
    .filter(Boolean)
  const next = texts
    .slice(index + 1, index + 1 + contextRadius)
    .map(t => t.trim())
    .filter(Boolean)

  const parts = [`语言：${src}`]
  if (prev.length > 0) {
    parts.push(`上文（只读参考，勿输出）：\n${prev.join('\n')}`)
  }
  parts.push(`当前段（请润色并只输出本段）：\n${current}`)
  if (next.length > 0) {
    parts.push(`下文（只读参考，勿输出）：\n${next.join('\n')}`)
  }
  parts.push('润色结果：')
  return parts.join('\n\n')
}

export function buildPolishSystemPrompt(): string {
  return `你是字幕识别结果校对员。用户给出的是语音/OCR 识别原文，可能有错字、缺标点、语序抖动。可能附带上文/下文仅作语境参考。请只输出「当前段」润色后的同一语言文本：修正明显识别错误，补全必要标点，保持原意与信息量，不要翻译，不要解释，不要添加原文没有的信息，不要复述上下文，不要使用引号包裹全文。`
}

export interface PolishBatchOptions {
  sourceLanguage: string
  config: CompletionClientConfig
  /** 滑动窗口半径，默认 1（前后各 1 段） */
  contextRadius?: number
  onProgress?: (completed: number, total: number) => void
  /** 测试注入用；默认按 config 创建 */
  client?: OpenAiCompletionClient
}

/**
 * 逐段润色（带滑动窗口上下文）；任一段失败时终止整批。
 */
export async function polishTranscriptBatch(
  texts: string[],
  options: PolishBatchOptions
): Promise<string[]> {
  const client = options.client ?? createCompletionClient(options.config)
  const radius = options.contextRadius ?? POLISH_CONTEXT_RADIUS
  const results: string[] = []

  for (let i = 0; i < texts.length; i++) {
    try {
      const polished = await polishOneSegment(texts, i, options.sourceLanguage, client, radius)
      results.push(polished)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `polishTranscriptBatch segment ${i + 1}/${texts.length} failed: ${message}`
      )
    }

    options.onProgress?.(i + 1, texts.length)
  }

  return results
}

async function polishOneSegment(
  texts: string[],
  index: number,
  sourceLanguage: string,
  client: OpenAiCompletionClient,
  contextRadius: number
): Promise<string> {
  const trimmed = (texts[index] ?? '').trim()
  if (!trimmed) return ''

  if (PUNCTUATION_ONLY.test(trimmed)) {
    return trimmed
  }

  try {
    const response = await client.complete({
      system: buildPolishSystemPrompt(),
      user: buildPolishUserPrompt(texts, index, sourceLanguage, contextRadius),
      temperature: 0.1,
      maxTokens: 2000,
    })
    const polished = cleanPolishedText(response)
    if (!polished) {
      throw new Error('润色结果为空')
    }
    return polished
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    // 避免把可能含密钥的 URL 细节原样打进任务日志以外；此处仅包装业务错误
    throw new Error(`识别文本润色失败: ${errorMessage}`)
  }
}

export type { PolishProvider }

export interface ResolvePolishConfigInput {
  polishProvider: PolishProvider
  polishOllamaModel?: string
  byokBaseUrl?: string
  byokModelId?: string
  byokApiKey?: string
}

export type ResolvePolishConfigResult =
  | { ok: true; config: CompletionClientConfig; label: string }
  | { ok: false; reason: string }

/**
 * 将应用设置解析为润色用 Completion 配置；无法润色时返回 reason。
 */
export function resolvePolishCompletionConfig(
  input: ResolvePolishConfigInput
): ResolvePolishConfigResult {
  if (input.polishProvider === 'byok') {
    const baseUrl = (input.byokBaseUrl ?? '').trim()
    const model = (input.byokModelId ?? '').trim()
    const apiKey = (input.byokApiKey ?? '').trim()
    if (!baseUrl) {
      return { ok: false, reason: 'BYOK Base URL 未配置' }
    }
    if (!model) {
      return { ok: false, reason: 'BYOK 模型 ID 未配置' }
    }
    if (!apiKey) {
      return { ok: false, reason: 'BYOK API Key 未配置' }
    }
    return {
      ok: true,
      config: { baseUrl, apiKey, model },
      label: `BYOK ${model}`,
    }
  }

  const model = (input.polishOllamaModel ?? '').trim()
  if (!model) {
    return {
      ok: false,
      reason: '未配置本地润色模型（翻译专用 hy-mt 不可用于润色）',
    }
  }
  if (!supportsTranscriptPolish(model)) {
    return {
      ok: false,
      reason: `模型 ${model} 为翻译专用模型，无法保证润色后仍保持源语言`,
    }
  }
  return {
    ok: true,
    config: {
      baseUrl: OLLAMA_OPENAI_BASE_URL,
      apiKey: OLLAMA_OPENAI_DUMMY_KEY,
      model,
    },
    label: `Ollama ${model}`,
  }
}
