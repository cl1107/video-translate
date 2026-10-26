import { DEFAULT_ASR_ENGINE, type AsrEngineId } from './constants'

export type SubtitleBurnMode = 'bilingual' | 'translated' | 'original'

/** 字幕任务处理方式；默认保持现有翻译流程。 */
export type SubtitleProcessingMode = 'translate' | 'extract'

/** 字幕与烧录视频的输出位置。 */
export type SubtitleOutputLocation = 'output-subdirectory' | 'source-directory'

/** 在线下载需要登录态时的 Cookie 来源。 */
export const DOWNLOAD_COOKIE_BROWSERS = [
  'auto',
  'none',
  'chrome',
  'safari',
  'edge',
  'firefox',
] as const

export type DownloadCookieBrowser = (typeof DOWNLOAD_COOKIE_BROWSERS)[number]

export interface TaskSubmissionOptions {
  subtitleProcessingMode: SubtitleProcessingMode
  burnSubtitles: boolean
  /** 烧录内容：双语堆叠 / 仅译文 / 仅原文 */
  burnSubtitleMode: SubtitleBurnMode
}

/** 识别文本润色后端：与翻译共用同一「模型服务」连接（OpenAI 兼容） */

/** 硬字幕 / ASS 默认色：原文白、译文黄（与历史 ASS 硬编码一致） */
export const DEFAULT_ORIGINAL_SUBTITLE_COLOR = '#FFFFFF'
export const DEFAULT_TRANSLATED_SUBTITLE_COLOR = '#FFFF00'

/** 固定标识确保已有单服务配置和加密密钥可一起迁移。 */
export const LEGACY_LLM_SERVICE_ID = 'legacy'

export interface LlmServiceConfig {
  id: string
  name: string
  llmBaseUrl: string
  translateModel: string
  /** 空值跟随翻译模型 */
  polishModel: string
}

const DEFAULT_LLM_SERVICE: LlmServiceConfig = {
  id: LEGACY_LLM_SERVICE_ID,
  name: '默认服务',
  llmBaseUrl: '',
  translateModel: '',
  polishModel: '',
}

export interface AppSettings {
  asrEngine: AsrEngineId
  llmServices: LlmServiceConfig[]
  selectedLlmServiceId: string
  /** 模型服务 Endpoint（OpenAI 兼容；本地推理如 Ollama / LM Studio / vLLM，或在线 API） */
  llmBaseUrl: string
  /** 翻译模型 ID */
  translateModel: string
  /** 润色模型 ID；空 = 跟随翻译模型 */
  polishModel: string
  sourceLanguage: string
  targetLanguage: string
  outputFormat: 'srt' | 'vtt' | 'txt'
  subtitleOutputLocation: SubtitleOutputLocation
  /** 识别结果先经大模型润色再翻译 */
  polishTranscript: boolean
  /** 原文字幕颜色（#RRGGBB），用于 ASS / 硬字幕烧录 */
  originalSubtitleColor: string
  /** 译文字幕颜色（#RRGGBB），用于 ASS / 硬字幕烧录 */
  translatedSubtitleColor: string
  /** 在线下载代理；空 = 直连（仍遵循系统环境变量） */
  downloadProxy: string
  /** 在线下载的登录态来源 */
  downloadCookieBrowser: DownloadCookieBrowser
}

export type TaskCreationSettings = AppSettings & TaskSubmissionOptions

export const DEFAULT_APP_SETTINGS: AppSettings = {
  asrEngine: DEFAULT_ASR_ENGINE,
  llmServices: [{ ...DEFAULT_LLM_SERVICE }],
  selectedLlmServiceId: LEGACY_LLM_SERVICE_ID,
  llmBaseUrl: '',
  translateModel: '',
  polishModel: '',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  outputFormat: 'srt',
  subtitleOutputLocation: 'output-subdirectory',
  polishTranscript: true,
  originalSubtitleColor: DEFAULT_ORIGINAL_SUBTITLE_COLOR,
  translatedSubtitleColor: DEFAULT_TRANSLATED_SUBTITLE_COLOR,
  downloadProxy: '',
  downloadCookieBrowser: 'auto',
}

export const DEFAULT_TASK_SUBMISSION_OPTIONS: TaskSubmissionOptions = {
  subtitleProcessingMode: 'translate',
  burnSubtitles: false,
  burnSubtitleMode: 'bilingual',
}

function normalizeBurnSubtitleMode(value?: string | null): SubtitleBurnMode {
  if (value === 'translated' || value === 'original' || value === 'bilingual') {
    return value
  }
  return DEFAULT_TASK_SUBMISSION_OPTIONS.burnSubtitleMode
}

function normalizeSubtitleProcessingMode(
  value?: string | null
): SubtitleProcessingMode {
  return value === 'extract' ? 'extract' : 'translate'
}

function normalizeSubtitleOutputLocation(
  value?: string | null
): SubtitleOutputLocation {
  return value === 'source-directory'
    ? 'source-directory'
    : 'output-subdirectory'
}

