import {
  ArrowLeft,
  Captions,
  Check,
  Download,
  FilePlus2,
  Flame,
  Link2,
  ListChecks,
  LoaderCircle,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Badge } from 'renderer/components/ui/badge'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { cn } from 'renderer/lib/utils'
import {
  collectSubtitleReviewIssues,
  formatSubtitleTime,
  mergeSegmentsPreservingDirtyDrafts,
  type SubtitleReviewIssue,
} from 'shared/subtitle-review'
import { parseStoredAppSettings, type AppSettings } from 'shared/settings'
import {
  TaskStatus,
  type TranscriptionSegment,
  type TranslationTask,
} from 'shared/types/video'

const { App } = window

const issueLabels: Record<SubtitleReviewIssue['kind'], string> = {
  'empty-translation': '空译',
  'fallback-translation': '回退',
  overlap: '重叠',
  'too-short': '过短',
  'too-long': '时长过长',
  'line-too-long': '行过长',
}

function readCurrentSettings(): AppSettings {
  return parseStoredAppSettings(
    localStorage.getItem('video-translate-settings')
  ).settings
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SubtitleReviewScreen() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const dirtyIdsRef = useRef<Set<string>>(new Set())
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [task, setTask] = useState<TranslationTask | null>(null)
  const [segments, setSegments] = useState<TranscriptionSegment[]>([])
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    type: 'error' | 'success'
    text: string
  } | null>(null)

  const loadTask = useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    try {
      const nextTask = await App.getTask(taskId)
      if (!nextTask) throw new Error('任务不存在或已被删除')
      setTask(nextTask)
      setSegments(previous =>
        mergeSegmentsPreservingDirtyDrafts(
          nextTask.segments,
          previous,
          dirtyIdsRef.current
        )
      )
      const media = await App.getTaskMediaUrl(taskId)
      setMediaUrl(media.success ? (media.url ?? null) : null)
      setSelectedId(previous => previous ?? nextTask.segments[0]?.id ?? null)
    } catch (error) {
      setNotice({ type: 'error', text: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    dirtyIdsRef.current.clear()
    setDirtyIds(new Set())
    void loadTask()
  }, [loadTask])

  useEffect(() => {
    const unsubscribe = App.onTaskUpdated(updated => {
      if (updated.id !== taskId) return
      setTask(updated)
      setSegments(previous =>
        mergeSegmentsPreservingDirtyDrafts(
          updated.segments,
          previous,
          dirtyIdsRef.current
        )
      )
    })
    return unsubscribe
  }, [taskId])

  const issues = useMemo(
    () =>
      collectSubtitleReviewIssues(segments, {
        requireTranslation: task?.options?.subtitleProcessingMode !== 'extract',
      }),
    [segments, task?.options?.subtitleProcessingMode]
  )
  const issuesBySegment = useMemo(() => {
    const map = new Map<string, SubtitleReviewIssue[]>()
    for (const issue of issues) {
      const existing = map.get(issue.segmentId) ?? []
      existing.push(issue)
      map.set(issue.segmentId, existing)
    }
    return map
  }, [issues])

  const currentSettings = useMemo(() => {
    try {
      return readCurrentSettings()
    } catch {
      return parseStoredAppSettings().settings
    }
  }, [])

  const seekTo = useCallback((seconds: number, id?: string) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, seconds)
    setSelectedId(id ?? null)
  }, [])

  const selectIssue = (issue: SubtitleReviewIssue) => {
    setSelectedId(issue.segmentId)
    rowRefs.current[issue.segmentId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
    const segment = segments.find(item => item.id === issue.segmentId)
    if (segment) seekTo(segment.start, segment.id)
  }

  const updateDraft = (id: string, patch: Partial<TranscriptionSegment>) => {
    dirtyIdsRef.current.add(id)
    setDirtyIds(previous => new Set(previous).add(id))
    setSegments(previous =>
      previous.map(segment =>
        segment.id === id ? { ...segment, ...patch } : segment
      )
    )
  }

  const saveSegment = async (segment: TranscriptionSegment) => {
    if (!taskId) return
    setBusyAction(`save:${segment.id}`)
    setNotice(null)
    try {
      const result = await App.updateTaskSegment(taskId, segment)
      if (!result.success) throw new Error(result.error || '保存字幕失败')
      dirtyIdsRef.current.delete(segment.id)
      setDirtyIds(previous => {
        const next = new Set(previous)
        next.delete(segment.id)
        return next
      })
      setNotice({ type: 'success', text: '字幕段已保存' })
      await loadTask()
    } catch (error) {
      setNotice({ type: 'error', text: `保存失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const saveAll = async (): Promise<boolean> => {
    if (!taskId || dirtyIdsRef.current.size === 0) return true
    const pending = segments.filter(segment =>
      dirtyIdsRef.current.has(segment.id)
    )
    setBusyAction('save-all')
    setNotice(null)
    try {
      for (const segment of pending) {
        const result = await App.updateTaskSegment(taskId, segment)
        if (!result.success) throw new Error(result.error || '保存字幕失败')
      }
      dirtyIdsRef.current.clear()
      setDirtyIds(new Set())
      setNotice({ type: 'success', text: `已保存 ${pending.length} 段修改` })
      await loadTask()
      return true
    } catch (error) {
      setNotice({ type: 'error', text: `保存全部失败：${errorMessage(error)}` })
      return false
    } finally {
      setBusyAction(null)
    }
  }

  const ensureSaved = async (): Promise<boolean> => {
    if (dirtyIdsRef.current.size === 0) return true
    if (!window.confirm('有未保存修改，是否先保存全部？')) return false
    return saveAll()
  }

  const retranslate = async (segment: TranscriptionSegment) => {
    if (!(await ensureSaved())) return
    if (!taskId) return
    setBusyAction(`translate:${segment.id}`)
    setNotice(null)
    try {
      const result = await App.retranslateTaskSegment(taskId, segment.id)
      if (!result.success) throw new Error(result.error || '重译失败')
      setNotice({ type: 'success', text: '已完成单段重译' })
      await loadTask()
    } catch (error) {
      setNotice({ type: 'error', text: `重译失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const importSubtitles = async () => {
    if (!(await ensureSaved())) return
    setBusyAction('import')
    setNotice(null)
    try {
      const result = await App.importSubtitles(currentSettings)
      if (!result.success || !result.taskId)
        throw new Error(result.error || '导入失败')
      navigate(`/subtitle-review/${result.taskId}`)
    } catch (error) {
      setNotice({ type: 'error', text: `导入失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const attachMedia = async () => {
    if (!taskId) return
    setBusyAction('attach')
    setNotice(null)
    try {
      const result = await App.attachTaskMedia(taskId)
      if (!result.success) throw new Error(result.error || '关联视频失败')
      setNotice({ type: 'success', text: '视频已关联，现在可以预览和烧录字幕' })
      await loadTask()
    } catch (error) {
      setNotice({ type: 'error', text: `关联失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const regenerate = async () => {
    if (!(await ensureSaved()) || !taskId) return
    setBusyAction('export')
    setNotice(null)
    try {
      const result = await App.regenerateTaskSubtitles(taskId)
      if (!result.success) throw new Error(result.error || '导出失败')
      setNotice({ type: 'success', text: '字幕已重新导出到任务输出目录' })
      await loadTask()
    } catch (error) {
      setNotice({ type: 'error', text: `导出失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const burnSubtitles = async () => {
    if (!(await ensureSaved()) || !taskId) return
    setBusyAction('burn')
    setNotice(null)
    try {
      const result = await App.burnTaskSubtitles(taskId, 'bilingual', {
        originalColor: currentSettings.originalSubtitleColor,
        translatedColor: currentSettings.translatedSubtitleColor,
      })
      if (!result.success) throw new Error(result.error || '烧录失败')
      setNotice({ type: 'success', text: '硬字幕视频已生成' })
      await loadTask()
    } catch (error) {
      setNotice({ type: 'error', text: `烧录失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const reuse = async (kind: 'subtitle' | 'document') => {
    if (!(await ensureSaved()) || !taskId) return
    setBusyAction(`reuse:${kind}`)
    setNotice(null)
    try {
      const result = await App.reuseTaskTranscript(taskId, {
        kind,
        targetLanguage: currentSettings.targetLanguage,
        settings: currentSettings,
      })
      if (!result.success || !result.taskId)
        throw new Error(result.error || '复用失败')
      setNotice({
        type: 'success',
        text: kind === 'subtitle' ? '已创建字幕任务' : '已创建文稿任务',
      })
      if (kind === 'subtitle') navigate(`/subtitle-review/${result.taskId}`)
    } catch (error) {
      setNotice({ type: 'error', text: `复用失败：${errorMessage(error)}` })
    } finally {
      setBusyAction(null)
    }
  }

  const leaveWorkbench = () => {
    if (
      dirtyIdsRef.current.size > 0 &&
      !window.confirm('有未保存修改，确定离开校对工作台吗？')
    ) {
      return
    }
    navigate('/')
  }

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyIdsRef.current.size === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        加载校对工作台…
      </div>
    )
  }

  if (!task) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-destructive">
          {notice?.text ?? '无法加载任务'}
        </p>
        <Button variant="outline" onClick={() => navigate('/')}>
          返回任务列表
        </Button>
      </div>
    )
  }

  const isImportedSubtitle =
    task.videoFile.format === 'srt' || task.videoFile.format === 'vtt'
  const canEdit = [
    TaskStatus.COMPLETED,
    TaskStatus.PAUSED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
  ].includes(task.status)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="window-drag sticky top-0 z-10 border-b bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="返回任务列表"
              onClick={leaveWorkbench}
            >
              {' '}
              <ArrowLeft />{' '}
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight">
                字幕校对
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {task.videoFile.name}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void importSubtitles()}
              disabled={busyAction !== null}
            >
              <FilePlus2 /> 导入字幕
            </Button>
            <Button
              size="sm"
              onClick={() => void regenerate()}
              disabled={
                busyAction !== null || !canEdit || segments.length === 0
              }
            >
              {busyAction === 'export' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Download />
              )}{' '}
              导出
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
        <section className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden py-0">
            <div className="aspect-video bg-black">
              {mediaUrl ? (
                <video
                  ref={videoRef}
                  className="h-full w-full"
                  controls
                  preload="metadata"
                  src={mediaUrl}
                  onTimeUpdate={event => {
                    const time = event.currentTarget.currentTime
                    const current = segments.find(
                      segment => time >= segment.start && time <= segment.end
                    )
                    if (current) setActiveId(current.id)
                  }}
                >
                  <track
                    kind="captions"
                    src="data:text/vtt,WEBVTT"
                    srcLang="zh"
                    label="字幕"
                  />
                </video>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white/70">
                  <Video className="size-8" />
                  <p className="text-sm">此任务还没有关联视频</p>
                  {isImportedSubtitle ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void attachMedia()}
                      disabled={busyAction !== null}
                    >
                      <Link2 /> 关联视频
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                {mediaUrl
                  ? '点击字幕段定位视频，播放时会自动跟随'
                  : isImportedSubtitle
                    ? '关联原视频后可预览与烧录'
                    : '视频媒体暂不可用'}
              </div>
              <div className="flex flex-wrap gap-2">
                {isImportedSubtitle && !mediaUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void attachMedia()}
                    disabled={busyAction !== null}
                  >
                    <Link2 /> 关联视频
                  </Button>
                ) : null}
                {mediaUrl ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void burnSubtitles()}
                    disabled={busyAction !== null || !canEdit}
                  >
                    <Flame /> {busyAction === 'burn' ? '烧录中…' : '烧录双语'}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ListChecks className="size-4" />
                  问题清单
                </CardTitle>
                <Badge variant={issues.length ? 'destructive' : 'brand'}>
                  {issues.length ? `${issues.length} 项待处理` : '已通过'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 py-3">
              {issues.length ? (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {issues.map(issue => (
                    <button
                      key={`${issue.segmentId}-${issue.kind}`}
                      type="button"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => selectIssue(issue)}
                    >
                      <span className="min-w-0 truncate">{issue.message}</span>
                      <Badge variant="outline">{issueLabels[issue.kind]}</Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  当前没有检测到明显问题。
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardHeader className="border-b px-4 py-3">
              <CardTitle className="text-sm">复用识别结果</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reuse('subtitle')}
                disabled={busyAction !== null}
              >
                <Captions /> 复用到字幕
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reuse('document')}
                disabled={busyAction !== null}
              >
                <Sparkles /> 复用到文稿
              </Button>
              <span className="text-xs text-muted-foreground">
                使用当前设置 · 目标语言 {currentSettings.targetLanguage}
              </span>
            </CardContent>
          </Card>

          {notice ? (
            <div
              role="status"
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                notice.type === 'error'
                  ? 'border-destructive/25 bg-destructive/10 text-destructive'
                  : 'border-brand/30 bg-brand/10 text-brand-ink'
              )}
            >
              {notice.type === 'success' ? (
                <Check className="mr-1 inline size-4" />
              ) : null}
              {notice.text}
            </div>
          ) : null}
        </section>

        <section className="min-w-0">
          <Card className="h-full py-0">
            <CardHeader className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">
                  字幕段落{' '}
                  <span className="font-normal text-muted-foreground">
                    {segments.length} 段
                  </span>
                  {dirtyIds.size ? (
                    <span className="ml-2 font-normal text-amber-600">
                      · {dirtyIds.size} 段未保存
                    </span>
                  ) : null}
                </CardTitle>
                {dirtyIds.size ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void saveAll()}
                    disabled={busyAction !== null}
                  >
                    <Save /> 保存全部
                  </Button>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  原文与译文均可编辑
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex max-h-[calc(100vh-150px)] flex-col gap-3 overflow-y-auto px-3 py-3">
              {segments.map((segment, index) => {
                const segmentIssues = issuesBySegment.get(segment.id) ?? []
                const saving = busyAction === `save:${segment.id}`
                const translating = busyAction === `translate:${segment.id}`
                return (
                  <div
                    key={segment.id}
                    ref={element => {
                      rowRefs.current[segment.id] = element
                    }}
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      selectedId === segment.id && 'border-ring bg-muted/40',
                      activeId === segment.id && 'ring-2 ring-brand/40'
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left"
                        onClick={() => seekTo(segment.start, segment.id)}
                      >
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium">
                          {index + 1}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {formatSubtitleTime(segment.start)} →{' '}
                          {formatSubtitleTime(segment.end)}
                        </span>
                        <Play className="size-3.5 shrink-0 text-muted-foreground" />
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {segmentIssues.map(issue => (
                          <Badge
                            key={issue.kind}
                            variant="destructive"
                            className="text-[10px]"
                          >
                            {issueLabels[issue.kind]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-medium">
                        原文
                        <textarea
                          className="min-h-16 resize-y rounded-md border bg-background px-2.5 py-2 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          value={segment.originalText}
                          onChange={event =>
                            updateDraft(segment.id, {
                              originalText: event.target.value,
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium">
                        译文
                        <textarea
                          className="min-h-16 resize-y rounded-md border bg-background px-2.5 py-2 text-sm font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          value={segment.translatedText ?? ''}
                          onChange={event =>
                            updateDraft(segment.id, {
                              translatedText: event.target.value,
                            })
                          }
                          disabled={!canEdit}
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          开始
                          <input
                            className="h-7 w-28 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            type="number"
                            min="0"
                            step="0.001"
                            value={segment.start}
                            onChange={event =>
                              updateDraft(segment.id, {
                                start: Number(event.target.value),
                              })
                            }
                            disabled={!canEdit}
                          />
                        </label>
                        <label className="grid gap-1 text-[11px] text-muted-foreground">
                          结束
                          <input
                            className="h-7 w-28 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            type="number"
                            min="0"
                            step="0.001"
                            value={segment.end}
                            onChange={event =>
                              updateDraft(segment.id, {
                                end: Number(event.target.value),
                              })
                            }
                            disabled={!canEdit}
                          />
                        </label>
                        <span className="hidden text-[11px] text-muted-foreground sm:inline">
                          {segment.end > segment.start
                            ? `${(segment.end - segment.start).toFixed(2)} 秒`
                            : '时间无效'}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void retranslate(segment)}
                          disabled={!canEdit || busyAction !== null}
                        >
                          <RefreshCw
                            className={cn(translating && 'animate-spin')}
                          />{' '}
                          重译
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void saveSegment(segment)}
                          disabled={!canEdit || busyAction !== null}
                        >
                          <Save /> {saving ? '保存中…' : '保存'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
              {!segments.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  暂无字幕段落
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
