import { Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Label } from 'renderer/components/ui/label'
import type { UpdateCheckerStatus } from 'shared/update-checker'

const { App } = window

function formatCheckedAt(at: number | null): string {
  if (!at) return '从未检查'
  return new Date(at).toLocaleString()
}

/** 设置页「系统」分区里的软件更新卡片：开关自动检查、手动检查、前往下载 */
export function UpdateSettingsCard() {
  const [status, setStatus] = useState<UpdateCheckerStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const runCheck = async () => {
    setChecking(true)
    setActionError(null)
    try {
      const result = await App.checkForUpdates()
      if (result.status) setStatus(result.status)
      if (result.error) setActionError(result.error)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }

  const toggleAutoCheck = async () => {
    if (!status) return
    const next = !status.autoCheck
    setStatus({ ...status, autoCheck: next })
    try {
      const result = await App.setUpdateAutoCheck(next)
      if (result.status) setStatus(result.status)
    } catch {
      setStatus(status)
    }
  }

  const latest = status?.latest

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">软件更新</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">当前版本</span>
          <span className="font-mono text-xs">
            {status ? `v${status.currentVersion}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">上次检查</span>
          <span className="text-xs">
            {status ? formatCheckedAt(status.lastCheckedAt) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="update-auto-check" className="text-sm font-normal">
            自动检查更新
          </Label>
          <input
            id="update-auto-check"
            type="checkbox"
            className="h-4 w-4 accent-brand"
            checked={status?.autoCheck ?? false}
            onChange={() => void toggleAutoCheck()}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          每天自动检查一次，仅提醒、不自动下载安装；发现新版本时会在窗口右下角提示。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runCheck()}
            disabled={checking}
          >
            {checking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            检查更新
          </Button>
          {latest && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void App.openExternalUrl(latest.url)}
            >
              <Download className="h-4 w-4" />
              前往下载 v{latest.version}
            </Button>
          )}
        </div>
        {actionError && (
          <p className="text-xs text-destructive">检查失败：{actionError}</p>
        )}
        {!actionError && status?.state === 'up-to-date' && (
          <p className="text-xs text-muted-foreground">已是最新版本。</p>
        )}
        {!actionError && status?.state === 'available' && latest && (
          <p className="text-xs text-muted-foreground">
            发现新版本 v{latest.version}，可前往发布页下载。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
