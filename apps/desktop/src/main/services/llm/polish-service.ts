import {
  languageDisplayName,
  type PolishProvider,
} from '../../../shared/settings'
import {
  cleanModelText,
  isPunctuationOnly,
  type TextCompletionPort,
  throwIfAborted,
} from './completion-port'
import {
  type CompletionClientConfig,
  createCompletionClient,
  OLLAMA_OPENAI_BASE_URL,
  OLLAMA_OPENAI_DUMMY_KEY,
  type OpenAiCompletionClient,
} from './openai-completion-client'

/**
 * 上下文策略：滑动窗口（prev/next N 段只读上下文，输出仅当前段）。
 */
export const POLISH_CONTEXT_RADIUS = 1

export function supportsTranscriptPolish(model: string): boolean {
  return !/hy-mt/i.test(model)
}

/** @deprecated 使用 cleanModelText(raw, 'polish') */
export function cleanPolishedText(raw: string): string {
  return cleanModelText(raw, 'polish')
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
  signal?: AbortSignal
  /** 测试注入用；默认按 config 创建 */
  client?: TextCompletionPort
}

/**
 * 逐段润色（带滑动窗口上下文）；任一段失败时终止整批。
 * 走 TextCompletionPort 接缝。
 */
export async function polishTranscriptBatch(
  texts: string[],
  options: PolishBatchOptions
): Promise<string[]> {
  const client: TextCompletionPort =
    options.client ?? createCompletionClient(options.config)
  const radius = options.contextRadius ?? POLISH_CONTEXT_RADIUS
  const results: string[] = []
  const system = buildPolishSystemPrompt()

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
      const response = await client.complete({
        system,
        user: buildPolishUserPrompt(
          texts,
          i,
          options.sourceLanguage,
          radius
        ),
        temperature: 0.1,
        maxTokens: 2000,
      })
      const polished = cleanModelText(response, 'polish')
      if (!polished) {
        throw new Error('润色结果为空')
      }
      results.push(polished)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `polishTranscriptBatch segment ${i + 1}/${texts.length} failed: ${message}`
      )
    }

    options.onProgress?.(i + 1, texts.length)
  }

  return results
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

// re-export for callers that need OpenAi type
export type { OpenAiCompletionClient }
