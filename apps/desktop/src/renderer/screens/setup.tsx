import { useState } from 'react'
import { DependencyChecker } from 'renderer/components/system/DependencyChecker'

interface SetupScreenProps {
  onSetupComplete: () => void
}

export function SetupScreen({ onSetupComplete }: SetupScreenProps) {
  const [showWelcome, setShowWelcome] = useState(true)

  if (showWelcome) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-gray-900">
              欢迎使用视频翻译助手
            </h1>
            <p className="text-xl text-gray-600">
              一款强大的本地视频翻译工具，支持语音识别和智能翻译
            </p>
          </div>

          <div className="bg-white rounded-lg p-8 shadow-lg">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto">
                    <span className="text-2xl">🎬</span>
                  </div>
                  <h3 className="font-semibold">视频处理</h3>
                  <p className="text-sm text-gray-600">
                    支持多种视频格式，自动提取音频
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto">
                    <span className="text-2xl">🎯</span>
                  </div>
                  <h3 className="font-semibold">语音识别</h3>
                  <p className="text-sm text-gray-600">
                    使用 sherpa-onnx 和 SenseVoice 在本地进行语音识别
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto">
                    <span className="text-2xl">🌐</span>
                  </div>
                  <h3 className="font-semibold">智能翻译</h3>
                  <p className="text-sm text-gray-600">
                    本地 Ollama 模型，保护隐私安全
                  </p>
                </div>
              </div>

              <div className="pt-6 border-t">
                <button
                  onClick={() => setShowWelcome(false)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                >
                  开始设置
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-gray-900">系统环境检查</h2>
          <p className="text-gray-600">
            正在检查应用运行所需的系统依赖，请确保所有依赖都已正确安装
          </p>
        </div>

        <DependencyChecker
          onAllDependenciesReady={onSetupComplete}
          showContinueButton={true}
          title="依赖检查"
          description="检查视频翻译助手运行所需的系统组件"
        />

        <div className="text-center">
          <p className="text-sm text-gray-500">
            如需帮助，请查看{' '}
            <button className="text-blue-600 hover:underline">安装指南</button>{' '}
            或{' '}
            <button className="text-blue-600 hover:underline">常见问题</button>
          </p>
        </div>
      </div>
    </div>
  )
}
