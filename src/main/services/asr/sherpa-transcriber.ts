import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { AsrEngineId } from "../../../shared/constants";
import { DEFAULT_ASR_ENGINE } from "../../../shared/constants";
import type { TranscriptionSegment } from "../../../shared/types/video";
import { ffmpegProcessor } from "../ffmpeg/processor";
import {
  getAsrModelStatus,
  resolveFunAsrNanoPaths,
  resolveSenseVoicePaths,
} from "./model-paths";
import {
  buildSegmentsFromAsrResult,
  type RawAsrResult,
} from "./segment-builder";

// sherpa-onnx-node 无完整 TS 类型
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sherpaOnnx = require("sherpa-onnx-node");

export interface AsrTranscribeOptions {
  engine?: AsrEngineId;
  language?: string;
  /** 超过该秒数则切分再识别，默认 90 */
  chunkThresholdSec?: number;
  maxChunkSec?: number;
  numThreads?: number;
  provider?: "cpu" | "coreml" | "cuda";
}

export interface AsrTranscriptionResult {
  segments: TranscriptionSegment[];
  engine: AsrEngineId;
  language?: string;
  rawText?: string;
}

type OfflineRecognizer = {
  createStream: () => {
    acceptWaveform: (wave: { sampleRate: number; samples: Float32Array }) => void;
  };
  decode: (stream: unknown) => void;
  getResult: (stream: unknown) => RawAsrResult;
};

export class SherpaTranscriber {
  private recognizers = new Map<string, OfflineRecognizer>();
  private tempDir: string;

  constructor() {
    this.tempDir = path.join(os.tmpdir(), "video-translate-asr");
  }

  async isAvailable(engine: AsrEngineId = DEFAULT_ASR_ENGINE): Promise<boolean> {
    try {
      require.resolve("sherpa-onnx-node");
    } catch {
      return false;
    }

    if (engine === "sensevoice") {
      return Boolean(resolveSenseVoicePaths());
    }
    if (engine === "funasr-nano") {
      return Boolean(resolveFunAsrNanoPaths());
    }
    return false;
  }

  getStatus() {
    return getAsrModelStatus();
  }

  private getRecognizerKey(engine: AsrEngineId, language: string): string {
    return `${engine}:${language}`;
  }

