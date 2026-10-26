import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  migrateLegacyLlmFields,
  normalizeAppSettings,
  normalizeTaskSubmissionOptions,
  parseStoredAppSettings,
} from './settings'

test('normalizeAppSettings 提供模型服务字段默认值', () => {
  const settings = normalizeAppSettings({})
  assert.equal(settings.llmBaseUrl, '')
  assert.equal(settings.translateModel, '')
  assert.equal(settings.polishModel, '')
  assert.equal(settings.polishTranscript, DEFAULT_APP_SETTINGS.polishTranscript)
})

test('normalizeAppSettings 保留已配置的模型服务字段', () => {
  const settings = normalizeAppSettings({
    llmBaseUrl: ' http://127.0.0.1:11434 ',
    translateModel: ' qwen3:4b ',
    polishModel: ' qwen3:8b ',
    polishTranscript: false,
  })

  assert.equal(settings.llmBaseUrl, 'http://127.0.0.1:11434')
  assert.equal(settings.translateModel, 'qwen3:4b')
  assert.equal(settings.polishModel, 'qwen3:8b')
  assert.equal(settings.polishTranscript, false)
})

test('旧单服务配置迁移为稳定服务，重复读取不会更换标识', () => {
  const migrated = normalizeAppSettings({
    llmBaseUrl: 'https://old.example.com',
    translateModel: 'old-model',
  })
  assert.equal(migrated.selectedLlmServiceId, 'legacy')
  assert.deepEqual(migrated.llmServices, [
    {
      id: 'legacy',
      name: '默认服务',
      llmBaseUrl: 'https://old.example.com',
      translateModel: 'old-model',
      polishModel: '',
    },
  ])
  assert.deepEqual(normalizeAppSettings(migrated), migrated)
})

test('多个服务按选择映射任务字段，不使用过期的单服务字段', () => {
  const settings = normalizeAppSettings({
    llmServices: [
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
    ],
    selectedLlmServiceId: 'cloud',
    llmBaseUrl: 'https://stale.example.com',
  })
  assert.equal(settings.llmServices.length, 2)
  assert.equal(settings.llmBaseUrl, 'https://cloud.example.com')
  assert.equal(settings.translateModel, 'translator')
  assert.equal(settings.polishModel, 'editor')
  const parsed = parseStoredAppSettings(JSON.stringify(settings))
  assert.deepEqual(parsed.settings, settings)
})

test('上次选择的服务已删除时使用剩余第一个服务', () => {
  const settings = normalizeAppSettings({
    llmServices: [
      {
        id: 'remaining',
        name: '保留',
        llmBaseUrl: '',
        translateModel: '',
        polishModel: '',
      },
    ],
    selectedLlmServiceId: 'deleted',
  })
  assert.equal(settings.selectedLlmServiceId, 'remaining')
})

test('服务标识重复时暴露配置错误，避免混用密钥', () => {
  const service = {
    id: 'same',
    name: '服务',
    llmBaseUrl: '',
    translateModel: '',
    polishModel: '',
  }
  assert.throws(
    () => normalizeAppSettings({ llmServices: [service, service] }),
    /重复/
  )
})

test('migrateLegacyLlmFields：Ollama 旧配置迁移到本地端点', () => {
  const migrated = migrateLegacyLlmFields({
    ollamaModel: 'qwen2.5:7b',
    polishProvider: 'ollama',
    polishOllamaModel: 'qwen3:8b',
  })
  assert.equal(migrated.llmBaseUrl, 'http://127.0.0.1:11434')
  assert.equal(migrated.translateModel, 'qwen2.5:7b')
  assert.equal(migrated.polishModel, 'qwen3:8b')
})

test('migrateLegacyLlmFields：BYOK 旧配置迁移到自备端点', () => {
  const migrated = migrateLegacyLlmFields({
    polishProvider: 'byok',
    byokBaseUrl: 'https://api.example.com/v1',
    byokModelId: 'gpt-4o-mini',
    ollamaModel: 'qwen2.5:7b',
  })
  assert.equal(migrated.llmBaseUrl, 'https://api.example.com/v1')
  assert.equal(migrated.translateModel, 'gpt-4o-mini')
  assert.equal(migrated.polishModel, 'gpt-4o-mini')
})

