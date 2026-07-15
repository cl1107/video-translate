import OpenAI from 'openai'
import type {
  CompleteOptions,
  TextCompletionPort,
} from './completion-port'

export type { CompleteOptions }

/** OpenAI 兼容 chat completion 配置（本地 Ollama /v1 与在线 BYOK 共用） */
export interface CompletionClientConfig {
  /** API 根路径，需含 /v1，例如 http://127.0.0.1:11434/v1 */
  baseUrl: string
  /** API Key；本地 Ollama 可填任意非空值 */
  apiKey: string
  /** 模型 ID */
  model: string
}

export const OLLAMA_OPENAI_BASE_URL = 'http://127.0.0.1:11434/v1'
/** SDK 要求 apiKey 非空；Ollama 本地忽略该字段 */
export const OLLAMA_OPENAI_DUMMY_KEY = 'ollama'

/**
 * 规范化 OpenAI 兼容 baseURL：去掉尾斜杠，无 /v1 时自动补上。
 */
export function normalizeOpenAiBaseUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/\/v\d+$/i.test(url)) {
    url = `${url}/v1`
  }
  return url
}

/**
 * 基于官方 OpenAI Node SDK 的薄封装，统一本地 Ollama 与 BYOK 在线端点。
 * 实现 TextCompletionPort，作为 Completion 接缝的适配器之一。
 */
export class OpenAiCompletionClient implements TextCompletionPort {
  private readonly client: OpenAI
  private readonly model: string

  constructor(config: CompletionClientConfig) {
    const baseURL = normalizeOpenAiBaseUrl(config.baseUrl)
    if (!baseURL) {
      throw new Error('OpenAI 兼容 Base URL 不能为空')
    }
    if (!config.apiKey?.trim()) {
      throw new Error('API Key 不能为空')
    }
    if (!config.model?.trim()) {
      throw new Error('模型 ID 不能为空')
    }

    this.model = config.model.trim()
    this.client = new OpenAI({
      baseURL,
      apiKey: config.apiKey.trim(),
      // 主进程调用；禁止误用浏览器路径
      dangerouslyAllowBrowser: false,
    })
  }

  /**
   * 非流式 chat completion，返回助手文本内容。
   */
  async complete(options: CompleteOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ],
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 2000,
    })

    const content = response.choices[0]?.message?.content
    if (typeof content !== 'string') {
      return ''
    }
    return content
  }
}

/**
 * 从配置创建客户端；配置非法时抛出明确错误。
 */
export function createCompletionClient(
  config: CompletionClientConfig
): OpenAiCompletionClient {
  return new OpenAiCompletionClient(config)
}