export function normalizeDownloadCookieBrowser(
  value?: string | null
): DownloadCookieBrowser {
  return DOWNLOAD_COOKIE_BROWSERS.includes(value as DownloadCookieBrowser)
    ? (value as DownloadCookieBrowser)
    : 'auto'
}

/** 用户常直接粘贴 `127.0.0.1:7890`；补上默认的 http:// 再校验。 */
function proxyWithScheme(value: string): string {
  return value.includes('://') ? value : `http://${value}`
}

/** 代理地址是否合法；空字符串表示不使用代理。 */
export function isValidDownloadProxy(value?: string | null): boolean {
  const trimmed = value?.trim()
  if (!trimmed) return true
  try {
    const url = new URL(proxyWithScheme(trimmed))
    return (
      ['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(
        url.protocol
      ) && Boolean(url.hostname)
    )
  } catch {
    return false
  }
}

export function normalizeDownloadProxy(value?: string | null): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  const candidate = proxyWithScheme(trimmed)
  return isValidDownloadProxy(candidate) ? candidate : ''
}

/**
 * 规范化为 #RRGGBB（大写）。支持 #RGB / #RRGGBB；非法值回退默认。
 */
export function normalizeHexColor(
  value?: string | null,
  fallback = DEFAULT_ORIGINAL_SUBTITLE_COLOR
): string {
  if (!value || typeof value !== 'string') return fallback
  const trimmed = value.trim()
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (full) return `#${full[1]}`.toUpperCase()
  return fallback
}

/**
 * #RRGGBB → ASS 内联色 `&HBBGGRR&`（用于 \1c 等 override）。
 */
export function hexToAssBgr(hex: string): string {
  const normalized = normalizeHexColor(hex)
  const rr = normalized.slice(1, 3)
  const gg = normalized.slice(3, 5)
  const bb = normalized.slice(5, 7)
  return `&H${bb}${gg}${rr}&`
}

/**
 * #RRGGBB → ASS Style PrimaryColour `&HAABBGGRR`（AA=00 不透明）。
 */
export function hexToAssPrimaryColour(hex: string): string {
  const normalized = normalizeHexColor(hex)
  const rr = normalized.slice(1, 3)
  const gg = normalized.slice(3, 5)
  const bb = normalized.slice(5, 7)
  return `&H00${bb}${gg}${rr}`
}

export function normalizeAsrEngine(value?: string | null): AsrEngineId {
  if (value === 'funasr-nano' || value === 'sensevoice') return value
  return DEFAULT_ASR_ENGINE
}

function legacyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 旧版默认 Ollama 翻译模型；仅用于旧设置迁移（v0.8.x 及以前） */
export const LEGACY_DEFAULT_OLLAMA_MODEL = 'kaelri/hy-mt2:1.8b'

/**
 * 旧版「Ollama 翻译 + Ollama/BYOK 润色」分离配置 → 统一「模型服务」字段的迁移。
 * 新字段有值时优先，缺失才回读旧字段；AppSettings 与 TaskRuntimeOptions 共用。
 *
 * 迁移落点（按旧 provider 决定）：
 * - byok：endpoint ← byokBaseUrl，翻译/润色模型 ← byokModelId
 *   （其 Ollama 侧翻译模型属另一端点，无法跨端点迁移）
 * - ollama（或缺省）：endpoint ← 127.0.0.1:11434，翻译模型 ← ollamaModel，
 *   润色模型 ← polishOllamaModel || ollamaModel
 */
export function migrateLegacyLlmFields(raw: Record<string, unknown>): {
  llmBaseUrl: string
  translateModel: string
  polishModel: string
} {
  const read = (key: string) => legacyString(raw[key])

  const llmBaseUrl = read('llmBaseUrl')
  const translateModel = read('translateModel')
  const polishModel = read('polishModel')

  const legacyProvider = read('polishProvider')
  const legacyByokBaseUrl = read('byokBaseUrl')
  const legacyByokModelId = read('byokModelId')
  const legacyOllamaModel = read('ollamaModel')
  const legacyPolishOllamaModel = read('polishOllamaModel')
  const hasLegacyOllama = Boolean(legacyOllamaModel || legacyPolishOllamaModel)
  const hasLegacyByok = Boolean(legacyByokBaseUrl || legacyByokModelId)

  let baseUrl = llmBaseUrl
  let model = translateModel
  let polish = polishModel

  if (!baseUrl || !model) {
    if (legacyProvider === 'byok' || (hasLegacyByok && !hasLegacyOllama)) {
      baseUrl = baseUrl || legacyByokBaseUrl
      model = model || legacyByokModelId
      polish = polish || legacyByokModelId
    } else if (hasLegacyOllama) {
      baseUrl = baseUrl || 'http://127.0.0.1:11434'
      model = model || legacyOllamaModel
      polish = polish || legacyPolishOllamaModel || legacyOllamaModel
    }
  }

  return { llmBaseUrl: baseUrl, translateModel: model, polishModel: polish }
}

/**
 * 合并并清洗 localStorage / 上传用的设置，保证有合法默认值。
 * 注意：模型服务 API Key 不落 localStorage，由主进程 secure store 保管。
 */
