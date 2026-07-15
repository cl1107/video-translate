import assert from 'node:assert/strict'
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
