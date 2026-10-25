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
    downloadProxy: ' socks5://127.0.0.1:7890 ',
    downloadCookieBrowser: 'chrome',
  })
  assert.equal(options.burnSubtitles, true)
  assert.equal(options.subtitleProcessingMode, 'extract')
  assert.equal(options.burnSubtitleMode, 'original')
  assert.equal(options.subtitleOutputLocation, 'source-directory')
  assert.equal(options.llmBaseUrl, 'https://api.example.com')
  assert.equal(options.translateModel, 'gpt-4o-mini')
  assert.equal(options.downloadProxy, 'socks5://127.0.0.1:7890')
  assert.equal(options.downloadCookieBrowser, 'chrome')
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
