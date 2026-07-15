/**
 * TaskRuntimeOptions 与 AppSettings 之间的规范化与映射。
 */
import {
  DEFAULT_ASR_ENGINE,
  DEFAULT_OLLAMA_MODEL,
  type AsrEngineId,
} from './constants'
import {
  DEFAULT_ORIGINAL_SUBTITLE_COLOR,
  DEFAULT_TRANSLATED_SUBTITLE_COLOR,
  normalizeAppSettings,
  normalizeAsrEngine,
  normalizeHexColor,
  normalizeOllamaModel,
  normalizePolishOllamaModel,
  type AppSettings,
  type PolishProvider,
  type SubtitleBurnMode,
} from './settings'
import type { TaskRuntimeOptions } from './types/video'

export function defaultTaskRuntimeOptions(): TaskRuntimeOptions {
  return {
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    asrEngine: DEFAULT_ASR_ENGINE,
    burnSubtitles: false,
    burnSubtitleMode: 'bilingual',
    polishTranscript: true,
    polishProvider: 'ollama',
    polishOllamaModel: '',
    byokBaseUrl: '',
    byokModelId: '',
    originalSubtitleColor: DEFAULT_ORIGINAL_SUBTITLE_COLOR,
    translatedSubtitleColor: DEFAULT_TRANSLATED_SUBTITLE_COLOR,
  }
}

/** 从 AppSettings（或上传载荷）构建任务运行配置 */
export function taskOptionsFromAppSettings(
  settings: Partial<AppSettings> | null | undefined
): TaskRuntimeOptions {
  const app = normalizeAppSettings(settings)
  return {
    ollamaModel: app.ollamaModel,
    asrEngine: app.asrEngine,
    burnSubtitles: app.burnSubtitles,
    burnSubtitleMode: app.burnSubtitleMode,
    polishTranscript: app.polishTranscript,
    polishProvider: app.polishProvider,
    polishOllamaModel: app.polishOllamaModel,
    byokBaseUrl: app.byokBaseUrl,
    byokModelId: app.byokModelId,
    originalSubtitleColor: app.originalSubtitleColor,
    translatedSubtitleColor: app.translatedSubtitleColor,
  }
}

/** 合并/清洗部分覆盖；保证字段齐全 */
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

  const polishProvider: PolishProvider =
    raw.polishProvider === 'byok' || raw.polishProvider === 'ollama'
      ? raw.polishProvider
      : base.polishProvider

  return {
    ollamaModel: normalizeOllamaModel(raw.ollamaModel ?? base.ollamaModel),
    asrEngine: normalizeAsrEngine(
      (raw.asrEngine as AsrEngineId | undefined) ?? base.asrEngine
    ),
    burnSubtitles:
      raw.burnSubtitles === undefined
        ? base.burnSubtitles
        : Boolean(raw.burnSubtitles),
    burnSubtitleMode: resolvedBurn,
    polishTranscript:
      raw.polishTranscript === undefined
        ? base.polishTranscript
        : Boolean(raw.polishTranscript),
    polishProvider,
    polishOllamaModel: normalizePolishOllamaModel(
      raw.polishOllamaModel ?? base.polishOllamaModel
    ),
    byokBaseUrl: (raw.byokBaseUrl ?? base.byokBaseUrl).trim(),
    byokModelId: (raw.byokModelId ?? base.byokModelId).trim(),
    originalSubtitleColor: normalizeHexColor(
      raw.originalSubtitleColor,
      DEFAULT_ORIGINAL_SUBTITLE_COLOR
    ),
    translatedSubtitleColor: normalizeHexColor(
      raw.translatedSubtitleColor,
      DEFAULT_TRANSLATED_SUBTITLE_COLOR
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
