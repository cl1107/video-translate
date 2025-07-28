import { promises as fs } from "fs";
import { SubtitleEntry, TranscriptionSegment } from "../../shared/types/video";

export class SubtitleGenerator {
  /**
   * 将转录段落转换为字幕条目
   */
  static segmentsToSubtitles(
    segments: TranscriptionSegment[]
  ): SubtitleEntry[] {
    return segments.map((segment, index) => ({
      index: index + 1,
      start: this.formatTime(segment.start, "srt"),
      end: this.formatTime(segment.end, "srt"),
      text: segment.translatedText || segment.originalText,
    }));
  }

  /**
   * 格式化时间戳
   */
  static formatTime(seconds: number, format: "srt" | "vtt" = "srt"): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    if (format === "vtt") {
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${milliseconds
        .toString()
        .padStart(3, "0")}`;
    } else {
      // SRT 格式
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${milliseconds
        .toString()
        .padStart(3, "0")}`;
    }
  }

  /**
   * 生成 SRT 格式字幕
   */
  static generateSRT(subtitles: SubtitleEntry[]): string {
    return subtitles
      .map((subtitle) => {
        return `${subtitle.index}\n${subtitle.start} --> ${subtitle.end}\n${subtitle.text}\n`;
      })
      .join("\n");
  }

  /**
   * 生成 VTT 格式字幕
   */
  static generateVTT(subtitles: SubtitleEntry[]): string {
    const header = "WEBVTT\n\n";
    const content = subtitles
      .map((subtitle) => {
        const start = subtitle.start.replace(",", ".");
        const end = subtitle.end.replace(",", ".");
        return `${start} --> ${end}\n${subtitle.text}\n`;
      })
      .join("\n");

    return header + content;
  }

  /**
   * 生成纯文本格式
   */
  static generateTXT(subtitles: SubtitleEntry[]): string {
    return subtitles.map((subtitle) => subtitle.text).join("\n\n");
  }

  /**
   * 保存字幕文件
   */
  static async saveSubtitle(
    subtitles: SubtitleEntry[],
    outputPath: string,
    format: "srt" | "vtt" | "txt" = "srt"
  ): Promise<string> {
    let content: string;
    let extension: string;

    switch (format) {
      case "vtt":
        content = this.generateVTT(subtitles);
        extension = ".vtt";
        break;
      case "txt":
        content = this.generateTXT(subtitles);
        extension = ".txt";
        break;
      default:
        content = this.generateSRT(subtitles);
        extension = ".srt";
    }

    const finalPath = outputPath.endsWith(extension)
      ? outputPath
      : outputPath.replace(/\.[^.]+$/, extension);

    await fs.writeFile(finalPath, content, "utf-8");
    return finalPath;
  }

  /**
   * 合并相邻的短字幕
   */
  static mergeShortSubtitles(
    subtitles: SubtitleEntry[],
    minDuration = 2, // 最小持续时间（秒）
    maxLength = 100 // 最大字符数
  ): SubtitleEntry[] {
    if (subtitles.length === 0) return [];

    const merged: SubtitleEntry[] = [];
    let current = { ...subtitles[0] };

    for (let i = 1; i < subtitles.length; i++) {
      const next = subtitles[i];
      const currentDuration = this.parseDuration(current.start, current.end);
      const gap = this.parseTime(next.start) - this.parseTime(current.end);

      // 如果当前字幕太短，且与下一个字幕间隔很小，且合并后不会太长
      if (
        currentDuration < minDuration &&
        gap < 1 && // 间隔小于1秒
        (current.text + " " + next.text).length <= maxLength
      ) {
        // 合并字幕
        current.end = next.end;
        current.text += " " + next.text;
      } else {
        // 添加当前字幕，开始新的字幕
        merged.push(current);
        current = { ...next, index: merged.length + 1 };
      }
    }

    // 添加最后一个字幕
    merged.push(current);

    // 重新编号
    return merged.map((subtitle, index) => ({
      ...subtitle,
      index: index + 1,
    }));
  }

  /**
   * 分割过长的字幕
   */
  static splitLongSubtitles(
    subtitles: SubtitleEntry[],
    maxLength = 80, // 最大字符数
    maxDuration = 5 // 最大持续时间（秒）
  ): SubtitleEntry[] {
    const result: SubtitleEntry[] = [];

    for (const subtitle of subtitles) {
      const duration = this.parseDuration(subtitle.start, subtitle.end);

      if (subtitle.text.length <= maxLength && duration <= maxDuration) {
        result.push(subtitle);
        continue;
      }

      // 需要分割
      const words = subtitle.text.split(" ");
      const chunks: string[] = [];
      let currentChunk = "";

      for (const word of words) {
        if ((currentChunk + " " + word).length <= maxLength) {
          currentChunk = currentChunk ? currentChunk + " " + word : word;
        } else {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = word;
          } else {
            // 单个词就超长，强制分割
            chunks.push(word);
          }
        }
      }

      if (currentChunk) {
        chunks.push(currentChunk);
      }

      // 为每个分片分配时间
      const chunkDuration = duration / chunks.length;
      const startTime = this.parseTime(subtitle.start);

      chunks.forEach((chunk, index) => {
        const chunkStart = startTime + index * chunkDuration;
        const chunkEnd = startTime + (index + 1) * chunkDuration;

        result.push({
          index: 0, // 稍后重新编号
          start: this.formatTime(chunkStart, "srt"),
          end: this.formatTime(chunkEnd, "srt"),
          text: chunk,
        });
      });
    }

    // 重新编号
    return result.map((subtitle, index) => ({
      ...subtitle,
      index: index + 1,
    }));
  }

  /**
   * 解析时间字符串为秒数
   */
  private static parseTime(timeStr: string): number {
    const parts = timeStr.replace(",", ".").split(":");
    const hours = parseInt(parts[0]);
    const minutes = parseInt(parts[1]);
    const seconds = parseFloat(parts[2]);

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * 计算两个时间点之间的持续时间
   */
  private static parseDuration(start: string, end: string): number {
    return this.parseTime(end) - this.parseTime(start);
  }

  /**
   * 优化字幕时间轴，确保没有重叠
   */
  static optimizeTimeline(subtitles: SubtitleEntry[]): SubtitleEntry[] {
    if (subtitles.length === 0) return [];

    const optimized = [...subtitles];

    for (let i = 0; i < optimized.length - 1; i++) {
      const current = optimized[i];
      const next = optimized[i + 1];

      const currentEnd = this.parseTime(current.end);
      const nextStart = this.parseTime(next.start);

      // 如果有重叠，调整当前字幕的结束时间
      if (currentEnd > nextStart) {
        const gap = 0.1; // 保持100毫秒的间隔
        current.end = this.formatTime(nextStart - gap, "srt");
      }
    }

    return optimized;
  }

  /**
   * 验证字幕格式
   */
  static validateSubtitles(subtitles: SubtitleEntry[]): string[] {
    const errors: string[] = [];

    for (let i = 0; i < subtitles.length; i++) {
      const subtitle = subtitles[i];

      // 检查时间格式
      if (!this.isValidTimeFormat(subtitle.start)) {
        errors.push(`字幕 ${subtitle.index}: 开始时间格式无效`);
      }

      if (!this.isValidTimeFormat(subtitle.end)) {
        errors.push(`字幕 ${subtitle.index}: 结束时间格式无效`);
      }

      // 检查时间逻辑
      if (this.parseTime(subtitle.start) >= this.parseTime(subtitle.end)) {
        errors.push(`字幕 ${subtitle.index}: 开始时间不能晚于或等于结束时间`);
      }

      // 检查文本内容
      if (!subtitle.text.trim()) {
        errors.push(`字幕 ${subtitle.index}: 文本内容为空`);
      }

      // 检查与下一个字幕的时间关系
      if (i < subtitles.length - 1) {
        const nextSubtitle = subtitles[i + 1];
        if (this.parseTime(subtitle.end) > this.parseTime(nextSubtitle.start)) {
          errors.push(
            `字幕 ${subtitle.index} 与 ${nextSubtitle.index} 时间重叠`
          );
        }
      }
    }

    return errors;
  }

  /**
   * 检查时间格式是否有效
   */
  private static isValidTimeFormat(timeStr: string): boolean {
    const srtPattern = /^\d{2}:\d{2}:\d{2},\d{3}$/;
    const vttPattern = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

    return srtPattern.test(timeStr) || vttPattern.test(timeStr);
  }
}
