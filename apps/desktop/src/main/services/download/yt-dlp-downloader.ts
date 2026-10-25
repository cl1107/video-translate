/**
 * 在线视频下载：解析元数据 → 选择格式 / 字幕轨 → 下载到暂存目录 → 发布。
 *
 * 相比早期版本：
 * - 下载前先解析标题、时长、平台字幕，失败时给出可操作的中文说明；
 * - 只下载选中的一条字幕轨，不再一次性抓取 all；
 * - 优先 MP4/M4A 合流，保留中文标题；文稿任务可只下载音频；
 * - 取消时结束整个进程组，失败后保留 `.part` 供重试续传。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveCommandPath } from '../../utils/command-path'
import {
  checkVideoLink,
  redactUrl,
  redactUrlsInText,
  VideoLinkError,
} from './link-url'
import {
  findBestPlatformSubtitle,
  type SelectedPlatformSubtitle,
} from './platform-subtitles'
import {
  AUDIO_EXTENSIONS,
  buildDownloadArgs,
  buildOutputBaseName,
  buildResolveArgs,
  classifyFailure,
  createAbortError,
  isAbortError,
  isProcessingLine,
  parseProgressLine,
  parseVideoInfo,
  ProgressTracker,
  runYtDlp,
  selectSubtitleTrack,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  YT_DLP_VIDEO_FORMAT,
  YtDlpError,
  toolNotInstalledError,
  worthAnotherCookieBrowser,
  type CookieAttempt,
  type CookieBrowser,
  type ParsedVideoInfo,
  type SelectedSubtitleTrack,
} from './yt-dlp'

export { YtDlpError }
export {
  COOKIE_BROWSERS,
  type CookieBrowser,
  type CookieAttempt,
} from './yt-dlp'

/** 最佳视频 + 最佳音频，优先浏览器可直接播放的 MP4 / M4A。 */
export const YT_DLP_FORMAT_SELECTOR = YT_DLP_VIDEO_FORMAT

const ALL_EXTENSIONS = new Set<string>([
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
])
const SUBTITLE_EXTENSION_SET = new Set<string>(SUBTITLE_EXTENSIONS)

export interface DownloadProgress {
  stage?: 'resolving' | 'downloading' | 'processing' | 'publishing'
  /** 0–100；未知时为 undefined */
  percent?: number
  downloadedBytes?: number
  totalBytes?: number
  /** 字节/秒 */
  speedBps?: number
  /** 剩余秒数 */
  etaSec?: number
  /** 可直接展示的一行摘要 */
  message: string
}

export interface VideoInfo extends ParsedVideoInfo {
  /** 规范化后的页面链接 */
  url: string
  /** 解析成功时实际使用的浏览器 Cookie；匿名时为 null */
  cookieBrowser: CookieBrowser | null
  selectedSubtitle: SelectedSubtitleTrack | null
}

export interface DownloadResult {
  videoPath: string
  title: string
  uploader?: string
  durationSec?: number
  /** 平台公开定位 URL（已规范化） */
  webpageUrl: string
  /** 文件大小（字节） */
  size: number
  format: string
  /** 是否为仅音频下载 */
  audioOnly: boolean
  /**
   * 平台原生/自动字幕（若有）。
   * 有值时流水线可跳过 ASR，直接翻译该字幕。
   */
  platformSubtitle?: SelectedPlatformSubtitle
}

export interface ResolveVideoOptions {
  signal?: AbortSignal
  /** 依次尝试的登录态来源；`null` 表示匿名。默认只尝试匿名。 */
  cookieAttempts?: CookieAttempt[]
  proxy?: string
  sourceLanguage?: string
  targetLanguage?: string
  onProgress?: (progress: DownloadProgress) => void
}

export interface DownloadVideoOptions extends ResolveVideoOptions {
  url: string
  /** 下载输出目录（会自动创建） */
  outputDir: string
  /** 已解析的元数据；不给时先解析一次。 */
  info?: VideoInfo
  /** 只下载音频（文稿任务通常只需要音轨）。 */
  audioOnly?: boolean
  /**
   * 是否尝试下载平台字幕（默认 true）。
   * 有可用字幕时流水线可跳过 ASR。
   */
  writeSubtitles?: boolean
}

