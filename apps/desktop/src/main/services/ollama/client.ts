import { type ChildProcess, spawn } from 'node:child_process'
import { DEFAULT_OLLAMA_MODEL } from '../../../shared/constants'
import { languageDisplayName } from '../../../shared/settings'
import type { OllamaModel } from '../../../shared/types/video'
import { resolveCommandPath } from '../../utils/command-path'

// 使用动态导入来处理 node-fetch ES 模块
let fetch: any
/**
 * 动态获取node-fetch模块（处理ES模块导入）
 * @returns 返回node-fetch模块
 */
async function getFetch() {
  if (!fetch) {
    const { default: nodeFetch } = await import('node-fetch')
    fetch = nodeFetch
  }
  return fetch
}

/**
 * Ollama生成文本请求接口
 */
export interface OllamaGenerateRequest {
  /** 模型名称 */
  model: string
  /** 输入提示文本 */
  prompt: string
  /** 系统提示词（可选） */
  system?: string
  /** 是否使用流式响应（可选） */
  stream?: boolean
  /** 生成选项（可选） */
  options?: {
    /** 温度参数，控制随机性 */
    temperature?: number
    /** top-p参数，控制词汇选择 */
    top_p?: number
    /** 最大令牌数 */
    max_tokens?: number
  }
}

/**
 * Ollama生成文本响应接口
 */
export interface OllamaGenerateResponse {
  /** 使用的模型名称 */
  model: string
  /** 响应创建时间 */
  created_at: string
  /** 生成的文本响应 */
  response: string
  /** 是否完成生成 */
  done: boolean
  /** 上下文向量（可选） */
  context?: number[]
  /** 总持续时间（毫秒，可选） */
  total_duration?: number
  /** 模型加载时间（毫秒，可选） */
  load_duration?: number
  /** 提示评估次数（可选） */
  prompt_eval_count?: number
  /** 提示评估时间（毫秒，可选） */
  prompt_eval_duration?: number
  /** 评估次数（可选） */
  eval_count?: number
  /** 评估时间（毫秒，可选） */
  eval_duration?: number
}

export class OllamaClient {
  private baseUrl: string
  private command: string
  private daemonProcess: ChildProcess | null = null

  /**
   * Ollama客户端构造函数
   * @param baseUrl - Ollama API基础URL（默认：http://127.0.0.1:11434）
   * @param command - Ollama命令名（默认：ollama）
   */
  constructor(baseUrl = 'http://127.0.0.1:11434', command = 'ollama') {
    this.baseUrl = baseUrl
    this.command = command
  }

