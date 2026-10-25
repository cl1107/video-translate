import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import {
  LATEST_RELEASE_API_URL,
  UPDATE_FIRST_CHECK_DELAY_MS,
  UPDATE_TICK_INTERVAL_MS,
  applyUpdateCheckOutcome,
  isAutoCheckDue,
  parseLatestRelease,
  type UpdateCheckerStatus,
  type UpdateCheckOutcome,
  type UpdateReleaseInfo,
} from '../../shared/update-checker'

const STORE_FILE = 'update-checker.json'
const FETCH_TIMEOUT_MS = 10_000

/** 落盘的偏好与记录；status 里可推导的运行态不存 */
interface PersistedState {
  autoCheck: boolean
  lastCheckedAt: number | null
  dismissedVersion: string | null
}

const DEFAULT_PERSISTED: PersistedState = {
  autoCheck: true,
  lastCheckedAt: null,
  dismissedVersion: null,
}

/**
 * 更新提醒主进程服务：静默检查 GitHub 最新 release，状态经 IPC 推给渲染进程
 * 的右下角浮窗。只提醒不安装，用户自行前往发布页下载。
 *
 * 判据（间隔、静默失败、忽略版本、时钟回拨）都在 shared/update-checker 的纯函数里；
 * 这里只做 Electron 接线：持久化到 userData、节拍器、webContents 推送。
 */
class UpdateCheckerService {
  private window: BrowserWindow | null = null
  private status: UpdateCheckerStatus | null = null
  private persisted: PersistedState = { ...DEFAULT_PERSISTED }
  private loaded = false
  private checking = false
  private firstTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null

  /** 在应用就绪后调用：读偏好、起节拍器（首拍延迟 + 每小时看是否到期） */
  start(window: BrowserWindow): void {
    this.attachWindow(window)
    this.loadPersisted()

    this.firstTimer = setTimeout(() => {
      void this.autoTick()
    }, UPDATE_FIRST_CHECK_DELAY_MS)
    this.tickTimer = setInterval(() => {
      void this.autoTick()
    }, UPDATE_TICK_INTERVAL_MS)
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window
  }

  getStatus(): UpdateCheckerStatus {
    if (!this.status) {
      this.status = {
        state: 'idle',
        currentVersion: app.getVersion(),
        latest: null,
        lastCheckedAt: null,
        autoCheck: DEFAULT_PERSISTED.autoCheck,
        dismissedVersion: null,
        error: null,
      }
    }
    return this.status
  }

  /**
   * 检查一次。manual=true 时失败会写入 status.error 给设置页展示；
   * 静默检查失败只记时间，不打扰（见 applyUpdateCheckOutcome）。
   */
  async checkNow(manual: boolean): Promise<UpdateCheckerStatus> {
    if (this.checking) return this.getStatus()
    this.checking = true
    this.update(applyUpdateCheckOutcome(this.getStatus(), { kind: 'start' }))

    let outcome: UpdateCheckOutcome
    try {
      const result = await this.fetchLatestRelease()
      const at = Date.now()
      outcome = result.ok
        ? { kind: 'found', release: result.release, at }
        : { kind: 'failure', at, manual, message: result.message }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = { kind: 'failure', at: Date.now(), manual, message }
    } finally {
      this.checking = false
    }

    this.update(applyUpdateCheckOutcome(this.getStatus(), outcome))
    this.savePersisted()
    return this.getStatus()
  }

  /** 「忽略此版本」：持久化，重启后同版本不再提醒 */
  dismiss(version: string): void {
    const trimmed = typeof version === 'string' ? version.trim() : ''
    if (!trimmed) return
    this.persisted = { ...this.persisted, dismissedVersion: trimmed }
    this.savePersisted()
    this.update({ ...this.getStatus(), dismissedVersion: trimmed })
  }

  setAutoCheck(enabled: boolean): void {
    this.persisted = { ...this.persisted, autoCheck: Boolean(enabled) }
    this.savePersisted()
    this.update({ ...this.getStatus(), autoCheck: Boolean(enabled) })
    // 打开时若已到期（比如从未检查过），补一拍，不必等下一个节拍
    if (enabled && isAutoCheckDue(this.getStatus().lastCheckedAt, Date.now())) {
      void this.checkNow(false)
    }
  }

  dispose(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.firstTimer = null
    this.tickTimer = null
    this.window = null
  }

  private async autoTick(): Promise<void> {
    const status = this.getStatus()
    if (!status.autoCheck) return
    if (!isAutoCheckDue(status.lastCheckedAt, Date.now())) return
    await this.checkNow(false)
  }

  private update(next: UpdateCheckerStatus): void {
    this.status = next
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(
        IpcChannels.updateStatusChanged,
        this.getStatus()
      )
    }
  }

  private async fetchLatestRelease(): Promise<
    { ok: true; release: UpdateReleaseInfo } | { ok: false; message: string }
  > {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'video-translate-update-check',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      return { ok: false, message: `GitHub 返回 HTTP ${response.status}` }
    }
    const release = parseLatestRelease(await response.json())
    if (!release) return { ok: false, message: '响应格式异常' }
    return { ok: true, release }
  }

  private loadPersisted(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const file = path.join(app.getPath('userData'), STORE_FILE)
      if (!existsSync(file)) return
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return
      const record = parsed as Record<string, unknown>
      this.persisted = {
        autoCheck: record.autoCheck !== false,
        lastCheckedAt:
          typeof record.lastCheckedAt === 'number'
            ? record.lastCheckedAt
            : null,
        dismissedVersion:
          typeof record.dismissedVersion === 'string'
            ? record.dismissedVersion
            : null,
      }
      this.status = { ...this.getStatus(), ...this.persisted }
    } catch (error) {
      console.warn('读取更新检查记录失败:', error)
    }
  }

  private savePersisted(): void {
    try {
      const dir = app.getPath('userData')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path.join(dir, STORE_FILE),
        JSON.stringify(this.persisted, null, 2)
      )
    } catch (error) {
      console.warn('写入更新检查记录失败:', error)
    }
  }
}

export const updateChecker = new UpdateCheckerService()
