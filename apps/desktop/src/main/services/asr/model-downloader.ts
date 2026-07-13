import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  ASR_MODEL_DOWNLOAD,
  getAsrModelsRoot,
  resolveSenseVoicePaths,
} from './model-paths'

export type ModelDownloadProgress = {
  stage: 'checking' | 'downloading' | 'extracting' | 'done' | 'error'
  percent?: number
  message: string
}

type ModelDownloadResult = {
  available: boolean
  path?: string
  error?: string
}

let senseVoiceInstallation: Promise<ModelDownloadResult> | null = null
let latestProgress: ModelDownloadProgress | null = null
const progressListeners = new Set<(progress: ModelDownloadProgress) => void>()

function reportProgress(progress: ModelDownloadProgress): void {
  latestProgress = progress
  for (const listener of progressListeners) {
    listener(progress)
  }
}

/**
 * 确保默认 SenseVoice 模型可用；缺失时自动下载并解压。
 *
 * 启动后台初始化和页面依赖检查可能同时触发此方法。下载、解压同一模型
 * 必须串行，否则 Windows tar 在覆盖同名 ONNX 文件时会报 Permission denied。
 */
export async function ensureSenseVoiceModel(
  onProgress?: (progress: ModelDownloadProgress) => void
): Promise<ModelDownloadResult> {
  if (onProgress) {
    progressListeners.add(onProgress)
    if (latestProgress) onProgress(latestProgress)
  }

  if (!senseVoiceInstallation) {
    senseVoiceInstallation = prepareSenseVoiceModel().finally(() => {
      senseVoiceInstallation = null
      latestProgress = null
    })
  }

  try {
    return await senseVoiceInstallation
  } finally {
    if (onProgress) progressListeners.delete(onProgress)
  }
}

async function prepareSenseVoiceModel(): Promise<ModelDownloadResult> {
  reportProgress({ stage: 'checking', message: '检查 SenseVoice 模型...' })

  const existing = resolveSenseVoicePaths()
  if (existing) {
    reportProgress({
      stage: 'done',
      percent: 100,
      message: `SenseVoice 已就绪: ${existing.dir}`,
    })
    return { available: true, path: existing.dir }
  }

  const root = getAsrModelsRoot()
  await fs.mkdir(root, { recursive: true })

  const { name, url } = ASR_MODEL_DOWNLOAD.sensevoice
  const archivePath = path.join(root, `${name}.tar.bz2`)
  const extractDir = path.join(root, name)
  const linkPath = path.join(root, 'sensevoice-small')

  try {
    const hasExtracted =
      existsSync(extractDir) &&
      (existsSync(path.join(extractDir, 'model.int8.onnx')) ||
        existsSync(path.join(extractDir, 'model.onnx'))) &&
      existsSync(path.join(extractDir, 'tokens.txt'))

    if (!hasExtracted) {
      reportProgress({
        stage: 'downloading',
        percent: 0,
        message: '正在下载 SenseVoice 模型（约 155MB，首次需要）...',
      })
      await downloadFile(url, archivePath, percent => {
        reportProgress({
          stage: 'downloading',
          percent,
          message: `正在下载 SenseVoice 模型... ${percent}%`,
        })
      })

      reportProgress({
        stage: 'extracting',
        percent: 95,
        message: '正在解压 SenseVoice 模型...',
      })

      // 上次中断后可能残留不完整目录。先移除它，避免 tar 覆盖旧文件；
      // Windows 在两个 tar 同时解压同一文件时会以 Permission denied 失败。
      await fs.rm(extractDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      })
      await extractTarBz2(archivePath, root)
      await fs.unlink(archivePath).catch(() => {})
    }

    // 便捷链接仅用于兼容旧目录；真实模型目录始终是有效回退路径。
    // 不替换已有链接，避免用户或其他进程正在访问它时造成安装失败。
    if (!existsSync(linkPath)) {
      await fs.symlink(extractDir, linkPath, 'junction').catch(error => {
        console.warn('创建 SenseVoice 便捷链接失败，将使用真实模型目录:', error)
      })
    }

    const resolved = resolveSenseVoicePaths()
    if (!resolved) {
      throw new Error('模型下载完成但未能识别有效文件（缺少 model/tokens）')
    }

    reportProgress({
      stage: 'done',
      percent: 100,
      message: `SenseVoice 已安装: ${resolved.dir}`,
    })
    return { available: true, path: resolved.dir }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportProgress({ stage: 'error', message })
    return { available: false, error: message }
  }
}

function downloadFile(
  url: string,
  dest: string,
  onPercent?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get

    const request = get(
      url,
      { headers: { 'User-Agent': 'video-translate' } },
      res => {
        // follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume()
          downloadFile(res.headers.location, dest, onPercent)
            .then(resolve)
            .catch(reject)
          return
        }

        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`))
          return
        }

        const total = Number(res.headers['content-length'] || 0)
        let received = 0
        const file = createWriteStream(dest)

        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (total > 0 && onPercent) {
            onPercent(Math.min(99, Math.round((received / total) * 100)))
          }
        })

        pipeline(res, file)
          .then(() => {
            onPercent?.(100)
            resolve()
          })
          .catch(reject)
      }
    )

    request.on('error', reject)
  })
}

function extractTarBz2(archivePath: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['xjf', archivePath, '-C', cwd], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`解压失败 (code=${code}): ${stderr}`))
    })
  })
}