/**
 * 校验并规范化用户粘贴的视频链接。
 */
export function validateVideoUrl(raw: string): string {
  try {
    return checkVideoLink(raw).canonical
  } catch (error) {
    if (error instanceof VideoLinkError) {
      throw new YtDlpError('UNSUPPORTED', error.message, {
        remedy: '请粘贴浏览器地址栏里的完整 http(s) 视频链接。',
      })
    }
    throw error
  }
}

/**
 * 诊断用展示 URL：只显示来源，避免泄露路径与 query。
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

export async function isYtDlpAvailable(): Promise<{
  available: boolean
  version?: string
  path: string
  error?: string
}> {
  const binary = resolveCommandPath('yt-dlp')
  return new Promise(resolve => {
    let child: ChildProcess
    try {
      child = spawn(binary, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        available: false,
        path: binary,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

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

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', chunk => {
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

async function assertYtDlpInstalled(): Promise<string> {
  const availability = await isYtDlpAvailable()
  if (!availability.available) {
    throw toolNotInstalledError(
      'yt-dlp',
      availability.error ||
        '请先安装：brew install yt-dlp（或 pip install -U yt-dlp）'
    )
  }
  return availability.path
}

const COOKIE_LABELS: Record<CookieBrowser, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  edge: 'Edge',
  firefox: 'Firefox',
}

function cookieLabel(attempt: CookieAttempt): string {
  return attempt ? COOKIE_LABELS[attempt] : '匿名'
}

function uniqueAttempts(attempts: CookieAttempt[]): CookieAttempt[] {
  const seen = new Set<string>()
  const result: CookieAttempt[] = []
  for (const attempt of attempts) {
    const key = attempt ?? 'anonymous'
    if (seen.has(key)) continue
    seen.add(key)
    result.push(attempt)
  }
  return result.length > 0 ? result : [null]
}

/**
 * 解析单个视频的元数据；需要登录时按顺序换浏览器 Cookie。
 * 播放列表 / 直播 / 不支持的链接会直接抛出带建议的错误。
 */
export async function resolveVideo(
  urlRaw: string,
  options: ResolveVideoOptions = {}
): Promise<VideoInfo> {
  const link = checkVideoLink(urlRaw)
  const binary = await assertYtDlpInstalled()
  const signal = options.signal ?? new AbortController().signal
  const attempts = uniqueAttempts(options.cookieAttempts ?? [null])
  const failures: Array<{ attempt: CookieAttempt; error: YtDlpError }> = []

  for (const [index, attempt] of attempts.entries()) {
    if (signal.aborted) throw createAbortError()
    options.onProgress?.({
      stage: 'resolving',
      message: attempt
        ? `匿名解析失败，尝试 ${cookieLabel(attempt)} Cookie…`
        : '正在解析视频信息…',
    })

    const run = await runYtDlp(
      binary,
      buildResolveArgs(link.canonical, {
        cookieBrowser: attempt,
        proxy: options.proxy,
      }),
      { signal, keepStdout: true }
    )

    if (run.code === 0) {
      const parsed = parseVideoInfo(run.stdout)
      let webpageUrl = link.canonical
      if (parsed.webpageUrl) {
        try {
          webpageUrl = checkVideoLink(parsed.webpageUrl).canonical
        } catch {
          // 网页地址异常时退回用户提交的链接
        }
      }
      return {
        ...parsed,
        url: webpageUrl,
        cookieBrowser: attempt,
        selectedSubtitle: selectSubtitleTrack(parsed, {
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
        }),
      }
    }

    const error = classifyFailure(run.stderr, run.code)
    failures.push({ attempt, error })
    const isLast = index === attempts.length - 1
    if (isLast || !worthAnotherCookieBrowser(error)) throw error
  }

  throw combineCookieFailures(failures)
}