  private createSenseVoiceRecognizer(
    language: string,
    numThreads: number,
    provider: string
  ): OfflineRecognizer {
    const paths = resolveSenseVoicePaths();
    if (!paths) {
      throw new Error(
        "SenseVoice 模型未找到。请将 sherpa-onnx SenseVoice 模型放到 models/asr/ 目录（见 models/asr/README.md）"
      );
    }

    const lang = this.normalizeSenseVoiceLanguage(language);
    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80,
      },
      modelConfig: {
        senseVoice: {
          model: paths.model,
          language: lang,
          useInverseTextNormalization: 1,
        },
        tokens: paths.tokens,
        numThreads,
        provider,
        debug: 0,
      },
    };

    return new sherpaOnnx.OfflineRecognizer(config);
  }

  private createFunAsrNanoRecognizer(
    numThreads: number,
    provider: string
  ): OfflineRecognizer {
    const paths = resolveFunAsrNanoPaths();
    if (!paths) {
      throw new Error(
        "Fun-ASR-Nano 模型未找到。请下载到 models/asr/ 目录（见 models/asr/README.md）"
      );
    }

    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80,
      },
      modelConfig: {
        funasrNano: {
          encoderAdaptor: paths.encoderAdaptor,
          llm: paths.llm,
          embedding: paths.embedding,
          tokenizer: paths.tokenizer,
        },
        tokens: "",
        numThreads,
        provider,
        debug: 0,
      },
    };

    return new sherpaOnnx.OfflineRecognizer(config);
  }

  private getOrCreateRecognizer(
    engine: AsrEngineId,
    language: string,
    numThreads: number,
    provider: string
  ): OfflineRecognizer {
    const key = this.getRecognizerKey(engine, language);
    const cached = this.recognizers.get(key);
    if (cached) return cached;

    const recognizer =
      engine === "funasr-nano"
        ? this.createFunAsrNanoRecognizer(numThreads, provider)
        : this.createSenseVoiceRecognizer(language, numThreads, provider);

    this.recognizers.set(key, recognizer);
    return recognizer;
  }

  private normalizeSenseVoiceLanguage(language: string): string {
    const map: Record<string, string> = {
      auto: "auto",
      zh: "zh",
      "zh-cn": "zh",
      "zh-tw": "zh",
      中文: "zh",
      chinese: "zh",
      en: "en",
      english: "en",
      ja: "ja",
      japanese: "ja",
      日本語: "ja",
      ko: "ko",
      korean: "ko",
      한국어: "ko",
      yue: "yue",
      cantonese: "yue",
      粤语: "yue",
    };
    const key = (language || "auto").toLowerCase();
    return map[key] || map[language] || "auto";
  }

  /**
   * Electron 禁用了 N-API external buffer。
   * 1) readWave 第二参 enableExternalBuffer=false，从原生侧直接分配普通 buffer
   * 2) 再拷贝到全新 ArrayBuffer，彻底避免 external / SharedArrayBuffer
   */
  private toOwnedFloat32(samples: Float32Array | ArrayLike<number>): Float32Array {
    const length =
      typeof (samples as Float32Array).length === "number"
        ? (samples as Float32Array).length
        : Array.from(samples as ArrayLike<number>).length;

    // 强制走独立 ArrayBuffer，不复用任何可能的 external 内存
    const ab = new ArrayBuffer(length * 4);
    const copy = new Float32Array(ab);
    if (samples instanceof Float32Array) {
      for (let i = 0; i < length; i++) {
        copy[i] = samples[i];
      }
    } else {
      for (let i = 0; i < length; i++) {
        copy[i] = Number((samples as ArrayLike<number>)[i] ?? 0);
      }
    }
    return copy;
  }

  private recognizeFile(
    recognizer: OfflineRecognizer,
    audioPath: string
  ): RawAsrResult {
    // enableExternalBuffer=false：关键 Electron 下 "External buffers are not allowed"
    const wave = sherpaOnnx.readWave(audioPath, /* enableExternalBuffer */ false);
    const samples = this.toOwnedFloat32(wave.samples);
    const stream = recognizer.createStream();
    stream.acceptWaveform({
      sampleRate: wave.sampleRate,
      samples,
    });
    recognizer.decode(stream);
    return recognizer.getResult(stream) as RawAsrResult;
  }

  async transcribe(
    audioPath: string,
    options: AsrTranscribeOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<AsrTranscriptionResult> {
    const engine = options.engine ?? DEFAULT_ASR_ENGINE;
    const language = options.language ?? "auto";
    const chunkThresholdSec = options.chunkThresholdSec ?? 90;
    const maxChunkSec = options.maxChunkSec ?? 45;
    const numThreads = options.numThreads ?? Math.min(4, os.cpus().length || 2);
    const provider = options.provider ?? "cpu";

    onProgress?.(5);

    if (!(await this.isAvailable(engine))) {
      // 自动回退
      if (engine !== "sensevoice" && (await this.isAvailable("sensevoice"))) {
        return this.transcribe(
          audioPath,
          { ...options, engine: "sensevoice" },
          onProgress
        );
      }
      throw new Error(
        `ASR 引擎 ${engine} 不可用：请确认已安装 sherpa-onnx-node 且模型文件存在`
      );
    }

    await fs.mkdir(this.tempDir, { recursive: true });

    const duration = await ffmpegProcessor.getMediaDuration(audioPath);
    onProgress?.(15);

    const recognizer = this.getOrCreateRecognizer(
      engine,
      language,
      numThreads,
      provider
    );

    let segments: TranscriptionSegment[] = [];
    let rawText = "";
    let detectedLang: string | undefined;

    if (duration <= chunkThresholdSec) {
      onProgress?.(30);
      const result = this.recognizeFile(recognizer, audioPath);
      onProgress?.(80);
      segments = buildSegmentsFromAsrResult(result);
      rawText = result.text ?? "";
      detectedLang = result.lang;
    } else {
      // 静音切分 + 强制 maxChunkSec，避免超长段一次送入原生 ASR 导致进程崩溃
      let chunks = await ffmpegProcessor.segmentAudio(
        audioPath,
        maxChunkSec,
        -40
      );

      // 安全网：任何仍超长的段再次整轨固定时长切分（并清理上一轮临时文件）
      const safeMax = maxChunkSec * 1.25;
      const oversized = chunks.filter((c) => c.duration > safeMax);
      if (oversized.length > 0) {
        console.warn(
          `ASR: ${oversized.length} 个分段超过 ${safeMax}s，重新固定时长切分`
        );
        await Promise.all(
          chunks.map((c) => fs.unlink(c.path).catch(() => {}))
        );
        chunks = await ffmpegProcessor.segmentAudio(
          audioPath,
          maxChunkSec,
          // 极低阈值弱化静音依赖，最终仍强制按 maxChunkSec 切
          -90
        );
      }

      console.log(
        `ASR: 共 ${chunks.length} 段，最长 ${Math.max(...chunks.map((c) => c.duration), 0).toFixed(1)}s`
      );
      onProgress?.(25);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        try {
          // 极端兜底：单段仍过长则跳过，避免原生层 OOM 拖垮整个 Electron
          if (chunk.duration > maxChunkSec * 2) {
            console.error(
              `ASR 分段 ${i} 过长 (${chunk.duration.toFixed(1)}s)，跳过以防进程崩溃`
            );
            continue;
          }

          const result = this.recognizeFile(recognizer, chunk.path);
          const part = buildSegmentsFromAsrResult(result, {
            timeOffset: chunk.startTime,
          });
          segments.push(...part);
          if (result.text) {
            rawText += `${result.text} `;
          }
          if (!detectedLang && result.lang) {
            detectedLang = result.lang;
          }
        } catch (error) {
          console.error(`ASR 分段 ${i} 失败:`, error);
        } finally {
          await fs.unlink(chunk.path).catch(() => {});
        }

        onProgress?.(25 + ((i + 1) / chunks.length) * 60);
      }

      segments.sort((a, b) => a.start - b.start);
    }

    if (segments.length === 0 && rawText.trim()) {
      segments = [
        {
          id: uuidv4(),
          start: 0,
          end: Math.max(duration, 1),
          originalText: rawText.trim(),
          confidence: 0.8,
        },
      ];
    }

    // 清理 SenseVoice 可能带的特殊标签
    segments = segments
      .map((s) => ({
        ...s,
        originalText: cleanAsrText(s.originalText),
      }))
      .filter((s) => s.originalText.length > 0);

    onProgress?.(100);

    return {
      segments,
      engine,
      language: detectedLang || language,
      rawText: rawText.trim(),
    };
  }

  cleanup(): void {
    this.recognizers.clear();
  }
}

function cleanAsrText(text: string): string {
  return text
    .replace(/<\|[^|>]+\|>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const sherpaTranscriber = new SherpaTranscriber();
