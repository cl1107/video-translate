import { app, dialog, ipcMain, shell } from 'electron'
import { makeAppWithSingleInstanceLock } from 'lib/electron-app/factories/app/instance'
import { makeAppSetup } from 'lib/electron-app/factories/app/setup'
import type { AsrEngineId } from '../shared/constants'
import { normalizeOllamaModel } from '../shared/settings'
import { sherpaTranscriber } from './services/asr/sherpa-transcriber'
import { ollamaClient } from './services/ollama/client'
import { taskManager } from './services/task-manager'
import { ensureGuiCommandPath } from './utils/command-path'
import {
  checkSystemDependencies,
  getInstallationSuggestions,
} from './utils/system-check'
import { getAppDiagnosticPaths } from './utils/system-logger'
import { MainWindow } from './windows/main'

// IPC 处理器
function setupIpcHandlers() {
  // 文件上传处理
  ipcMain.handle(
    'upload-files',
    async (
      _event,
      filePaths: string[],
      settings: {
        sourceLanguage: string
        targetLanguage: string
        ollamaModel?: string
        asrEngine?: AsrEngineId
        burnSubtitles?: boolean
        burnSubtitleMode?: 'bilingual' | 'translated' | 'original'
        polishTranscript?: boolean
      }
    ) => {
      try {
        const taskIds: string[] = []

        for (const filePath of filePaths) {
          const taskId = await taskManager.createTask({
            filePath,
            sourceLanguage: settings.sourceLanguage,
            targetLanguage: settings.targetLanguage,
            ollamaModel: normalizeOllamaModel(settings.ollamaModel),
            asrEngine: settings.asrEngine,
            burnSubtitles: settings.burnSubtitles,
            burnSubtitleMode: settings.burnSubtitleMode,
            polishTranscript: settings.polishTranscript,
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

  // 获取所有任务
  ipcMain.handle('get-all-tasks', () => {
    return taskManager.getAllTasks()
  })

  // 获取特定任务
  ipcMain.handle('get-task', (event, taskId: string) => {
    return taskManager.getTask(taskId)
  })

  // 暂停任务
  ipcMain.handle('pause-task', (event, taskId: string) => {
    taskManager.pauseTask(taskId)
    return { success: true }
  })

  // 恢复任务
  ipcMain.handle('resume-task', (event, taskId: string) => {
    taskManager.resumeTask(taskId)
    return { success: true }
  })

  // 删除任务
  ipcMain.handle('delete-task', (event, taskId: string) => {
    taskManager.deleteTask(taskId)
    return { success: true }
  })

  // 重试任务
  ipcMain.handle('retry-task', (event, taskId: string) => {
    taskManager.retryTask(taskId)
    return { success: true }
  })

  // 获取任务日志
  ipcMain.handle('get-task-logs', (event, taskId: string) => {
    return taskManager.getTaskLogs(taskId)
  })

  // 获取 Ollama 模型列表
  ipcMain.handle('get-ollama-models', async () => {
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

  // 检查 Ollama 服务状态
  ipcMain.handle('check-ollama-status', async () => {
    try {
      const isRunning = await ollamaClient.isRunning()
      return { success: true, isRunning }
    } catch (error) {
      console.error('检查 Ollama 状态失败:', error)
      return { success: false, isRunning: false }
    }
  })

  // 拉取 Ollama 模型
  ipcMain.handle('pull-ollama-model', async (event, modelName: string) => {
    try {
      await ollamaClient.pullModel(modelName, progress => {
        // 发送进度更新到前端
        event.sender.send('ollama-pull-progress', { modelName, progress })
      })
      return { success: true }
    } catch (error) {
      console.error('拉取 Ollama 模型失败:', error)
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // 检查系统依赖
  ipcMain.handle('check-system-dependencies', async event => {
    try {
      const results = await checkSystemDependencies({
        onProgress: progress => {
          event.sender.send('system-check-progress', progress)
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

  // 获取诊断路径（日志目录 / userData）
  ipcMain.handle('get-diagnostic-paths', () => {
    return { success: true, ...getAppDiagnosticPaths() }
  })

  // 在文件管理器中打开日志目录
  ipcMain.handle('open-logs-dir', async () => {
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

  // ASR 模型状态
  ipcMain.handle('get-asr-status', async () => {
    try {
      const models = sherpaTranscriber.getStatus()
      return { success: true, models }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage, models: [] }
    }
  })

  // 打开文件对话框
  ipcMain.handle('open-file-dialog', async () => {
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
    'open-task-artifact',
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

  // 获取统计信息
  ipcMain.handle('get-statistics', () => {
    return taskManager.getStatistics()
  })

  // 临时缓存状态
  ipcMain.handle('get-temp-cache-stats', async () => {
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

  // 清理临时缓存（保留进行中任务目录）
  ipcMain.handle('clear-temp-cache', async () => {
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

  // 在文件管理器中打开临时缓存目录
  ipcMain.handle('open-temp-cache-dir', async () => {
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

  // 打包后 GUI 进程 PATH 极短，补齐 Homebrew / Ollama 等常见路径
  ensureGuiCommandPath()

  // 设置 IPC 处理器
  setupIpcHandlers()

  // 创建主窗口
  const mainWindow = await makeAppSetup(MainWindow)

  // 设置任务管理器的主窗口引用
  taskManager.setMainWindow(mainWindow)
})

// 应用退出时清理资源
app.on('before-quit', () => {
  taskManager.cleanup()
})
