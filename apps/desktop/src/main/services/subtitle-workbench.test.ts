import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
vi.mock('./database/manager', () => ({
  databaseManager: {
    saveVideoFile: vi.fn<() => void>(),
    createTranslationTask: vi.fn<() => void>(),
    saveTranscriptionSegments: vi.fn<() => void>(),
  },
}))
vi.mock('./secure-store', () => ({ getLlmApiKey: () => undefined }))
vi.mock('./checkpoint', () => ({
  seedTaskTranscript: (_taskId: string, segments: TranscriptionSegment[]) =>
    segments,
}))
import {
  assertEditableTask,
  validateSegmentEdit,
  translateWorkbenchSegment,
  createReusedTask,
  createImportedSubtitleTask,
} from './subtitle-workbench'
import {
  TaskStatus,
  type TranscriptionSegment,
  type TranslationTask,
} from '../../shared/types/video'

const segment: TranscriptionSegment = {
  id: 's1',
  start: 1,
  end: 3,
  originalText: 'Hello',
  translatedText: '你好',
  polishedText: 'Hello!',
  confidence: 1,
  translationStatus: 'fallback',
}
const task = {
  status: TaskStatus.COMPLETED,
  segments: [segment],
} as TranslationTask

describe('字幕校对边界', () => {
  it('导入真实 SRT/VTT 保留时间与多行原文', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-import-'))
    try {
      for (const [format, content] of [
        ['srt', '1\n00:00:01,200 --> 00:00:03,400\nHello\nworld\n'],
        ['vtt', 'WEBVTT\n\n00:01.200 --> 00:03.400\nHello\nworld\n'],
      ]) {
        const file = path.join(dir, `test.${format}`)
        await fs.writeFile(file, content ?? '')
        const imported = await createImportedSubtitleTask(file)
        expect(imported.segments).toHaveLength(1)
        expect(imported.segments[0]).toMatchObject({
          start: 1.2,
          end: 3.4,
          originalText: 'Hello\nworld',
        })
        expect(imported.status).toBe(TaskStatus.COMPLETED)
        expect(imported.videoFile.format).toBe(format)
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  it('允许终态与暂停任务，拒绝处理中任务', () => {
    expect(() => assertEditableTask(task)).not.toThrow()
    expect(() =>
      assertEditableTask({ ...task, status: TaskStatus.PAUSED })
    ).not.toThrow()
    expect(() =>
      assertEditableTask({ ...task, status: TaskStatus.TRANSLATING })
    ).toThrow('暂停')
  })
  it('保存校对结果并清除过期润色原文', () => {
    const result = validateSegmentEdit(
      {
        ...segment,
        originalText: 'Goodbye',
        translatedText: '再见',
        confidence: 0,
      },
      segment
    )
    expect(result).toMatchObject({
      originalText: 'Goodbye',
      translatedText: '再见',
      confidence: 1,
      translationStatus: 'reviewed',
    })
    expect(result.polishedText).toBeUndefined()
  })
  it('只改译文时保留润色', () => {
    expect(
      validateSegmentEdit({ ...segment, translatedText: '您好' }, segment)
        .polishedText
    ).toBe('Hello!')
  })
  it.each([NaN, Infinity, -1, 3, 4])('拒绝无效开始时间 %s', start => {
    expect(() => validateSegmentEdit({ ...segment, start }, segment)).toThrow(
      '时间无效'
    )
  })
  it('拒绝跨段编辑、空原文与非字符串译文', () => {
    for (const input of [
      { ...segment, id: 'other' },
      { ...segment, originalText: ' ' },
      { ...segment, translatedText: 3 },
    ]) {
      expect(() => validateSegmentEdit(input, segment)).toThrow(
        '字幕内容或时间无效'
      )
    }
  })
  it('复用创建独立任务、媒体记录及段ID，清除模型相关结果但保留人工原文', () => {
    const source = {
      ...task,
      id: 'source',
      videoFile: { id: 'video', path: '/tmp/example.mp4' },
      segments: [segment],
    } as TranslationTask
    const reused = createReusedTask(source, {
      kind: 'document',
      targetLanguage: 'ja',
    })
    expect(reused.id).not.toBe(source.id)
    expect(reused.videoFile.id).not.toBe(source.videoFile.id)
    expect(reused.videoFile.path).toBe(source.videoFile.path)
    expect(reused.segments[0]?.id).not.toBe(segment.id)
    expect(reused.segments[0]?.originalText).toBe('Hello')
    expect(reused.segments[0]?.translatedText).toBeUndefined()
    expect(reused.segments[0]?.polishedText).toBeUndefined()
    expect(reused.kind).toBe('document')
    expect(reused.status).toBe(TaskStatus.PENDING)
    expect(segment.translatedText).toBe('你好')
  })
  it('不存在的单段不调用模型', async () => {
    await expect(translateWorkbenchSegment(task, 'absent')).rejects.toThrow(
      '不存在'
    )
  })
})
