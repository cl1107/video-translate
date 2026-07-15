/**
 * 主进程 / preload / 渲染进程共享的 IPC 契约。
 * channel 名与载荷形状只在此处定义一次。
 */
import type { AsrEngineId } from './constants'
import type { AppSettings, SubtitleBurnMode } from './settings'
import type {
  OllamaModel,
  TaskLog,
  TaskOutputArtifacts,
  TranslationTask,
} from './types/video'

export const IpcChannels = {
  // 文件 / 上传
  openFileDialog: 'open-file-dialog',
  openTaskArtifact: 'open-task-artifact',
  uploadFiles: 'upload-files',
  /** 从在线视频链接创建任务（yt-dlp 下载后走同一翻译流水线） */
  createTasksFromUrls: 'create-tasks-from-urls',

  // 任务
  getAllTasks: 'get-all-tasks',
  getTask: 'get-task',
  pauseTask: 'pause-task',
  resumeTask: 'resume-task',
  deleteTask: 'delete-task',
  retryTask: 'retry-task',
  burnTaskSubtitles: 'burn-task-subtitles',
  getTaskLogs: 'get-task-logs',

  // BYOK
  byokApiKeyStatus: 'byok-api-key-status',
  setByokApiKey: 'set-byok-api-key',
  clearByokApiKey: 'clear-byok-api-key',

  // Ollama
  getOllamaModels: 'get-ollama-models',
  checkOllamaStatus: 'check-ollama-status',
  pullOllamaModel: 'pull-ollama-model',

  // ASR / 系统
  getAsrStatus: 'get-asr-status',
  checkSystemDependencies: 'check-system-dependencies',
  getDiagnosticPaths: 'get-diagnostic-paths',
  openLogsDir: 'open-logs-dir',

  // 统计 / 临时缓存
  getStatistics: 'get-statistics',
  getTempCacheStats: 'get-temp-cache-stats',
  clearTempCache: 'clear-temp-cache',
  openTempCacheDir: 'open-temp-cache-dir',

  // 主 → 渲染事件
  taskUpdated: 'task-updated',
  taskDeleted: 'task-deleted',
  ollamaPullProgress: 'ollama-pull-progress',
  systemCheckProgress: 'system-check-progress',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** 上传任务时使用完整 AppSettings（normalize 后） */
export type UploadFilesSettings = AppSettings

export type ArtifactKind = 'video' | 'subtitle' | 'result'

export interface BurnSubtitleColors {
  originalColor?: string
  translatedColor?: string
}

export interface SuccessResult {
  success: true
}

export interface FailureResult {
  success: false
  error: string
}

export type SimpleResult = SuccessResult | FailureResult

export interface UploadFilesResult {
  success: boolean
  taskIds?: string[]
  error?: string
}

export type CreateTasksFromUrlsResult = UploadFilesResult

export interface BurnTaskSubtitlesResult {
  success: boolean
  burnedVideo?: string
  error?: string
}

export interface ByokStatusResult {
  success: boolean
  configured: boolean
}

export interface OllamaModelsResult {
  success: boolean
  models: OllamaModel[]
  error?: string
}

export interface OllamaStatusResult {
  success: boolean
  isRunning: boolean
}

export interface AsrStatusResult {
  success: boolean
  models: Array<{
    engine: string
    available: boolean
    path?: string
    detail?: string
  }>
  error?: string
}

export interface TempCacheStatsResult {
  success: boolean
  path: string
  totalBytes: number
  fileCount: number
  entryCount: number
  error?: string
}

export interface ClearTempCacheResult {
  success: boolean
  freedBytes: number
  removedEntries: number
  error?: string
}

export interface OpenPathResult {
  success: boolean
  path?: string
  error?: string
}

export type { AppSettings, AsrEngineId, SubtitleBurnMode }
export type { TaskLog, TaskOutputArtifacts, TranslationTask }
