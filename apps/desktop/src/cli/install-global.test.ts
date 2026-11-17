import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { installGlobalCli } from './install-global'
import { PACKAGED_EXECUTABLE_NAME, CLI_BOOTSTRAP_NAME } from './packaged-app'

test('有 bootstrap 的安装包写入 packaged shim', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vt-install-'))
  const appPath = path.join(root, '视频翻译助手.app')
  mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(path.join(appPath, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(
    path.join(appPath, 'Contents', 'MacOS', PACKAGED_EXECUTABLE_NAME),
    ''
  )
  writeFileSync(
    path.join(appPath, 'Contents', 'Resources', CLI_BOOTSTRAP_NAME),
    ''
  )
  const binPath = path.join(root, 'bin', 'vt')
  const result = installGlobalCli({ appPath, binPath })
  assert.equal(result.source, 'packaged')
  assert.equal(result.appPath, path.resolve(appPath))
  const shim = readFileSync(binPath, 'utf8')
  assert.ok(shim.includes('ELECTRON_RUN_AS_NODE=1'))
  assert.ok(shim.includes(CLI_BOOTSTRAP_NAME))
})

test('没有 bootstrap 时绑定源码 bin.mjs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vt-install-src-'))
  const appPath = path.join(root, 'missing.app')
  const binPath = path.join(root, 'vt')
  const result = installGlobalCli({
    appPath,
    binPath,
    nodeBin: 'node',
  })
  assert.equal(result.source, 'source')
  const shim = readFileSync(binPath, 'utf8')
  assert.ok(shim.includes('bin.mjs'))
  assert.equal(shim.includes('ELECTRON_RUN_AS_NODE'), false)
})
