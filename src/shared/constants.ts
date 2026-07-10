export const ENVIRONMENT = {
  IS_DEV: process.env.NODE_ENV === "development",
};

export const PLATFORM = {
  IS_MAC: process.platform === "darwin",
  IS_WINDOWS: process.platform === "win32",
  IS_LINUX: process.platform === "linux",
};

/** 默认 Ollama 翻译模型 */
export const DEFAULT_OLLAMA_MODEL = "kaelri/hy-mt2:1.8b";

/** 默认 ASR 引擎 */
export const DEFAULT_ASR_ENGINE = "sensevoice" as const;

/** 支持的 ASR 引擎 */
export const ASR_ENGINES = {
  sensevoice: {
    id: "sensevoice" as const,
    name: "SenseVoice Small",
    description: "中/英/日/韩/粤，速度快，适合 CJK 字幕",
  },
  "funasr-nano": {
    id: "funasr-nano" as const,
    name: "Fun-ASR-Nano",
    description: "方言/远场/嘈杂场景更强，模型更大",
  },
} as const;

export type AsrEngineId = keyof typeof ASR_ENGINES;
