/**
 * TaskRuntimeOptions 与任务创建设置之间的规范化与映射。
 */
import { DEFAULT_ASR_ENGINE, type AsrEngineId } from './constants'
import {
  DEFAULT_ORIGINAL_SUBTITLE_COLOR,
  DEFAULT_TRANSLATED_SUBTITLE_COLOR,
  migrateLegacyLlmFields,
  normalizeDownloadCookieBrowser,
  normalizeDownloadProxy,
  normalizeTaskCreationSettings,
  normalizeAsrEngine,
  normalizeHexColor,
  type SubtitleBurnMode,
  type SubtitleOutputLocation,
  type SubtitleProcessingMode,
  type TaskCreationSettings,
} from './settings'
import type { TaskRuntimeOptions } from './types/video'

export function defaultTaskRuntimeOptions(): TaskRuntimeOptions {
  return {
    llmBaseUrl: '',
    translateModel: '',
    polishModel: '',
    asrEngine: DEFAULT_ASR_ENGINE,
    burnSubtitles: false,
    burnSubtitleMode: 'bilingual',
    subtitleProcessingMode: 'translate',
    subtitleOutputLocation: 'output-subdirectory',
    polishTranscript: true,
    originalSubtitleColor: DEFAULT_ORIGINAL_SUBTITLE_COLOR,
    translatedSubtitleColor: DEFAULT_TRANSLATED_SUBTITLE_COLOR,
    downloadProxy: '',
    downloadCookieBrowser: 'auto',
  }
}

/** 从任务创建载荷构建任务运行配置 */
export function taskOptionsFromAppSettings(
  settings: Partial<TaskCreationSettings> | null | undefined
): TaskRuntimeOptions {
  const app = normalizeTaskCreationSettings(settings)
  return {
    llmServiceId: app.selectedLlmServiceId,
    llmBaseUrl: app.llmBaseUrl,
    translateModel: app.translateModel,
    polishModel: app.polishModel,
    asrEngine: app.asrEngine,
    burnSubtitles: app.burnSubtitles,
    burnSubtitleMode: app.burnSubtitleMode,
    subtitleProcessingMode: app.subtitleProcessingMode,
    subtitleOutputLocation: app.subtitleOutputLocation,
    polishTranscript: app.polishTranscript,
    originalSubtitleColor: app.originalSubtitleColor,
    translatedSubtitleColor: app.translatedSubtitleColor,
    downloadProxy: app.downloadProxy,
    downloadCookieBrowser: app.downloadCookieBrowser,
  }
}

/** 合并/清洗部分覆盖；保证字段齐全。旧版分离配置经 migrateLegacyLlmFields 迁移。 */
export function normalizeTaskRuntimeOptions(
  raw?: Partial<TaskRuntimeOptions> | null
): TaskRuntimeOptions {
  const base = defaultTaskRuntimeOptions()
  if (!raw || typeof raw !== 'object') return base

  const burnMode = raw.burnSubtitleMode
  const resolvedBurn: SubtitleBurnMode =
    burnMode === 'translated' ||
    burnMode === 'original' ||
    burnMode === 'bilingual'
      ? burnMode
      : base.burnSubtitleMode

  const subtitleProcessingMode: SubtitleProcessingMode =
    raw.subtitleProcessingMode === 'extract' ? 'extract' : 'translate'
  const subtitleOutputLocation: SubtitleOutputLocation =
    raw.subtitleOutputLocation === 'source-directory'
      ? 'source-directory'
      : 'output-subdirectory'
  const resolvedBurnMode =
    subtitleProcessingMode === 'extract' ? 'original' : resolvedBurn

  const llm = migrateLegacyLlmFields(raw as Record<string, unknown>)

  return {
    ...(typeof raw.llmServiceId === 'string' && raw.llmServiceId.trim()
      ? { llmServiceId: raw.llmServiceId.trim() }
      : {}),
    llmBaseUrl: llm.llmBaseUrl,
    translateModel: llm.translateModel,
    polishModel: llm.polishModel,
    asrEngine: normalizeAsrEngine(
      (raw.asrEngine as AsrEngineId | undefined) ?? base.asrEngine
    ),
    burnSubtitles:
      raw.burnSubtitles === undefined
        ? base.burnSubtitles
        : Boolean(raw.burnSubtitles),
    burnSubtitleMode: resolvedBurnMode,
    subtitleProcessingMode,
    subtitleOutputLocation,
    polishTranscript:
      raw.polishTranscript === undefined
        ? base.polishTranscript
        : Boolean(raw.polishTranscript),
    originalSubtitleColor: normalizeHexColor(
      raw.originalSubtitleColor,
      DEFAULT_ORIGINAL_SUBTITLE_COLOR
    ),
    translatedSubtitleColor: normalizeHexColor(
      raw.translatedSubtitleColor,
      DEFAULT_TRANSLATED_SUBTITLE_COLOR
    ),
    downloadProxy: normalizeDownloadProxy(raw.downloadProxy),
    downloadCookieBrowser: normalizeDownloadCookieBrowser(
      raw.downloadCookieBrowser
    ),
  }
}

export function parseTaskRuntimeOptionsJson(
  json: string | null | undefined
): TaskRuntimeOptions | undefined {
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as Partial<TaskRuntimeOptions>
    return normalizeTaskRuntimeOptions(parsed)
  } catch {
    return undefined
  }
}

export function serializeTaskRuntimeOptions(
  options: TaskRuntimeOptions
): string {
  return JSON.stringify(normalizeTaskRuntimeOptions(options))
}
