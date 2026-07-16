import type { CSSProperties } from 'react'
import type { SystemCheckProgress } from '../../../shared/system-check'

export function SystemCheckProgressView({
  progress,
}: {
  progress: SystemCheckProgress
}) {
  const ratio = Math.min(1, Math.max(0, progress.percent / 100))

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{progress.message}</span>
        <span className="font-medium tabular-nums">{progress.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="系统依赖检查进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        className="h-2 w-full overflow-hidden rounded-full bg-brand/20"
      >
        <div
          className="motion-progress-fill h-full bg-brand"
          style={{ '--progress': ratio } as CSSProperties}
        />
      </div>
    </div>
  )
}
