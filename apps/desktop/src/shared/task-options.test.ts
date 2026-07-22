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
    subtitleOutputLocation: 'source-directory',
    burnSubtitles: true,
    polishProvider: 'byok',
    byokBaseUrl: 'https://api.example.com',
    byokModelId: 'gpt-4o-mini',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.subtitleOutputLocation, 'source-directory')
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
