import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { FFmpegProcessor } from './processor'

const originalArgsLog = process.env.FFMPEG_ARGS_LOG
let testDirectory: string | undefined

afterEach(async () => {
  if (originalArgsLog === undefined) {
    Reflect.deleteProperty(process.env, 'FFMPEG_ARGS_LOG')
  } else {
    process.env.FFMPEG_ARGS_LOG = originalArgsLog
  }

  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
    testDirectory = undefined
  }
})

test('烧录 SRT 时使用 force_style 底部边距', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'ffmpeg-layout-'))
  const ffmpegPath = path.join(testDirectory, 'ffmpeg')
  const argsLogPath = path.join(testDirectory, 'args.log')
  const videoPath = path.join(testDirectory, 'source.mp4')
  const subtitlePath = path.join(testDirectory, 'translated.srt')
  const outputPath = path.join(testDirectory, 'output.mp4')

  await writeFile(
    ffmpegPath,
    '#!/bin/sh\n' +
      'printf \'%s\\n\' "$*" >> "$FFMPEG_ARGS_LOG"\n' +
      'if [ "$1" = "-hide_banner" ]; then\n' +
      "  printf ' .. subtitles Render text subtitles\\n'\n" +
      'elif [ "$3" = "-hide_banner" ]; then\n' +
      '  printf \'{"streams":[{"codec_type":"video","width":1920,"height":1080,"r_frame_rate":"30/1","codec_name":"h264"}],"format":{"duration":"10","format_name":"mov,mp4","bit_rate":"1000000"}}\'\n' +
      'fi\n'
  )
  await chmod(ffmpegPath, 0o755)
  await writeFile(videoPath, 'video fixture')
  await writeFile(
    subtitlePath,
    '1\n00:00:00,000 --> 00:00:01,000\nTranslated subtitle\n'
  )
  process.env.FFMPEG_ARGS_LOG = argsLogPath

  const processor = new FFmpegProcessor(ffmpegPath, ffmpegPath)
  await processor.burnSubtitles(videoPath, subtitlePath, outputPath)

  const commands = await readFile(argsLogPath, 'utf8')
  const burnCommand = commands
    .split('\n')
    .find(command => command.includes(' -vf '))

  assert.ok(burnCommand, 'expected burn subtitles command with -vf')
  assert.match(
    burnCommand,
    /-vf subtitles='[^']+':force_style='Alignment=2,MarginV=43'/
  )
})

test('烧录 ASS 时使用内嵌样式且不附加 force_style', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'ffmpeg-ass-'))
  const ffmpegPath = path.join(testDirectory, 'ffmpeg')
  const argsLogPath = path.join(testDirectory, 'args.log')
  const videoPath = path.join(testDirectory, 'source.mp4')
  const subtitlePath = path.join(testDirectory, 'bilingual.ass')
  const outputPath = path.join(testDirectory, 'output.mp4')

  await writeFile(
    ffmpegPath,
    '#!/bin/sh\n' +
      'printf \'%s\\n\' "$*" >> "$FFMPEG_ARGS_LOG"\n' +
      'if [ "$1" = "-hide_banner" ]; then\n' +
      "  printf ' .. subtitles Render text subtitles\\n'\n" +
      'elif [ "$3" = "-hide_banner" ]; then\n' +
      '  printf \'{"streams":[{"codec_type":"video","width":1920,"height":1080,"r_frame_rate":"30/1","codec_name":"h264"}],"format":{"duration":"10","format_name":"mov,mp4","bit_rate":"1000000"}}\'\n' +
      'fi\n'
  )
  await chmod(ffmpegPath, 0o755)
  await writeFile(videoPath, 'video fixture')
  await writeFile(subtitlePath, '[Script Info]\nScriptType: v4.00+\n')
  process.env.FFMPEG_ARGS_LOG = argsLogPath

  const processor = new FFmpegProcessor(ffmpegPath, ffmpegPath)
  await processor.burnSubtitles(videoPath, subtitlePath, outputPath)

  const commands = await readFile(argsLogPath, 'utf8')
  const burnCommand = commands
    .split('\n')
    .find(command => command.includes(' -vf '))

  assert.ok(burnCommand, 'expected burn subtitles command with -vf')
  assert.match(burnCommand, /-vf subtitles='[^']+\.ass'/)
  assert.doesNotMatch(burnCommand, /force_style/)
})

test('烧录输出分辨率改变时任务失败', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'ffmpeg-verify-output-'))
  const ffmpegPath = path.join(testDirectory, 'ffmpeg')
  const videoPath = path.join(testDirectory, 'source.mp4')
  const subtitlePath = path.join(testDirectory, 'bilingual.ass')
  const outputPath = path.join(testDirectory, 'output.mp4')

  await writeFile(
    ffmpegPath,
    '#!/bin/sh\n' +
      'if [ "$1" = "-hide_banner" ]; then\n' +
      "  printf ' .. subtitles Render text subtitles\\n'\n" +
      'elif [ "$3" = "-hide_banner" ]; then\n' +
      `  if [ "$2" = "${outputPath}" ]; then width=1280; else width=1920; fi\n` +
      '  printf \'{"streams":[{"codec_type":"video","width":%s,"height":1080,"r_frame_rate":"30/1","codec_name":"h264"},{"codec_type":"audio","codec_name":"aac"}],"format":{"duration":"10","format_name":"mov,mp4","bit_rate":"1000000"}}\' "$width"\n' +
      'fi\n'
  )
  await chmod(ffmpegPath, 0o755)
  await writeFile(videoPath, 'video fixture')
  await writeFile(subtitlePath, '[Script Info]\nScriptType: v4.00+\n')

  const processor = new FFmpegProcessor(ffmpegPath, ffmpegPath)

  await assert.rejects(
    processor.burnSubtitles(videoPath, subtitlePath, outputPath),
    /烧录输出分辨率改变: 1920x1080 -> 1280x1080/
  )
})
