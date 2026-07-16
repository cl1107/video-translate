import {
  Calendar,
  Captions,
  ChevronDown,
  Clock,
  FileVideo,
  Flame,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type SubtitleBurnMode,
} from 'shared/settings'
import {
  TaskStatus,
  type TaskOutputArtifacts,
  type TranslationTask,
} from 'shared/types/video'
import { TaskLogs } from './TaskLogs'

const { App } = window

interface TaskListProps {
  tasks: TranslationTask[]
  onTasksChange: () => void
  /** 空状态时跳转到「添加视频」 */
  onGoUpload?: () => void
}

const BURN_MODE_OPTIONS: Array<{
  value: SubtitleBurnMode
  label: string
}> = [
  { value: 'bilingual', label: '双语堆叠（原文上 / 译文下）' },
  { value: 'translated', label: '仅译文' },
  { value: 'original', label: '仅原文' },
]

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
      return '润色中'
    case TaskStatus.TRANSLATING:
      return '翻译中'
    case TaskStatus.GENERATING_SUBTITLES:
      return '生成字幕'
    case TaskStatus.BURNING_SUBTITLES:
      return '烧录字幕'
    case TaskStatus.COMPLETED:
      return '字幕已就绪'
    case TaskStatus.FAILED:
      return '失败'
    case TaskStatus.PAUSED:
      return '已暂停'
    case TaskStatus.CANCELLED:
      return '已取消'
    default:
      return '未知状态'
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

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

const formatDate = (date: string): string => {
  return date.split(' ')[0]
}

/** 完成态产物摘要标签 */
function artifactLabels(artifacts?: TaskOutputArtifacts): string[] {
  if (!artifacts) return []
  const labels: string[] = []
  if (artifacts.bilingualSubtitle || artifacts.bilingualAss) {
    labels.push('双语字幕')
  } else if (artifacts.translatedSubtitle) {
    labels.push('译文字幕')
  } else if (artifacts.originalSubtitle) {
    labels.push('原文字幕')
  }
  if (artifacts.bilingualAss) labels.push('ASS')
  if (artifacts.burnedVideo) labels.push('硬字幕视频')
  return labels
}

