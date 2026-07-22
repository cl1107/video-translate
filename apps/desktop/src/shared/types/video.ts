// 视频翻译任务相关类型定义

import type { AsrEngineId } from '../constants'
import type { DetectedLanguage } from '../language'
import type { PolishProvider, SubtitleBurnMode } from '../settings'

/** 任务工作流类型：字幕翻译 vs 文稿整理 */
export type TaskKind = 'subtitle' | 'document'

export function isTaskKind(value: unknown): value is TaskKind {
  return value === 'subtitle' || value === 'document'
}

export function normalizeTaskKind(value: unknown): TaskKind {
  return value === 'document' ? 'document' : 'subtitle'
}

export interface VideoFile {
  id: string
  name: string
  path: string
  size: number
  duration: number
  format: string
  createdAt: string
  /** 在线下载来源 URL（本地上传任务无此字段） */
  sourceUrl?: string
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
  /** 文稿任务：润色后的 Markdown 文件路径 */
  polishedMarkdown?: string
  outputDirectory: string
}

export interface TranslationTask {
  id: string
  videoFile: VideoFile
  /** 工作流：字幕（默认）或文稿；旧库缺失时按 subtitle */
  kind: TaskKind
  status: TaskStatus
  progress: number
  sourceLanguage: string
  /** ASR 或平台字幕实际识别出的原文语言。 */
  detectedLanguage?: DetectedLanguage
  targetLanguage: string
  /** 创建/重试时的运行配置；旧任务可能缺失 */
  options?: TaskRuntimeOptions
  /**
   * 在线任务的来源链接（与 videoFile.sourceUrl 同步）。
   * 重试时若本地文件缺失，可据此重新下载。
   */
  sourceUrl?: string
  /**
   * 平台原生/自动字幕文件路径（yt-dlp 下载）。
   * 有值且可读时流水线跳过 ASR，以该字幕为原文源。
   */
  platformSubtitlePath?: string
  /** 平台字幕语言码（如 en、zh-Hans），仅诊断用 */
  platformSubtitleLanguage?: string
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
  /** 从在线链接下载视频（yt-dlp） */
  DOWNLOADING = 'downloading',
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
