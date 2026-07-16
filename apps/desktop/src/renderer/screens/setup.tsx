import appIcon from 'assets/logo-transparent.png'
import { DependencyChecker } from 'renderer/components/system/DependencyChecker'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'

interface SetupScreenProps {
  onSetupComplete: () => void
}

/**
 * 安静门禁：检查本机环境后进入工作台。
 * 无营销英雄页 / emoji 三列 / 渐变背景。
 */
export function SetupScreen({ onSetupComplete }: SetupScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <img
              src={appIcon}
              alt=""
              className="h-14 w-14 select-none rounded-[22%]"
              draggable={false}
            />
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-brand ring-2 ring-background"
            />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              检查本机环境
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              就绪后即可导入视频、生成本地字幕。素材默认留在你的电脑里。
            </p>
          </div>
        </header>

        <DependencyChecker
          onAllDependenciesReady={onSetupComplete}
          showContinueButton
          title="依赖检查"
          description="检测识别、翻译与视频处理所需组件"
          compactPaths
        />
      </div>
    </div>
  )
}
