import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import type { TranscriptionSegment } from '../../shared/types/video'
import {
  generateBilingualAss,
  validateSubtitleArtifacts,
  writeSubtitleArtifacts,
} from './subtitle-artifacts'

let testDirectory: string | undefined

afterEach(async () => {
  if (testDirectory) {
    await rm(testDirectory, { recursive: true, force: true })
    testDirectory = undefined
  }
})

const sampleSegments: TranscriptionSegment[] = [
  {
    id: 's1',
    start: 0,
    end: 2,
    originalText: 'Hello world',
    translatedText: '你好世界',
    confidence: 0.9,
  },
  {
    id: 's2',
    start: 2.1,
    end: 5,
    originalText:
      'A much longer source caption that wraps onto another display line',
    translatedText: '这是一条会换行的较长中文字幕用来验证位置固定',
    confidence: 0.9,
  },
]

test('generateBilingualAss stacks source above translation with fixed anchor', () => {
  const ass = generateBilingualAss(sampleSegments, {
    width: 1920,
    height: 1080,
  })
  assert.match(ass, /PlayResX: 1920/)
  assert.match(ass, /PlayResY: 1080/)
  assert.match(ass, /Style: Bilingual,/)
  assert.match(ass, /\\an2\\pos\(960,1030\)\\fs42/)
  // 默认原文白 &HFFFFFF&、译文黄 &H00FFFF&（ASS BGR）
  assert.match(ass, /\{\\1c&HFFFFFF&\}Hello world/)
  assert.match(ass, /\\N\{\\fs46\\1c&H00FFFF&\}你好世界/)
  assert.match(ass, /Hello world/)
  assert.match(ass, /你好世界/)
})

test('generateBilingualAss applies custom original and translated colors', () => {
  const ass = generateBilingualAss(
    sampleSegments,
    { width: 1920, height: 1080 },
    'Sans',
    { originalColor: '#00FF00', translatedColor: '#FF0000' }
  )
  // #00FF00 → BGR &H00FF00&；#FF0000 → BGR &H0000FF&
  assert.match(ass, /\{\\1c&H00FF00&\}Hello world/)
  assert.match(ass, /\\1c&H0000FF&\}你好世界/)
  assert.match(ass, /Style: Bilingual,Sans,46,&H0000FF00,/)
})

test('writeSubtitleArtifacts creates bilingual files and validation passes', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'subtitle-artifacts-'))
  const paths = await writeSubtitleArtifacts({
    segments: sampleSegments,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
    videoSize: { width: 1920, height: 1080 },
  })

  const validation = await validateSubtitleArtifacts(paths, sampleSegments)
  assert.equal(validation.ok, true, validation.errors.join('; '))
  assert.equal(validation.checks.expectedCount, 2)
  assert.equal(validation.checks.allTranslated, true)
  assert.ok(paths.bilingual.endsWith('_bilingual.srt'))
  assert.ok(paths.bilingualAss.endsWith('_bilingual.ass'))
})

test('validation fails when a translation is missing', async () => {
  testDirectory = await mkdtemp(
    path.join(tmpdir(), 'subtitle-artifacts-missing-')
  )
  const incomplete = sampleSegments.map((segment, index) =>
    index === 1 ? { ...segment, translatedText: '' } : segment
  )
  const paths = await writeSubtitleArtifacts({
    segments: incomplete,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
  })
  const validation = await validateSubtitleArtifacts(paths, incomplete)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some(item => item.includes('未翻译')))
})

test('校验拒绝条数不完整的双语 SRT 和 ASS', async () => {
  testDirectory = await mkdtemp(
    path.join(tmpdir(), 'subtitle-artifacts-corrupted-')
  )
  const paths = await writeSubtitleArtifacts({
    segments: sampleSegments,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
  })
  await writeFile(
    paths.bilingual,
    '1\n00:00:00,000 --> 00:00:02,000\nHello world\n你好世界\n',
    'utf8'
  )
  await writeFile(
    paths.bilingualAss,
    '[Script Info]\nScriptType: v4.00+\n[Events]\n',
    'utf8'
  )

  const validation = await validateSubtitleArtifacts(paths, sampleSegments)

  assert.equal(validation.ok, false)
  assert.equal(validation.checks.bilingualCount, 1)
  assert.equal(validation.checks.assDialogueCount, 0)
  assert.ok(validation.errors.some(item => item.includes('双语字幕条数不一致')))
  assert.ok(validation.errors.some(item => item.includes('ASS 事件数不一致')))
})

test('原文和双语字幕保留 ASR 日语原文而不使用润色文本', async () => {
  testDirectory = await mkdtemp(
    path.join(tmpdir(), 'subtitle-artifacts-source-preserved-')
  )
  const segment: TranscriptionSegment = {
    id: 'ja-1',
    start: 0.18,
    end: 2.16,
    originalText: '時刻は間もなく深夜1時',
    polishedText: '时间即将进入深夜1点。',
    translatedText: '即将到深夜1点。',
    confidence: 0.98,
  }
  const paths = await writeSubtitleArtifacts({
    segments: [segment],
    outputDir: testDirectory,
    baseName: 'japanese',
    sourceSuffix: 'auto',
    targetSuffix: 'zh',
  })

  const [original, bilingual, ass] = await Promise.all([
    readFile(paths.original, 'utf8'),
    readFile(paths.bilingual, 'utf8'),
    readFile(paths.bilingualAss, 'utf8'),
  ])

  assert.match(original, /時刻は間もなく深夜1時/)
  assert.doesNotMatch(original, /时间即将进入/)
  assert.match(bilingual, /時刻は間もなく深夜1時\n即将到深夜1点/)
  assert.match(ass, /時刻は間もなく深夜1時/)
  assert.doesNotMatch(ass, /时间即将进入/)
})
test('重复生成时整组递增编号且不覆盖已有产物', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'subtitle-artifacts-version-'))
  const first = await writeSubtitleArtifacts({
    segments: sampleSegments,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
  })
  const originalContent = await readFile(first.original, 'utf8')

  const second = await writeSubtitleArtifacts({
    segments: sampleSegments,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
  })

  assert.ok(second.original.endsWith('demo_en.2.srt'))
  assert.ok(second.translated.endsWith('demo_zh.2.srt'))
  assert.ok(second.bilingual.endsWith('demo_bilingual.2.srt'))
  assert.ok(second.bilingualAss.endsWith('demo_bilingual.2.ass'))
  assert.equal(await readFile(first.original, 'utf8'), originalContent)
})

test('候选组部分冲突时不留下其他空占位文件', async () => {
  testDirectory = await mkdtemp(path.join(tmpdir(), 'subtitle-artifacts-claim-'))
  const occupied = path.join(testDirectory, 'demo_zh.srt')
  await writeFile(occupied, 'existing subtitle', 'utf8')

  const paths = await writeSubtitleArtifacts({
    segments: sampleSegments,
    outputDir: testDirectory,
    baseName: 'demo',
    sourceSuffix: 'en',
    targetSuffix: 'zh',
  })

  assert.ok(paths.original.endsWith('demo_en.2.srt'))
  assert.equal(await readFile(occupied, 'utf8'), 'existing subtitle')
  await assert.rejects(readFile(path.join(testDirectory, 'demo_en.srt'), 'utf8'))
})
