import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { OpenAiCompletionClient } from './openai-completion-client'
import {
  buildPolishUserPrompt,
  cleanPolishedText,
  polishTranscriptBatch,
  supportsTranscriptPolish,
} from './polish-service'
import { resolveLlmCompletionConfig } from './llm-config'

test('supportsTranscriptPolish 排除 hy-mt 翻译专用模型', () => {
  assert.equal(supportsTranscriptPolish('kaelri/hy-mt2:1.8b'), false)
  assert.equal(supportsTranscriptPolish('custom/HY-MT:latest'), false)
  assert.equal(supportsTranscriptPolish('qwen2.5:7b'), true)
})

test('cleanPolishedText 提取润色结果并去掉模板回显', () => {
  assert.equal(cleanPolishedText('润色结果：修好了。'), '修好了。')
  assert.equal(
    cleanPolishedText('语言：日语\n识别原文：foo\n修好了。'),
    '修好了。'
  )
  assert.equal(cleanPolishedText('"括号包裹"'), '括号包裹')
})

test('buildPolishUserPrompt 使用滑动窗口附带前后文且标注当前段', () => {
  const texts = ['opening', 'current', 'ending']
  const prompt = buildPolishUserPrompt(texts, 1, 'en', 1)

  assert.match(prompt, /上文（只读参考/)
  assert.match(prompt, /opening/)
  assert.match(prompt, /当前段（请润色并只输出本段）：\ncurrent/)
  assert.match(prompt, /下文（只读参考/)
  assert.match(prompt, /ending/)

  const first = buildPolishUserPrompt(texts, 0, 'en', 1)
  assert.doesNotMatch(first, /上文/)
  assert.match(first, /当前段（请润色并只输出本段）：\nopening/)
  // 半径 1 时首段下文仅 current，不包含 ending
  assert.match(first, /下文（只读参考/)
  assert.match(first, /current/)
  assert.doesNotMatch(first, /ending/)
})

test('polishTranscriptBatch 在任一段润色失败时报告段落位置并终止', async () => {
  const client = {
    complete: async ({ user }: { user: string }) => {
      // 仅当「当前段」为 second 时失败（避免上下文中的 second 误触发）
      if (/当前段（请润色并只输出本段）：\nsecond/.test(user)) {
        throw new Error('model unavailable')
      }
      return 'polished'
    },
  } as unknown as OpenAiCompletionClient

  await assert.rejects(
    polishTranscriptBatch(['first', 'second'], {
      sourceLanguage: 'en',
      config: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        model: 'qwen2.5:7b',
      },
      client,
    }),
    /segment 2\/2.*model unavailable/
  )
})

test('polishTranscriptBatch 对中间段附带前后文提示', async () => {
  const users: string[] = []
  const client = {
    complete: async ({ user }: { user: string }) => {
      users.push(user)
      return 'ok'
    },
  } as unknown as OpenAiCompletionClient

  const polished = await polishTranscriptBatch(
    ['opening', 'current', 'ending'],
    {
      sourceLanguage: 'en',
      config: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        model: 'qwen2.5:7b',
      },
      client,
    }
  )

  assert.deepEqual(polished, ['ok', 'ok', 'ok'])
  assert.match(users[1], /opening/)
  assert.match(users[1], /current/)
  assert.match(users[1], /ending/)
})

test('polishTranscriptBatch 模型返回空文本时明确失败', async () => {
  const client = {
    complete: async () => '   ',
  } as unknown as OpenAiCompletionClient

  await assert.rejects(
    polishTranscriptBatch(['source'], {
      sourceLanguage: 'en',
      config: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        model: 'qwen2.5:7b',
      },
      client,
    }),
    /润色结果为空/
  )
})

test('resolveLlmCompletionConfig 校验 Endpoint 与模型', () => {
  const missingEndpoint = resolveLlmCompletionConfig(
    { llmBaseUrl: '', model: 'qwen2.5:7b' },
    '润色'
  )
  assert.equal(missingEndpoint.ok, false)
  if (!missingEndpoint.ok) {
    assert.match(missingEndpoint.reason, /Endpoint 未配置/)
  }

  const missingModel = resolveLlmCompletionConfig(
    { llmBaseUrl: 'http://127.0.0.1:11434', model: '' },
    '润色'
  )
  assert.equal(missingModel.ok, false)

  // 本地服务无 Key：使用占位 Key 照常解析
  const local = resolveLlmCompletionConfig(
    { llmBaseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
    '润色'
  )
  assert.equal(local.ok, true)
  if (local.ok) {
    assert.equal(local.config.model, 'qwen2.5:7b')
    assert.equal(local.config.apiKey, 'local')
  }

  // 在线服务带 Key：Key 原样进入配置
  const online = resolveLlmCompletionConfig(
    {
      llmBaseUrl: 'https://api.example.com',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    },
    '翻译'
  )
  assert.equal(online.ok, true)
  if (online.ok) {
    assert.equal(online.config.apiKey, 'sk-test')
    assert.equal(online.label, 'gpt-4o-mini')
  }
})
