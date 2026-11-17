import path from 'node:path'
import {
  normalizeGlossary,
  normalizeTaskCreationSettings,
  type TaskCreationSettings,
} from '../shared/settings'
import { syncSelectedLlmService } from './llm-settings'
import { flagBoolean, flagString } from './parse'
import { loadGlossaryFile } from './settings-store'

export function applyCliFlags(
  base: TaskCreationSettings,
  flags: Record<string, string | boolean>
): TaskCreationSettings {
  const patch: Partial<TaskCreationSettings> = {}
  const sourceLang = flagString(flags, 'source-lang')
  const targetLang = flagString(flags, 'target-lang')
  const asr = flagString(flags, 'asr')
  const llmBaseUrl = flagString(flags, 'llm-base-url')
  const translateModel = flagString(flags, 'translate-model')
  const polishModel = flagString(flags, 'polish-model')
  const burnMode = flagString(flags, 'burn-mode')
  const outputLocation = flagString(flags, 'output-location')
  const originalColor = flagString(flags, 'original-color')
  const translatedColor = flagString(flags, 'translated-color')
  const downloadProxy = flagString(flags, 'download-proxy')
  const cookieBrowser = flagString(flags, 'cookie-browser')
  const glossary = flagString(flags, 'glossary')
  const serviceId = flagString(flags, 'service-id')

  if (sourceLang) patch.sourceLanguage = sourceLang
  if (targetLang) patch.targetLanguage = targetLang
  if (asr === 'sensevoice' || asr === 'funasr-nano') patch.asrEngine = asr
  if (llmBaseUrl) patch.llmBaseUrl = llmBaseUrl
  if (translateModel) patch.translateModel = translateModel
  if (flags['polish-model'] !== undefined) patch.polishModel = polishModel ?? ''
  if (flagBoolean(flags, 'burn')) patch.burnSubtitles = true
  if (flagBoolean(flags, 'no-polish')) patch.polishTranscript = false
  if (
    burnMode === 'bilingual' ||
    burnMode === 'translated' ||
    burnMode === 'original'
  ) {
    patch.burnSubtitleMode = burnMode
  }
  if (
    outputLocation === 'output-subdirectory' ||
    outputLocation === 'source-directory'
  ) {
    patch.subtitleOutputLocation = outputLocation
  }
  if (originalColor) patch.originalSubtitleColor = originalColor
  if (translatedColor) patch.translatedSubtitleColor = translatedColor
  if (flags['download-proxy'] !== undefined) {
    patch.downloadProxy = downloadProxy ?? ''
  }
  if (
    cookieBrowser === 'auto' ||
    cookieBrowser === 'none' ||
    cookieBrowser === 'chrome' ||
    cookieBrowser === 'safari' ||
    cookieBrowser === 'edge' ||
    cookieBrowser === 'firefox'
  ) {
    patch.downloadCookieBrowser = cookieBrowser
  }
  if (serviceId) patch.selectedLlmServiceId = serviceId
  const llmPatch = syncSelectedLlmService(base, {
    llmBaseUrl: patch.llmBaseUrl,
    translateModel: patch.translateModel,
    polishModel: patch.polishModel,
    selectedLlmServiceId: patch.selectedLlmServiceId,
  })
  Object.assign(patch, llmPatch)
  if (glossary) {
    patch.glossary = glossary.trim().startsWith('[')
      ? normalizeGlossary(JSON.parse(glossary) as unknown)
      : loadGlossaryFile(path.resolve(glossary))
  }

  return normalizeTaskCreationSettings({ ...base, ...patch })
}
