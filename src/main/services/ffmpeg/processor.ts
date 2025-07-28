import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export interface VideoInfo {
  duration: number;
  format: string;
  width: number;
  height: number;
  frameRate: number;
  bitRate: number;
  audioCodec: string;
  videoCodec: string;
}

export interface AudioSegment {
  path: string;
  startTime: number;
  duration: number;
}

export class FFmpegProcessor {
  private ffmpegPath: string;
  private ffprobePath: string;
  private tempDir: string;

  constructor(ffmpegPath = "ffmpeg", ffprobePath = "ffprobe") {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.tempDir = path.join(os.tmpdir(), "video-translate");
    this.ensureTempDir();
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error("Failed to create temp directory:", error);
    }
  }

  /**
   * 检查 FFmpeg 是否可用
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
            duration: parseFloat(data.format.duration) || 0,
            format: data.format.format_name || "unknown",
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            frameRate: this.parseFrameRate(videoStream.r_frame_rate) || 0,
            bitRate: parseInt(data.format.bit_rate) || 0,
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

  private parseFrameRate(rFrameRate: string): number {
    if (!rFrameRate || rFrameRate === "0/0") return 0;

    const parts = rFrameRate.split("/");
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      return denominator !== 0 ? numerator / denominator : 0;
    }

    return parseFloat(rFrameRate) || 0;
  }

  /**
   * 提取音频轨道
   */
  async extractAudio(
    videoPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const audioPath =
      outputPath || path.join(this.tempDir, `audio_${Date.now()}.wav`);

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
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;

            // 需要视频总时长来计算百分比，这里先简化处理
            // 实际使用时应该先获取视频信息
            const progress = Math.min(currentTime / 100, 1) * 100; // 简化计算
            onProgress(progress);
          }
        }
      });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Audio extraction failed: ${error}`));
          return;
        }

        resolve(audioPath);
      });
    });
  }

  /**
   * 根据静音区间切分音频
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

    return segments;
  }

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
        let match;
        let currentSilence: { start?: number; end?: number } = {};

        while ((match = silenceRegex.exec(output)) !== null) {
          if (match[1]) {
            currentSilence.start = parseFloat(match[1]);
          } else if (match[2]) {
            currentSilence.end = parseFloat(match[2]);
            if (currentSilence.start !== undefined) {
              silences.push({
                start: currentSilence.start,
                end: currentSilence.end,
              });
              currentSilence = {};
            }
          }
        }

        resolve(silences);
      });
    });
  }

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
            const hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
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
