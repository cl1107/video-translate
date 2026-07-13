import { useEffect, useState } from 'react'
import { AppRoutes } from './routes'
import { SetupScreen } from './screens/setup'
import type { SystemCheckProgress } from '../shared/system-check'
import { SystemCheckProgressView } from './components/system/SystemCheckProgress'

const { App: ElectronApp } = window

export function App() {
  const [isSetupComplete, setIsSetupComplete] = useState<boolean | null>(null)
  const [checkProgress, setCheckProgress] =
    useState<SystemCheckProgress | null>(null)

  useEffect(() => {
    // 检查是否已经完成过初始设置
    const setupCompleted = localStorage.getItem('setup-completed')
    if (setupCompleted === 'true') {
      // 如果已经完成过设置，仍然需要检查依赖是否可用
      checkDependenciesQuickly()
    } else {
      setIsSetupComplete(false)
    }
  }, [])

  const checkDependenciesQuickly = async () => {
    setCheckProgress({
      stage: 'checking-tools',
      percent: 0,
      message: '正在启动系统依赖检查...',
    })
    const removeProgressListener =
      ElectronApp.onSystemCheckProgress(setCheckProgress)
    try {
      const result = await ElectronApp.checkSystemDependencies()
      if (result.success) {
        const allAvailable = result.results.every(dep => dep.available)
        if (allAvailable) {
          setIsSetupComplete(true)
        } else {
          // 有依赖缺失，需要重新设置
          setIsSetupComplete(false)
        }
      } else {
        setIsSetupComplete(false)
      }
    } catch (error) {
      console.error('快速依赖检查失败:', error)
      setIsSetupComplete(false)
    } finally {
      removeProgressListener()
    }
  }

  const handleSetupComplete = () => {
    localStorage.setItem('setup-completed', 'true')
    setIsSetupComplete(true)
  }

  // 加载状态
  if (isSetupComplete === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="w-full max-w-md text-center space-y-4 px-6">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          {checkProgress ? (
            <SystemCheckProgressView progress={checkProgress} />
          ) : (
            <p className="text-gray-600">正在启动应用...</p>
          )}
        </div>
      </div>
    )
  }

  // 设置页面
  if (!isSetupComplete) {
    return <SetupScreen onSetupComplete={handleSetupComplete} />
  }

  // 主应用
  return <AppRoutes />
}
