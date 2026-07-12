import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

function tryGetElectronPath(
  name: "logs" | "userData"
): string | undefined {
  try {
    // 测试环境可能没有 electron，避免硬依赖
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron");
    if (app?.isReady?.() || app?.getPath) {
      return app.getPath(name);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function getLogsDirectory(): string {
  return tryGetElectronPath("logs") ?? path.join(process.cwd(), "logs");
}

function getUserDataDirectory(): string {
  return (
    tryGetElectronPath("userData") ?? path.join(process.cwd(), "userData")
  );
}

/**
 * 返回应用诊断相关路径，便于 UI 展示与排查。
 */
export function getAppDiagnosticPaths(): {
  logsDir: string;
  systemCheckLog: string;
  userDataDir: string;
} {
  const logsDir = getLogsDirectory();
  return {
    logsDir,
    systemCheckLog: path.join(logsDir, "system-check.log"),
    userDataDir: getUserDataDirectory(),
  };
}

function ensureLogFile(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * 追加写入系统依赖检查诊断日志。
 */
export function appendSystemCheckLog(message: string): void {
  try {
    const { systemCheckLog } = getAppDiagnosticPaths();
    ensureLogFile(systemCheckLog);
    const line = `[${new Date().toISOString()}] ${message}\n`;
    appendFileSync(systemCheckLog, line, "utf8");
  } catch (error) {
    console.error("写入系统检查日志失败:", error);
  }
}

/**
 * 写入完整的一次系统检查诊断块。
 */
export function writeSystemCheckDiagnostic(payload: {
  path: string;
  results: Array<{
    name: string;
    available: boolean;
    version?: string;
    error?: string;
    resolvedPath?: string;
  }>;
  extra?: Record<string, unknown>;
}): void {
  const header = [
    "========== system dependency check ==========",
    `platform: ${process.platform} ${process.arch}`,
    `electron: ${process.versions.electron || "n/a"}`,
    `node: ${process.versions.node}`,
    `PATH: ${payload.path}`,
  ];

  if (payload.extra) {
    for (const [key, value] of Object.entries(payload.extra)) {
      header.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  for (const result of payload.results) {
    header.push(
      `- ${result.name}: available=${result.available}` +
        (result.version ? ` version=${result.version}` : "") +
        (result.resolvedPath ? ` path=${result.resolvedPath}` : "") +
        (result.error ? ` error=${result.error}` : "")
    );
  }

  header.push("============================================");
  appendSystemCheckLog(header.join("\n"));
}