export function normalizeAppSettings(
  raw?: Partial<AppSettings> | null
): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APP_SETTINGS }
  }

  const asrEngine = normalizeAsrEngine(raw.asrEngine)
  const llmServices = normalizeLlmServices(raw)
  const selectedService =
    llmServices.find(service => service.id === raw.selectedLlmServiceId) ??
    llmServices[0]
  if (!selectedService) throw new Error('请至少配置一个模型服务')

  return {
    asrEngine,
    llmServices,
    selectedLlmServiceId: selectedService.id,
    llmBaseUrl: selectedService.llmBaseUrl,
    translateModel: selectedService.translateModel,
    polishModel: selectedService.polishModel,
    sourceLanguage: raw.sourceLanguage || DEFAULT_APP_SETTINGS.sourceLanguage,
    targetLanguage: raw.targetLanguage || DEFAULT_APP_SETTINGS.targetLanguage,
    outputFormat: raw.outputFormat || DEFAULT_APP_SETTINGS.outputFormat,
    subtitleOutputLocation: normalizeSubtitleOutputLocation(
      raw.subtitleOutputLocation
    ),
    polishTranscript:
      raw.polishTranscript === undefined
        ? DEFAULT_APP_SETTINGS.polishTranscript
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

function normalizeLlmServices(raw: Partial<AppSettings>): LlmServiceConfig[] {
  if (raw.llmServices === undefined) {
    return [
      {
        ...DEFAULT_LLM_SERVICE,
        ...migrateLegacyLlmFields(raw as Record<string, unknown>),
      },
    ]
  }
  if (!Array.isArray(raw.llmServices) || raw.llmServices.length === 0) {
    throw new Error('请至少配置一个模型服务')
  }
  const ids = new Set<string>()
  return raw.llmServices.map((value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !value.id.trim() ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      !('llmBaseUrl' in value) ||
      typeof value.llmBaseUrl !== 'string' ||
      !('translateModel' in value) ||
      typeof value.translateModel !== 'string' ||
      !('polishModel' in value) ||
      typeof value.polishModel !== 'string'
    ) {
      throw new Error('模型服务配置格式错误，名称和标识不能为空')
    }
    const id = value.id.trim()
    if (ids.has(id)) throw new Error('模型服务标识重复')
    ids.add(id)
    return {
      id,
      name: value.name.trim(),
      llmBaseUrl: value.llmBaseUrl.trim(),
      translateModel: value.translateModel.trim(),
      polishModel: value.polishModel.trim(),
    }
  })
}

/** 选择服务时同时更新供任务流水线消费的连接快照。 */
export function selectLlmService(
  settings: AppSettings,
  serviceId: string
): AppSettings {
  const service = settings.llmServices.find(item => item.id === serviceId)
  if (!service) throw new Error('所选模型服务已不存在，请重新选择')
  return {
    ...settings,
    selectedLlmServiceId: service.id,
    llmBaseUrl: service.llmBaseUrl,
    translateModel: service.translateModel,
    polishModel: service.polishModel,
  }
}

export function normalizeTaskSubmissionOptions(
  raw?: Partial<TaskSubmissionOptions> | null
): TaskSubmissionOptions {
  const subtitleProcessingMode = normalizeSubtitleProcessingMode(
    raw?.subtitleProcessingMode
  )
  return {
    subtitleProcessingMode,
    burnSubtitles: Boolean(raw?.burnSubtitles),
    burnSubtitleMode:
      subtitleProcessingMode === 'extract'
        ? 'original'
        : normalizeBurnSubtitleMode(raw?.burnSubtitleMode),
  }
}

export function normalizeTaskCreationSettings(
  raw?: Partial<TaskCreationSettings> | null
): TaskCreationSettings {
  return {
    ...normalizeAppSettings(raw),
    ...normalizeTaskSubmissionOptions(raw),
  }
}

export interface ParseAppSettingsResult {
  settings: AppSettings
  recovered: boolean
}

/** 安全解析 localStorage 设置；损坏值回退默认设置。 */
export function parseStoredAppSettings(
  serialized?: string | null
): ParseAppSettingsResult {
  if (!serialized) {
    return { settings: { ...DEFAULT_APP_SETTINGS }, recovered: false }
  }

  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { settings: { ...DEFAULT_APP_SETTINGS }, recovered: true }
    }
    return {
      settings: normalizeAppSettings(parsed as Partial<AppSettings>),
      recovered: false,
    }
  } catch {
    return { settings: { ...DEFAULT_APP_SETTINGS }, recovered: true }
  }
}

/** 语言代码 → 翻译提示用自然语言名 */
export function languageDisplayName(code: string): string {
  const map: Record<string, string> = {
    auto: '自动检测',
    zh: '中文',
    'zh-cn': '中文',
    'zh-tw': '繁体中文',
    en: '英语',
    ja: '日语',
    ko: '韩语',
    yue: '粤语',
    es: '西班牙语',
    fr: '法语',
    de: '德语',
    it: '意大利语',
    pt: '葡萄牙语',
    ru: '俄语',
    中文: '中文',
    English: '英语',
    Japanese: '日语',
    Chinese: '中文',
  }
  return map[code] || map[code.toLowerCase()] || code
}
