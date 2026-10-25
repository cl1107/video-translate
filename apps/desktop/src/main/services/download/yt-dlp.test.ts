import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildDownloadArgs,
  buildOutputBaseName,
  buildResolveArgs,
  classifyFailure,
  parseProgressLine,
  parseVideoInfo,
  ProgressTracker,
  sanitizeFileName,
  selectSubtitleTrack,
  worthAnotherCookieBrowser,
  YtDlpError,
} from './yt-dlp'

test('buildResolveArgs 隔离用户配置并固定链接位置', () => {
  const args = buildResolveArgs('https://example.com/watch?v=1', {
    cookieBrowser: 'chrome',
    proxy: 'socks5://127.0.0.1:7890',
  })
  assert.ok(args.includes('--ignore-config'))
  assert.ok(args.includes('--no-plugin-dirs'))
  assert.ok(args.includes('--no-cache-dir'))
  assert.ok(args.includes('--dump-single-json'))
  assert.deepEqual(
    args.slice(
      args.indexOf('--cookies-from-browser'),
      args.indexOf('--cookies-from-browser') + 2
    ),
    ['--cookies-from-browser', 'chrome']
  )
  assert.deepEqual(
    args.slice(args.indexOf('--proxy'), args.indexOf('--proxy') + 2),
    ['--proxy', 'socks5://127.0.0.1:7890']
  )
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/watch?v=1'])
})

test('buildDownloadArgs 默认下载兼容性最好的 MP4', () => {
  const args = buildDownloadArgs('https://example.com/v', {
    output: '/tmp/dl/media.%(ext)s',
    audioOnly: false,
  })
  assert.ok(args.includes('--check-formats'))
  assert.ok(args.includes('--newline'))
  assert.ok(args.includes('--progress-template'))
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2), [
    '-f',
    'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
  ])
  assert.deepEqual(
    args.slice(
      args.indexOf('--merge-output-format'),
      args.indexOf('--merge-output-format') + 2
    ),
    ['--merge-output-format', 'mp4/webm/mkv']
  )
  assert.ok(!args.includes('--write-subs'))
  assert.deepEqual(args.slice(-2), ['--', 'https://example.com/v'])
})

test('buildDownloadArgs 只下载选中的字幕轨并转 srt', () => {
  const manual = buildDownloadArgs('https://example.com/v', {
    output: '/tmp/media.%(ext)s',
    audioOnly: false,
    subtitle: { language: 'en', auto: false },
  })
  assert.ok(manual.includes('--write-subs'))
  assert.ok(!manual.includes('--write-auto-subs'))
  assert.deepEqual(
    manual.slice(
      manual.indexOf('--sub-langs'),
      manual.indexOf('--sub-langs') + 2
    ),
    ['--sub-langs', 'en']
  )
  assert.deepEqual(
    manual.slice(
      manual.indexOf('--convert-subs'),
      manual.indexOf('--convert-subs') + 2
    ),
    ['--convert-subs', 'srt']
  )

  const auto = buildDownloadArgs('https://example.com/v', {
    output: '/tmp/media.%(ext)s',
    audioOnly: false,
    subtitle: { language: 'zh-Hans', auto: true },
  })
  assert.ok(auto.includes('--write-auto-subs'))
  assert.deepEqual(
    auto.slice(auto.indexOf('--sub-langs'), auto.indexOf('--sub-langs') + 2),
    ['--sub-langs', 'zh-Hans']
  )
})

test('buildDownloadArgs 音频模式不合并、不指定视频格式', () => {
  const args = buildDownloadArgs('https://example.com/v', {
    output: '/tmp/media.%(ext)s',
    audioOnly: true,
  })
  assert.deepEqual(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2), [
    '-f',
    'ba[ext=m4a]/ba/b',
  ])
  assert.ok(!args.includes('--merge-output-format'))
})

test('parseProgressLine 解析字节、速度与剩余时间', () => {
  assert.deepEqual(
    parseProgressLine('vt-progress 1048576 2097152 NA 524288 42'),
    {
      downloaded: 1048576,
      total: 2097152,
      speed: 524288,
      eta: 42,
    }
  )
  assert.deepEqual(parseProgressLine('vt-progress 100 NA 300 NA NA'), {
    downloaded: 100,
    total: 300,
    speed: null,
    eta: null,
  })
  assert.equal(parseProgressLine('[download] 45.2% of 100MiB'), null)
  assert.equal(parseProgressLine('vt-progress NA 100 NA NA NA'), null)
})

test('ProgressTracker 把逐个流的字节累计成整体进度', () => {
  const tracker = new ProgressTracker()
  assert.deepEqual(
    tracker.update({ downloaded: 100, total: 200, speed: 10, eta: 5 }),
    {
      done: 100,
      total: 200,
      speed: 10,
      eta: 5,
    }
  )
  // 第二个流从 0 开始：前一个流的 100 计入基数
  assert.deepEqual(
    tracker.update({ downloaded: 50, total: 300, speed: null, eta: null }),
    {
      done: 150,
      total: 400,
      speed: null,
      eta: null,
    }
  )
  assert.equal(
    tracker.update({ downloaded: 60, total: 300, speed: 1, eta: 1 }).done,
    160
  )
})

