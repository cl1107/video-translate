import path from 'node:path'
import type { SubtitleOutputLocation } from '../../shared/settings'

/** 根据任务创建时保存的设置解析字幕产物目录。 */
export function resolveSubtitleOutputDirectory(
  videoPath: string,
  location: SubtitleOutputLocation | undefined
): string {
  const sourceDirectory = path.dirname(videoPath)
  return location === 'source-directory'
    ? sourceDirectory
    : path.join(sourceDirectory, 'output')
}
