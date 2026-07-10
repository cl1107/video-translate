import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { TranscriptionSegment } from "../../../shared/types/video";
import { SubtitleGenerator } from "../../utils/subtitle-generator";

// whisper-node 暂未提供类型定义，使用 require 导入
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { whisper } = require("whisper-node");

export interface WhisperOptions {
  model?: "tiny" | "base" | "small" | "medium" | "large" | "large-v2" | "large-v3";
  language?: string;
  temperature?: number;
  threads?: number;
  outputFormat?: "json" | "txt" | "vtt" | "srt";
  /**
   * 是否在转录后生成字幕文件，默认开启。
   */
  generateSubtitleFiles?: boolean;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  subtitleFiles?: {
    srt?: string;
    vtt?: string;
    txt?: string;
  };
}

export class WhisperTranscriber {
  private modelsDir: string;
  private tempDir: string;

  constructor() {
    this.modelsDir = path.join(os.homedir(), ".cache", "whisper");
    this.tempDir = path.join(os.tmpdir(), "video-translate-whisper");
    void this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureDirectories();
      return true;
    } catch (error) {
      console.error("检查 Whisper 可用性失败:", error);
      return false;
    }
  }

  async isModelAvailable(_model: string): Promise<boolean> {
    // whisper-node 会在需要时自动下载模型
    return true;
  }

  async downloadModel(model: string, onProgress?: (progress: string) => void): Promise<void> {
    onProgress?.(`模型 ${model} 将在需要时自动下载`);
  }

  async transcribe(
    audioPath: string,
    options: WhisperOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<TranscriptionResult> {
    const { model = "base", language = "auto", temperature = 0, generateSubtitleFiles = true } = options;

    onProgress?.(5);

    const whisperOptions = {
      modelName: model,
      whisperOptions: {
        language: language === "auto" ? undefined : language,
        temperature,
        word_timestamps: false,
      },
    };

    onProgress?.(20);

    const rawResult = await whisper(audioPath, whisperOptions);

    onProgress?.(60);

    const segments = this.normalizeSegments(rawResult);

    onProgress?.(80);

    let subtitleFiles: TranscriptionResult["subtitleFiles"] | undefined;
    if (generateSubtitleFiles) {
      subtitleFiles = await this.createSubtitleFiles(audioPath, segments);
    }

    onProgress?.(100);

    return {
      segments,
      subtitleFiles,
    };
  }

  async transcribeBatch(
    audioSegments: Array<{ path: string; startTime: number; duration: number }>,
    options: WhisperOptions = {},
    onProgress?: (completed: number, total: number) => void
  ): Promise<TranscriptionSegment[]> {
    const allSegments: TranscriptionSegment[] = [];

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];

      try {
        const result = await this.transcribe(segment.path, { ...options, generateSubtitleFiles: false });
        const adjusted = result.segments.map((item) => ({
          ...item,
          start: item.start + segment.startTime,
          end: item.end + segment.startTime,
        }));
        allSegments.push(...adjusted);
      } catch (error) {
        console.error(`转录段落 ${i} 失败:`, error);
        allSegments.push({
          id: uuidv4(),
          start: segment.startTime,
          end: segment.startTime + segment.duration,
          originalText: "[转录失败]",
          confidence: 0,
        });
      }

      onProgress?.(i + 1, audioSegments.length);
    }

    return allSegments.sort((a, b) => a.start - b.start);
  }

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

  getAvailableModels(): Array<{ name: string; size: string; description: string }> {
    return [
      { name: "tiny", size: "~39MB", description: "最小模型，速度最快但准确率较低" },
      { name: "base", size: "~142MB", description: "基础模型，平衡速度和准确率" },
      { name: "small", size: "~466MB", description: "小型模型，准确率较好" },
      { name: "medium", size: "~1.5GB", description: "中型模型，高准确率" },
      { name: "large-v3", size: "~2.9GB", description: "最新大型模型，最高准确率" },
    ];
  }

  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      await Promise.all(files.map((file) => fs.unlink(path.join(this.tempDir, file)).catch(() => {})));
    } catch (error) {
      console.error("清理临时文件失败:", error);
    }
  }

  private normalizeSegments(rawResult: any): TranscriptionSegment[] {
    const segments: TranscriptionSegment[] = [];

    if (Array.isArray(rawResult)) {
      for (const item of rawResult) {
        const start = this.normalizeTime(item.start ?? item.from ?? item.begin);
        const end = this.normalizeTime(item.end ?? item.to ?? item.finish);
        segments.push({
          id: uuidv4(),
          start,
          end: end >= start ? end : start,
          originalText: (item.speech ?? item.text ?? "").trim(),
          confidence: Number(item.confidence ?? 0.9),
        });
      }
      return segments;
    }

    if (rawResult && typeof rawResult === "object") {
      if (Array.isArray(rawResult.segments)) {
        for (const item of rawResult.segments) {
          const start = this.normalizeTime(item.start ?? item.from ?? item.begin);
          const end = this.normalizeTime(item.end ?? item.to ?? item.finish);
          segments.push({
            id: uuidv4(),
            start,
            end: end >= start ? end : start,
            originalText: (item.text ?? item.speech ?? "").trim(),
            confidence: Number(item.confidence ?? 0.9),
          });
        }
        return segments;
      }

      if (typeof rawResult.text === "string" && rawResult.text.trim()) {
        segments.push({
          id: uuidv4(),
          start: 0,
          end: 0,
          originalText: rawResult.text.trim(),
          confidence: 0.9,
        });
        return segments;
      }
    }

    if (typeof rawResult === "string" && rawResult.trim()) {
      segments.push({
        id: uuidv4(),
        start: 0,
        end: 0,
        originalText: rawResult.trim(),
        confidence: 0.9,
      });
      return segments;
    }

    return segments;
  }

  private normalizeTime(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return 0;

      const normalized = trimmed.replace(/,/g, ".");

      const direct = Number(normalized);
      if (!Number.isNaN(direct)) {
        return direct;
      }

      const parts = normalized.split(":");
      if (parts.length === 3) {
        const [h, m, s] = parts;
        const hours = Number(h);
        const minutes = Number(m);
        const seconds = Number(s);
        if (
          !Number.isNaN(hours) &&
          !Number.isNaN(minutes) &&
          !Number.isNaN(seconds)
        ) {
          return hours * 3600 + minutes * 60 + seconds;
        }
      } else if (parts.length === 2) {
        const [m, s] = parts;
        const minutes = Number(m);
        const seconds = Number(s);
        if (!Number.isNaN(minutes) && !Number.isNaN(seconds)) {
          return minutes * 60 + seconds;
        }
      }
    }

    return 0;
  }

  private async createSubtitleFiles(
    audioPath: string,
    segments: TranscriptionSegment[]
  ): Promise<TranscriptionResult["subtitleFiles"]> {
    if (segments.length === 0) {
      return undefined;
    }

    const baseName = path.basename(audioPath, path.extname(audioPath));
    const timestamp = Date.now();
    const targetBase = path.join(this.tempDir, `${baseName}_${timestamp}`);

    const subtitles = SubtitleGenerator.segmentsToSubtitles(segments);
    const srtPath = await SubtitleGenerator.saveSubtitle(subtitles, `${targetBase}.srt`, "srt");

    return {
      srt: srtPath,
    };
  }
}

export const whisperTranscriber = new WhisperTranscriber();
