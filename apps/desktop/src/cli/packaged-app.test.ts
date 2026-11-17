import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  CLI_BOOTSTRAP_NAME,
  PACKAGED_EXECUTABLE_NAME,
  renderLaunchShim,
  resolvePackagedCliTarget,
} from './packaged-app'

test('安装包存在 bootstrap 时解析为 packaged 目标', () => {
  const appPath = path.join(os.tmpdir(), `vt-app-${Date.now()}.app`)
  const macOs = path.join(appPath, 'Contents', 'MacOS')
  const resources = path.join(appPath, 'Contents', 'Resources')
  mkdirSync(macOs, { recursive: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(path.join(macOs, PACKAGED_EXECUTABLE_NAME), '')
  writeFileSync(path.join(resources, CLI_BOOTSTRAP_NAME), '')
  const target = resolvePackagedCliTarget(appPath)
  assert.ok(target)
  assert.equal(target.kind, 'packaged')
  assert.equal(target.appPath, path.resolve(appPath))
})

test('缺少 bootstrap 时不把旧版安装包当成 CLI', () => {
  const appPath = path.join(os.tmpdir(), `vt-old-${Date.now()}.app`)
  const macOs = path.join(appPath, 'Contents', 'MacOS')
  mkdirSync(macOs, { recursive: true })
  writeFileSync(path.join(macOs, PACKAGED_EXECUTABLE_NAME), '')
  assert.equal(resolvePackagedCliTarget(appPath), null)
})

test('packaged shim 走 ELECTRON_RUN_AS_NODE', () => {
  const shim = renderLaunchShim({
    kind: 'packaged',
    appPath: '/Applications/视频翻译助手.app',
    electronBin: '/Applications/视频翻译助手.app/Contents/MacOS/视频翻译助手',
    bootstrap:
      '/Applications/视频翻译助手.app/Contents/Resources/cli-bootstrap.cjs',
  })
  assert.ok(shim.startsWith('#!/bin/sh'))
  assert.ok(shim.includes('ELECTRON_RUN_AS_NODE=1'))
  assert.ok(shim.includes('cli-bootstrap.cjs'))
})
