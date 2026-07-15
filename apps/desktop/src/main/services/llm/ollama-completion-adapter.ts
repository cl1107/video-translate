/**
 * Ollama /api/generate → TextCompletionPort 适配器。
 * 与 OpenAiCompletionClient 并列，构成 Completion 接缝的第二个适配器。
 */
import type { OllamaClient } from '../ollama/client'
import type { CompleteOptions, TextCompletionPort } from './completion-port'

export class OllamaCompletionAdapter implements TextCompletionPort {
  constructor(
    private readonly client: OllamaClient,
    private readonly model: string
  ) {}

  async complete(options: CompleteOptions): Promise<string> {
    return this.client.generate({
      model: this.model,
      prompt: options.user,
      system: options.system,
      options: {
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 2000,
      },
    })
  }
}
