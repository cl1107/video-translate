import { contextBridge, ipcRenderer } from 'electron'
import type { TranslationTask } from '../shared/types/video'

declare global {
  interface Window {
    App: {
      // 文件操作
      openFileDialog: () => Promise<string[]>
      openTaskArtifact: (
        taskId: string,
        kind: 'video' | 'subtitle' | 'result'
      ) => Promise<{ success: boolean; error?: string }>
      uploadFiles: (
        filePaths: string[],
        settings: {
          sourceLanguage: string
          targetLanguage: string
          ollamaModel?: string
          asrEngine?: 'sensevoice' | 'funasr-nano'
          burnSubtitles?: boolean
        }
      ) => Promise<{ success: boolean; taskIds?: string[]; error?: string }>

      // 任务管理
      getAllTasks: () => Promise<TranslationTask[]>
      getTask: (taskId: string) => Promise<TranslationTask | null>
      pauseTask: (taskId: string) => Promise<{ success: boolean }>
      resumeTask: (taskId: string) => Promise<{ success: boolean }>
      deleteTask: (taskId: string) => Promise<{ success: boolean }>
      retryTask: (taskId: string) => Promise<{ success: boolean }>
      getTaskLogs: (taskId: string) => Promise<any[]>

      // Ollama 服务
      getOllamaModels: () => Promise<{
        success: boolean
        models: any[]
        error?: string
      }>
      checkOllamaStatus: () => Promise<{
        success: boolean
        isRunning: boolean
      }>
      pullOllamaModel: (
        modelName: string
      ) => Promise<{ success: boolean; error?: string }>

      // ASR 状态
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

      // 系统检查
      checkSystemDependencies: () => Promise<{
        success: boolean
        results: Array<{
          name: string
          available: boolean
          version?: string
          error?: string
        }>
        suggestions: string[]
        error?: string
      }>

      // 统计信息
      getStatistics: () => Promise<any>

      // 临时缓存
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

      // 事件监听
      onTaskUpdated: (callback: (task: TranslationTask) => void) => () => void
      onTaskDeleted: (callback: (taskId: string) => void) => () => void
      onOllamaPullProgress: (
        callback: (data: { modelName: string; progress: string }) => void
      ) => () => void
    }
  }
}

const api = {
  // 文件操作
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openTaskArtifact: (taskId: string, kind: 'video' | 'subtitle' | 'result') =>
    ipcRenderer.invoke('open-task-artifact', taskId, kind),
  uploadFiles: (
    filePaths: string[],
    settings: {
      sourceLanguage: string
      targetLanguage: string
      ollamaModel?: string
      asrEngine?: 'sensevoice' | 'funasr-nano'
      burnSubtitles?: boolean
    }
  ) => ipcRenderer.invoke('upload-files', filePaths, settings),

  // 任务管理
  getAllTasks: () => ipcRenderer.invoke('get-all-tasks'),
  getTask: (taskId: string) => ipcRenderer.invoke('get-task', taskId),
  pauseTask: (taskId: string) => ipcRenderer.invoke('pause-task', taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke('resume-task', taskId),
  deleteTask: (taskId: string) => ipcRenderer.invoke('delete-task', taskId),
  retryTask: (taskId: string) => ipcRenderer.invoke('retry-task', taskId),
  getTaskLogs: (taskId: string) => ipcRenderer.invoke('get-task-logs', taskId),

  // Ollama 服务
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  checkOllamaStatus: () => ipcRenderer.invoke('check-ollama-status'),
  pullOllamaModel: (modelName: string) =>
    ipcRenderer.invoke('pull-ollama-model', modelName),

  // ASR 状态
  getAsrStatus: () => ipcRenderer.invoke('get-asr-status'),

  // 系统检查
  checkSystemDependencies: () =>
    ipcRenderer.invoke('check-system-dependencies'),

  // 统计信息
  getStatistics: () => ipcRenderer.invoke('get-statistics'),

  // 临时缓存
  getTempCacheStats: () => ipcRenderer.invoke('get-temp-cache-stats'),
  clearTempCache: () => ipcRenderer.invoke('clear-temp-cache'),
  openTempCacheDir: () => ipcRenderer.invoke('open-temp-cache-dir'),

  // 事件监听
  onTaskUpdated: (callback: (task: TranslationTask) => void) => {
    const listener = (event: any, task: TranslationTask) => callback(task)
    ipcRenderer.on('task-updated', listener)
    return () => ipcRenderer.removeListener('task-updated', listener)
  },

  onTaskDeleted: (callback: (taskId: string) => void) => {
    const listener = (event: any, taskId: string) => callback(taskId)
    ipcRenderer.on('task-deleted', listener)
    return () => ipcRenderer.removeListener('task-deleted', listener)
  },

  onOllamaPullProgress: (
    callback: (data: { modelName: string; progress: string }) => void
  ) => {
    const listener = (
      event: any,
      data: { modelName: string; progress: string }
    ) => callback(data)
    ipcRenderer.on('ollama-pull-progress', listener)
    return () => ipcRenderer.removeListener('ollama-pull-progress', listener)
  },
}

contextBridge.exposeInMainWorld('App', api)
