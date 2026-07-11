// 视频翻译任务相关类型定义

export interface VideoFile {
  id: string;
  name: string;
  path: string;
  size: number;
  duration: number;
  format: string;
  createdAt: string;
}

export interface TaskLog {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
  details?: string;
}

export interface TranslationTask {
  id: string;
  videoFile: VideoFile;
  status: TaskStatus;
  progress: number;
  sourceLanguage: string;
  targetLanguage: string;
  segments: TranscriptionSegment[];
  subtitles: SubtitleEntry[];
  logs: TaskLog[]; // 新增日志字段
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  outputArtifacts?: {
    translatedSubtitle?: string;
    burnedVideo?: string;
    outputDirectory: string;
  };
}

export enum TaskStatus {
  PENDING = "pending",
  EXTRACTING_AUDIO = "extracting_audio",
  TRANSCRIBING = "transcribing",
  TRANSLATING = "translating",
  GENERATING_SUBTITLES = "generating_subtitles",
  COMPLETED = "completed",
  FAILED = "failed",
  PAUSED = "paused",
}

export interface TranscriptionSegment {
  id: string;
  start: number;
  end: number;
  originalText: string;
  translatedText?: string;
  confidence: number;
}

export interface SubtitleEntry {
  index: number;
  start: string; // SRT 时间格式: "00:00:01,000"
  end: string;
  text: string;
}

export interface OllamaModel {
  name: string;
  size: string;
  digest: string;
  modified_at: string;
}

export type AsrEngine = "sensevoice" | "funasr-nano";

export interface TranslationSettings {
  ollamaModel: string;
  /** @deprecated 使用 asrEngine */
  whisperModel?: string;
  asrEngine: AsrEngine;
  sourceLanguage: string;
  targetLanguage: string;
  maxSegmentLength: number;
  outputFormat: "srt" | "vtt" | "txt";
  burnSubtitles: boolean;
}
