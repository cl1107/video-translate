import type { TranscriptionSegment } from "../../../shared/types/video";

/**
 * 分句配置接口
 */
export interface SegmentMergeOptions {
  /** 基于时间间隔的分句阈值（秒） */
  timeThreshold?: number;
  /** 基于文本长度的分句阈值（字符数） */
  lengthThreshold?: number;
  /** 基于标点符号的分句模式 */
  punctuationMode?: "strict" | "relaxed";
  /** 最小分句时长（秒） */
  minSegmentDuration?: number;
  /** 最大分句时长（秒） */
  maxSegmentDuration?: number;
  /** 是否合并标点符号到前一个段落 */
  mergePunctuation?: boolean;
  /** 是否移除空段落 */
  removeEmptySegments?: boolean;
}

/**
 * 分句策略枚举
 */
export enum MergeStrategy {
  /** 基于时间间隔 */
  TIME_BASED = "time-based",
  /** 基于标点符号 */
  PUNCTUATION_BASED = "punctuation-based",
  /** 混合策略（时间+标点） */
  HYBRID = "hybrid",
  /** 基于文本长度 */
  LENGTH_BASED = "length-based",
}

/**
 * 分句器类
 * 将 Whisper 返回的细粒度字符级别数据合并为更有意义的句子
 */
export class SegmentMerger {
  private defaultOptions: Required<SegmentMergeOptions> = {
    timeThreshold: 1.5, // 1.5秒间隔
    lengthThreshold: 50, // 50个字符
    punctuationMode: "relaxed", // 宽松模式
    minSegmentDuration: 0.5, // 最小0.5秒
    maxSegmentDuration: 10, // 最大10秒
    mergePunctuation: true, // 合并标点到前一段落
    removeEmptySegments: true, // 移除空段落
  };

  /**
   * 合并转录段落
   * @param segments - 原始转录段落
   * @param options - 分句选项
   * @param strategy - 分句策略
   * @returns 合并后的段落
   */
  mergeSegments(
    segments: TranscriptionSegment[],
    options: SegmentMergeOptions = {},
    strategy: MergeStrategy = MergeStrategy.HYBRID
  ): TranscriptionSegment[] {
    const mergedOptions = { ...this.defaultOptions, ...options };
    
    if (!segments || segments.length === 0) {
      return [];
    }

    // 预处理：清理和排序
    let processedSegments = this.preprocessSegments(segments, mergedOptions);

    // 根据策略合并
    switch (strategy) {
      case MergeStrategy.TIME_BASED:
        processedSegments = this.mergeByTime(processedSegments, mergedOptions);
        break;
      case MergeStrategy.PUNCTUATION_BASED:
        processedSegments = this.mergeByPunctuation(processedSegments, mergedOptions);
        break;
      case MergeStrategy.LENGTH_BASED:
        processedSegments = this.mergeByLength(processedSegments, mergedOptions);
        break;
      default:
        processedSegments = this.mergeHybrid(processedSegments, mergedOptions);
        break;
    }

    return processedSegments;
  }

  /**
   * 预处理段落
   */
  private preprocessSegments(
    segments: TranscriptionSegment[],
    options: Required<SegmentMergeOptions>
  ): TranscriptionSegment[] {
    let processed = [...segments];

    // 按时间排序
    processed.sort((a, b) => a.start - b.start);

    // 移除空段落
    if (options.removeEmptySegments) {
      processed = processed.filter(segment => 
        segment.originalText && segment.originalText.trim().length > 0
      );
    }

    return processed;
  }

  /**
   * 基于时间间隔合并
   */
  private mergeByTime(
    segments: TranscriptionSegment[],
    options: Required<SegmentMergeOptions>
  ): TranscriptionSegment[] {
    const merged: TranscriptionSegment[] = [];
    let currentSegment: TranscriptionSegment | null = null;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const timeGap = segment.start - currentSegment.end;
      
      // 如果时间间隔小于阈值，且合并后不超过最大时长，则合并
      if (timeGap <= options.timeThreshold && 
          (segment.end - currentSegment.start) <= options.maxSegmentDuration) {
        currentSegment.end = segment.end;
        currentSegment.originalText += segment.originalText;
        // 取平均置信度
        currentSegment.confidence = (currentSegment.confidence + segment.confidence) / 2;
      } else {
        // 检查是否满足最小时长要求
        if (currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
          merged.push(currentSegment);
        }
        currentSegment = { ...segment };
      }
    }

    // 添加最后一个段落
    if (currentSegment && currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
      merged.push(currentSegment);
    }