function combineCookieFailures(
  failures: Array<{ attempt: CookieAttempt; error: YtDlpError }>
): YtDlpError {
  const last = failures.at(-1)?.error
  if (!last) {
    return new YtDlpError('DOWNLOAD_FAILED', '解析视频失败。', {
      remedy: '可直接重试；若反复失败，先升级 yt-dlp。',
    })
  }
  if (failures.length === 1) return last
  const tried = failures.map(item => cookieLabel(item.attempt)).join('、')
  return new YtDlpError(last.code, `${last.message}\n已尝试：${tried}。`, {
    remedy: last.remedy,
    detail: last.detail,
  })
}

/** 下载视频；`info` 已解析时跳过解析阶段。 */
export async function downloadVideo(
  options: DownloadVideoOptions
): Promise<DownloadResult> {
  const link = checkVideoLink(options.url)
  const binary = await assertYtDlpInstalled()
  const signal = options.signal ?? new AbortController().signal

  const info =
    options.info ??
    (await resolveVideo(link.canonical, {
      signal,
      cookieAttempts: options.cookieAttempts,
      proxy: options.proxy,
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      onProgress: options.onProgress,
    }))

  if (signal.aborted) throw createAbortError()

  const outputDir = options.outputDir
  const staging = path.join(outputDir, '.download')
  await fs.mkdir(staging, { recursive: true })

  const audioOnly = options.audioOnly === true
  const writeSubtitles = options.writeSubtitles !== false
  const subtitle = writeSubtitles ? info.selectedSubtitle : null

  options.onProgress?.({
    stage: 'downloading',
    percent: 0,
    message: audioOnly ? '开始下载音频…' : '开始下载视频…',
  })

  const args = buildDownloadArgs(link.canonical, {
    output: path.join(staging, 'media.%(ext)s'),
    audioOnly,
    cookieBrowser: info.cookieBrowser,
    proxy: options.proxy,
    subtitle,
    ffmpegLocation: resolveFfmpegLocation(),
  })

  const tracker = new ProgressTracker()
  let lastMessage = ''

  const run = await runYtDlp(binary, args, {
    signal,
    onLine: line => {
      const sample = parseProgressLine(line)
      if (sample) {
        const progress = tracker.update(sample)
        const percent =
          progress.total && progress.total > 0
            ? Math.min(99, (progress.done / progress.total) * 100)
            : undefined
        lastMessage = formatProgressMessage(progress)
        options.onProgress?.({
          stage: 'downloading',
          percent,
          downloadedBytes: progress.done,
          totalBytes: progress.total ?? undefined,
          speedBps: progress.speed ?? undefined,
          etaSec: progress.eta ?? undefined,
          message: lastMessage,
        })
        return
      }

      if (isProcessingLine(line)) {
        lastMessage = line.trim().slice(0, 160)
        options.onProgress?.({
          stage: 'processing',
          message: lastMessage,
        })
      }
    },
  })

  if (signal.aborted) throw createAbortError()
  if (run.code !== 0) throw classifyFailure(run.stderr, run.code)

  options.onProgress?.({
    stage: 'publishing',
    percent: 99,
    message: '正在整理下载文件…',
  })

  const mediaPath = await findDownloadedMedia(staging)
  if (!mediaPath) {
    throw new YtDlpError(
      'DOWNLOAD_FAILED',
      '下载结束但没有找到可用的媒体文件。\n建议：删除任务后重试，或先升级 yt-dlp。',
      { remedy: '升级 yt-dlp 后重试。' }
    )
  }

  const extension = path.extname(mediaPath).replace(/^\./, '').toLowerCase()
  const baseName = buildOutputBaseName(info.title, info.id)
  const publishedPath = await publishMedia(
    mediaPath,
    outputDir,
    baseName,
    extension
  )
  await publishSubtitles(staging, outputDir, baseName)

  // 成功的这次不再需要暂存目录；失败时保留 .part 以便续传。
  await fs.rm(staging, { recursive: true, force: true })

  const stat = await fs.stat(publishedPath)
  if (!stat.isFile() || stat.size <= 0) {
    throw new YtDlpError('DOWNLOAD_FAILED', '下载完成但视频文件为空。', {
      remedy: '请重试。',
    })
  }

  const platformSubtitle = writeSubtitles
    ? await findBestPlatformSubtitle(outputDir, {
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
      })
    : null

  options.onProgress?.({
    stage: 'publishing',
    percent: 100,
    downloadedBytes: stat.size,
    totalBytes: stat.size,
    message: '下载完成',
  })

  return {
    videoPath: publishedPath,
    title: info.title,
    uploader: info.uploader,
    durationSec: info.durationSec,
    webpageUrl: info.url,
    size: stat.size,
    format: extension || (audioOnly ? 'm4a' : 'mp4'),
    audioOnly,
    ...(platformSubtitle ? { platformSubtitle } : {}),
  }
}

