import appLogo from 'assets/logo-transparent.png'
import {
  Captions,
  FileText,
  ListTodo,
  Settings,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DocumentTaskList } from 'renderer/components/task/DocumentTaskList'
import { TaskList } from 'renderer/components/task/TaskList'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'
import { Button } from 'renderer/components/ui/button'
import { VideoUploader } from 'renderer/components/video/VideoUploader'
import { cn } from 'renderer/lib/utils'
import {
  normalizeTaskKind,
  type TaskKind,
  type TranslationTask,
} from 'shared/types/video'

// The "App" comes from the context bridge in preload/index.ts
const { App } = window

type WorkMode = TaskKind
type PanelTab = 'upload' | 'tasks'

const WORK_MODE_STORAGE_KEY = 'video-translate-work-mode'

function loadWorkMode(): WorkMode {
  try {
    const raw = localStorage.getItem(WORK_MODE_STORAGE_KEY)
    return raw === 'document' ? 'document' : 'subtitle'
  } catch {
    return 'subtitle'
  }
}

export function MainScreen() {
  const [tasks, setTasks] = useState<TranslationTask[]>([])
  const [workMode, setWorkMode] = useState<WorkMode>(() => loadWorkMode())
  const [activeTab, setActiveTab] = useState<PanelTab>('upload')
  const navigate = useNavigate()

  const loadTasks = useCallback(async () => {
    try {
      // 一次取全量，按 kind 过滤，切换工作流时无需重复请求
      const allTasks = await App.getAllTasks()
      setTasks(
        allTasks.map(task => ({
          ...task,
          kind: normalizeTaskKind(task.kind),
        }))
      )
    } catch (error) {
      console.error('加载任务失败:', error)
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  useEffect(() => {
    const unsubscribeTaskUpdated = App.onTaskUpdated(
      (updatedTask: TranslationTask) => {
        const normalized = {
          ...updatedTask,
          kind: normalizeTaskKind(updatedTask.kind),
        }
        setTasks(prevTasks => {
          const index = prevTasks.findIndex(task => task.id === normalized.id)
          if (index >= 0) {
            const newTasks = [...prevTasks]
            newTasks[index] = normalized
            return newTasks
          }
          return [normalized, ...prevTasks]
        })
      }
    )

    const unsubscribeTaskDeleted = App.onTaskDeleted((taskId: string) => {
      setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId))
    })

    return () => {
      unsubscribeTaskUpdated()
      unsubscribeTaskDeleted()
    }
  }, [])

  const switchWorkMode = (mode: WorkMode) => {
    setWorkMode(mode)
    try {
      localStorage.setItem(WORK_MODE_STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  const visibleTasks = useMemo(
    () => tasks.filter(t => normalizeTaskKind(t.kind) === workMode),
    [tasks, workMode]
  )

  const handleUploadSuccess = () => {
    setActiveTab('tasks')
    loadTasks()
  }

  const isDocument = workMode === 'document'

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/*
        顶栏三簇（角色分层，非双胞胎 segmented）：
        左：身份 + 次级工作流（字幕|文稿）
        右主：面板主 chrome（添加|任务）
        最右：utility（主题|设置）
      */}
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative shrink-0">
                <img
                  src={appLogo}
                  alt="视频翻译助手"
                  className="h-8 w-8 select-none"
                  draggable={false}
                />
                <span
                  aria-hidden
                  className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-brand ring-2 ring-card"
                />
              </div>
              <span className="truncate text-base font-semibold tracking-tight text-foreground">
                视频翻译助手
              </span>
            </div>

            {/* 工作流：次级 context — 无 muted 托盘，字重/色阶区分 */}
            <nav
              className="hidden items-center gap-0.5 sm:flex"
              aria-label="工作流"
            >
              <span
                aria-hidden
                className="mx-0.5 h-5 w-px shrink-0 bg-border"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => switchWorkMode('subtitle')}
                aria-current={workMode === 'subtitle' ? 'page' : undefined}
                className={cn(
                  'h-8 gap-1.5 px-2.5 text-muted-foreground transition-[background-color,color,box-shadow] duration-150 hover:text-foreground',
                  workMode === 'subtitle' &&
                    'bg-muted/80 font-medium text-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                <Captions className="h-4 w-4" />
                <span>字幕</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => switchWorkMode('document')}
                aria-current={workMode === 'document' ? 'page' : undefined}
                className={cn(
                  'h-8 gap-1.5 px-2.5 text-muted-foreground transition-[background-color,color,box-shadow] duration-150 hover:text-foreground',
                  workMode === 'document' &&
                    'bg-muted/80 font-medium text-foreground hover:bg-muted/80 hover:text-foreground'
                )}
              >
                <FileText className="h-4 w-4" />
                <span>文稿</span>
              </Button>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* 窄屏：工作流收到右簇前，仍保持次级样式 */}
            <nav
              className="flex items-center gap-0.5 sm:hidden"
              aria-label="工作流"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => switchWorkMode('subtitle')}
                aria-current={workMode === 'subtitle' ? 'page' : undefined}
                className={cn(
                  'h-8 gap-1 px-2 text-muted-foreground',
                  workMode === 'subtitle' &&
                    'bg-muted/80 font-medium text-foreground'
                )}
              >
                <Captions className="h-4 w-4" />
                <span className="sr-only">字幕</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => switchWorkMode('document')}
                aria-current={workMode === 'document' ? 'page' : undefined}
                className={cn(
                  'h-8 gap-1 px-2 text-muted-foreground',
                  workMode === 'document' &&
                    'bg-muted/80 font-medium text-foreground'
                )}
              >
                <FileText className="h-4 w-4" />
                <span className="sr-only">文稿</span>
              </Button>
            </nav>

            {/* 面板：唯一满血 segmented — 任务主路径 */}
            <nav
              className="flex items-center gap-0.5 rounded-lg bg-muted p-1"
              aria-label="主功能"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('upload')}
                aria-current={activeTab === 'upload' ? 'page' : undefined}
                className={cn(
                  'gap-1.5 transition-[background-color,box-shadow,color] duration-150',
                  activeTab === 'upload' &&
                    'bg-background text-foreground shadow-xs hover:bg-background hover:text-foreground'
                )}
              >
                <Upload className="h-4 w-4" />
                <span>添加</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('tasks')}
                aria-current={activeTab === 'tasks' ? 'page' : undefined}
                className={cn(
                  'gap-1.5 transition-[background-color,box-shadow,color] duration-150',
                  activeTab === 'tasks' &&
                    'bg-background text-foreground shadow-xs hover:bg-background hover:text-foreground'
                )}
              >
                <ListTodo className="h-4 w-4" />
                <span>任务</span>
                {visibleTasks.length > 0 && (
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-none transition-colors duration-150',
                      visibleTasks.some(t => t.status === 'failed')
                        ? 'bg-destructive/15 text-destructive'
                        : activeTab === 'tasks'
                          ? 'bg-brand text-brand-foreground'
                          : 'bg-primary/10 text-foreground'
                    )}
                  >
                    {visibleTasks.length}
                  </span>
                )}
              </Button>
            </nav>

            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/settings')}
                className="gap-1.5"
              >
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">设置</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        {activeTab === 'upload' && (
          <div
            key={`upload-${workMode}`}
            className="motion-panel-in mx-auto flex max-w-2xl flex-col gap-5"
          >
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">
                {isDocument ? '添加要整理的音视频' : '添加要翻译的视频'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isDocument
                  ? '本地文件或在线链接，识别语音并整理为 Markdown 文稿'
                  : '本地文件或在线链接，自动识别语音并生成本地字幕'}
              </p>
            </div>

            <VideoUploader
              kind={workMode}
              onUploadSuccess={handleUploadSuccess}
            />
          </div>
        )}

        {activeTab === 'tasks' && (
          <div key={`tasks-${workMode}`} className="motion-panel-in">
            {isDocument ? (
              <DocumentTaskList
                tasks={visibleTasks}
                onTasksChange={loadTasks}
                onGoUpload={() => setActiveTab('upload')}
              />
            ) : (
              <TaskList
                tasks={visibleTasks}
                onTasksChange={loadTasks}
                onGoUpload={() => setActiveTab('upload')}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
