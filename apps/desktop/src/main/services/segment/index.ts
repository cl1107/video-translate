/**
 * Segment 模块门面：ASR 段 → 显示段 → 文本策略。
 * 删除了未使用的 SegmentMerger；合并策略只保留两处有职责的实现。
 */
export {
  buildSegmentsFromAsrResult,
  type RawAsrResult,
} from '../asr/segment-builder'
export {
  buildDisplaySegments,
  cloneAsDisplaySegments,
  expandDisplayTranslations,
  type DisplaySegment,
  type DisplaySegmentOptions,
} from '../../utils/display-segment-builder'
export {
  getAsrSourceForArtifacts,
  getAsrText,
  getDisplaySource,
  getPolishInput,
  getTranslateInput,
  getTranslatedText,
  type SegmentLike,
} from '../../utils/segment-text'
