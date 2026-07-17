#!/usr/bin/env node

/**
 * Organize GitHub auto-generated release notes by Conventional Commit type.
 *
 * Inspired by web-infra-dev/rsbuild's create-draft-release-notes.mjs:
 * reads notes that look like GitHub `--generate-notes` output, groups PR
 * bullets under Breaking / Features / Performance / Fixes / etc., and
 * leaves the rest of the document (Full Changelog link, etc.) intact.
 *
 * When GitHub only emits a Full Changelog link (common for direct pushes
 * without merged PRs), falls back to `git log` subjects between the previous
 * and current tags, then organizes those bullets the same way.
 *
 * Usage:
 *   node scripts/organize-release-notes.mjs [release-notes.md]
 *   node scripts/organize-release-notes.mjs --tag v0.5.0 [release-notes.md]
 *   gh release view v1.0.0 --json body --jq .body | node scripts/organize-release-notes.mjs --tag v1.0.0
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { argv, stdin, stdout, stderr } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

/** 每个 Release 固定前置说明（精简包类型 + 非签名要点，详情链到官网文档） */
export const RELEASE_NOTES_PREAMBLE = readFileSync(
  join(scriptsDir, 'release-notes-preamble.md'),
  'utf8'
).trim()

export const PREAMBLE_START = '<!-- release-preamble:start -->'
export const PREAMBLE_END = '<!-- release-preamble:end -->'

/**
 * 去掉已有固定前言（便于重复跑 organize 时幂等更新）。
 *
 * @param {string} markdown
 * @returns {string}
 */
export function stripReleasePreamble(markdown) {
  const block = new RegExp(
    `${escapeRegExp(PREAMBLE_START)}[\\s\\S]*?${escapeRegExp(PREAMBLE_END)}\\s*`,
    'g'
  )
  return markdown.replace(block, '').replace(/^\s+/, '')
}

/**
 * 在变更日志前插入固定前言。
 *
 * @param {string} markdown
 * @param {string} [preamble=RELEASE_NOTES_PREAMBLE]
 * @returns {string}
 */
export function applyReleasePreamble(
  markdown,
  preamble = RELEASE_NOTES_PREAMBLE
) {
  const body = stripReleasePreamble(markdown)
  const block = `${PREAMBLE_START}\n${preamble.trim()}\n${PREAMBLE_END}`
  if (!body) {
    return `${block}\n`
  }
  return `${block}\n\n${body}`
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const categories = [
  ['breaking', '### Breaking Changes 🍭'],
  ['feat', '### New Features 🎉'],
  ['perf', '### Performance 🚀'],
  ['fix', '### Bug Fixes 🐞'],
  ['refactor', '### Refactor 🔨'],
  ['docs', '### Document 📖'],
  ['other', '### Other Changes'],
]

const typeMap = {
  feat: 'feat',
  feature: 'feat',
  perf: 'perf',
  fix: 'fix',
  refactor: 'refactor',
  docs: 'docs',
  doc: 'docs',
}

/** Match `* feat(scope): title` / `* fix!: title` style bullets. */
const itemRE = /^[*-]\s+([a-zA-Z]+)(?:\([^)]+\))?(!)?:\s+/

/**
 * GitHub sometimes joins two bullets on one line without a newline.
 * Split before a second `* type:` sequence that is not at line start.
 */
const joinedItemRE = /(?<!^)(?=\*\s+[a-zA-Z]+(?:\([^)]+\))?!?:\s+)/g

/** chore(release): / release: 类提交不进入变更列表（\b 对中文无效，故用空白/结尾锚定） */
const releaseCommitRE =
  /^(?:chore(?:\([^)]*\))?|release)!?:\s*(?:发布|release)(?:\s|$)/i

/**
 * @param {string | undefined} input
 * @returns {Promise<string>}
 */
async function readMarkdown(input) {
  if (input && input !== '-') {
    return readFile(input, 'utf8')
  }

  let markdown = ''
  stdin.setEncoding('utf8')

  for await (const chunk of stdin) {
    markdown += chunk
  }

  return markdown
}

/**
 * @param {string} item
 * @returns {string}
 */
export function classify(item) {
  const match = itemRE.exec(item)

  if (!match) {
    return 'other'
  }

  const type = match[1].toLowerCase()

  if (match[2] === '!' || type === 'breaking' || type === 'break') {
    return 'breaking'
  }

  return typeMap[type] ?? 'other'
}

