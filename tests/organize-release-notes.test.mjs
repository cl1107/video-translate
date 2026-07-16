import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import {
  applyReleasePreamble,
  classify,
  commitsToBullets,
  filterCommitSubjects,
  hasChangeItems,
  injectWhatsChanged,
  organize,
  parseCliArgs,
  parseCompareTags,
  PREAMBLE_END,
  PREAMBLE_START,
  prepareAndOrganize,
  RELEASE_NOTES_PREAMBLE,
  stripReleasePreamble,
} from '../scripts/organize-release-notes.mjs'

const execFileAsync = promisify(execFile)

test('classify maps conventional commit prefixes', () => {
  assert.equal(classify('* feat: add upload by @a in #1'), 'feat')
  assert.equal(classify('* feat(desktop): dark mode by @a in #2'), 'feat')
  assert.equal(classify('* feature: alias by @a in #3'), 'feat')
  assert.equal(classify('* fix: crash on empty file by @a in #4'), 'fix')
  assert.equal(classify('* fix!: drop legacy API by @a in #5'), 'breaking')
  assert.equal(classify('* breaking: rename config by @a in #6'), 'breaking')
  assert.equal(classify('* perf: speed up asr by @a in #7'), 'perf')
  assert.equal(classify('* refactor: extract util by @a in #8'), 'refactor')
  assert.equal(classify('* docs: update readme by @a in #9'), 'docs')
  assert.equal(classify('* doc: short alias by @a in #10'), 'docs')
  assert.equal(classify('* chore: bump deps by @a in #11'), 'other')
  assert.equal(classify('* plain title without type by @a in #12'), 'other')
})

