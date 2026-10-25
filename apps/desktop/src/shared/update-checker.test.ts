import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  applyUpdateCheckOutcome,
  compareVersions,
  isAutoCheckDue,
  normalizeVersionTag,
  parseLatestRelease,
  releaseNotesPreview,
  type UpdateCheckerStatus,
} from './update-checker'

const BASE_STATUS: UpdateCheckerStatus = {
  state: 'idle',
  currentVersion: '0.8.2',
  latest: null,
  lastCheckedAt: null,
  autoCheck: true,
  dismissedVersion: null,
  error: null,
}

describe('normalizeVersionTag', () => {
  test('剥掉 v 前缀并去除空白', () => {
    assert.equal(normalizeVersionTag('v0.8.2'), '0.8.2')
    assert.equal(normalizeVersionTag(' V1.2.3 '), '1.2.3')
    assert.equal(normalizeVersionTag('0.8.2'), '0.8.2')
  })
})

describe('compareVersions', () => {
  test('相等 / 大于 / 小于', () => {
    assert.equal(compareVersions('0.8.2', '0.8.2'), 0)
    assert.equal(compareVersions('0.8.3', '0.8.2'), 1)
    assert.equal(compareVersions('0.8.2', '0.8.10'), -1)
    assert.equal(compareVersions('0.9.0', '0.8.99'), 1)
    assert.equal(compareVersions('1.0.0', '0.99.99'), 1)
  })

  test('缺段当 0，读不懂的段当 0', () => {
    assert.equal(compareVersions('1.0', '1.0.0'), 0)
    assert.equal(compareVersions('1.0.0-beta', '1.0.0'), 0)
    assert.equal(compareVersions('1.0.x', '1.0.0'), 0)
  })
})

describe('isAutoCheckDue', () => {
  const HOUR = 60 * 60 * 1000

  test('从未检查过 → 到期', () => {
    assert.equal(isAutoCheckDue(null, 1000), true)
  })

  test('距上次不满间隔 → 不到期；满间隔 → 到期', () => {
    assert.equal(isAutoCheckDue(1000, 1000 + HOUR), false)
    assert.equal(isAutoCheckDue(1000, 1000 + 24 * HOUR), true)
  })

  test('时钟回拨（上次检查在未来）视为到期，避免停摆', () => {
    assert.equal(isAutoCheckDue(10_000, 5000), true)
  })
})

describe('parseLatestRelease', () => {
  test('解析标准 GitHub releases/latest 载荷', () => {
    const release = parseLatestRelease({
      tag_name: 'v0.9.0',
      name: 'v0.9.0',
      body: '## 修复\n- 修复了若干问题',
      html_url: 'https://github.com/cl1107/video-translate/releases/tag/v0.9.0',
      published_at: '2026-10-20T12:00:00Z',
      draft: false,
      prerelease: false,
    })
    assert.ok(release)
    assert.equal(release.version, '0.9.0')
    assert.equal(
      release.url,
      'https://github.com/cl1107/video-translate/releases/tag/v0.9.0'
    )
    assert.equal(release.publishedAt, '2026-10-20T12:00:00Z')
  })

  test('name 缺省回退为 tag', () => {
    const release = parseLatestRelease({
      tag_name: 'v0.9.0',
      html_url: 'https://github.com/cl1107/video-translate/releases/tag/v0.9.0',
    })
    assert.ok(release)
    assert.equal(release.name, 'v0.9.0')
    assert.equal(release.notes, '')
    assert.equal(release.publishedAt, null)
  })

  test('字段不合规整份拒绝', () => {
    assert.equal(parseLatestRelease(null), null)
    assert.equal(parseLatestRelease('nope'), null)
    assert.equal(parseLatestRelease([]), null)
    assert.equal(parseLatestRelease({ html_url: 'https://github.com/x' }), null)
    assert.equal(
      parseLatestRelease({
        tag_name: 'v0.9.0',
        html_url: 'http://evil.example.com/releases',
      }),
      null
    )
  })
})

describe('applyUpdateCheckOutcome', () => {
  const NEWER = {
    version: '0.9.0',
    name: 'v0.9.0',
    notes: '',
    url: 'https://github.com/cl1107/video-translate/releases/tag/v0.9.0',
    publishedAt: null,
  }

  test('start → checking，并清掉上一次的错误文案', () => {
    const next = applyUpdateCheckOutcome(
      { ...BASE_STATUS, state: 'error', error: 'GitHub 返回 HTTP 500' },
      { kind: 'start' }
    )
    assert.equal(next.state, 'checking')
    assert.equal(next.error, null)
  })

  test('发现更新的版本 → available', () => {
    const next = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'found',
      release: NEWER,
      at: 1000,
    })
    assert.equal(next.state, 'available')
    assert.equal(next.latest?.version, '0.9.0')
    assert.equal(next.lastCheckedAt, 1000)
  })

  test('不比本机新 → up-to-date，不保留 latest', () => {
    const next = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'found',
      release: { ...NEWER, version: '0.8.2' },
      at: 1000,
    })
    assert.equal(next.state, 'up-to-date')
    assert.equal(next.latest, null)
  })

  test('静默失败不打扰：保持 available 显示态，只记检查时间', () => {
    const available = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'found',
      release: NEWER,
      at: 1000,
    })
    const next = applyUpdateCheckOutcome(available, {
      kind: 'failure',
      at: 2000,
      manual: false,
      message: '网络错误',
    })
    assert.equal(next.state, 'available')
    assert.equal(next.latest?.version, '0.9.0')
    assert.equal(next.lastCheckedAt, 2000)
    assert.equal(next.error, null)
  })

  test('手动检查失败 → error 并带原因；但手里已有新版本时不冲掉 available', () => {
    const failed = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'failure',
      at: 1000,
      manual: true,
      message: '网络错误',
    })
    assert.equal(failed.state, 'error')
    assert.equal(failed.error, '网络错误')

    const available = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'found',
      release: NEWER,
      at: 1000,
    })
    const stillAvailable = applyUpdateCheckOutcome(available, {
      kind: 'failure',
      at: 2000,
      manual: true,
      message: '网络错误',
    })
    assert.equal(stillAvailable.state, 'available')
    assert.equal(stillAvailable.error, '网络错误')
  })

  test('已是最新清掉之前的 available 信息（版本被撤回的场景）', () => {
    const available = applyUpdateCheckOutcome(BASE_STATUS, {
      kind: 'found',
      release: NEWER,
      at: 1000,
    })
    const next = applyUpdateCheckOutcome(available, {
      kind: 'up-to-date',
      at: 2000,
    })
    assert.equal(next.state, 'up-to-date')
    assert.equal(next.latest, null)
  })
})

describe('releaseNotesPreview', () => {
  test('去掉 Markdown 标记并按行拼接', () => {
    const preview = releaseNotesPreview(
      '## 修复\n- [修复了崩溃](https://example.com)\n![截图](https://example.com/img.png)\n优化翻译速度',
      200
    )
    assert.equal(preview, '修复 · 修复了崩溃 · 优化翻译速度')
  })

  test('超长截断', () => {
    const preview = releaseNotesPreview('啊'.repeat(300), 10)
    assert.equal(preview.length, 11)
    assert.ok(preview.endsWith('…'))
  })
})