/**
 * Whether the notes already contain list items under What's Changed
 * (or any top-level change bullets usable by organize).
 *
 * @param {string} markdown
 * @returns {boolean}
 */
export function hasChangeItems(markdown) {
  const heading = /^##\s+What's Changed\s*$/m.exec(markdown)

  if (!heading) {
    return false
  }

  const bodyStart = heading.index + heading[0].length
  const afterHeading = markdown.slice(bodyStart)
  const nextSection = /^(?:##\s+|\*\*Full Changelog\*\*:)/m.exec(afterHeading)
  const bodyEnd = nextSection ? bodyStart + nextSection.index : markdown.length
  const section = markdown.slice(bodyStart, bodyEnd)

  return /^(?:[*-]\s+\S)/m.test(section)
}

/**
 * Drop release-bump commits and empty subjects from a git log subject list.
 *
 * @param {string[]} subjects
 * @returns {string[]}
 */
export function filterCommitSubjects(subjects) {
  return subjects
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !releaseCommitRE.test(line))
}

/**
 * Turn commit subjects into GitHub-style bullets for organize().
 *
 * @param {string[]} subjects
 * @returns {string[]}
 */
export function commitsToBullets(subjects) {
  return filterCommitSubjects(subjects).map((subject) => `* ${subject}`)
}

/**
 * Parse previous/current tags from a Full Changelog compare URL if present.
 *
 * @param {string} markdown
 * @returns {{ previousTag: string, tag: string } | null}
 */
export function parseCompareTags(markdown) {
  const match =
    /\*\*Full Changelog\*\*:\s*https?:\/\/\S+\/compare\/([^\s/]+?)\.\.\.([^\s)/]+)/.exec(
      markdown
    ) ||
    /\*\*Full Changelog\*\*:\s*([^\s/]+?)\.\.\.([^\s\n]+)/.exec(markdown)

  if (!match) {
    return null
  }

  return { previousTag: match[1], tag: match[2] }
}

/**
 * Insert a What's Changed section with bullets before Full Changelog
 * (or at the top when that link is missing).
 *
 * @param {string} markdown
 * @param {string[]} bullets
 * @returns {string}
 */
export function injectWhatsChanged(markdown, bullets) {
  if (bullets.length === 0) {
    return markdown
  }

  const block = `## What's Changed\n${bullets.join('\n')}\n`
  const fullChangelog = /\*\*Full Changelog\*\*:/m.exec(markdown)

  if (fullChangelog) {
    const before = markdown.slice(0, fullChangelog.index).trimEnd()
    const after = markdown.slice(fullChangelog.index)
    return before ? `${before}\n\n${block}\n${after}` : `${block}\n${after}`
  }

  const trimmed = markdown.trim()
  return trimmed ? `${block}\n${trimmed}\n` : `${block}`
}

/**
 * Load commit subjects between previousTag (exclusive) and tag (inclusive)
 * via git. Returns [] when git is unavailable or the range is empty.
 *
 * @param {{ tag: string, previousTag?: string | null, gitExec?: typeof defaultGitLog }} options
 * @returns {string[]}
 */
export function loadCommitSubjects({
  tag,
  previousTag = null,
  gitExec = defaultGitLog,
}) {
  if (!tag) {
    return []
  }

  const range = previousTag ? `${previousTag}..${tag}` : tag

  try {
    const stdout = gitExec(range)
    if (!stdout.trim()) {
      return []
    }

    return stdout.split('\n')
  } catch {
    return []
  }
}

/**
 * @param {string} range
 * @returns {string}
 */
function defaultGitLog(range) {
  return execFileSync(
    'git',
    ['log', range, '--pretty=format:%s', '--no-merges'],
    { encoding: 'utf8' }
  )
}

/**
 * Resolve previous tag for fallback: Full Changelog URL first, then git.
 *
 * @param {string} markdown
 * @param {string | undefined} tag
 * @param {(tag: string) => string | null} [describePrevious]
 * @returns {string | null}
 */
export function resolvePreviousTag(
  markdown,
  tag,
  describePrevious = defaultDescribePrevious
) {
  const fromNotes = parseCompareTags(markdown)
  if (fromNotes?.previousTag) {
    return fromNotes.previousTag
  }

  if (!tag) {
    return null
  }

  return describePrevious(tag)
}

