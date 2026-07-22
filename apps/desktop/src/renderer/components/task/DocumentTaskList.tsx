import {
  Calendar,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  FileText,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { MarkdownPreviewDialog } from 'renderer/components/markdown/MarkdownPreviewDialog'
import { Badge } from 'renderer/components/ui/badge'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Progress } from 'renderer/components/ui/progress'
import {
  normalizeTaskKind,
  TaskStatus,
  type TranslationTask,
} from 'shared/types/video'
import { TaskLogs } from './TaskLogs'
import { formatDuration, formatProcessingTime } from './task-time'

const { App } = window

interface DocumentTaskListProps {
  tasks: TranslationTask[]
  onTasksChange: () => void
  onGoUpload?: () => void
}

const getStatusText = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.PENDING:
      return '等待中'
    case TaskStatus.DOWNLOADING:
      return '下载中'
    case TaskStatus.EXTRACTING_AUDIO:
      return '提取音频'
    case TaskStatus.TRANSCRIBING:
      return '语音识别'
    case TaskStatus.POLISHING:
      return '整理文稿'
    case TaskStatus.COMPLETED:
      return '文稿已就绪'
    case TaskStatus.FAILED:
      return '失败'
    case TaskStatus.PAUSED:
      return '已暂停'
    case TaskStatus.CANCELLED:
      return '已取消'
    default:
      return '处理中'
  }
}

const getStatusVariant = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return 'brand' as const
    case TaskStatus.FAILED:
    case TaskStatus.CANCELLED:
      return 'destructive' as const
    case TaskStatus.PAUSED:
      return 'secondary' as const
    case TaskStatus.PENDING:
      return 'outline' as const
    default:
      return 'brand-soft' as const
  }
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

const formatDate = (date: string): string => date.split(' ')[0]

