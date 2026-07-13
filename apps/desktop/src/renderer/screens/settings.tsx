import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SettingsPanel } from 'renderer/components/settings/SettingsPanel'
import { Button } from 'renderer/components/ui/button'

export function SettingsScreen() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="flex items-center space-x-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>返回主页</span>
          </Button>
          <div className="h-6 w-px bg-gray-300" />
          <h1 className="text-xl font-semibold">应用设置</h1>
        </div>
      </div>

      {/* 设置内容 */}
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <SettingsPanel />
      </div>
    </div>
  )
}
