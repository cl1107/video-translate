import { v4 as uuidv4 } from "uuid";
import type { TranscriptionSegment } from "../../../shared/types/video";

export interface RawAsrResult {
  text?: string;
  tokens?: string[];
  timestamps?: number[];
  lang?: string;
}

const SENTENCE_END = /[。！？!?；;…]/;
const PUNCT_ONLY =
  /^[\s。！？!?；;…、，,.．:：\-—～~「」『』（）()【】\[\]""''《》〈〉]+$/u;

/**
 * 将 sherpa-onnx 的 token 级时间戳合并为字幕段落。
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
  const maxDuration = options.maxDuration ?? 7;
  const silenceGap = options.silenceGap ?? 0.55;

  const tokens = result.tokens ?? [];
  const timestamps = result.timestamps ?? [];
  const fullText = (result.text ?? "").trim();

  if (tokens.length === 0 || timestamps.length === 0) {
    if (!fullText) return [];
    return splitTextFallback(fullText, timeOffset, maxDuration);
  }

  const segments: TranscriptionSegment[] = [];
  let buffer = "";
  let segStart = timestamps[0] ?? 0;
  let lastTs = segStart;

  const flush = (end: number) => {
    const text = normalizeSubtitleText(buffer);
    buffer = "";
    if (!text) return;

    // 纯标点并入上一段，避免单独一条「？」
    if (PUNCT_ONLY.test(text) && segments.length > 0) {
      const prev = segments[segments.length - 1];
      prev.originalText = normalizeSubtitleText(`${prev.originalText}${text}`);
      prev.end = timeOffset + Math.max(end, segStart + 0.15);
      return;
    }

    const start = timeOffset + segStart;
    const endTime = timeOffset + Math.max(end, segStart + 0.25);
    segments.push({
      id: uuidv4(),
      start,
      end: endTime,
      originalText: text,
      confidence: 0.9,
    });
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const ts = timestamps[i] ?? lastTs;
    const gap = ts - lastTs;

    // 长静音或超长段：在静音处切分
    if (buffer && (gap >= silenceGap || ts - segStart >= maxDuration)) {
      // 尽量在空白后切，避免词中间断开
      flush(lastTs + 0.12);
      segStart = ts;
    }

    buffer += token;
    lastTs = ts;

    if (SENTENCE_END.test(token)) {
      flush(ts + 0.18);
      if (i + 1 < timestamps.length) {
        segStart = timestamps[i + 1] ?? ts;
      } else {
        segStart = ts;
      }
    }
  }

  if (buffer.trim()) {
    flush(lastTs + 0.25);
  }

  return mergeTinySegments(segments);
}

function normalizeSubtitleText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([。！？!?；;…、，,])/g, "$1")
    .trim();
}

function splitTextFallback(
  fullText: string,
  timeOffset: number,
  maxDuration: number
): TranscriptionSegment[] {
  // 按句号等粗分，时间均分
  const parts = fullText
    .split(/(?<=[。！？!?])/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
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

  const slice = maxDuration / parts.length;
  return parts.map((text, i) => ({
    id: uuidv4(),
    start: timeOffset + i * slice,
    end: timeOffset + (i + 1) * slice,
    originalText: text,
    confidence: 0.85,
  }));
}

function mergeTinySegments(
  segments: TranscriptionSegment[]
): TranscriptionSegment[] {
  if (segments.length <= 1) return segments;

  const merged: TranscriptionSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    const text = seg.originalText;

    if (prev && PUNCT_ONLY.test(text)) {
      prev.originalText = normalizeSubtitleText(`${prev.originalText}${text}`);
      prev.end = seg.end;
      continue;
    }

    // 过短片段并入上一段
    if (
      prev &&
      (text.length <= 2 || seg.end - seg.start < 0.4) &&
      prev.originalText.length < 40
    ) {
      prev.originalText = normalizeSubtitleText(
        `${prev.originalText}${text}`
      );
      prev.end = seg.end;
      continue;
    }

    merged.push({ ...seg });
  }
  return merged;
}
