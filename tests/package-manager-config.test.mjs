import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

const rootPackage = JSON.parse(await readFile('package.json', 'utf8'))
const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')
const pagesWorkflow = await readFile('.github/workflows/pages.yml', 'utf8')

test('根工作区固定 pnpm 11.12.0 供 Turbo 和本地 pnpm 解析', () => {
  assert.equal(rootPackage.packageManager, 'pnpm@11.12.0')
})

test('发布工作流显式固定与根配置一致的 pnpm 版本', () => {
  const setupStep = releaseWorkflow.match(
    /- name: Set up pnpm[\s\S]*?(?=\n\s+- name:)/
  )

  assert.ok(setupStep, '缺少 Set up pnpm 步骤')
  assert.match(
    releaseWorkflow,
    /- name: Set up pnpm\n\s+run: npm install --global pnpm@11\.12\.0/
  )
  assert.doesNotMatch(releaseWorkflow, /pnpm\/action-setup/)
  assert.match(releaseWorkflow, /^\s+package-manager-cache: false$/m)
})

test('Pages 工作流在安装 pnpm 后缓存 store，且不启用 setup-node 自动缓存', () => {
  assert.match(pagesWorkflow, /^\s+package-manager-cache: false$/m)
  assert.match(
    pagesWorkflow,
    /- name: Set up pnpm\n\s+run: npm install --global pnpm@11\.12\.0/
  )
  assert.match(pagesWorkflow, /uses: actions\/cache@v4/)
  assert.match(pagesWorkflow, /pnpm store path --silent/)
  assert.match(pagesWorkflow, /hashFiles\('pnpm-lock\.yaml'\)/)
  // 顺序：先装 pnpm，再取 store 路径，再 cache，再 install
  const pnpmPos = pagesWorkflow.indexOf('name: Set up pnpm')
  const storePos = pagesWorkflow.indexOf('name: Get pnpm store directory')
  const cachePos = pagesWorkflow.indexOf('name: Cache pnpm store')
  const installPos = pagesWorkflow.indexOf('name: Install dependencies')
  assert.ok(pnpmPos > 0 && storePos > pnpmPos)
  assert.ok(cachePos > storePos && installPos > cachePos)
})
