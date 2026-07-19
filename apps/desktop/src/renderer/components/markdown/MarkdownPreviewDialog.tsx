import { Copy, Eye, FileCode2, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { MarkdownPreview } from 'renderer/components/markdown/MarkdownPreview'
import { Button } from 'renderer/components/ui/button'
import { cn } from 'renderer/lib/utils'

export type MarkdownPreviewDialogProps = {
  open: boolean
  title: string
  /** Markdown 正文；打开时由调用方加载 */
  source: string
  loading?: boolean
  error?: string | null
  onClose: () => void
  onCopy?: () => void | Promise<void>
  onOpenFile?: () => void | Promise<void>
}

/**
 * 全屏文稿预览层：大阅读面 + 预览/源码切换，Esc 关闭。
 */
export function MarkdownPreviewDialog({
  open,
  title,
  source,
  loading = false,
  error = null,
  onClose,
  onCopy,
  onOpenFile,
}: MarkdownPreviewDialogProps) {
  const titleId = useId()
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [copyHint, setCopyHint] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMode('preview')
    setCopyHint(null)
  }, [open, title])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const handleCopy = async () => {
    try {
      if (onCopy) {
        await onCopy()
      } else if (source) {
        await navigator.clipboard.writeText(source)
      }
      setCopyHint('已复制')
      window.setTimeout(() => setCopyHint(null), 1500)
    } catch {
      setCopyHint('复制失败')
      window.setTimeout(() => setCopyHint(null), 1500)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">文稿预览</p>
          <h2
            id={titleId}
            className="truncate text-base font-semibold tracking-tight"
          >
            {title}
          </h2>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 gap-1.5 px-2.5 text-xs',
                mode === 'preview' &&
                  'bg-background text-foreground shadow-xs hover:bg-background hover:text-foreground'
              )}
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'h-8 gap-1.5 px-2.5 text-xs',
                mode === 'source' &&
                  'bg-background text-foreground shadow-xs hover:bg-background hover:text-foreground'
              )}
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              源码
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => void handleCopy()}
            disabled={!source || loading}
          >
            <Copy className="h-3.5 w-3.5" />
            {copyHint ?? '复制'}
          </Button>

          {onOpenFile ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void onOpenFile()}
              disabled={loading}
            >
              打开文件
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            aria-label="关闭预览"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载文稿中…</p>
          ) : error ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : mode === 'source' ? (
            <pre className="markdown-preview select-text whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
              {source || '（空）'}
            </pre>
          ) : (
            <MarkdownPreview
              source={source}
              className="prose-base sm:prose-lg"
              emptyFallback={
                <p className="text-sm text-muted-foreground">暂无文稿内容</p>
              }
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
