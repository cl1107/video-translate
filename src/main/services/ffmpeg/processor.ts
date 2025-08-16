import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 视频文件信息接口
 */
export interface VideoInfo {
  /** 视频时长（秒） */
  duration: number;
  /** 视频格式 */
  format: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 帧率（FPS） */
  frameRate: number;
  /** 比特率（bps） */
  bitRate: number;
  /** 音频编码器 */
  audioCodec: string;
  /** 视频编码器 */
  videoCodec: string;
}

/**
 * 音频段落信息接口
 */
export interface AudioSegment {
  /** 音频文件路径 */
  path: string;
  /** 开始时间（秒） */
  startTime: number;
  /** 段落时长（秒） */
  duration: number;
}

export class FFmpegProcessor {
  private ffmpegPath: string;
  private ffprobePath: string;
  private tempDir: string;

/**
 * FFmpeg处理器构造函数
 * @param ffmpegPath - FFmpeg可执行文件路径（默认：ffmpeg）
 * @param ffprobePath - FFprobe可执行文件路径（默认：ffprobe）
 */
  constructor(ffmpegPath = "ffmpeg", ffprobePath = "ffprobe") {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.tempDir = path.join(os.tmpdir(), "video-translate");
    this.ensureTempDir();
  }

/**
 * 确保临时目录存在且可写
 * @throws 当目录创建失败或不可写时抛出错误
 */
  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      console.log(`Temp directory ensured: ${this.tempDir}`);
      
      // 验证目录是否可写
      await fs.access(this.tempDir, fs.constants.W_OK);
    } catch (error) {
      console.error("Failed to create or access temp directory:", error);
      console.error(`Temp directory path: ${this.tempDir}`);
      throw error;
    }
  }

  /**
   * 检查 FFmpeg 是否可用
   */
/**
 * 检查FFmpeg是否可用
 * @returns 返回true表示FFmpeg可用，false表示不可用
 */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn(this.ffmpegPath, ["-version"]);

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
   * 检查 FFprobe 是否可用
   */
/**
 * 检查FFprobe是否可用
 * @returns 返回true表示FFprobe可用，false表示不可用
 */
  async isFFprobeAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const process = spawn(this.ffprobePath, ["-version"]);

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
   * 获取视频文件信息
   */
