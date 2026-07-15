import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  derivePlaceholderName,
  displayUrl,
  parseYtDlpProgressLine,
  validateVideoUrl,
  YtDlpError,
} from './yt-dlp-downloader'

test('validateVideoUrl 接受合法 https 链接', () => {
  const url = validateVideoUrl(
    '  https://www.youtube.com/watch?v=dQw4w9WgXcQ  '
  )
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
})

test('validateVideoUrl 拒绝非 http(s) 与非法格式', () => {
  assert.throws(() => validateVideoUrl(''), YtDlpError)
  assert.throws(() => validateVideoUrl('ftp://example.com/a'), YtDlpError)
  assert.throws(() => validateVideoUrl('not-a-url'), YtDlpError)
  assert.throws(
    () => validateVideoUrl('https://example.com/\u0001'),
    YtDlpError
  )
})

test('displayUrl 隐藏 query 与 path 细节', () => {
  assert.equal(
    displayUrl('https://www.youtube.com/watch?v=abc&token=secret'),
    'https://www.youtube.com/…'
  )
})

test('derivePlaceholderName 从 YouTube / B 站链接提取可读名', () => {
  assert.match(
    derivePlaceholderName('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    /youtube\.com · dQw4w9WgXcQ/
  )
  assert.match(
    derivePlaceholderName(
      'https://www.bilibili.com/video/BV1xx411c7mD?p=1'
    ),
    /bilibili\.com · BV1xx411c7mD/
  )
})

test('parseYtDlpProgressLine 解析百分比与合并阶段', () => {
  const p = parseYtDlpProgressLine(
    '[download]  45.2% of  100.00MiB at  2.50MiB/s ETA 00:22'
  )
  assert.ok(p)
  assert.equal(p?.percent, 45.2)
  assert.match(p?.message ?? '', /45\.2%/)

  const merge = parseYtDlpProgressLine(
    '[Merger] Merging formats into "out.mp4"'
  )
  assert.ok(merge)
  assert.equal(merge?.percent, undefined)

  assert.equal(parseYtDlpProgressLine('hello'), null)
})
