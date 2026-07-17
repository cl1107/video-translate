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

test('发布工作流使用固定版本的 GitHub Actions', () => {
  assert.match(workflow, /uses: actions\/checkout@v5/)
  assert.match(workflow, /uses: actions\/setup-node@v5/)
  assert.match(workflow, /uses: actions\/upload-artifact@v6/)
  assert.match(workflow, /uses: actions\/download-artifact@v6/)
})

test('发布工作流按 Conventional Commit 类型整理 release notes', () => {
  assert.match(workflow, /--generate-notes/)
  assert.match(
    workflow,
    /scripts\/organize-release-notes\.mjs --tag "\$RELEASE_TAG"/
  )
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --notes-file/)
  // publish job needs full history for git-log fallback when no PRs
  assert.match(workflow, /fetch-depth:\s*0/)
  // 创建或仅上传资产后，都会重新整理 notes（固定前言 + 变更分组）
  assert.match(workflow, /每次发布都整理 notes/)
})

test('固定 Release 前言精简说明 bundled/slim，并链到官网文档', async () => {
  const preamble = await readFile(
    'scripts/release-notes-preamble.md',
    'utf8'
  )
  assert.match(preamble, /bundled-ffmpeg/)
  assert.match(preamble, /slim/)
  assert.match(preamble, /xattr -cr/)
  assert.match(preamble, /SmartScreen|仍要运行/)
  assert.match(preamble, /SHA256SUMS/)
  assert.match(preamble, /cl1107\.github\.io\/video-translate\/docs/)
  // 完整安装步骤应在官网文档，不堆在 Release 正文
  assert.doesNotMatch(preamble, /chmod \+x/)
  assert.doesNotMatch(preamble, /## 非签名构建注意事项/)
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
