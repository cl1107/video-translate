import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from './settings'

test('normalizeAppSettings 提供润色 BYOK 字段默认值', () => {
  const settings = normalizeAppSettings({})
  assert.equal(settings.polishProvider, 'ollama')
  assert.equal(settings.polishOllamaModel, '')
  assert.equal(settings.byokBaseUrl, '')
  assert.equal(settings.byokModelId, '')
  assert.equal(settings.polishTranscript, DEFAULT_APP_SETTINGS.polishTranscript)
})

test('normalizeAppSettings 清洗 polish 相关字段', () => {
  const settings = normalizeAppSettings({
    polishProvider: 'byok' as const,
    polishOllamaModel: '  qwen2.5:7b  ',
    byokBaseUrl: ' https://api.openai.com/v1 ',
    byokModelId: ' gpt-4o-mini ',
    polishTranscript: false,
  })

  assert.equal(settings.polishProvider, 'byok')
  assert.equal(settings.polishOllamaModel, 'qwen2.5:7b')
  assert.equal(settings.byokBaseUrl, 'https://api.openai.com/v1')
  assert.equal(settings.byokModelId, 'gpt-4o-mini')
  assert.equal(settings.polishTranscript, false)
})

test('normalizeAppSettings 忽略非法 polishProvider', () => {
  const settings = normalizeAppSettings({
    polishProvider: 'unknown' as never,
  })
  assert.equal(settings.polishProvider, 'ollama')
})
