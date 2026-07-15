/**
 * 基于系统 yt-dlp 的在线视频下载。
 * 流程参考 JZSub：最高画质合流 + 可选进度回调 + 协作式取消。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveCommandPath } from '../../utils/command-path'
import {
  buildYtDlpSubLangs,
  findBestPlatformSubtitle,
  type SelectedPlatformSubtitle,
} from './platform-subtitles'

/** 与 JZSub 一致：最佳视频 + 最佳音频，回退到整体最佳 */
export const YT_DLP_FORMAT_SELECTOR = 'bv*+ba/b'

const URL_CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export interface DownloadProgress {
  /** 0–100；未知时为 undefined */
  percent?: number
  /** 原始进度行摘要 */
  message: string
}

export interface DownloadResult {
  videoPath: string
  title: string
  /** 平台公开定位 URL（已剥离敏感 query） */
  webpageUrl: string
  /** 文件大小（字节） */
  size: number
  format: string
  /**
   * 平台原生/自动字幕（若有）。
   * 有值时流水线可跳过 ASR，直接翻译该字幕。
   */
  platformSubtitle?: SelectedPlatformSubtitle
}

export class YtDlpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YtDlpError'
  }
}

/**
 * 校验并规范化用户粘贴的视频链接。
 */
export function validateVideoUrl(raw: string): string {
  const url = raw.trim()
  if (!url) {
    throw new YtDlpError('请输入视频链接')
  }
  if (URL_CONTROL_CHARS.test(url)) {
    throw new YtDlpError('链接包含非法控制字符')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new YtDlpError('链接格式无效，请使用完整的 http(s) 地址')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new YtDlpError('仅支持 http:// 或 https:// 链接')
  }
  if (!parsed.hostname) {
    throw new YtDlpError('链接缺少主机名')
  }

  return parsed.toString()
}

/**
 * 诊断用展示 URL：去掉 query/hash，避免泄露 token。
 */
export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '<redacted-url>'
    }
    return `${parsed.protocol}//${parsed.host}/…`
  } catch {
    return '<redacted-url>'
  }
}

/**
 * 从 URL 推导临时展示名（下载完成前显示）。
 */
export function derivePlaceholderName(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const idHint =
      parsed.searchParams.get('v') ||
      parsed.searchParams.get('bvid') ||
      path.basename(parsed.pathname).replace(/[/\\?%*:|"<>]/g, '_') ||
      'video'
    const short = idHint.slice(0, 48) || 'video'
    return `${host} · ${short}`
  } catch {
    return '在线视频'
  }
}

/**
 * 解析 yt-dlp 进度行，例如：
 * `[download]  45.2% of  100.00MiB at  2.50MiB/s ETA 00:22`
 */
export function parseYtDlpProgressLine(line: string): DownloadProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  // 合并 / 后处理阶段（无百分比）
  if (
    trimmed.includes('[Merger]') ||
    trimmed.includes('[ExtractAudio]') ||
    /\[download\].*(Destination:|Merging|Extracting|Deleting)/i.test(trimmed)
  ) {
    return { message: trimmed.replace(/^\[.*?\]\s*/, '').slice(0, 120) }
  }

  if (!trimmed.includes('[download]')) return null

  const percentMatch = trimmed.match(/(\d+(?:\.\d+)?)%/)
  if (!percentMatch) return null

  const percent = Math.min(100, Math.max(0, Number.parseFloat(percentMatch[1])))
  return {
    percent: Number.isFinite(percent) ? percent : undefined,
    message: trimmed.replace(/^\[download\]\s*/, '').slice(0, 120),
  }
}

export async function isYtDlpAvailable(): Promise<{
  available: boolean
  version?: string
  path: string
  error?: string
}> {
  const binary = resolveCommandPath('yt-dlp')
  return new Promise(resolve => {
    const child = spawn(binary, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: {
      available: boolean
      version?: string
      path: string
      error?: string
    }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', err => {
      finish({
        available: false,
        path: binary,
        error: err.message,
      })
    })
    child.on('close', code => {
      if (code === 0) {
        const version = (stdout || stderr).trim().split(/\s+/)[0]
        finish({ available: true, version, path: binary })
      } else {
        finish({
          available: false,
          path: binary,
          error: `yt-dlp 退出码 ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`,
        })
      }
    })

    const timer = setTimeout(() => {
      child.kill()
      finish({
        available: false,
        path: binary,
        error: 'yt-dlp --version 超时',
      })
    }, 8000)
  })
}