    return merged;
  }

  /**
   * 基于标点符号合并
   */
  private mergeByPunctuation(
    segments: TranscriptionSegment[],
    options: Required<SegmentMergeOptions>
  ): TranscriptionSegment[] {
    const merged: TranscriptionSegment[] = [];
    let currentSegment: TranscriptionSegment | null = null;

    // 定义句子结束标点
    const sentenceEndings = options.punctuationMode === "strict" 
      ? /[。！？.!?]/ 
      : /[。！？.!?，,、]/;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const text = segment.originalText;
      const hasSentenceEnding = sentenceEndings.test(text);
      
      currentSegment.end = segment.end;
      currentSegment.originalText += text;
      currentSegment.confidence = (currentSegment.confidence + segment.confidence) / 2;

      // 如果遇到句子结束标点，且满足最小时长要求，则结束当前段落
      if (hasSentenceEnding && 
          currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
        merged.push(currentSegment);
        currentSegment = null;
      }
    }

    // 添加最后一个段落
    if (currentSegment && currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
      merged.push(currentSegment);
    }

    return merged;
  }

  /**
   * 基于文本长度合并
   */
  private mergeByLength(
    segments: TranscriptionSegment[],
    options: Required<SegmentMergeOptions>
  ): TranscriptionSegment[] {
    const merged: TranscriptionSegment[] = [];
    let currentSegment: TranscriptionSegment | null = null;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const combinedLength = currentSegment.originalText.length + segment.originalText.length;
      const timeGap = segment.start - currentSegment.end;
      
      // 如果文本长度未超过阈值，时间间隔合理，且合并后不超过最大时长，则合并
      if (combinedLength <= options.lengthThreshold && 
          timeGap <= options.timeThreshold &&
          (segment.end - currentSegment.start) <= options.maxSegmentDuration) {
        currentSegment.end = segment.end;
        currentSegment.originalText += segment.originalText;
        currentSegment.confidence = (currentSegment.confidence + segment.confidence) / 2;
      } else {
        // 检查是否满足最小时长要求
        if (currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
          merged.push(currentSegment);
        }
        currentSegment = { ...segment };
      }
    }

    // 添加最后一个段落
    if (currentSegment && currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
      merged.push(currentSegment);
    }

    return merged;
  }

  /**
   * 混合策略合并（时间+标点+长度）
   */
  private mergeHybrid(
    segments: TranscriptionSegment[],
    options: Required<SegmentMergeOptions>
  ): TranscriptionSegment[] {
    const merged: TranscriptionSegment[] = [];
    let currentSegment: TranscriptionSegment | null = null;

    // 定义句子结束标点
    const sentenceEndings = options.punctuationMode === "strict" 
      ? /[。！？.!?]/ 
      : /[。！？.!?，,、]/;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const text = segment.originalText;
      const timeGap = segment.start - currentSegment.end;
      const combinedLength = currentSegment.originalText.length + text.length;
      const hasSentenceEnding = sentenceEndings.test(text);
      
      // 计算合并后的时长
      const combinedDuration = segment.end - currentSegment.start;

      // 合并条件：
      // 1. 时间间隔小于阈值
      // 2. 合并后不超过最大时长
      // 3. 如果有句子结束标点，优先结束段落
      // 4. 文本长度不超过阈值
      const shouldMerge = 
        timeGap <= options.timeThreshold &&
        combinedDuration <= options.maxSegmentDuration &&
        !hasSentenceEnding &&
        combinedLength <= options.lengthThreshold;

      if (shouldMerge) {
        currentSegment.end = segment.end;
        currentSegment.originalText += text;
        currentSegment.confidence = (currentSegment.confidence + segment.confidence) / 2;
      } else {
        // 检查是否满足最小时长要求
        if (currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
          merged.push(currentSegment);
        }
        currentSegment = { ...segment };
      }
    }

    // 添加最后一个段落
    if (currentSegment && currentSegment.end - currentSegment.start >= options.minSegmentDuration) {
      merged.push(currentSegment);
    }

    return merged;
  }

  /**
   * 智能分句（推荐使用）
   * 自动检测语言并选择合适的分句策略
   */
  smartMerge(
    segments: TranscriptionSegment[],
    options: SegmentMergeOptions = {}
  ): TranscriptionSegment[] {
    const mergedOptions = { ...this.defaultOptions, ...options };
    
    if (!segments || segments.length === 0) {
      return [];
    }

    // 检测语言特征
    const sampleText = segments.slice(0, 10).map(s => s.originalText).join('');
    const hasChineseCharacters = /[\u4e00-\u9fff]/.test(sampleText);
    const hasJapaneseCharacters = /[\u3040-\u309f\u30a0-\u30ff]/.test(sampleText);
    
    // 根据语言调整策略
    if (hasChineseCharacters) {
      // 中文通常按标点符号分句
      mergedOptions.punctuationMode = "strict";
      mergedOptions.timeThreshold = 1.0;
      mergedOptions.lengthThreshold = 30;
    } else if (hasJapaneseCharacters) {
      // 日文通常按助词和标点分句
      mergedOptions.punctuationMode = "relaxed";
      mergedOptions.timeThreshold = 0.8;
      mergedOptions.lengthThreshold = 25;
    } else {
      // 其他语言（如英文）按标点和长度分句
      mergedOptions.punctuationMode = "strict";
      mergedOptions.timeThreshold = 1.2;
      mergedOptions.lengthThreshold = 80;
    }

    return this.mergeSegments(segments, mergedOptions, MergeStrategy.HYBRID);
  }

  /**
   * 获取统计信息
   */
  getStatistics(segments: TranscriptionSegment[]): {
    originalCount: number;
    mergedCount: number;
    averageDuration: number;
    averageLength: number;
    timeReduction: number;
  } {
    if (!segments || segments.length === 0) {
      return {
        originalCount: 0,
        mergedCount: 0,
        averageDuration: 0,
        averageLength: 0,
        timeReduction: 0,
      };
    }

    const totalDuration = segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    const totalLength = segments.reduce((sum, seg) => sum + seg.originalText.length, 0);

    return {
      originalCount: segments.length,
      mergedCount: segments.length,
      averageDuration: totalDuration / segments.length,
      averageLength: totalLength / segments.length,
      timeReduction: 0, // 这里应该是原始段落数，需要在外部计算
    };
  }
}

// 单例实例
export const segmentMerger = new SegmentMerger();