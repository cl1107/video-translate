/**
 * 更新提醒的共享契约与纯逻辑（主进程 / 渲染进程共用，禁止引入 Node / Electron 依赖）。
 *
 * 形态是「提醒，不是自动更新」：主进程静默拉取 GitHub 最新正式版，发现新版本时
 * 由渲染进程在右下角浮窗提示，用户自行前往发布页下载。不下载安装包、不换包，
 * 因此不依赖代码签名。判据借鉴 BaoCut（JimLiu/baocut）app-update-rules 的公开设计：
 * 静默失败不打扰、同一版本可忽略、时钟回拨兜底、清单字段逐项校验。
 */

export const UPDATE_FEED_REPO = 'cl1107/video-translate'
/** releases/latest 只返回最新正式版，自动排除 draft 与 prerelease */
export const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_FEED_REPO}/releases/latest`
export const RELEASES_PAGE_URL = `https://github.com/${UPDATE_FEED_REPO}/releases/latest`

/** 启动后首次自动检查的延迟：等依赖检查、任务恢复等启动高峰过去 */
export const UPDATE_FIRST_CHECK_DELAY_MS = 20_000
/** 两次自动检查的最小间隔：24 小时 */
export const UPDATE_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 静默节拍：每小时看一次是否到期，睡眠唤醒后不必等满间隔 */
export const UPDATE_TICK_INTERVAL_MS = 60 * 60 * 1000

export interface UpdateReleaseInfo {
  version: string
  /** Release 标题（缺省与 tag 相同） */
  name: string
  /** Release 说明（Markdown 原文，界面截断展示） */
  notes: string
  /** Release 页面链接（https://github.com/...） */
  url: string
  publishedAt: string | null
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  /** 仅手动检查失败会停留在此态给界面反馈；静默失败保持原显示态 */
  | 'error'

export interface UpdateCheckerStatus {
  state: UpdateState
  /** 本机应用版本（app.getVersion()，不含 v 前缀） */
  currentVersion: string
  latest: UpdateReleaseInfo | null
  lastCheckedAt: number | null
  autoCheck: boolean
  /** 「忽略此版本」的持久化记录；同版本重启后不再提醒 */
  dismissedVersion: string | null
  /** 最近一次手动检查的失败原因；静默失败不写入 */
  error: string | null
}

/** 剥掉 tag 的 v 前缀（release/latest 的 tag_name 形如 v0.8.2） */
export function normalizeVersionTag(tag: string): string {
  return tag.trim().replace(/^[vV]/, '')
}

/**
 * 点分版本号比较：a>b 返回 1，a<b 返回 -1，相等返回 0。
 * 缺段与读不懂的段都当 0；预发布段（如 0.8.3-beta）不参与语义化比较——
 * releases/latest 不会返回 prerelease，本机版本也不带预发布号，够用。
 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .trim()
      .split(/[.-]/)
      .map(part => (/^\d+$/.test(part) ? Number(part) : 0))
  const left = parts(a)
  const right = parts(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** 这一拍要不要自动检查：从未查过、或距上次满间隔；时钟回拨（上次在未来）视为到期 */
export function isAutoCheckDue(
  lastCheckedAt: number | null,
  now: number,
  intervalMs: number = UPDATE_AUTO_CHECK_INTERVAL_MS
): boolean {
  if (lastCheckedAt === null || lastCheckedAt > now) return true
  return now - lastCheckedAt >= intervalMs
}

export type UpdateCheckOutcome =
  | { kind: 'start' }
  | { kind: 'found'; release: UpdateReleaseInfo; at: number }
  | { kind: 'up-to-date'; at: number }
  | { kind: 'failure'; at: number; manual: boolean; message: string }

/**
 * 状态转移：
 * - start：进 checking，清掉上一次手动失败的文案；
 * - found：比本机新才进 available（latest 只在有新版本时保留），否则已是最新；
 * - failure：手动检查要给界面反馈（进 error）；静默失败绝不打扰——保持原显示态
 *   （尤其不能冲掉已发现的 available），只记检查时间。
 */
export function applyUpdateCheckOutcome(
  status: UpdateCheckerStatus,
  outcome: UpdateCheckOutcome
): UpdateCheckerStatus {
  switch (outcome.kind) {
    case 'start':
      return { ...status, state: 'checking', error: null }
    case 'found': {
      const newer =
        compareVersions(
          outcome.release.version,
          normalizeVersionTag(status.currentVersion)
        ) > 0
      return {
        ...status,
        state: newer ? 'available' : 'up-to-date',
        latest: newer ? outcome.release : null,
        lastCheckedAt: outcome.at,
        error: null,
      }
    }
    case 'up-to-date':
      return {
        ...status,
        state: 'up-to-date',
        latest: null,
        lastCheckedAt: outcome.at,
        error: null,
      }
    case 'failure': {
      if (!outcome.manual) {
        return { ...status, lastCheckedAt: outcome.at }
      }
      // 手动检查失败但手里已有可用的新版本信息：不把它冲掉
      const keepAvailable = status.state === 'available'
      return {
        ...status,
        state: keepAvailable ? 'available' : 'error',
        lastCheckedAt: outcome.at,
        error: outcome.message,
      }
    }
  }
}

/**
 * 从 GitHub releases/latest 载荷提取需要的字段；不信任外部数据，逐字段校验，
 * 不合规整份拒绝（返回 null，调用方按检查失败处理）。
 */
export function parseLatestRelease(payload: unknown): UpdateReleaseInfo | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null
  }
  const record = payload as Record<string, unknown>
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : ''
  if (!tag) return null
  const url = typeof record.html_url === 'string' ? record.html_url : ''
  if (!url.startsWith('https://github.com/')) return null
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  return {
    version: normalizeVersionTag(tag),
    name: name || tag,
    notes: typeof record.body === 'string' ? record.body : '',
    url,
    publishedAt:
      typeof record.published_at === 'string' ? record.published_at : null,
  }
}

/** 浮窗预览用：去掉常见 Markdown 标记，压成一段截断的纯文本 */
export function releaseNotesPreview(notes: string, maxChars = 140): string {
  const text = notes
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~_]/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim().replace(/^[-+]\s+/, ''))
    .filter(Boolean)
    .join(' · ')
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…`
}