export interface DownloadVideoOptions {
  url: string
  /** 下载输出目录（会自动创建） */
  outputDir: string
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
  /**
   * 需要登录的站点可指定浏览器读取 cookies。
   * 例如 'chrome' | 'safari' | 'firefox' | 'edge'
   */
  cookiesFromBrowser?: string
  /** 用于挑选字幕轨的源语言（UI 设置） */
  sourceLanguage?: string
  /** 目标语言；选取字幕时降权同语言轨 */
  targetLanguage?: string
  /**
   * 是否尝试下载平台字幕（默认 true）。
   * 有可用字幕时流水线可跳过 ASR。
   */
  writeSubtitles?: boolean
}

/**
 * 下载单个视频到 outputDir，尽量合并为 mp4。
 * 若站点要求登录/反爬，会自动用本机浏览器 Cookie 重试一次。
 */
export async function downloadVideo(
  options: DownloadVideoOptions
): Promise<DownloadResult> {
  const url = validateVideoUrl(options.url)
  const outputDir = options.outputDir
  await fs.mkdir(outputDir, { recursive: true })

  const availability = await isYtDlpAvailable()
  if (!availability.available) {
    throw new YtDlpError(
      `未找到 yt-dlp，请先安装：brew install yt-dlp（或 pip install -U yt-dlp）` +
        (availability.error ? `\n详情: ${availability.error}` : '')
    )
  }

  throwIfAborted(options.signal)

  const explicitCookies = options.cookiesFromBrowser?.trim()
  try {
    return await downloadVideoOnce({
      ...options,
      url,
      outputDir,
      cookiesFromBrowser: explicitCookies,
    })
  } catch (error) {
    if (explicitCookies || !isAuthOrBotError(error) || options.signal?.aborted) {
      throw error
    }

    // YouTube 等站点常见：需读取本机浏览器登录态
    const browsers =
      process.platform === 'darwin'
        ? ['chrome', 'safari', 'edge', 'firefox']
        : ['chrome', 'edge', 'firefox']

    let lastError: unknown = error
    for (const browser of browsers) {
      throwIfAborted(options.signal)
      options.onProgress?.({
        message: `站点需要登录态，尝试使用 ${browser} Cookie 重试…`,
      })
      try {
        return await downloadVideoOnce({
          ...options,
          url,
          outputDir,
          cookiesFromBrowser: browser,
        })
      } catch (retryError) {
        lastError = retryError
        if (!isAuthOrBotError(retryError) && !isCookieAccessError(retryError)) {
          throw retryError
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new YtDlpError(String(lastError))
  }
}

function isAuthOrBotError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /sign in|not a bot|cookies?|login required|private video|confirm you/i.test(
    message
  )
}

function isCookieAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /could not copy|failed to load cookies|no such browser|could not find/i.test(
    message
  )
}

async function downloadVideoOnce(
  options: DownloadVideoOptions & { url: string; outputDir: string }
): Promise<DownloadResult> {
  const { url, outputDir } = options

  // 输出模板：标题 + id，避免重名；ext 由合并格式决定
  const outputTemplate = path.join(
    outputDir,
    '%(title).180B [%(id)s].%(ext)s'
  )

  const writeSubtitles = options.writeSubtitles !== false
  const args = [
    '--no-playlist',
    '--no-mtime',
    '--newline',
    '-f',
    YT_DLP_FORMAT_SELECTOR,
    '--merge-output-format',
    'mp4',
    '-o',
    outputTemplate,
    // 限制路径过长 / 特殊字符
    '--restrict-filenames',
    '--print',
    'after_move:filepath',
    '--print',
    'after_move:title',
    '--print',
    'after_move:webpage_url',
  ]

  if (writeSubtitles) {
    // 人工字幕 + 自动字幕；转 srt 便于解析；语言偏好见 buildYtDlpSubLangs
    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs',
      buildYtDlpSubLangs(options.sourceLanguage, options.targetLanguage),
      '--convert-subs',
      'srt'
    )
  }

  if (options.cookiesFromBrowser?.trim()) {
    args.push('--cookies-from-browser', options.cookiesFromBrowser.trim())
  }
  args.push(url)

  const binary = resolveCommandPath('yt-dlp')
  const printLines: string[] = []
  let lastProgressMessage = ''

  await runYtDlp(binary, args, {
    signal: options.signal,
    onLine: line => {
      const progress = parseYtDlpProgressLine(line)
      if (progress) {
        lastProgressMessage = progress.message
        options.onProgress?.(progress)
        return
      }
      // after_move 打印的行通常是纯路径/标题/URL
      if (
        line &&
        !line.startsWith('[') &&
        !line.startsWith('WARNING:') &&
        !line.startsWith('ERROR:')
      ) {
        printLines.push(line)
      }
    },
  })

  throwIfAborted(options.signal)

  // 优先使用 after_move 打印的路径；否则扫描目录取最新视频
  let videoPath = printLines.find(line =>
    /\.(mp4|mkv|webm|mov|m4v)$/i.test(line)
  )
  let title = ''
  let webpageUrl = displayUrl(url)

  if (videoPath) {
    const idx = printLines.indexOf(videoPath)
    title =
      printLines[idx + 1] || path.basename(videoPath, path.extname(videoPath))
    const maybeUrl = printLines[idx + 2]
    if (maybeUrl?.startsWith('http')) {
      webpageUrl = maybeUrl
    }
  } else {
    videoPath = await findNewestVideoFile(outputDir)
    title = path.basename(videoPath, path.extname(videoPath))
  }

  // 规范化路径（yt-dlp 在 Windows 可能给相对路径）
  if (!path.isAbsolute(videoPath)) {
    videoPath = path.resolve(outputDir, videoPath)
  }

  const stat = await fs.stat(videoPath)
  if (!stat.isFile() || stat.size <= 0) {
    throw new YtDlpError('下载完成但视频文件为空')
  }

  const format =
    path.extname(videoPath).replace(/^\./, '').toLowerCase() || 'mp4'

  options.onProgress?.({
    percent: 100,
    message: lastProgressMessage || '下载完成',
  })

  let platformSubtitle: SelectedPlatformSubtitle | undefined
  if (writeSubtitles) {
    const selected = await findBestPlatformSubtitle(outputDir, {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
    })
    if (selected) platformSubtitle = selected
  }

  return {
    videoPath,
    title: title || path.basename(videoPath),
    webpageUrl,
    size: stat.size,
    format,
    platformSubtitle,
  }
}