test('classifyFailure 区分登录、Cookie、工具过期与网络问题', () => {
  const login = classifyFailure(
    'ERROR: Sign in to confirm you are not a bot. Use --cookies-from-browser',
    1
  )
  assert.equal(login.code, 'LOGIN_REQUIRED')
  assert.match(login.message, /建议：/)
  assert.equal(worthAnotherCookieBrowser(login), true)

  assert.equal(
    classifyFailure('ERROR: Could not copy Chrome cookie database', 1).code,
    'COOKIES_UNAVAILABLE'
  )
  assert.equal(
    classifyFailure('ERROR: Unable to extract nsig', 1).code,
    'TOOL_UPDATE_REQUIRED'
  )
  assert.equal(
    classifyFailure('ERROR: Unsupported URL: https://example.com/x', 1).code,
    'UNSUPPORTED'
  )
  assert.equal(
    classifyFailure('ERROR: Video unavailable', 1).code,
    'UNAVAILABLE'
  )
  assert.equal(
    classifyFailure('ERROR: unable to download video: HTTP Error 503', 1).code,
    'NETWORK'
  )
  assert.equal(
    classifyFailure('ERROR: [Errno 28] No space left on device', 1).code,
    'DISK_FULL'
  )
  assert.equal(
    classifyFailure('ERROR: HTTP Error 403: Forbidden', 1).code,
    'DOWNLOAD_FAILED'
  )
  assert.equal(worthAnotherCookieBrowser(login), true)
  assert.equal(
    worthAnotherCookieBrowser(new YtDlpError('DOWNLOAD_FAILED', '下载失败。')),
    false
  )
})

test('classifyFailure 对报错里的链接脱敏', () => {
  const error = classifyFailure(
    'ERROR: unable to download https://cdn.example.com/a?token=secret: HTTP Error 500',
    1
  )
  assert.doesNotMatch(error.message, /token=secret/)
  assert.match(error.detail ?? '', /cdn\.example\.com\/a/)
})

test('sanitizeFileName / buildOutputBaseName 保留中文并去掉危险字符', () => {
  assert.equal(sanitizeFileName('  ../a/b:c*?  '), 'a b c')
  assert.equal(sanitizeFileName('   '), '在线视频')
  assert.equal(
    buildOutputBaseName('标题/片段', 'abc-123'),
    '标题 片段 [abc-123]'
  )
  assert.equal(buildOutputBaseName('标题', ''), '标题')
  assert.ok(
    Buffer.byteLength(sanitizeFileName('长'.repeat(300)), 'utf8') <= 160
  )
  assert.ok(
    Buffer.byteLength(
      buildOutputBaseName('长'.repeat(300), 'abc-123'),
      'utf8'
    ) < 200
  )
})

test('parseVideoInfo 读取标题、时长与字幕轨', () => {
  const info = parseVideoInfo(
    JSON.stringify({
      _type: 'video',
      id: 'abc',
      title: ' 测试视频 ',
      uploader: '频道',
      duration: 125.5,
      webpage_url: 'https://example.com/watch?v=abc',
      extractor_key: 'Youtube',
      subtitles: { en: [], 'zh-Hans': [], live_chat: [] },
      automatic_captions: { en: [], 'en-orig': [], danmaku: [] },
    })
  )
  assert.equal(info.title, '测试视频')
  assert.equal(info.durationSec, 125.5)
  assert.deepEqual(info.manualSubtitles, ['en', 'zh-Hans'])
  assert.deepEqual(info.autoSubtitles, ['en', 'en-orig'])
})

test('parseVideoInfo 拒绝播放列表与直播', () => {
  assert.throws(
    () => parseVideoInfo(JSON.stringify({ _type: 'playlist' })),
    (error: unknown) =>
      error instanceof YtDlpError && error.code === 'UNSUPPORTED'
  )
  assert.throws(
    () => parseVideoInfo(JSON.stringify({ _type: 'video', is_live: true })),
    (error: unknown) =>
      error instanceof YtDlpError && error.code === 'UNSUPPORTED'
  )
  assert.throws(
    () => parseVideoInfo('not json'),
    (error: unknown) =>
      error instanceof YtDlpError && error.code === 'DOWNLOAD_FAILED'
  )
})

test('selectSubtitleTrack 人工字幕优先于同语言自动字幕', () => {
  const selected = selectSubtitleTrack(
    {
      manualSubtitles: ['en'],
      autoSubtitles: ['en', 'en-orig', 'zh-Hans'],
    },
    { sourceLanguage: 'en', targetLanguage: 'zh' }
  )
  assert.deepEqual(selected, { language: 'en', auto: false })

  const chinese = selectSubtitleTrack(
    { manualSubtitles: ['zh-Hans'], autoSubtitles: ['en'] },
    { sourceLanguage: 'zh', targetLanguage: 'en' }
  )
  assert.deepEqual(chinese, { language: 'zh-Hans', auto: false })
})
