import { app, dialog, ipcMain, shell } from 'electron'
import { makeAppWithSingleInstanceLock } from 'lib/electron-app/factories/app/instance'
import { makeAppSetup } from 'lib/electron-app/factories/app/setup'
import { IpcChannels } from '../shared/ipc'
import {
  normalizeAppSettings,
  type SubtitleBurnMode,
} from '../shared/settings'
import { sherpaTranscriber } from './services/asr/sherpa-transcriber'
import { ollamaClient } from './services/ollama/client'
import {
  clearByokApiKey,
  hasByokApiKey,
  setByokApiKey,
} from './services/secure-store'
import { taskManager } from './services/task-manager'
import { ensureGuiCommandPath } from './utils/command-path'
import {
  checkSystemDependencies,
  getInstallationSuggestions,
} from './utils/system-check'
import { getAppDiagnosticPaths } from './utils/system-logger'
import { MainWindow } from './windows/main'

function setupIpcHandlers() {
  ipcMain.handle(
    IpcChannels.uploadFiles,
    async (_event, filePaths: string[], settingsRaw: unknown) => {
      try {
        const settings = normalizeAppSettings(
          settingsRaw as Parameters<typeof normalizeAppSettings>[0]
        )
        const taskIds: string[] = []

        for (const filePath of filePaths) {
          const taskId = await taskManager.createTask({
            filePath,
            ...settings,
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
    async (_event, urlsRaw: unknown, settingsRaw: unknown) => {
      try {
        const settings = normalizeAppSettings(
          settingsRaw as Parameters<typeof normalizeAppSettings>[0]
        )
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

  ipcMain.handle(IpcChannels.byokApiKeyStatus, () => {
    return { success: true, configured: hasByokApiKey() }
  })

  ipcMain.handle(IpcChannels.setByokApiKey, (_event, apiKey: string) => {
    return setByokApiKey(typeof apiKey === 'string' ? apiKey : '')
  })

  ipcMain.handle(IpcChannels.clearByokApiKey, () => {
    return clearByokApiKey()
  })

  ipcMain.handle(IpcChannels.getAllTasks, () => {
    return taskManager.getAllTasks()
  })

  ipcMain.handle(IpcChannels.getTask, (_event, taskId: string) => {
    return taskManager.getTask(taskId)
  })

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

  ipcMain.handle(IpcChannels.retryTask, (_event, taskId: string) => {
    taskManager.retryTask(taskId)
    return { success: true }
  })

  ipcMain.handle(IpcChannels.getTaskLogs, (_event, taskId: string) => {
    return taskManager.getTaskLogs(taskId)
  })

  ipcMain.handle(IpcChannels.getOllamaModels, async () => {
    try {
      const models = await ollamaClient.listModels()
      return { success: true, models }
    } catch (error) {
      console.error('获取 Ollama 模型失败:', error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage, models: [] }
    }
  })

  ipcMain.handle(IpcChannels.checkOllamaStatus, async () => {
    try {
      const isRunning = await ollamaClient.isRunning()
      return { success: true, isRunning }
    } catch (error) {
      console.error('检查 Ollama 状态失败:', error)
      return { success: false, isRunning: false }
    }
  })

  ipcMain.handle(
    IpcChannels.pullOllamaModel,
    async (event, modelName: string) => {
      try {
        await ollamaClient.pullModel(modelName, progress => {
          event.sender.send(IpcChannels.ollamaPullProgress, {
            modelName,
            progress,
          })
        })
        return { success: true }
      } catch (error) {
        console.error('拉取 Ollama 模型失败:', error)
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    }
  )

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

  ipcMain.handle(
    IpcChannels.openExternalUrl,
    async (_event, url: string) => {
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
    }
  )

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

  ipcMain.handle(IpcChannels.openFileDialog, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '视频文件',
          extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'wmv', 'flv'],
        },
      ],
    })

    return result.filePaths
  })

  ipcMain.handle(
    IpcChannels.openTaskArtifact,
    async (_event, taskId: string, kind: 'video' | 'subtitle' | 'result') => {
      const task = taskManager.getTask(taskId)
      if (!task) {
        return { success: false, error: '任务不存在' }
      }

      const artifacts = task.outputArtifacts
      const artifactPath =
        kind === 'video'
          ? artifacts?.burnedVideo
          : kind === 'subtitle'
            ? artifacts?.translatedSubtitle
            : artifacts?.outputDirectory
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
}

makeAppWithSingleInstanceLock(async () => {
  await app.whenReady()

  ensureGuiCommandPath()
  setupIpcHandlers()

  const mainWindow = await makeAppSetup(MainWindow)
  taskManager.setMainWindow(mainWindow)
})

app.on('before-quit', () => {
  taskManager.cleanup()
})
