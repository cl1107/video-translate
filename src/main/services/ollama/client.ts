import { ChildProcess, spawn } from "child_process";
import { OllamaModel } from "../../../shared/types/video";

// 使用动态导入来处理 node-fetch ES 模块
let fetch: any;
async function getFetch() {
  if (!fetch) {
    const { default: nodeFetch } = await import("node-fetch");
    fetch = nodeFetch;
  }
  return fetch;
}

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaClient {
  private baseUrl: string;
  private daemonProcess: ChildProcess | null = null;

  constructor(baseUrl = "http://127.0.0.1:11434") {
    this.baseUrl = baseUrl;
  }

  /**
   * 检查 Ollama 服务是否运行
   */
  async isRunning(): Promise<boolean> {
    try {
      const fetchFn = await getFetch();
      const response = await fetchFn(`${this.baseUrl}/api/tags`, {
        method: "GET",
        timeout: 5000,
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查 Ollama 是否可用（别名方法）
   */
  async isAvailable(): Promise<boolean> {
    return this.isRunning();
  }

  /**
   * 启动 Ollama 守护进程
   */
  async startDaemon(): Promise<boolean> {
    if (await this.isRunning()) {
      console.log("Ollama daemon is already running");
      return true;
    }

    try {
      console.log("Starting Ollama daemon...");
      this.daemonProcess = spawn("ollama", ["serve"], {
        detached: true,
        stdio: "pipe",
      });

      // 等待服务启动
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const isRunning = await this.isRunning();
      if (isRunning) {
        console.log("Ollama daemon started successfully");
        return true;
      } else {
        console.error("Failed to start Ollama daemon");
        return false;
      }
    } catch (error) {
      console.error("Error starting Ollama daemon:", error);
      return false;
    }
  }

  /**
   * 停止 Ollama 守护进程
   */
  stopDaemon(): void {
    if (this.daemonProcess) {
      this.daemonProcess.kill();
      this.daemonProcess = null;
      console.log("Ollama daemon stopped");
    }
  }

  /**
   * 获取已安装的模型列表
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const fetchFn = await getFetch();
      const response = await fetchFn(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as { models: OllamaModel[] };
      return data.models || [];
    } catch (error) {
      console.error("Error listing models:", error);
      throw error;
    }
  }

  /**
   * 拉取模型
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: string) => void
  ): Promise<void> {
    try {
      const fetchFn = await getFetch();
      const response = await fetchFn(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: modelName }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.status && onProgress) {
              onProgress(data.status);
            }
          } catch (e) {
            // 忽略 JSON 解析错误
          }
        }
      }
    } catch (error) {
      console.error("Error pulling model:", error);
      throw error;
    }
  }

  /**
   * 生成文本（翻译）
   */
  async generate(request: OllamaGenerateRequest): Promise<string> {
    try {
      const fetchFn = await getFetch();
      const response = await fetchFn(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...request,
          stream: false, // 使用非流式响应以简化处理
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as OllamaGenerateResponse;
      return data.response;
    } catch (error) {
      console.error("Error generating text:", error);
      throw error;
    }
  }

  /**
   * 翻译文本
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    model = "llama3"
  ): Promise<string> {
    const systemPrompt = `You are a professional translator. Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translated text without any explanations or additional content.`;

    const prompt = `Translate this text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`;

    try {
      const response = await this.generate({
        model,
        prompt,
        system: systemPrompt,
        options: {
          temperature: 0.3, // 较低的温度以获得更一致的翻译
          max_tokens: 2000,
        },
      });

      // 清理响应，移除可能的前缀或后缀
      return response.trim();
    } catch (error) {
      console.error("Translation error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`翻译失败: ${errorMessage}`);
    }
  }

  /**
   * 批量翻译文本段落
   */
  async translateBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    model = "llama3",
    onProgress?: (completed: number, total: number) => void
  ): Promise<string[]> {
    const results: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      try {
        const translated = await this.translate(
          texts[i],
          sourceLanguage,
          targetLanguage,
          model
        );
        results.push(translated);

        if (onProgress) {
          onProgress(i + 1, texts.length);
        }
      } catch (error) {
        console.error(`Error translating segment ${i}:`, error);
        results.push(texts[i]); // 翻译失败时保留原文
      }
    }

    return results;
  }
}

// 单例实例
export const ollamaClient = new OllamaClient();
