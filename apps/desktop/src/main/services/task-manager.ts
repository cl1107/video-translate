import { promises as fs } from 'node:fs'
import path from 'node:path'
import dayjs from 'dayjs'
import type { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import {
  type AsrEngineId,
  DEFAULT_ASR_ENGINE,
  DEFAULT_OLLAMA_MODEL,
} from '../../shared/constants'
import {
  normalizeOllamaModel,
  type SubtitleBurnMode,
} from '../../shared/settings'
import {
  type SubtitleEntry,
  type TaskLog,
  TaskStatus,
  type TranscriptionSegment,
  type TranslationTask,
  type VideoFile,
} from '../../shared/types/video'
import {
  type DisplaySegment,
  buildDisplaySegments,
} from '../utils/display-segment-builder'
import {
  selectBurnSubtitleContent,
  validateSubtitleArtifacts,
  writeSubtitleArtifacts,
} from '../utils/subtitle-artifacts'
import { SubtitleGenerator } from '../utils/subtitle-generator'
import { ensureSenseVoiceModel } from './asr/model-downloader'
import {
  type AsrTranscriptionResult,
  sherpaTranscriber,
} from './asr/sherpa-transcriber'
import { databaseManager } from './database/manager'
import { ffmpegProcessor } from './ffmpeg/processor'
import { ollamaClient, supportsTranscriptPolish } from './ollama/client'
import { tempWorkspace } from './temp-workspace'

export interface CreateTaskOptions {
  filePath: string
  sourceLanguage: string
  targetLanguage: string
  ollamaModel?: string
  asrEngine?: AsrEngineId
  burnSubtitles?: boolean
  burnSubtitleMode?: SubtitleBurnMode
  polishTranscript?: boolean
}

interface ProcessTaskOptions {
  ollamaModel?: string
  asrEngine?: AsrEngineId
  burnSubtitles?: boolean
  burnSubtitleMode?: SubtitleBurnMode
  polishTranscript?: boolean
}

interface TaskProcessingContext {
  task: TranslationTask
  workDir?: string
  audioPath?: string
  transcription?: AsrTranscriptionResult
  displaySegments?: DisplaySegment[]
  translatedSegments?: DisplaySegment[]
  subtitles?: SubtitleEntry[]
  videoSize?: { width: number; height: number }
  outputPaths?: {
    original: string
    translated: string
    bilingual: string
    bilingualAss: string
    burnedVideo?: string
    outputDirectory: string
  }
}

export class TaskManager {
  private activeTasks = new Map<string, TranslationTask>()
  private mainWindow: BrowserWindow | null = null
  private tempLogs = new Map<string, TaskLog[]>()
  private runtimeOptions = new Map<string, ProcessTaskOptions>()

  constructor() {
    this.loadActiveTasks()
    void this.initializeServices()
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private async initializeServices(): Promise<void> {
    try {
      // 启动时清理超过 24 小时的残留临时文件（保留进行中任务目录）
      const activeIds = [...this.activeTasks.keys()].filter(id => {
        const status = this.activeTasks.get(id)?.status
        return (
          status &&
          status !== TaskStatus.COMPLETED &&
          status !== TaskStatus.FAILED
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

      // 后台确保默认 ASR 模型（已存在则秒过，缺失则自动下载）
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
    } catch (error: any) {
      if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
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

  async createTask(options: CreateTaskOptions): Promise<string> {
    const taskId = uuidv4()
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
        segments: [],
        subtitles: [],
        logs: [],
        createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        updatedAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      }

      databaseManager.createTranslationTask(task)
      this.activeTasks.set(taskId, task)
      this.runtimeOptions.set(taskId, {
        ollamaModel: options.ollamaModel,
        asrEngine: options.asrEngine,
        burnSubtitles: options.burnSubtitles,
        burnSubtitleMode: options.burnSubtitleMode ?? 'bilingual',
        polishTranscript: options.polishTranscript ?? true,
      })

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
      void this.processTask(taskId, options)

      return taskId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addTaskLog(taskId, 'error', '创建任务失败', message)
      this.activeTasks.delete(taskId)
      this.runtimeOptions.delete(taskId)
      databaseManager.deleteTranslationTask(taskId)
      throw error
    }
  }

  private async processTask(
    taskId: string,
    overrides?: ProcessTaskOptions
  ): Promise<void> {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (!task) {
      console.error(`任务 ${taskId} 不存在`)
      return
    }

    this.activeTasks.set(taskId, task)

    const runtime = {
      ...this.runtimeOptions.get(taskId),
      ...overrides,
    }

    const context: TaskProcessingContext = { task }

    try {
      // 每次处理使用独立任务目录；先清空残留再创建
      await tempWorkspace.removeTaskDir(taskId)
      context.workDir = await tempWorkspace.ensureTaskDir(taskId)

      await this.ensureDependencies(taskId)

      const videoInfo = await ffmpegProcessor.getVideoInfo(task.videoFile.path)
      context.videoSize = {
        width: videoInfo.width,
        height: videoInfo.height,
      }

      context.audioPath = await this.extractAudio(
        taskId,
        task.videoFile.path,
        context.workDir
      )

      const asrEngine = runtime.asrEngine ?? DEFAULT_ASR_ENGINE
      const ollamaModel = normalizeOllamaModel(
        runtime.ollamaModel ?? DEFAULT_OLLAMA_MODEL
      )

      context.transcription = await this.runTranscription(
        taskId,
        context.audioPath,
        asrEngine,
        task.sourceLanguage,
        context.workDir
      )

      // 识别段 → 显示段（合并过碎句），再润色、翻译
      context.displaySegments = buildDisplaySegments(
        context.transcription.segments,
        {
          maxDisplayColumns:
            context.videoSize.width < context.videoSize.height ? 42 : 68,
        }
      )
      this.addTaskLog(
        taskId,
        'info',
        '显示段整理完成',
        `识别 ${context.transcription.segments.length} 段 → 显示 ${context.displaySegments.length} 段`
      )

      const polishRequested = runtime.polishTranscript !== false
      const shouldPolish =
        polishRequested && supportsTranscriptPolish(ollamaModel)
      if (shouldPolish) {
        context.displaySegments = await this.runPolish(
          taskId,
          context.displaySegments,
          task.sourceLanguage,
          ollamaModel
        )
      } else {
        if (polishRequested) {
          this.addTaskLog(
            taskId,
            'warn',
            '已跳过识别文本润色',
            `模型 ${ollamaModel} 为翻译专用模型，无法保证润色后仍保持源语言`
          )
        }
        context.displaySegments = context.displaySegments.map(segment => ({
          ...segment,
          polishedText: segment.originalText,
        }))
      }

      context.translatedSegments = await this.runTranslation(
        taskId,
        context.displaySegments,
        task.sourceLanguage,
        task.targetLanguage,
        ollamaModel
      )

      context.subtitles = SubtitleGenerator.segmentsToSubtitles(
        context.translatedSegments.map(segment => ({
          ...segment,
          originalText: segment.polishedText || segment.originalText,
        }))
      )

      context.outputPaths = await this.generateSubtitleOutputs(
        taskId,
        task,
        context.translatedSegments,
        context.videoSize
      )

      if (runtime.burnSubtitles) {
        const burnMode = runtime.burnSubtitleMode ?? 'bilingual'
        const burnSubtitlePath = await this.prepareBurnSubtitleFile(
          taskId,
          context.translatedSegments,
          burnMode,
          context.videoSize,
          context.workDir
        )
        context.outputPaths.burnedVideo = await this.burnHardSubtitles(
          taskId,
          task.videoFile.path,
          burnSubtitlePath,
          context.workDir
        )
      }

      await this.finalizeTask(taskId, context)
    } catch (error) {
      await this.failTask(taskId, error)
    } finally {
      // 删除整个任务临时目录（音频、分段、烧录临时字幕等）
      await tempWorkspace.removeTaskDir(taskId)
    }
  }

  private async ensureDependencies(taskId: string): Promise<void> {
    this.addTaskLog(taskId, 'info', '检查 FFmpeg 可用性...')
    if (!(await ffmpegProcessor.isAvailable())) {
      throw new Error('FFmpeg 不可用，请先安装 FFmpeg')
    }
    this.addTaskLog(taskId, 'success', 'FFmpeg 可用性检查通过')

    this.addTaskLog(taskId, 'info', '检查 sherpa-onnx ASR 可用性...')
    let asrOk =
      (await sherpaTranscriber.isAvailable('sensevoice')) ||
      (await sherpaTranscriber.isAvailable('funasr-nano'))
    if (!asrOk) {
      this.addTaskLog(taskId, 'info', 'SenseVoice 模型缺失，开始自动下载...')
      const ensured = await ensureSenseVoiceModel(p => {
        if (p.message) {
          this.addTaskLog(taskId, 'info', p.message)
        }
      })
      asrOk = ensured.available
      if (!asrOk) {
        throw new Error(
          `ASR 模型不可用：${ensured.error || '自动下载失败，请检查网络后重试'}`
        )
      }
    }
    this.addTaskLog(taskId, 'success', 'ASR 可用性检查通过')

    this.addTaskLog(taskId, 'info', '检查 Ollama 服务状态...')
    if (!(await ollamaClient.isAvailable())) {
      throw new Error('Ollama 服务不可用，请先启动 Ollama')
    }
    this.addTaskLog(taskId, 'success', 'Ollama 可用性检查通过')
  }

  private async extractAudio(
    taskId: string,
    videoPath: string,
    workDir: string
  ): Promise<string> {
    await this.updateTaskStatus(taskId, TaskStatus.EXTRACTING_AUDIO, 10)
    this.addTaskLog(taskId, 'info', '开始提取音频...', `视频: ${videoPath}`)

    const outputPath = path.join(workDir, `audio_${Date.now()}.wav`)
    const audioPath = await ffmpegProcessor.extractAudio(
      videoPath,
      outputPath,
      progress => {
        const normalized = 10 + (progress / 100) * 20
        void this.updateTaskStatus(
          taskId,
          TaskStatus.EXTRACTING_AUDIO,
          normalized
        )
      },
      workDir
    )

    this.addTaskLog(taskId, 'success', '音频提取完成', `音频文件: ${audioPath}`)
    return audioPath
  }

  private async runTranscription(
    taskId: string,
    audioPath: string,
    asrEngine: AsrEngineId,
    sourceLanguage: string,
    workDir: string
  ): Promise<AsrTranscriptionResult> {
    await this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, 35)
    this.addTaskLog(
      taskId,
      'info',
      '开始进行语音识别',
      `ASR 引擎: ${asrEngine}, 源语言: ${sourceLanguage}`
    )

    const transcription = await sherpaTranscriber.transcribe(
      audioPath,
      {
        engine: asrEngine,
        language: this.getLanguageCode(sourceLanguage),
        workDir,
      },
      progress => {
        const normalized = 35 + (progress / 100) * 25
        void this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, normalized)
      }
    )

    if (transcription.segments.length === 0) {
      throw new Error('语音识别未产生任何结果')
    }

    databaseManager.saveTranscriptionSegments(taskId, transcription.segments)

    const task = this.activeTasks.get(taskId)
    if (task) {
      task.segments = transcription.segments
    }

    this.addTaskLog(
      taskId,
      'success',
      '语音识别完成',
      `引擎 ${transcription.engine}，生成 ${transcription.segments.length} 个字幕段落`
    )

    return transcription
  }

  private async runPolish(
    taskId: string,
    segments: DisplaySegment[],
    sourceLanguage: string,
    ollamaModel: string
  ): Promise<DisplaySegment[]> {
    await this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, 60)
    this.addTaskLog(
      taskId,
      'info',
      '开始润色识别文本',
      `Ollama 模型: ${ollamaModel}（纠错/补标点后再翻译）`
    )

    const texts = segments.map(segment => segment.originalText)
    const polished = await ollamaClient.polishTranscriptBatch(
      texts,
      sourceLanguage,
      ollamaModel,
      (completed, total) => {
        const normalized = 60 + (completed / total) * 5
        void this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, normalized)
      }
    )

    const merged = segments.map((segment, index) => ({
      ...segment,
      polishedText: polished[index] || segment.originalText,
    }))

    this.addTaskLog(
      taskId,
      'success',
      '识别文本润色完成',
      `润色 ${merged.length} 个显示段`
    )

    return merged
  }

  private async runTranslation(
    taskId: string,
    segments: DisplaySegment[],
    sourceLanguage: string,
    targetLanguage: string,
    ollamaModel: string
  ): Promise<DisplaySegment[]> {
    await this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, 65)
    this.addTaskLog(
      taskId,
      'info',
      '开始翻译字幕',
      `Ollama 模型: ${ollamaModel}, 目标语言: ${targetLanguage}`
    )

    // 翻译输入优先用润色文本
    const texts = segments.map(
      segment => segment.polishedText || segment.originalText
    )
    const translated = await ollamaClient.translateBatch(
      texts,
      sourceLanguage,
      targetLanguage,
      ollamaModel,
      (completed, total) => {
        const normalized = 65 + (completed / total) * 20
        void this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, normalized)
      }
    )

    const merged = segments.map((segment, index) => ({
      ...segment,
      translatedText:
        translated[index] ?? segment.polishedText ?? segment.originalText,
    }))

    // 显示段可能合并了多条识别段：整体替换为权威结果
    const taskSegments: TranscriptionSegment[] = merged.map(segment => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      originalText: segment.originalText,
      polishedText: segment.polishedText,
      translatedText: segment.translatedText,
      confidence: segment.confidence,
    }))
    databaseManager.replaceTranscriptionSegments(taskId, taskSegments)

    const task = this.activeTasks.get(taskId)
    if (task) {
      task.segments = taskSegments
    }

    this.addTaskLog(
      taskId,
      'success',
      '字幕翻译完成',
      `翻译 ${merged.length} 个段落`
    )

    return merged
  }

  private async generateSubtitleOutputs(
    taskId: string,
    task: TranslationTask,
    segments: DisplaySegment[],
    videoSize?: { width: number; height: number }
  ): Promise<NonNullable<TaskProcessingContext['outputPaths']>> {
    await this.updateTaskStatus(taskId, TaskStatus.GENERATING_SUBTITLES, 90)
    this.addTaskLog(
      taskId,
      'info',
      '开始生成字幕文件（原文/译文/双语 SRT + ASS）...'
    )

    const outputDir = path.join(path.dirname(task.videoFile.path), 'output')
    const baseName = path.basename(
      task.videoFile.path,
      path.extname(task.videoFile.path)
    )
    const timestamp = dayjs().format('YYYYMMDD_HHmmss')
    const artifactBase = `${baseName}_${timestamp}`

    const paths = await writeSubtitleArtifacts({
      segments,
      outputDir,
      baseName: artifactBase,
      sourceSuffix: this.getLanguageSuffix(task.sourceLanguage),
      targetSuffix: this.getLanguageSuffix(task.targetLanguage),
      videoSize,
    })

    const validation = await validateSubtitleArtifacts(paths, segments)
    if (!validation.ok) {
      throw new Error(`字幕产物校验失败: ${validation.errors.join('; ')}`)
    }

    this.addTaskLog(
      taskId,
      'success',
      '字幕文件生成完成',
      [
        `原文: ${paths.original}`,
        `翻译: ${paths.translated}`,
        `双语: ${paths.bilingual}`,
        `ASS: ${paths.bilingualAss}`,
      ].join('\n')
    )

    const taskRef = this.activeTasks.get(task.id)
    if (taskRef) {
      taskRef.subtitles = SubtitleGenerator.segmentsToSubtitles(
        segments.map(segment => ({
          ...segment,
          originalText: segment.polishedText || segment.originalText,
        }))
      )
    }

    return {
      original: paths.original,
      translated: paths.translated,
      bilingual: paths.bilingual,
      bilingualAss: paths.bilingualAss,
      outputDirectory: paths.outputDirectory,
    }
  }

  private async prepareBurnSubtitleFile(
    taskId: string,
    segments: DisplaySegment[],
    mode: SubtitleBurnMode,
    videoSize: { width: number; height: number } | undefined,
    workDir?: string
  ): Promise<string> {
    const dir = workDir || (await tempWorkspace.ensureTaskDir(taskId))
    const selected = selectBurnSubtitleContent(mode, segments, videoSize)
    const burnPath = path.join(dir, `burn_${mode}.${selected.extension}`)
    await fs.writeFile(burnPath, selected.content, 'utf-8')
    this.addTaskLog(
      taskId,
      'info',
      '已准备烧录字幕',
      `模式: ${mode}, 文件: ${burnPath}`
    )
    return burnPath
  }

  private async burnHardSubtitles(
    taskId: string,
    videoPath: string,
    subtitlePath: string,
    workDir?: string
  ): Promise<string> {
    const outputDir = path.join(path.dirname(videoPath), 'output')
    await fs.mkdir(outputDir, { recursive: true })

    const baseName = path.basename(videoPath, path.extname(videoPath))
    const timestamp = dayjs().format('YYYYMMDD_HHmmss')
    const outputVideo = path.join(
      outputDir,
      `${baseName}_${timestamp}_burned.mp4`
    )

    this.addTaskLog(taskId, 'info', '开始烧录硬字幕', `输出: ${outputVideo}`)

    const result = await ffmpegProcessor.burnSubtitles(
      videoPath,
      subtitlePath,
      outputVideo,
      progress => {
        const normalized = 90 + (progress / 100) * 9
        void this.updateTaskStatus(
          taskId,
          TaskStatus.GENERATING_SUBTITLES,
          normalized
        )
      },
      workDir
    )

    // 轻量产物检查：烧录结果必须存在且非空
    const stat = await fs.stat(result)
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error(`烧录视频产物无效: ${result}`)
    }

    this.addTaskLog(taskId, 'success', '烧录硬字幕完成', `输出视频: ${result}`)

    return result
  }

  private async finalizeTask(
    taskId: string,
    context: TaskProcessingContext
  ): Promise<void> {
    const task = this.activeTasks.get(taskId)
    if (task && context.subtitles) {
      task.subtitles = context.subtitles
    }
    if (task && context.outputPaths) {
      task.outputArtifacts = {
        originalSubtitle: context.outputPaths.original,
        translatedSubtitle: context.outputPaths.translated,
        bilingualSubtitle: context.outputPaths.bilingual,
        bilingualAss: context.outputPaths.bilingualAss,
        burnedVideo: context.outputPaths.burnedVideo,
        outputDirectory: context.outputPaths.outputDirectory,
      }
    }

    await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100)
    this.addTaskLog(taskId, 'success', '任务处理完成')
    this.runtimeOptions.delete(taskId)
  }

  private async failTask(taskId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.addTaskLog(taskId, 'error', '任务处理失败', message)
    await this.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, message)
    console.error(`任务 ${taskId} 处理失败:`, error)
  }

  private getLanguageCode(language: string): string {
    const languageMap: Record<string, string> = {
      English: 'en',
      Chinese: 'zh',
      中文: 'zh',
      Japanese: 'ja',
      日本語: 'ja',
      Korean: 'ko',
      한국어: 'ko',
      Cantonese: 'yue',
      粤语: 'yue',
      Spanish: 'es',
      French: 'fr',
      German: 'de',
      Italian: 'it',
      Portuguese: 'pt',
      Russian: 'ru',
      Arabic: 'ar',
      Hindi: 'hi',
      Thai: 'th',
      Vietnamese: 'vi',
    }

    return languageMap[language] || language || 'auto'
  }

  private getLanguageSuffix(language: string): string {
    const code = this.getLanguageCode(language)
    return code === 'auto' ? 'auto' : code
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

      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        task.completedAt = dayjs().format('YYYY-MM-DD HH:mm:ss')
        this.activeTasks.delete(taskId)
      }

      this.notifyTaskUpdate(task)
    }
  }

  private notifyTaskUpdate(task: TranslationTask): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('task-updated', task)
    }
  }

  private getTaskOutputArtifacts(task: TranslationTask) {
    const artifacts: NonNullable<TranslationTask['outputArtifacts']> = {
      outputDirectory: path.join(path.dirname(task.videoFile.path), 'output'),
    }

    for (const log of databaseManager.getTaskLogs(task.id)) {
      if (!log.details) continue

      if (log.message === '字幕文件生成完成') {
        for (const line of log.details.split('\n')) {
          if (line.startsWith('原文: ')) {
            artifacts.originalSubtitle = line.slice('原文: '.length)
          } else if (line.startsWith('翻译: ')) {
            artifacts.translatedSubtitle = line.slice('翻译: '.length)
          } else if (line.startsWith('双语: ')) {
            artifacts.bilingualSubtitle = line.slice('双语: '.length)
          } else if (line.startsWith('ASS: ')) {
            artifacts.bilingualAss = line.slice('ASS: '.length)
          }
        }
      }

      if (log.message === '烧录硬字幕完成') {
        const prefix = '输出视频: '
        if (log.details.startsWith(prefix)) {
          artifacts.burnedVideo = log.details.slice(prefix.length)
        }
      }
    }

    return artifacts
  }

  private loadActiveTasks(): void {
    const tasks = databaseManager.getAllTranslationTasks()
    for (const task of tasks) {
      this.activeTasks.set(task.id, task)
    }
  }

  getAllTasks(): TranslationTask[] {
    return databaseManager.getAllTranslationTasks().map(task => ({
      ...task,
      outputArtifacts: this.getTaskOutputArtifacts(task),
    }))
  }

  getTask(taskId: string): TranslationTask | null {
    const task = databaseManager.getTranslationTask(taskId)
    if (!task) return null
    return { ...task, outputArtifacts: this.getTaskOutputArtifacts(task) }
  }

  pauseTask(taskId: string): void {
    const task = this.activeTasks.get(taskId)
    if (
      task &&
      task.status !== TaskStatus.COMPLETED &&
      task.status !== TaskStatus.FAILED
    ) {
      void this.updateTaskStatus(taskId, TaskStatus.PAUSED)
    }
  }

  resumeTask(taskId: string): void {
    const task =
      this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId)
    if (task && task.status === TaskStatus.PAUSED) {
      this.activeTasks.set(taskId, task)
      void this.processTask(taskId)
    }
  }

  deleteTask(taskId: string): void {
    this.activeTasks.delete(taskId)
    databaseManager.deleteTranslationTask(taskId)
    this.runtimeOptions.delete(taskId)
    void tempWorkspace.removeTaskDir(taskId)

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('task-deleted', taskId)
    }
  }

  retryTask(taskId: string): void {
    const task = databaseManager.getTranslationTask(taskId)
    if (task && task.status === TaskStatus.FAILED) {
      void this.updateTaskStatus(taskId, TaskStatus.PENDING, 0)
      this.activeTasks.set(taskId, task)
      void this.processTask(taskId)
    }
  }

  getTaskLogs(taskId: string) {
    return databaseManager.getTaskLogs(taskId)
  }

  getStatistics() {
    return databaseManager.getStatistics()
  }

  private getActiveProcessingTaskIds(): string[] {
    return [...this.activeTasks.entries()]
      .filter(([, task]) => {
        return (
          task.status !== TaskStatus.COMPLETED &&
          task.status !== TaskStatus.FAILED &&
          task.status !== TaskStatus.PAUSED
        )
      })
      .map(([id]) => id)
  }

  async getTempCacheStats() {
    return tempWorkspace.getStats()
  }

  async clearTempCache() {
    return tempWorkspace.clearCache(this.getActiveProcessingTaskIds())
  }

  cleanup(): void {
    this.activeTasks.clear()
    this.runtimeOptions.clear()
    void tempWorkspace.clearCache()
    sherpaTranscriber.cleanup()
    ollamaClient.stopDaemon()
  }
}

export const taskManager = new TaskManager()
