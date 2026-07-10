import { v4 as uuidv4 } from "uuid";
import type { TranscriptionSegment } from "../../../shared/types/video";

export interface RawAsrResult {
  text?: string;
  tokens?: string[];
  timestamps?: number[];
  lang?: string;
}

/**
 * 将 sherpa-onnx 的 token 级时间戳合并为字幕段落。
 * 规则：标点/长静音切开；单段最长 maxDuration 秒。
 */
export function buildSegmentsFromAsrResult(
  result: RawAsrResult,
  options: {
    timeOffset?: number;
    maxDuration?: number;
    silenceGap?: number;
  } = {}
): TranscriptionSegment[] {
  const timeOffset = options.timeOffset ?? 0;
  const maxDuration = options.maxDuration ?? 8;
  const silenceGap = options.silenceGap ?? 0.8;

  const tokens = result.tokens ?? [];
  const timestamps = result.timestamps ?? [];
  const fullText = (result.text ?? "").trim();

  if (tokens.length === 0 || timestamps.length === 0) {
    if (!fullText) return [];
    return [
      {
        id: uuidv4(),
        start: timeOffset,
        end: timeOffset + Math.max(1, maxDuration / 2),
        originalText: fullText,
        confidence: 0.85,
      },
    ];
  }

  const segments: TranscriptionSegment[] = [];
  let buffer = "";
  let segStart = timestamps[0] ?? 0;
  let lastTs = segStart;

  const flush = (end: number) => {
    const text = buffer.trim();
    if (!text) {
      buffer = "";
      return;
    }
    const start = timeOffset + segStart;
    const endTime = timeOffset + Math.max(end, segStart + 0.2);
    segments.push({
      id: uuidv4(),
      start,
      end: endTime,
      originalText: text,
      confidence: 0.9,
    });
    buffer = "";
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const ts = timestamps[i] ?? lastTs;
    const gap = ts - lastTs;

    if (buffer && (gap >= silenceGap || ts - segStart >= maxDuration)) {
      flush(lastTs + 0.15);
      segStart = ts;
    }

    buffer += token;
    lastTs = ts;

    // 中文/英文常见句末标点处切分
    if (/[。！？!?；;…]/.test(token)) {
      flush(ts + 0.2);
      if (i + 1 < timestamps.length) {
        segStart = timestamps[i + 1] ?? ts;
      }
    }
  }

  if (buffer.trim()) {
    flush(lastTs + 0.3);
  }

  return mergeTinySegments(segments);
}

function mergeTinySegments(
  segments: TranscriptionSegment[]
): TranscriptionSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TranscriptionSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && seg.originalText.length < 2 && prev.originalText.length < 12) {
      prev.originalText = `${prev.originalText}${seg.originalText}`;
      prev.end = seg.end;
      continue;
    }
    if (prev && seg.end - seg.start < 0.35 && prev.originalText.length < 20) {
      prev.originalText = `${prev.originalText}${seg.originalText}`;
      prev.end = seg.end;
      continue;
    }
    merged.push({ ...seg });
  }
  return merged;
}