export function TaskList({ tasks, onTasksChange, onGoUpload }: TaskListProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [openOutputMenuTaskId, setOpenOutputMenuTaskId] = useState<string>()
  const [openBurnMenuTaskId, setOpenBurnMenuTaskId] = useState<string>()
  const [burningTaskIds, setBurningTaskIds] = useState<Set<string>>(new Set())
  const [banner, setBanner] = useState<{
    type: 'error' | 'info'
    text: string
  } | null>(null)

  const failedCount = useMemo(
    () => tasks.filter(t => t.status === TaskStatus.FAILED).length,
    [tasks]
  )

  // 自定义菜单：Esc 关闭（无 portal 菜单库时的可达性补齐）
  useEffect(() => {
    if (!openOutputMenuTaskId && !openBurnMenuTaskId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenOutputMenuTaskId(undefined)
        setOpenBurnMenuTaskId(undefined)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openOutputMenuTaskId, openBurnMenuTaskId])

  const showError = useCallback((text: string) => {
    setBanner({ type: 'error', text })
  }, [])

  const handleBurnSubtitles = useCallback(
    async (taskId: string, mode: SubtitleBurnMode) => {
      setOpenBurnMenuTaskId(undefined)
      setBurningTaskIds(prev => new Set(prev).add(taskId))
      setBanner(null)
      try {
        let colors:
          | { originalColor?: string; translatedColor?: string }
          | undefined
        try {
          const raw = localStorage.getItem('video-translate-settings')
          const settings = normalizeAppSettings(
            raw ? JSON.parse(raw) : DEFAULT_APP_SETTINGS
          )
          colors = {
            originalColor: settings.originalSubtitleColor,
            translatedColor: settings.translatedSubtitleColor,
          }
        } catch {
          // 使用服务端默认色
        }
        const result = await App.burnTaskSubtitles(taskId, mode, colors)
        if (!result.success) {
          throw new Error(result.error || '烧录失败')
        }
        onTasksChange()
        const openResult = await App.openTaskArtifact(taskId, 'video')
        if (!openResult.success) {
          showError(
            `硬字幕已生成，但无法打开视频：${openResult.error || '未知错误'}`
          )
        }
      } catch (error) {
        console.error('补烧硬字幕失败:', error)
        const message = error instanceof Error ? error.message : String(error)
        showError(`烧录失败：${message}`)
        onTasksChange()
      } finally {
        setBurningTaskIds(prev => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    },
    [onTasksChange, showError]
  )

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
            if (window.confirm('确定删除这个任务？此操作不可撤销。')) {
              await App.deleteTask(taskId)
            }
            break
          case 'retry':
            await App.retryTask(taskId)
            break
          case 'view-video':
          case 'view-subtitle':
          case 'view-output': {
            const kind =
              action === 'view-video'
                ? 'video'
                : action === 'view-subtitle'
                  ? 'subtitle'
                  : 'result'
            const result = await App.openTaskArtifact(taskId, kind)
            if (!result.success) {
              throw new Error(result.error)
            }
            setOpenOutputMenuTaskId(undefined)
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
    [onTasksChange, showError]
  )

  const toggleTaskExpanded = (taskId: string) => {
    const newExpanded = new Set(expandedTasks)
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId)
    } else {
      newExpanded.add(taskId)
    }
    setExpandedTasks(newExpanded)
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">翻译任务</h1>
        </div>
        <Card className="gap-0 py-0">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <FileVideo className="h-9 w-9 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">暂无翻译任务</h2>
              <p className="text-sm text-muted-foreground">
                添加本地视频或在线链接，开始第一个翻译任务
              </p>
            </div>
            {onGoUpload && (
              <Button size="sm" onClick={onGoUpload} className="mt-1">
                去添加视频
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
        <h1 className="text-lg font-semibold">翻译任务</h1>
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <Badge variant="destructive">{failedCount} 个失败</Badge>
          )}
          <Badge variant="outline">{tasks.length} 个任务</Badge>
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

      {tasks.map(task => {
        const isExpanded = expandedTasks.has(task.id)
        const isBurning =
          task.status === TaskStatus.BURNING_SUBTITLES ||
          burningTaskIds.has(task.id)
        const canBurnSubtitles =
          (task.status === TaskStatus.COMPLETED || isBurning) &&
          !task.outputArtifacts?.burnedVideo
        const labels = artifactLabels(task.outputArtifacts)
        const isComplete = task.status === TaskStatus.COMPLETED || isBurning

        return (
          <Card key={task.id} className="gap-0 py-0">
            <CardHeader className="gap-0 px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <FileVideo className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
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
                        {formatDuration(task.videoFile.duration)}
                      </span>
                      <span>{formatFileSize(task.videoFile.size)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDate(task.createdAt)}
                      </span>
                    </div>
                    {isComplete && labels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {labels.map(label => (
                          <span
                            key={label}
                            className="inline-flex items-center rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand-ink"
                          >
                            {label}
                          </span>
                        ))}
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
                    onClick={() => toggleTaskExpanded(task.id)}
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
              {task.status !== TaskStatus.PENDING &&
                task.status !== TaskStatus.FAILED &&
                task.status !== TaskStatus.COMPLETED && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{isBurning ? '烧录进度' : '进度'}</span>
                      <span>{Math.round(task.progress)}%</span>
                    </div>
                    <Progress value={task.progress} className="w-full" />
                  </div>
                )}

              {task.status === TaskStatus.COMPLETED && (
                <p className="text-xs text-brand-ink">
                  字幕已就绪（本机）。可打开字幕，或在结果文件夹查看全部产物
                  {labels.length > 0 ? `：${labels.join(' · ')}。` : '。'}
                </p>
              )}

              {task.errorMessage && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
                  <p className="text-sm text-destructive">{task.errorMessage}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    可点「重试」；若与翻译服务相关，请到设置检查 Ollama。
                  </p>
                </div>
              )}

              {isExpanded && (
                <div className="motion-panel-in flex flex-col gap-3 border-t pt-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="font-medium">源语言:</span>{' '}
                      {task.sourceLanguage}
                    </div>
                    <div>
                      <span className="font-medium">目标语言:</span>{' '}
                      {task.targetLanguage}
                    </div>
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
                  task.status === TaskStatus.POLISHING ||
                  task.status === TaskStatus.TRANSLATING ||
                  task.status === TaskStatus.GENERATING_SUBTITLES ? (
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
                  {canBurnSubtitles && (
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBurning}
                        onClick={() =>
                          setOpenBurnMenuTaskId(current =>
                            current === task.id ? undefined : task.id
                          )
                        }
                      >
                        <Flame className="h-4 w-4" />
                        {isBurning ? '烧录中…' : '烧录'}
                      </Button>
                      {openBurnMenuTaskId === task.id && !isBurning && (
                        <div
                          role="menu"
                          className="absolute bottom-full right-0 z-20 mb-2 min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
                        >
                          <p className="px-2 py-1.5 text-xs text-muted-foreground">
                            选择要烧录的字幕
                          </p>
                          {BURN_MODE_OPTIONS.map(option => (
                            <Button
                              key={option.value}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() =>
                                void handleBurnSubtitles(task.id, option.value)
                              }
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {isComplete && (
                    <div className="relative flex">
                      <Button
                        variant="default"
                        size="sm"
                        className="rounded-r-none border-r-0"
                        disabled={isBurning}
                        onClick={() =>
                          handleTaskAction(
                            task.outputArtifacts?.burnedVideo
                              ? 'view-video'
                              : 'view-subtitle',
                            task.id
                          )
                        }
                      >
                        {task.outputArtifacts?.burnedVideo ? (
                          <FileVideo className="h-4 w-4" />
                        ) : (
                          <Captions className="h-4 w-4" />
                        )}
                        {task.outputArtifacts?.burnedVideo
                          ? '打开视频'
                          : '打开字幕'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-l-none px-2"
                        aria-label="更多打开方式"
                        disabled={isBurning}
                        onClick={() =>
                          setOpenOutputMenuTaskId(current =>
                            current === task.id ? undefined : task.id
                          )
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      {openOutputMenuTaskId === task.id && (
                        <div
                          role="menu"
                          className="absolute bottom-full right-0 z-20 mb-2 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
                        >
                          {task.outputArtifacts?.burnedVideo && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              onClick={() =>
                                handleTaskAction('view-subtitle', task.id)
                              }
                            >
                              <Captions className="h-4 w-4" />
                              打开字幕
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start"
                            onClick={() =>
                              handleTaskAction('view-output', task.id)
                            }
                          >
                            <FolderOpen className="h-4 w-4" />
                            打开结果文件夹
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isBurning}
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
    </div>
  )
}
