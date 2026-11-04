import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeTaskRuntimeOptions } from '../../shared/task-options'
import {
  TaskStatus,
  type TranscriptionSegment,
  type TranslationTask,
} from '../../shared/types/video'

const mocks = vi.hoisted(() => {
  const checkpoint = {
    taskId: 'task-1',
    asrComplete: false,
    polishComplete: false,
    translationComplete: false,
    translationCompletedCount: 0,
    documentComplete: false,
    manualReviewed: false,
    updatedAt: '',
  }
  const databaseSegments: TranscriptionSegment[] = []
  const databaseManager = {
    getTranscriptionSegments: vi.fn<() => TranscriptionSegment[]>(() =>
      databaseSegments.map(segment => ({ ...segment }))
    ),
    saveTranscriptionSegments: vi.fn<
      (_taskId: string, segments: TranscriptionSegment[]) => void
    >((_taskId, segments) => {
      for (const segment of segments) {
        const index = databaseSegments.findIndex(item => item.id === segment.id)
        if (index >= 0)
          databaseSegments[index] = { ...databaseSegments[index], ...segment }
        else databaseSegments.push({ ...segment })
      }
    }),
    getPipelineCheckpoint: vi.fn<() => typeof checkpoint>(() => ({
      ...checkpoint,
    })),
    updatePipelineCheckpoint: vi.fn<
      (_taskId: string, patch: Partial<typeof checkpoint>) => void
    >((_taskId, patch) => {
      Object.assign(checkpoint, patch)
    }),
    clearPolishAndTranslation: vi.fn<(_taskId: string) => void>(),
    clearTranslationResults: vi.fn<(_taskId: string) => void>(),
    seedTaskTranscript: vi.fn<
      (
        _taskId: string,
        segments: TranscriptionSegment[]
      ) => TranscriptionSegment[]
    >((_taskId: string, segments: TranscriptionSegment[]) => {
      databaseSegments.splice(
        0,
        databaseSegments.length,
        ...segments.map(segment => ({ ...segment }))
      )
      return segments
    }),
    replaceTranscriptionSegments:
      vi.fn<(_taskId: string, segments: TranscriptionSegment[]) => void>(),
  }
  return { checkpoint, databaseSegments, databaseManager }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn<() => string>(() => os.tmpdir()) },
}))
vi.mock('./database/manager', () => ({
  databaseManager: mocks.databaseManager,
}))
vi.mock('./checkpoint', () => ({
  createCheckpointFingerprint: (value: unknown) => JSON.stringify(value),
  getTaskCheckpoint: () => ({ ...mocks.checkpoint }),
  isCheckpointFingerprintValid: (
    checkpoint: typeof mocks.checkpoint,
    stage: 'asr' | 'polish' | 'translation' | 'document'
  ) => {
    const complete =
      stage === 'asr'
        ? checkpoint.asrComplete
        : stage === 'polish'
          ? checkpoint.polishComplete
          : stage === 'translation'
            ? checkpoint.translationComplete
            : checkpoint.documentComplete
    return complete
  },
  markAsrComplete: vi.fn<() => void>(() => {
    mocks.checkpoint.asrComplete = true
  }),
  markPolishComplete: vi.fn<() => void>(() => {
    mocks.checkpoint.polishComplete = true
  }),
  saveTranslationProgress: vi.fn<
    (
      _taskId: string,
      _fingerprint: string,
      count: number,
      complete: boolean
    ) => void
  >(
    (
      _taskId: string,
      _fingerprint: string,
      count: number,
      complete: boolean
    ) => {
      mocks.checkpoint.translationCompletedCount = count
      mocks.checkpoint.translationComplete = complete
    }
  ),
  seedTaskTranscript: vi.fn<
    (
      _taskId: string,
      segments: TranscriptionSegment[]
    ) => TranscriptionSegment[]
  >((_taskId: string, segments: TranscriptionSegment[]) => {
    const scoped = segments.map(segment => ({
      ...segment,
      id: `task-1:${segment.id}`,
    }))
    mocks.databaseSegments.splice(0, mocks.databaseSegments.length, ...scoped)
    return scoped
  }),
}))
vi.mock('./temp-workspace', () => ({
  tempWorkspace: {
    removeTaskDir: vi.fn<(_taskId: string) => void>(),
    ensureTaskDir: vi.fn<(taskId: string) => Promise<string>>(
      async (taskId: string) => path.join(os.tmpdir(), taskId)
    ),
  },
}))
vi.mock('./ffmpeg/processor', () => ({
  ffmpegProcessor: {
    isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
    getVideoInfo: vi.fn<() => Promise<{ width: number; height: number }>>(
      async () => ({ width: 1280, height: 720 })
    ),
    extractAudio: vi.fn<(_input: string, output: string) => Promise<string>>(
      async (_input: string, output: string) => output
    ),
  },
}))
vi.mock('./asr/sherpa-transcriber', () => ({
  sherpaTranscriber: {
    isAvailable: vi.fn<() => Promise<boolean>>(async () => true),
    transcribe: vi.fn<
      () => Promise<{
        engine: string
        language: string
        rawText: string
        segments: TranscriptionSegment[]
      }>
    >(async () => ({
      engine: 'sensevoice',
      language: 'en',
      rawText: 'hello',
      segments: [
        { id: 'asr-1', start: 0, end: 1, originalText: 'hello', confidence: 1 },
      ],
    })),
  },
}))
vi.mock('./asr/model-downloader', () => ({
  ensureSenseVoiceModel: vi.fn<(..._args: never[]) => void>(),
}))
vi.mock('./llm/llm-config', () => ({
  resolveLlmCompletionConfig: vi.fn<
    () => { ok: true; label: string; config: Record<string, never> }
  >(() => ({ ok: true, label: 'mock', config: {} })),
}))
vi.mock('./llm/openai-completion-client', () => ({
  createCompletionClient: vi.fn<() => { complete: () => Promise<never> }>(
    () => ({ complete: vi.fn<() => Promise<never>>() })
  ),
}))
vi.mock('./llm/polish-service', () => ({
  polishTranscriptBatch: vi.fn<(texts: string[]) => Promise<string[]>>(
    async (texts: string[]) => texts.map(text => `${text}!`)
  ),
}))
vi.mock('./llm/text-transform', () => ({
  translateTextBatch: vi.fn<
    (
      texts: string[],
      options: {
        onSegmentComplete: (result: {
          index: number
          total: number
          source: string
          translated: string
          translationStatus: 'translated' | 'fallback'
        }) => Promise<void>
      }
    ) => Promise<string[]>
  >(
    async (
      texts: string[],
      options: {
        onSegmentComplete: (result: {
          index: number
          total: number
          source: string
          translated: string
          translationStatus: 'translated' | 'fallback'
        }) => Promise<void>
      }
    ) => {
      const results = texts.map(text => `译:${text}`)
      for (const [index, text] of texts.entries()) {
        await options.onSegmentComplete({
          index,
          total: texts.length,
          source: text,
          translated: results[index] ?? '',
          translationStatus: 'translated',
        })
      }
      return results
    }
  ),
}))
vi.mock('../utils/subtitle-artifacts', () => ({
  selectBurnSubtitleContent: vi.fn<(..._args: never[]) => undefined>(),
  validateSubtitleArtifacts: vi.fn<
    () => Promise<{ ok: true; errors: never[] }>
  >(async () => ({ ok: true, errors: [] })),
  writeOriginalSubtitleArtifact: vi.fn<
    () => Promise<{ original: string; outputDirectory: string }>
  >(async () => ({ original: '/tmp/original.srt', outputDirectory: '/tmp' })),
  writeSubtitleArtifacts: vi.fn<
    () => Promise<{
      original: string
      translated: string
      bilingual: string
      bilingualAss: string
      outputDirectory: string
    }>
  >(async () => ({
    original: '/tmp/original.srt',
    translated: '/tmp/translated.srt',
    bilingual: '/tmp/bilingual.srt',
    bilingualAss: '/tmp/bilingual.ass',
    outputDirectory: '/tmp',
  })),
}))
vi.mock('../utils/subtitle-output-directory', () => ({
  resolveSubtitleOutputDirectory: vi.fn<(..._args: never[]) => string>(
    () => '/tmp'
  ),
}))

