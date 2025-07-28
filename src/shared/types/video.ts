// 视频翻译任务相关类型定义

export interface VideoFile {
  id: string;
  name: string;
  path: string;
  size: number;
  duration: number;
  format: string;
  createdAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
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

export interface TranslationSettings {
  ollamaModel: string;
  whisperModel: string;
  sourceLanguage: string;
  targetLanguage: string;
  maxSegmentLength: number;
  outputFormat: "srt" | "vtt" | "txt";
  burnSubtitles: boolean;
}
