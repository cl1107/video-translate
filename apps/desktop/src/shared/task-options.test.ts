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
    subtitleOutputLocation: 'source-directory',
    burnSubtitles: true,
    llmBaseUrl: 'https://api.example.com',
    translateModel: 'gpt-4o-mini',
    polishModel: '',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.subtitleProcessingMode, 'extract')
  assert.equal(options.burnSubtitleMode, 'original')
  assert.equal(options.subtitleOutputLocation, 'source-directory')
  assert.equal(options.llmBaseUrl, 'https://api.example.com')
  assert.equal(options.translateModel, 'gpt-4o-mini')
  assert.equal(options.polishModel, '')
})

test('parseTaskRuntimeOptionsJson 往返', () => {
  const options = normalizeTaskRuntimeOptions({
    translateModel: 'qwen2.5:7b',
    asrEngine: 'funasr-nano',
  })
  const json = JSON.stringify(options)
  const parsed = parseTaskRuntimeOptionsJson(json)
  assert.equal(parsed?.translateModel, 'qwen2.5:7b')
  assert.equal(parsed?.asrEngine, 'funasr-nano')
})

test('normalizeTaskRuntimeOptions 迁移旧任务的 Ollama/BYOK 字段', () => {
  const migrated = normalizeTaskRuntimeOptions({
    ollamaModel: 'qwen2.5:7b',
    polishProvider: 'ollama',
  } as never)
  assert.equal(migrated.llmBaseUrl, 'http://127.0.0.1:11434')
  assert.equal(migrated.translateModel, 'qwen2.5:7b')
  assert.equal(migrated.polishModel, 'qwen2.5:7b')

  const byok = normalizeTaskRuntimeOptions({
    polishProvider: 'byok',
    byokBaseUrl: 'https://api.example.com/v1',
    byokModelId: 'gpt-4o-mini',
  } as never)
  assert.equal(byok.llmBaseUrl, 'https://api.example.com/v1')
  assert.equal(byok.translateModel, 'gpt-4o-mini')
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

test('normalizeTaskRuntimeOptions 对旧任务保持 output 子目录', () => {
  assert.equal(
    normalizeTaskRuntimeOptions({}).subtitleOutputLocation,
    'output-subdirectory'
  )
  assert.equal(
    normalizeTaskRuntimeOptions({ subtitleOutputLocation: 'source-directory' })
      .subtitleOutputLocation,
    'source-directory'
  )
})
