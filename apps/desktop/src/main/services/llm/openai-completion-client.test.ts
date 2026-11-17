import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'vitest'
import {
  normalizeOpenAiBaseUrl,
  OpenAiCompletionClient,
} from './openai-completion-client'

test('normalizeOpenAiBaseUrl 补全 /v1 并去掉尾斜杠', () => {
  assert.equal(
    normalizeOpenAiBaseUrl('http://127.0.0.1:11434'),
    'http://127.0.0.1:11434/v1'
  )
  assert.equal(
    normalizeOpenAiBaseUrl('https://api.openai.com/v1/'),
    'https://api.openai.com/v1'
  )
  assert.equal(normalizeOpenAiBaseUrl('  '), '')
})

test('OpenAiCompletionClient 拒绝空配置', () => {
  assert.throws(
    () =>
      new OpenAiCompletionClient({
        baseUrl: '',
        apiKey: 'k',
        model: 'm',
      }),
    /Base URL/
  )
  assert.throws(
    () =>
      new OpenAiCompletionClient({
        baseUrl: 'http://localhost/v1',
        apiKey: '  ',
        model: 'm',
      }),
    /API Key/
  )
  assert.throws(
    () =>
      new OpenAiCompletionClient({
        baseUrl: 'http://localhost/v1',
        apiKey: 'k',
        model: '',
      }),
    /模型/
  )
})

test('完成请求关闭思考，并按 OpenAI 兼容协议发送参数', async () => {
  let receivedBody: unknown
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      receivedBody = JSON.parse(body)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'completion-test',
          object: 'chat.completion',
          created: 0,
          model: 'qwen3.5-4b',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '整理后的正文' },
              finish_reason: 'stop',
            },
          ],
        })
      )
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const client = new OpenAiCompletionClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'local-test',
      model: 'qwen3.5-4b',
    })
    assert.equal(
      await client.complete({
        system: '整理文稿',
        user: '识别原文',
        maxTokens: 4096,
      }),
      '整理后的正文'
    )
    assert.deepEqual(receivedBody, {
      model: 'qwen3.5-4b',
      messages: [
        { role: 'system', content: '整理文稿' },
        { role: 'user', content: '识别原文' },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      reasoning_effort: 'none',
      chat_template_kwargs: { enable_thinking: false },
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
  }
})
