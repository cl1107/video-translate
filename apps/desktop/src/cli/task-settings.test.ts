import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_TASK_SUBMISSION_OPTIONS,
  normalizeTaskCreationSettings,
} from '../shared/settings'
import { applyCliFlags } from './task-settings'

const base = normalizeTaskCreationSettings(DEFAULT_TASK_SUBMISSION_OPTIONS)

test('标志覆盖语言、ASR、烧录与润色', () => {
  const settings = applyCliFlags(base, {
    'source-lang': 'en',
    'target-lang': 'zh',
    asr: 'funasr-nano',
    burn: true,
    'burn-mode': 'translated',
    'no-polish': true,
    'llm-base-url': 'http://127.0.0.1:11434',
    'translate-model': 'qwen',
  })
  assert.equal(settings.sourceLanguage, 'en')
  assert.equal(settings.targetLanguage, 'zh')
  assert.equal(settings.asrEngine, 'funasr-nano')
  assert.equal(settings.burnSubtitles, true)
  assert.equal(settings.burnSubtitleMode, 'translated')
  assert.equal(settings.polishTranscript, false)
  assert.equal(settings.llmBaseUrl, 'http://127.0.0.1:11434')
  assert.equal(settings.translateModel, 'qwen')
})

test('JSON 术语表', () => {
  const settings = applyCliFlags(base, {
    glossary: '[{"source":"AI","target":"人工智能"}]',
  })
  assert.deepEqual(settings.glossary, [{ source: 'AI', target: '人工智能' }])
})
