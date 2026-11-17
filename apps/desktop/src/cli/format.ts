import type { TranslationTask } from '../shared/types/video'

export interface CliResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export function summarizeTask(
  task: TranslationTask,
  full = false
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: task.id,
    kind: task.kind,
    status: task.status,
    progress: task.progress,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    detectedLanguage: task.detectedLanguage ?? null,
    errorMessage: task.errorMessage ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
    video: {
      name: task.videoFile.name,
      path: task.videoFile.path,
      duration: task.videoFile.duration,
      format: task.videoFile.format,
      sourceUrl: task.videoFile.sourceUrl ?? task.sourceUrl ?? null,
    },
    artifacts: task.outputArtifacts ?? null,
    segmentCount: task.segments?.length ?? 0,
  }
  if (full) {
    summary.segments = task.segments
    summary.options = task.options ?? null
    summary.logs = task.logs
  }
  return summary
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printText(lines: string | string[]): void {
  const text = Array.isArray(lines) ? lines.join('\n') : lines
  process.stdout.write(`${text.endsWith('\n') ? text : `${text}\n`}`)
}

export function printProgress(message: string): void {
  process.stderr.write(`${message}\n`)
}

export function fail(error: string, json: boolean): number {
  if (json) printJson({ ok: false, error })
  else printText(`错误: ${error}`)
  return 1
}

export function ok(payload: Record<string, unknown>, json: boolean): number {
  if (json) printJson({ ok: true, ...payload })
  else {
    const { message, ...rest } = payload
    if (typeof message === 'string') printText(message)
    const leftover = Object.entries(rest).filter(
      ([, value]) => value !== undefined
    )
    if (leftover.length > 0) {
      printJson({ ok: true, ...Object.fromEntries(leftover) })
    }
  }
  return 0
}
