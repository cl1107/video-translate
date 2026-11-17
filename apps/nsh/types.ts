/** 与 Rust serde 快照字段对齐（snake_case）。 */

export type TaskKind = 'subtitle' | 'document'
export type Panel = 'add' | 'tasks' | 'settings'
export type ProcessingMode = 'translate' | 'extract'
export type SubtitleOutputLocation = 'output-subdirectory' | 'source-directory'

export type TaskStatus =
  | 'pending'
  | 'downloading'
  | 'extracting_audio'
  | 'transcribing'
  | 'polishing'
  | 'translating'
  | 'generating_subtitles'
  | 'burning_subtitles'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'

export interface GlossaryEntry {
  source: string
  target: string
}

export interface LlmServiceConfig {
  id: string
  name: string
  llm_base_url: string
  translate_model: string
  polish_model: string
}

export interface AppSettings {
  asr_engine: string
  llm_services: LlmServiceConfig[]
  selected_llm_service_id: string
  llm_base_url: string
  translate_model: string
  polish_model: string
  source_language: string
  target_language: string
  output_format: string
  subtitle_output_location: SubtitleOutputLocation
  polish_transcript: boolean
  glossary: GlossaryEntry[]
  original_subtitle_color: string
  translated_subtitle_color: string
  download_proxy: string
  download_cookie_browser: string
  mock_asr: boolean
  mock_llm: boolean
}

export interface TaskRuntimeOptions {
  llm_service_id?: string | null
  llm_base_url: string
  translate_model: string
  polish_model: string
  glossary: GlossaryEntry[]
  asr_engine: string
  burn_subtitles: boolean
  burn_subtitle_mode: string
  subtitle_processing_mode: ProcessingMode
  subtitle_output_location: SubtitleOutputLocation
  polish_transcript: boolean
  original_subtitle_color: string
  translated_subtitle_color: string
  download_proxy: string
  download_cookie_browser: string
}

export interface TaskOutputArtifacts {
  original_subtitle?: string | null
  translated_subtitle?: string | null
  bilingual_subtitle?: string | null
  bilingual_ass?: string | null
  burned_video?: string | null
  polished_markdown?: string | null
  output_directory: string
}

export interface VideoFile {
  id: string
  name: string
  path: string
  size: number
  duration: number
  format: string
  created_at: string
  source_url?: string | null
}

export interface Segment {
  id: string
  start: number
  end: number
  original_text: string
  polished_text?: string | null
  translated_text?: string | null
  translation_status?: string | null
  confidence: number
}

export interface TaskLog {
  id: string
  timestamp: string
  level: string
  message: string
  details?: string | null
}

export interface TranslationTask {
  id: string
  video_file: VideoFile
  kind: TaskKind
  status: TaskStatus
  progress: number
  source_language: string
  detected_language?: string | null
  target_language: string
  options: TaskRuntimeOptions
  source_url?: string | null
  platform_subtitle_path?: string | null
  platform_subtitle_language?: string | null
  segments: Segment[]
  logs: TaskLog[]
  error_message?: string | null
  created_at: string
  updated_at: string
  completed_at?: string | null
  output_artifacts?: TaskOutputArtifacts | null
}

export interface CheckResult {
  name: string
  available: boolean
  version?: string | null
  error?: string | null
  optional: boolean
}

export interface Snapshot {
  kind: TaskKind
  panel: Panel
  path_draft: string
  processing: ProcessingMode
  burn: boolean
  message: string
  selected_id?: string | null
  api_key: string
  settings: AppSettings
  tasks: TranslationTask[]
  checks: CheckResult[]
}

export interface ReviewIssue {
  kind: string
  segmentId: string
  message: string
}
