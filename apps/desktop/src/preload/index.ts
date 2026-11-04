import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type ArtifactKind,
  type BurnSubtitleColors,
  type DeleteTasksResult,
  type FileDialogMedia,
} from '../shared/ipc'
import type { SubtitleBurnMode, TaskCreationSettings } from '../shared/settings'
import type { SystemCheckProgress } from '../shared/system-check'
import type {
  TaskKind,
  TaskLog,
  TranscriptionSegment,
  TranslationTask,
} from '../shared/types/video'
import type { UpdateCheckerStatus } from '../shared/update-checker'

declare global {
  interface Window {
    App: {
      openFileDialog: (media?: FileDialogMedia) => Promise<string[]>
      /**
       * Electron 32+ 起 File.path 在渲染进程不可用，
       * 拖放/文件输入必须经 preload 用 webUtils 解析本地路径。
       */
      getPathForFile: (file: File) => string
      openTaskArtifact: (
        taskId: string,
        kind: ArtifactKind
      ) => Promise<{ success: boolean; error?: string }>
      uploadFiles: (
        filePaths: string[],
        settings: TaskCreationSettings | Partial<TaskCreationSettings>,
        kind?: TaskKind
      ) => Promise<{ success: boolean; taskIds?: string[]; error?: string }>
      createTasksFromUrls: (
        urls: string[],
        settings: TaskCreationSettings | Partial<TaskCreationSettings>,
        kind?: TaskKind
      ) => Promise<{ success: boolean; taskIds?: string[]; error?: string }>

      getAllTasks: (kind?: TaskKind) => Promise<TranslationTask[]>
      getTask: (taskId: string) => Promise<TranslationTask | null>
      getTaskMarkdownContent: (taskId: string) => Promise<{
        success: boolean
        content?: string
        path?: string
        error?: string
      }>
      pauseTask: (taskId: string) => Promise<{ success: boolean }>
      resumeTask: (taskId: string) => Promise<{ success: boolean }>
      deleteTask: (taskId: string) => Promise<{ success: boolean }>
      deleteTasks: (taskIds: string[]) => Promise<DeleteTasksResult>
      retryTask: (taskId: string) => Promise<{ success: boolean }>
      burnTaskSubtitles: (
        taskId: string,
        mode: SubtitleBurnMode,
        colors?: BurnSubtitleColors
      ) => Promise<{ success: boolean; burnedVideo?: string; error?: string }>
      getTaskLogs: (taskId: string) => Promise<TaskLog[]>
      attachTaskMedia: (
        taskId: string
      ) => Promise<{ success: boolean; error?: string }>
      importSubtitles: (settings?: Partial<TaskCreationSettings>) => Promise<{
        success: boolean
        taskId?: string
        error?: string
      }>
      updateTaskSegment: (
        taskId: string,
        segment: TranscriptionSegment
      ) => Promise<{ success: boolean; error?: string }>
      retranslateTaskSegment: (
        taskId: string,
        segmentId: string
      ) => Promise<{ success: boolean; error?: string }>
      regenerateTaskSubtitles: (
        taskId: string
      ) => Promise<{ success: boolean; error?: string }>
      reuseTaskTranscript: (
        taskId: string,
        options: {
          kind: TaskKind
          targetLanguage: string
          settings?: Partial<TaskCreationSettings>
        }
      ) => Promise<{ success: boolean; taskId?: string; error?: string }>
      getTaskMediaUrl: (
        taskId: string
      ) => Promise<{ success: boolean; url?: string; error?: string }>

      getLlmApiKeyStatus: (serviceId?: string) => Promise<{
        success: boolean
        configured: boolean
      }>
      setLlmApiKey: (
        apiKey: string,
        serviceId?: string
      ) => Promise<{ success: boolean; error?: string }>
      clearLlmApiKey: (
        serviceId?: string
      ) => Promise<{ success: boolean; error?: string }>
      clearAllLlmApiKeys: () => Promise<{ success: boolean; error?: string }>
      /** 拉取 OpenAI 兼容端点 /models（同时充当连接测试）；apiKey 留空时用已存 Key */
      listLlmModels: (
        baseUrl: string,
        apiKey?: string,
        serviceId?: string
      ) => Promise<{
        success: boolean
        models: string[]
        error?: string
      }>

      getAsrStatus: () => Promise<{
        success: boolean
        models: Array<{
          engine: string
          available: boolean
          path?: string
          detail?: string
        }>
        error?: string
      }>

      checkSystemDependencies: () => Promise<{
        success: boolean
        results: Array<{
          name: string
          available: boolean
          version?: string
          error?: string
          resolvedPath?: string
          optional?: boolean
        }>
        suggestions: string[]
        diagnosticPaths?: {
          logsDir: string
          systemCheckLog: string
          userDataDir: string
        }
        error?: string
      }>
      getDiagnosticPaths: () => Promise<{
        success: boolean
        logsDir: string
        systemCheckLog: string
        userDataDir: string
      }>
      openLogsDir: () => Promise<{
        success: boolean
        path?: string
        error?: string
      }>
      openExternalUrl: (
        url: string
      ) => Promise<{ success: boolean; error?: string }>

      getStatistics: () => Promise<unknown>

      getTempCacheStats: () => Promise<{
        success: boolean
        path: string
        totalBytes: number
        fileCount: number
        entryCount: number
        error?: string
      }>
      clearTempCache: () => Promise<{
        success: boolean
        freedBytes: number
        removedEntries: number
        error?: string
      }>
      openTempCacheDir: () => Promise<{
        success: boolean
        path?: string
        error?: string
      }>

      getUpdateStatus: () => Promise<{
        success: boolean
        status: UpdateCheckerStatus
      }>
      checkForUpdates: () => Promise<{
        success: boolean
        status: UpdateCheckerStatus
        error?: string
      }>
      dismissUpdate: (version: string) => Promise<{ success: boolean }>
      setUpdateAutoCheck: (enabled: boolean) => Promise<{
        success: boolean
        status: UpdateCheckerStatus
      }>

      onTaskUpdated: (callback: (task: TranslationTask) => void) => () => void
      onTaskDeleted: (callback: (taskId: string) => void) => () => void
      onSystemCheckProgress: (
        callback: (progress: SystemCheckProgress) => void
      ) => () => void
      onUpdateStatusChanged: (
        callback: (status: UpdateCheckerStatus) => void
      ) => () => void
    }
  }
}

