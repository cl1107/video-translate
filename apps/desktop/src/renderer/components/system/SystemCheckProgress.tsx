import type { SystemCheckProgress } from '../../../shared/system-check'

export function SystemCheckProgressView({
  progress,
}: {
  progress: SystemCheckProgress
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3 bg-muted/40">
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
          className="h-full bg-brand transition-[width] duration-200"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  )
}
