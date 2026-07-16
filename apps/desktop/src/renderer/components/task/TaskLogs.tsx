import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TaskLog } from 'shared/types/video'
import { cn } from 'renderer/lib/utils'

const { App } = window

interface TaskLogsProps {
  taskId: string
}

export function TaskLogs({ taskId }: TaskLogsProps) {
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadLogs()
  }, [taskId])

  const loadLogs = async () => {
    try {
      setLoading(true)
      const taskLogs = await App.getTaskLogs(taskId)
      setLogs(taskLogs)
    } catch (error) {
      console.error('加载任务日志失败:', error)
    } finally {
      setLoading(false)
    }
  }

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

  // 嵌套在任务卡片内：不用 Card，避免嵌套卡片
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
