import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isBulkDeletableTaskStatus, TaskStatus } from './video'

test('批量删除仅允许完成、失败和取消任务', () => {
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.COMPLETED), true)
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.FAILED), true)
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.CANCELLED), true)
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.PENDING), false)
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.PAUSED), false)
  assert.equal(isBulkDeletableTaskStatus(TaskStatus.TRANSLATING), false)
})