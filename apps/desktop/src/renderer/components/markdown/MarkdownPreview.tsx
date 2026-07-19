import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from 'renderer/lib/utils'

export type MarkdownPreviewProps = {
  /** Markdown 源文本 */
  source: string
  className?: string
  /** 源为空时的占位；默认「暂无内容」 */
  emptyFallback?: ReactNode
}

/**
 * 轻量 Markdown 只读预览。
 * - react-markdown：安全渲染为 React 节点
 * - remark-gfm：表格 / 任务列表 / 删除线 / 自动链接
 * - prose：@tailwindcss/typography，贴合工作台主题
 */
export function MarkdownPreview({
  source,
  className,
  emptyFallback,
}: MarkdownPreviewProps) {
  const trimmed = source.trim()

  if (!trimmed) {
    return (
      emptyFallback ?? (
        <p className="text-sm text-muted-foreground">暂无内容</p>
      )
    )
  }

  return (
    <article
      data-slot="markdown-preview"
      className={cn(
        // 全局 body 为 user-select:none，预览区需可选中复制
        'markdown-preview select-text',
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-headings:scroll-mt-4 prose-headings:font-semibold prose-headings:tracking-tight',
        'prose-p:leading-relaxed',
        'prose-a:font-medium prose-a:text-brand-ink prose-a:no-underline hover:prose-a:underline',
        'prose-strong:font-semibold prose-strong:text-foreground',
        'prose-code:rounded-md prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground',
        'prose-blockquote:border-brand/40 prose-blockquote:text-muted-foreground',
        'prose-th:border prose-th:border-border prose-th:bg-muted/60 prose-th:px-2 prose-th:py-1.5',
        'prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1.5',
        'prose-hr:border-border',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
    </article>
  )
}
