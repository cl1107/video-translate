import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  normalizeTaskRuntimeOptions,
  parseTaskRuntimeOptionsJson,
  taskOptionsFromAppSettings,
  serializeTaskRuntimeOptions,
} from './task-options'

test('任务快照保存所选服务，设置切换不改变已创建任务', () => {
  const services = [
    {
      id: 'local',
      name: '本地',
      llmBaseUrl: 'http://localhost:11434',
      translateModel: 'qwen',
      polishModel: '',
    },
    {
      id: 'cloud',
      name: '在线',
      llmBaseUrl: 'https://cloud.example.com',
      translateModel: 'translator',
      polishModel: 'editor',
    },
  ]
  const first = taskOptionsFromAppSettings({
    llmServices: services,
    selectedLlmServiceId: 'local',
  })
  const second = taskOptionsFromAppSettings({
    llmServices: services,
    selectedLlmServiceId: 'cloud',
  })
  assert.equal(first.llmServiceId, 'local')
  assert.equal(first.llmBaseUrl, 'http://localhost:11434')
  assert.equal(second.llmServiceId, 'cloud')
  assert.equal(second.translateModel, 'translator')
  assert.deepEqual(
    parseTaskRuntimeOptionsJson(serializeTaskRuntimeOptions(first)),
    first
  )
  assert.equal(
    normalizeTaskRuntimeOptions({ translateModel: 'old' }).llmServiceId,
    undefined
  )
})

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
    downloadProxy: ' socks5://127.0.0.1:7890 ',
    downloadCookieBrowser: 'chrome',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.subtitleProcessingMode, 'extract')
  assert.equal(options.burnSubtitleMode, 'original')
  assert.equal(options.subtitleOutputLocation, 'source-directory')
  assert.equal(options.llmBaseUrl, 'https://api.example.com')
  assert.equal(options.translateModel, 'gpt-4o-mini')
  assert.equal(options.polishModel, '')
  assert.deepEqual(options.glossary, [])
  assert.equal(options.downloadProxy, 'socks5://127.0.0.1:7890')
  assert.equal(options.downloadCookieBrowser, 'chrome')
})

test('TaskRuntimeOptions 往返保留并规范化术语库', () => {
  const options = normalizeTaskRuntimeOptions({
    glossary: [
      { source: ' API ', target: '接口' },
      { source: 'api', target: '重复' },
    ],
  })
  assert.deepEqual(options.glossary, [{ source: 'API', target: '接口' }])
  assert.deepEqual(
    parseTaskRuntimeOptionsJson(serializeTaskRuntimeOptions(options))?.glossary,
    options.glossary
  )
})

test('parseTaskRuntimeOptionsJson 往返保留下载设置', () => {
  const options = normalizeTaskRuntimeOptions({
    llmBaseUrl: 'http://127.0.0.1:11434',
    translateModel: 'qwen2.5:7b',
    asrEngine: 'funasr-nano',
    downloadProxy: 'http://127.0.0.1:7890',
    downloadCookieBrowser: 'firefox',
  })
  const json = JSON.stringify(options)
  const parsed = parseTaskRuntimeOptionsJson(json)
  assert.equal(parsed?.translateModel, 'qwen2.5:7b')
  assert.equal(parsed?.asrEngine, 'funasr-nano')
  assert.equal(parsed?.downloadProxy, 'http://127.0.0.1:7890')
  assert.equal(parsed?.downloadCookieBrowser, 'firefox')
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

test('normalizeTaskRuntimeOptions 给旧任务补上下载默认值', () => {
  const options = normalizeTaskRuntimeOptions({})
  assert.equal(options.downloadProxy, '')
  assert.equal(options.downloadCookieBrowser, 'auto')
  assert.equal(
    normalizeTaskRuntimeOptions({
      downloadCookieBrowser: 'invalid' as never,
      downloadProxy: 'ftp://example.com',
    }).downloadCookieBrowser,
    'auto'
  )
  assert.equal(
    normalizeTaskRuntimeOptions({ downloadProxy: 'ftp://example.com' })
      .downloadProxy,
    ''
  )
})
