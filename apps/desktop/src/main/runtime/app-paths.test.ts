import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import {
  APP_USER_DATA_NAME,
  configureAppPaths,
  defaultCliUserDataDir,
  defaultUserDataDir,
  getLogsDir,
  getUserDataDir,
  getUserDataSubdir,
  isAppPackaged,
  resetAppPathsForTests,
} from './app-paths'

afterEach(() => {
  resetAppPathsForTests()
  delete process.env.VIDEO_TRANSLATE_USER_DATA
})

test('configureAppPaths 覆盖默认路径', () => {
  const userData = path.join(os.tmpdir(), 'vt-paths-test')
  configureAppPaths({
    userData,
    logs: path.join(userData, 'logs'),
    isPackaged: true,
  })
  assert.equal(getUserDataDir(), path.resolve(userData))
  assert.equal(getLogsDir(), path.resolve(userData, 'logs'))
  assert.equal(isAppPackaged(), true)
  assert.equal(
    getUserDataSubdir('asr-checkpoints', 't1'),
    path.resolve(userData, 'asr-checkpoints', 't1')
  )
})

test('VIDEO_TRANSLATE_USER_DATA 在未 configure 时生效', () => {
  const userData = path.join(os.tmpdir(), 'vt-env-data')
  process.env.VIDEO_TRANSLATE_USER_DATA = userData
  assert.equal(getUserDataDir(), path.resolve(userData))
})

test('默认 userData 目录与桌面应用 productName 对齐', () => {
  const dir = defaultUserDataDir()
  assert.ok(dir.includes(APP_USER_DATA_NAME))
  assert.equal(defaultCliUserDataDir(), `${dir}-cli`)
})