/**
 * 获取视频文件的详细信息
 * @param videoPath - 视频文件路径
 * @returns 返回包含视频详细信息的对象
 * @throws 当FFprobe不可用或视频解析失败时抛出错误
 */
  async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    // 首先检查 ffprobe 是否可用
    const isFFprobeAvailable = await this.isFFprobeAvailable();
    if (!isFFprobeAvailable) {
      throw new Error(
        "FFprobe 不可用。请确保已安装 FFmpeg 并且 ffprobe 命令在系统 PATH 中。\n" +
          "安装方法：\n" +
          "- macOS: brew install ffmpeg\n" +
          "- Ubuntu/Debian: sudo apt install ffmpeg\n" +
          "- Windows: 从 https://ffmpeg.org/download.html 下载并添加到 PATH"
      );
    }

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoPath,
        "-hide_banner",
        "-show_format",
        "-show_streams",
        "-select_streams",
        "v:0",
        "-of",
        "json",
      ];

      const process = spawn(this.ffprobePath, args);
      let output = "";
      let error = "";

      process.stdout.on("data", (data) => {
        output += data.toString();
      });

      process.stderr.on("data", (data) => {
        error += data.toString();
      });

      process.on("error", (err) => {
        reject(new Error(`FFprobe 执行失败: ${err.message}`));
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${error}`));
          return;
        }

        try {
          const data = JSON.parse(output);
          const videoStream = data.streams.find(
            (s: any) => s.codec_type === "video"
          );
          const audioStream = data.streams.find(
            (s: any) => s.codec_type === "audio"
          );

          if (!videoStream) {
            reject(new Error("No video stream found"));
            return;
          }

          const info: VideoInfo = {
            duration: Number.parseFloat(data.format.duration) || 0,
            format: data.format.format_name || "unknown",
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            frameRate: this.parseFrameRate(videoStream.r_frame_rate) || 0,
            bitRate: Number.parseInt(data.format.bit_rate) || 0,
            audioCodec: audioStream?.codec_name || "none",
            videoCodec: videoStream.codec_name || "unknown",
          };

          resolve(info);
        } catch (parseError) {
          reject(
            new Error(`Failed to parse video info: ${parseError.message}`)
          );
        }
      });
    });
  }

/**
 * 解析帧率字符串（如 "30/1"）为数值
 * @param rFrameRate - FFmpeg返回的帧率字符串
 * @returns 返回帧率的数值
 */
  private parseFrameRate(rFrameRate: string): number {
    if (!rFrameRate || rFrameRate === "0/0") return 0;

    const parts = rFrameRate.split("/");
    if (parts.length === 2) {
      const numerator = Number.parseFloat(parts[0]);
      const denominator = Number.parseFloat(parts[1]);
      return denominator !== 0 ? numerator / denominator : 0;
    }

    return Number.parseFloat(rFrameRate) || 0;
  }

  /**
   * 获取媒体文件时长（支持音频和视频文件）
   */
/**
 * 获取媒体文件时长（支持音频和视频文件）
 * @param mediaPath - 媒体文件路径
 * @returns 返回媒体文件时长（秒）
 * @throws 当文件解析失败时抛出错误
 */
  async getMediaDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        mediaPath,
        "-hide_banner",
        "-show_format",
        "-of",
        "json",
      ];
      const process = spawn(this.ffprobePath, args);
      let output = "";
      let error = "";
      process.stdout.on("data", (data) => {
        output += data.toString();
      });
      process.stderr.on("data", (data) => {
        error += data.toString();
      });
      process.on("error", (err) => {
        reject(new Error(`FFprobe 执行失败: ${err.message}`));
      });
      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${error}`));
          return;
        }
        try {
          const data = JSON.parse(output);
          const duration = Number.parseFloat(data.format.duration) || 0;
          resolve(duration);
        } catch (parseError) {
          reject(
            new Error(`Failed to parse media duration: ${parseError.message}`)
          );
        }
      });
    });
  }

  /**
   * 提取音频轨道
   */
/**
 * 从视频文件中提取音频轨道
 * @param videoPath - 视频文件路径
 * @param outputPath - 输出音频文件路径（可选，默认为临时文件）
 * @param onProgress - 进度回调函数（可选）
 * @returns 返回提取的音频文件路径
 * @throws 当音频提取失败时抛出错误
 */
  async extractAudio(
    videoPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    // 确保临时目录存在
    await this.ensureTempDir();
    
    const audioPath =
      outputPath || path.join(this.tempDir, `audio_${Date.now()}.wav`);
    
    console.log('Starting audio extraction:');
    console.log(`  Input: ${videoPath}`);
    console.log(`  Output: ${audioPath}`);
    console.log(`  Temp dir: ${this.tempDir}`);

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoPath,
        "-vn", // 不包含视频
        "-acodec",
        "pcm_s16le", // 16位 PCM 编码
        "-ar",
        "16000", // 16kHz 采样率，适合语音识别
        "-ac",
        "1", // 单声道
        "-y", // 覆盖输出文件
        audioPath,
      ];

      const process = spawn(this.ffmpegPath, args);
      let error = "";

      process.stderr.on("data", (data) => {
        const output = data.toString();
        error += output;

        // 解析进度信息
        if (onProgress) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch) {
            const hours = Number.parseInt(timeMatch[1]);
            const minutes = Number.parseInt(timeMatch[2]);
            const seconds = Number.parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;

            // 需要视频总时长来计算百分比，这里先简化处理
            // 实际使用时应该先获取视频信息
            const progress = Math.min(currentTime / 100, 1) * 100; // 简化计算
            onProgress(progress);
          }
        }
      });

      process.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`Audio extraction failed: ${error}`));
          return;
        }

        // 验证文件是否真的被创建
        try {
          await fs.access(audioPath);
          const stats = await fs.stat(audioPath);
          if (stats.size === 0) {
            reject(new Error(`Audio file was created but is empty: ${audioPath}`));
            return;
          }
          console.log(`Audio extraction successful: ${audioPath} (${stats.size} bytes)`);
          resolve(audioPath);
        } catch (fileError) {
          reject(new Error(`Audio file was not created or is not accessible: ${audioPath}. Error: ${fileError}`));
        }
      });
    });
  }

  /**
   * 根据静音区间切分音频
   */
