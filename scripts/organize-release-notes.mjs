#!/usr/bin/env node

/**
 * Organize GitHub auto-generated release notes by Conventional Commit type.
 *
 * Inspired by web-infra-dev/rsbuild's create-draft-release-notes.mjs:
 * reads notes that look like GitHub `--generate-notes` output, groups PR
 * bullets under Breaking / Features / Performance / Fixes / etc., and
 * leaves the rest of the document (Full Changelog link, etc.) intact.
 *
 * Usage:
 *   node scripts/organize-release-notes.mjs [release-notes.md]
 *   gh release view v1.0.0 --json body --jq .body | node scripts/organize-release-notes.mjs
 */

import { readFile } from 'node:fs/promises'
import { argv, stdin, stdout, stderr } from 'node:process'
import { pathToFileURL } from 'node:url'

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

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  try {
    if (argv.length > 3) {
      throw new Error('Usage: organize-release-notes.mjs [release-notes.md]')
    }

    stdout.write(organize(await readMarkdown(argv[2])))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
