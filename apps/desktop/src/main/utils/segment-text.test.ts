import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  getAsrSourceForArtifacts,
  getAsrText,
  getDisplaySource,
  getPolishInput,
  getTranslateInput,
  getTranslatedText,
} from './segment-text'

const segment = {
  originalText: '時刻は間もなく深夜1時',
  polishedText: '时间即将进入深夜1点。',
  translatedText: '即将到深夜1点。',
}

test('ASR 原文不可变；产物原文轨不用润色覆盖', () => {
  assert.equal(getAsrText(segment), '時刻は間もなく深夜1時')
  assert.equal(getAsrSourceForArtifacts(segment), '時刻は間もなく深夜1時')
  assert.equal(getPolishInput(segment), '時刻は間もなく深夜1時')
})

test('翻译输入与显示源优先 polished', () => {
  assert.equal(getDisplaySource(segment), '时间即将进入深夜1点。')
  assert.equal(getTranslateInput(segment), '时间即将进入深夜1点。')
})

test('译文优先 translated，缺失时回退显示源', () => {
  assert.equal(getTranslatedText(segment), '即将到深夜1点。')
  assert.equal(
    getTranslatedText({ originalText: 'a', polishedText: 'b' }),
    'b'
  )
  assert.equal(getTranslatedText({ originalText: 'a' }), 'a')
})
