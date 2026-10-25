import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  canonicalizeUrl,
  checkVideoLink,
  redactUrl,
  redactUrlsInText,
  VideoLinkError,
} from './link-url'

test('checkVideoLink 规范化链接并去掉跟踪参数', () => {
  const checked = checkVideoLink(
    '  https://www.youtube.com/watch?v=abc123&utm_source=share&si=token&t=42s#frag  '
  )
  assert.equal(
    checked.canonical,
    'https://www.youtube.com/watch?v=abc123&t=42s'
  )
  assert.equal(checked.host, 'www.youtube.com')
  assert.match(checked.raw, /utm_source/)
})

test('checkVideoLink 保留 B 站分 P 等有含义的参数', () => {
  const checked = checkVideoLink(
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2&vd_source=abc&share_source=copy'
  )
  assert.equal(
    checked.canonical,
    'https://www.bilibili.com/video/BV1xx411c7mD?p=2'
  )
})

test('checkVideoLink 拒绝非法输入', () => {
  assert.throws(() => checkVideoLink(''), VideoLinkError)
  assert.throws(() => checkVideoLink('not-a-url'), VideoLinkError)
  assert.throws(() => checkVideoLink('ftp://example.com/a.mp4'), VideoLinkError)
  assert.throws(
    () => checkVideoLink('https://example.com/\u0001'),
    VideoLinkError
  )
  assert.throws(
    () => checkVideoLink('https://user:pass@example.com/video'),
    VideoLinkError
  )
  assert.throws(() => checkVideoLink('-https://example.com'), VideoLinkError)
})

test('canonicalizeUrl 去掉片段与凭据', () => {
  assert.equal(
    canonicalizeUrl('https://example.com/v?utm_campaign=x&id=7#t=10'),
    'https://example.com/v?id=7'
  )
})

test('redactUrl / redactUrlsInText 不泄露 query', () => {
  assert.equal(
    redactUrl('https://example.com/video/1?token=secret'),
    'https://example.com/video/1'
  )
  assert.equal(redactUrl('not a url'), '<redacted-url>')
  assert.equal(
    redactUrlsInText(
      'ERROR: unable to download https://cdn.example.com/a?token=secret&x=1'
    ),
    'ERROR: unable to download https://cdn.example.com/a'
  )
})
