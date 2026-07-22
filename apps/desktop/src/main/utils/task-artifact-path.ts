import fs from 'node:fs'
import path from 'node:path'
import type { ArtifactKind } from '../../shared/ipc'
import type { TranslationTask } from '../../shared/types/video'

type TaskArtifactSource = Pick<TranslationTask, 'videoFile' | 'outputArtifacts'>

export function resolveTaskArtifactPath(
  task: TaskArtifactSource,
  kind: ArtifactKind,
  pathExists: (value: string) => boolean = fs.existsSync
): string | undefined {
  const artifacts = task.outputArtifacts
  const directPath =
    kind === 'video'
      ? artifacts?.burnedVideo
      : kind === 'subtitle'
        ? artifacts?.translatedSubtitle ||
          artifacts?.bilingualSubtitle ||
          artifacts?.originalSubtitle
        : kind === 'markdown'
          ? artifacts?.polishedMarkdown
          : artifacts?.outputDirectory

  if (directPath) return directPath
  if (kind !== 'result') return undefined

  const outputDirectory = path.join(path.dirname(task.videoFile.path), 'output')
  return pathExists(outputDirectory)
    ? outputDirectory
    : path.dirname(task.videoFile.path)
}