export function DocumentTaskList({
  tasks,
  onTasksChange,
  onGoUpload,
}: DocumentTaskListProps) {
  const documentTasks = useMemo(
    () => tasks.filter(t => normalizeTaskKind(t.kind) === 'document'),
    [tasks]
  )
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null)
  const [previewSource, setPreviewSource] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{
    type: 'error' | 'info'
    text: string
  } | null>(null)

  const failedCount = useMemo(
    () => documentTasks.filter(t => t.status === TaskStatus.FAILED).length,
    [documentTasks]
  )

  const previewTask = useMemo(
    () => documentTasks.find(t => t.id === previewTaskId) ?? null,
    [documentTasks, previewTaskId]
  )

  const openPreview = useCallback(async (taskId: string) => {
    setPreviewTaskId(taskId)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewSource('')
    try {
      const result = await App.getTaskMarkdownContent(taskId)
      if (result.success && result.content != null) {
        setPreviewSource(result.content)
      } else {
        setPreviewError(result.error || '无法加载文稿')
      }
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const closePreview = useCallback(() => {
    setPreviewTaskId(null)
    setPreviewSource('')
    setPreviewError(null)
    setPreviewLoading(false)
  }, [])

  const showError = useCallback((text: string) => {
    setBanner({ type: 'error', text })
  }, [])

  const handleTaskAction = useCallback(
    async (action: string, taskId: string) => {
      setBanner(null)
      try {
        switch (action) {
          case 'pause':
            await App.pauseTask(taskId)
            break
          case 'resume':
            await App.resumeTask(taskId)
            break
          case 'delete':
            if (window.confirm('确定删除这个文稿任务？此操作不可撤销。')) {
              await App.deleteTask(taskId)
              if (previewTaskId === taskId) closePreview()
            }
            break
          case 'retry':
            await App.retryTask(taskId)
            break
          case 'preview':
            await openPreview(taskId)
            return
          case 'open-md': {
            const result = await App.openTaskArtifact(taskId, 'markdown')
            if (!result.success) throw new Error(result.error)
            break
          }
          case 'open-folder': {
            const result = await App.openTaskArtifact(taskId, 'result')
            if (!result.success) throw new Error(result.error)
            break
          }
          case 'copy': {
            const result = await App.getTaskMarkdownContent(taskId)
            if (!result.success || !result.content) {
              throw new Error(result.error || '文稿内容为空')
            }
            await navigator.clipboard.writeText(result.content)
            setBanner({ type: 'info', text: '已复制 Markdown 到剪贴板' })
            break
          }
          default:
            console.warn('未知的任务操作:', action)
        }
        onTasksChange()
      } catch (error) {
        console.error('任务操作失败:', error)
        const message = error instanceof Error ? error.message : String(error)
        showError(`操作失败：${message}`)
      }
    },
    [onTasksChange, showError, openPreview, previewTaskId, closePreview]
  )

  const toggleExpanded = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  if (documentTasks.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">文稿任务</h1>
        </div>
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <FileText className="h-9 w-9 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">暂无文稿任务</h2>
              <p className="text-sm text-muted-foreground">
                添加音视频后，将识别语音并整理为 Markdown 文稿
              </p>
            </div>
            {onGoUpload && (
              <Button size="sm" onClick={onGoUpload} className="mt-1">
                去添加
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">文稿任务</h1>
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <Badge variant="destructive">{failedCount} 个失败</Badge>
          )}
          <Badge variant="outline">{documentTasks.length} 个任务</Badge>
        </div>
      </div>

      {banner && (
        <div
          role="alert"
          className={
            banner.type === 'error'
              ? 'motion-banner-in rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive'
              : 'motion-banner-in rounded-md border border-brand/25 bg-brand/10 px-3 py-2 text-sm text-brand-ink'
          }
        >
          <div className="flex items-start justify-between gap-3">
            <p>{banner.text}</p>
            <button
              type="button"
              className="shrink-0 text-xs underline-offset-2 hover:underline"
              onClick={() => setBanner(null)}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {documentTasks.map(task => {
        const isExpanded = expandedTasks.has(task.id)
        const processingTime = formatProcessingTime(
          task.createdAt,
          task.completedAt
        )
        const isComplete = task.status === TaskStatus.COMPLETED
        const isRunning =
          task.status !== TaskStatus.PENDING &&
          task.status !== TaskStatus.FAILED &&
          task.status !== TaskStatus.COMPLETED &&
          task.status !== TaskStatus.PAUSED &&
          task.status !== TaskStatus.CANCELLED

        return (
          <Card key={task.id} className="gap-0 py-0">
            <CardHeader className="gap-0 px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm font-semibold">
                      {task.videoFile.name}
                    </CardTitle>
                    {(task.sourceUrl || task.videoFile.sourceUrl) && (
                      <p
                        className="mt-0.5 max-w-md truncate text-xs text-muted-foreground"
                        title={task.sourceUrl || task.videoFile.sourceUrl}
                      >
                        {task.sourceUrl || task.videoFile.sourceUrl}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        媒体 {formatDuration(task.videoFile.duration)}
                      </span>
                      {processingTime && <span>处理 {processingTime}</span>}
                      <span>{formatFileSize(task.videoFile.size)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(task.createdAt)}
                      </span>
                    </div>
                    {isComplete && task.outputArtifacts?.polishedMarkdown && (
                      <div className="mt-2">
                        <span className="inline-flex items-center rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand-ink">
                          Markdown
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge
                    variant={getStatusVariant(task.status)}
                    className={
                      getStatusVariant(task.status) === 'brand-soft'
                        ? 'motion-status-live'
                        : undefined
                    }
                  >
                    {getStatusText(task.status)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0"
                    aria-label={isExpanded ? '收起详情' : '展开详情'}
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpanded(task.id)}
                  >
                    <ChevronDown
                      className="motion-chevron h-4 w-4"
                      data-open={isExpanded ? 'true' : undefined}
                    />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 px-5 pb-3.5 pt-0">
              {isRunning && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>进度</span>
                    <span>{Math.round(task.progress)}%</span>
                  </div>
                  <Progress value={task.progress} className="w-full" />
                </div>
              )}

              {isComplete && (
                <p className="text-xs text-brand-ink">
                  文稿已就绪（本机）。点右下角「预览」全屏阅读，或复制 / 打开文件
                  {task.outputArtifacts?.polishedMarkdown
                    ? ` · ${task.outputArtifacts.polishedMarkdown
                        .split(/[/\\]/)
                        .pop()}`
                    : ''}
                  。
                </p>
              )}

              {task.errorMessage && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
                  <p className="text-sm text-destructive">{task.errorMessage}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    可点「重试」；若与润色服务相关，请到设置检查 Ollama / BYOK。
                  </p>
                </div>
              )}

              {isExpanded && (
                <div className="motion-panel-in flex flex-col gap-3 border-t pt-3">
                  <div className="text-sm">
                    <span className="font-medium">源语言:</span>{' '}
                    {task.sourceLanguage}
                  </div>
                  <TaskLogs taskId={task.id} />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <div className="flex flex-wrap gap-2">
                  {task.status === TaskStatus.PENDING ||
                  task.status === TaskStatus.DOWNLOADING ||
                  task.status === TaskStatus.EXTRACTING_AUDIO ||
                  task.status === TaskStatus.TRANSCRIBING ||
                  task.status === TaskStatus.POLISHING ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction('pause', task.id)}
                    >
                      <Pause className="h-4 w-4" />
                      暂停
                    </Button>
                  ) : null}

                  {task.status === TaskStatus.PAUSED && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction('resume', task.id)}
                    >
                      <Play className="h-4 w-4" />
                      继续
                    </Button>
                  )}

                  {(task.status === TaskStatus.FAILED ||
                    task.status === TaskStatus.CANCELLED) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction('retry', task.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      重试
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isComplete && (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleTaskAction('preview', task.id)}
                      >
                        <Eye className="h-4 w-4" />
                        预览
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTaskAction('copy', task.id)}
                      >
                        <Copy className="h-4 w-4" />
                        复制
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTaskAction('open-md', task.id)}
                      >
                        打开文件
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTaskAction('open-folder', task.id)}
                      >
                        <FolderOpen className="h-4 w-4" />
                        文件夹
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleTaskAction('delete', task.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <MarkdownPreviewDialog
        open={previewTaskId != null}
        title={previewTask?.videoFile.name ?? '文稿'}
        source={previewSource}
        loading={previewLoading}
        error={previewError}
        onClose={closePreview}
        onCopy={async () => {
          if (!previewSource) throw new Error('文稿为空')
          await navigator.clipboard.writeText(previewSource)
        }}
        onOpenFile={
          previewTaskId
            ? async () => {
                const result = await App.openTaskArtifact(
                  previewTaskId,
                  'markdown'
                )
                if (!result.success) {
                  setPreviewError(result.error || '无法打开文件')
                }
              }
            : undefined
        }
      />
    </div>
  )
}
