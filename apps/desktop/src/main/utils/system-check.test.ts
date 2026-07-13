import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  ensureGuiCommandPath,
  resetGuiCommandPathStateForTests,
  resolveBundledMediaCommandPath,
  resolveCommandPath,
} from './command-path'
import { checkSystemDependencies } from './system-check'
import type { SystemCheckProgress } from './system-check'

const originalPath = process.env.PATH
const originalHomebrewPrefix = process.env.HOMEBREW_PREFIX
let testDirectory: string | undefined

afterEach(async () => {
  process.env.PATH = originalPath
  resetGuiCommandPathStateForTests()

  if (originalHomebrewPrefix === undefined) {
    Reflect.deleteProperty(process.env, 'HOMEBREW_PREFIX')
  } else {
    process.env.HOMEBREW_PREFIX = originalHomebrewPrefix
  }

  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
    testDirectory = undefined
  }
})

test('macOS 图形应用的 PATH 缺少 Homebrew 时仍能识别 keg-only ffmpeg-full', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'video-translate-'))
  const binDirectory = path.join(testDirectory, 'opt', 'ffmpeg-full', 'bin')
  await mkdir(binDirectory, { recursive: true })

  for (const command of ['ffmpeg', 'ffprobe']) {
    const executablePath = path.join(binDirectory, command)
    await writeFile(
      executablePath,
      `#!/bin/sh\nprintf '${command} version 8.1.2\\n'\n`
    )
    await chmod(executablePath, 0o755)
  }

  process.env.PATH = '/usr/bin:/bin'
  process.env.HOMEBREW_PREFIX = testDirectory

  const results = await checkSystemDependencies({
    autoDownloadAsr: false,
    writeLog: false,
  })
  const mediaTools = results.filter(({ name }) =>
    ['ffmpeg', 'ffprobe'].includes(name)
  )

  assert.deepEqual(
    mediaTools.map(({ name, available, version }) => ({
      name,
      available,
      version,
    })),
    [
      { name: 'ffmpeg', available: true, version: '8.1.2' },
      { name: 'ffprobe', available: true, version: '8.1.2' },
    ]
  )
})

test('GUI 精简 PATH 下仍能解析 ollama 与 node 到常见目录', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'video-translate-bin-'))
  const binDirectory = path.join(testDirectory, 'bin')
  await mkdir(binDirectory, { recursive: true })

  for (const command of ['ollama', 'node']) {
    const executablePath = path.join(binDirectory, command)
    await writeFile(
      executablePath,
      `#!/bin/sh\nprintf '${command} version 1.2.3\\n'\n`
    )
    await chmod(executablePath, 0o755)
  }

  process.env.PATH = '/usr/bin:/bin'
  process.env.HOMEBREW_PREFIX = testDirectory

  // Homebrew prefix/bin 会被 getCommonBinaryDirectories 收录
  const ollamaPath = resolveCommandPath('ollama')
  assert.equal(ollamaPath, path.join(binDirectory, 'ollama'))

  ensureGuiCommandPath()
  assert.ok(
    (process.env.PATH || '').includes(binDirectory),
    'ensureGuiCommandPath 应把常见 bin 目录补进 PATH'
  )
})

test('打包资源中的 FFmpeg 优先于系统 PATH', async () => {
  testDirectory = await mkdtemp(
    path.join(tmpdir(), 'video-translate-resource-')
  )
  const bundledDirectory = path.join(testDirectory, 'ffmpeg')
  await mkdir(bundledDirectory, { recursive: true })

  const executablePath = path.join(bundledDirectory, 'ffmpeg.exe')
  await writeFile(executablePath, 'bundled ffmpeg')
  await chmod(executablePath, 0o755)

  assert.equal(
    resolveBundledMediaCommandPath('ffmpeg', testDirectory, 'win32'),
    executablePath
  )
  assert.equal(
    resolveBundledMediaCommandPath('ffprobe', testDirectory, 'win32'),
    undefined
  )
})

test('Node 依赖检查使用 Electron 内置 runtime，不依赖系统 node 二进制', async () => {
  process.env.PATH = '/usr/bin:/bin'

  const results = await checkSystemDependencies({
    autoDownloadAsr: false,
    writeLog: false,
  })
  const nodeResult = results.find(item => item.name === 'node')

  assert.ok(nodeResult)
  assert.equal(nodeResult?.available, true)
  assert.equal(nodeResult?.version, process.versions.node)
})

test('系统依赖检查会按实际阶段持续报告进度', async () => {
  const progressEvents: SystemCheckProgress[] = []

  await checkSystemDependencies({
    autoDownloadAsr: false,
    writeLog: false,
    onProgress: progress => progressEvents.push(progress),
  })

  assert.deepEqual(
    progressEvents.map(({ stage, percent, message }) => ({
      stage,
      percent,
      message,
    })),
    [
      {
        stage: 'checking-tools',
        percent: 10,
        message: '正在检查 FFmpeg、Node.js 和 Ollama...',
      },
      {
        stage: 'checking-asr',
        percent: 30,
        message: '正在检查 SenseVoice 模型...',
      },
      {
        stage: 'done',
        percent: 100,
        message: '系统依赖检查完成',
      },
    ]
  )
})
