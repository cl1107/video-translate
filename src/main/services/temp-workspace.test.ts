import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { TempWorkspace } from './temp-workspace'

let workspace: TempWorkspace | undefined

afterEach(async () => {
  if (workspace) {
    await workspace.clearCache()
    workspace = undefined
  }
})

test('任务目录创建与删除', async () => {
  workspace = new TempWorkspace(
    path.join(tmpdir(), `vt-temp-test-${Date.now()}`)
  )
  const taskDir = await workspace.ensureTaskDir('task-abc')
  assert.equal(taskDir, workspace.getTaskDir('task-abc'))

  const filePath = path.join(taskDir, 'audio.wav')
  await writeFile(filePath, 'fake-audio')

  const stats = await workspace.getStats()
  assert.ok(stats.totalBytes > 0)
  assert.ok(stats.fileCount >= 1)

  await workspace.removeTaskDir('task-abc')
  const after = await workspace.getStats()
  assert.equal(after.fileCount, 0)
})

test('clearCache 保留排除的任务目录', async () => {
  workspace = new TempWorkspace(
    path.join(tmpdir(), `vt-temp-test-${Date.now()}`)
  )
  const keepDir = await workspace.ensureTaskDir('keep-me')
  const dropDir = await workspace.ensureTaskDir('drop-me')
  await writeFile(path.join(keepDir, 'a.bin'), 'keep')
  await writeFile(path.join(dropDir, 'b.bin'), 'drop')

  const result = await workspace.clearCache(['keep-me'])
  assert.ok(result.removedEntries >= 1)

  const stats = await workspace.getStats()
  assert.ok(stats.fileCount >= 1)
  assert.ok(stats.totalBytes > 0)
})

test('cleanupStale 清理过期扁平残留', async () => {
  workspace = new TempWorkspace(
    path.join(tmpdir(), `vt-temp-test-${Date.now()}`)
  )
  await workspace.ensureRoot()
  const legacyFile = path.join(workspace.rootDir, 'audio_old.wav')
  await writeFile(legacyFile, 'old')

  // maxAgeMs=0 表示全部视为过期
  const result = await workspace.cleanupStale(0)
  assert.ok(result.removedEntries >= 1)

  const stats = await workspace.getStats()
  assert.equal(stats.fileCount, 0)
})

test('sanitize 非法 taskId', async () => {
  workspace = new TempWorkspace(
    path.join(tmpdir(), `vt-temp-test-${Date.now()}`)
  )
  const dir = await workspace.ensureTaskDir('../evil/id')
  assert.ok(dir.includes('tasks'))
  assert.ok(!dir.includes('..'))
  await mkdir(dir, { recursive: true })
})