test('migrateLegacyLlmFields：新字段优先，不回读旧字段', () => {
  const migrated = migrateLegacyLlmFields({
    llmBaseUrl: 'https://api.new.example.com',
    translateModel: 'new-model',
    ollamaModel: 'old-model',
  })
  assert.equal(migrated.llmBaseUrl, 'https://api.new.example.com')
  assert.equal(migrated.translateModel, 'new-model')
  assert.equal(migrated.polishModel, '')
})

test('migrateLegacyLlmFields：润色模型缺省跟随翻译模型落点', () => {
  const migrated = migrateLegacyLlmFields({ ollamaModel: 'qwen2.5:7b' })
  assert.equal(migrated.polishModel, 'qwen2.5:7b')
})

test('normalizeAppSettings 自动迁移旧 localStorage 设置', () => {
  const settings = normalizeAppSettings({
    ollamaModel: 'qwen2.5:7b',
    polishProvider: 'ollama',
  } as never)
  assert.equal(settings.llmBaseUrl, 'http://127.0.0.1:11434')
  assert.equal(settings.translateModel, 'qwen2.5:7b')
  assert.equal(settings.polishModel, 'qwen2.5:7b')
})

test('normalizeAppSettings 规范化字幕输出位置', () => {
  assert.equal(
    normalizeAppSettings({}).subtitleOutputLocation,
    'output-subdirectory'
  )
  assert.equal(
    normalizeAppSettings({ subtitleOutputLocation: 'source-directory' })
      .subtitleOutputLocation,
    'source-directory'
  )
  assert.equal(
    normalizeAppSettings({ subtitleOutputLocation: 'invalid' as never })
      .subtitleOutputLocation,
    'output-subdirectory'
  )
})

test('parseStoredAppSettings 从损坏 JSON 恢复默认设置', () => {
  const result = parseStoredAppSettings('{broken')
  assert.equal(result.recovered, true)
  assert.deepEqual(result.settings, DEFAULT_APP_SETTINGS)
})

test('parseStoredAppSettings 拒绝非对象 JSON 并规范化合法设置', () => {
  assert.equal(parseStoredAppSettings('[]').recovered, true)
  const result = parseStoredAppSettings(
    JSON.stringify({ sourceLanguage: 'ja', translateModel: 'qwen3:4b' })
  )
  assert.equal(result.recovered, false)
  assert.equal(result.settings.sourceLanguage, 'ja')
  assert.equal(result.settings.translateModel, 'qwen3:4b')
})

test('全局设置忽略单次任务的处理方式和烧录选项', () => {
  const settings = normalizeAppSettings({
    subtitleProcessingMode: 'extract',
    burnSubtitles: true,
    burnSubtitleMode: 'original',
  } as never)

  assert.equal('subtitleProcessingMode' in settings, false)
  assert.equal('burnSubtitles' in settings, false)
  assert.equal('burnSubtitleMode' in settings, false)
})

test('仅提取原文任务启用烧录时固定烧录原文', () => {
  const options = normalizeTaskSubmissionOptions({
    subtitleProcessingMode: 'extract',
    burnSubtitles: true,
    burnSubtitleMode: 'translated',
  })

  assert.deepEqual(options, {
    subtitleProcessingMode: 'extract',
    burnSubtitles: true,
    burnSubtitleMode: 'original',
  })
})

test('normalizeAppSettings 规范化下载代理与登录态来源', () => {
  assert.equal(
    normalizeAppSettings({ downloadProxy: ' http://127.0.0.1:7890 ' })
      .downloadProxy,
    'http://127.0.0.1:7890'
  )
  assert.equal(
    normalizeAppSettings({ downloadProxy: '127.0.0.1:7890' }).downloadProxy,
    'http://127.0.0.1:7890'
  )
  assert.equal(
    normalizeAppSettings({ downloadProxy: 'ftp://example.com' }).downloadProxy,
    ''
  )
  assert.equal(
    normalizeAppSettings({ downloadCookieBrowser: 'chrome' })
      .downloadCookieBrowser,
    'chrome'
  )
  assert.equal(
    normalizeAppSettings({ downloadCookieBrowser: 'invalid' as never })
      .downloadCookieBrowser,
    'auto'
  )
})
