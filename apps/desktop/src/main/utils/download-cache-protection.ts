import path from 'node:path'
import type { TranslationTask } from '../../shared/types/video'

type DownloadCacheTask = Pick<
  TranslationTask,
  'videoFile' | 'platformSubtitlePath' | 'outputArtifacts'
>

export interface DownloadCacheProtection {
  preserveRoot: boolean
  topLevelEntries: Set<string>
}

function normalizeEntryName(name: string): string {
  return process.platform === 'win32' ? name.toLowerCase() : name
}

export function isProtectedDownloadCacheEntry(
  protection: DownloadCacheProtection,
  entryName: string
): boolean {
  return protection.topLevelEntries.has(normalizeEntryName(entryName))
}

/** 找出下载缓存中属于用户源文件或最终产物的顶层条目。 */
export function resolveDownloadCacheProtection(
  taskRoot: string,
  task: DownloadCacheTask
): DownloadCacheProtection {
  const root = path.resolve(taskRoot)
  const artifacts = task.outputArtifacts
  const protectedPaths = [
    task.videoFile.path,
    task.platformSubtitlePath,
    artifacts?.outputDirectory,
    artifacts?.originalSubtitle,
    artifacts?.translatedSubtitle,
    artifacts?.bilingualSubtitle,
    artifacts?.bilingualAss,
    artifacts?.burnedVideo,
    artifacts?.polishedMarkdown,
  ]

  const topLevelEntries = new Set<string>()
  let preserveRoot = false

  for (const value of protectedPaths) {
    if (!value) continue
    const relative = path.relative(root, path.resolve(value))
    if (relative === '') {
      preserveRoot = true
      continue
    }
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue
    const topLevel = relative.split(path.sep)[0]
    if (topLevel) topLevelEntries.add(normalizeEntryName(topLevel))
  }

  return { preserveRoot, topLevelEntries }
}
