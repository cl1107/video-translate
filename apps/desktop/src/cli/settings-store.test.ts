import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import {
  configureAppPaths,
  resetAppPathsForTests,
} from '../main/runtime/app-paths'
import {
  loadCliSettings,
  patchCliSettings,
  saveCliSettings,
} from './settings-store'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'vt-cli-settings-'))
  configureAppPaths({
    userData: dir,
    logs: path.join(dir, 'logs'),
    isPackaged: false,
  })
  delete process.env.VIDEO_TRANSLATE_LLM_BASE_URL
  delete process.env.VIDEO_TRANSLATE_TRANSLATE_MODEL
})

afterEach(() => {
  resetAppPathsForTests()
  rmSync(dir, { recursive: true, force: true })
})

test('缺省文件返回规范化默认设置', () => {
  const settings = loadCliSettings()
  assert.equal(settings.targetLanguage, 'zh')
  assert.equal(settings.subtitleProcessingMode, 'translate')
})

test('保存后再读取', () => {
  const saved = patchCliSettings({
    targetLanguage: 'en',
    translateModel: 'qwen',
  })
  assert.equal(saved.targetLanguage, 'en')
  const roundtrip = loadCliSettings()
  assert.equal(roundtrip.translateModel, 'qwen')
  const raw = readFileSync(path.join(dir, 'cli-settings.json'), 'utf8')
  assert.ok(raw.includes('qwen'))
})

test('环境变量覆盖文件', () => {
  saveCliSettings(
    patchCliSettings({
      llmBaseUrl: 'http://file.local:1',
      translateModel: 'file-model',
    })
  )
  process.env.VIDEO_TRANSLATE_LLM_BASE_URL = 'http://env.local:2'
  process.env.VIDEO_TRANSLATE_TRANSLATE_MODEL = 'env-model'
  const settings = loadCliSettings()
  assert.equal(settings.llmBaseUrl, 'http://env.local:2')
  assert.equal(settings.translateModel, 'env-model')
})
