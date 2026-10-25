import { cn } from 'renderer/lib/utils'

interface WindowDragStripProps {
  className?: string
}

/**
 * 无顶栏页面的拖动条（首次运行、启动加载）。
 * macOS 隐藏原生标题栏后，这些页面也要留一条窗口可拖动区域，
 * 否则除了红绿灯之外没有任何地方能移动窗口。
 * 高度与顶栏内红绿灯的垂直位置对齐（见 main/windows/window-chrome.ts）。
 */
export function WindowDragStrip({ className }: WindowDragStripProps) {
  return (
    <div
      aria-hidden
      className={cn('window-drag fixed inset-x-0 top-0 z-20 h-9', className)}
    />
  )
}
