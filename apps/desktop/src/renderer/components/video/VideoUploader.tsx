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
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 在线链接下载 + 翻译 */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-semibold">在线视频链接</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            粘贴 YouTube、B 站等 yt-dlp 支持的链接：下载最高画质，
            <strong className="font-medium text-foreground">优先使用平台字幕</strong>
            （有则跳过语音识别），再翻译并生成字幕。
            需要本机已安装 <code className="text-xs">yt-dlp</code>。
          </p>
          <textarea
            className="w-full min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={
              'https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/BV...'
            }
            value={urlText}
            onChange={e => setUrlText(e.target.value)}
            disabled={urlSubmitting}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              支持多行；下载后走与本地文件相同的翻译流水线
            </p>
            <Button
              onClick={submitUrls}
              disabled={urlSubmitting || !urlText.trim()}
            >
              <Link2 className="h-4 w-4 mr-2" />
              {urlSubmitting ? '提交中…' : '下载并翻译'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span>或上传本地文件</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <Card
        className={`transition-colors duration-200 ${
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-dashed border-2 hover:border-primary/50'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4">
            {dragActive ? (
              <FileVideo className="h-12 w-12 text-primary animate-pulse" />
            ) : (
              <Upload className="h-12 w-12 text-muted-foreground" />
            )}
          </div>

          <h3 className="text-lg font-semibold mb-2">
            {dragActive ? '释放文件开始上传' : '拖拽视频文件到此处'}
          </h3>

          <p className="text-muted-foreground mb-4">
            支持 MP4, AVI, MOV, MKV, WebM, WMV, FLV 格式
          </p>

          <div className="flex items-center space-x-4">
            <Button onClick={openFileDialog} variant="outline">
              <Video className="h-4 w-4 mr-2" />
              选择文件
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            最大文件大小: 2GB
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
