import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  derivePlaceholderName,
  displayUrl,
  validateVideoUrl,
  YtDlpError,
} from './yt-dlp-downloader'

test('validateVideoUrl 接受合法 https 链接', () => {
  const url = validateVideoUrl(
    '  https://www.youtube.com/watch?v=dQw4w9WgXcQ  '
  )
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
})

test('validateVideoUrl 去掉分享跟踪参数但保留内容参数', () => {
  assert.equal(
    validateVideoUrl(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=share-token&utm_source=x'
    ),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  )
  assert.equal(
    validateVideoUrl('https://www.bilibili.com/video/BV1xx?p=2&vd_source=x'),
    'https://www.bilibili.com/video/BV1xx?p=2'
  )
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

test('displayUrl 隐藏 path 与 query', () => {
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
    derivePlaceholderName('https://www.bilibili.com/video/BV1xx411c7mD?p=1'),
    /bilibili\.com · BV1xx411c7mD/
  )
})
