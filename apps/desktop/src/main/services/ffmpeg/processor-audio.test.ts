import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { FFmpegProcessor } from './processor'

let directory: string | undefined

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function fixture(options: {
  streams: number[]
  probeError?: string
  malformed?: boolean
}) {
  directory = await mkdtemp(path.join(tmpdir(), 'audio-extraction-'))
  const ffmpegPath = path.join(directory, 'ffmpeg')
  const ffprobePath = path.join(directory, 'ffprobe')
  const outputPath = path.join(directory, 'output.wav')
  const invocationPath = path.join(directory, 'extraction.log')
  await writeFile(
    path.join(directory, 'probe.json'),
    options.malformed
      ? '{broken'
      : JSON.stringify({ streams: options.streams.map(index => ({ index })) })
  )
  await writeFile(
    path.join(directory, 'probe-error.txt'),
    options.probeError || ''
  )
  await writeFile(
    ffprobePath,
    '#!/bin/sh\n' +
      (options.probeError
        ? 'cat "$(dirname "$0")/probe-error.txt" >&2\nexit 1\n'
        : 'cat "$(dirname "$0")/probe.json"\n')
  )
  await writeFile(
    ffmpegPath,
    '#!/bin/sh\n' +
      'printf \'%s\\n\' "$*" >> "$(dirname "$0")/extraction.log"\n' +
      (options.streams.length === 0
        ? "printf 'Output file does not contain any stream\\n' >&2\nexit 1\n"
        : 'for output do :; done\nprintf RIFF > "$output"\n')
  )
  await chmod(ffmpegPath, 0o755)
  await chmod(ffprobePath, 0o755)
  return {
    processor: new FFmpegProcessor(ffmpegPath, ffprobePath),
    outputPath,
    invocationPath,
    workDir: directory,
  }
}

test('无音轨文件在提取前明确失败，不运行 FFmpeg 或创建输出', async () => {
  const { processor, outputPath, invocationPath, workDir } = await fixture({
    streams: [],
  })
  await assert.rejects(
    processor.extractAudio('video-only.mp4', outputPath, undefined, workDir),
    /源文件没有音轨/
  )
  await assert.rejects(access(invocationPath))
  await assert.rejects(access(outputPath))
})

test.each([0, 1])('有音轨的输入（流索引 %s）正常提取', async index => {
  const { processor, outputPath, workDir } = await fixture({ streams: [index] })
  assert.equal(
    await processor.extractAudio('source.mp4', outputPath, undefined, workDir),
    outputPath
  )
  assert.equal(await readFile(outputPath, 'utf8'), 'RIFF')
})

test('源文件损坏时保留探测错误，不误报缺少音轨', async () => {
  const { processor, outputPath, invocationPath, workDir } = await fixture({
    streams: [0],
    probeError: 'Invalid data found when processing input',
  })
  await assert.rejects(
    processor.extractAudio('broken.mp4', outputPath, undefined, workDir),
    /无法检查源文件音轨: Invalid data found/
  )
  await assert.rejects(access(invocationPath))
})

test('探测响应格式错误时失败，不继续提取', async () => {
  const { processor, outputPath, invocationPath, workDir } = await fixture({
    streams: [0],
    malformed: true,
  })
  await assert.rejects(
    processor.extractAudio('source.mp4', outputPath, undefined, workDir),
    /无法解析源文件音轨信息/
  )
  await assert.rejects(access(invocationPath))
})
