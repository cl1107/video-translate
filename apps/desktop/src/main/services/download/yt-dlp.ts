/**
 * yt-dlp 的底层封装：参数、元数据、进度与失败分类。
 *
 * 设计要点（参考 BaoCut 的 link-import / yt-dlp 实现）：
 * - 所有参数都是数组，不经 shell；链接固定在 `--` 之后。
 * - 带 `--ignore-config` / `--no-plugin-dirs` / `--no-cache-dir`：不读用户的
 *   yt-dlp 配置、不加载插件，避免站点内容影响本机执行环境。
 * - 进度只取工具自己报告的字节数；不知道总数时不猜。
 * - 中止时结束整个进程组（合并音视频时 yt-dlp 会再起 ffmpeg 子进程）。
 * - 失败按种类给出中文说明与补救建议，而不是把原始 stderr 直接抛给用户。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  selectBestPlatformSubtitle,
  type PlatformSubtitleCandidate,
} from './platform-subtitles'
import { redactUrlsInText } from './link-url'

/** 默认优先 MP4 / M4A，浏览器与预览器可直接播放；没有时退回最佳任意格式。 */
export const YT_DLP_VIDEO_FORMAT =
  'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b'
export const YT_DLP_AUDIO_FORMAT = 'ba[ext=m4a]/ba/b'

export const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mkv',
  'webm',
  'mov',
  'avi',
  'flv',
] as const

export const AUDIO_EXTENSIONS = [
  'm4a',
  'mp3',
  'opus',
  'ogg',
  'oga',
  'wav',
  'flac',
  'aac',
] as const

export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa', 'ttml'] as const

export const COOKIE_BROWSERS = ['chrome', 'safari', 'edge', 'firefox'] as const

export type CookieBrowser = (typeof COOKIE_BROWSERS)[number]
/** 一次解析 / 下载尝试：`null` 表示匿名。 */
export type CookieAttempt = CookieBrowser | null

const KILL_GRACE_MS = 2000
const STDERR_TAIL = 6000
const STDOUT_LIMIT = 64 * 1024 * 1024

