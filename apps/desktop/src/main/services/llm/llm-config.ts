/**
 * 统一「模型服务」配置解析：一个 OpenAI 兼容 Endpoint（本地推理或在线 API）
 * + 翻译/润色两个模型槽。解析失败的 reason 面向用户，可直接进日志/界面。
 */
import {
  normalizeOpenAiBaseUrl,
  type CompletionClientConfig,
} from './openai-completion-client'

/** 本地推理服务忽略 Key，但 SDK 要求非空时的占位值 */
export const LOCAL_LLM_DUMMY_KEY = 'local'

export interface LlmConfigInput {
  llmBaseUrl: string
  /** 模型 ID；润色传 polishModel || translateModel */
  model: string
  /** secure store 中的 API Key；本地服务可为空 */
  apiKey?: string
}

export type ResolvedLlmConfig =
  | { ok: true; config: CompletionClientConfig; label: string }
  | { ok: false; reason: string }

export function resolveLlmCompletionConfig(
  input: LlmConfigInput,
  purpose: '翻译' | '润色'
): ResolvedLlmConfig {
  const baseUrl = (input.llmBaseUrl ?? '').trim()
  if (!baseUrl) {
    return { ok: false, reason: '模型服务 Endpoint 未配置' }
  }
  const model = (input.model ?? '').trim()
  if (!model) {
    return { ok: false, reason: `未配置${purpose}模型` }
  }
  const apiKey = input.apiKey?.trim() || LOCAL_LLM_DUMMY_KEY
  return {
    ok: true,
    config: { baseUrl, apiKey, model },
    label: `${model}`,
  }
}

export interface EndpointModelsResult {
  ok: boolean
  models: string[]
  error?: string
}

/**
 * 拉取 OpenAI 兼容端点的模型列表（GET /models），同时充当「测试连接」。
 * 网络错误 / 非 2xx / 响应不合规都折算成 ok:false + 中文原因。
 */
export async function listEndpointModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 8000
): Promise<EndpointModelsResult> {
  const root = normalizeOpenAiBaseUrl(baseUrl)
  if (!root) {
    return { ok: false, models: [], error: 'Endpoint 不能为空' }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }

  try {
    const response = await fetch(`${root}/models`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      return {
        ok: false,
        models: [],
        error: `端点返回 HTTP ${response.status}`,
      }
    }
    const payload: unknown = await response.json()
    const models = parseModelsPayload(payload)
    if (!models) {
      return { ok: false, models: [], error: '响应格式异常（缺少 data 数组）' }
    }
    return { ok: true, models }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, models: [], error: '连接超时' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, models: [], error: message }
  }
}

/** OpenAI 兼容形态：{ data: [{ id }] }；逐项校验，非法项跳过 */
function parseModelsPayload(payload: unknown): string[] | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null
  }
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  const ids = data
    .map(item =>
      typeof item === 'object' && item !== null
        ? (item as { id?: unknown }).id
        : undefined
    )
    .filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    )
    .map(id => id.trim())
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}