/**
 * 根据静音区间切分音频为多个段落
 * @param audioPath - 音频文件路径
 * @param maxSegmentLength - 最大段落长度（秒，默认：30）
 * @param silenceThreshold - 静音阈值（dB，默认：-40）
 * @returns 返回音频段落数组
 */
  async segmentAudio(
    audioPath: string,
    maxSegmentLength = 30, // 最大段落长度（秒）
    silenceThreshold = -40 // 静音阈值（dB）
  ): Promise<AudioSegment[]> {
    const segments: AudioSegment[] = [];

    // 首先检测静音区间
    const silenceIntervals = await this.detectSilence(
      audioPath,
      silenceThreshold
    );

    // 根据静音区间和最大长度切分
    let currentStart = 0;
    let segmentIndex = 0;

    for (const silence of silenceIntervals) {
      const segmentDuration = silence.start - currentStart;

      if (segmentDuration >= maxSegmentLength) {
        // 如果段落太长，强制在最大长度处切分
        let segmentStart = currentStart;
        while (segmentStart < silence.start) {
          const segmentEnd = Math.min(
            segmentStart + maxSegmentLength,
            silence.start
          );
          const segmentPath = await this.extractAudioSegment(
            audioPath,
            segmentStart,
            segmentEnd,
            segmentIndex++
          );

          segments.push({
            path: segmentPath,
            startTime: segmentStart,
            duration: segmentEnd - segmentStart,
          });

          segmentStart = segmentEnd;
        }
      } else if (segmentDuration > 0.5) {
        // 忽略过短的段落
        const segmentPath = await this.extractAudioSegment(
          audioPath,
          currentStart,
          silence.start,
          segmentIndex++
        );

        segments.push({
          path: segmentPath,
          startTime: currentStart,
          duration: silence.start - currentStart,
        });
      }

      currentStart = silence.end;
    }

    // 处理最后一个静音区间到音频末尾的剩余部分
    const audioDuration = await this.getMediaDuration(audioPath);
    if (currentStart < audioDuration && (audioDuration - currentStart) > 0.5) {
      console.log(`Creating final segment from ${currentStart}s to end (${audioDuration}s)`);
      const segmentPath = await this.extractAudioSegment(
        audioPath,
        currentStart,
        -1,
        segmentIndex++
      );
      segments.push({
        path: segmentPath,
        startTime: currentStart,
        duration: audioDuration - currentStart,
      });
    }

    // 如果没有静音区间或者还有剩余音频，将整个音频作为一个段落
    if (segments.length === 0) {
      console.log("No silence detected or no segments created, creating single segment for entire audio");
      const segmentPath = await this.extractAudioSegment(
        audioPath,
        0,
        -1, // -1 表示到文件末尾
        segmentIndex++
      );
      segments.push({
        path: segmentPath,
        startTime: 0,
        duration: await this.getMediaDuration(audioPath),
      });
    }

    console.log(`Audio segmentation complete: ${segments.length} segments created`);
    return segments;
  }

