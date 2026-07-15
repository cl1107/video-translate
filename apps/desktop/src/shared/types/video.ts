// 视频翻译任务相关类型定义

import type { AsrEngineId } from '../constants'
import type { PolishProvider, SubtitleBurnMode } from '../settings'

export interface VideoFile {
  id: string
  name: string
  path: string
  size: number
  duration: number
  format: string
  createdAt: string
}

export interface TaskLog {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'success'
  message: string
  details?: string
}

/**
 * 任务运行时配置（一等持久化字段，不依赖内存 Map / 日志）。
 * 注意：BYOK API Key 不在此结构中，仅存主进程 secure store。
 */
export interface TaskRuntimeOptions {
  ollamaModel: string
  asrEngine: AsrEngineId
  burnSubtitles: boolean
  burnSubtitleMode: SubtitleBurnMode
  polishTranscript: boolean
  polishProvider: PolishProvider
  polishOllamaModel: string
  byokBaseUrl: string
  byokModelId: string
  originalSubtitleColor: string
  translatedSubtitleColor: string
}

/** 任务产物路径（一等持久化字段，不再从 TaskLog 解析） */
export interface TaskOutputArtifacts {
  originalSubtitle?: string
  translatedSubtitle?: string
  bilingualSubtitle?: string
  bilingualAss?: string
  burnedVideo?: string
  outputDirectory: string
}

export interface TranslationTask {
  id: string
  videoFile: VideoFile
  status: TaskStatus
  progress: number
  sourceLanguage: string
  targetLanguage: string
  /** 创建/重试时的运行配置；旧任务可能缺失 */
  options?: TaskRuntimeOptions
  segments: TranscriptionSegment[]
  subtitles: SubtitleEntry[]
  logs: TaskLog[]
  errorMessage?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  outputArtifacts?: TaskOutputArtifacts
}

export enum TaskStatus {
  PENDING = 'pending',
  EXTRACTING_AUDIO = 'extracting_audio',
  TRANSCRIBING = 'transcribing',
  /** 识别文本润色（与翻译阶段分离） */
  POLISHING = 'polishing',
  TRANSLATING = 'translating',
  GENERATING_SUBTITLES = 'generating_subtitles',
  /** 任务完成后补烧硬字幕 */
  BURNING_SUBTITLES = 'burning_subtitles',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused',
  /** 协作式取消中 / 已取消 */
  CANCELLED = 'cancelled',
}

/**
 * 转录/显示段。
 *
 * 字段语义（钉死，避免「原文」歧义）：
 * - originalText：ASR 不可变识别原文（asrText）
 * - polishedText：润色后的显示/翻译输入源（displaySource 候选）
 * - translatedText：目标语译文
 *
 * 选取策略见 main/utils/segment-text.ts
 */
export interface TranscriptionSegment {
  id: string
  start: number
  end: number
  /** ASR 原始识别文本（不可变语义） */
  originalText: string
  /** 大模型润色后的显示原文（用于翻译输入） */
  polishedText?: string
  translatedText?: string
  confidence: number
}

export interface SubtitleEntry {
  index: number
  start: string // SRT 时间格式: "00:00:01,000"
  end: string
  text: string
}

export interface OllamaModel {
  name: string
  /** 字节数（Ollama /api/tags 返回 number） */
  size: number
  digest: string
  modified_at: string
}

export type AsrEngine = AsrEngineId
