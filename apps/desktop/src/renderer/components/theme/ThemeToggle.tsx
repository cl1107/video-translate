import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from 'renderer/components/ui/button'
import { useTheme } from 'renderer/hooks/use-theme'
import type { ThemePreference } from 'renderer/lib/theme'
import { cn } from 'renderer/lib/utils'

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  light: '浅色',
  dark: '暗色',
  system: '跟随系统',
}

interface ThemeToggleProps {
  /** 仅图标按钮（顶栏）；完整分段控件见 `variant="segmented"` */
  variant?: 'icon' | 'segmented'
  className?: string
}

export function ThemeToggle({
  variant = 'icon',
  className,
}: ThemeToggleProps) {
  const { preference, setTheme, cycleTheme } = useTheme()

  if (variant === 'segmented') {
    return (
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-lg bg-muted p-1',
          className
        )}
        role="group"
        aria-label="外观主题"
      >
        {(
          [
            { value: 'light', icon: Sun, label: '浅色' },
            { value: 'dark', icon: Moon, label: '暗色' },
            { value: 'system', icon: Monitor, label: '系统' },
          ] as const
        ).map(option => {
          const Icon = option.icon
          const selected = preference === option.value
          return (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                'gap-1.5',
                selected &&
                  'bg-background text-foreground shadow-xs hover:bg-background hover:text-foreground'
              )}
              aria-pressed={selected}
              onClick={() => setTheme(option.value)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{option.label}</span>
            </Button>
          )
        })}
      </div>
    )
  }

  const Icon =
    preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      className={className}
      onClick={cycleTheme}
      aria-label={`切换主题，当前：${PREFERENCE_LABEL[preference]}`}
      title={`主题：${PREFERENCE_LABEL[preference]}（点击切换）`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