async function findNewestVideoFile(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const candidates: Array<{ path: string; mtime: number }> = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(mp4|mkv|webm|mov|m4v)$/i.test(entry.name)) continue
    const full = path.join(dir, entry.name)
    const stat = await fs.stat(full)
    if (stat.size > 0) {
      candidates.push({ path: full, mtime: stat.mtimeMs })
    }
  }

  if (candidates.length === 0) {
    throw new YtDlpError('下载完成但未找到视频文件')
  }

  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].path
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('下载已取消')
    error.name = 'AbortError'
    throw error
  }
}

function runYtDlp(
  binary: string,
  args: string[],
  options: {
    signal?: AbortSignal
    onLine?: (line: string) => void
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new YtDlpError(`无法启动 yt-dlp: ${String(error)}`)
      )
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const onAbort = () => {
      try {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2000).unref?.()
      } catch {
        // ignore
      }
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort()
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }

    const handleChunk = (chunk: Buffer, stream: 'out' | 'err') => {
      const text = chunk.toString()
      if (stream === 'out') stdout += text
      else stderr += text

      const combined = stream === 'out' ? stdout : stderr
      const lines = combined.split(/\r?\n/)
      // 保留最后一行不完整片段
      if (stream === 'out') {
        stdout = lines.pop() ?? ''
      } else {
        stderr = lines.pop() ?? ''
      }
      for (const line of lines) {
        if (line.trim()) options.onLine?.(line)
      }
    }

    child.stdout?.on('data', (c: Buffer) => handleChunk(c, 'out'))
    child.stderr?.on('data', (c: Buffer) => handleChunk(c, 'err'))

    child.on('error', err => {
      finish(
        new YtDlpError(
          `无法启动 yt-dlp: ${err.message}。请确认已安装并在 PATH 中。`
        )
      )
    })

    child.on('close', code => {
      // 冲刷残留行
      if (stdout.trim()) options.onLine?.(stdout)
      if (stderr.trim()) options.onLine?.(stderr)

      if (options.signal?.aborted) {
        const error = new Error('下载已取消')
        error.name = 'AbortError'
        finish(error)
        return
      }

      if (code === 0) {
        finish()
        return
      }

      const detail = (stderr || stdout).trim().slice(-800)
      finish(
        new YtDlpError(
          `yt-dlp 下载失败（退出码 ${code}）` +
            (detail ? `\n${sanitizeDiagnostic(detail)}` : '')
        )
      )
    })
  })
}

/** 去掉可能的 cookie/token 片段，避免写入任务日志 */
function sanitizeDiagnostic(text: string): string {
  return text
    .replace(
      /https?:\/\/[^\s'"]+/g,
      match => {
        try {
          return displayUrl(match)
        } catch {
          return '<url>'
        }
      }
    )
    .replace(
      /(cookie|authorization|token|password|sessdata)\s*[:=]\s*\S+/gi,
      '$1=<redacted>'
    )
}
