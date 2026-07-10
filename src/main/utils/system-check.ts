import { spawn } from "node:child_process";

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
        // 尝试从输出中提取版本信息
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

    // 超时检查
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
 * 检查所有系统依赖
 */
async function checkSherpaAsr(): Promise<SystemCheckResult> {
  try {
    const { sherpaTranscriber } = require("../services/asr/sherpa-transcriber") as {
      sherpaTranscriber: {
        isAvailable: (engine?: string) => Promise<boolean>;
      };
    };
    const senseOk = await sherpaTranscriber.isAvailable("sensevoice");
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

export async function checkSystemDependencies(): Promise<SystemCheckResult[]> {
  const checks = await Promise.all([
    checkCommand("ffmpeg"),
    checkCommand("ffprobe"),
    checkCommand("node", ["--version"]),
    checkCommand("ollama", ["--version"]),
    checkSherpaAsr(),
  ]);

  return checks;
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
            "安装 ASR 模型（SenseVoice）:\n" +
              "cd models/asr && curl -L -O https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 && tar xvf sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2\n" +
              "详见 models/asr/README.md"
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

  return [...new Set(suggestions)]; // 去重
}
