import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IpcChannels,
  type ArtifactKind,
  type BurnSubtitleColors,
} from '../shared/ipc'
import type { AppSettings, SubtitleBurnMode } from '../shared/settings'
import type { SystemCheckProgress } from '../shared/system-check'
import type {
  OllamaModel,
  TaskLog,
  TranslationTask,
} from '../shared/types/video'

declare global {
  interface Window {
    App: {
      openFileDialog: () => Promise<string[]>
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
        settings: AppSettings | Partial<AppSettings>
      ) => Promise<{ success: boolean; taskIds?: string[]; error?: string }>
      createTasksFromUrls: (
        urls: string[],
        settings: AppSettings | Partial<AppSettings>
      ) => Promise<{ success: boolean; taskIds?: string[]; error?: string }>

      getAllTasks: () => Promise<TranslationTask[]>
      getTask: (taskId: string) => Promise<TranslationTask | null>
      pauseTask: (taskId: string) => Promise<{ success: boolean }>
      resumeTask: (taskId: string) => Promise<{ success: boolean }>
      deleteTask: (taskId: string) => Promise<{ success: boolean }>
      retryTask: (taskId: string) => Promise<{ success: boolean }>
      burnTaskSubtitles: (
        taskId: string,
        mode: SubtitleBurnMode,
        colors?: BurnSubtitleColors
      ) => Promise<{ success: boolean; burnedVideo?: string; error?: string }>
      getTaskLogs: (taskId: string) => Promise<TaskLog[]>

      getByokApiKeyStatus: () => Promise<{
        success: boolean
        configured: boolean
      }>
      setByokApiKey: (
        apiKey: string
      ) => Promise<{ success: boolean; error?: string }>
      clearByokApiKey: () => Promise<{ success: boolean; error?: string }>

      getOllamaModels: () => Promise<{
        success: boolean
        models: OllamaModel[]
        error?: string
      }>
      checkOllamaStatus: () => Promise<{
        success: boolean
        isRunning: boolean
      }>
      pullOllamaModel: (
        modelName: string
      ) => Promise<{ success: boolean; error?: string }>

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

      onTaskUpdated: (callback: (task: TranslationTask) => void) => () => void
      onTaskDeleted: (callback: (taskId: string) => void) => () => void
      onOllamaPullProgress: (
        callback: (data: { modelName: string; progress: string }) => void
      ) => () => void
      onSystemCheckProgress: (
        callback: (progress: SystemCheckProgress) => void
      ) => () => void
    }
  }
}

const api = {
  openFileDialog: () => ipcRenderer.invoke(IpcChannels.openFileDialog),
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
    settings: AppSettings | Partial<AppSettings>
  ) => ipcRenderer.invoke(IpcChannels.uploadFiles, filePaths, settings),
  createTasksFromUrls: (
    urls: string[],
    settings: AppSettings | Partial<AppSettings>
  ) => ipcRenderer.invoke(IpcChannels.createTasksFromUrls, urls, settings),

  getAllTasks: () => ipcRenderer.invoke(IpcChannels.getAllTasks),
  getTask: (taskId: string) => ipcRenderer.invoke(IpcChannels.getTask, taskId),
  pauseTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.pauseTask, taskId),
  resumeTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.resumeTask, taskId),
  deleteTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.deleteTask, taskId),
  retryTask: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.retryTask, taskId),
  burnTaskSubtitles: (
    taskId: string,
    mode: SubtitleBurnMode,
    colors?: BurnSubtitleColors
  ) =>
    ipcRenderer.invoke(IpcChannels.burnTaskSubtitles, taskId, mode, colors),
  getTaskLogs: (taskId: string) =>
    ipcRenderer.invoke(IpcChannels.getTaskLogs, taskId),

  getByokApiKeyStatus: () => ipcRenderer.invoke(IpcChannels.byokApiKeyStatus),
  setByokApiKey: (apiKey: string) =>
    ipcRenderer.invoke(IpcChannels.setByokApiKey, apiKey),
  clearByokApiKey: () => ipcRenderer.invoke(IpcChannels.clearByokApiKey),

  getOllamaModels: () => ipcRenderer.invoke(IpcChannels.getOllamaModels),
  checkOllamaStatus: () => ipcRenderer.invoke(IpcChannels.checkOllamaStatus),
  pullOllamaModel: (modelName: string) =>
    ipcRenderer.invoke(IpcChannels.pullOllamaModel, modelName),

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

  onTaskUpdated: (callback: (task: TranslationTask) => void) => {
    const listener = (_event: unknown, task: TranslationTask) => callback(task)
    ipcRenderer.on(IpcChannels.taskUpdated, listener)
    return () =>
      ipcRenderer.removeListener(IpcChannels.taskUpdated, listener)
  },

  onTaskDeleted: (callback: (taskId: string) => void) => {
    const listener = (_event: unknown, taskId: string) => callback(taskId)
    ipcRenderer.on(IpcChannels.taskDeleted, listener)
    return () =>
      ipcRenderer.removeListener(IpcChannels.taskDeleted, listener)
  },

  onOllamaPullProgress: (
    callback: (data: { modelName: string; progress: string }) => void
  ) => {
    const listener = (
      _event: unknown,
      data: { modelName: string; progress: string }
    ) => callback(data)
    ipcRenderer.on(IpcChannels.ollamaPullProgress, listener)
    return () =>
      ipcRenderer.removeListener(IpcChannels.ollamaPullProgress, listener)
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
}

contextBridge.exposeInMainWorld('App', api)
