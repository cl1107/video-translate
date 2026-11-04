import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionSegment } from '../../shared/types/video'
import type { PipelineCheckpoint } from './database/manager'

type SeedTranscript = (
  taskId: string,
  segments: TranscriptionSegment[]
) => TranscriptionSegment[]
type UpdateCheckpoint = (taskId: string, patch: Record<string, unknown>) => void

const { databaseManager } = vi.hoisted(() => ({
  databaseManager: {
    seedTaskTranscript: vi.fn<SeedTranscript>(),
    updatePipelineCheckpoint: vi.fn<UpdateCheckpoint>(),
    saveTranscriptionSegments:
      vi.fn<(taskId: string, segments: TranscriptionSegment[]) => void>(),
    replaceTranscriptionSegments:
      vi.fn<(taskId: string, segments: TranscriptionSegment[]) => void>(),
    getPipelineCheckpoint: vi.fn<() => PipelineCheckpoint>(),
  },
}))

vi.mock('./database/manager', () => ({
  databaseManager,
  scopeTranscriptionSegmentId: (taskId: string, id: string) =>
    id.startsWith(`${taskId}:`) ? id : `${taskId}:${id}`,
}))

import { seedTaskTranscript, updateCheckpointAfterReviewed } from './checkpoint'
const segment: TranscriptionSegment = {
  id: 'platform-1',
  start: 0,
  end: 1,
  originalText: 'hello',
  confidence: 1,
}

describe('pipeline checkpoint helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    databaseManager.seedTaskTranscript.mockImplementation(
      (_taskId: string, segments: TranscriptionSegment[]) => segments
    )
    databaseManager.getPipelineCheckpoint.mockReturnValue({
      taskId: 'task-1',
      asrComplete: true,
      polishComplete: false,
      translationComplete: false,
      translationCompletedCount: 0,
      documentComplete: false,
      manualReviewed: false,
      updatedAt: '',
    })
  })

  it('seedTaskTranscript 为任务隔离段 id 并标记完整 ASR', () => {
    const seeded = seedTaskTranscript('task-1', [segment])
    expect(seeded[0]?.id).toBe('task-1:platform-1')
    expect(databaseManager.seedTaskTranscript).toHaveBeenCalledWith('task-1', [
      expect.objectContaining({ id: 'task-1:platform-1' }),
    ])
    expect(databaseManager.updatePipelineCheckpoint).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ asrComplete: true })
    )
  })

  it('ASR partial 校对只替换段落，不提升完整断点', () => {
    databaseManager.getPipelineCheckpoint.mockReturnValueOnce({
      taskId: 'task-1',
      asrComplete: false,
      polishComplete: false,
      translationComplete: false,
      translationCompletedCount: 0,
      documentComplete: false,
      manualReviewed: false,
      updatedAt: '',
    })
    updateCheckpointAfterReviewed('task-1', [segment])
    expect(databaseManager.updatePipelineCheckpoint).toHaveBeenCalledWith(
      'task-1',
      { manualReviewed: false }
    )
  })

  it('校对 helper 保存人工结果并关闭旧模型断点', () => {
    updateCheckpointAfterReviewed('task-1', [
      { ...segment, translatedText: '你好', translationStatus: 'reviewed' },
    ])
    expect(databaseManager.replaceTranscriptionSegments).toHaveBeenCalledWith(
      'task-1',
      [expect.objectContaining({ translationStatus: 'reviewed' })]
    )
    expect(databaseManager.updatePipelineCheckpoint).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        asrComplete: true,
        polishComplete: true,
        translationComplete: true,
        manualReviewed: true,
      })
    )
  })
})
