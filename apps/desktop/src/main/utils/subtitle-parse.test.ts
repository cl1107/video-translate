import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SubtitleGenerator } from './subtitle-generator'

test('parseSRT 解析标准与多行文本', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
Line one
Line two
`
  const entries = SubtitleGenerator.parseSRT(srt)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].text, 'Hello world')
  assert.equal(entries[0].start, '00:00:01,000')
  assert.equal(entries[1].text, 'Line one\nLine two')
  assert.ok(SubtitleGenerator.parseTime(entries[0].end) > 3)
})

test('parseVTT 忽略头并解析', () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
Hi
`
  const entries = SubtitleGenerator.parseVTT(vtt)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, 'Hi')
  assert.equal(entries[0].start, '00:00:01,000')
})

test('parseSubtitleContent 去掉简单标签', () => {
  const srt = `1
00:00:00,000 --> 00:00:01,000
<i>Hello</i> {\\an8}world
`
  const entries = SubtitleGenerator.parseSubtitleContent(srt, 'srt')
  assert.equal(entries[0].text, 'Hello world')
})
