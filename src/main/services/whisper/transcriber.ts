import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { TranscriptionSegment } from "../../../shared/types/video";

// 导入 whisper-node
const { whisper } = require("whisper-node");

/**
 * Whisper转录选项接口
 */
export interface WhisperOptions {
  /** 使用的模型名称 */
  model?:
    | "tiny"
    | "base"
    | "small"
    | "medium"
    | "large"
    | "large-v2"
    | "large-v3";
  /** 语言代码（如：en、zh、auto） */
  language?: string;
  /** 温度参数，控制随机性 */
  temperature?: number;
  /** 线程数 */
  threads?: number;
  /** 输出格式 */
  outputFormat?: "json" | "txt" | "vtt" | "srt";
}

/**
 * Whisper转录结果接口
 */
export interface WhisperResult {
  /** 转录段落数组 */
  segments: Array<{
    /** 段落ID */
    id: number;
    /** 开始时间（秒） */
    start: number;
    /** 结束时间（秒） */
    end: number;
    /** 转录文本 */
    text: string;
    /** 置信度（可选） */
    confidence?: number;
  }>;
  /** 完整转录文本 */
  text: string;
  /** 检测到的语言 */
  language: string;
  /** 生成的文件路径 */
  files?: {
    /** TXT 文件路径 */
    txt?: string;
    /** SRT 文件路径 */
    srt?: string;
    /** VTT 文件路径 */
    vtt?: string;
  };
}

/**
 * 扩展的转录结果接口，包含字幕文件信息
 */
export interface TranscriptionResult {
  /** 转录段落数组 */
  segments: TranscriptionSegment[];
  /** 生成的字幕文件路径 */
  subtitleFiles?: {
    /** TXT 文件路径 */
    txt?: string;
    /** SRT 文件路径 */
    srt?: string;
    /** VTT 文件路径 */
    vtt?: string;
  };
}

export class WhisperTranscriber {
  private modelsDir: string;
  private tempDir: string;

  /**
   * Whisper转录器构造函数
   */
  constructor() {
    this.modelsDir = path.join(os.homedir(), ".cache", "whisper");
    this.tempDir = path.join(os.tmpdir(), "video-translate-whisper");
    this.ensureDirectories();
  }

  /**
   * 确保模型和临时目录存在
   */
  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.modelsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error("创建目录失败:", error);
    }
  }

  /**
   * 检查Whisper是否可用
   * @returns 返回true表示Whisper可用，false表示不可用
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
   * 检查指定模型是否可用
   * @param model - 模型名称
   * @returns 返回true表示模型可用（whisper-node会自动下载模型）
   */
  async isModelAvailable(model: string): Promise<boolean> {
    // whisper-node 会在需要时自动下载模型
    return true;
  }

  /**
   * 下载Whisper模型（whisper-node会自动处理）
   * @param model - 模型名称
   * @param onProgress - 进度回调函数（可选）
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
   * @param audioPath - 音频文件路径
   * @param options - 转录选项（可选）
   * @param onProgress - 进度回调函数（可选）
   * @returns 返回转录结果，包含段落数组和字幕文件路径
   * @throws 当转录失败时抛出错误
   */
  async transcribe(
    audioPath: string,
    options: WhisperOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<TranscriptionResult> {
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
          word_timestamps: false, // 启用词级时间戳
          gen_file_txt: true,      // 生成 .txt 文件
          gen_file_subtitle: true, // 生成 .srt 文件
          gen_file_vtt: true,      // 生成 .vtt 文件
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
      console.log("Whisper 返回数据类型:", typeof transcript);
      console.log("Whisper 返回数据结构:", JSON.stringify(transcript, null, 2));

      // 检查是否有生成的字幕文件
      let subtitleFiles: { txt?: string; srt?: string; vtt?: string } = {};
      if (transcript && typeof transcript === "object") {
        // whisper-node 可能会在与音频文件相同的目录中生成字幕文件
        const audioDir = path.dirname(audioPath);
        const audioBaseName = path.basename(audioPath, path.extname(audioPath));
        
        // 检查可能生成的字幕文件
        const possibleFiles = {
          txt: path.join(audioDir, `${audioBaseName}.txt`),
          srt: path.join(audioDir, `${audioBaseName}.srt`),
          vtt: path.join(audioDir, `${audioBaseName}.vtt`),
        };

        // 检查文件是否存在
        for (const [format, filePath] of Object.entries(possibleFiles)) {
          try {
            await fs.access(filePath);
            subtitleFiles[format as keyof typeof subtitleFiles] = filePath;
            console.log(`找到字幕文件: ${filePath}`);
          } catch {
            // 文件不存在，忽略
          }
        }
      }

      if (Array.isArray(transcript)) {
        console.log(`Whisper 返回 ${transcript.length} 个段落`);
        transcript.forEach((segment, index) => {
          segments.push({
            id: uuidv4(),
            start: segment.start || 0,
            end: segment.end || 0,
            originalText: segment.speech?.trim() || segment.text?.trim() || "",
            confidence: 0.9, // whisper-node 可能不提供置信度，使用默认值
          });
        });
      } else if (transcript && typeof transcript === "object") {
        // 处理对象形式的返回结果
        console.log("处理对象形式的返回结果");
        if (transcript.segments && Array.isArray(transcript.segments)) {
          transcript.segments.forEach((segment, index) => {
            segments.push({
              id: uuidv4(),
              start: segment.start || 0,
              end: segment.end || 0,
              originalText:
                segment.text?.trim() || segment.speech?.trim() || "",
              confidence: segment.confidence || 0.9,
            });
          });
        } else if (transcript.text) {
          // 单个文本结果
          segments.push({
            id: uuidv4(),
            start: 0,
            end: 0,
            originalText: transcript.text.trim(),
            confidence: 0.9,
          });
        } else {
          console.log("无法识别的返回结果结构");
        }
      } else {
        // 如果返回的不是分段数据，创建一个单一段落
        console.log("创建默认段落，原始数据:", transcript);
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
      
      // 返回包含字幕文件信息的结果
      const result: TranscriptionResult = {
        segments,
      };
      
      // 如果有字幕文件，添加到结果中
      if (Object.keys(subtitleFiles).length > 0) {
        result.subtitleFiles = subtitleFiles;
        console.log("生成的字幕文件:", subtitleFiles);
      }
      
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Whisper 转录失败:", errorMessage);
      throw new Error(`Whisper 转录失败: ${errorMessage}`);
    }
  }

  /**
   * 批量转录音频段落
   * @param audioSegments - 音频段落数组
   * @param options - 转录选项（可选）
   * @param onProgress - 进度回调函数（可选）
   * @returns 返回按时间排序的转录段落数组
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
        const result = await this.transcribe(
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
        const adjustedSegments = result.segments.map((segment) => ({
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
   * @returns 返回支持的语言代码和名称数组
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
   * @returns 返回可用模型的详细信息数组
   */
  getAvailableModels(): Array<{
    /** 模型名称 */
    name: string;
    /** 模型大小 */
    size: string;
    /** 模型描述 */
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
