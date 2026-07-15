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

test('发布工作流使用 Node 24 运行时的 GitHub Actions', () => {
  assert.match(workflow, /uses: actions\/checkout@v5/)
  assert.match(workflow, /uses: pnpm\/action-setup@v6/)
  assert.match(workflow, /uses: actions\/setup-node@v5/)
  assert.match(workflow, /uses: actions\/upload-artifact@v6/)
  assert.match(workflow, /uses: actions\/download-artifact@v6/)
})

test('发布工作流按 Conventional Commit 类型整理 release notes', () => {
  assert.match(workflow, /--generate-notes/)
  assert.match(workflow, /scripts\/organize-release-notes\.mjs/)
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --notes-file/)
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

test('桌面包提供 Linux 打包所需 homepage 与 desktopName', async () => {
  const desktopPackage = JSON.parse(
    await readFile('apps/desktop/package.json', 'utf8')
  )

  assert.equal(
    desktopPackage.homepage,
    'https://github.com/cl1107/video-translate'
  )
  assert.equal(desktopPackage.desktopName, 'video-translate.desktop')
  assert.equal(
    desktopPackage.repository?.url,
    'https://github.com/cl1107/video-translate.git'
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
