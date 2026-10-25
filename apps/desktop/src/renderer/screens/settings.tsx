import { ArrowLeft, Boxes, SlidersHorizontal, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  SettingsPanel,
  type SettingsCategoryId,
} from 'renderer/components/settings/SettingsPanel'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'
import { Button } from 'renderer/components/ui/button'
import { cn } from 'renderer/lib/utils'

const CATEGORIES: Array<{
  id: SettingsCategoryId
  label: string
  icon: typeof SlidersHorizontal
}> = [
  { id: 'general', label: '常规', icon: SlidersHorizontal },
  { id: 'models', label: '模型', icon: Boxes },
  { id: 'system', label: '系统', icon: Wrench },
]

export function SettingsScreen() {
  const navigate = useNavigate()
  const [category, setCategory] = useState<SettingsCategoryId>('general')
  const current = CATEGORIES.find(item => item.id === category) ?? CATEGORIES[0]

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 左侧分类栏；顶部同时是窗口拖动区（macOS 隐藏标题栏），避开红绿灯 */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card/40">
        <div className="window-drag px-3 pt-12 pb-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回工作区</span>
          </Button>
        </div>
        <nav
          className="flex-1 space-y-1 overflow-y-auto px-3 pb-4"
          aria-label="设置分类"
        >
          {CATEGORIES.map(item => {
            const active = item.id === current.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">外观</span>
          <ThemeToggle />
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          <SettingsPanel category={current.id} title={current.label} />
        </div>
      </main>
    </div>
  )
}
