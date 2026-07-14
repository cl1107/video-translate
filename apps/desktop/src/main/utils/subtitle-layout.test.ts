import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  computeSubtitleLayout,
  displayWidth,
  wrapForDisplay,
  wrapLayoutChunks,
} from './subtitle-layout'

test('displayWidth treats CJK as double-width', () => {
  assert.equal(displayWidth('ab'), 2)
  assert.equal(displayWidth('中文'), 4)
  assert.equal(displayWidth('a中'), 3)
})

test('wrapLayoutChunks preserves exact source text', () => {
  const text = '这条二十五个汉字长度的中文字幕需要按宽度折行显示测试'
  const chunks = wrapLayoutChunks(text, 20)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.length >= 2)
})

test('wrapLayoutChunks prefers space boundaries for latin text', () => {
  const text = 'hello beautiful world from subtitle layout'
  const wrapped = wrapForDisplay(text, 12)
  assert.equal(
    wrapped.replace(/\n/g, ''),
    text.replace(/ /g, ' ').replace(/\n/g, '')
  )
  assert.equal(wrapped.split('\n').join(''), text)
  assert.ok(wrapped.includes('\n'))
})

test('portrait layout uses narrower columns and larger bottom margin', () => {
  const landscape = computeSubtitleLayout({ width: 1920, height: 1080 })
  const portrait = computeSubtitleLayout({ width: 1080, height: 1920 })

  assert.equal(landscape.portrait, false)
  assert.equal(portrait.portrait, true)
  assert.ok(portrait.sourceColumns < landscape.sourceColumns)
  assert.ok(portrait.targetColumns < landscape.targetColumns)
  assert.ok(portrait.bottomMargin > landscape.bottomMargin)
  assert.ok(portrait.sourceFontSize < landscape.sourceFontSize)
})
