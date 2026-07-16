import { AlertCircle, FileVideo, Link2, Upload, Video } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from 'renderer/components/ui/alert'
import { Button } from 'renderer/components/ui/button'
import { Card, CardContent } from 'renderer/components/ui/card'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from '../../../shared/settings'

interface VideoUploaderProps {
  onUploadSuccess?: () => void
}

function loadSettings() {
  const savedSettings = localStorage.getItem('video-translate-settings')
  const settings = normalizeAppSettings(
    savedSettings ? JSON.parse(savedSettings) : DEFAULT_APP_SETTINGS
  )
  localStorage.setItem('video-translate-settings', JSON.stringify(settings))
  return settings
}

/** 从多行文本拆出合法 http(s) 链接 */
function extractUrls(text: string): string[] {
  const lines = text
    .split(/[\n\r,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
  const urls: string[] = []
  for (const line of lines) {
    const match = line.match(/https?:\/\/[^\s<>"']+/i)
    if (match) {
      urls.push(match[0].replace(/[),.;]+$/, ''))
    } else if (/^https?:\/\//i.test(line)) {
      urls.push(line)
    }
  }
  return [...new Set(urls)]
}

const VIDEO_EXT = /\.(mp4|avi|mov|mkv|webm|wmv|flv)$/i

/** 解析拖入 File 的本地路径（Electron 必须走 webUtils，File.path 已失效） */
function resolveDroppedFilePath(file: File): string {
  // 1) preload 暴露的 webUtils.getPathForFile（Electron 32+ 正确路径）
  try {
    const viaApi = window.App.getPathForFile?.(file)
    if (viaApi && viaApi.trim()) return viaApi.trim()
  } catch {
    // 忽略，走兼容回退
  }

  // 2) 旧版 Electron 可能仍挂 path（兼容）
  const legacy = (file as File & { path?: string }).path
  if (legacy && legacy.trim()) return legacy.trim()

  return ''
}

function isVideoPathOrName(pathOrName: string): boolean {
  return VIDEO_EXT.test(pathOrName)
}

export function VideoUploader({ onUploadSuccess }: VideoUploaderProps) {
  const navigate = useNavigate()
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorHint, setErrorHint] = useState<'settings' | null>(null)
  const [urlText, setUrlText] = useState('')
  const [urlSubmitting, setUrlSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** 用计数避免子元素 dragenter/leave 抖动导致 drop 状态错乱 */
  const dragDepthRef = useRef(0)

  const uploadPaths = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0) return
      setUploading(true)
      try {
        const settings = loadSettings()
        const result = await window.App.uploadFiles(filePaths, settings)
        if (result.success) {
          setError(null)
          setErrorHint(null)
          onUploadSuccess?.()
        } else {
          const msg = result.error || '未知错误'
          setError(`上传失败：${msg}`)
          setErrorHint(/ollama|模型|翻译/i.test(msg) ? 'settings' : null)
        }
      } finally {
        setUploading(false)
      }
    },
    [onUploadSuccess]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setDragActive(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 必须 preventDefault，否则浏览器不会触发 drop
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragDepthRef.current = 0
      setDragActive(false)
      setError(null)
      setErrorHint(null)

      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length === 0) {
        // 有些环境 items 有值但 files 为空，尝试从 items 再读
        const fromItems: File[] = []
        if (e.dataTransfer.items) {
          for (const item of Array.from(e.dataTransfer.items)) {
            if (item.kind === 'file') {
              const f = item.getAsFile()
              if (f) fromItems.push(f)
            }
          }
        }
        if (fromItems.length === 0) {
          setError('未识别到拖入的文件，请改用「选择文件」')
          return
        }
        files.push(...fromItems)
      }

      const paths: string[] = []
      const rejectedNames: string[] = []

      for (const file of files) {
        const filePath = resolveDroppedFilePath(file)
        const nameForCheck = filePath || file.name
        if (!isVideoPathOrName(nameForCheck)) {
          rejectedNames.push(file.name || nameForCheck)
          continue
        }
        if (!filePath) {
          // 有视频扩展名但拿不到绝对路径
          rejectedNames.push(file.name)
          continue
        }
        paths.push(filePath)
      }

      if (paths.length === 0) {
        if (rejectedNames.length > 0) {
          setError(
            `无法添加：${rejectedNames.slice(0, 3).join('、')}${
              rejectedNames.length > 3 ? ' 等' : ''
            }。请拖入支持的视频格式，或使用「选择文件」。`
          )
        } else {
          setError('无法获取文件路径。请使用「选择文件」按钮添加。')
        }
        return
      }

      try {
        await uploadPaths(paths)
      } catch (err) {
        setError(
          `上传失败：${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
    [uploadPaths]
  )

  const openFileDialog = async () => {
    setError(null)
    setErrorHint(null)
    try {
      const filePaths = await window.App.openFileDialog()
      if (filePaths.length === 0) return
      await uploadPaths(filePaths)
    } catch (err) {
      setError(
        `文件选择失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const submitUrls = async () => {
    setError(null)
    setErrorHint(null)
    const urls = extractUrls(urlText)
    if (urls.length === 0) {
      setError('请粘贴至少一个有效的视频链接（http/https）')
      return
    }

    setUrlSubmitting(true)
    try {
      const settings = loadSettings()
      const result = await window.App.createTasksFromUrls(urls, settings)
      if (result.success) {
        setUrlText('')
        onUploadSuccess?.()
      } else {
        const msg = result.error || '未知错误'
        setError(`创建在线任务失败：${msg}`)
        setErrorHint(/yt-dlp|下载/i.test(msg) ? 'settings' : null)
      }
    } catch (err) {
      setError(
        `创建在线任务失败：${
          err instanceof Error ? err.message : String(err)
        }`
      )
    } finally {
      setUrlSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            {errorHint === 'settings' && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => navigate('/settings')}
              >
                打开设置
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card
        className={`gap-0 py-0 transition-colors duration-200 ${
          dragActive
            ? 'border-brand bg-brand/10'
            : 'border-2 border-dashed hover:border-brand/40'
        }`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={e => void handleDrop(e)}
      >
        <CardContent className="pointer-events-none flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          {dragActive || uploading ? (
            <FileVideo className="h-10 w-10 text-brand-ink" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground" />
          )}

          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">
              {uploading
                ? '正在添加…'
                : dragActive
                  ? '释放以添加视频'
                  : '拖拽视频到此处'}
            </h2>
            <p className="text-sm text-muted-foreground">
              MP4 / AVI / MOV / MKV / WebM / WMV / FLV · 最大 2GB
            </p>
          </div>

          {/* 按钮需可点：单独恢复 pointer-events */}
          <Button
            onClick={() => void openFileDialog()}
            className="pointer-events-auto mt-1"
            disabled={uploading}
          >
            <Video className="h-4 w-4" />
            选择文件
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>或使用在线链接</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-2.5">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-sm font-semibold">在线视频链接</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                YouTube、B 站等地址；优先用平台字幕，否则本地识别。需本机已安装{' '}
                <code className="text-[11px]">yt-dlp</code>。
              </p>
            </div>
          </div>

          <textarea
            className="min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            placeholder={
              'https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/BV...'
            }
            value={urlText}
            onChange={e => setUrlText(e.target.value)}
            disabled={urlSubmitting}
            rows={3}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              支持多行；与本地文件共用同一翻译流水线
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void submitUrls()}
              disabled={urlSubmitting || !urlText.trim()}
            >
              <Link2 className="h-4 w-4" />
              {urlSubmitting ? '提交中…' : '下载并翻译'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