test('organize groups bullets and preserves Full Changelog', () => {
  const input = `## What's Changed
* chore: ignore me by @bot in #1
* fix: repair crash by @dev in #2
* feat(ui): new panel by @dev in #3
* docs: install guide by @dev in #4

**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.3.0...v0.4.0
`

  const output = organize(input)

  assert.match(output, /## What's Changed/)
  assert.match(output, /### New Features 🎉/)
  assert.match(output, /### Bug Fixes 🐞/)
  assert.match(output, /### Document 📖/)
  assert.match(output, /### Other Changes/)
  assert.ok(
    output.indexOf('### New Features') < output.indexOf('* feat(ui): new panel')
  )
  assert.ok(
    output.indexOf('### Bug Fixes') < output.indexOf('* fix: repair crash')
  )
  assert.match(
    output,
    /\*\*Full Changelog\*\*: https:\/\/github\.com\/cl1107\/video-translate\/compare\/v0\.3\.0\.\.\.v0\.4\.0/
  )

  // Category order: Features before Fixes before Docs before Other
  const featPos = output.indexOf('### New Features')
  const fixPos = output.indexOf('### Bug Fixes')
  const docsPos = output.indexOf('### Document')
  const otherPos = output.indexOf('### Other Changes')
  assert.ok(featPos < fixPos && fixPos < docsPos && docsPos < otherPos)
})

test("organize is a no-op when What's Changed is missing", () => {
  const input =
    '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.3.0...v0.4.0\n'
  assert.equal(organize(input), input)
})

test('organize drops empty category headings from re-run input', () => {
  const input = `## What's Changed
### Other Changes
* feat: already mixed by @a in #1
* fix: also mixed by @a in #2

**Full Changelog**: v0.1.0...v0.2.0
`

  const output = organize(input)
  assert.match(output, /### New Features 🎉/)
  assert.match(output, /### Bug Fixes 🐞/)
  assert.doesNotMatch(output, /### Other Changes/)
})

test('hasChangeItems detects bullets under What\'s Changed', () => {
  assert.equal(
    hasChangeItems(`## What's Changed
* feat: x

**Full Changelog**: a...b
`),
    true
  )
  assert.equal(
    hasChangeItems(
      '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.4.1...v0.5.0\n'
    ),
    false
  )
  assert.equal(
    hasChangeItems(`## What's Changed

**Full Changelog**: a...b
`),
    false
  )
})

test('filterCommitSubjects drops release bumps', () => {
  assert.deepEqual(
    filterCommitSubjects([
      'chore(release): 发布 v0.5.0',
      'feat(desktop): online links',
      '',
      'refactor: simplify',
      'chore(release): release v0.4.0',
    ]),
    ['feat(desktop): online links', 'refactor: simplify']
  )
})

test('commitsToBullets prefixes subjects', () => {
  assert.deepEqual(commitsToBullets(['feat: a', 'fix: b']), [
    '* feat: a',
    '* fix: b',
  ])
})

test('parseCompareTags reads Full Changelog range', () => {
  assert.deepEqual(
    parseCompareTags(
      '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.4.1...v0.5.0\n'
    ),
    { previousTag: 'v0.4.1', tag: 'v0.5.0' }
  )
  assert.deepEqual(parseCompareTags('**Full Changelog**: v0.1.0...v0.2.0\n'), {
    previousTag: 'v0.1.0',
    tag: 'v0.2.0',
  })
  assert.equal(parseCompareTags('no link here'), null)
})

test('injectWhatsChanged places section before Full Changelog', () => {
  const output = injectWhatsChanged(
    '**Full Changelog**: https://example.com/compare/v1...v2\n',
    ['* feat: one', '* fix: two']
  )
  assert.match(output, /## What's Changed/)
  assert.ok(output.indexOf('* feat: one') < output.indexOf('**Full Changelog**'))
})

test('prepareAndOrganize falls back to commits when GitHub notes are empty', () => {
  const input =
    '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.4.1...v0.5.0\n'

  const output = prepareAndOrganize(input, {
    commits: [
      'chore(release): 发布 v0.5.0',
      'feat(landing): 更新官网并完善 GitHub Pages 部署',
      'feat(desktop): 支持在线链接下载与平台字幕优先',
      'refactor(desktop): 拆分翻译流水线并固化任务配置持久化',
      'feat: 支持BYOK在线润色后端',
      'refactor: 简化 Ollama 模型规范化逻辑',
      'feat: 添加字幕颜色自定义功能',
    ],
  })

  assert.match(output, /## What's Changed/)
  assert.match(output, /### New Features 🎉/)
  assert.match(output, /### Refactor 🔨/)
  assert.match(output, /\* feat\(landing\): 更新官网并完善 GitHub Pages 部署/)
  assert.match(output, /\* refactor\(desktop\): 拆分翻译流水线/)
  assert.doesNotMatch(output, /chore\(release\)/)
  assert.match(
    output,
    /\*\*Full Changelog\*\*: https:\/\/github\.com\/cl1107\/video-translate\/compare\/v0\.4\.1\.\.\.v0\.5\.0/
  )

  const featPos = output.indexOf('### New Features')
  const refactorPos = output.indexOf('### Refactor')
  assert.ok(featPos < refactorPos)
})

test('prepareAndOrganize keeps PR notes and does not use commits', () => {
  const input = `## What's Changed
* feat: from pr by @a in #1
* fix: from pr by @a in #2

**Full Changelog**: https://github.com/x/y/compare/v1...v2
`

  const output = prepareAndOrganize(input, {
    commits: ['feat: should not appear', 'chore: also not'],
  })

  assert.match(output, /\* feat: from pr/)
  assert.doesNotMatch(output, /should not appear/)
})

test('prepareAndOrganize uses gitExec when notes empty and tag given', () => {
  const input =
    '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.4.1...v0.5.0\n'
  const ranges = []

  const output = prepareAndOrganize(input, {
    tag: 'v0.5.0',
    gitExec: (range) => {
      ranges.push(range)
      return [
        'chore(release): 发布 v0.5.0',
        'feat: from git',
        'fix: from git too',
      ].join('\n')
    },
  })

  assert.deepEqual(ranges, ['v0.4.1..v0.5.0'])
  assert.match(output, /### New Features 🎉/)
  assert.match(output, /\* feat: from git/)
  assert.match(output, /### Bug Fixes 🐞/)
  assert.doesNotMatch(output, /chore\(release\)/)
  // 固定前言：包类型 + 非签名说明
  assert.match(output, /bundled-ffmpeg/)
  assert.match(output, /slim/)
  assert.match(output, /非签名/)
  assert.ok(output.indexOf(PREAMBLE_START) < output.indexOf("## What's Changed"))
})

test('release preamble is applied idempotently', () => {
  const body = `## What's Changed
* feat: x

**Full Changelog**: a...b
`
  const once = applyReleasePreamble(body)
  const twice = applyReleasePreamble(once)
  assert.equal(
    once.split(PREAMBLE_START).length - 1,
    1,
    'preamble appears once'
  )
  assert.equal(twice, once)
  assert.match(RELEASE_NOTES_PREAMBLE, /bundled-ffmpeg/)
  assert.match(RELEASE_NOTES_PREAMBLE, /xattr -cr/)
  assert.match(RELEASE_NOTES_PREAMBLE, /SmartScreen|仍要运行/)
  assert.match(RELEASE_NOTES_PREAMBLE, /chmod \+x/)
  const stripped = stripReleasePreamble(once)
  assert.doesNotMatch(stripped, new RegExp(PREAMBLE_START))
  assert.match(stripped, /## What's Changed/)
  assert.ok(once.includes(PREAMBLE_END))
})

test('prepareAndOrganize can skip preamble when requested', () => {
  const input = `## What's Changed
* fix: a by @u in #1

**Full Changelog**: a...b
`
  const output = prepareAndOrganize(input, { skipPreamble: true })
  assert.doesNotMatch(output, new RegExp(PREAMBLE_START))
  assert.match(output, /### Bug Fixes/)
})

test('parseCliArgs accepts --tag and file', () => {
  assert.deepEqual(parseCliArgs(['--tag', 'v0.5.0', 'notes.md']), {
    tag: 'v0.5.0',
    file: 'notes.md',
  })
  assert.deepEqual(parseCliArgs(['notes.md']), { file: 'notes.md' })
  assert.deepEqual(parseCliArgs(['--tag', 'v1.0.0']), { tag: 'v1.0.0' })
  assert.throws(() => parseCliArgs(['--tag']), /Usage/)
  assert.throws(() => parseCliArgs(['a.md', 'b.md']), /Usage/)
})

test('CLI reads a file and prints organized markdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'org-notes-'))
  try {
    const file = join(dir, 'notes.md')
    await writeFile(
      file,
      `## What's Changed
* fix: a bug by @u in #1
* feat: a feature by @u in #2

**Full Changelog**: a...b
`
    )

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/organize-release-notes.mjs',
      file,
    ])

    assert.match(stdout, /### New Features 🎉/)
    assert.match(stdout, /### Bug Fixes 🐞/)
    assert.match(stdout, /\*\*Full Changelog\*\*: a\.\.\.b/)
    assert.match(stdout, /bundled-ffmpeg/)
    assert.match(stdout, /非签名/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI --tag falls back to git log when notes lack bullets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'org-notes-git-'))
  try {
    const file = join(dir, 'notes.md')
    await writeFile(
      file,
      '**Full Changelog**: https://github.com/cl1107/video-translate/compare/v0.4.1...v0.5.0\n'
    )

    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/organize-release-notes.mjs',
      '--tag',
      'v0.5.0',
      file,
    ])

    assert.match(stdout, /## What's Changed/)
    assert.match(stdout, /### New Features 🎉/)
    assert.match(stdout, /feat\(landing\)|feat\(desktop\)|feat:/)
    assert.doesNotMatch(stdout, /chore\(release\): 发布 v0\.5\.0/)
    assert.match(stdout, /\*\*Full Changelog\*\*:/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