function resolveFfmpegLocation(): string | null {
  const resolved = resolveCommandPath('ffmpeg')
  return path.isAbsolute(resolved) ? resolved : null
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatProgressMessage(progress: {
  done: number
  total: number | null
  speed: number | null
  eta: number | null
}): string {
  const parts: string[] = []
  if (progress.total && progress.total > 0) {
    parts.push(
      `${Math.min(99, (progress.done / progress.total) * 100).toFixed(0)}%`
    )
  }
  parts.push(
    progress.total
      ? `${formatBytes(progress.done)} / ${formatBytes(progress.total)}`
      : formatBytes(progress.done)
  )
  if (progress.speed) parts.push(`${formatBytes(progress.speed)}/s`)
  if (progress.eta !== null && progress.eta > 0) {
    parts.push(`剩余 ${formatEta(progress.eta)}`)
  }
  return parts.join(' · ') || '正在下载…'
}

async function findDownloadedMedia(dir: string): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return null
  }

  const candidates: Array<{ path: string; size: number }> = []
  for (const name of entries) {
    const extension = path.extname(name).replace(/^\./, '').toLowerCase()
    if (!ALL_EXTENSIONS.has(extension)) continue
    const full = path.join(dir, name)
    try {
      const stat = await fs.stat(full)
      if (stat.isFile() && stat.size > 0) {
        candidates.push({ path: full, size: stat.size })
      }
    } catch {
      // 忽略读不到的文件
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.size - a.size)
  return candidates[0].path
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function publishMedia(
  source: string,
  outputDir: string,
  baseName: string,
  extension: string
): Promise<string> {
  let target = path.join(outputDir, `${baseName}.${extension}`)
  let suffix = 2
  while (await pathExists(target)) {
    target = path.join(outputDir, `${baseName} (${suffix}).${extension}`)
    suffix += 1
  }
  await moveFile(source, target)
  return target
}

async function publishSubtitles(
  staging: string,
  outputDir: string,
  baseName: string
): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(staging)
  } catch {
    return
  }

  for (const name of entries) {
    const extension = path.extname(name).replace(/^\./, '').toLowerCase()
    if (!SUBTITLE_EXTENSION_SET.has(extension)) continue
    const match = /^media(?:\.([^.]+))?\.(srt|vtt|ass|ssa|ttml)$/i.exec(name)
    if (!match) continue
    const language = match[1] ? `.${match[1]}` : ''
    const target = path.join(outputDir, `${baseName}${language}.${extension}`)
    await moveFile(path.join(staging, name), target)
  }
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    await fs.copyFile(source, target)
    await fs.unlink(source)
  }
}

/** 供任务日志使用：把 yt-dlp 报错里的链接脱敏。 */
export function sanitizeDownloadDiagnostic(text: string): string {
  return redactUrlsInText(text).replace(
    /(cookie|authorization|token|password|sessdata)\s*[:=]\s*\S+/gi,
    '$1=<redacted>'
  )
}

// 保留旧导出名，避免外部调用点与测试失效。
export { isAbortError, redactUrl }
