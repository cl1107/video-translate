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
    subtitleProcessingMode: 'extract',
    burnSubtitles: true,
    polishProvider: 'byok',
    byokBaseUrl: 'https://api.example.com',
    byokModelId: 'gpt-4o-mini',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.subtitleProcessingMode, 'extract')
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

test('normalizeTaskRuntimeOptions 对旧任务保持翻译模式', () => {
  assert.equal(
    normalizeTaskRuntimeOptions({}).subtitleProcessingMode,
    'translate'
  )
  assert.equal(
    normalizeTaskRuntimeOptions({ subtitleProcessingMode: 'extract' })
      .subtitleProcessingMode,
    'extract'
  )
})
