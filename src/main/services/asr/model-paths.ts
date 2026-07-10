import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { AsrEngineId } from "../../../shared/constants";

const SENSEVOICE_DIR_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const FUNASR_NANO_DIR_NAME = "sherpa-onnx-funasr-nano-int8-2025-12-30";

function getProjectRoot(): string {
  // 生产包：模型放在 userData/models/asr
  // 开发：默认使用项目根目录（pnpm dev 的 cwd）
  try {
    if (app?.isPackaged) {
      return app.getPath("userData");
    }
  } catch {
    // app 尚未就绪时（例如脚本探测）
  }
  return process.cwd();
}

export function getAsrModelsRoot(): string {
  const envRoot = process.env.VIDEO_TRANSLATE_ASR_MODELS;
  if (envRoot) return path.resolve(envRoot);

  const projectRoot = getProjectRoot();
  return path.join(projectRoot, "models", "asr");
}

export interface SenseVoicePaths {
  model: string;
  tokens: string;
  dir: string;
}

export interface FunAsrNanoPaths {
  encoderAdaptor: string;
  llm: string;
  embedding: string;
  tokenizer: string;
  dir: string;
}

function resolveCandidateDirs(engine: AsrEngineId): string[] {
  const root = getAsrModelsRoot();
  const home = os.homedir();

  if (engine === "sensevoice") {
    return [
      path.join(root, "sensevoice-small"),
      path.join(root, SENSEVOICE_DIR_NAME),
      // 用户本机已有的闪电说模型（FunASR 原生导出，可能缺 metadata）
      path.join(
        home,
        "Library/Application Support/Shandianshuo/models/sensevoice-small"
      ),
    ];
  }

  return [
    path.join(root, "funasr-nano"),
    path.join(root, FUNASR_NANO_DIR_NAME),
  ];
}

function firstExisting(filePath: string | undefined): string | null {
  if (!filePath) return null;
  return existsSync(filePath) ? filePath : null;
}

export function resolveSenseVoicePaths(): SenseVoicePaths | null {
  for (const dir of resolveCandidateDirs("sensevoice")) {
    if (!existsSync(dir)) continue;

    const model =
      firstExisting(path.join(dir, "model.int8.onnx")) ||
      firstExisting(path.join(dir, "model.onnx"));
    const tokens = firstExisting(path.join(dir, "tokens.txt"));

    if (model && tokens) {
      return { dir, model, tokens };
    }
  }
  return null;
}

export function resolveFunAsrNanoPaths(): FunAsrNanoPaths | null {
  for (const dir of resolveCandidateDirs("funasr-nano")) {
    if (!existsSync(dir)) continue;

    const encoderAdaptor =
      firstExisting(path.join(dir, "encoder_adaptor.int8.onnx")) ||
      firstExisting(path.join(dir, "encoder_adaptor.onnx"));
    const llm =
      firstExisting(path.join(dir, "llm.int8.onnx")) ||
      firstExisting(path.join(dir, "llm.fp16.onnx")) ||
      firstExisting(path.join(dir, "llm.onnx"));
    const embedding =
      firstExisting(path.join(dir, "embedding.int8.onnx")) ||
      firstExisting(path.join(dir, "embedding.onnx"));
    const tokenizer =
      firstExisting(path.join(dir, "Qwen3-0.6B")) ||
      firstExisting(path.join(dir, "tokenizer"));

    if (encoderAdaptor && llm && embedding && tokenizer) {
      return { dir, encoderAdaptor, llm, embedding, tokenizer };
    }
  }
  return null;
}

export function getAsrModelStatus(): Array<{
  engine: AsrEngineId;
  available: boolean;
  path?: string;
  detail?: string;
}> {
  const sense = resolveSenseVoicePaths();
  const nano = resolveFunAsrNanoPaths();

  return [
    {
      engine: "sensevoice",
      available: Boolean(sense),
      path: sense?.dir,
      detail: sense
        ? `model=${path.basename(sense.model)}`
        : `请将官方模型放到 ${path.join(getAsrModelsRoot(), SENSEVOICE_DIR_NAME)}`,
    },
    {
      engine: "funasr-nano",
      available: Boolean(nano),
      path: nano?.dir,
      detail: nano
        ? `dir=${nano.dir}`
        : `可选：下载 Fun-ASR-Nano 到 ${path.join(getAsrModelsRoot(), FUNASR_NANO_DIR_NAME)}`,
    },
  ];
}

export const ASR_MODEL_DOWNLOAD = {
  sensevoice: {
    name: SENSEVOICE_DIR_NAME,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2",
  },
  funasrNano: {
    name: FUNASR_NANO_DIR_NAME,
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2",
  },
} as const;