/** 进度行前缀；模板字段依次是已下载、总数、估计总数、速度、剩余秒数。 */
export const PROGRESS_PREFIX = 'vt-progress'
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s ` +
  '%(progress.total_bytes)s %(progress.total_bytes_estimate)s ' +
  '%(progress.speed)s %(progress.eta)s'

const COMMON_ARGS = [
  '--ignore-config',
  '--no-plugin-dirs',
  '--no-cache-dir',
  '--no-playlist',
  '--no-colors',
  '--socket-timeout',
  '20',
]

export type YtDlpFailureCode =
  | 'TOOL_NOT_INSTALLED'
  | 'TOOL_UPDATE_REQUIRED'
  | 'LOGIN_REQUIRED'
  | 'COOKIES_UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'UNAVAILABLE'
  | 'NETWORK'
  | 'DISK_FULL'
  | 'DOWNLOAD_FAILED'

const FAILURE_SUMMARIES: Record<YtDlpFailureCode, string> = {
  TOOL_NOT_INSTALLED: '未找到 yt-dlp。',
  TOOL_UPDATE_REQUIRED: '当前 yt-dlp 版本过旧，无法解析该站点。',
  LOGIN_REQUIRED: '该视频需要登录或验证（会员 / 年龄 / 机器人校验）。',
  COOKIES_UNAVAILABLE: '无法读取所选浏览器的 Cookie。',
  UNSUPPORTED: '链接不受支持（可能是播放列表、直播或未知站点）。',
  UNAVAILABLE: '视频不可用（可能已删除、私享或受地区限制）。',
  NETWORK: '网络请求失败。',
  DISK_FULL: '磁盘空间不足。',
  DOWNLOAD_FAILED: '下载失败。',
}

const FAILURE_REMEDIES: Record<YtDlpFailureCode, string> = {
  TOOL_NOT_INSTALLED:
    '安装 yt-dlp 后重试：macOS 可执行 brew install yt-dlp，或 pip install -U yt-dlp。',
  TOOL_UPDATE_REQUIRED:
    '升级 yt-dlp 后重试：brew upgrade yt-dlp 或 pip install -U yt-dlp。',
  LOGIN_REQUIRED:
    '在「设置 › 在线视频」中选择已登录的浏览器作为登录态来源，或先在浏览器里登录后再试。',
  COOKIES_UNAVAILABLE:
    '关闭占用 Cookie 的浏览器后重试，或在设置中改用其他浏览器；macOS 首次读取 Chrome Cookie 需要允许钥匙串访问。',
  UNSUPPORTED: '请粘贴单个视频页面地址；播放列表与直播暂不支持。',
  UNAVAILABLE: '确认链接能在浏览器中正常播放；地区受限时可尝试配置代理。',
  NETWORK: '检查网络连接；YouTube 等站点可能需要配置代理（设置 › 在线视频）。',
  DISK_FULL: '清理磁盘空间后重试。',
  DOWNLOAD_FAILED: '可直接重试；若反复失败，先升级 yt-dlp。',
}

export class YtDlpError extends Error {
  readonly code: YtDlpFailureCode
  readonly remedy?: string
  /** 工具原始报错（已脱敏），用于日志与排查。 */
  readonly detail?: string

  constructor(
    code: YtDlpFailureCode,
    message: string,
    options: { remedy?: string; detail?: string } = {}
  ) {
    super(message)
    this.name = 'YtDlpError'
    this.code = code
    this.remedy = options.remedy
    this.detail = options.detail
  }
}

export function createAbortError(message = '下载已取消'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/** 安装缺失时的统一错误。 */
export function toolNotInstalledError(
  binary: string,
  detail?: string
): YtDlpError {
  return new YtDlpError(
    'TOOL_NOT_INSTALLED',
    formatFailureMessage(
      'TOOL_NOT_INSTALLED',
      detail ?? `未在 PATH 中找到 ${binary}。`
    ),
    {
      remedy: FAILURE_REMEDIES.TOOL_NOT_INSTALLED,
      detail,
    }
  )
}

function proxyArgs(proxy?: string): string[] {
  const trimmed = proxy?.trim()
  if (!trimmed) return []
  return ['--proxy', trimmed]
}

function cookieArgs(browser?: CookieBrowser | null): string[] {
  if (!browser) return []
  if (!COOKIE_BROWSERS.includes(browser)) {
    throw new Error(`不支持的浏览器 Cookie 来源: ${String(browser)}`)
  }
  return ['--cookies-from-browser', browser]
}

/** 只解析元数据，不下载。 */
export function buildResolveArgs(
  url: string,
  options: { cookieBrowser?: CookieBrowser | null; proxy?: string } = {}
): string[] {
  return [
    ...COMMON_ARGS,
    ...cookieArgs(options.cookieBrowser),
    ...proxyArgs(options.proxy),
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    '--',
    url,
  ]
}

export interface DownloadArgsOptions {
  /** `<staging>/media.%(ext)s`。 */
  output: string
  audioOnly: boolean
  cookieBrowser?: CookieBrowser | null
  proxy?: string
  /** 字幕轨：语言键与是否自动字幕。 */
  subtitle?: { language: string; auto: boolean } | null
  /** 合并音视频用的 ffmpeg；只在明确解析到绝对路径时传。 */
  ffmpegLocation?: string | null
}

/** 下载媒体（以及可选的一条字幕轨）。 */
export function buildDownloadArgs(
  url: string,
  options: DownloadArgsOptions
): string[] {
  const args = [
    ...COMMON_ARGS,
    ...cookieArgs(options.cookieBrowser),
    ...proxyArgs(options.proxy),
    '--check-formats',
    '--newline',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--no-mtime',
    '--retries',
    '10',
    '--fragment-retries',
    '10',
    '--concurrent-fragments',
    '4',
    '-o',
    options.output,
    '-f',
    options.audioOnly ? YT_DLP_AUDIO_FORMAT : YT_DLP_VIDEO_FORMAT,
  ]

  if (!options.audioOnly) {
    args.push('--merge-output-format', 'mp4/webm/mkv')
  }
  if (options.ffmpegLocation) {
    args.push('--ffmpeg-location', options.ffmpegLocation)
  }
  if (options.subtitle) {
    args.push(
      options.subtitle.auto ? '--write-auto-subs' : '--write-subs',
      '--sub-langs',
      options.subtitle.language,
      '--convert-subs',
      'srt'
    )
  }
  args.push('--', url)
  return args
}

export interface ProgressSample {
  downloaded: number
  total: number | null
  /** 字节/秒；工具没给时为 null。 */
  speed: number | null
  /** 剩余秒数；工具没给时为 null。 */
  eta: number | null
}

/** 解析一行进度（`--progress-template` 的输出）。 */
export function parseProgressLine(line: string): ProgressSample | null {
  const parts = line.trim().split(/\s+/)
  if (parts[0] !== PROGRESS_PREFIX || parts.length < 6) return null

  const num = (value: string | undefined): number | null => {
    if (value === undefined || value === 'NA' || value === 'None') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }

  const downloaded = num(parts[1])
  if (downloaded === null) return null
  return {
    downloaded,
    total: num(parts[2]) ?? num(parts[3]),
    speed: num(parts[4]),
    eta: num(parts[5]),
  }
}

/**
 * 逐个流累计的字节进度：yt-dlp 分别下载画面与声音，每个流的计数从 0 开始。
 * 前一个流结束时把它的字节数计入基数。
 */
export class ProgressTracker {
  private base = 0
  private current = 0

  update(sample: ProgressSample): {
    done: number
    total: number | null
    speed: number | null
    eta: number | null
  } {
    if (sample.downloaded < this.current) this.base += this.current
    this.current = sample.downloaded
    return {
      done: this.base + this.current,
      total:
        sample.total === null
          ? null
          : this.base + Math.max(sample.total, sample.downloaded),
      speed: sample.speed,
      eta: sample.eta,
    }
  }
}

/** 一行进度里除百分比之外的阶段提示（合并 / 提取 / 修复）。 */
export function isProcessingLine(line: string): boolean {
  return /\[(Merger|ExtractAudio|FixupM3u8|FixupTimestamp|VideoRemuxer|Metadata|EmbedSubtitle)\]|Merging formats|Extracting audio|has already been downloaded/i.test(
    line
  )
}

export interface ParsedVideoInfo {
  id: string
  title: string
  uploader?: string
  durationSec?: number
  webpageUrl?: string
  extractor?: string
  manualSubtitles: string[]
  autoSubtitles: string[]
}

/** 读取 `--dump-single-json` 的输出；播放列表 / 直播直接拒绝。 */
export function parseVideoInfo(stdout: string): ParsedVideoInfo {
  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    data = parsed as Record<string, unknown>
  } catch {
    throw new YtDlpError(
      'DOWNLOAD_FAILED',
      formatFailureMessage(
        'DOWNLOAD_FAILED',
        '无法读取视频信息（返回内容不是有效 JSON）。'
      ),
      { remedy: FAILURE_REMEDIES.DOWNLOAD_FAILED }
    )
  }

  if (data._type === 'playlist' || data._type === 'multi_video') {
    throw new YtDlpError(
      'UNSUPPORTED',
      formatFailureMessage('UNSUPPORTED', '该链接是播放列表，暂不支持。'),
      { remedy: FAILURE_REMEDIES.UNSUPPORTED }
    )
  }
  if (
    data.is_live === true ||
    data.live_status === 'is_live' ||
    data.live_status === 'is_upcoming'
  ) {
    throw new YtDlpError(
      'UNSUPPORTED',
      formatFailureMessage(
        'UNSUPPORTED',
        '该链接是直播 / 直播预告，暂不支持。'
      ),
      { remedy: FAILURE_REMEDIES.UNSUPPORTED }
    )
  }

  const text = (value: unknown, max = 300): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed ? trimmed.slice(0, max) : undefined
  }
  const duration =
    typeof data.duration === 'number' &&
    Number.isFinite(data.duration) &&
    data.duration >= 0
      ? data.duration
      : undefined

  return {
    id: text(data.id, 200) ?? 'video',
    title: text(data.title, 300) ?? '在线视频',
    uploader: text(data.uploader, 200) ?? text(data.channel, 200),
    durationSec: duration,
    webpageUrl: text(data.webpage_url, 2000),
    extractor: text(data.extractor_key, 100) ?? text(data.extractor, 100),
    manualSubtitles: subtitleKeys(data.subtitles),
    autoSubtitles: subtitleKeys(data.automatic_captions),
  }
}

function subtitleKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const keys = Object.keys(raw as Record<string, unknown>)
  return keys.filter(
    key =>
      /^[A-Za-z0-9_-]{1,40}$/.test(key) &&
      key !== 'live_chat' &&
      key !== 'live-chat' &&
      key !== 'danmaku'
  )
}

export interface SelectedSubtitleTrack {
  /** yt-dlp 的语言键，例如 `en`、`zh-Hans`、`en-orig`。 */
  language: string
  auto: boolean
}

/** 从人工 / 自动字幕键里选一条（复用平台字幕的评分规则）。 */
export function selectSubtitleTrack(
  info: Pick<ParsedVideoInfo, 'manualSubtitles' | 'autoSubtitles'>,
  options: { sourceLanguage?: string; targetLanguage?: string }
): SelectedSubtitleTrack | null {
  const candidates: PlatformSubtitleCandidate[] = [
    ...info.manualSubtitles.map(language => ({
      path: language,
      language,
      likelyAuto: false,
    })),
    ...info.autoSubtitles.map(language => ({
      path: language,
      language,
      likelyAuto: true,
    })),
  ]
  const best = selectBestPlatformSubtitle(candidates, options)
  if (!best) return null
  return { language: best.path, auto: best.likelyAuto }
}

/** 换一个浏览器的 Cookie 仍可能有帮助的失败。 */
export function worthAnotherCookieBrowser(error: YtDlpError): boolean {
  return error.code === 'LOGIN_REQUIRED' || error.code === 'COOKIES_UNAVAILABLE'
}

/** 按 yt-dlp 的报错判断失败种类。 */
export function classifyFailure(
  stderr: string,
  exitCode: number | null
): YtDlpError {
  const text = redactUrlsInText(stderr)
    .replace(
      /(cookie|authorization|token|password|sessdata)\s*[:=]\s*\S+/gi,
      '$1=<redacted>'
    )
    .trim()
  const lines = text.split('\n').filter(Boolean)
  const errorLine =
    [...lines].reverse().find(line => line.startsWith('ERROR:')) ??
    lines.at(-1) ??
    ''

  const code = detectFailureCode(text, errorLine)
  const detail = errorLine
    .replace(/^ERROR:\s*/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 300)
  const message = formatFailureMessage(
    code,
    detail || `yt-dlp 退出码 ${exitCode ?? '未知'}（未返回更多信息）。`
  )
  return new YtDlpError(code, message, {
    remedy: FAILURE_REMEDIES[code],
    detail: text.slice(-1000),
  })
}

function detectFailureCode(text: string, errorLine: string): YtDlpFailureCode {
  if (/No space left on device|Errno 28|ENOSPC|disk quota/i.test(text)) {
    return 'DISK_FULL'
  }
  if (
    /could not (copy|find).*cookie|failed to decrypt|cookie.*database|keyring|safe storage|keychain|(operation not permitted|permission denied).*cookies/i.test(
      text
    )
  ) {
    return 'COOKIES_UNAVAILABLE'
  }
  if (
    /update.*yt-dlp|yt-dlp.*outdated|signature extraction failed|nsig extraction failed|Unable to extract/i.test(
      errorLine
    )
  ) {
    return 'TOOL_UPDATE_REQUIRED'
  }
  if (
    /Unsupported URL|is not a valid URL|no suitable extractor|not a valid URL/i.test(
      errorLine
    )
  ) {
    return 'UNSUPPORTED'
  }
  if (
    /Your yt-dlp version .+ is older than \d+ days|yt-dlp.*outdated/i.test(
      text
    ) &&
    /HTTP Error 403|403: Forbidden/i.test(errorLine) &&
    !/sign in|log ?in|login required|cookies|members[- ]only|private video|confirm your age|age[- ]restricted|not a bot|authentication/i.test(
      errorLine
    )
  ) {
    return 'TOOL_UPDATE_REQUIRED'
  }
  if (
    /has been removed|video unavailable|not available in your (country|region)|geo[- ]?blocked|Requested format is not available|no video formats/i.test(
      errorLine
    )
  ) {
    return 'UNAVAILABLE'
  }
  if (
    /HTTP Error 401|sign in|log ?in|login required|cookies|members[- ]only|private video|confirm your age|age[- ]restricted|not a bot|authentication/i.test(
      errorLine
    )
  ) {
    return 'LOGIN_REQUIRED'
  }
  if (/HTTP Error 403|403: Forbidden/i.test(errorLine)) {
    return 'DOWNLOAD_FAILED'
  }
  if (
    /unable to download|HTTP Error 5\d\d|HTTP Error 429|timed? ?out|connection|getaddrinfo|name or service not known|nodename nor servname|temporary failure in name resolution|network is unreachable|SSL|EOF occurred|Unable to connect|proxy/i.test(
      errorLine
    )
  ) {
    return 'NETWORK'
  }
  return 'DOWNLOAD_FAILED'
}

function formatFailureMessage(code: YtDlpFailureCode, detail?: string): string {
  const lines = [FAILURE_SUMMARIES[code]]
  if (detail && detail !== FAILURE_SUMMARIES[code]) lines.push(detail)
  lines.push(`建议：${FAILURE_REMEDIES[code]}`)
  return lines.join('\n')
}

/** 按 UTF-8 字节数截断，不切开代理对。 */
function truncateUtf8(text: string, maxBytes: number): string {
  let result = ''
  for (const char of text) {
    const next = result + char
    if (Buffer.byteLength(next, 'utf8') > maxBytes) break
    result = next
  }
  return result
}

/**
 * 截断成安全的文件名：去掉控制字符与路径保留字符，保留中文与空格，不以
 * 点 / 空格 / 连字符开头。标题最多 160 字节（中文约 53 个字），保证在
 * APFS / NTFS 的 255 字节限制内还能放下 id 与扩展名。
 */
export function sanitizeFileName(
  title: string | null | undefined,
  fallback = '在线视频'
): string {
  const cleaned = [...(title ?? '')]
    .map(ch => (/[\u0000-\u001f\u007f/\\:*?"<>|]/.test(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+/, '')
    .replace(/[.\s]+$/, '')
  const limited = truncateUtf8(cleaned, 160)
    .trim()
    .replace(/[.\s]+$/, '')
  return limited || fallback
}

/** 发布用的文件名：标题 + 平台 id，避免同名视频互相覆盖。 */
export function buildOutputBaseName(title: string, id?: string): string {
  const name = sanitizeFileName(title)
  if (!id) return name
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)
  return safeId ? `${name} [${safeId}]` : name
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface SpawnProcess {
  (
    command: string,
    args: readonly string[],
    options: {
      stdio: ['ignore', 'pipe', 'pipe']
      detached?: boolean
      windowsHide?: boolean
    }
  ): ChildProcess
}

/** 执行一次 yt-dlp；中止时结束整个进程组。 */
export async function runYtDlp(
  binary: string,
  args: string[],
  options: {
    signal: AbortSignal
    onLine?: (line: string) => void
    keepStdout?: boolean
    /** 测试注入。 */
    platform?: NodeJS.Platform
    spawn?: SpawnProcess
  }
): Promise<RunResult> {
  const { signal } = options
  if (signal.aborted) throw createAbortError()

  const platform = options.platform ?? process.platform
  const run = options.spawn ?? (spawn as SpawnProcess)

  return await new Promise<RunResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = run(binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: platform !== 'win32',
        windowsHide: true,
      })
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new YtDlpError('DOWNLOAD_FAILED', String(error))
      )
      return
    }

    let stdout = ''
    let pending = ''
    let stderr = ''
    let killTimer: NodeJS.Timeout | null = null
    let settled = false

    const kill = (sig: NodeJS.Signals) => {
      killProcessTree(child, sig, platform, run)
    }
    const onAbort = () => {
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS)
      killTimer.unref?.()
    }

    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (killTimer) clearTimeout(killTimer)
      if (error) reject(error)
      else resolve({ code, stdout, stderr })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (options.keepStdout && stdout.length < STDOUT_LIMIT) stdout += chunk
      if (!options.onLine) return
      pending += chunk
      const lines = pending.split(/\r?\n|\r/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) options.onLine(line)
      }
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL)
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        finish(toolNotInstalledError(binary, error.message))
      } else {
        finish(error)
      }
    })

    child.on('close', code => {
      if (pending.trim()) options.onLine?.(pending)
      if (signal.aborted) {
        finish(
          signal.reason instanceof Error
            ? signal.reason
            : createAbortError('下载已取消')
        )
        return
      }
      finish(undefined, code)
    })
  })
}

function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform,
  run: SpawnProcess
): void {
  const pid = child.pid
  if (!pid) return
  if (platform === 'win32') {
    try {
      const killer = run('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      killer.on('error', () => {
        // 忽略：主进程退出后子进程也随之结束
      })
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // 忽略
      }
    }
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // 忽略：进程可能已经退出
    }
  }
}
