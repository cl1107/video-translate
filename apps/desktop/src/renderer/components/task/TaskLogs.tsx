import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from 'renderer/lib/utils'
import type { TaskLog } from 'shared/types/video'

const { App } = window

interface TaskLogsProps {
  taskId: string
  /**
   * 进行中任务自动轮询间隔（ms）；0 表示不轮询。
   * 默认 2s，避免只加载一次导致后续日志不显示。
   */
  pollIntervalMs?: number
}

export function TaskLogs({ taskId, pollIntervalMs = 2000 }: TaskLogsProps) {
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [loading, setLoading] = useState(true)

  const loadLogs = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const taskLogs = await App.getTaskLogs(taskId)
      setLogs(taskLogs)
    } catch (error) {
      console.error('加载任务日志失败:', error)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void loadLogs(false)

    // 任务状态/进度更新时刷新（含润色完成、失败）
    const unsubUpdated = App.onTaskUpdated(task => {
      if (task.id === taskId) void loadLogs(true)
    })

    // 长耗时阶段（ASR/润色）期间可能长时间无 taskUpdated，轮询兜底
    let timer: ReturnType<typeof setInterval> | undefined
    if (pollIntervalMs > 0) {
      timer = setInterval(() => {
        void loadLogs(true)
      }, pollIntervalMs)
    }

    return () => {
      unsubUpdated()
      if (timer) clearInterval(timer)
    }
  }, [taskId, loadLogs, pollIntervalMs])

  const getLogIcon = (level: TaskLog['level']) => {
    switch (level) {
      case 'success':
        return <CheckCircle className="h-3.5 w-3.5 text-brand-ink" />
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-destructive" />
      case 'warn':
        return (
          <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        )
      default:
        return <Info className="h-3.5 w-3.5 text-muted-foreground" />
    }
  }

  const getLogRowClass = (level: TaskLog['level']) => {
    switch (level) {
      case 'success':
        return 'border-brand/20 bg-brand/8'
      case 'error':
        return 'border-destructive/20 bg-destructive/8'
      case 'warn':
        return 'border-amber-500/20 bg-amber-500/8'
      default:
        return 'border-border/80 bg-background/60'
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 1,
    })
  }

  return (
    <section
      className="rounded-lg border bg-muted/30"
      aria-label="处理日志"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Info className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-medium text-foreground">
          处理日志
          {!loading && (
            <span className="ml-1 text-muted-foreground">({logs.length})</span>
          )}
        </h3>
      </header>

      <div className="px-2 py-2">
        {loading ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            加载中…
          </p>
        ) : logs.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            暂无日志
          </p>
        ) : (
          <ol
            className="max-h-72 space-y-1.5 overflow-y-auto select-text"
            style={{ userSelect: 'text' }}
          >
            {logs.map(log => (
              <li
                key={log.id}
                className={cn(
                  'rounded-md border px-2.5 py-2 select-text',
                  getLogRowClass(log.level)
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{getLogIcon(log.level)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-medium text-foreground select-text">
                        {log.message}
                      </p>
                      <time
                        className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                        dateTime={log.timestamp}
                      >
                        {formatTime(log.timestamp)}
                      </time>
                    </div>
                    {log.details ? (
                      <p className="mt-0.5 break-all font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
                        {log.details}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
