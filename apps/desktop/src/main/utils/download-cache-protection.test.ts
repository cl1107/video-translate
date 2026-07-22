import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'vitest'
import {
  isProtectedDownloadCacheEntry,
  resolveDownloadCacheProtection,
} from './download-cache-protection'

const taskRoot = path.resolve('downloads', 'task-1')

test('下载缓存清理保护源视频、平台字幕和结果目录', () => {
  const result = resolveDownloadCacheProtection(taskRoot, {
    videoFile: {
      path: path.join(taskRoot, 'video.mp4'),
    },
    platformSubtitlePath: path.join(taskRoot, 'video.ja.srt'),
    outputArtifacts: {
      outputDirectory: path.join(taskRoot, 'output'),
    },
  } as Parameters<typeof resolveDownloadCacheProtection>[1])

  assert.equal(result.preserveRoot, false)
  assert.equal(isProtectedDownloadCacheEntry(result, 'output'), true)
  assert.equal(isProtectedDownloadCacheEntry(result, 'video.ja.srt'), true)
  assert.equal(isProtectedDownloadCacheEntry(result, 'video.mp4'), true)
  assert.equal(isProtectedDownloadCacheEntry(result, 'temporary.part'), false)
})

test('结果目录就是任务根目录时保留整个目录', () => {
  const result = resolveDownloadCacheProtection(taskRoot, {
    videoFile: {
      path: path.resolve('outside', 'video.mp4'),
    },
    outputArtifacts: {
      outputDirectory: taskRoot,
    },
  } as Parameters<typeof resolveDownloadCacheProtection>[1])

  assert.equal(result.preserveRoot, true)
  assert.equal(result.topLevelEntries.size, 0)
})

test('忽略下载任务目录之外的文件', () => {
  const result = resolveDownloadCacheProtection(taskRoot, {
    videoFile: {
      path: path.resolve('outside', 'video.mp4'),
    },
  } as Parameters<typeof resolveDownloadCacheProtection>[1])

  assert.equal(result.preserveRoot, false)
  assert.equal(result.topLevelEntries.size, 0)
})