import {
  type PipelineHooks,
  runTranslationPipeline,
} from './translation-pipeline'
import { sherpaTranscriber } from './asr/sherpa-transcriber'
import { polishTranscriptBatch } from './llm/polish-service'
import { translateTextBatch } from './llm/text-transform'

function makeTask(mediaPath: string): TranslationTask {
  return {
    id: 'task-1',
    kind: 'subtitle',
    status: TaskStatus.PENDING,
    progress: 0,
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    options: normalizeTaskRuntimeOptions(undefined),
    videoFile: {
      id: 'video-1',
      name: 'sample.mp4',
      path: mediaPath,
      size: 1,
      duration: 1,
      format: 'mp4',
      createdAt: '',
    },
    segments: [],
    subtitles: [],
    logs: [],
    createdAt: '',
    updatedAt: '',
  }
}

describe('translation pipeline checkpoints', () => {
  beforeEach(() => {
    mocks.checkpoint.asrComplete = false
    mocks.checkpoint.polishComplete = false
    mocks.checkpoint.translationComplete = false
    mocks.checkpoint.translationCompletedCount = 0
    mocks.databaseSegments.splice(0)
    vi.clearAllMocks()
  })

  it('首次运行落盘 ASR/逐段翻译，恢复运行不重复调用 ASR 或模型', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-checkpoint-'))
    const mediaPath = path.join(dir, 'sample.mp4')
    await fs.writeFile(mediaPath, 'media')
    const hooks = {
      onLog: vi.fn<PipelineHooks['onLog']>(),
      onStatus: vi.fn<PipelineHooks['onStatus']>(async () => undefined),
      onArtifacts: vi.fn<PipelineHooks['onArtifacts']>(),
      onSegments: vi.fn<PipelineHooks['onSegments']>(),
      onDetectedLanguage: vi.fn<PipelineHooks['onDetectedLanguage']>(),
      resolveLlmApiKey: vi.fn<PipelineHooks['resolveLlmApiKey']>(
        () => undefined
      ),
    }
    try {
      await runTranslationPipeline(
        makeTask(mediaPath),
        normalizeTaskRuntimeOptions(undefined),
        hooks
      )
      expect(sherpaTranscriber.transcribe).toHaveBeenCalledTimes(1)
      expect(polishTranscriptBatch).toHaveBeenCalledTimes(1)
      expect(translateTextBatch).toHaveBeenCalledTimes(1)
      expect(mocks.databaseSegments[0]).toMatchObject({
        id: 'task-1:asr-1',
        translatedText: '译:hello!',
      })

      await runTranslationPipeline(
        makeTask(mediaPath),
        normalizeTaskRuntimeOptions(undefined),
        hooks
      )
      expect(sherpaTranscriber.transcribe).toHaveBeenCalledTimes(1)
      expect(polishTranscriptBatch).toHaveBeenCalledTimes(1)
      expect(translateTextBatch).toHaveBeenCalledTimes(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
