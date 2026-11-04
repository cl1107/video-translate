import { createHash } from 'node:crypto'
import type { TranscriptionSegment } from '../../shared/types/video'
import {
  databaseManager,
  type PipelineCheckpoint,
  scopeTranscriptionSegmentId,
} from './database/manager'

export interface PipelineFingerprints {
  asr: string
  polish: string
  translation: string
  document: string
}

export function createCheckpointFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * 为新任务建立完整转录快照。此入口是跨字幕/文稿复用任务的唯一 seed 入口。
 * 返回值中的 id 已按 taskId 隔离，调用方应继续使用返回值而不是原数组。
 */
export function seedTaskTranscript(
  taskId: string,
  segments: TranscriptionSegment[]
): TranscriptionSegment[] {
  const scoped = segments.map((segment, index) => ({
    ...segment,
    id: scopeTranscriptionSegmentId(taskId, segment.id, index),
  }))
  const saved = databaseManager.seedTaskTranscript(taskId, scoped)
  databaseManager.updatePipelineCheckpoint(taskId, {
    asrComplete: true,
    asrFingerprint: undefined,
    polishComplete: false,
    polishFingerprint: undefined,
    translationComplete: false,
    translationFingerprint: undefined,
    translationCompletedCount: 0,
    documentComplete: false,
    documentFingerprint: undefined,
    documentMarkdown: undefined,
    manualReviewed: false,
  })
  return saved
}

export function getTaskCheckpoint(taskId: string): PipelineCheckpoint {
  return databaseManager.getPipelineCheckpoint(taskId)
}

export function markAsrComplete(taskId: string, fingerprint: string): void {
  databaseManager.updatePipelineCheckpoint(taskId, {
    asrComplete: true,
    asrFingerprint: fingerprint,
    polishComplete: false,
    polishFingerprint: undefined,
    translationComplete: false,
    translationFingerprint: undefined,
    translationCompletedCount: 0,
    documentComplete: false,
    documentFingerprint: undefined,
    documentMarkdown: undefined,
    manualReviewed: false,
  })
}

export function markPolishComplete(taskId: string, fingerprint: string): void {
  databaseManager.updatePipelineCheckpoint(taskId, {
    polishComplete: true,
    polishFingerprint: fingerprint,
    translationComplete: false,
    translationFingerprint: undefined,
    translationCompletedCount: 0,
    manualReviewed: false,
  })
}

export function saveTranslationProgress(
  taskId: string,
  fingerprint: string,
  completedCount: number,
  complete: boolean
): void {
  databaseManager.updatePipelineCheckpoint(taskId, {
    translationComplete: complete,
    translationFingerprint: fingerprint,
    translationCompletedCount: completedCount,
    manualReviewed: false,
  })
}

export function markDocumentComplete(
  taskId: string,
  fingerprint: string,
  markdown: string
): void {
  databaseManager.updatePipelineCheckpoint(taskId, {
    documentComplete: true,
    documentFingerprint: fingerprint,
    documentMarkdown: markdown,
  })
}

/**
 * 校对工作台保存后调用。人工结果是新的权威值，流水线恢复时不得用旧模型结果覆盖。
 * 保留已有配置指纹，使模型配置真正变化时仍能按规则失效下游。
 */
export function updateCheckpointAfterReviewed(
  taskId: string,
  segments: TranscriptionSegment[]
): void {
  const scoped = segments.map((segment, index) => ({
    ...segment,
    id: scopeTranscriptionSegmentId(taskId, segment.id, index),
  }))
  databaseManager.replaceTranscriptionSegments(taskId, scoped)
  const checkpoint = databaseManager.getPipelineCheckpoint(taskId)
  if (!checkpoint.asrComplete) {
    // ASR 仍在进行时允许保存当前编辑，但绝不能把 partial 标为完整快照。
    databaseManager.updatePipelineCheckpoint(taskId, {
      manualReviewed: false,
    })
    return
  }
  const translatedCount = scoped.filter(segment =>
    Boolean(segment.translatedText?.trim())
  ).length
  databaseManager.updatePipelineCheckpoint(taskId, {
    asrComplete: true,
    // 只有每一段都有非空人工/已有译文，才能把翻译阶段标记为完整。
    polishComplete: true,
    translationComplete: translatedCount === scoped.length,
    translationCompletedCount: translatedCount,
    manualReviewed: true,
    documentComplete: false,
    documentMarkdown: undefined,
    documentFingerprint: undefined,
  })
}

export function isCheckpointFingerprintValid(
  checkpoint: PipelineCheckpoint,
  stage: 'asr' | 'polish' | 'translation' | 'document',
  fingerprint: string
): boolean {
  const complete =
    stage === 'asr'
      ? checkpoint.asrComplete
      : stage === 'polish'
        ? checkpoint.polishComplete
        : stage === 'translation'
          ? checkpoint.translationComplete
          : checkpoint.documentComplete
  const stored =
    stage === 'asr'
      ? checkpoint.asrFingerprint
      : stage === 'polish'
        ? checkpoint.polishFingerprint
        : stage === 'translation'
          ? checkpoint.translationFingerprint
          : checkpoint.documentFingerprint
  return complete && (!stored || stored === fingerprint)
}
