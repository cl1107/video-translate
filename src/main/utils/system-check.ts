import { spawn } from "node:child_process";
import { ensureSenseVoiceModel } from "../services/asr/model-downloader";
import { sherpaTranscriber } from "../services/asr/sherpa-transcriber";

export interface SystemCheckResult {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

/**
 * 检查命令是否可用
 */
function checkCommand(
  command: string,
  args: string[] = ["-version"]
): Promise<SystemCheckResult> {
  return new Promise((resolve) => {
    const process = spawn(command, args);
    let output = "";
    let error = "";

    process.stdout.on("data", (data) => {
      output += data.toString();
    });

    process.stderr.on("data", (data) => {
      error += data.toString();
    });

    process.on("error", (err) => {
      resolve({
        name: command,
        available: false,
        error: err.message,
      });
    });

    process.on("close", (code) => {
      if (code === 0) {
        const versionMatch =
          (output + error).match(/version\s+(\d+\.\d+\.\d+)/i) ||
          (output + error).match(/(\d+\.\d+\.\d+)/);

        resolve({
          name: command,
          available: true,
          version: versionMatch ? versionMatch[1] : "unknown",
        });
      } else {
        resolve({
          name: command,
          available: false,
          error: `Command failed with code ${code}`,
        });
      }
    });

    setTimeout(() => {
      process.kill();
      resolve({
        name: command,
        available: false,
        error: "Command timeout",
      });
    }, 5000);
  });
}

/**
 * 检查 sherpa-onnx ASR；若默认 SenseVoice 缺失则自动下载。
 */
async function checkSherpaAsr(
  autoDownload = true
): Promise<SystemCheckResult> {
  try {
    // 先确认原生模块能加载
    try {
      require.resolve("sherpa-onnx-node");
    } catch {
      return {
        name: "sherpa-onnx-asr",
        available: false,
        error: "未安装 sherpa-onnx-node 依赖，请执行 pnpm install",
      };
    }

    let senseOk = await sherpaTranscriber.isAvailable("sensevoice");
    if (!senseOk && autoDownload) {
      const result = await ensureSenseVoiceModel();
      senseOk = result.available;
      if (!senseOk) {
        return {
          name: "sherpa-onnx-asr",
          available: false,
          error: result.error || "SenseVoice 模型自动下载失败",
        };
      }
    }

    const nanoOk = await sherpaTranscriber.isAvailable("funasr-nano");
    if (senseOk || nanoOk) {
      return {
        name: "sherpa-onnx-asr",
        available: true,
        version: senseOk ? "sensevoice" : "funasr-nano",
      };
    }

    return {
      name: "sherpa-onnx-asr",
      available: false,
      error: "SenseVoice / Fun-ASR-Nano 模型未就绪",
    };
  } catch (error) {
    return {
      name: "sherpa-onnx-asr",
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检查所有系统依赖
 * @param options.autoDownloadAsr 默认 true，缺失 SenseVoice 时自动下载
 */
export async function checkSystemDependencies(options?: {
  autoDownloadAsr?: boolean;
}): Promise<SystemCheckResult[]> {
  const autoDownloadAsr = options?.autoDownloadAsr ?? true;

  // ASR 可能触发下载，单独串行，避免和其他检查抢带宽时误报
  const [ffmpeg, ffprobe, node, ollama] = await Promise.all([
    checkCommand("ffmpeg"),
    checkCommand("ffprobe"),
    checkCommand("node", ["--version"]),
    checkCommand("ollama", ["--version"]),
  ]);

  const asr = await checkSherpaAsr(autoDownloadAsr);
  return [ffmpeg, ffprobe, node, ollama, asr];
}

/**
 * 生成安装建议
 */
export function getInstallationSuggestions(
  results: SystemCheckResult[]
): string[] {
  const suggestions: string[] = [];

  for (const result of results) {
    if (!result.available) {
      switch (result.name) {
        case "sherpa-onnx-asr":
          suggestions.push(
            "ASR 模型未就绪：应用会在检查时自动下载 SenseVoice。" +
              "若仍失败，请检查网络后点击「重新检查」。" +
              (result.error ? `\n详情: ${result.error}` : "")
          );
          break;
        case "ffmpeg":
        case "ffprobe":
          suggestions.push(
            "安装 FFmpeg:\n" +
              "- macOS: brew install ffmpeg\n" +
              "- Ubuntu/Debian: sudo apt install ffmpeg\n" +
              "- Windows: 从 https://ffmpeg.org/download.html 下载并添加到 PATH"
          );
          break;
        case "ollama":
          suggestions.push(
            "安装 Ollama:\n" +
              "- 访问 https://ollama.ai 下载并安装\n" +
              "- 安装后运行: ollama serve"
          );
          break;
        case "node":
          suggestions.push(
            "安装 Node.js:\n" +
              "- 访问 https://nodejs.org 下载 LTS 版本\n" +
              "- 推荐版本: v18.0.0 或更高"
          );
          break;
      }
    }
  }

  return [...new Set(suggestions)];
}
