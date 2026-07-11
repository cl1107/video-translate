import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const APP_TEMP_NAME = 'video-translate'
/** 历史版本使用过的临时目录名（启动/清理时一并处理） */
const LEGACY_TEMP_NAMES = ['video-translate-asr', 'video-translate-whisper']

export interface TempCacheStats {
  path: string
  totalBytes: number
  fileCount: number
  entryCount: number
}

export interface TempCleanupResult {
  freedBytes: number
  removedEntries: number
}

/**
 * 统一管理应用运行时临时文件：
 * - 根目录：os.tmpdir()/video-translate
 * - 任务目录：root/tasks/<taskId>/
 * 中间产物（提取音频、分段、烧录临时字幕）均落在任务目录，任务结束后删除。
 */
export class TempWorkspace {
  readonly rootDir: string
  private readonly tasksDir: string

  constructor(rootDir = path.join(os.tmpdir(), APP_TEMP_NAME)) {
    this.rootDir = rootDir
    this.tasksDir = path.join(rootDir, 'tasks')
  }

  getTaskDir(taskId: string): string {
    return path.join(this.tasksDir, sanitizeTaskId(taskId))
  }

  async ensureRoot(): Promise<string> {
    await fs.mkdir(this.rootDir, { recursive: true })
    await fs.mkdir(this.tasksDir, { recursive: true })
    return this.rootDir
  }

  async ensureTaskDir(taskId: string): Promise<string> {
    const dir = this.getTaskDir(taskId)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async removeTaskDir(taskId: string): Promise<void> {
    await fs
      .rm(this.getTaskDir(taskId), { recursive: true, force: true })
      .catch(() => {})
  }

  /**
   * 清理超过 maxAgeMs 的残留任务目录与历史扁平文件。
   * 进行中的任务目录可通过 excludeTaskIds 保留。
   */
  async cleanupStale(
    maxAgeMs = 24 * 60 * 60 * 1000,
    excludeTaskIds: string[] = []
  ): Promise<TempCleanupResult> {
    await this.ensureRoot()
    const exclude = new Set(excludeTaskIds.map(sanitizeTaskId))
    const now = Date.now()
    let freedBytes = 0
    let removedEntries = 0

    const isStale = (mtimeMs: number | null): boolean => {
      if (mtimeMs === null) return true
      // maxAgeMs <= 0：视为全部过期（便于全量清扫 / 测试）
      if (maxAgeMs <= 0) return true
      return now - mtimeMs >= maxAgeMs
    }

    // 任务子目录
    const taskEntries = await readdirSafe(this.tasksDir)
    for (const entry of taskEntries) {
      if (exclude.has(entry.name)) continue
      const fullPath = path.join(this.tasksDir, entry.name)
      if (!isStale(await getMtimeMs(fullPath))) continue
      const size = await getPathSize(fullPath)
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      freedBytes += size
      removedEntries += 1
    }

    // 根目录下历史扁平文件（旧版 audio_*.wav 等）
    const rootEntries = await readdirSafe(this.rootDir)
    for (const entry of rootEntries) {
      if (entry.name === 'tasks') continue
      const fullPath = path.join(this.rootDir, entry.name)
      if (!isStale(await getMtimeMs(fullPath))) continue
      const size = await getPathSize(fullPath)
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      freedBytes += size
      removedEntries += 1
    }

    // 历史临时目录
    const legacy = await this.cleanupLegacyDirs(maxAgeMs)
    freedBytes += legacy.freedBytes
    removedEntries += legacy.removedEntries

    return { freedBytes, removedEntries }
  }

  /**
   * 清理全部可管理缓存（保留仍在运行的任务目录）。
   */
  async clearCache(excludeTaskIds: string[] = []): Promise<TempCleanupResult> {
    await this.ensureRoot()
    const exclude = new Set(excludeTaskIds.map(sanitizeTaskId))
    let freedBytes = 0
    let removedEntries = 0

    const taskEntries = await readdirSafe(this.tasksDir)
    for (const entry of taskEntries) {
      if (exclude.has(entry.name)) continue
      const fullPath = path.join(this.tasksDir, entry.name)
      const size = await getPathSize(fullPath)
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      freedBytes += size
      removedEntries += 1
    }

    const rootEntries = await readdirSafe(this.rootDir)
    for (const entry of rootEntries) {
      if (entry.name === 'tasks') continue
      const fullPath = path.join(this.rootDir, entry.name)
      const size = await getPathSize(fullPath)
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      freedBytes += size
      removedEntries += 1
    }

    const legacy = await this.cleanupLegacyDirs(0)
    freedBytes += legacy.freedBytes
    removedEntries += legacy.removedEntries

    return { freedBytes, removedEntries }
  }

  async getStats(): Promise<TempCacheStats> {
    await this.ensureRoot()
    const paths = [
      this.rootDir,
      ...LEGACY_TEMP_NAMES.map(name => path.join(os.tmpdir(), name)),
    ]
    let totalBytes = 0
    let fileCount = 0
    let entryCount = 0

    for (const p of paths) {
      try {
        await fs.access(p)
      } catch {
        continue
      }
      const stats = await walkStats(p)
      totalBytes += stats.totalBytes
      fileCount += stats.fileCount
      entryCount += stats.entryCount
    }

    return {
      path: this.rootDir,
      totalBytes,
      fileCount,
      entryCount,
    }
  }

  private async cleanupLegacyDirs(
    maxAgeMs: number
  ): Promise<TempCleanupResult> {
    let freedBytes = 0
    let removedEntries = 0
    const now = Date.now()

    for (const name of LEGACY_TEMP_NAMES) {
      const fullPath = path.join(os.tmpdir(), name)
      try {
        await fs.access(fullPath)
      } catch {
        continue
      }

      if (maxAgeMs > 0) {
        const mtimeMs = await getMtimeMs(fullPath)
        if (mtimeMs !== null && now - mtimeMs < maxAgeMs) {
          // 目录整体较新时，仍可清理内部过期文件
          const inner = await readdirSafe(fullPath)
          for (const entry of inner) {
            const child = path.join(fullPath, entry.name)
            const childMtime = await getMtimeMs(child)
            if (childMtime === null || now - childMtime < maxAgeMs) continue
            const size = await getPathSize(child)
            await fs.rm(child, { recursive: true, force: true }).catch(() => {})
            freedBytes += size
            removedEntries += 1
          }
          continue
        }
      }

      const size = await getPathSize(fullPath)
      await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {})
      freedBytes += size
      removedEntries += 1
    }

    return { freedBytes, removedEntries }
  }
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
}

