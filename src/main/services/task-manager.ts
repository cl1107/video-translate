import { BrowserWindow } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  TaskStatus,
  TranscriptionSegment,
  TranslationTask,
  VideoFile,
} from "../../shared/types/video";
import { SubtitleGenerator } from "../utils/subtitle-generator";
import { databaseManager } from "./database/manager";
import { ffmpegProcessor } from "./ffmpeg/processor";
import { ollamaClient } from "./ollama/client";

export interface CreateTaskOptions {
  filePath: string;
  sourceLanguage: string;
  targetLanguage: string;
  ollamaModel?: string;
}

export class TaskManager {
  private activeTasks = new Map<string, TranslationTask>();
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    this.initializeOllama();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private async initializeOllama(): Promise<void> {
    try {
      const isRunning = await ollamaClient.isRunning();
      if (!isRunning) {
        console.log("启动 Ollama 服务...");
        await ollamaClient.startDaemon();
      }
    } catch (error) {
      console.error("Ollama 初始化失败:", error);
    }
  }

  /**
   * 创建翻译任务
   */
  async createTask(options: CreateTaskOptions): Promise<string> {
    try {
      // 检查文件是否存在
      const stats = await fs.stat(options.filePath);
      if (!stats.isFile()) {
        throw new Error("文件不存在");
      }

      // 获取视频信息
      const videoInfo = await ffmpegProcessor.getVideoInfo(options.filePath);

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
        id: uuidv4(),
        videoFile,
        status: TaskStatus.PENDING,
        progress: 0,
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
        segments: [],
        subtitles: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 保存任务到数据库
      databaseManager.createTranslationTask({
        id: task.id,
        videoFile: task.videoFile,
        status: task.status,
        progress: task.progress,
        sourceLanguage: task.sourceLanguage,
        targetLanguage: task.targetLanguage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });

      // 添加到活动任务
      this.activeTasks.set(task.id, task);

      // 通知前端任务已创建
      this.notifyTaskUpdate(task);

      // 异步开始处理任务
      this.processTask(task.id, options.ollamaModel);

      return task.id;
    } catch (error) {
      console.error("创建任务失败:", error);
      throw error;
    }
  }

  /**
   * 处理翻译任务
   */
  private async processTask(
    taskId: string,
    ollamaModel = "llama3"
  ): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.error(`任务 ${taskId} 不存在`);
      return;
    }

    try {
      // 步骤 1: 提取音频
      await this.updateTaskStatus(taskId, TaskStatus.EXTRACTING_AUDIO, 10);

      const audioPath = await ffmpegProcessor.extractAudio(
        task.videoFile.path,
        undefined,
        (progress) => {
          this.updateTaskStatus(
            taskId,
            TaskStatus.EXTRACTING_AUDIO,
            10 + progress * 0.2
          );
        }
      );

      // 步骤 2: 切分音频
      await this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, 30);

      const audioSegments = await ffmpegProcessor.segmentAudio(audioPath);

      // 步骤 3: 语音识别 (模拟 - 实际需要集成 Whisper)
      const segments: TranscriptionSegment[] = [];

      for (let i = 0; i < audioSegments.length; i++) {
        const audioSegment = audioSegments[i];

        // 模拟转录过程
        const transcriptionText = `这是第 ${i + 1} 段转录文本示例`;

        const segment: TranscriptionSegment = {
          id: uuidv4(),
          start: audioSegment.start,
          end: audioSegment.end,
          originalText: transcriptionText,
          confidence: 0.95,
        };

        segments.push(segment);

        // 更新进度
        const progress = 30 + ((i + 1) / audioSegments.length) * 30;
        await this.updateTaskStatus(taskId, TaskStatus.TRANSCRIBING, progress);
      }

      // 保存转录段落
      databaseManager.saveTranscriptionSegments(taskId, segments);

      // 步骤 4: 翻译
      await this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, 60);

      const originalTexts = segments.map((s) => s.originalText);
      const translatedTexts = await ollamaClient.translateBatch(
        originalTexts,
        task.sourceLanguage,
        task.targetLanguage,
        ollamaModel,
        (completed, total) => {
          const progress = 60 + (completed / total) * 30;
          this.updateTaskStatus(taskId, TaskStatus.TRANSLATING, progress);
        }
      );

      // 更新段落翻译
      for (let i = 0; i < segments.length; i++) {
        segments[i].translatedText = translatedTexts[i];
        databaseManager.updateSegmentTranslation(
          segments[i].id,
          translatedTexts[i]
        );
      }

      // 步骤 5: 生成字幕
      await this.updateTaskStatus(taskId, TaskStatus.GENERATING_SUBTITLES, 90);

      const subtitles = SubtitleGenerator.segmentsToSubtitles(segments);
      const optimizedSubtitles = SubtitleGenerator.optimizeTimeline(subtitles);

      // 保存字幕文件
      const outputDir = path.dirname(task.videoFile.path);
      const subtitlePath = path.join(
        outputDir,
        `${path.parse(task.videoFile.name).name}.srt`
      );

      await SubtitleGenerator.saveSubtitle(
        optimizedSubtitles,
        subtitlePath,
        "srt"
      );

      // 任务完成
      await this.updateTaskStatus(taskId, TaskStatus.COMPLETED, 100);

      // 清理临时音频文件
      try {
        await fs.unlink(audioPath);
        for (const segment of audioSegments) {
          await fs.unlink(segment.filePath);
        }
      } catch (error) {
        console.warn("清理临时文件失败:", error);
      }
    } catch (error) {
      console.error(`任务 ${taskId} 处理失败:`, error);
      await this.updateTaskStatus(
        taskId,
        TaskStatus.FAILED,
        undefined,
        error.message
      );
    }
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

    // 停止 Ollama 守护进程
    ollamaClient.stopDaemon();
  }
}

// 单例实例
export const taskManager = new TaskManager();
