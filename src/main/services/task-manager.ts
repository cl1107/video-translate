import { BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type {
  TaskLog,
  TranslationTask,
  VideoFile,
} from "../../shared/types/video";
import { TaskStatus } from "../../shared/types/video";
import { databaseManager } from "./database/manager";
import { ffmpegProcessor } from "./ffmpeg/processor";
import { ollamaClient } from "./ollama/client";
import { whisperTranscriber } from "./whisper/transcriber";

export interface CreateTaskOptions {
  filePath: string;
  sourceLanguage: string;
  targetLanguage: string;
  ollamaModel?: string;
  whisperModel?: string;
}

export class TaskManager {
  private activeTasks = new Map<string, TranslationTask>();
  private mainWindow: BrowserWindow | null = null;
  private tempLogs?: Map<string, TaskLog[]>;

  constructor() {
    // 从数据库加载未完成的任务
    this.loadActiveTasks();
    this.initializeServices();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private async initializeServices(): Promise<void> {
    try {
      // 初始化 Ollama
      const isOllamaRunning = await ollamaClient.isRunning();
      if (!isOllamaRunning) {
        console.log("启动 Ollama 服务...");
        await ollamaClient.startDaemon();
      }

      // 检查 Whisper 是否可用
      const isWhisperAvailable = await whisperTranscriber.isAvailable();
      if (!isWhisperAvailable) {
        console.warn("Whisper 不可用，请确保已安装 whisper 或 whisper.cpp");
      }
    } catch (error) {
      console.error("服务初始化失败:", error);
    }
  }

  /**
   * 添加任务日志
   */
  private addTaskLog(
    taskId: string,
    level: TaskLog["level"],
    message: string,
    details?: string
  ): void {
    const log: Omit<TaskLog, "id"> = {
      timestamp: new Date(),
      level,
      message,
      details,
    };

    // 尝试保存到数据库，如果失败则跳过（任务可能还未创建）
    try {
      databaseManager.addTaskLog(taskId, log);
    } catch (error: any) {
      // 如果是外键约束错误，说明任务还未保存到数据库，先缓存日志
      if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        console.log(`缓存日志（任务 ${taskId} 还未保存）: ${message}`);
      } else {
        console.error("保存日志失败:", error);
      }
    }

    // 更新内存中的任务
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.logs = task.logs || [];
      task.logs.push({ ...log, id: `log_${Date.now()}` });

      // 通知前端日志更新
      this.notifyTaskUpdate(task);
    } else {
      // 如果任务还不存在，创建一个临时的日志缓存
      if (!this.tempLogs) {
        this.tempLogs = new Map();
      }
      if (!this.tempLogs.has(taskId)) {
        this.tempLogs.set(taskId, []);
      }
      this.tempLogs.get(taskId)!.push({ ...log, id: `log_${Date.now()}` });
    }
  }

  /**
   * 创建翻译任务
   */
  async createTask(options: CreateTaskOptions): Promise<string> {
    const taskId = uuidv4();

    try {
      this.addTaskLog(
        taskId,
        "info",
        "开始创建翻译任务",
        `文件路径: ${options.filePath}`
      );

      // 检查文件是否存在
      const stats = await fs.stat(options.filePath);
      if (!stats.isFile()) {
        throw new Error("文件不存在");
      }

      this.addTaskLog(
        taskId,
        "info",
        "文件验证成功",
        `文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
      );

      // 获取视频信息
      this.addTaskLog(taskId, "info", "正在获取视频信息...");
      const videoInfo = await ffmpegProcessor.getVideoInfo(options.filePath);
      this.addTaskLog(
        taskId,
        "success",
        "视频信息获取成功",
        `时长: ${videoInfo.duration}秒, 格式: ${videoInfo.format}`
      );

      // 创建视频文件记录
      const videoFile: VideoFile = {
        id: uuidv4(),
        name: path.basename(options.filePath),
        path: options.filePath,
        size: stats.size,
        duration: videoInfo.duration,
        format: videoInfo.format,
        createdAt: new Date(),
      };

      // 保存到数据库
      databaseManager.saveVideoFile(videoFile);

      // 创建翻译任务
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 保存任务到数据库
      databaseManager.createTranslationTask(task);

      // 添加到活动任务
      this.activeTasks.set(task.id, task);

      // 将缓存的日志保存到数据库
      if (this.tempLogs?.has(taskId)) {
        const cachedLogs = this.tempLogs.get(taskId);
        if (cachedLogs) {
          for (const log of cachedLogs) {
            try {
              databaseManager.addTaskLog(taskId, log);
            } catch (error) {
              console.error("保存缓存日志失败:", error);
            }
          }
          // 将缓存的日志添加到任务对象
          task.logs = cachedLogs;
          // 清除缓存
          this.tempLogs.delete(taskId);
        }
      }

      this.addTaskLog(
        taskId,
        "success",
        "翻译任务创建成功",
        `源语言: ${options.sourceLanguage}, 目标语言: ${options.targetLanguage}`
      );

      // 通知前端任务已创建
      this.notifyTaskUpdate(task);

      // 异步开始处理任务
      this.processTask(task.id, options.ollamaModel, options.whisperModel);

      return task.id;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addTaskLog(taskId, "error", "创建任务失败", errorMessage);
      console.error("创建任务失败:", error);
      throw error;
    }
  }

  /**
   * 处理翻译任务
   */
  private async processTask(
    taskId: string,
    ollamaModel = "llama3",
    whisperModel = "base"
  ): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.error(`任务 ${taskId} 不存在`);
      return;
    }

    try {
      this.addTaskLog(
        taskId,
        "info",
        "开始处理翻译任务",
        `使用模型 - Whisper: ${whisperModel}, Ollama: ${ollamaModel}`
      );

      // 步骤 1: 检查 FFmpeg 可用性
      this.addTaskLog(taskId, "info", "检查 FFmpeg 可用性...");
      const ffmpegAvailable = await ffmpegProcessor.isAvailable();
      if (!ffmpegAvailable) {
        throw new Error(
          "FFmpeg 不可用。请确保已安装 FFmpeg 并且在系统 PATH 中。\n" +
            "安装方法：\n" +
            "- macOS: brew install ffmpeg\n" +
            "- Ubuntu/Debian: sudo apt install ffmpeg\n" +
            "- Windows: 从 https://ffmpeg.org/download.html 下载并添加到 PATH"
        );
      }
      this.addTaskLog(taskId, "success", "FFmpeg 可用性检查通过");

      // 步骤 2: 检查 Whisper 可用性
      this.addTaskLog(taskId, "info", "检查 Whisper 可用性...");
      const whisperAvailable = await whisperTranscriber.isAvailable();
      if (!whisperAvailable) {
        throw new Error("Whisper 不可用，请确保已安装 whisper 或 whisper.cpp");
      }
      this.addTaskLog(taskId, "success", "Whisper 可用性检查通过");

      // 步骤 3: 检查 Ollama 可用性
      this.addTaskLog(taskId, "info", "检查 Ollama 可用性...");
      const ollamaAvailable = await ollamaClient.isAvailable();
      if (!ollamaAvailable) {
        throw new Error("Ollama 不可用，请确保 Ollama 服务正在运行");
      }
      this.addTaskLog(taskId, "success", "Ollama 可用性检查通过");

      // 步骤 4: 提取音频
      await this.updateTaskStatus(taskId, TaskStatus.EXTRACTING_AUDIO, 10);
      this.addTaskLog(
        taskId,
        "info",
        "开始提取音频...",
        `视频文件: ${task.videoFile.name}，路径: ${task.videoFile.path}`
      );

      const audioPath = await ffmpegProcessor.extractAudio(
        task.videoFile.path,
        undefined,
        (progress) => {
          const currentProgress = 10 + progress * 0.2;
          this.updateTaskStatus(
            taskId,
            TaskStatus.EXTRACTING_AUDIO,
            currentProgress
          );
          if (progress % 20 === 0) {
            // 每20%记录一次日志
            this.addTaskLog(
              taskId,
              "info",
              `音频提取进度: ${progress.toFixed(1)}%`
            );
          }
        }
      );

      this.addTaskLog(
        taskId,
        "success",
        "音频提取完成",
        `音频文件: ${audioPath}`
      );

      // 步骤 5: 切分音频
      await this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, 30);
      this.addTaskLog(taskId, "info", "开始切分音频...");

      const audioSegments = await ffmpegProcessor.segmentAudio(audioPath);
      this.addTaskLog(
        taskId,
        "success",
        "音频切分完成",
        `共切分为 ${audioSegments.length} 个段落`
      );

      // 步骤 6: 使用 Whisper 进行语音识别
      this.addTaskLog(
        taskId,
        "info",
        "开始语音识别...",
        `使用模型: ${whisperModel}, 源语言: ${task.sourceLanguage}`
      );

      const segments = await whisperTranscriber.transcribeBatch(
        audioSegments,
        {
          model: whisperModel as any,
          language: this.getWhisperLanguageCode(task.sourceLanguage),
          temperature: 0.0,
        },
        (completed, total) => {
          const progress = 30 + (completed / total) * 30;
          this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, progress);
          this.addTaskLog(
            taskId,
            "info",
            `语音识别进度: ${completed}/${total} (${(
              (completed / total) *
              100
            ).toFixed(1)}%)`
          );
        }
      );

      this.addTaskLog(
        taskId,
        "success",
        "语音识别完成",
        `识别出 ${segments.length} 个文本段落`
      );

      // 保存转录段落
      databaseManager.saveTranscriptionSegments(taskId, segments);

      // 步骤 7: 翻译
      await this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, 60);
      this.addTaskLog(
        taskId,
        "info",
        "开始翻译...",
        `从 ${task.sourceLanguage} 翻译到 ${task.targetLanguage}`
      );

      const originalTexts = segments.map((s) => s.originalText);
      const translatedTexts = await ollamaClient.translateBatch(
        originalTexts,
        task.sourceLanguage,
        task.targetLanguage,
        ollamaModel,
        (completed, total) => {
          const progress = 60 + (completed / total) * 30;
          this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, progress);
          this.addTaskLog(
            taskId,
            "info",
            `翻译进度: ${completed}/${total} (${(
              (completed / total) *
              100
            ).toFixed(1)}%)`
          );
        }
      );

      this.addTaskLog(
        taskId,
        "success",
        "翻译完成",
        `翻译了 ${translatedTexts.length} 个文本段落`
      );

      // 步骤 8: 生成字幕
      await this.updateTaskStatus(taskId, TaskStatus.GENERATING_SUBTITLES, 90);
      this.addTaskLog(taskId, "info", "开始生成字幕...");

      // 合并转录和翻译结果
      const mergedSegments = segments.map((segment, index) => ({
        ...segment,
        translatedText: translatedTexts[index] || "",
      }));

      // 更新数据库中的翻译结果
      databaseManager.updateTranslatedSegments(taskId, mergedSegments);

      // 生成字幕文件
      const { SubtitleGenerator } = await import("../utils/subtitle-generator");
      const subtitleEntries =
        SubtitleGenerator.segmentsToSubtitles(mergedSegments);
      const subtitles = SubtitleGenerator.generateSRT(subtitleEntries);

      this.addTaskLog(
        taskId,
        "success",
        "字幕生成完成",
        `生成了 ${subtitles.length} 条字幕`
      );

      // 步骤 9: 完成任务
      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100);
      this.addTaskLog(
        taskId,
        "success",
        "翻译任务完成",
        `总耗时: ${((Date.now() - task.createdAt.getTime()) / 1000).toFixed(
          1
        )} 秒`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.addTaskLog(taskId, "error", "任务处理失败", errorMessage);
      await this.updateTaskStatus(
        taskId,
        TaskStatus.FAILED,
        undefined,
        errorMessage
      );
      console.error(`任务 ${taskId} 处理失败:`, error);
    }
  }

  /**
   * 将语言名称转换为 Whisper 语言代码
   */
  private getWhisperLanguageCode(language: string): string {
    const languageMap: Record<string, string> = {
      English: "en",
      Chinese: "zh",
      中文: "zh",
      Japanese: "ja",
      日本語: "ja",
      Korean: "ko",
      한국어: "ko",
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

    return languageMap[language] || "auto";
  }

  /**
   * 更新任务状态
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    errorMessage?: string
  ): Promise<void> {
    // 更新数据库
    databaseManager.updateTaskStatus(taskId, status, progress, errorMessage);

    // 更新内存中的任务
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.status = status;
      if (progress !== undefined) task.progress = progress;
      if (errorMessage !== undefined) task.errorMessage = errorMessage;
      task.updatedAt = new Date();

      if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        task.completedAt = new Date();
        // 从活动任务中移除
        this.activeTasks.delete(taskId);
      }

      // 通知前端
      this.notifyTaskUpdate(task);
    }
  }

  /**
   * 通知前端任务更新
   */
  private notifyTaskUpdate(task: TranslationTask): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("task-updated", task);
    }
  }

  /**
   * 从数据库加载未完成的任务
   */
  private loadActiveTasks(): void {
    const tasks = databaseManager.getAllTranslationTasks();
    for (const task of tasks) {
      this.activeTasks.set(task.id, task);
    }
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TranslationTask[] {
    return databaseManager.getAllTranslationTasks();
  }

  /**
   * 获取特定任务
   */
  getTask(taskId: string): TranslationTask | null {
    return databaseManager.getTranslationTask(taskId);
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (
      task &&
      task.status !== TaskStatus.COMPLETED &&
      task.status !== TaskStatus.FAILED
    ) {
      this.updateTaskStatus(taskId, TaskStatus.PAUSED);
    }
  }

  /**
   * 恢复任务
   */
  resumeTask(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (task && task.status === TaskStatus.PAUSED) {
      // 重新开始处理
      this.processTask(taskId);
    }
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): void {
    // 从活动任务中移除
    this.activeTasks.delete(taskId);

    // 从数据库中删除
    databaseManager.deleteTranslationTask(taskId);

    // 通知前端
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("task-deleted", taskId);
    }
  }

  /**
   * 重试失败的任务
   */
  retryTask(taskId: string): void {
    const task = databaseManager.getTranslationTask(taskId);
    if (task && task.status === TaskStatus.FAILED) {
      // 重置任务状态
      this.updateTaskStatus(taskId, TaskStatus.PENDING, 0);
      this.activeTasks.set(taskId, task);

      // 重新开始处理
      this.processTask(taskId);
    }
  }

  /**
   * 获取任务日志
   */
  getTaskLogs(taskId: string) {
    return databaseManager.getTaskLogs(taskId);
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    return databaseManager.getStatistics();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 停止所有活动任务
    this.activeTasks.clear();

    // 清理 FFmpeg 临时文件
    ffmpegProcessor.cleanup();

    // 清理 Whisper 临时文件
    whisperTranscriber.cleanup();

    // 停止 Ollama 守护进程
    ollamaClient.stopDaemon();
  }
}

// 单例实例
export const taskManager = new TaskManager();
