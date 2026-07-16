import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SettingsPanel } from 'renderer/components/settings/SettingsPanel'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'
import { Button } from 'renderer/components/ui/button'

export function SettingsScreen() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/')}
              className="gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回主页</span>
            </Button>
            <div className="h-5 w-px shrink-0 bg-border" />
            <h1 className="truncate text-base font-semibold tracking-tight">
              应用设置
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* 设置内容 */}
      <div className="mx-auto max-w-4xl px-6 py-6">
        <SettingsPanel />
      </div>
    </div>
  )
}