async function readdirSafe(
  dir: string
): Promise<Array<{ name: string; isDirectory: () => boolean }>> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function getMtimeMs(target: string): Promise<number | null> {
  try {
    const stat = await fs.stat(target)
    return stat.mtimeMs
  } catch {
    return null
  }
}

async function getPathSize(target: string): Promise<number> {
  try {
    const stat = await fs.stat(target)
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0

    const entries = await fs.readdir(target, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      total += await getPathSize(path.join(target, entry.name))
    }
    return total
  } catch {
    return 0
  }
}

async function walkStats(
  target: string
): Promise<{ totalBytes: number; fileCount: number; entryCount: number }> {
  try {
    const stat = await fs.stat(target)
    if (stat.isFile()) {
      return { totalBytes: stat.size, fileCount: 1, entryCount: 1 }
    }
    if (!stat.isDirectory()) {
      return { totalBytes: 0, fileCount: 0, entryCount: 0 }
    }

    const entries = await fs.readdir(target, { withFileTypes: true })
    let totalBytes = 0
    let fileCount = 0
    let entryCount = entries.length
    for (const entry of entries) {
      const child = await walkStats(path.join(target, entry.name))
      totalBytes += child.totalBytes
      fileCount += child.fileCount
      entryCount += child.entryCount
    }
    return { totalBytes, fileCount, entryCount }
  } catch {
    return { totalBytes: 0, fileCount: 0, entryCount: 0 }
  }
}

export const tempWorkspace = new TempWorkspace()
