import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../..')
const FORBIDDEN_TERM = ['whis', 'per'].join('')
const TEXT_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.json', '.yaml'])
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules'])

async function collectTextFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue

    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(entryPath)))
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

test('运行时代码、依赖清单和项目文档不再包含已移除的 ASR 方案', async () => {
  const files = await collectTextFiles(PROJECT_ROOT)
  const matches: string[] = []

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8')
    if (content.toLowerCase().includes(FORBIDDEN_TERM)) {
      matches.push(path.relative(PROJECT_ROOT, file))
    }
  }

  assert.deepEqual(matches, [])
})
