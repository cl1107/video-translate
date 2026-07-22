import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  normalizeDetectedLanguage,
  toLanguageCode,
  toLanguageSuffix,
} from './language'

test('toLanguageCode 统一展示名与短码', () => {
  assert.equal(toLanguageCode('English'), 'en')
  assert.equal(toLanguageCode('中文'), 'zh')
  assert.equal(toLanguageCode('ja'), 'ja')
  assert.equal(toLanguageCode('auto'), 'auto')
  assert.equal(toLanguageCode(''), 'auto')
})

test('toLanguageSuffix 对 auto 保持 auto', () => {
  assert.equal(toLanguageSuffix('auto'), 'auto')
  assert.equal(toLanguageSuffix('English'), 'en')
})

test('normalizeDetectedLanguage 清理 ASR 标签和语言展示名', () => {
  assert.equal(normalizeDetectedLanguage('<|ja|>'), 'ja')
  assert.equal(normalizeDetectedLanguage('English'), 'en')
  assert.equal(normalizeDetectedLanguage('zh-Hans'), 'zh')
  assert.equal(normalizeDetectedLanguage('<|NEUTRAL|><|ko|>'), 'ko')
  assert.equal(normalizeDetectedLanguage('Spanish'), undefined)
})
