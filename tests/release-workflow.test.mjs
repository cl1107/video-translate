import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'

const workflow = await readFile('.github/workflows/release.yml', 'utf8')
const execFileAsync = promisify(execFile)

test('发布工作流通过桌面包脚本执行 electron-builder', () => {
  assert.match(workflow, /pnpm --filter video-translate run build:ci/)
})

test('桌面包明确禁用 electron-builder 隐式发布', async () => {
  const desktopPackage = JSON.parse(
    await readFile('apps/desktop/package.json', 'utf8')
  )

  assert.equal(
    desktopPackage.scripts['build:ci'],
    'pnpm run prepare:ffmpeg && pnpm run rebuild:native && electron-builder --publish never'
  )
})

test('pnpm filter 在桌面包目录执行 CI 构建脚本', async () => {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  const { stdout } = await execFileAsync(pnpmCommand, [
    '--filter',
    'video-translate',
    'exec',
    'node',
    '-p',
    'process.cwd()',
  ])

  assert.equal(stdout.trim(), resolve('apps/desktop'))
})
