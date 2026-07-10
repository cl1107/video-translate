import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ASR_MODEL_DOWNLOAD,
  getAsrModelsRoot,
  resolveSenseVoicePaths,
} from "./model-paths";

export type ModelDownloadProgress = {
  stage: "checking" | "downloading" | "extracting" | "done" | "error";
  percent?: number;
  message: string;
};

/**
 * 确保默认 SenseVoice 模型可用；缺失时自动下载并解压。
 */
export async function ensureSenseVoiceModel(
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<{ available: boolean; path?: string; error?: string }> {
  onProgress?.({ stage: "checking", message: "检查 SenseVoice 模型..." });

  const existing = resolveSenseVoicePaths();
  if (existing) {
    onProgress?.({
      stage: "done",
      percent: 100,
      message: `SenseVoice 已就绪: ${existing.dir}`,
    });
    return { available: true, path: existing.dir };
  }

  const root = getAsrModelsRoot();
  await fs.mkdir(root, { recursive: true });

  const { name, url } = ASR_MODEL_DOWNLOAD.sensevoice;
  const archivePath = path.join(root, `${name}.tar.bz2`);
  const extractDir = path.join(root, name);
  const linkPath = path.join(root, "sensevoice-small");

  try {
    const hasExtracted =
      existsSync(extractDir) &&
      (existsSync(path.join(extractDir, "model.int8.onnx")) ||
        existsSync(path.join(extractDir, "model.onnx"))) &&
      existsSync(path.join(extractDir, "tokens.txt"));

    if (!hasExtracted) {
      onProgress?.({
        stage: "downloading",
        percent: 0,
        message: "正在下载 SenseVoice 模型（约 155MB，首次需要）...",
      });
      await downloadFile(url, archivePath, (percent) => {
        onProgress?.({
          stage: "downloading",
          percent,
          message: `正在下载 SenseVoice 模型... ${percent}%`,
        });
      });

      onProgress?.({
        stage: "extracting",
        percent: 95,
        message: "正在解压 SenseVoice 模型...",
      });
      await extractTarBz2(archivePath, root);
      await fs.unlink(archivePath).catch(() => {});
    }

    // 创建/更新便捷软链接
    try {
      await fs.lstat(linkPath);
      await fs.unlink(linkPath);
    } catch {
      // ignore
    }
    await fs.symlink(name, linkPath);

    const resolved = resolveSenseVoicePaths();
    if (!resolved) {
      throw new Error("模型下载完成但未能识别有效文件（缺少 model/tokens）");
    }

    onProgress?.({
      stage: "done",
      percent: 100,
      message: `SenseVoice 已安装: ${resolved.dir}`,
    });
    return { available: true, path: resolved.dir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({ stage: "error", message });
    return { available: false, error: message };
  }
}

function downloadFile(
  url: string,
  dest: string,
  onPercent?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https") ? https.get : http.get;

    const request = get(url, { headers: { "User-Agent": "video-translate" } }, (res) => {
      // follow redirects
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        downloadFile(res.headers.location, dest, onPercent)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
        return;
      }

      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      const file = createWriteStream(dest);

      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0 && onPercent) {
          onPercent(Math.min(99, Math.round((received / total) * 100)));
        }
      });

      pipeline(res, file)
        .then(() => {
          onPercent?.(100);
          resolve();
        })
        .catch(reject);
    });

    request.on("error", reject);
  });
}

function extractTarBz2(archivePath: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["xjf", archivePath, "-C", cwd], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`解压失败 (code=${code}): ${stderr}`));
    });
  });
}
