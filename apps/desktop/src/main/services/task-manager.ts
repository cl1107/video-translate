/**
 * TaskManager：任务生命周期门面（CRUD / 通知 / 队列）。
 * 流水线实现见 translation-pipeline（深层模块）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import dayjs from 'dayjs'
import type { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { IpcChannels } from '../../shared/ipc'
import type { AppSettings, SubtitleBurnMode } from '../../shared/settings'
import {
  normalizeTaskRuntimeOptions,
  taskOptionsFromAppSettings,
} from '../../shared/task-options'
import {
  type TaskLog,
  type TaskOutputArtifacts,
  type TaskRuntimeOptions,
  TaskStatus,
  type TranscriptionSegment,
  type TranslationTask,
  type VideoFile,
} from '../../shared/types/video'
import type { SubtitleColors } from '../utils/subtitle-artifacts'
import { ensureSenseVoiceModel } from './asr/model-downloader'
import { databaseManager } from './database/manager'
import { ffmpegProcessor } from './ffmpeg/processor'
import { ollamaClient } from './ollama/client'
import { getByokApiKey } from './secure-store'
import { tempWorkspace } from './temp-workspace'
import {
  burnHardSubtitlesStage,
  createAbortError,
  isAbortError,
  prepareBurnSubtitleFile,
  resolveSubtitleColors,
  runTranslationPipeline,
} from './translation-pipeline'

export interface CreateTaskOptions extends Partial<AppSettings> {
  filePath: string
  sourceLanguage: string
  targetLanguage: string
}

export class TaskManager {
  private activeTasks = new Map<string, TranslationTask>()
  private mainWindow: BrowserWindow | null = null
  private tempLogs = new Map<string, TaskLog[]>()
  /** 任务级 AbortController：pause / delete 协作取消 */
  private abortControllers = new Map<string, AbortController>()
  /** 简单串行队列，避免多文件并行打爆本机 */
  private runQueue: Array<() => Promise<void>> = []
  private queueRunning = false

  constructor() {
    this.loadActiveTasks()
    void this.initializeServices()
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private async initializeServices(): Promise<void> {
    try {
      const activeIds = [...this.activeTasks.keys()].filter(id => {
        const status = this.activeTasks.get(id)?.status
        return (
          status &&
          status !== TaskStatus.COMPLETED &&
          status !== TaskStatus.FAILED &&
          status !== TaskStatus.CANCELLED
        )
      })
      const stale = await tempWorkspace.cleanupStale(
        24 * 60 * 60 * 1000,
        activeIds
      )
      if (stale.removedEntries > 0) {
        console.log(
          `[Temp] 已清理 ${stale.removedEntries} 项残留缓存，释放约 ${stale.freedBytes} 字节`
        )
      }

      if (!(await ollamaClient.isRunning())) {
        await ollamaClient.startDaemon()
      }

      const asrReady = await ensureSenseVoiceModel(p => {
        if (p.stage === 'downloading' || p.stage === 'extracting') {
          console.log(`[ASR] ${p.message}`)
        }
      })
      if (!asrReady.available) {
        console.warn('SenseVoice 自动准备失败:', asrReady.error)
      }
    } catch (error) {
      console.error('服务初始化失败:', error)
    }
  }

  private addTaskLog(
    taskId: string,
    level: TaskLog['level'],
    message: string,
    details?: string
  ): void {
    const baseLog = {
      timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      level,
      message,
      details,
    }
    const log: TaskLog = { id: uuidv4(), ...baseLog }

    try {
      databaseManager.addTaskLog(taskId, baseLog)
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: string }).code
          : undefined
      if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        const cached = this.tempLogs.get(taskId) ?? []
        cached.push(log)
        this.tempLogs.set(taskId, cached)
      } else {
        console.error('保存日志失败:', error)
      }
    }

    const task = this.activeTasks.get(taskId)
    if (task) {
      task.logs = task.logs ?? []
      task.logs.push(log)
      this.notifyTaskUpdate(task)
    }
  }

  private resolveOptions(task: TranslationTask): TaskRuntimeOptions {
    return normalizeTaskRuntimeOptions(task.options)
  }

  async createTask(options: CreateTaskOptions): Promise<string> {
    const taskId = uuidv4()
    const runtime = taskOptionsFromAppSettings(options)

    try {
      this.addTaskLog(
        taskId,
        'info',
        '开始创建翻译任务',
        `文件路径: ${options.filePath}`
      )

      const stats = await fs.stat(options.filePath)
      if (!stats.isFile()) {
        throw new Error('文件不存在')
      }

      const videoInfo = await ffmpegProcessor.getVideoInfo(options.filePath)
      const videoFile: VideoFile = {
        id: uuidv4(),
        name: path.basename(options.filePath),
        path: options.filePath,
        size: stats.size,
        duration: videoInfo.duration,
        format: videoInfo.format,
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      }

      databaseManager.saveVideoFile(videoFile)

      const task: TranslationTask = {
        id: taskId,
        videoFile,
        status: TaskStatus.PENDING,
        progress: 0,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        options: runtime,
        segments: [],
        subtitles: [],
        logs: [],
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      }

      databaseManager.createTranslationTask(task)
      this.activeTasks.set(taskId, task)

      const cachedLogs = this.tempLogs.get(taskId)
      if (cachedLogs) {
        for (const log of cachedLogs) {
          databaseManager.addTaskLog(taskId, {
            timestamp: log.timestamp,
            level: log.level,
            message: log.message,
            details: log.details,
          })
        }
        task.logs = cachedLogs
        this.tempLogs.delete(taskId)
      }

      this.addTaskLog(
        taskId,
        'success',
        '翻译任务创建成功',
        `源语言: ${options.sourceLanguage}, 目标语言: ${options.targetLanguage}`
      )

      this.notifyTaskUpdate(task)
      this.enqueueRun(taskId)

      return taskId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addTaskLog(taskId, 'error', '创建任务失败', message)
      this.activeTasks.delete(taskId)
      databaseManager.deleteTranslationTask(taskId)
      throw error
    }
  }

  private enqueueRun(taskId: string): void {
    this.runQueue.push(() => this.processTask(taskId))
    void this.drainQueue()
  }

  private async drainQueue(): Promise<void> {
    if (this.queueRunning) return
    this.queueRunning = true
    try {
      while (this.runQueue.length > 0) {
        const job = this.runQueue.shift()
        if (job) await job()
      }
    } finally {
      this.queueRunning = false
    }
  }

  private async processTask(taskId: string): Promise<void> {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (!task) {
      console.error(`任务 ${taskId} 不存在`)
      return
    }

    // 排队期间已被暂停/删除则不再启动
    if (
      task.status === TaskStatus.PAUSED ||
      task.status === TaskStatus.CANCELLED
    ) {
      return
    }

    this.activeTasks.set(taskId, task)
    const options = this.resolveOptions(task)
    // 确保 options 已落库（旧任务 resume 时也会补写）
    task.options = options
    databaseManager.saveTaskOptions(taskId, options)

    const controller = new AbortController()
    this.abortControllers.set(taskId, controller)

    try {
      const context = await runTranslationPipeline(
        task,
        options,
        {
          onLog: (level, message, details) =>
            this.addTaskLog(taskId, level, message, details),
          onStatus: (status, progress, errorMessage) =>
            this.updateTaskStatus(taskId, status, progress, errorMessage),
          onArtifacts: artifacts => {
            const taskRef = this.activeTasks.get(taskId)
            if (taskRef) {
              taskRef.outputArtifacts = artifacts
            }
            databaseManager.saveTaskArtifacts(taskId, artifacts)
          },
          onSegments: segments => {
            const taskRef = this.activeTasks.get(taskId)
            if (taskRef) taskRef.segments = segments
          },
          resolveByokApiKey: () => getByokApiKey() ?? undefined,
        },
        controller.signal
      )

      await this.finalizeTask(taskId, context.subtitles, context.outputArtifacts)
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        const current = this.activeTasks.get(taskId)
        // pause 会预先设 PAUSED；delete 会移除；其余视为取消
        if (current?.status === TaskStatus.PAUSED) {
          this.addTaskLog(taskId, 'warn', '任务已暂停')
        } else if (this.activeTasks.has(taskId)) {
          await this.updateTaskStatus(taskId, TaskStatus.CANCELLED, undefined)
          this.addTaskLog(taskId, 'warn', '任务已取消')
        }
      } else {
        await this.failTask(taskId, error)
      }
    } finally {
      this.abortControllers.delete(taskId)
    }
  }

  private async finalizeTask(
    taskId: string,
    subtitles?: TranslationTask['subtitles'],
    artifacts?: TaskOutputArtifacts
  ): Promise<void> {
    const task = this.activeTasks.get(taskId)
    if (task && subtitles) {
      task.subtitles = subtitles
    }
    if (task && artifacts) {
      task.outputArtifacts = artifacts
      databaseManager.saveTaskArtifacts(taskId, artifacts)
    }

    this.addTaskLog(taskId, 'success', '任务处理完成')
    await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100)
  }

  private async failTask(taskId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.addTaskLog(taskId, 'error', '任务处理失败', message)
    await this.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, message)
    console.error(`任务 ${taskId} 处理失败:`, error)
  }

  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    errorMessage?: string
  ): Promise<void> {
    databaseManager.updateTaskStatus(taskId, status, progress, errorMessage)

    const task = this.activeTasks.get(taskId)
    if (task) {
      task.status = status
      if (progress !== undefined) task.progress = progress
      if (errorMessage !== undefined) task.errorMessage = errorMessage
      task.updatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss')

      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        task.completedAt = dayjs().format('YYYY-MM-DD HH:mm:ss')
        // 完成后仍可从 DB 读取；内存 map 保留 completed 任务给 notify 一次
      }

      this.notifyTaskUpdate(task)

      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        this.activeTasks.delete(taskId)
      }
    }
  }

  private notifyTaskUpdate(task: TranslationTask): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 产物以内存 / DB 一等字段为准，不再解析日志
      const fromDb = databaseManager.getTranslationTask(task.id)
      const payload: TranslationTask = {
        ...task,
        options: task.options ?? fromDb?.options,
        outputArtifacts: task.outputArtifacts ?? fromDb?.outputArtifacts,
      }
      this.mainWindow.webContents.send(IpcChannels.taskUpdated, payload)
    }
  }

  private loadActiveTasks(): void {
    const tasks = databaseManager.getAllTranslationTasks()
    for (const task of tasks) {
      // 仅恢复未完成任务到内存
      if (
        task.status !== TaskStatus.COMPLETED &&
        task.status !== TaskStatus.FAILED &&
        task.status !== TaskStatus.CANCELLED
      ) {
        this.activeTasks.set(task.id, task)
      }
    }
  }

  getAllTasks(): TranslationTask[] {
    return databaseManager.getAllTranslationTasks()
  }

  getTask(taskId: string): TranslationTask | null {
    return (
      this.activeTasks.get(taskId) ??
      databaseManager.getTranslationTask(taskId)
    )
  }

  pauseTask(taskId: string): void {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (!task) return

    task.status = TaskStatus.PAUSED
    this.activeTasks.set(taskId, task)
    databaseManager.updateTaskStatus(taskId, TaskStatus.PAUSED)
    this.addTaskLog(taskId, 'info', '正在暂停任务…')
    this.notifyTaskUpdate(task)

    const controller = this.abortControllers.get(taskId)
    controller?.abort(createAbortError('任务已暂停'))
  }

  resumeTask(taskId: string): void {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (!task) return
    if (
      task.status !== TaskStatus.PAUSED &&
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED
    ) {
      return
    }

    task.status = TaskStatus.PENDING
    task.progress = 0
    task.errorMessage = undefined
    this.activeTasks.set(taskId, task)
    databaseManager.updateTaskStatus(taskId, TaskStatus.PENDING, 0, '')
    this.addTaskLog(taskId, 'info', '恢复任务（将重新执行流水线）')
    this.notifyTaskUpdate(task)
    this.enqueueRun(taskId)
  }

  deleteTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId)
    controller?.abort(createAbortError('任务已删除'))
    this.abortControllers.delete(taskId)
    this.activeTasks.delete(taskId)
    this.tempLogs.delete(taskId)
    databaseManager.deleteTranslationTask(taskId)
    void tempWorkspace.removeTaskDir(taskId)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(IpcChannels.taskDeleted, taskId)
    }
  }

  retryTask(taskId: string): void {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (!task) return

    task.status = TaskStatus.PENDING
    task.progress = 0
    task.errorMessage = undefined
    task.segments = []
    task.subtitles = []
    this.activeTasks.set(taskId, task)
    databaseManager.updateTaskStatus(taskId, TaskStatus.PENDING, 0, '')
    this.addTaskLog(taskId, 'info', '重试任务')
    this.notifyTaskUpdate(task)
    this.enqueueRun(taskId)
  }

  getTaskLogs(taskId: string): TaskLog[] {
    return databaseManager.getTaskLogs(taskId)
  }

  getStatistics() {
    return databaseManager.getStatistics()
  }

  private getActiveProcessingTaskIds(): string[] {
    return [...this.activeTasks.entries()]
      .filter(
        ([, task]) =>
          task.status !== TaskStatus.COMPLETED &&
          task.status !== TaskStatus.FAILED &&
          task.status !== TaskStatus.PAUSED &&
          task.status !== TaskStatus.CANCELLED
      )
      .map(([id]) => id)
  }

  async getTempCacheStats() {
    return tempWorkspace.getStats()
  }

  async clearTempCache() {
    const keep = this.getActiveProcessingTaskIds()
    return tempWorkspace.clearCache(keep)
  }

  /**
   * 任务已完成后，按指定字幕模式补烧硬字幕。
   */
  async burnSubtitlesForTask(
    taskId: string,
    mode: SubtitleBurnMode,
    colors?: SubtitleColors | null
  ): Promise<{ success: boolean; burnedVideo?: string; error?: string }> {
    const existing = this.activeTasks.get(taskId)
    if (existing?.status === TaskStatus.BURNING_SUBTITLES) {
      return { success: false, error: '该任务正在烧录中' }
    }

    const task =
      existing ?? databaseManager.getTranslationTask(taskId)
    if (!task) {
      return { success: false, error: '任务不存在' }
    }

    if (
      task.status !== TaskStatus.COMPLETED &&
      task.status !== TaskStatus.BURNING_SUBTITLES
    ) {
      return { success: false, error: '仅已完成的任务可以补烧硬字幕' }
    }

    if (!task.segments || task.segments.length === 0) {
      return { success: false, error: '任务没有可用的字幕段落' }
    }

    try {
      await fs.access(task.videoFile.path)
    } catch {
      return { success: false, error: '源视频文件不存在，无法烧录' }
    }

    this.activeTasks.set(taskId, task)
    let workDir: string | undefined
    const options = this.resolveOptions(task)
    const controller = new AbortController()
    this.abortControllers.set(taskId, controller)

    const hooks = {
      onLog: (
        level: TaskLog['level'],
        message: string,
        details?: string
      ) => this.addTaskLog(taskId, level, message, details),
      onStatus: (status: TaskStatus, progress?: number, errorMessage?: string) =>
        this.updateTaskStatus(taskId, status, progress, errorMessage),
      onArtifacts: (artifacts: TaskOutputArtifacts) => {
        task.outputArtifacts = artifacts
        databaseManager.saveTaskArtifacts(taskId, artifacts)
      },
      onSegments: (_segments: TranscriptionSegment[]) => {},
      resolveByokApiKey: () => getByokApiKey() ?? undefined,
    }

    try {
      await this.updateTaskStatus(taskId, TaskStatus.BURNING_SUBTITLES, 5)
      this.addTaskLog(taskId, 'info', '开始补烧硬字幕', `模式: ${mode}`)

      workDir = await tempWorkspace.ensureTaskDir(taskId)

      if (!(await ffmpegProcessor.isAvailable())) {
        throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
      }

      const videoInfo = await ffmpegProcessor.getVideoInfo(task.videoFile.path)
      const videoSize = {
        width: videoInfo.width,
        height: videoInfo.height,
      }

      const burnSubtitlePath = await prepareBurnSubtitleFile(
        taskId,
        task.segments,
        mode,
        videoSize,
        workDir,
        colors ?? resolveSubtitleColors(options),
        hooks
      )

      await this.updateTaskStatus(taskId, TaskStatus.BURNING_SUBTITLES, 15)

      const burnedVideo = await burnHardSubtitlesStage(
        task,
        burnSubtitlePath,
        workDir,
        hooks,
        controller.signal,
        {
          progressStatus: TaskStatus.BURNING_SUBTITLES,
          progressBase: 15,
          progressSpan: 80,
        }
      )

      const artifacts = databaseManager.mergeTaskArtifacts(taskId, {
        burnedVideo,
        outputDirectory:
          task.outputArtifacts?.outputDirectory ||
          path.join(path.dirname(task.videoFile.path), 'output'),
      })
      task.outputArtifacts = artifacts

      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100, '')
      this.addTaskLog(taskId, 'success', '补烧硬字幕完成', `模式: ${mode}`)

      const updated = this.getTask(taskId)
      if (updated) this.notifyTaskUpdate(updated)

      return { success: true, burnedVideo }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addTaskLog(taskId, 'error', '补烧硬字幕失败', message)
      try {
        await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100)
      } catch {
        // ignore
      }
      const updated = this.getTask(taskId)
      if (updated) this.notifyTaskUpdate(updated)
      return { success: false, error: message }
    } finally {
      this.abortControllers.delete(taskId)
      if (workDir) {
        await tempWorkspace.removeTaskDir(taskId)
      }
      this.activeTasks.delete(taskId)
    }
  }

  cleanup(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort(createAbortError('应用退出'))
    }
    this.abortControllers.clear()
    this.activeTasks.clear()
  }
}

export const taskManager = new TaskManager()
