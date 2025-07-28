import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { TranscriptionSegment } from "../../../shared/types/video";

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
  private whisperPath: string;
  private modelsDir: string;
  private tempDir: string;

  constructor(whisperPath = "whisper") {
    this.whisperPath = whisperPath;
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
    return new Promise((resolve) => {
      const process = spawn(this.whisperPath, ["--help"]);

      process.on("error", () => resolve(false));
      process.on("close", (code) => resolve(code === 0));

      // 超时检查
      setTimeout(() => {
        process.kill();
        resolve(false);
      }, 5000);
    });
  }

  /**
   * 检查模型是否已下载
   */
  async isModelAvailable(model: string): Promise<boolean> {
    try {
      const modelFiles = [`ggml-${model}.bin`, `ggml-${model}.en.bin`];

      for (const modelFile of modelFiles) {
        const modelPath = path.join(this.modelsDir, modelFile);
        try {
          await fs.access(modelPath);
          return true;
        } catch {
          continue;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 下载 Whisper 模型
   */
  async downloadModel(
    model: string,
    onProgress?: (progress: string) => void
  ): Promise<void> {
    if (await this.isModelAvailable(model)) {
      console.log(`模型 ${model} 已存在`);
      return;
    }

    return new Promise((resolve, reject) => {
      console.log(`开始下载模型: ${model}`);

      // 使用 whisper 命令下载模型
      const process = spawn(this.whisperPath, [
        "--model",
        model,
        "--output_dir",
        this.tempDir,
        "--download_only",
      ]);

      let output = "";
      let error = "";

      process.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;

        if (onProgress) {
          // 解析下载进度
          const progressMatch = text.match(/(\d+)%/);
          if (progressMatch) {
            onProgress(`下载进度: ${progressMatch[1]}%`);
          }
        }
      });

      process.stderr.on("data", (data) => {
        error += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          console.log(`模型 ${model} 下载完成`);
          resolve();
        } else {
          reject(new Error(`模型下载失败: ${error}`));
        }
      });
    });
  }

  /**
   * 转录音频文件
   */
  async transcribe(
    audioPath: string,
    options: WhisperOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<TranscriptionSegment[]> {
    const {
      model = "base",
      language = "auto",
      temperature = 0.0,
      threads = Math.min(4, os.cpus().length),
      outputFormat = "json",
    } = options;

    // 检查模型是否可用
    if (!(await this.isModelAvailable(model))) {
      console.log(`模型 ${model} 不存在，开始下载...`);
      await this.downloadModel(model, (progress) => {
        console.log(progress);
      });
    }

    const outputPath = path.join(
      this.tempDir,
      `transcription_${Date.now()}.json`
    );

    return new Promise((resolve, reject) => {
      const args = [
        audioPath,
        "--model",
        model,
        "--output_format",
        outputFormat,
        "--output_file",
        outputPath,
        "--temperature",
        temperature.toString(),
        "--threads",
        threads.toString(),
        "--print_progress",
      ];

      if (language !== "auto") {
        args.push("--language", language);
      }

      const process = spawn(this.whisperPath, args);
      let error = "";

      process.stderr.on("data", (data) => {
        const output = data.toString();
        error += output;

        // 解析进度信息
        if (onProgress) {
          const progressMatch = output.match(/(\d+)%/);
          if (progressMatch) {
            const progress = parseInt(progressMatch[1]);
            onProgress(progress);
          }
        }
      });

      process.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`Whisper 转录失败: ${error}`));
          return;
        }

        try {
          // 读取转录结果
          const resultData = await fs.readFile(outputPath, "utf-8");
          const result: WhisperResult = JSON.parse(resultData);

          // 转换为我们的格式
          const segments: TranscriptionSegment[] = result.segments.map(
            (segment) => ({
              id: uuidv4(),
              start: segment.start,
              end: segment.end,
              originalText: segment.text.trim(),
              confidence: segment.confidence || 0.9,
            })
          );

          // 清理临时文件
          try {
            await fs.unlink(outputPath);
          } catch (cleanupError) {
            console.warn("清理临时文件失败:", cleanupError);
          }

          resolve(segments);
        } catch (parseError) {
          reject(new Error(`解析转录结果失败: ${parseError.message}`));
        }
      });
    });
  }

  /**
   * 批量转录音频段落
   */
  async transcribeBatch(
    audioSegments: Array<{ filePath: string; start: number; end: number }>,
    options: WhisperOptions = {},
    onProgress?: (completed: number, total: number) => void
  ): Promise<TranscriptionSegment[]> {
    const allSegments: TranscriptionSegment[] = [];

    for (let i = 0; i < audioSegments.length; i++) {
      const audioSegment = audioSegments[i];

      try {
        const segments = await this.transcribe(
          audioSegment.filePath,
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
          start: segment.start + audioSegment.start,
          end: segment.end + audioSegment.start,
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
          start: audioSegment.start,
          end: audioSegment.end,
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
