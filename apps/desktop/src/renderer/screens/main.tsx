import appLogo from 'assets/logo-transparent.png'
import { FileText, Settings, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskList } from 'renderer/components/task/TaskList'
import { Button } from 'renderer/components/ui/button'
import { VideoUploader } from 'renderer/components/video/VideoUploader'
import type { TranslationTask } from 'shared/types/video'

// The "App" comes from the context bridge in preload/index.ts
const { App } = window

export function MainScreen() {
  const [tasks, setTasks] = useState<TranslationTask[]>([])
  const [activeTab, setActiveTab] = useState<'upload' | 'tasks'>('upload')
  const navigate = useNavigate()

  // 加载所有任务
  const loadTasks = useCallback(async () => {
    try {
      const allTasks = await App.getAllTasks()
      setTasks(allTasks)
    } catch (error) {
      console.error('加载任务失败:', error)
    }
  }, [])

  // 初始化加载任务
  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // 监听任务更新
  useEffect(() => {
    const unsubscribeTaskUpdated = App.onTaskUpdated(
      (updatedTask: TranslationTask) => {
        setTasks(prevTasks => {
          const index = prevTasks.findIndex(task => task.id === updatedTask.id)
          if (index >= 0) {
            // 更新现有任务
            const newTasks = [...prevTasks]
            newTasks[index] = updatedTask
            return newTasks
          }
          // 添加新任务
          return [updatedTask, ...prevTasks]
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

  const handleUploadSuccess = () => {
    setActiveTab('tasks')
    loadTasks()
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={appLogo}
              alt="视频翻译助手"
              className="h-8 w-8 shrink-0 select-none"
              draggable={false}
            />
            <span className="truncate text-base font-semibold tracking-tight text-foreground">
              视频翻译助手
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* 标签页导航 */}
            <nav
              className="flex items-center gap-0.5 rounded-lg bg-muted p-1"
              aria-label="主功能"
            >
              <Button
                variant={activeTab === 'upload' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('upload')}
                className="gap-1.5"
              >
                <Upload className="h-4 w-4" />
                <span>添加视频</span>
              </Button>
              <Button
                variant={activeTab === 'tasks' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('tasks')}
                className="gap-1.5"
              >
                <FileText className="h-4 w-4" />
                <span>任务</span>
                {tasks.length > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium leading-none text-primary-foreground">
                    {tasks.length}
                  </span>
                )}
              </Button>
            </nav>

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/settings')}
              className="gap-1.5"
            >
              <Settings className="h-4 w-4" />
              <span>设置</span>
            </Button>
          </div>
        </div>
      </header>

      {/* 主要内容区域 */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
        {activeTab === 'upload' && (
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold text-foreground">
                添加要翻译的视频
              </h1>
              <p className="text-sm text-muted-foreground">
                本地文件或在线链接，自动识别语音并生成本地字幕
              </p>
            </div>

            <VideoUploader onUploadSuccess={handleUploadSuccess} />
          </div>
        )}

        {activeTab === 'tasks' && (
          <TaskList
            tasks={tasks}
            onTasksChange={loadTasks}
            onGoUpload={() => setActiveTab('upload')}
          />
        )}
      </main>
    </div>
  )
}
