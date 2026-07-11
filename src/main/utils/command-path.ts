import { constants, accessSync } from "node:fs";
import path from "node:path";

const HOMEBREW_MEDIA_COMMANDS = new Set(["ffmpeg", "ffprobe"]);

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(command: string): string | undefined {
  const pathValue = process.env.PATH;
  if (!pathValue) return undefined;

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;

    const candidate = path.join(directory, command);
    if (isExecutable(candidate)) return candidate;
  }

  return undefined;
}

function getHomebrewPrefixes(): string[] {
  const prefixes: string[] = [];
  const configuredPrefix = process.env.HOMEBREW_PREFIX;
  if (configuredPrefix) prefixes.push(configuredPrefix);

  prefixes.push("/opt/homebrew", "/usr/local");
  return [...new Set(prefixes)];
}

/**
 * 解析系统命令路径。macOS 图形应用不会读取 shell 配置，因此额外检查
 * Homebrew 的 keg-only FFmpeg 安装目录。
 */
export function resolveCommandPath(command: string): string {
  if (path.isAbsolute(command)) return command;

  const pathCommand = findInPath(command);
  if (pathCommand) return pathCommand;

  if (process.platform === "darwin" && HOMEBREW_MEDIA_COMMANDS.has(command)) {
    for (const prefix of getHomebrewPrefixes()) {
      for (const formula of ["ffmpeg-full", "ffmpeg"]) {
        const candidate = path.join(prefix, "opt", formula, "bin", command);
        if (isExecutable(candidate)) return candidate;
      }
    }
  }

  // 保留原命令，让 child_process 返回明确的 ENOENT 或权限错误。
  return command;
}
