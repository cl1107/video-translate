/**
 * 应用数据路径接缝：Electron GUI 与无窗口 CLI 共用同一套 userData。
 *
 * CLI 可在导入数据库 / TaskManager 之前调用 configureAppPaths。
 * 未配置时回退 Electron app.getPath，再回退与桌面应用同名的系统目录。
 */
import { homedir } from 'node:os'
import path from 'node:path'

/** 与 electron-builder productName / package.json displayName 对齐 */
export const APP_USER_DATA_NAME = '视频翻译助手'

export interface AppPaths {
  userData: string
  logs: string
  isPackaged: boolean
}

let override: AppPaths | null = null

export function configureAppPaths(paths: AppPaths): void {
  override = {
    userData: path.resolve(paths.userData),
    logs: path.resolve(paths.logs),
    isPackaged: paths.isPackaged,
  }
}

export function resetAppPathsForTests(): void {
  override = null
}

export function defaultUserDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(
      homedir(),
      'Library',
      'Application Support',
      APP_USER_DATA_NAME
    )
  }
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(homedir(), 'AppData', 'Roaming')
    return path.join(appData, APP_USER_DATA_NAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
  return path.join(xdg, APP_USER_DATA_NAME)
}

/** CLI 默认独立目录，避免 list/get 改写正在运行的桌面任务状态 */
export function defaultCliUserDataDir(): string {
  return `${defaultUserDataDir()}-cli`
}

function electronApp(): typeof import('electron').app | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron') | string
    // Node 直接 require('electron') 会得到二进制路径字符串
    if (!electron || typeof electron === 'string') return undefined
    return electron.app
  } catch {
    return undefined
  }
}

function tryElectronPath(name: 'userData' | 'logs'): string | undefined {
  const app = electronApp()
  if (app?.getPath) return app.getPath(name)
  return undefined
}

function tryElectronPackaged(): boolean | undefined {
  const packaged = electronApp()?.isPackaged
  return typeof packaged === 'boolean' ? packaged : undefined
}

export function getUserDataDir(): string {
  if (override) return override.userData
  const fromEnv = process.env.VIDEO_TRANSLATE_USER_DATA?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return tryElectronPath('userData') ?? defaultUserDataDir()
}

export function getLogsDir(): string {
  if (override) return override.logs
  return tryElectronPath('logs') ?? path.join(getUserDataDir(), 'logs')
}

export function isAppPackaged(): boolean {
  if (override) return override.isPackaged
  return tryElectronPackaged() ?? false
}

export function getDownloadsRoot(): string {
  return path.join(getUserDataDir(), 'downloads')
}

export function getUserDataSubdir(...parts: string[]): string {
  return path.join(getUserDataDir(), ...parts)
}
