import { AlertCircle, FileVideo, Link2, Upload, Video } from 'lucide-react'
import { useCallback, useState } from 'react'
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
    // 支持行内夹杂说明时仍提取 URL
    const match = line.match(/https?:\/\/[^\s<>"']+/i)
    if (match) {
      urls.push(match[0].replace(/[),.;]+$/, ''))
    } else if (/^https?:\/\//i.test(line)) {
      urls.push(line)
    }
  }
  return [...new Set(urls)]
}

export function VideoUploader({ onUploadSuccess }: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlText, setUrlText] = useState('')
  const [urlSubmitting, setUrlSubmitting] = useState(false)

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    setError(null)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      openFileDialog()
    }
  }, [])

  const openFileDialog = async () => {
    try {
      const filePaths = await window.App.openFileDialog()
      if (filePaths.length > 0) {
        const settings = loadSettings()
        const result = await window.App.uploadFiles(filePaths, settings)
        if (result.success) {
          console.log('文件上传成功，任务ID:', result.taskIds)
          onUploadSuccess?.()
        } else {
          console.error('文件上传失败:', result.error)
          setError(`文件上传失败: ${result.error}`)
        }
      }
    } catch (err) {
      console.error('文件选择失败:', err)
      setError(
        `文件选择失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const submitUrls = async () => {
    setError(null)
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
        console.log('在线任务创建成功，任务ID:', result.taskIds)
        setUrlText('')
        onUploadSuccess?.()
      } else {
        setError(`创建在线任务失败: ${result.error}`)
      }
    } catch (err) {
      setError(
        `创建在线任务失败: ${
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
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 主路径：本地文件 */}
      <Card
        className={`gap-0 py-0 transition-colors duration-200 ${
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-2 border-dashed hover:border-primary/50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          {dragActive ? (
            <FileVideo className="h-10 w-10 text-primary" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground" />
          )}

          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">
              {dragActive ? '释放文件开始上传' : '拖拽视频到此处'}
            </h2>
            <p className="text-sm text-muted-foreground">
              MP4 / AVI / MOV / MKV / WebM / WMV / FLV · 最大 2GB
            </p>
          </div>

          <Button onClick={openFileDialog} className="mt-1">
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

      {/* 次路径：在线链接，紧凑表单 */}
      <Card className="gap-0 py-0">
        <CardContent className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-start gap-2.5">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-sm font-semibold">在线视频链接</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                YouTube、B 站等 yt-dlp 支持的地址；优先用平台字幕，否则本地识别。
                需本机已安装 <code className="text-[11px]">yt-dlp</code>。
              </p>
            </div>
          </div>

          <textarea
            className="w-full min-h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
              onClick={submitUrls}
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
