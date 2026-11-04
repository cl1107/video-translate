import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AsrEngineId } from '../../../shared/constants'
import type { TranscriptionSegment } from '../../../shared/types/video'
import type { RawAsrResult } from './segment-builder'

export interface AsrChunkCheckpointConfig {
  engine: AsrEngineId
  language: string
  provider: string
  maxChunkSec: number
}

export interface AsrChunkCheckpointChunk {
  start: number
  duration: number
}

export interface AsrChunkCheckpointRecord {
  version: 1
  checkpointKey: string
  chunk: AsrChunkCheckpointChunk
  config: AsrChunkCheckpointConfig
  result: RawAsrResult
  segments: TranscriptionSegment[]
}

export interface AsrChunkCheckpointOptions {
  checkpointDir: string
  checkpointKey: string
  chunk: AsrChunkCheckpointChunk
  config: AsrChunkCheckpointConfig
}

const CHECKPOINT_VERSION = 1

/** 返回单个块断点的稳定路径；路径名不暴露用户传入的 fingerprint。 */
export function getAsrChunkCheckpointPath(
  options: AsrChunkCheckpointOptions
): string {
  const identity = JSON.stringify({
    checkpointKey: options.checkpointKey,
    chunk: normalizeChunk(options.chunk),
    config: normalizeConfig(options.config),
  })
  const digest = createHash('sha256').update(identity).digest('hex')
  return path.join(options.checkpointDir, `${digest}.json`)
}

export async function loadAsrChunkCheckpoint(
  options: AsrChunkCheckpointOptions
): Promise<AsrChunkCheckpointRecord | null> {
  const checkpointPath = getAsrChunkCheckpointPath(options)
  let content: string
  try {
    content = await fs.readFile(checkpointPath, 'utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null
    throw error
  }

  try {
    const parsed: unknown = JSON.parse(content)
    if (!isAsrChunkCheckpointRecord(parsed)) return null
    if (!matchesOptions(parsed, options)) return null
    return parsed
  } catch {
    // 损坏或半写入的断点按未命中处理，本次识别会覆盖它。
    return null
  }
}

/** 使用同目录临时文件 + rename，避免进程中断留下半个 JSON。 */
export async function saveAsrChunkCheckpoint(
  options: AsrChunkCheckpointOptions &
    Pick<AsrChunkCheckpointRecord, 'result' | 'segments'>
): Promise<void> {
  const record: AsrChunkCheckpointRecord = {
    version: CHECKPOINT_VERSION,
    checkpointKey: options.checkpointKey,
    chunk: normalizeChunk(options.chunk),
    config: normalizeConfig(options.config),
    result: options.result,
    segments: options.segments,
  }
  const checkpointPath = getAsrChunkCheckpointPath(options)
  await fs.mkdir(options.checkpointDir, { recursive: true })
  const temporaryPath = `${checkpointPath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(record), 'utf8')
    await fs.rename(temporaryPath, checkpointPath)
  } finally {
    await fs.unlink(temporaryPath).catch(() => {})
  }
}

function normalizeChunk(
  chunk: AsrChunkCheckpointChunk
): AsrChunkCheckpointChunk {
  return {
    start: normalizeNumber(chunk.start),
    duration: normalizeNumber(chunk.duration),
  }
}

function normalizeConfig(
  config: AsrChunkCheckpointConfig
): AsrChunkCheckpointConfig {
  return {
    engine: config.engine,
    language: config.language,
    provider: config.provider,
    maxChunkSec: normalizeNumber(config.maxChunkSec),
  }
}

function normalizeNumber(value: number): number {
  return Number(value.toFixed(6))
}

function matchesOptions(
  record: AsrChunkCheckpointRecord,
  options: AsrChunkCheckpointOptions
): boolean {
  return (
    record.checkpointKey === options.checkpointKey &&
    JSON.stringify(record.chunk) ===
      JSON.stringify(normalizeChunk(options.chunk)) &&
    JSON.stringify(record.config) ===
      JSON.stringify(normalizeConfig(options.config))
  )
}

function isAsrChunkCheckpointRecord(
  value: unknown
): value is AsrChunkCheckpointRecord {
  if (!isRecord(value)) return false
  return (
    value.version === CHECKPOINT_VERSION &&
    typeof value.checkpointKey === 'string' &&
    isChunk(value.chunk) &&
    isConfig(value.config) &&
    isRawAsrResult(value.result) &&
    Array.isArray(value.segments) &&
    value.segments.every(isSegment)
  )
}

function isChunk(value: unknown): value is AsrChunkCheckpointChunk {
  return (
    isRecord(value) &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.duration) &&
    value.start >= 0 &&
    value.duration >= 0
  )
}

function isConfig(value: unknown): value is AsrChunkCheckpointConfig {
  return (
    isRecord(value) &&
    (value.engine === 'sensevoice' || value.engine === 'funasr-nano') &&
    typeof value.language === 'string' &&
    typeof value.provider === 'string' &&
    isFiniteNumber(value.maxChunkSec)
  )
}

function isRawAsrResult(value: unknown): value is RawAsrResult {
  if (!isRecord(value)) return false
  return (
    (value.text === undefined || typeof value.text === 'string') &&
    (value.lang === undefined || typeof value.lang === 'string') &&
    (value.tokens === undefined ||
      (Array.isArray(value.tokens) &&
        value.tokens.every(token => typeof token === 'string'))) &&
    (value.timestamps === undefined ||
      (Array.isArray(value.timestamps) &&
        value.timestamps.every(isFiniteNumber)))
  )
}

function isSegment(value: unknown): value is TranscriptionSegment {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end) &&
    typeof value.originalText === 'string' &&
    isFiniteNumber(value.confidence) &&
    (value.polishedText === undefined ||
      typeof value.polishedText === 'string') &&
    (value.translatedText === undefined ||
      typeof value.translatedText === 'string') &&
    (value.translationStatus === undefined ||
      value.translationStatus === 'translated' ||
      value.translationStatus === 'fallback' ||
      value.translationStatus === 'reviewed')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNodeErrorWithCode(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === code
}
