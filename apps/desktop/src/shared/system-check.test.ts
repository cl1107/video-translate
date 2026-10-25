import assert from 'node:assert/strict'
import { test } from 'vitest'
import { areRequiredSystemDependenciesReady } from './system-check'

test('可选依赖缺失仍允许进入工作台', () => {
  assert.equal(
    areRequiredSystemDependenciesReady([
      { name: 'ffmpeg', available: true },
      { name: 'sherpa-onnx-asr', available: true },
      { name: 'yt-dlp', available: false, optional: true },
    ]),
    true
  )
})

test('核心依赖缺失时阻止进入工作台', () => {
  assert.equal(
    areRequiredSystemDependenciesReady([
      { name: 'ffmpeg', available: false },
      { name: 'sherpa-onnx-asr', available: true },
    ]),
    false
  )
})