/**
 * @param {string} tag
 * @returns {string | null}
 */
function defaultDescribePrevious(tag) {
  try {
    const previous = execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', `${tag}^`],
      { encoding: 'utf8' }
    ).trim()
    return previous || null
  } catch {
    return null
  }
}

/**
 * If notes lack change bullets, inject ones from commit subjects (or git),
 * then re-group by Conventional Commit type.
 *
 * @param {string} markdown
 * @param {{
 *   tag?: string
 *   commits?: string[]
 *   gitExec?: typeof defaultGitLog
 *   describePrevious?: typeof defaultDescribePrevious
 * }} [options]
 * @returns {string}
 */
export function prepareAndOrganize(markdown, options = {}) {
  // 先去掉旧前言，再整理变更，最后重新挂上固定说明（保证每次 Release 内容一致）
  let notes = stripReleasePreamble(markdown)

  if (!hasChangeItems(notes)) {
    let subjects = options.commits

    if (!subjects) {
      const tag = options.tag ?? parseCompareTags(notes)?.tag
      if (tag) {
        const previousTag = resolvePreviousTag(
          notes,
          tag,
          options.describePrevious
        )
        subjects = loadCommitSubjects({
          tag,
          previousTag,
          gitExec: options.gitExec,
        })
      }
    }

    if (subjects?.length) {
      const bullets = commitsToBullets(subjects)
      notes = injectWhatsChanged(notes, bullets)
    }
  }

  const organized = organize(notes)
  if (options.skipPreamble) {
    return organized
  }
  return applyReleasePreamble(organized)
}

/**
 * Re-group the `## What's Changed` section. If that section is missing
 * (e.g. only a Full Changelog link), return the input unchanged.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function organize(markdown) {
  const heading = /^##\s+What's Changed\s*$/m.exec(markdown)

  if (!heading) {
    return markdown
  }

  const bodyStart = heading.index + heading[0].length
  const afterHeading = markdown.slice(bodyStart)
  const nextSection = /^(?:##\s+|\*\*Full Changelog\*\*:)/m.exec(afterHeading)
  const bodyEnd = nextSection ? bodyStart + nextSection.index : markdown.length
  /** @type {Record<string, string[]>} */
  const grouped = Object.fromEntries(categories.map(([key]) => [key, []]))
  /** @type {string[]} */
  const preserved = []

  for (const rawLine of markdown.slice(bodyStart, bodyEnd).split('\n')) {
    for (const line of rawLine.split(joinedItemRE)) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('### ')) {
        continue
      }

      if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        grouped[classify(trimmed)].push(trimmed)
      } else {
        preserved.push(line)
      }
    }
  }

  const lines = preserved.filter((line) => line.trim())

  for (const [key, title] of categories) {
    if (grouped[key].length > 0) {
      lines.push(title, ...grouped[key])
    }
  }

  if (lines.length === 0) {
    return markdown
  }

  const prefix = markdown.slice(0, bodyStart).trimEnd()
  const suffix = markdown.slice(bodyEnd).replace(/^\n+/, '')

  return suffix
    ? `${prefix}\n${lines.join('\n')}\n\n${suffix}`
    : `${prefix}\n${lines.join('\n')}\n`
}

/**
 * @param {string[]} args
 * @returns {{ tag?: string, file?: string }}
 */
export function parseCliArgs(args) {
  /** @type {{ tag?: string, file?: string }} */
  const result = {}
  const positional = []

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--tag') {
      const value = args[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error('Usage: organize-release-notes.mjs [--tag vX.Y.Z] [release-notes.md]')
      }
      result.tag = value
      i += 1
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error('Usage: organize-release-notes.mjs [--tag vX.Y.Z] [release-notes.md]')
    }
    positional.push(arg)
  }

  if (positional.length > 1) {
    throw new Error('Usage: organize-release-notes.mjs [--tag vX.Y.Z] [release-notes.md]')
  }

  if (positional[0]) {
    result.file = positional[0]
  }

  return result
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  try {
    const { tag, file } = parseCliArgs(argv.slice(2))
    const markdown = await readMarkdown(file)
    stdout.write(prepareAndOrganize(markdown, { tag }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
