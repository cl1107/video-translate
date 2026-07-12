import {
  DEFAULT_ASR_ENGINE,
  DEFAULT_OLLAMA_MODEL,
  type AsrEngineId,
} from "./constants";

/** 旧版默认模型，自动迁移 */
const LEGACY_OLLAMA_MODELS = new Set([
  "qwen3:4b-instruct",
  "qwen2.5:7b",
  "qwen2.5:3b",
  "llama3.2",
  "llama3.1",
]);

export interface AppSettings {
  asrEngine: AsrEngineId;
  ollamaModel: string;
  sourceLanguage: string;
  targetLanguage: string;
  outputFormat: "srt" | "vtt" | "txt";
  burnSubtitles: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  asrEngine: DEFAULT_ASR_ENGINE,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
  sourceLanguage: "auto",
  targetLanguage: "zh",
  outputFormat: "srt",
  burnSubtitles: false,
};

export function normalizeOllamaModel(name?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed || LEGACY_OLLAMA_MODELS.has(trimmed)) {
    return DEFAULT_OLLAMA_MODEL;
  }
  return trimmed;
}

export function normalizeAsrEngine(value?: string | null): AsrEngineId {
  if (value === "funasr-nano" || value === "sensevoice") return value;
  return DEFAULT_ASR_ENGINE;
}

/**
 * 合并并清洗 localStorage / 上传用的设置，保证有合法默认值。
 */
export function normalizeAppSettings(
  raw?: Partial<AppSettings> | null
): AppSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_APP_SETTINGS };
  }

  const asrEngine = normalizeAsrEngine(raw.asrEngine);

  return {
    asrEngine,
    ollamaModel: normalizeOllamaModel(raw.ollamaModel),
    sourceLanguage: raw.sourceLanguage || DEFAULT_APP_SETTINGS.sourceLanguage,
    targetLanguage: raw.targetLanguage || DEFAULT_APP_SETTINGS.targetLanguage,
    outputFormat: raw.outputFormat || DEFAULT_APP_SETTINGS.outputFormat,
    burnSubtitles: Boolean(raw.burnSubtitles),
  };
}

/** 语言代码 → 翻译提示用自然语言名 */
export function languageDisplayName(code: string): string {
  const map: Record<string, string> = {
    auto: "自动检测",
    zh: "中文",
    "zh-cn": "中文",
    "zh-tw": "繁体中文",
    en: "英语",
    ja: "日语",
    ko: "韩语",
    yue: "粤语",
    es: "西班牙语",
    fr: "法语",
    de: "德语",
    it: "意大利语",
    pt: "葡萄牙语",
    ru: "俄语",
    中文: "中文",
    English: "英语",
    Japanese: "日语",
    Chinese: "中文",
  };
  return map[code] || map[code.toLowerCase()] || code;
}
