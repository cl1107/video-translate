import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'vitest'
import type { AsrChunkCheckpointOptions } from './chunk-checkpoint'
import {
  getAsrChunkCheckpointPath,
  loadAsrChunkCheckpoint,
  saveAsrChunkCheckpoint,
} from './chunk-checkpoint'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(directory => fs.rm(directory, { recursive: true }))
  )
})

function checkpointOptions(directory: string): AsrChunkCheckpointOptions {
  return {
    checkpointDir: directory,
    checkpointKey: 'source-fingerprint-v1',
    chunk: { start: 12.3456789, duration: 4.5678912 },
    config: {
      engine: 'sensevoice',
      language: 'zh',
      provider: 'cpu',
      maxChunkSec: 45,
    },
  }
}

describe('ASR chunk checkpoint', () => {
  test('真实文件原子缓存可保存并恢复空白识别结果', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'asr-cp-'))
    tempDirs.push(directory)
    const options = checkpointOptions(directory)
    const result = { text: '   ', lang: 'zh' }

    await saveAsrChunkCheckpoint({
      ...options,
      result,
      segments: [],
    })

    const restored = await loadAsrChunkCheckpoint(options)
    assert.deepEqual(restored?.result, result)
    assert.deepEqual(restored?.segments, [])
    assert.equal(restored?.chunk.start, 12.345679)
    assert.equal(restored?.chunk.duration, 4.567891)

    const files = await fs.readdir(directory)
    assert.deepEqual(files, [path.basename(getAsrChunkCheckpointPath(options))])
  })

  test('不同源指纹或 ASR 配置不会误命中缓存', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'asr-cp-'))
    tempDirs.push(directory)
    const options = checkpointOptions(directory)
    await saveAsrChunkCheckpoint({
      ...options,
      result: { text: 'cached' },
      segments: [],
    })

    assert.equal(
      await loadAsrChunkCheckpoint({
        ...options,
        checkpointKey: 'another-source',
      }),
      null
    )
    assert.equal(
      await loadAsrChunkCheckpoint({
        ...options,
        config: { ...options.config, maxChunkSec: 30 },
      }),
      null
    )
  })
})