const api = {
  openFileDialog: (media?: FileDialogMedia) =>
    ipcRenderer.invoke(IpcChannels.openFileDialog, media),
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch (error) {
      console.error('getPathForFile 失败:', error)
      return ''
    }
  },
  openTaskArtifact: (taskId: string, kind: ArtifactKind) =>
    ipcRenderer.invoke(IpcChannels.openTaskArtifact, taskId, kind),
  uploadFiles: (
    filePaths: string[],
    settings: TaskCreationSettings | Partial<TaskCreationSettings>,
    kind?: TaskKind
  ) => ipcRenderer.invoke(IpcChannels.uploadFiles, filePaths, settings, kind),
  createTasksFromUrls: (
    urls: string[],
    settings: TaskCreationSettings | Partial<TaskCreationSettings>,
    kind?: TaskKind
  ) =>
    ipcRenderer.invoke(IpcChannels.createTasksFromUrls, urls, settings, kind),

  getAllTasks: (kind?: TaskKind) =>
    ipcRenderer.invoke(IpcChannels.getAllTasks, kind),
  getTask: (taskId: string) => ipcRenderer.invoke(IpcChannels.getTask, taskId),
  getTaskMarkdownContent: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.getTaskMarkdownContent, taskId),
  pauseTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.pauseTask, taskId),
  resumeTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.resumeTask, taskId),
  deleteTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.deleteTask, taskId),
  deleteTasks: (taskIds: string[]) =>
    ipcRenderer.invoke(IpcChannels.deleteTasks, taskIds),
  retryTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.retryTask, taskId),
  burnTaskSubtitles: (
    taskId: string,
    mode: SubtitleBurnMode,
    colors?: BurnSubtitleColors
  ) => ipcRenderer.invoke(IpcChannels.burnTaskSubtitles, taskId, mode, colors),
  getTaskLogs: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.getTaskLogs, taskId),

  attachTaskMedia: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.attachTaskMedia, taskId),
  importSubtitles: (settings?: Partial<TaskCreationSettings>) =>
    ipcRenderer.invoke(IpcChannels.importSubtitles, settings),
  updateTaskSegment: (taskId: string, segment: TranscriptionSegment) =>
    ipcRenderer.invoke(IpcChannels.updateTaskSegment, taskId, segment),
  retranslateTaskSegment: (taskId: string, segmentId: string) =>
    ipcRenderer.invoke(IpcChannels.retranslateTaskSegment, taskId, segmentId),
  regenerateTaskSubtitles: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.regenerateTaskSubtitles, taskId),
  reuseTaskTranscript: (
    taskId: string,
    options: {
      kind: TaskKind
      targetLanguage: string
      settings?: Partial<TaskCreationSettings>
    }
  ) => ipcRenderer.invoke(IpcChannels.reuseTaskTranscript, taskId, options),
  getTaskMediaUrl: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.getTaskMediaUrl, taskId),

  getLlmApiKeyStatus: (serviceId?: string) =>
    ipcRenderer.invoke(IpcChannels.llmApiKeyStatus, serviceId),
  setLlmApiKey: (apiKey: string, serviceId?: string) =>
    ipcRenderer.invoke(IpcChannels.setLlmApiKey, apiKey, serviceId),
  clearLlmApiKey: (serviceId?: string) =>
    ipcRenderer.invoke(IpcChannels.clearLlmApiKey, serviceId),
  clearAllLlmApiKeys: () => ipcRenderer.invoke(IpcChannels.clearAllLlmApiKeys),
  listLlmModels: (baseUrl: string, apiKey?: string, serviceId?: string) =>
    ipcRenderer.invoke(IpcChannels.listLlmModels, baseUrl, apiKey, serviceId),

  getAsrStatus: () => ipcRenderer.invoke(IpcChannels.getAsrStatus),

  checkSystemDependencies: () =>
    ipcRenderer.invoke(IpcChannels.checkSystemDependencies),
  getDiagnosticPaths: () => ipcRenderer.invoke(IpcChannels.getDiagnosticPaths),
  openLogsDir: () => ipcRenderer.invoke(IpcChannels.openLogsDir),
  openExternalUrl: (url: string) =>
    ipcRenderer.invoke(IpcChannels.openExternalUrl, url),

  getStatistics: () => ipcRenderer.invoke(IpcChannels.getStatistics),

  getTempCacheStats: () => ipcRenderer.invoke(IpcChannels.getTempCacheStats),
  clearTempCache: () => ipcRenderer.invoke(IpcChannels.clearTempCache),
  openTempCacheDir: () => ipcRenderer.invoke(IpcChannels.openTempCacheDir),

  getUpdateStatus: () => ipcRenderer.invoke(IpcChannels.getUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannels.checkForUpdates),
  dismissUpdate: (version: string) =>
    ipcRenderer.invoke(IpcChannels.dismissUpdate, version),
  setUpdateAutoCheck: (enabled: boolean) =>
    ipcRenderer.invoke(IpcChannels.setUpdateAutoCheck, enabled),

  onTaskUpdated: (callback: (task: TranslationTask) => void) => {
    const listener = (_event: unknown, task: TranslationTask) => callback(task)
    ipcRenderer.on(IpcChannels.taskUpdated, listener)
    return () => ipcRenderer.removeListener(IpcChannels.taskUpdated, listener)
  },

  onTaskDeleted: (callback: (taskId: string) => void) => {
    const listener = (_event: unknown, taskId: string) => callback(taskId)
    ipcRenderer.on(IpcChannels.taskDeleted, listener)
    return () => ipcRenderer.removeListener(IpcChannels.taskDeleted, listener)
  },

  onSystemCheckProgress: (
    callback: (progress: SystemCheckProgress) => void
  ) => {
    const listener = (_event: unknown, progress: SystemCheckProgress) =>
      callback(progress)
    ipcRenderer.on(IpcChannels.systemCheckProgress, listener)
    return () =>
      ipcRenderer.removeListener(IpcChannels.systemCheckProgress, listener)
  },

  onUpdateStatusChanged: (callback: (status: UpdateCheckerStatus) => void) => {
    const listener = (_event: unknown, status: UpdateCheckerStatus) =>
      callback(status)
    ipcRenderer.on(IpcChannels.updateStatusChanged, listener)
    return () =>
      ipcRenderer.removeListener(IpcChannels.updateStatusChanged, listener)
  },
}

contextBridge.exposeInMainWorld('App', api)
