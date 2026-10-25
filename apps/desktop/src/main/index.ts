import { app, dialog, ipcMain, shell } from 'electron'
import { makeAppWithSingleInstanceLock } from 'lib/electron-app/factories/app/instance'
import { makeAppSetup } from 'lib/electron-app/factories/app/setup'
import { IpcChannels } from '../shared/ipc'
import {
  normalizeTaskCreationSettings,
  type SubtitleBurnMode,
} from '../shared/settings'
import { normalizeTaskKind, type TaskKind } from '../shared/types/video'
import { sherpaTranscriber } from './services/asr/sherpa-transcriber'
import { listEndpointModels } from './services/llm/llm-config'
import {
  clearLlmApiKey,
  hasLlmApiKey,
  setLlmApiKey,
} from './services/secure-store'
import { taskManager } from './services/task-manager'
import { updateChecker } from './services/update-checker'
import { ensureGuiCommandPath } from './utils/command-path'
import {
  checkSystemDependencies,
  getInstallationSuggestions,
} from './utils/system-check'
import { getAppDiagnosticPaths } from './utils/system-logger'
import { resolveTaskArtifactPath } from './utils/task-artifact-path'
import { MainWindow } from './windows/main'

function setupIpcHandlers() {
  ipcMain.handle(
    IpcChannels.uploadFiles,
    async (
      _event,
      filePaths: string[],
      settingsRaw: unknown,
      kindRaw?: unknown
    ) => {
      try {
        const settings = normalizeTaskCreationSettings(
          settingsRaw as Parameters<typeof normalizeTaskCreationSettings>[0]
        )
        const kind = normalizeTaskKind(kindRaw)
        const taskIds: string[] = []

        for (const filePath of filePaths) {
          const taskId = await taskManager.createTask({
            filePath,
            ...settings,
            kind,
          })
          taskIds.push(taskId)
        }

        return { success: true, taskIds }
      } catch (error) {
        console.error('文件上传失败:', error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  ipcMain.handle(
    IpcChannels.createTasksFromUrls,
    async (
      _event,
      urlsRaw: unknown,
      settingsRaw: unknown,
      kindRaw?: unknown
    ) => {
      try {
        const settings = normalizeTaskCreationSettings(
          settingsRaw as Parameters<typeof normalizeTaskCreationSettings>[0]
        )
        const kind = normalizeTaskKind(kindRaw)
        const urls = Array.isArray(urlsRaw)
          ? urlsRaw.filter((u): u is string => typeof u === 'string')
          : []
        if (urls.length === 0) {
          return { success: false, error: '请提供至少一个视频链接' }
        }

        const taskIds: string[] = []
        for (const url of urls) {
          const taskId = await taskManager.createTaskFromUrl({
            url,
            ...settings,
            kind,
          })
          taskIds.push(taskId)
        }

        return { success: true, taskIds }
      } catch (error) {
        console.error('创建在线任务失败:', error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  ipcMain.handle(IpcChannels.llmApiKeyStatus, () => {
    return { success: true, configured: hasLlmApiKey() }
  })

  ipcMain.handle(IpcChannels.setLlmApiKey, (_event, apiKey: string) => {
    return setLlmApiKey(typeof apiKey === 'string' ? apiKey : '')
  })

  ipcMain.handle(IpcChannels.clearLlmApiKey, () => {
    return clearLlmApiKey()
  })

  ipcMain.handle(
    IpcChannels.listLlmModels,
    async (_event, baseUrlRaw: unknown, apiKeyRaw?: unknown) => {
      const baseUrl = typeof baseUrlRaw === 'string' ? baseUrlRaw.trim() : ''
      // 未显式传入 Key 时回退 secure store（表单里 Key 可后填）
      const apiKey =
        typeof apiKeyRaw === 'string' && apiKeyRaw.trim()
          ? apiKeyRaw
          : undefined
      if (!baseUrl) {
        return { success: false, models: [], error: 'Endpoint 不能为空' }
      }
      try {
        const result = await listEndpointModels(baseUrl, apiKey)
        return result.ok
          ? { success: true, models: result.models }
          : { success: false, models: [], error: result.error }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        return { success: false, models: [], error: errorMessage }
      }
    }
  )

  ipcMain.handle(IpcChannels.getAllTasks, (_event, kindRaw?: unknown) => {
    const kind =
      kindRaw === 'subtitle' || kindRaw === 'document'
        ? (kindRaw as TaskKind)
        : undefined
    return taskManager.getAllTasks(kind)
  })

  ipcMain.handle(IpcChannels.getTask, (_event, taskId: string) => {
    return taskManager.getTask(taskId)
  })

  ipcMain.handle(
    IpcChannels.getTaskMarkdownContent,
    async (_event, taskId: string) => {
      return taskManager.getTaskMarkdownContent(taskId)
    }
  )

  ipcMain.handle(IpcChannels.pauseTask, (_event, taskId: string) => {
    taskManager.pauseTask(taskId)
    return { success: true }
  })

  ipcMain.handle(IpcChannels.resumeTask, (_event, taskId: string) => {
    taskManager.resumeTask(taskId)
    return { success: true }
  })

  ipcMain.handle(IpcChannels.deleteTask, (_event, taskId: string) => {
    taskManager.deleteTask(taskId)
    return { success: true }
  })

  ipcMain.handle(
    IpcChannels.deleteTasks,
    async (_event, taskIdsRaw: unknown) => {
      try {
        const taskIds = Array.isArray(taskIdsRaw)
          ? taskIdsRaw.filter(
              (value): value is string => typeof value === 'string'
            )
          : []
        const result = await taskManager.deleteTasks(taskIds)
        return { success: true, ...result }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          success: false,
          deletedTaskIds: [],
          rejected: [],
          error: message,
        }
      }
    }
  )
  ipcMain.handle(IpcChannels.retryTask, (_event, taskId: string) => {
    taskManager.retryTask(taskId)
    return { success: true }
  })

  ipcMain.handle(IpcChannels.getTaskLogs, (_event, taskId: string) => {
    return taskManager.getTaskLogs(taskId)
  })

  ipcMain.handle(IpcChannels.checkSystemDependencies, async event => {
    try {
      const results = await checkSystemDependencies({
        onProgress: progress => {
          event.sender.send(IpcChannels.systemCheckProgress, progress)
        },
      })
      const suggestions = getInstallationSuggestions(results)
      const diagnosticPaths = getAppDiagnosticPaths()
      return { success: true, results, suggestions, diagnosticPaths }
    } catch (error) {
      console.error('检查系统依赖失败:', error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMessage,
        results: [],
        suggestions: [],
        diagnosticPaths: getAppDiagnosticPaths(),
      }
    }
  })

  ipcMain.handle(IpcChannels.getDiagnosticPaths, () => {
    return { success: true, ...getAppDiagnosticPaths() }
  })

  ipcMain.handle(IpcChannels.openLogsDir, async () => {
    try {
      const { logsDir } = getAppDiagnosticPaths()
      const error = await shell.openPath(logsDir)
      if (error) {
        return { success: false, error, path: logsDir }
      }
      return { success: true, path: logsDir }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle(IpcChannels.openExternalUrl, async (_event, url: string) => {
    try {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return { success: false, error: '仅支持 http(s) 链接' }
      }
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle(IpcChannels.getAsrStatus, async () => {
    try {
      const models = sherpaTranscriber.getStatus()
      return { success: true, models }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage, models: [] }
    }
  })

  ipcMain.handle(
    IpcChannels.openFileDialog,
    async (_event, mediaRaw?: unknown) => {
      const media = mediaRaw === 'document' ? 'document' : 'video'
      const filters =
        media === 'document'
          ? [
              {
                name: '音视频文件',
                extensions: [
                  'mp4',
                  'avi',
                  'mov',
                  'mkv',
                  'webm',
                  'wmv',
                  'flv',
                  'mp3',
                  'wav',
                  'm4a',
                  'aac',
                  'flac',
                  'ogg',
                ],
              },
            ]
          : [
              {
                name: '视频文件',
                extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv', 'flv'],
              },
            ]

      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters,
      })

      return result.filePaths
    }
  )

  ipcMain.handle(
    IpcChannels.openTaskArtifact,
    async (
      _event,
      taskId: string,
      kind: 'video' | 'subtitle' | 'result' | 'markdown'
    ) => {
      const task = taskManager.getTask(taskId)
      if (!task) {
        return { success: false, error: '任务不存在' }
      }

      const artifactPath = resolveTaskArtifactPath(task, kind)
      if (!artifactPath) {
        return { success: false, error: '任务产物不存在' }
      }

      const error = await shell.openPath(artifactPath)
      return error ? { success: false, error } : { success: true }
    }
  )

  ipcMain.handle(
    IpcChannels.burnTaskSubtitles,
    async (
      _event,
      taskId: string,
      mode: SubtitleBurnMode,
      colors?: {
        originalColor?: string
        translatedColor?: string
      }
    ) => {
      try {
        return await taskManager.burnSubtitlesForTask(taskId, mode, colors)
      } catch (error) {
        console.error('补烧硬字幕失败:', error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

  ipcMain.handle(IpcChannels.getStatistics, () => {
    return taskManager.getStatistics()
  })

  ipcMain.handle(IpcChannels.getTempCacheStats, async () => {
    try {
      const stats = await taskManager.getTempCacheStats()
      return { success: true, ...stats }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMessage,
        path: '',
        totalBytes: 0,
        fileCount: 0,
        entryCount: 0,
      }
    }
  })

  ipcMain.handle(IpcChannels.clearTempCache, async () => {
    try {
      const result = await taskManager.clearTempCache()
      return { success: true, ...result }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMessage,
        freedBytes: 0,
        removedEntries: 0,
      }
    }
  })

  ipcMain.handle(IpcChannels.openTempCacheDir, async () => {
    try {
      const stats = await taskManager.getTempCacheStats()
      await shell.openPath(stats.path)
      return { success: true, path: stats.path }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle(IpcChannels.getUpdateStatus, () => {
    return { success: true, status: updateChecker.getStatus() }
  })

  ipcMain.handle(IpcChannels.checkForUpdates, async () => {
    const status = await updateChecker.checkNow(true)
    return { success: true, status, error: status.error ?? undefined }
  })

  ipcMain.handle(IpcChannels.dismissUpdate, (_event, version: string) => {
    updateChecker.dismiss(version)
    return { success: true }
  })

  ipcMain.handle(IpcChannels.setUpdateAutoCheck, (_event, enabled: boolean) => {
    updateChecker.setAutoCheck(Boolean(enabled))
    return { success: true, status: updateChecker.getStatus() }
  })
}

makeAppWithSingleInstanceLock(async () => {
  await app.whenReady()

  ensureGuiCommandPath()
  setupIpcHandlers()

  const mainWindow = await makeAppSetup(MainWindow)
  taskManager.setMainWindow(mainWindow)
  updateChecker.start(mainWindow)
})

app.on('before-quit', () => {
  taskManager.cleanup()
  updateChecker.dispose()
})
