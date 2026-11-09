import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_TASK_SUBMISSION_OPTIONS,
  normalizeGlossary,
  normalizeTaskCreationSettings,
  type GlossaryEntry,
  type TaskCreationSettings,
} from '../shared/settings'
import { getUserDataDir } from '../main/runtime/app-paths'
import { syncSelectedLlmService } from './llm-settings'

export const CLI_SETTINGS_FILE = 'cli-settings.json'

export function cliSettingsPath(): string {
  return path.join(getUserDataDir(), CLI_SETTINGS_FILE)
}

function envOverrides(): Partial<TaskCreationSettings> {
  const read = (key: string) => process.env[key]?.trim() || undefined
  const asr = read('VIDEO_TRANSLATE_ASR_ENGINE')
  return {
    ...(read('VIDEO_TRANSLATE_LLM_BASE_URL')
      ? { llmBaseUrl: read('VIDEO_TRANSLATE_LLM_BASE_URL') }
      : {}),
    ...(read('VIDEO_TRANSLATE_TRANSLATE_MODEL')
      ? { translateModel: read('VIDEO_TRANSLATE_TRANSLATE_MODEL') }
      : {}),
    ...(read('VIDEO_TRANSLATE_POLISH_MODEL') !== undefined &&
    process.env.VIDEO_TRANSLATE_POLISH_MODEL !== undefined
      ? { polishModel: process.env.VIDEO_TRANSLATE_POLISH_MODEL.trim() }
      : {}),
    ...(asr === 'sensevoice' || asr === 'funasr-nano'
      ? { asrEngine: asr }
      : {}),
    ...(read('VIDEO_TRANSLATE_SOURCE_LANG')
      ? { sourceLanguage: read('VIDEO_TRANSLATE_SOURCE_LANG') }
      : {}),
    ...(read('VIDEO_TRANSLATE_TARGET_LANG')
      ? { targetLanguage: read('VIDEO_TRANSLATE_TARGET_LANG') }
      : {}),
  }
}

export function loadCliSettings(): TaskCreationSettings {
  const file = cliSettingsPath()
  let stored: Partial<TaskCreationSettings> = {}
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stored = parsed as Partial<TaskCreationSettings>
      }
    } catch {
      stored = {}
    }
  }
  const base = normalizeTaskCreationSettings({
    ...DEFAULT_TASK_SUBMISSION_OPTIONS,
    ...stored,
  })
  const env = envOverrides()
  return normalizeTaskCreationSettings({
    ...base,
    ...env,
    ...syncSelectedLlmService(base, env),
  })
}

export function saveCliSettings(settings: TaskCreationSettings): string {
  const file = cliSettingsPath()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return file
}

export function patchCliSettings(
  patch: Partial<TaskCreationSettings>
): TaskCreationSettings {
  const current = loadCliSettings()
  const next = normalizeTaskCreationSettings({
    ...current,
    ...patch,
    ...syncSelectedLlmService(current, patch),
  })
  saveCliSettings(next)
  return next
}

export function loadGlossaryFile(filePath: string): GlossaryEntry[] {
  const raw = readFileSync(filePath, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  return normalizeGlossary(parsed)
}
