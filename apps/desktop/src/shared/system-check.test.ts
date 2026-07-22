import assert from 'node:assert/strict'
import { test } from 'vitest'
import { areRequiredSystemDependenciesReady } from './system-check'

test('Ollama 缺失时仍允许进入工作台', () => {
  assert.equal(
    areRequiredSystemDependenciesReady([
      { name: 'ffmpeg', available: true },
      { name: 'sherpa-onnx-asr', available: true },
      { name: 'ollama', available: false },
    ]),
    true
  )
})

test('核心依赖缺失时仍阻止进入工作台', () => {
  assert.equal(
    areRequiredSystemDependenciesReady([
      { name: 'ffmpeg', available: false },
      { name: 'ollama', available: false },
    ]),
    false
  )
})
