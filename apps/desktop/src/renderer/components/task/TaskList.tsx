import {
  Calendar,
  Captions,
  ChevronDown,
  ChevronUp,
  Clock,
  FileVideo,
  Flame,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
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
import { TaskStatus, type TranslationTask } from 'shared/types/video'
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
      return '已完成'
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
      return 'default' as const
    case TaskStatus.FAILED:
    case TaskStatus.CANCELLED:
      return 'destructive' as const
    case TaskStatus.PAUSED:
      return 'secondary' as const
    default:
      return 'outline' as const
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
  return date.split(' ')[0] // 只返回日期部分，去掉时间
}

export function TaskList({
  tasks,
  onTasksChange,
  onGoUpload,
}: TaskListProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [openOutputMenuTaskId, setOpenOutputMenuTaskId] = useState<string>()
  const [openBurnMenuTaskId, setOpenBurnMenuTaskId] = useState<string>()
  const [burningTaskIds, setBurningTaskIds] = useState<Set<string>>(new Set())

  const handleBurnSubtitles = useCallback(
    async (taskId: string, mode: SubtitleBurnMode) => {
      setOpenBurnMenuTaskId(undefined)
      setBurningTaskIds(prev => new Set(prev).add(taskId))
      try {
        // 补烧时使用当前设置中的字幕颜色
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
        // 烧录完成后直接打开视频
        const openResult = await App.openTaskArtifact(taskId, 'video')
        if (!openResult.success) {
          // 产物已生成但打开失败时仍提示，不阻断列表刷新
          alert(`烧录完成，但打开视频失败: ${openResult.error}`)
        }
      } catch (error) {
        console.error('补烧硬字幕失败:', error)
        const message = error instanceof Error ? error.message : String(error)
        alert(`烧录失败: ${message}`)
        onTasksChange()
      } finally {
        setBurningTaskIds(prev => {
          const next = new Set(prev)
          next.delete(taskId)
          return next
        })
      }
    },
    [onTasksChange]
  )

  const handleTaskAction = useCallback(
    async (action: string, taskId: string) => {
      try {
        switch (action) {
          case 'pause':
            await App.pauseTask(taskId)
            break
          case 'resume':
            await App.resumeTask(taskId)
            break
          case 'delete':
            if (confirm('确定要删除这个任务吗？')) {
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

        // 刷新任务列表
        onTasksChange()
      } catch (error) {
        console.error('任务操作失败:', error)
        const message = error instanceof Error ? error.message : String(error)
        alert(`操作失败: ${message}`)
      }
    },
    [onTasksChange]
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
        <Badge variant="outline">{tasks.length} 个任务</Badge>
      </div>

      {tasks.map(task => {
        const isExpanded = expandedTasks.has(task.id)
        const isBurning =
          task.status === TaskStatus.BURNING_SUBTITLES ||
          burningTaskIds.has(task.id)
        const canBurnSubtitles =
          (task.status === TaskStatus.COMPLETED || isBurning) &&
          !task.outputArtifacts?.burnedVideo

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
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant={getStatusVariant(task.status)}>
                    {getStatusText(task.status)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-8 p-0"
                    aria-label={isExpanded ? '收起详情' : '展开详情'}
                    onClick={() => toggleTaskExpanded(task.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 px-5 pb-3.5 pt-0">
              {/* 进度条 */}
              {task.status !== TaskStatus.PENDING &&
                task.status !== TaskStatus.FAILED && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{isBurning ? '烧录进度' : '进度'}</span>
                      <span>{Math.round(task.progress)}%</span>
                    </div>
                    <Progress value={task.progress} className="h-1.5" />
                  </div>
                )}

              {/* 错误信息 */}
              {task.errorMessage && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
                  <p className="text-sm text-destructive">
                    {task.errorMessage}
                  </p>
                </div>
              )}

              {/* 展开的详细信息 */}
              {isExpanded && (
                <div className="flex flex-col gap-3 border-t pt-3">
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

                  {/* 任务日志 */}
                  <TaskLogs taskId={task.id} />
                </div>
              )}

              {/* 操作按钮 */}
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
                  {/* 未在任务创建时烧录：完成后可补烧硬字幕 */}
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
                        <div className="absolute bottom-full right-0 z-20 mb-2 min-w-52 rounded-md border bg-background p-1 shadow-md">
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

                  {(task.status === TaskStatus.COMPLETED || isBurning) && (
                    <div className="relative flex">
                      <Button
                        variant="outline"
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
                          ? '查看视频'
                          : '查看字幕'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-l-none px-2"
                        aria-label="展开查看选项"
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
                        <div className="absolute bottom-full right-0 z-20 mb-2 min-w-36 rounded-md border bg-background p-1 shadow-md">
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
                              查看字幕
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
                            查看结果
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
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
