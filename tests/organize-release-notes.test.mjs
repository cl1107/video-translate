import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import {
  classify,
  organize,
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

test('organize is a no-op when What\'s Changed is missing', () => {
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
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
