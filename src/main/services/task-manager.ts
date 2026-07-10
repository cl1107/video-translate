import dayjs from "dayjs";
import type { BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import {
  TaskStatus,
  type SubtitleEntry,
  type TaskLog,
  type TranscriptionSegment,
  type TranslationTask,
  type VideoFile,
} from "../../shared/types/video";
import {
  DEFAULT_ASR_ENGINE,
  DEFAULT_OLLAMA_MODEL,
  type AsrEngineId,
} from "../../shared/constants";
import { databaseManager } from "./database/manager";
import { ffmpegProcessor } from "./ffmpeg/processor";
import { ollamaClient } from "./ollama/client";
import { SubtitleGenerator } from "../utils/subtitle-generator";
import { ensureSenseVoiceModel } from "./asr/model-downloader";
import {
  sherpaTranscriber,
  type AsrTranscriptionResult,
} from "./asr/sherpa-transcriber";

export interface CreateTaskOptions {
  filePath: string;
  sourceLanguage: string;
  targetLanguage: string;
  ollamaModel?: string;
  asrEngine?: AsrEngineId;
  /** @deprecated 兼容旧字段 */
  whisperModel?: string;
  burnSubtitles?: boolean;
}

interface ProcessTaskOptions {
  ollamaModel?: string;
  asrEngine?: AsrEngineId;
  whisperModel?: string;
  burnSubtitles?: boolean;
}

interface TaskProcessingContext {
  task: TranslationTask;
  audioPath?: string;
  transcription?: AsrTranscriptionResult;
  translatedSegments?: TranscriptionSegment[];
  subtitles?: SubtitleEntry[];
  outputPaths?: {
    original: string;
    translated: string;
    burnedVideo?: string;
  };
}

export class TaskManager {
  private activeTasks = new Map<string, TranslationTask>();
  private mainWindow: BrowserWindow | null = null;
  private tempLogs = new Map<string, TaskLog[]>();
  private runtimeOptions = new Map<string, ProcessTaskOptions>();

  constructor() {
    this.loadActiveTasks();
    void this.initializeServices();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private async initializeServices(): Promise<void> {
    try {
      if (!(await ollamaClient.isRunning())) {
        await ollamaClient.startDaemon();
      }

      // 后台确保默认 ASR 模型（已存在则秒过，缺失则自动下载）
      const asrReady = await ensureSenseVoiceModel((p) => {
        if (p.stage === "downloading" || p.stage === "extracting") {
          console.log(`[ASR] ${p.message}`);
        }
      });
      if (!asrReady.available) {
        console.warn("SenseVoice 自动准备失败:", asrReady.error);
      }
    } catch (error) {
      console.error("服务初始化失败:", error);
    }
  }

  private addTaskLog(
    taskId: string,
    level: TaskLog["level"],
    message: string,
    details?: string
  ): void {
    const baseLog = {
      timestamp: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      level,
      message,
      details,
    };
    const log: TaskLog = { id: uuidv4(), ...baseLog };

    try {
      databaseManager.addTaskLog(taskId, baseLog);
    } catch (error: any) {
      if (error?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        const cached = this.tempLogs.get(taskId) ?? [];
        cached.push(log);
        this.tempLogs.set(taskId, cached);
      } else {
        console.error("保存日志失败:", error);
      }
    }

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.logs = task.logs ?? [];
      task.logs.push(log);
      this.notifyTaskUpdate(task);
    }
  }

  async createTask(options: CreateTaskOptions): Promise<string> {
    const taskId = uuidv4();
    try {
      this.addTaskLog(taskId, "info", "开始创建翻译任务", `文件路径: ${options.filePath}`);

      const stats = await fs.stat(options.filePath);
      if (!stats.isFile()) {
        throw new Error("文件不存在");
      }

      const videoInfo = await ffmpegProcessor.getVideoInfo(options.filePath);
      const videoFile: VideoFile = {
        id: uuidv4(),
        name: path.basename(options.filePath),
        path: options.filePath,
        size: stats.size,
        duration: videoInfo.duration,
        format: videoInfo.format,
        createdAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      };

      databaseManager.saveVideoFile(videoFile);

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
        createdAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        updatedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      };

      databaseManager.createTranslationTask(task);
      this.activeTasks.set(taskId, task);
      this.runtimeOptions.set(taskId, {
        ollamaModel: options.ollamaModel,
        asrEngine: options.asrEngine,
        whisperModel: options.whisperModel,
        burnSubtitles: options.burnSubtitles,
      });

      const cachedLogs = this.tempLogs.get(taskId);
      if (cachedLogs) {
        for (const log of cachedLogs) {
          databaseManager.addTaskLog(taskId, {
            timestamp: log.timestamp,
            level: log.level,
            message: log.message,
            details: log.details,
          });
        }
        task.logs = cachedLogs;
        this.tempLogs.delete(taskId);
      }

      this.addTaskLog(
        taskId,
        "success",
        "翻译任务创建成功",
        `源语言: ${options.sourceLanguage}, 目标语言: ${options.targetLanguage}`
      );

      this.notifyTaskUpdate(task);
      void this.processTask(taskId, options);

      return taskId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addTaskLog(taskId, "error", "创建任务失败", message);
      this.activeTasks.delete(taskId);
      this.runtimeOptions.delete(taskId);
      databaseManager.deleteTranslationTask(taskId);
      throw error;
    }
  }

  private async processTask(
    taskId: string,
    overrides?: ProcessTaskOptions
  ): Promise<void> {
    const task = this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId);
    if (!task) {
      console.error(`任务 ${taskId} 不存在`);
      return;
    }

    this.activeTasks.set(taskId, task);

    const runtime = {
      ...this.runtimeOptions.get(taskId),
      ...overrides,
    };

    const context: TaskProcessingContext = { task };

    try {
      await this.ensureDependencies(taskId);

      context.audioPath = await this.extractAudio(taskId, task.videoFile.path);

      const asrEngine =
        runtime.asrEngine ??
        (runtime.whisperModel as AsrEngineId | undefined) ??
        DEFAULT_ASR_ENGINE;

      context.transcription = await this.runTranscription(
        taskId,
        context.audioPath,
        asrEngine,
        task.sourceLanguage
      );

      context.translatedSegments = await this.runTranslation(
        taskId,
        context.transcription.segments,
        task.sourceLanguage,
        task.targetLanguage,
        runtime.ollamaModel ?? DEFAULT_OLLAMA_MODEL
      );

      context.subtitles = SubtitleGenerator.segmentsToSubtitles(
        context.translatedSegments
      );

      context.outputPaths = await this.generateSubtitleOutputs(
        taskId,
        task,
        context.transcription.segments,
        context.translatedSegments
      );

      if (runtime.burnSubtitles) {
        context.outputPaths.burnedVideo = await this.burnHardSubtitles(
          taskId,
          task.videoFile.path,
          context.outputPaths.translated
        );
      }

      await this.finalizeTask(taskId, context);
    } catch (error) {
      await this.failTask(taskId, error);
    } finally {
      if (context.audioPath) {
        await fs.unlink(context.audioPath).catch(() => {});
      }
    }
  }

  private async ensureDependencies(taskId: string): Promise<void> {
    this.addTaskLog(taskId, "info", "检查 FFmpeg 可用性...");
    if (!(await ffmpegProcessor.isAvailable())) {
      throw new Error("FFmpeg 不可用，请先安装 FFmpeg");
    }
    this.addTaskLog(taskId, "success", "FFmpeg 可用性检查通过");

    this.addTaskLog(taskId, "info", "检查 sherpa-onnx ASR 可用性...");
    let asrOk =
      (await sherpaTranscriber.isAvailable("sensevoice")) ||
      (await sherpaTranscriber.isAvailable("funasr-nano"));
    if (!asrOk) {
      this.addTaskLog(taskId, "info", "SenseVoice 模型缺失，开始自动下载...");
      const ensured = await ensureSenseVoiceModel((p) => {
        if (p.message) {
          this.addTaskLog(taskId, "info", p.message);
        }
      });
      asrOk = ensured.available;
      if (!asrOk) {
        throw new Error(
          `ASR 模型不可用：${ensured.error || "自动下载失败，请检查网络后重试"}`
        );
      }
    }
    this.addTaskLog(taskId, "success", "ASR 可用性检查通过");

    this.addTaskLog(taskId, "info", "检查 Ollama 服务状态...");
    if (!(await ollamaClient.isAvailable())) {
      throw new Error("Ollama 服务不可用，请先启动 Ollama");
    }
    this.addTaskLog(taskId, "success", "Ollama 可用性检查通过");
  }

  private async extractAudio(taskId: string, videoPath: string): Promise<string> {
    await this.updateTaskStatus(taskId, TaskStatus.EXTRACTING_AUDIO, 10);
    this.addTaskLog(taskId, "info", "开始提取音频...", `视频: ${videoPath}`);

    const audioPath = await ffmpegProcessor.extractAudio(videoPath, undefined, (progress) => {
      const normalized = 10 + (progress / 100) * 20;
      void this.updateTaskStatus(taskId, TaskStatus.EXTRACTING_AUDIO, normalized);
    });

    this.addTaskLog(taskId, "success", "音频提取完成", `音频文件: ${audioPath}`);
    return audioPath;
  }

  private async runTranscription(
    taskId: string,
    audioPath: string,
    asrEngine: AsrEngineId,
    sourceLanguage: string
  ): Promise<AsrTranscriptionResult> {
    await this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, 35);
    this.addTaskLog(
      taskId,
      "info",
      "开始进行语音识别",
      `ASR 引擎: ${asrEngine}, 源语言: ${sourceLanguage}`
    );

    const transcription = await sherpaTranscriber.transcribe(
      audioPath,
      {
        engine: asrEngine,
        language: this.getLanguageCode(sourceLanguage),
      },
      (progress) => {
        const normalized = 35 + (progress / 100) * 25;
        void this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, normalized);
      }
    );

    if (transcription.segments.length === 0) {
      throw new Error("语音识别未产生任何结果");
    }

    databaseManager.saveTranscriptionSegments(taskId, transcription.segments);

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.segments = transcription.segments;
    }

    this.addTaskLog(
      taskId,
      "success",
      "语音识别完成",
      `引擎 ${transcription.engine}，生成 ${transcription.segments.length} 个字幕段落`
    );

    return transcription;
  }

  private async runTranslation(
    taskId: string,
    segments: TranscriptionSegment[],
    sourceLanguage: string,
    targetLanguage: string,
    ollamaModel: string
  ): Promise<TranscriptionSegment[]> {
    await this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, 65);
    this.addTaskLog(
      taskId,
      "info",
      "开始翻译字幕",
      `Ollama 模型: ${ollamaModel}, 目标语言: ${targetLanguage}`
    );

    const texts = segments.map((segment) => segment.originalText);
    const translated = await ollamaClient.translateBatch(
      texts,
      sourceLanguage,
      targetLanguage,
      ollamaModel,
      (completed, total) => {
        const normalized = 65 + (completed / total) * 20;
        void this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, normalized);
      }
    );

    const merged = segments.map((segment, index) => ({
      ...segment,
      translatedText: translated[index] ?? segment.originalText,
    }));

    databaseManager.updateTranslatedSegments(taskId, merged);

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.segments = merged;
    }

    this.addTaskLog(
      taskId,
      "success",
      "字幕翻译完成",
      `翻译 ${merged.length} 个段落`
    );

    return merged;
  }

  private async generateSubtitleOutputs(
    taskId: string,
    task: TranslationTask,
    originalSegments: TranscriptionSegment[],
    translatedSegments: TranscriptionSegment[]
  ): Promise<{ original: string; translated: string }> {
    await this.updateTaskStatus(taskId, TaskStatus.GENERATING_SUBTITLES, 90);
    this.addTaskLog(taskId, "info", "开始生成字幕文件...");

    const outputDir = path.join(path.dirname(task.videoFile.path), "output");
    await fs.mkdir(outputDir, { recursive: true });

    const baseName = path.basename(task.videoFile.path, path.extname(task.videoFile.path));
    const timestamp = dayjs().format("YYYYMMDD_HHmmss");

    const originalPath = path.join(
      outputDir,
      `${baseName}_${timestamp}_${this.getLanguageSuffix(task.sourceLanguage)}.srt`
    );
    const translatedPath = path.join(
      outputDir,
      `${baseName}_${timestamp}_${this.getLanguageSuffix(task.targetLanguage)}.srt`
    );

    const originalSubtitles = SubtitleGenerator.segmentsToSubtitles(
      originalSegments.map((segment) => ({ ...segment, translatedText: undefined }))
    );
    const translatedSubtitles = SubtitleGenerator.segmentsToSubtitles(translatedSegments);

    await SubtitleGenerator.saveSubtitle(originalSubtitles, originalPath, "srt");
    await SubtitleGenerator.saveSubtitle(translatedSubtitles, translatedPath, "srt");

    this.addTaskLog(taskId, "success", "字幕文件生成完成", `原文: ${originalPath}\n翻译: ${translatedPath}`);

    const taskRef = this.activeTasks.get(task.id);
    if (taskRef) {
      taskRef.subtitles = translatedSubtitles;
    }

    return {
      original: originalPath,
      translated: translatedPath,
    };
  }

  private async burnHardSubtitles(
    taskId: string,
    videoPath: string,
    subtitlePath: string
  ): Promise<string> {
    const outputDir = path.join(path.dirname(videoPath), "output");
    await fs.mkdir(outputDir, { recursive: true });

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = dayjs().format("YYYYMMDD_HHmmss");
    const outputVideo = path.join(outputDir, `${baseName}_${timestamp}_burned.mp4`);

    this.addTaskLog(taskId, "info", "开始烧录硬字幕", `输出: ${outputVideo}`);

    const result = await ffmpegProcessor.burnSubtitles(videoPath, subtitlePath, outputVideo, (progress) => {
      const normalized = 90 + (progress / 100) * 9;
      void this.updateTaskStatus(taskId, TaskStatus.GENERATING_SUBTITLES, normalized);
    });

    this.addTaskLog(taskId, "success", "烧录硬字幕完成", `输出视频: ${result}`);

    return result;
  }

  private async finalizeTask(taskId: string, context: TaskProcessingContext): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (task && context.subtitles) {
      task.subtitles = context.subtitles;
    }

    await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100);
    this.addTaskLog(taskId, "success", "任务处理完成");
    this.runtimeOptions.delete(taskId);
  }

  private async failTask(taskId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.addTaskLog(taskId, "error", "任务处理失败", message);
    await this.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, message);
    console.error(`任务 ${taskId} 处理失败:`, error);
  }

  private getLanguageCode(language: string): string {
    const languageMap: Record<string, string> = {
      English: "en",
      Chinese: "zh",
      中文: "zh",
      Japanese: "ja",
      日本語: "ja",
      Korean: "ko",
      한국어: "ko",
      Cantonese: "yue",
      粤语: "yue",
      Spanish: "es",
      French: "fr",
      German: "de",
      Italian: "it",
      Portuguese: "pt",
      Russian: "ru",
      Arabic: "ar",
      Hindi: "hi",
      Thai: "th",
      Vietnamese: "vi",
    };

    return languageMap[language] || language || "auto";
  }

  private getLanguageSuffix(language: string): string {
    const code = this.getLanguageCode(language);
    return code === "auto" ? "auto" : code;
  }

  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    errorMessage?: string
  ): Promise<void> {
    databaseManager.updateTaskStatus(taskId, status, progress, errorMessage);

    const task = this.activeTasks.get(taskId);
    if (task) {
      task.status = status;
      if (progress !== undefined) task.progress = progress;
      if (errorMessage !== undefined) task.errorMessage = errorMessage;
      task.updatedAt = dayjs().format("YYYY-MM-DD HH:mm:ss");

      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        task.completedAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
        this.activeTasks.delete(taskId);
      }

      this.notifyTaskUpdate(task);
    }
  }

  private notifyTaskUpdate(task: TranslationTask): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("task-updated", task);
    }
  }

  private loadActiveTasks(): void {
    const tasks = databaseManager.getAllTranslationTasks();
    for (const task of tasks) {
      this.activeTasks.set(task.id, task);
    }
  }

  getAllTasks(): TranslationTask[] {
    return databaseManager.getAllTranslationTasks();
  }

  getTask(taskId: string): TranslationTask | null {
    return databaseManager.getTranslationTask(taskId);
  }

  pauseTask(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (
      task &&
      task.status !== TaskStatus.COMPLETED &&
      task.status !== TaskStatus.FAILED
    ) {
      void this.updateTaskStatus(taskId, TaskStatus.PAUSED);
    }
  }

  resumeTask(taskId: string): void {
    const task = this.activeTasks.get(taskId) ?? databaseManager.getTranslationTask(taskId);
    if (task && task.status === TaskStatus.PAUSED) {
      this.activeTasks.set(taskId, task);
      void this.processTask(taskId);
    }
  }

  deleteTask(taskId: string): void {
    this.activeTasks.delete(taskId);
    databaseManager.deleteTranslationTask(taskId);
    this.runtimeOptions.delete(taskId);

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("task-deleted", taskId);
    }
  }

  retryTask(taskId: string): void {
    const task = databaseManager.getTranslationTask(taskId);
    if (task && task.status === TaskStatus.FAILED) {
      void this.updateTaskStatus(taskId, TaskStatus.PENDING, 0);
      this.activeTasks.set(taskId, task);
      void this.processTask(taskId);
    }
  }

  getTaskLogs(taskId: string) {
    return databaseManager.getTaskLogs(taskId);
  }

  getStatistics() {
    return databaseManager.getStatistics();
  }

  cleanup(): void {
    this.activeTasks.clear();
    this.runtimeOptions.clear();
    void ffmpegProcessor.cleanup();
    sherpaTranscriber.cleanup();
    ollamaClient.stopDaemon();
  }
}

export const taskManager = new TaskManager();