/**
 * 检测音频中的静音区间
 * @param audioPath - 音频文件路径
 * @param threshold - 静音阈值（dB）
 * @returns 返回静音区间数组，每个区间包含开始和结束时间
 */
  private async detectSilence(
    audioPath: string,
    threshold: number
  ): Promise<Array<{ start: number; end: number }>> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        audioPath,
        "-af",
        `silencedetect=noise=${threshold}dB:d=0.5`,
        "-f",
        "null",
        "-",
      ];

      const process = spawn(this.ffmpegPath, args);
      let output = "";

      process.stderr.on("data", (data) => {
        output += data.toString();
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error("Silence detection failed"));
          return;
        }

        const silences: Array<{ start: number; end: number }> = [];
        const silenceRegex = /silence_start: ([\d.]+)|silence_end: ([\d.]+)/g;
        let match: RegExpExecArray | null;
        let currentSilence: { start?: number; end?: number } = {};

        match = silenceRegex.exec(output);
        while (match !== null) {
          if (match[1]) {
            currentSilence.start = Number.parseFloat(match[1]);
          } else if (match[2]) {
            currentSilence.end = Number.parseFloat(match[2]);
            if (currentSilence.start !== undefined) {
              silences.push({
                start: currentSilence.start,
                end: currentSilence.end,
              });
              currentSilence = {};
            }
          }
          match = silenceRegex.exec(output);
        }

        resolve(silences);
      });
    });
  }

/**
 * 提取音频的指定时间段作为单独文件
 * @param audioPath - 源音频文件路径
 * @param start - 开始时间（秒）
 * @param end - 结束时间（秒，-1表示到文件末尾）
 * @param index - 段落索引
 * @returns 返回提取的音频段落文件路径
 */
  private async extractAudioSegment(
    audioPath: string,
    start: number,
    end: number,
    index: number
  ): Promise<string> {
    const segmentPath = path.join(
      this.tempDir,
      `segment_${index}_${Date.now()}.wav`
    );

    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        audioPath,
        "-ss",
        start.toString(),
        "-t",
        (end - start).toString(),
        "-acodec",
        "copy",
        "-y",
        segmentPath,
      ];

      const process = spawn(this.ffmpegPath, args);
      let error = "";

      process.stderr.on("data", (data) => {
        error += data.toString();
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Segment extraction failed: ${error}`));
          return;
        }

        resolve(segmentPath);
      });
    });
  }

  /**
   * 合成字幕到视频
   */
/**
 * 将字幕文件烧录到视频中（硬字幕）
 * @param videoPath - 源视频文件路径
 * @param subtitlePath - 字幕文件路径
 * @param outputPath - 输出视频文件路径
 * @param onProgress - 进度回调函数（可选）
 * @returns 返回烧录字幕后的视频文件路径
 * @throws 当字幕烧录失败时抛出错误
 */
  async burnSubtitles(
    videoPath: string,
    subtitlePath: string,
    outputPath: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-i",
        videoPath,
        "-vf",
        `subtitles=${subtitlePath}`,
        "-c:a",
        "copy",
        "-y",
        outputPath,
      ];

      const process = spawn(this.ffmpegPath, args);
      let error = "";

      process.stderr.on("data", (data) => {
        const output = data.toString();
        error += output;

        if (onProgress) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch) {
            const hours = Number.parseInt(timeMatch[1]);
            const minutes = Number.parseInt(timeMatch[2]);
            const seconds = Number.parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;

            // 简化的进度计算
            const progress = Math.min(currentTime / 100, 1) * 100;
            onProgress(progress);
          }
        }
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Subtitle burning failed: ${error}`));
          return;
        }

        resolve(outputPath);
      });
    });
  }

  /**
   * 清理临时文件
   */
/**
 * 清理所有临时文件
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
      console.error("Cleanup failed:", error);
    }
  }
}

// 单例实例
export const ffmpegProcessor = new FFmpegProcessor();
