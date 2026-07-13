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

test('烧录翻译字幕时将新字幕放在原字幕上方', async () => {
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
