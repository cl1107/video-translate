/**
 * 段文本字段选取策略（C6：钉死「原文」语义）。
 *
 * - asrText / originalText：ASR 不可变识别结果
 * - displaySource：翻译输入与「润色后的源语展示」（优先 polished）
 * - asrSourceForArtifacts：文件产物「原文」轨（保留 ASR，不用润色覆盖）
 * - translated：目标语
 */
import type { TranscriptionSegment } from '../../shared/types/video'

export type SegmentLike = Pick<
  TranscriptionSegment,
  'originalText' | 'polishedText' | 'translatedText'
>

/** ASR 原始识别文本（不可变） */
export function getAsrText(segment: SegmentLike): string {
  return (segment.originalText ?? '').trim()
}

/**
 * 翻译 / 润色后展示用的源语文本。
 * 优先 polishedText，否则回退 ASR。
 */
export function getDisplaySource(segment: SegmentLike): string {
  const polished = (segment.polishedText ?? '').trim()
  if (polished) return polished
  return getAsrText(segment)
}

/**
 * 字幕文件「原文」轨：始终用 ASR，避免润色（可能已变成另一语言）污染原文产物。
 */
export function getAsrSourceForArtifacts(segment: SegmentLike): string {
  return getAsrText(segment)
}

/** 目标语译文；缺失时回退显示源 */
export function getTranslatedText(segment: SegmentLike): string {
  const translated = (segment.translatedText ?? '').trim()
  if (translated) return translated
  return getDisplaySource(segment)
}

/** 送入翻译模型的文本 */
export function getTranslateInput(segment: SegmentLike): string {
  return getDisplaySource(segment)
}

/** 送入润色模型的文本（始终 ASR） */
export function getPolishInput(segment: SegmentLike): string {
  return getAsrText(segment)
}
