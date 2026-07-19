/**
 * 文稿级润色：将 ASR 原始长文整理为结构清晰的 Markdown。
 * 与段落级 polishTranscriptBatch（字幕用）分离。
 */
import { languageDisplayName } from '../../../shared/settings'
import {
  cleanModelText,
  type TextCompletionPort,
  throwIfAborted,
} from './completion-port'
import {
  type CompletionClientConfig,
  createCompletionClient,
} from './openai-completion-client'

/** 单次送入模型的原始文本上限（字符），超出则分块润色后拼接 */
export const DOCUMENT_POLISH_CHUNK_CHARS = 6000

export function buildDocumentPolishSystemPrompt(): string {
  return `你是视频/音频转录文稿整理员。用户给出的是语音识别原始文本，可能有错字、缺标点、口语重复、无结构。

请整理成一篇结构清晰的 Markdown 文档：
1. 修正明显识别错误，补全必要标点
2. 按话题划分小标题（## / ###），适当使用列表或表格
3. 保留全部信息，不要总结省略、不要翻译成其他语言
4. 不要用代码围栏包裹全文；直接输出 Markdown 正文
5. 不要解释你的修改过程`
}

export function buildDocumentPolishUserPrompt(options: {
  title: string
  sourceLanguage: string
  durationSeconds?: number
  rawText: string
  partLabel?: string
}): string {
  const lang = languageDisplayName(options.sourceLanguage)
  const meta: string[] = [`标题参考：${options.title}`, `语言：${lang}`]
  if (
    options.durationSeconds != null &&
    Number.isFinite(options.durationSeconds) &&
    options.durationSeconds > 0
  ) {
    const total = Math.floor(options.durationSeconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    meta.push(`时长约 ${m}:${s.toString().padStart(2, '0')}`)
  }
  if (options.partLabel) {
    meta.push(`片段：${options.partLabel}（仅整理本片段，可含本段小标题）`)
  }

  return `${meta.join('\n')}

--- 识别原文开始 ---
${options.rawText.trim()}
--- 识别原文结束 ---

请输出整理后的 Markdown：`
}

/**
 * 按段落边界尽量均分长文，避免在句中硬切。
 */
export function splitRawTextForDocumentPolish(
  rawText: string,
  maxChars = DOCUMENT_POLISH_CHUNK_CHARS
): string[] {
  const text = rawText.replace(/\r\n/g, '\n').trim()
  if (!text) return []
  if (text.length <= maxChars) return [text]

  const paragraphs = text.split(/\n{2,}|\n/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      pushCurrent()
      // 超长段再按句号硬切
      let rest = para
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf('。', maxChars)
        if (cut < maxChars * 0.4) cut = rest.lastIndexOf('. ', maxChars)
        if (cut < maxChars * 0.4) cut = maxChars
        chunks.push(rest.slice(0, cut + 1).trim())
        rest = rest.slice(cut + 1).trim()
      }
      if (rest) current = rest
      continue
    }

    const next = current ? `${current}\n\n${para}` : para
    if (next.length > maxChars && current) {
      pushCurrent()
      current = para
    } else {
      current = next
    }
  }
  pushCurrent()
  return chunks
}

/** 去掉模型可能包上的外层代码围栏 */
export function stripOuterMarkdownFence(text: string): string {
  let t = (text || '').trim()
  const fenced = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(t)
  if (fenced?.[1]) t = fenced[1].trim()
  return t
}

export interface PolishDocumentOptions {
  title: string
  sourceLanguage: string
  durationSeconds?: number
  config: CompletionClientConfig
  onProgress?: (completed: number, total: number) => void
  signal?: AbortSignal
  client?: TextCompletionPort
  maxChunkChars?: number
}

/**
 * 将 ASR 原文润色为最终 Markdown。长文分块后顺序拼接。
 */
export async function polishDocumentToMarkdown(
  rawText: string,
  options: PolishDocumentOptions
): Promise<string> {
  const client: TextCompletionPort =
    options.client ?? createCompletionClient(options.config)
  const system = buildDocumentPolishSystemPrompt()
  const chunks = splitRawTextForDocumentPolish(
    rawText,
    options.maxChunkChars ?? DOCUMENT_POLISH_CHUNK_CHARS
  )

  if (chunks.length === 0) {
    throw new Error('识别原文为空，无法生成文稿')
  }

  const parts: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    throwIfAborted(options.signal)
    const partLabel =
      chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined
    try {
      const response = await client.complete({
        system,
        user: buildDocumentPolishUserPrompt({
          title: options.title,
          sourceLanguage: options.sourceLanguage,
          durationSeconds: options.durationSeconds,
          rawText: chunks[i] ?? '',
          partLabel,
        }),
        temperature: 0.2,
        maxTokens: 4096,
      })
      let polished = stripOuterMarkdownFence(
        cleanModelText(response, 'polish')
      )
      if (!polished) {
        throw new Error('润色结果为空')
      }
      // 首块补标题（若模型未写一级标题）
      if (i === 0 && !/^#\s+/m.test(polished)) {
        const title = options.title.trim() || '文稿'
        polished = `# ${title}\n\n${polished}`
      }
      parts.push(polished)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(
        `文稿润色失败（块 ${i + 1}/${chunks.length}）：${message}`
      )
    }
    options.onProgress?.(i + 1, chunks.length)
  }

  return parts.join('\n\n').trim() + '\n'
}
