import { Download, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'renderer/components/ui/button'
import {
  releaseNotesPreview,
  type UpdateCheckerStatus,
} from 'shared/update-checker'

const { App } = window

/**
 * 右下角更新提醒浮窗：主进程发现新版本后经 IPC 推送状态，这里只负责展示。
 * 「忽略此版本」持久化到主进程（同版本重启后不再提醒）；右上角 × 只收起本次，
 * 下次启动如有新版本仍会提醒。
 */
export function UpdateToast() {
  const [status, setStatus] = useState<UpdateCheckerStatus | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let active = true
    App.getUpdateStatus()
      .then(result => {
        if (active && result.success) setStatus(result.status)
      })
      .catch(() => {})
    const unsubscribe = App.onUpdateStatusChanged(setStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const latest = status?.latest
  const visible =
    status?.state === 'available' &&
    latest &&
    latest.version !== status.dismissedVersion &&
    !hidden
  if (!status || !visible || !latest) return null

  return (
    <aside
      role="status"
      aria-label={`发现新版本 v${latest.version}`}
      className="motion-toast-in fixed right-6 bottom-6 z-50 w-84 rounded-lg border bg-card/95 p-4 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium tracking-tight text-foreground">
          发现新版本 v{latest.version}
        </p>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="关闭提醒"
          className="-m-1 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {latest.notes && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {releaseNotesPreview(latest.notes)}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => void App.openExternalUrl(latest.url)}
        >
          <Download className="h-3.5 w-3.5" />
          <span>前往下载</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            setHidden(true)
            void App.dismissUpdate(latest.version)
          }}
        >
          忽略此版本
        </Button>
      </div>
    </aside>
  )
}
