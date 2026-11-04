import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'

type MockAsrResult = { text?: string; lang?: string }
type MockChunk = { path: string; startTime: number; duration: number }

const mocks = vi.hoisted(() => ({
  recognize: vi.fn<() => Promise<MockAsrResult>>(),
  getMediaDuration: vi.fn<() => Promise<number>>(),
  segmentAudio: vi.fn<() => Promise<MockChunk[]>>(),
  detectSpeechSpans:
    vi.fn<() => Promise<Array<{ start: number; end: number }>>>(),
}))

vi.mock('./asr-worker-host', () => ({
  asrWorkerHost: {
    recognize: mocks.recognize,
    dispose: vi.fn<() => void>(),
  },
}))
vi.mock('../ffmpeg/processor', () => ({
  ffmpegProcessor: {
    getMediaDuration: mocks.getMediaDuration,
    segmentAudio: mocks.segmentAudio,
    detectSpeechSpans: mocks.detectSpeechSpans,
  },
}))

import { SherpaTranscriber } from './sherpa-transcriber'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  mocks.recognize.mockReset()
  mocks.getMediaDuration.mockReset()
  mocks.segmentAudio.mockReset()
  mocks.detectSpeechSpans.mockReset()
  await Promise.all(
    tempDirs.splice(0).map(directory => fs.rm(directory, { recursive: true }))
  )
})

function setupTranscriber() {
  const transcriber = new SherpaTranscriber()
  vi.spyOn(transcriber, 'isAvailable').mockResolvedValue(true)
  mocks.getMediaDuration.mockResolvedValue(100)
  mocks.segmentAudio.mockResolvedValue([
    { path: '/tmp/asr-chunk-0.wav', startTime: 0, duration: 40 },
    { path: '/tmp/asr-chunk-1.wav', startTime: 40, duration: 40 },
  ])
  mocks.detectSpeechSpans.mockResolvedValue([])
  return transcriber
}

describe('SherpaTranscriber chunk checkpoint and abort', () => {
  test('恢复已成功块，空白结果也不会再次调用 worker', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'asr-transcriber-')
    )
    tempDirs.push(directory)
    const transcriber = setupTranscriber()
    mocks.recognize
      .mockResolvedValueOnce({ text: '   ', lang: 'zh' })
      .mockResolvedValueOnce({ text: 'hello', lang: 'en' })

    const options = {
      chunkThresholdSec: 1,
      checkpointDir: directory,
      checkpointKey: 'source-fingerprint-v1',
    }
    const first = await transcriber.transcribe('/tmp/input.wav', options)
    assert.equal(first.rawText, 'hello')
    assert.equal(mocks.recognize.mock.calls.length, 2)

    mocks.recognize.mockClear()
    const resumed = await transcriber.transcribe('/tmp/input.wav', options)
    assert.equal(resumed.rawText, 'hello')
    assert.equal(resumed.segments.length, 1)
    assert.equal(mocks.recognize.mock.calls.length, 0)
  })

  test('块完成但 signal 已取消时抛 AbortError 且不发布结果', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'asr-transcriber-')
    )
    tempDirs.push(directory)
    const transcriber = setupTranscriber()
    const controller = new AbortController()
    let resolveRecognition: ((result: MockAsrResult) => void) | undefined
    mocks.recognize.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRecognition = resolve
        })
    )
    const partial = vi.fn<(segments: unknown[]) => void>()
    const pending = transcriber.transcribe('/tmp/input.wav', {
      chunkThresholdSec: 1,
      checkpointDir: directory,
      checkpointKey: 'source-fingerprint-v1',
      signal: controller.signal,
      onPartialSegments: partial,
    })

    await vi.waitFor(() => assert.equal(mocks.recognize.mock.calls.length, 1))
    controller.abort()
    resolveRecognition?.({ text: 'late result' })

    await assert.rejects(
      pending,
      error => error instanceof Error && error.name === 'AbortError'
    )
    assert.equal(partial.mock.calls.length, 0)
    assert.deepEqual(await fs.readdir(directory), [])
  })
})
