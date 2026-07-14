import {
  AlertCircle,
  Check,
  Download,
  FolderOpen,
  Loader2,
  Settings,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DependencyChecker } from 'renderer/components/system/DependencyChecker'
import { Alert, AlertDescription } from 'renderer/components/ui/alert'
import { Badge } from 'renderer/components/ui/badge'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Label } from 'renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/components/ui/select'
import type { AsrEngineId } from '../../../shared/constants'
import { DEFAULT_OLLAMA_MODEL } from '../../../shared/constants'
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  normalizeOllamaModel,
} from '../../../shared/settings'

const { App } = window

interface ModelInfo {
  name: string
  size: string
  description: string
  installed?: boolean
}

interface LanguageInfo {
  code: string
  name: string
}

interface OllamaModel {
  name: string
  size: number
  digest: string
  modified_at: string
}

interface DownloadProgress {
  [modelName: string]: string
}

export function SettingsPanel() {
  const navigate = useNavigate()
  const [asrEngines] = useState<ModelInfo[]>([
    {
      name: 'sensevoice',
      size: '~228MB',
      description: 'SenseVoice Small：中/英/日/韩/粤，速度快（默认）',
    },
    {
      name: 'funasr-nano',
      size: '~950MB',
      description: 'Fun-ASR-Nano：方言/远场/嘈杂场景更强（需单独下载模型）',
    },
  ])

  const [ollamaModels, setOllamaModels] = useState<ModelInfo[]>([])
  const [asrStatus, setAsrStatus] = useState<
    Array<{
      engine: string
      available: boolean
      path?: string
      detail?: string
    }>
  >([])
  const [ollamaStatus, setOllamaStatus] = useState<{
    isRunning: boolean
    loading: boolean
    error?: string
  }>({ isRunning: false, loading: true })

  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({})
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set()
  )
  const [tempCache, setTempCache] = useState<{
    path: string
    totalBytes: number
    fileCount: number
    loading: boolean
    clearing: boolean
    message?: string
  }>({
    path: '',
    totalBytes: 0,
    fileCount: 0,
    loading: true,
    clearing: false,
  })

  const [languages] = useState<LanguageInfo[]>([
    { code: 'auto', name: '自动检测' },
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
    { code: 'yue', name: '粤语' },
    { code: 'ja', name: '日本語' },
    { code: 'ko', name: '한국어' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ru', name: 'Русский' },
  ])

  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')

  // 推荐的模型列表
  const recommendedModels = [
    {
      name: DEFAULT_OLLAMA_MODEL,
      size: '~1.5GB',
      description: 'Hunyuan-MT 翻译专用小模型（默认）',
    },
  ]

  // 加载设置
  useEffect(() => {
    loadSettings()
    checkOllamaStatus()
    void loadOllamaModels()
    loadAsrStatus()
    void loadTempCacheStats()

    // 监听模型下载进度
    const unsubscribe = App.onOllamaPullProgress(data => {
      setDownloadProgress(prev => ({
        ...prev,
        [data.modelName]: data.progress,
      }))
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const loadTempCacheStats = async () => {
    setTempCache(prev => ({ ...prev, loading: true, message: undefined }))
    try {
      const stats = await App.getTempCacheStats()
      if (stats.success) {
        setTempCache({
          path: stats.path,
          totalBytes: stats.totalBytes,
          fileCount: stats.fileCount,
          loading: false,
          clearing: false,
        })
      } else {
        setTempCache(prev => ({
          ...prev,
          loading: false,
          message: stats.error || '获取缓存信息失败',
        }))
      }
    } catch (error) {
      console.error('加载临时缓存信息失败:', error)
      setTempCache(prev => ({
        ...prev,
        loading: false,
        message: '加载临时缓存信息失败',
      }))
    }
  }

  const clearTempCache = async () => {
    if (
      !confirm(
        '确定清理临时缓存吗？\n将删除提取音频、分段等中间文件（进行中的任务不会受影响）。'
      )
    ) {
      return
    }

    setTempCache(prev => ({ ...prev, clearing: true, message: undefined }))
    try {
      const result = await App.clearTempCache()
      if (result.success) {
        await loadTempCacheStats()
        setTempCache(prev => ({
          ...prev,
          clearing: false,
          message: `已清理 ${result.removedEntries} 项，释放 ${formatBytes(result.freedBytes)}`,
        }))
      } else {
        setTempCache(prev => ({
          ...prev,
          clearing: false,
          message: result.error || '清理失败',
        }))
      }
    } catch (error) {
      console.error('清理临时缓存失败:', error)
      setTempCache(prev => ({
        ...prev,
        clearing: false,
        message: '清理临时缓存失败',
      }))
    }
  }

  const loadSettings = async () => {
    try {
      const savedSettings = localStorage.getItem('video-translate-settings')
      if (savedSettings) {
        const normalized = normalizeAppSettings(JSON.parse(savedSettings))
        setSettings(normalized)
        // 写回清洗后的设置，避免下次仍读到旧 qwen 模型
        localStorage.setItem(
          'video-translate-settings',
          JSON.stringify(normalized)
        )
      } else {
        setSettings({ ...DEFAULT_APP_SETTINGS })
      }
    } catch (error) {
      console.error('加载设置失败:', error)
      setSettings({ ...DEFAULT_APP_SETTINGS })
    }
  }

  const loadAsrStatus = async () => {
    try {
      const result = await App.getAsrStatus()
      if (result.success) {
        setAsrStatus(result.models)
      }
    } catch (error) {
      console.error('加载 ASR 状态失败:', error)
    }
  }

  const saveSettings = async () => {
    try {
      const normalized = normalizeAppSettings(settings)
      setSettings(normalized)
      localStorage.setItem(
        'video-translate-settings',
        JSON.stringify(normalized)
      )
      setStatus('设置已保存')
      setTimeout(() => setStatus(''), 3000)
    } catch (error) {
      console.error('保存设置失败:', error)
      setStatus('保存失败')
    }
  }

  const checkOllamaStatus = async () => {
    try {
      setOllamaStatus(prev => ({ ...prev, loading: true }))
      const result = await App.checkOllamaStatus()
      setOllamaStatus({
        isRunning: result.isRunning,
        loading: false,
        error: result.success ? undefined : '检查状态失败',
      })
    } catch (error) {
      console.error('检查 Ollama 状态失败:', error)
      setOllamaStatus({
        isRunning: false,
        loading: false,
        error: '无法连接到 Ollama 服务',
      })
    }
  }

  const loadOllamaModels = async () => {
    try {
      const result = await App.getOllamaModels()
      if (result.success) {
        const installedModels = result.models.map((model: OllamaModel) => ({
          name: model.name,
          size: formatBytes(model.size),
          description: getModelDescription(model.name),
          installed: true,
        }))

        const installedNames = new Set(installedModels.map(m => m.name))
        const notInstalledModels = recommendedModels
          .filter(model => !installedNames.has(model.name))
          .map(model => ({ ...model, installed: false }))

        const models = [...installedModels, ...notInstalledModels]
        setOllamaModels(models)

        // 当前选中模型不在列表 / 未安装时，自动切到默认或第一个已安装模型
        setSettings(prev => {
          const current = normalizeOllamaModel(prev.ollamaModel)
          const installed = models.filter(m => m.installed).map(m => m.name)
          let next = current
          if (!installed.includes(current)) {
            next = installed.includes(DEFAULT_OLLAMA_MODEL)
              ? DEFAULT_OLLAMA_MODEL
              : installed[0] || DEFAULT_OLLAMA_MODEL
          }
          if (next !== prev.ollamaModel) {
            const updated = { ...prev, ollamaModel: next }
            localStorage.setItem(
              'video-translate-settings',
              JSON.stringify(updated)
            )
            return updated
          }
          return prev.ollamaModel === current
            ? prev
            : { ...prev, ollamaModel: current }
        })
      } else {
        console.error('获取 Ollama 模型失败:', result.error)
        setOllamaModels(
          recommendedModels.map(model => ({ ...model, installed: false }))
        )
      }
    } catch (error) {
      console.error('加载 Ollama 模型失败:', error)
      setOllamaModels(
        recommendedModels.map(model => ({ ...model, installed: false }))
      )
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
  }

  const getModelDescription = (modelName: string): string => {
    const recommended = recommendedModels.find(m => m.name === modelName)
    return recommended?.description || `${modelName} 模型`
  }

  const downloadModel = async (modelName: string) => {
    setDownloadingModels(prev => new Set(prev).add(modelName))
    setLoading(true)
    setStatus(`正在下载 ${modelName} 模型...`)

    try {
      const result = await App.pullOllamaModel(modelName)
      if (result.success) {
        setStatus(`${modelName} 模型下载完成`)
        // 重新加载模型列表
        await loadOllamaModels()
      } else {
        setStatus(`下载失败: ${result.error}`)
      }
    } catch (error) {
      console.error('下载模型失败:', error)
      setStatus('下载失败')
    } finally {
      setDownloadingModels(prev => {
        const newSet = new Set(prev)
        newSet.delete(modelName)
        return newSet
      })
      setDownloadProgress(prev => {
        const newProgress = { ...prev }
        delete newProgress[modelName]
        return newProgress
      })
      setLoading(false)
      setTimeout(() => setStatus(''), 5000)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Settings className="h-5 w-5" />
          <h2 className="text-xl font-semibold">设置</h2>
        </div>

        <div className="flex items-center space-x-2">
          {status && (
            <div className="flex items-center space-x-1 text-sm text-muted-foreground">
              <Check className="h-3 w-3" />
              <span>{status}</span>
            </div>
          )}
          <Button onClick={saveSettings} size="sm">
            保存设置
          </Button>
        </div>
      </div>

      {/* Ollama 状态检查 */}
      {!ollamaStatus.isRunning && !ollamaStatus.loading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Ollama 服务未运行。请确保已安装并启动 Ollama 服务。
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={checkOllamaStatus}
            >
              重新检查
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ASR 设置 */}
      <Card>
        <CardHeader>
          <CardTitle>语音识别设置（sherpa-onnx）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asr-engine">ASR 引擎</Label>
            <Select
              value={settings.asrEngine}
              onValueChange={value =>
                setSettings(prev => ({
                  ...prev,
                  asrEngine: value as AsrEngineId,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 ASR 引擎" />
              </SelectTrigger>
              <SelectContent>
                {asrEngines.map(model => {
                  const state = asrStatus.find(s => s.engine === model.name)
                  return (
                    <SelectItem
                      key={model.name}
                      value={model.name}
                      disabled={
                        state ? !state.available : model.name === 'funasr-nano'
                      }
                    >
                      <div className="flex items-center justify-between w-full gap-2">
                        <span>{model.name}</span>
                        <Badge variant="outline">{model.size}</Badge>
                        {state?.available ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : null}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {asrEngines.find(m => m.name === settings.asrEngine)?.description}
            </p>
            {asrStatus.length > 0 && (
              <div className="rounded-md border p-2 text-xs text-muted-foreground space-y-1">
                {asrStatus.map(item => (
                  <div key={item.engine} className="flex justify-between gap-2">
                    <span>
                      {item.engine}: {item.available ? '已就绪' : '未安装'}
                    </span>
                    <span className="truncate max-w-[60%]" title={item.detail}>
                      {item.detail}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-language">源语言</Label>
            <Select
              value={settings.sourceLanguage}
              onValueChange={value =>
                setSettings(prev => ({ ...prev, sourceLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择源语言" />
              </SelectTrigger>
              <SelectContent>
                {languages.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Ollama 设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            翻译设置
            <Badge variant={ollamaStatus.isRunning ? 'default' : 'destructive'}>
              {ollamaStatus.loading
                ? '检查中...'
                : ollamaStatus.isRunning
                  ? '运行中'
                  : '未运行'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ollama-model">Ollama 模型</Label>
            <Select
              value={
                ollamaModels.some(
                  m => m.name === settings.ollamaModel && m.installed
                )
                  ? settings.ollamaModel
                  : undefined
              }
              onValueChange={value =>
                setSettings(prev => ({
                  ...prev,
                  ollamaModel: normalizeOllamaModel(value),
                }))
              }
              disabled={!ollamaStatus.isRunning || ollamaModels.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择翻译模型" />
              </SelectTrigger>
              <SelectContent>
                {ollamaModels.map(model => (
                  <SelectItem
                    key={model.name}
                    value={model.name}
                    disabled={!model.installed}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={
                          !model.installed ? 'text-muted-foreground' : ''
                        }
                      >
                        {model.name}
                      </span>
                      <div className="flex items-center space-x-2 ml-2">
                        <Badge variant="outline">{model.size}</Badge>
                        {model.installed ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : downloadingModels.has(model.name) ? (
                          <div className="flex items-center space-x-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {downloadProgress[model.name] && (
                              <span className="text-xs">
                                {downloadProgress[model.name]}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={e => {
                              e.stopPropagation()
                              downloadModel(model.name)
                            }}
                            disabled={loading || !ollamaStatus.isRunning}
                          >
                            <Download className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {
                ollamaModels.find(m => m.name === settings.ollamaModel)
                  ?.description
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-language">目标语言</Label>
            <Select
              value={settings.targetLanguage}
              onValueChange={value =>
                setSettings(prev => ({ ...prev, targetLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择目标语言" />
              </SelectTrigger>
              <SelectContent>
                {languages
                  .filter(lang => lang.code !== 'auto')
                  .map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 输出设置 */}
      <Card>
        <CardHeader>
          <CardTitle>输出设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="output-format">字幕格式</Label>
            <Select
              value={settings.outputFormat}
              onValueChange={(value: 'srt' | 'vtt' | 'txt') =>
                setSettings(prev => ({ ...prev, outputFormat: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择字幕格式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srt">SRT (SubRip)</SelectItem>
                <SelectItem value="vtt">VTT (WebVTT)</SelectItem>
                <SelectItem value="txt">TXT (纯文本)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="polish-transcript"
              checked={settings.polishTranscript}
              onChange={e =>
                setSettings(prev => ({
                  ...prev,
                  polishTranscript: e.target.checked,
                }))
              }
              className="rounded"
            />
            <Label htmlFor="polish-transcript">识别结果先润色再翻译</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            ASR/OCR 文本可能有错字或缺标点；开启后由大模型校对，再进入翻译
          </p>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="burn-subtitles"
              checked={settings.burnSubtitles}
              onChange={e =>
                setSettings(prev => ({
                  ...prev,
                  burnSubtitles: e.target.checked,
                }))
              }
              className="rounded"
            />
            <Label htmlFor="burn-subtitles">烧录硬字幕到视频</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            启用后将生成包含字幕的新视频文件（处理时间较长）
          </p>

          {settings.burnSubtitles && (
            <div className="space-y-2">
              <Label htmlFor="burn-mode">烧录内容</Label>
              <Select
                value={settings.burnSubtitleMode}
                onValueChange={(
                  value: 'bilingual' | 'translated' | 'original'
                ) =>
                  setSettings(prev => ({
                    ...prev,
                    burnSubtitleMode: value,
                  }))
                }
              >
                <SelectTrigger id="burn-mode">
                  <SelectValue placeholder="选择烧录内容" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bilingual">
                    双语堆叠（原文上 / 译文下）
                  </SelectItem>
                  <SelectItem value="translated">仅译文</SelectItem>
                  <SelectItem value="original">仅原文</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 系统信息 */}
      <DependencyChecker
        title="系统依赖状态"
        description="当前系统环境检查结果"
      />

      {/* 临时缓存 */}
      <Card>
        <CardHeader>
          <CardTitle>临时缓存</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            音频提取、分段识别等中间文件存放于此。任务结束后会自动删除；异常退出时可能残留，可在此清理。
          </p>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">占用空间</span>
              <span className="font-medium">
                {tempCache.loading
                  ? '计算中...'
                  : formatBytes(tempCache.totalBytes)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">文件数</span>
              <span className="font-medium">
                {tempCache.loading ? '-' : tempCache.fileCount}
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">缓存目录</span>
              <p className="break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                {tempCache.path || '—'}
              </p>
            </div>
          </div>
          {tempCache.message && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{tempCache.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadTempCacheStats()}
              disabled={tempCache.loading || tempCache.clearing}
            >
              {tempCache.loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void App.openTempCacheDir()}
              disabled={!tempCache.path}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              打开目录
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void clearTempCache()}
              disabled={tempCache.loading || tempCache.clearing}
            >
              {tempCache.clearing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              清理缓存
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 重置设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-red-600">危险操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium">重置应用设置</h4>
            <p className="text-sm text-muted-foreground">
              这将清除所有应用设置并重新启动依赖检查流程
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    '确定要重置应用设置吗？这将清除所有配置并重新启动应用。'
                  )
                ) {
                  navigate('/')
                  localStorage.removeItem('setup-completed')
                  localStorage.removeItem('video-translate-settings')
                  window.location.reload()
                }
              }}
            >
              重置设置
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