  /**
   * 检查 Ollama 服务是否运行
   */
  /**
   * 检查Ollama服务是否正在运行
   * @returns 返回true表示服务正在运行，false表示未运行
   */
  async isRunning(): Promise<boolean> {
    try {
      const fetchFn = await getFetch()
      const response = await fetchFn(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        timeout: 5000,
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * 检查 Ollama 是否可用（别名方法）
   */
  /**
   * 检查Ollama服务是否可用（isRunning的别名）
   * @returns 返回true表示服务可用，false表示不可用
   */
  async isAvailable(): Promise<boolean> {
    return this.isRunning()
  }

  /**
   * 启动 Ollama 守护进程
   */
  /**
   * 启动Ollama守护进程
   * @returns 返回true表示启动成功，false表示启动失败
   */
  async startDaemon(): Promise<boolean> {
    if (await this.isRunning()) {
      console.log('Ollama daemon is already running')
      return true
    }

    try {
      const ollamaBin = resolveCommandPath(this.command)
      console.log('Starting Ollama daemon...', ollamaBin)
      const daemonProcess = spawn(ollamaBin, ['serve'], {
        detached: true,
        stdio: 'pipe',
      })
      this.daemonProcess = daemonProcess

      const started = await new Promise<boolean>(resolve => {
        let settled = false

        daemonProcess.once('spawn', () => {
          settled = true
          resolve(true)
        })

        daemonProcess.on('error', error => {
          console.warn('Ollama daemon 启动失败:', error.message)
          if (this.daemonProcess === daemonProcess) {
            this.daemonProcess = null
          }
          if (!settled) {
            settled = true
            resolve(false)
          }
        })
      })

      if (!started) {
        return false
      }

      // 等待服务启动
      await new Promise(resolve => setTimeout(resolve, 3000))

      const isRunning = await this.isRunning()
      if (isRunning) {
        console.log('Ollama daemon started successfully')
        return true
      }
      console.error('Failed to start Ollama daemon')
      return false
    } catch (error) {
      console.error('Error starting Ollama daemon:', error)
      return false
    }
  }

  /**
   * 停止 Ollama 守护进程
   */
  /**
   * 停止Ollama守护进程
   */
  stopDaemon(): void {
    if (this.daemonProcess) {
      this.daemonProcess.kill()
      this.daemonProcess = null
      console.log('Ollama daemon stopped')
    }
  }

  /**
   * 获取已安装的模型列表
   */
  /**
   * 获取已安装的模型列表
   * @returns 返回Ollama模型数组
   * @throws 当获取模型列表失败时抛出错误
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const fetchFn = await getFetch()
      const response = await fetchFn(`${this.baseUrl}/api/tags`)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = (await response.json()) as { models: OllamaModel[] }
      return data.models || []
    } catch (error) {
      console.error('Error listing models:', error)
      throw error
    }
  }

  /**
   * 拉取模型
   */
  /**
   * 拉取（下载）指定的模型
   * @param modelName - 要拉取的模型名称
   * @param onProgress - 进度回调函数（可选）
   * @throws 当模型拉取失败时抛出错误
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: string) => void
  ): Promise<void> {
    try {
      const fetchFn = await getFetch()
      const response = await fetchFn(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: modelName }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 处理流式响应
      const reader = response.body?.getReader()
      if (!reader) return

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.status && onProgress) {
              onProgress(data.status)
            }
          } catch {
            // 忽略 JSON 解析错误
          }
        }
      }
    } catch (error) {
      console.error('Error pulling model:', error)
      throw error
    }
  }

  /**
   * 生成文本（翻译）
   */
  /**
   * 使用Ollama生成文本
   * @param request - 生成请求配置
   * @returns 返回生成的文本
   * @throws 当文本生成失败时抛出错误
   */
  async generate(request: OllamaGenerateRequest): Promise<string> {
    try {
      const fetchFn = await getFetch()
      const url = `${this.baseUrl}/api/generate`
      console.log('🚀 ~ OllamaClient ~ generate ~ url:', url)
      console.log(
        '🚀 ~ OllamaClient ~ generate ~ request:',
        JSON.stringify(request, null, 2)
      )

      const requestBody = {
        ...request,
        stream: false, // 使用非流式响应以简化处理
      }
      console.log(
        '🚀 ~ OllamaClient ~ generate ~ requestBody:',
        JSON.stringify(requestBody, null, 2)
      )

      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      console.log(
        '🚀 ~ OllamaClient ~ generate ~ response status:',
        response.status
      )
      if (!response.ok) {
        console.log(
          '🚀 ~ OllamaClient ~ generate ~ response headers:',
          response.headers
        )
        const errorText = await response.text()
        console.log('🚀 ~ OllamaClient ~ generate ~ error response:', errorText)
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = (await response.json()) as OllamaGenerateResponse
      console.log(
        '🚀 ~ OllamaClient ~ generate ~ response body:',
        JSON.stringify(data, null, 2)
      )
      console.log(
        '🚀 ~ OllamaClient ~ generate ~ response text:',
        data.response
      )
      return data.response
    } catch (error) {
      console.error('Error generating text:', error)
      throw error
    }
  }

  /**
   * 翻译文本
   */
  /**
   * 翻译文本
   * @param text - 要翻译的文本
   * @param sourceLanguage - 源语言
   * @param targetLanguage - 目标语言
   * @param model - 使用的模型名称（默认：kaelri/hy-mt2:1.8b）
   * @returns 返回翻译后的文本
   * @throws 当翻译失败时抛出错误
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    model = DEFAULT_OLLAMA_MODEL
  ): Promise<string> {
    const trimmed = text.trim()
    if (!trimmed) return ''

    // 纯标点不翻译
    if (
      /^[\s。！？!?；;…、，,.．:：\-—～~「」『』（）()【】[\]]+$/u.test(trimmed)
    ) {
      return trimmed
    }

    const src = languageDisplayName(sourceLanguage)
    const tgt = languageDisplayName(targetLanguage)

    // 面向 hy-mt2 等翻译专用模型：指令简短，强制目标语
    const systemPrompt = `你是专业字幕翻译。把用户给出的文本从${src}翻译成${tgt}。只输出译文，不要解释，不要原文，不要引号。`
    const prompt = `源语言：${src}\n目标语言：${tgt}\n\n原文：\n${trimmed}\n\n译文：`

    try {
      const response = await this.generate({
        model: model || DEFAULT_OLLAMA_MODEL,
        prompt,
        system: systemPrompt,
        options: {
          temperature: 0.1,
          max_tokens: 2000,
        },
      })

      return cleanTranslation(response, trimmed)
    } catch (error) {
      console.error('Translation error:', error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(`翻译失败: ${errorMessage}`)
    }
  }

  /**
   * 批量翻译文本段落
   */
  /**
   * 批量翻译文本段落
   * @param texts - 要翻译的文本数组
   * @param sourceLanguage - 源语言
   * @param targetLanguage - 目标语言
   * @param model - 使用的模型名称（默认：kaelri/hy-mt2:1.8b）
   * @param onProgress - 进度回调函数（可选）
   * @returns 返回翻译后的文本数组，翻译失败的段落保留原文
   */
  async translateBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    model = DEFAULT_OLLAMA_MODEL,
    onProgress?: (completed: number, total: number) => void
  ): Promise<string[]> {
    const resolvedModel = model || DEFAULT_OLLAMA_MODEL
    const results: string[] = []

    for (let i = 0; i < texts.length; i++) {
      try {
        const translated = await this.translate(
          texts[i],
          sourceLanguage,
          targetLanguage,
          resolvedModel
        )
        results.push(translated)

        if (onProgress) {
          onProgress(i + 1, texts.length)
        }
      } catch (error) {
        console.error(
          `Error translating segment ${i} with ${resolvedModel}:`,
          error
        )
        results.push(texts[i]) // 翻译失败时保留原文
      }
    }

    return results
  }
}

function cleanTranslation(raw: string, original: string): string {
  let text = (raw || '').trim()
  if (!text) return original

  // 去掉常见引号包裹
  text = text.replace(/^["「『]|["」』]$/g, '').trim()

  // 优先提取「译文：」之后的内容（模型有时回显整段提示词）
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
    // 模型把提示模板整段回显，且把译文写在「原文：」字段里
    const originalField = text.match(
      /原文\s*[:：]\s*([\s\S]+?)(?=\n\s*(?:译文|翻译|Translation)\s*[:：]|$)/i
    )
    if (originalField?.[1]?.trim()) {
      text = originalField[1].trim()
    } else {
      // 去掉元信息行，只保留可能有用的正文
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

  // 再清一次残留前缀
  text = text.replace(/^(译文|翻译|Translation)\s*[:：]\s*/i, '').trim()
  text = text.replace(/^["「『]|["」』]$/g, '').trim()

  if (!text) return original
  return text
}

// 单例实例
export const ollamaClient = new OllamaClient()
