import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildYtDlpSubLangs,
  isLikelyAutoSubtitle,
  parseLanguageFromSubtitleFilename,
  selectBestPlatformSubtitle,
  type PlatformSubtitleCandidate,
} from './platform-subtitles'

test('parseLanguageFromSubtitleFilename 解析常见 yt-dlp 命名', () => {
  assert.equal(
    parseLanguageFromSubtitleFilename('Video_title_abc123.en.srt'),
    'en'
  )
  assert.equal(
    parseLanguageFromSubtitleFilename('Video.zh-Hans.srt'),
    'zh-Hans'
  )
  assert.equal(
    parseLanguageFromSubtitleFilename('clip.en-orig.vtt'),
    'en-orig'
  )
  assert.equal(parseLanguageFromSubtitleFilename('nosublang.srt'), null)
})

test('selectBestPlatformSubtitle 优先源语与人工字幕', () => {
  const candidates: PlatformSubtitleCandidate[] = [
    {
      path: '/tmp/a.zh.srt',
      language: 'zh',
      likelyAuto: false,
    },
    {
      path: '/tmp/a.en.srt',
      language: 'en',
      likelyAuto: false,
    },
    {
      path: '/tmp/a.en-auto.srt',
      language: 'en',
      likelyAuto: true,
    },
  ]

  const en = selectBestPlatformSubtitle(candidates, {
    sourceLanguage: 'en',
    targetLanguage: 'zh',
  })
  assert.equal(en?.path, '/tmp/a.en.srt')
  assert.equal(en?.likelyAuto, false)

  const zhTargetPreferEn = selectBestPlatformSubtitle(candidates, {
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
  })
  // auto 时 en 有常见语加分，且非目标语
  assert.ok(zhTargetPreferEn)
  assert.notEqual(zhTargetPreferEn?.language, 'zh')
})

test('selectBestPlatformSubtitle 在仅有目标语时仍可选中', () => {
  const onlyZh: PlatformSubtitleCandidate[] = [
    { path: '/tmp/only.zh.srt', language: 'zh', likelyAuto: true },
  ]
  const selected = selectBestPlatformSubtitle(onlyZh, {
    sourceLanguage: 'en',
    targetLanguage: 'zh',
  })
  assert.equal(selected?.path, '/tmp/only.zh.srt')
})

test('buildYtDlpSubLangs 包含源语偏好与 live_chat 排除', () => {
  const langs = buildYtDlpSubLangs('en', 'zh')
  assert.match(langs, /en/)
  assert.match(langs, /all/)
  assert.match(langs, /-live_chat/)
})

test('isLikelyAutoSubtitle 识别自动轨启发', () => {
  assert.equal(isLikelyAutoSubtitle('x.en-orig.srt', 'en-orig'), true)
  assert.equal(isLikelyAutoSubtitle('x.en.srt', 'en'), false)
})
