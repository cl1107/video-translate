import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

const rootPackage = JSON.parse(await readFile('package.json', 'utf8'))
const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')

test('根工作区固定 pnpm 11.12.0 供 Turbo 和本地 pnpm 解析', () => {
  assert.equal(rootPackage.packageManager, 'pnpm@11.12.0')
})

test('发布工作流显式固定与根配置一致的 pnpm 版本', () => {
  const setupStep = releaseWorkflow.match(
    /- name: Set up pnpm[\s\S]*?(?=\n\s+- name:)/
  )

  assert.ok(setupStep, '缺少 Set up pnpm 步骤')
  assert.match(setupStep[0], /^\s+version: 11\.12\.0$/m)
  assert.match(setupStep[0], /^\s+standalone: true$/m)
})
