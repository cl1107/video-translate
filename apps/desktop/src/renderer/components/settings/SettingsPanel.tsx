import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DependencyChecker } from 'renderer/components/system/DependencyChecker'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'
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
  normalizeHexColor,
  normalizeOllamaModel,
  type PolishProvider,
  type SubtitleOutputLocation,
} from '../../../shared/settings'
import type { OllamaModel } from '../../../shared/types/video'

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
    { code: 'zh', name: '中文' },
    { code: 'en', name: 'English' },
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

  const commonSourceCodes = useMemo(
    () => new Set(['auto', 'zh', 'en', 'yue', 'ja', 'ko']),
    []
  )
  const commonTargetCodes = useMemo(
    () => new Set(['zh', 'en', 'yue', 'ja', 'ko']),
    []
  )

  const [settings, setSettings] = useState(DEFAULT_APP_SETTINGS)
  /** 仅 UI 草稿；落盘走主进程 safeStorage，不进 localStorage */
  const [byokApiKeyDraft, setByokApiKeyDraft] = useState('')
  const [byokApiKeyConfigured, setByokApiKeyConfigured] = useState(false)

  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [statusTone, setStatusTone] = useState<'ok' | 'error'>('ok')
  /** 高级：润色 / 烧录 / 颜色 */
  const [showAdvanced, setShowAdvanced] = useState(false)
  /** 系统：依赖 / 缓存 / 危险区 */
  const [showSystem, setShowSystem] = useState(false)

  // 推荐的模型列表
  const recommendedModels = [
    {
      name: DEFAULT_OLLAMA_MODEL,
      size: '~1.5GB',
      description: 'Hunyuan-MT 翻译专用小模型（默认）',
    },
  ]

  const polishCapableModels = ollamaModels.filter(
    m => m.installed && !/hy-mt/i.test(m.name)
  )

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

  // 已开启高级能力时默认展开，避免配置「消失」
  useEffect(() => {
    if (settings.polishTranscript || settings.burnSubtitles) {
      setShowAdvanced(true)
    }
  }, [settings.polishTranscript, settings.burnSubtitles])

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
        localStorage.setItem(
          'video-translate-settings',
          JSON.stringify(normalized)
        )
      } else {
        setSettings({ ...DEFAULT_APP_SETTINGS })
      }
      try {
        const keyStatus = await App.getByokApiKeyStatus()
        setByokApiKeyConfigured(Boolean(keyStatus.configured))
      } catch {
        setByokApiKeyConfigured(false)
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

      if (byokApiKeyDraft.trim()) {
        const keyResult = await App.setByokApiKey(byokApiKeyDraft.trim())
        if (!keyResult.success) {
          setStatusTone('error')
          setStatus(`设置已保存，但 API Key 写入失败: ${keyResult.error ?? ''}`)
          return
        }
        setByokApiKeyDraft('')
        setByokApiKeyConfigured(true)
      }

      setStatusTone('ok')
      setStatus('设置已保存')
      setTimeout(() => setStatus(''), 3000)
    } catch (error) {
      console.error('保存设置失败:', error)
      setStatusTone('error')
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
    setStatusTone('ok')
    setStatus(`正在下载 ${modelName} 模型...`)

    try {
      const result = await App.pullOllamaModel(modelName)
      if (result.success) {
        setStatusTone('ok')
        setStatus(`${modelName} 模型下载完成`)
        await loadOllamaModels()
      } else {
        setStatusTone('error')
        setStatus(`下载失败: ${result.error}`)
      }
    } catch (error) {
      console.error('下载模型失败:', error)
      setStatusTone('error')
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

  const sourceLanguages = languages
  const targetLanguages = languages.filter(lang => lang.code !== 'auto')
  const orderedSource = [
    ...sourceLanguages.filter(l => commonSourceCodes.has(l.code)),
    ...sourceLanguages.filter(l => !commonSourceCodes.has(l.code)),
  ]
  const orderedTarget = [
    ...targetLanguages.filter(l => commonTargetCodes.has(l.code)),
    ...targetLanguages.filter(l => !commonTargetCodes.has(l.code)),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          改完后点保存生效。目标语言与输出格式会用于新任务。
        </p>
        <div className="flex items-center gap-2">
          {status && (
            <div
              className={
                statusTone === 'ok'
                  ? 'flex items-center gap-1 text-sm text-brand-ink'
                  : 'flex items-center gap-1 text-sm text-destructive'
              }
              role="status"
            >
              {statusTone === 'ok' ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              <span>{status}</span>
            </div>
          )}
          <Button onClick={() => void saveSettings()} size="sm">
            保存设置
          </Button>
        </div>
      </div>

      {!ollamaStatus.isRunning && !ollamaStatus.loading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              本地翻译服务未运行。请安装并启动 Ollama 后再翻译。
            </span>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={checkOllamaStatus}>
                重新检查
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void App.openExternalUrl('https://ollama.com/download')
                }
              >
                安装 Ollama
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* —— 常规 —— */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          常规
        </h2>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">外观</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <Label>主题</Label>
            <p className="text-xs text-muted-foreground">
              浅色工作台为默认；也可切换暗色或跟随系统
            </p>
          </div>
          <ThemeToggle variant="segmented" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">语言与输出</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="target-language">目标语言</Label>
            <Select
              value={settings.targetLanguage}
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({ ...prev, targetLanguage: value }))
              }}
              items={Object.fromEntries(
                orderedTarget.map(lang => [lang.code, lang.name])
              )}
            >
              <SelectTrigger id="target-language" className="w-full min-w-0">
                <SelectValue placeholder="选择目标语言" />
              </SelectTrigger>
              <SelectContent>
                {orderedTarget.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-language">源语言</Label>
            <Select
              value={settings.sourceLanguage}
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({ ...prev, sourceLanguage: value }))
              }}
              items={Object.fromEntries(
                orderedSource.map(lang => [lang.code, lang.name])
              )}
            >
              <SelectTrigger id="source-language" className="w-full min-w-0">
                <SelectValue placeholder="选择源语言" />
              </SelectTrigger>
              <SelectContent>
                {orderedSource.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              不确定时选「自动检测」即可
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="output-format">字幕格式</Label>
            <Select
              value={settings.outputFormat}
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({
                  ...prev,
                  outputFormat: value as 'srt' | 'vtt' | 'txt',
                }))
              }}
              items={{
                srt: 'SRT（推荐）',
                vtt: 'VTT',
                txt: 'TXT 纯文本',
              }}
            >
              <SelectTrigger id="output-format" className="w-full min-w-0">
                <SelectValue placeholder="选择字幕格式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="srt">SRT（推荐）</SelectItem>
                <SelectItem value="vtt">VTT</SelectItem>
                <SelectItem value="txt">TXT 纯文本</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subtitle-output-location">字幕输出位置</Label>
            <Select
              value={settings.subtitleOutputLocation}
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({
                  ...prev,
                  subtitleOutputLocation: value as SubtitleOutputLocation,
                }))
              }}
              items={{
                'output-subdirectory': 'output 子目录（默认）',
                'source-directory': '源视频同目录',
              }}
            >
              <SelectTrigger
                id="subtitle-output-location"
                className="w-full min-w-0"
              >
                <SelectValue placeholder="选择字幕输出位置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="output-subdirectory">
                  output 子目录（默认）
                </SelectItem>
                <SelectItem value="source-directory">源视频同目录</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              同时应用于字幕文件和烧录后的视频；文稿仍保存在 output 子目录。
            </p>
          </div>
        </CardContent>
      </Card>
      </section>

      {/* —— 模型 —— */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          模型与翻译
        </h2>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">语音识别</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="asr-engine">ASR 引擎</Label>
            <Select
              value={settings.asrEngine}
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({
                  ...prev,
                  asrEngine: value as AsrEngineId,
                }))
              }}
              items={Object.fromEntries(
                asrEngines.map(model => [model.name, model.name])
              )}
            >
              <SelectTrigger className="w-full min-w-0">
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
                          <Check className="h-3 w-3 text-brand-ink" />
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
              <div className="space-y-1 rounded-md border p-2 text-xs text-muted-foreground">
                {asrStatus.map(item => (
                  <div key={item.engine} className="flex justify-between gap-2">
                    <span>
                      {item.engine}: {item.available ? '已就绪' : '未安装'}
                    </span>
                    <span className="max-w-[60%] truncate" title={item.detail}>
                      {item.detail}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            翻译模型
            <Badge
              variant={
                ollamaStatus.isRunning
                  ? 'brand-soft'
                  : ollamaStatus.loading
                    ? 'secondary'
                    : 'destructive'
              }
            >
              {ollamaStatus.loading
                ? '检查中…'
                : ollamaStatus.isRunning
                  ? '运行中'
                  : '未运行'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ollama-model">翻译模型（Ollama）</Label>
            <Select
              value={
                ollamaModels.some(
                  m => m.name === settings.ollamaModel && m.installed
                )
                  ? settings.ollamaModel
                  : null
              }
              onValueChange={value => {
                if (value == null) return
                setSettings(prev => ({
                  ...prev,
                  ollamaModel: normalizeOllamaModel(value),
                }))
              }}
              disabled={!ollamaStatus.isRunning || ollamaModels.length === 0}
              items={Object.fromEntries(
                ollamaModels.map(model => [model.name, model.name])
              )}
            >
              <SelectTrigger className="w-full min-w-0">
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
                          <Check className="h-3 w-3 text-brand-ink" />
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
        </CardContent>
      </Card>
      </section>

      {/* —— 高级（折叠） —— */}
      <section className="space-y-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-semibold tracking-tight text-foreground"
          onClick={() => setShowAdvanced(v => !v)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          高级
          <span className="font-normal text-muted-foreground">
            润色 · 硬字幕 · 颜色
          </span>
        </button>

        {showAdvanced && (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">润色与硬字幕</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            ASR/OCR
            文本可能有错字或缺标点；开启后由大模型校对，再进入翻译。仅发送字幕文本段，不上传音视频。
          </p>

          {settings.polishTranscript && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="polish-provider">润色后端</Label>
                <Select
                  value={settings.polishProvider}
                  onValueChange={value => {
                    if (value == null) return
                    setSettings(prev => ({
                      ...prev,
                      polishProvider: value as PolishProvider,
                    }))
                  }}
                  items={{
                    ollama: '本地 Ollama（OpenAI 兼容 /v1）',
                    byok: '在线 BYOK（自备 Base URL + Key）',
                  }}
                >
                  <SelectTrigger
                    id="polish-provider"
                    className="w-full min-w-0"
                  >
                    <SelectValue placeholder="选择润色后端" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ollama">
                      本地 Ollama（OpenAI 兼容 /v1）
                    </SelectItem>
                    <SelectItem value="byok">
                      在线 BYOK（自备 Base URL + Key）
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {settings.polishProvider === 'ollama' ? (
                <div className="space-y-2">
                  <Label htmlFor="polish-ollama-model">本地润色模型</Label>
                  <Select
                    value={
                      polishCapableModels.some(
                        m => m.name === settings.polishOllamaModel
                      )
                        ? settings.polishOllamaModel
                        : null
                    }
                    onValueChange={value => {
                      if (value == null) return
                      setSettings(prev => ({
                        ...prev,
                        polishOllamaModel: value,
                      }))
                    }}
                    disabled={
                      !ollamaStatus.isRunning ||
                      polishCapableModels.length === 0
                    }
                    items={Object.fromEntries(
                      polishCapableModels.map(model => [model.name, model.name])
                    )}
                  >
                    <SelectTrigger
                      id="polish-ollama-model"
                      className="w-full min-w-0"
                    >
                      <SelectValue placeholder="选择通用对话/校对模型（勿用 hy-mt）" />
                    </SelectTrigger>
                    <SelectContent>
                      {polishCapableModels.map(model => (
                        <SelectItem key={model.name} value={model.name}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    与翻译模型分离；hy-mt 等翻译专用模型不会出现在列表中
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="byok-base-url">Base URL</Label>
                    <input
                      id="byok-base-url"
                      type="url"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      placeholder="https://api.openai.com/v1"
                      value={settings.byokBaseUrl}
                      onChange={e =>
                        setSettings(prev => ({
                          ...prev,
                          byokBaseUrl: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="byok-model-id">Model ID</Label>
                    <input
                      id="byok-model-id"
                      type="text"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      placeholder="gpt-4o-mini"
                      value={settings.byokModelId}
                      onChange={e =>
                        setSettings(prev => ({
                          ...prev,
                          byokModelId: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="byok-api-key">API Key</Label>
                    <input
                      id="byok-api-key"
                      type="password"
                      autoComplete="off"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      placeholder={
                        byokApiKeyConfigured
                          ? '已配置（输入新 Key 可覆盖）'
                          : 'sk-...'
                      }
                      value={byokApiKeyDraft}
                      onChange={e => setByokApiKeyDraft(e.target.value)}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        使用系统密钥库加密存储，不会写入 localStorage 或任务日志
                      </p>
                      {byokApiKeyConfigured && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const result = await App.clearByokApiKey()
                            if (result.success) {
                              setByokApiKeyConfigured(false)
                              setByokApiKeyDraft('')
                              setStatus('已清除 BYOK API Key')
                              setTimeout(() => setStatus(''), 3000)
                            }
                          }}
                        >
                          清除 Key
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

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
                onValueChange={value => {
                  if (value == null) return
                  setSettings(prev => ({
                    ...prev,
                    burnSubtitleMode: value as
                      | 'bilingual'
                      | 'translated'
                      | 'original',
                  }))
                }}
                items={{
                  bilingual: '双语堆叠（原文上 / 译文下）',
                  translated: '仅译文',
                  original: '仅原文',
                }}
              >
                <SelectTrigger id="burn-mode" className="w-full min-w-0">
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

          <div className="space-y-3 pt-2">
            <Label>字幕颜色（ASS / 硬字幕）</Label>
            <p className="text-xs text-muted-foreground">
              用于双语 ASS 与烧录硬字幕；原文、译文可分别设置。默认白 / 黄。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="original-subtitle-color">原文颜色</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="original-subtitle-color"
                    type="color"
                    value={normalizeHexColor(
                      settings.originalSubtitleColor,
                      DEFAULT_APP_SETTINGS.originalSubtitleColor
                    )}
                    onChange={e =>
                      setSettings(prev => ({
                        ...prev,
                        originalSubtitleColor: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
                    title="选择原文字幕颜色"
                  />
                  <input
                    type="text"
                    value={settings.originalSubtitleColor}
                    onChange={e => {
                      const value = e.target.value
                      setSettings(prev => ({
                        ...prev,
                        originalSubtitleColor: value.startsWith('#')
                          ? value
                          : `#${value}`,
                      }))
                    }}
                    onBlur={() =>
                      setSettings(prev =>
                        normalizeAppSettings({
                          ...prev,
                          originalSubtitleColor: prev.originalSubtitleColor,
                        })
                      )
                    }
                    className="h-9 flex-1 rounded-md border bg-background px-2 font-mono text-sm"
                    spellCheck={false}
                    maxLength={7}
                    aria-label="原文颜色十六进制"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="translated-subtitle-color">译文颜色</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="translated-subtitle-color"
                    type="color"
                    value={normalizeHexColor(
                      settings.translatedSubtitleColor,
                      DEFAULT_APP_SETTINGS.translatedSubtitleColor
                    )}
                    onChange={e =>
                      setSettings(prev => ({
                        ...prev,
                        translatedSubtitleColor: e.target.value.toUpperCase(),
                      }))
                    }
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent p-0.5"
                    title="选择译文字幕颜色"
                  />
                  <input
                    type="text"
                    value={settings.translatedSubtitleColor}
                    onChange={e => {
                      const value = e.target.value
                      setSettings(prev => ({
                        ...prev,
                        translatedSubtitleColor: value.startsWith('#')
                          ? value
                          : `#${value}`,
                      }))
                    }}
                    onBlur={() =>
                      setSettings(prev =>
                        normalizeAppSettings({
                          ...prev,
                          translatedSubtitleColor: prev.translatedSubtitleColor,
                        })
                      )
                    }
                    className="h-9 flex-1 rounded-md border bg-background px-2 font-mono text-sm"
                    spellCheck={false}
                    maxLength={7}
                    aria-label="译文颜色十六进制"
                  />
                </div>
              </div>
            </div>
            <div className="rounded-md border bg-black px-4 py-3 text-center text-sm leading-relaxed">
              <div
                style={{
                  color: normalizeHexColor(
                    settings.originalSubtitleColor,
                    DEFAULT_APP_SETTINGS.originalSubtitleColor
                  ),
                }}
              >
                原文字幕预览
              </div>
              <div
                style={{
                  color: normalizeHexColor(
                    settings.translatedSubtitleColor,
                    DEFAULT_APP_SETTINGS.translatedSubtitleColor
                  ),
                }}
              >
                译文字幕预览
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        )}
      </section>

      {/* —— 系统（折叠） —— */}
      <section className="space-y-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-semibold tracking-tight text-foreground"
          onClick={() => setShowSystem(v => !v)}
          aria-expanded={showSystem}
        >
          {showSystem ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          系统
          <span className="font-normal text-muted-foreground">
            依赖 · 缓存 · 重置
          </span>
        </button>

        {showSystem && (
          <>
      <DependencyChecker
        title="系统依赖"
        description="本机环境检查结果"
        compactPaths
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">临时缓存</CardTitle>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-destructive">危险操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">重置应用设置</h3>
            <p className="text-sm text-muted-foreground">
              清除本地配置并重新走环境检查（不会删除已生成的字幕文件）
            </p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    '确定重置应用设置？将清除配置并重新检查环境。'
                  )
                ) {
                  navigate('/')
                  localStorage.removeItem('setup-completed')
                  localStorage.removeItem('video-translate-settings')
                  void App.clearByokApiKey()
                  window.location.reload()
                }
              }}
            >
              重置设置
            </Button>
          </div>
        </CardContent>
      </Card>
          </>
        )}
      </section>
    </div>
  )
}
