import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { TranscriptionSegment } from "../../../shared/types/video";

// 导入 whisper-node
const { whisper } = require("whisper-node");

export interface WhisperOptions {
  model?:
    | "tiny"
    | "base"
    | "small"
    | "medium"
    | "large"
    | "large-v2"
    | "large-v3";
  language?: string;
  temperature?: number;
  threads?: number;
  outputFormat?: "json" | "txt" | "vtt" | "srt";
}

export interface WhisperResult {
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    confidence?: number;
  }>;
  text: string;
  language: string;
}

export class WhisperTranscriber {
  private modelsDir: string;
  private tempDir: string;

  constructor() {
    this.modelsDir = path.join(os.homedir(), ".cache", "whisper");
    this.tempDir = path.join(os.tmpdir(), "video-translate-whisper");
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.modelsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error("创建目录失败:", error);
    }
  }

  /**
   * 检查 Whisper 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      // whisper-node 包含了预编译的 whisper.cpp，所以总是可用的
      return true;
    } catch (error) {
      console.error("检查 Whisper 可用性失败:", error);
      return false;
    }
  }

  /**
   * 检查模型是否已下载
   * whisper-node 会自动下载模型，所以这里总是返回 true
   */
  async isModelAvailable(model: string): Promise<boolean> {
    // whisper-node 会在需要时自动下载模型
    return true;
  }

  /**
   * 下载 Whisper 模型
   * whisper-node 会自动处理模型下载
   */
  async downloadModel(
    model: string,
    onProgress?: (progress: string) => void
  ): Promise<void> {
    if (onProgress) {
      onProgress("whisper-node 会自动下载所需模型");
    }
    console.log(`模型 ${model} 将在需要时自动下载`);
  }

  /**
   * 转录音频文件
   */
  async transcribe(
    audioPath: string,
    options: WhisperOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<TranscriptionSegment[]> {
    const { model = "base", language = "auto", temperature = 0.0 } = options;

    try {
      console.log(`开始转录音频文件: ${audioPath}`);

      if (onProgress) {
        onProgress(10);
      }

      // 使用 whisper-node 进行转录
      const whisperOptions = {
        modelName: model, // 模型名称
        whisperOptions: {
          language: language === "auto" ? undefined : language,
          word_timestamps: true, // 启用词级时间戳
          output_txt: false,
          output_vtt: false,
          output_srt: false,
        },
      };

      if (onProgress) {
        onProgress(30);
      }

      console.log("调用 whisper-node 进行转录...");
      const transcript = await whisper(audioPath, whisperOptions);

      if (onProgress) {
        onProgress(80);
      }

      // 转换 whisper-node 的输出格式为我们需要的格式
      const segments: TranscriptionSegment[] = [];

      if (Array.isArray(transcript)) {
        transcript.forEach((segment, index) => {
          segments.push({
            id: uuidv4(),
            start: segment.start || 0,
            end: segment.end || 0,
            originalText: segment.speech?.trim() || "",
            confidence: 0.9, // whisper-node 可能不提供置信度，使用默认值
          });
        });
      } else {
        // 如果返回的不是分段数据，创建一个单一段落
        segments.push({
          id: uuidv4(),
          start: 0,
          end: 0,
          originalText:
            typeof transcript === "string" ? transcript : "转录结果格式异常",
          confidence: 0.9,
        });
      }

      if (onProgress) {
        onProgress(100);
      }

      console.log(`转录完成，生成了 ${segments.length} 个段落`);
      return segments;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Whisper 转录失败:", errorMessage);
      throw new Error(`Whisper 转录失败: ${errorMessage}`);
    }
  }

  /**
   * 批量转录音频段落
   */
  async transcribeBatch(
    audioSegments: Array<{ path: string; startTime: number; duration: number }>,
    options: WhisperOptions = {},
    onProgress?: (completed: number, total: number) => void
  ): Promise<TranscriptionSegment[]> {
    const allSegments: TranscriptionSegment[] = [];

    for (let i = 0; i < audioSegments.length; i++) {
      const audioSegment = audioSegments[i];

      try {
        const segments = await this.transcribe(
          audioSegment.path,
          options,
          (segmentProgress) => {
            // 计算总体进度
            const totalProgress =
              ((i + segmentProgress / 100) / audioSegments.length) * 100;
            console.log(`转录进度: ${totalProgress.toFixed(1)}%`);
          }
        );

        // 调整时间戳以匹配原始视频时间
        const adjustedSegments = segments.map((segment) => ({
          ...segment,
          start: segment.start + audioSegment.startTime,
          end: segment.end + audioSegment.startTime,
        }));

        allSegments.push(...adjustedSegments);

        if (onProgress) {
          onProgress(i + 1, audioSegments.length);
        }
      } catch (error) {
        console.error(`转录段落 ${i} 失败:`, error);

        // 创建一个错误段落
        allSegments.push({
          id: uuidv4(),
          start: audioSegment.startTime,
          end: audioSegment.startTime + audioSegment.duration,
          originalText: "[转录失败]",
          confidence: 0.0,
        });
      }
    }

    return allSegments.sort((a, b) => a.start - b.start);
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): Array<{ code: string; name: string }> {
    return [
      { code: "auto", name: "自动检测" },
      { code: "en", name: "English" },
      { code: "zh", name: "中文" },
      { code: "ja", name: "日本語" },
      { code: "ko", name: "한국어" },
      { code: "es", name: "Español" },
      { code: "fr", name: "Français" },
      { code: "de", name: "Deutsch" },
      { code: "it", name: "Italiano" },
      { code: "pt", name: "Português" },
      { code: "ru", name: "Русский" },
      { code: "ar", name: "العربية" },
      { code: "hi", name: "हिन्दी" },
      { code: "th", name: "ไทย" },
      { code: "vi", name: "Tiếng Việt" },
    ];
  }

  /**
   * 获取可用的模型列表
   */
  getAvailableModels(): Array<{
    name: string;
    size: string;
    description: string;
  }> {
    return [
      {
        name: "tiny",
        size: "~39MB",
        description: "最小模型，速度最快但准确率较低",
      },
      {
        name: "base",
        size: "~142MB",
        description: "基础模型，平衡速度和准确率",
      },
      {
        name: "small",
        size: "~466MB",
        description: "小型模型，准确率较好",
      },
      {
        name: "medium",
        size: "~1.5GB",
        description: "中型模型，高准确率",
      },
      {
        name: "large-v3",
        size: "~2.9GB",
        description: "最新大型模型，最高准确率",
      },
    ];
  }

  /**
   * 清理临时文件
   */
  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      await Promise.all(
        files.map((file) =>
          fs.unlink(path.join(this.tempDir, file)).catch(() => {})
        )
      );
    } catch (error) {
      console.error("清理临时文件失败:", error);
    }
  }
}

// 单例实例
export const whisperTranscriber = new WhisperTranscriber();
