import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  normalizeTaskRuntimeOptions,
  parseTaskRuntimeOptionsJson,
  taskOptionsFromAppSettings,
} from './task-options'

test('taskOptionsFromAppSettings 从 AppSettings 映射运行配置', () => {
  const options = taskOptionsFromAppSettings({
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    burnSubtitles: true,
    polishProvider: 'byok',
    byokBaseUrl: 'https://api.example.com',
    byokModelId: 'gpt-4o-mini',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.polishProvider, 'byok')
  assert.equal(options.byokBaseUrl, 'https://api.example.com')
  assert.equal(options.byokModelId, 'gpt-4o-mini')
})

test('parseTaskRuntimeOptionsJson 往返', () => {
  const options = normalizeTaskRuntimeOptions({
    ollamaModel: 'qwen2.5:7b',
    asrEngine: 'funasr-nano',
  })
  const json = JSON.stringify(options)
  const parsed = parseTaskRuntimeOptionsJson(json)
  assert.equal(parsed?.ollamaModel, 'qwen2.5:7b')
  assert.equal(parsed?.asrEngine, 'funasr-nano')
})
