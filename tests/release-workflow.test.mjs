import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'

const workflow = await readFile('.github/workflows/release.yml', 'utf8')
const execFileAsync = promisify(execFile)

test('默认发布工作流只构建 NSH macOS arm64，历史 Electron 必须显式选择', async () => {
  assert.match(workflow, /runs-on: macos-15/)
  assert.match(workflow, /pnpm make:release/)
  assert.match(workflow, /nsh test apps\/nsh/)
  assert.match(workflow, /apps\/nsh\/\.nsh\/release\/v\*\/\*\.zip/)
  assert.doesNotMatch(
    workflow,
    /electron-builder|build:ci|windows-2025|ubuntu-24.04.*build/
  )
  const legacy = await readFile(
    '.github/workflows/release-electron.yml',
    'utf8'
  )
  assert.match(legacy, /workflow_dispatch:/)
  assert.doesNotMatch(legacy, /^  push:/m)
})

test('NSH 发布验证实际产品版本，固定稳定工具链，禁止 Electron postinstall', () => {
  assert.match(workflow, /apps\/nsh\/nsh\.json/)
  assert.match(workflow, /apps\/nsh\/Cargo\.toml/)
  assert.match(workflow, /NSH_VERSION: v0\.4\.0/)
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/)
})

test('默认 release 命令仅生成本地 NSH 产物', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  assert.equal(root.scripts.release, './scripts/package-nsh.sh')
  assert.equal(root.scripts['make:release'], './scripts/package-nsh.sh')
  const script = await readFile('scripts/package-nsh.sh', 'utf8')
  assert.match(script, /pnpm build:desktop/)
  assert.match(script, /ditto -c -k/)
  assert.match(script, /shasum -a 256/)
  assert.doesNotMatch(script, /git push|gh release create|--publish always/)
})

test('发布工作流使用固定版本的 GitHub Actions', () => {
  assert.match(workflow, /uses: actions\/checkout@v7/)
  assert.match(workflow, /uses: actions\/setup-node@v7/)
  assert.match(workflow, /uses: actions\/upload-artifact@v7/)
  assert.match(workflow, /uses: actions\/download-artifact@v8/)
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

test('固定 Release 前言说明 NSH 安装、依赖与历史 Electron 包边界', async () => {
  const preamble = await readFile('scripts/release-notes-preamble.md', 'utf8')
  assert.match(preamble, /bundled-ffmpeg/)
  assert.match(preamble, /slim/)
  assert.match(preamble, /xattr -dr com\.apple\.quarantine/)
  assert.match(preamble, /NSH 原生 macOS arm64/)
  assert.match(preamble, /FFmpeg.*单独安装/)
  assert.match(preamble, /历史 v0\.8\.2/)
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
