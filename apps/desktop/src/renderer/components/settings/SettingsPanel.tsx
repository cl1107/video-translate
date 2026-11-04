import {
  AlertCircle,
  Check,
  FolderOpen,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { DependencyChecker } from 'renderer/components/system/DependencyChecker'
import {
  ModelServicesSettings,
  useModelServicesSettings,
} from './ModelServicesSettings'
import { GlossarySettings } from './GlossarySettings'
import { ThemeToggle } from 'renderer/components/theme/ThemeToggle'
import { UpdateSettingsCard } from 'renderer/components/update/UpdateSettingsCard'
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
import {
  DEFAULT_APP_SETTINGS,
  isValidDownloadProxy,
  normalizeAppSettings,
  normalizeHexColor,
  parseStoredAppSettings,
  type DownloadCookieBrowser,
  type SubtitleOutputLocation,
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

export type SettingsCategoryId = 'general' | 'models' | 'system'

const SETTINGS_CATEGORY_IDS: SettingsCategoryId[] = [
  'general',
  'models',
  'system',
]

interface SettingsPanelProps {
  category: SettingsCategoryId
  /** 右栏顶部标题（由外层布局传入） */
  title: string
}

export function SettingsPanel({ category, title }: SettingsPanelProps) {
  void SETTINGS_CATEGORY_IDS
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

  const [asrStatus, setAsrStatus] = useState<
    Array<{
      engine: string
      available: boolean
      path?: string
      detail?: string
    }>
  >([])

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
  const modelServices = useModelServicesSettings(settings.llmServices)

  const [status, setStatus] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [statusTone, setStatusTone] = useState<'ok' | 'error'>('ok')
  // 加载设置
  useEffect(() => {
    loadSettings()
    loadAsrStatus()
    void loadTempCacheStats()
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
        const parsed = parseStoredAppSettings(savedSettings)
        const normalized = parsed.settings
        setSettings(normalized)
        localStorage.setItem(
          'video-translate-settings',
          JSON.stringify(normalized)
        )
        if (parsed.recovered) {
          setStatusTone('error')
          setStatus('本地设置已损坏，已恢复默认值，请检查后重新保存')
        }
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
    if (saving) return
    setSaving(true)
    try {
      if (!isValidDownloadProxy(settings.downloadProxy)) {
        setStatusTone('error')
        setStatus('代理地址无效：请填写 http(s):// 或 socks5:// 开头的完整地址')
        return
      }
      const normalized = normalizeAppSettings(settings)
      setSettings(normalized)
      localStorage.setItem(
        'video-translate-settings',
        JSON.stringify(normalized)
      )

      await modelServices.saveKeys()

      setStatusTone('ok')
      setStatus('设置已保存')
      setTimeout(() => setStatus(''), 3000)
    } catch (error) {
      console.error('保存设置失败:', error)
      setStatusTone('error')
      setStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
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
      {/* 分类标题 + 保存；同时是窗口拖动区（macOS 隐藏标题栏） */}
      <div className="window-drag sticky top-0 z-10 -mx-8 flex items-center justify-between gap-3 border-b bg-background/95 px-8 py-3 backdrop-blur-sm">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
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
          <Button
            onClick={() => void saveSettings()}
            disabled={saving}
            size="sm"
          >
            {saving ? '保存中…' : '保存设置'}
          </Button>
        </div>
      </div>

      {category === 'general' && (
        <div className="space-y-4">
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
                  <SelectTrigger
                    id="target-language"
                    className="w-full min-w-0"
                  >
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
                  <SelectTrigger
                    id="source-language"
                    className="w-full min-w-0"
                  >
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
                    <SelectItem value="source-directory">
                      源视频同目录
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  同时应用于字幕文件和烧录后的视频；文稿仍保存在 output 子目录。
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">字幕颜色</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label>字幕颜色（ASS / 硬字幕）</Label>
                <p className="text-xs text-muted-foreground">
                  用于双语 ASS 与首页任务选择的硬字幕烧录；默认白 / 黄。
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
                            translatedSubtitleColor:
                              e.target.value.toUpperCase(),
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
                              translatedSubtitleColor:
                                prev.translatedSubtitleColor,
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

          <GlossarySettings
            glossary={settings.glossary}
            onChange={glossary => setSettings(prev => ({ ...prev, glossary }))}
            disabled={saving}
          />
        </div>
      )}

      {category === 'general' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">在线视频下载</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="download-proxy">代理（可选）</Label>
                <input
                  id="download-proxy"
                  type="text"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  placeholder="http://127.0.0.1:7890"
                  value={settings.downloadProxy}
                  onChange={event =>
                    setSettings(prev => ({
                      ...prev,
                      downloadProxy: event.target.value,
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  YouTube 等站点需要代理时填写，支持 http(s) /
                  socks5；留空表示直连。
                  只影响在线链接下载，不影响本地文件与模型服务。
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="download-cookie-browser">登录态来源</Label>
                <Select
                  value={settings.downloadCookieBrowser}
                  onValueChange={value => {
                    if (value == null) return
                    setSettings(prev => ({
                      ...prev,
                      downloadCookieBrowser: value as DownloadCookieBrowser,
                    }))
                  }}
                  items={{
                    auto: '自动（匿名优先）',
                    none: '不使用浏览器 Cookie',
                    chrome: 'Chrome',
                    safari: 'Safari（macOS）',
                    edge: 'Edge',
                    firefox: 'Firefox',
                  }}
                >
                  <SelectTrigger
                    id="download-cookie-browser"
                    className="w-full min-w-0"
                  >
                    <SelectValue placeholder="选择登录态来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动（匿名优先）</SelectItem>
                    <SelectItem value="none">不使用浏览器 Cookie</SelectItem>
                    <SelectItem value="chrome">Chrome</SelectItem>
                    <SelectItem value="safari">Safari（macOS）</SelectItem>
                    <SelectItem value="edge">Edge</SelectItem>
                    <SelectItem value="firefox">Firefox</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  遇到登录、会员、年龄或机器人校验时，从已登录的浏览器读取
                  Cookie；自动模式只在匿名解析失败后尝试。文稿任务只下载音轨。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {category === 'models' && (
        <div className="space-y-4">
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
                            state
                              ? !state.available
                              : model.name === 'funasr-nano'
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
                  {
                    asrEngines.find(m => m.name === settings.asrEngine)
                      ?.description
                  }
                </p>
                {asrStatus.length > 0 && (
                  <div className="space-y-1 rounded-md border p-2 text-xs text-muted-foreground">
                    {asrStatus.map(item => (
                      <div
                        key={item.engine}
                        className="flex justify-between gap-2"
                      >
                        <span>
                          {item.engine}: {item.available ? '已就绪' : '未安装'}
                        </span>
                        <span
                          className="max-w-[60%] truncate"
                          title={item.detail}
                        >
                          {item.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <ModelServicesSettings
            settings={settings}
            setSettings={setSettings}
            controller={modelServices}
            disabled={saving}
          />
        </div>
      )}

      {category === 'system' && (
        <div className="space-y-4">
          <DependencyChecker
            title="系统依赖"
            description="本机环境检查结果"
            compactPaths
          />

          <UpdateSettingsCard />

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
              <CardTitle className="text-base text-destructive">
                危险操作
              </CardTitle>
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
                  onClick={async () => {
                    if (
                      window.confirm(
                        '确定重置应用设置？将清除配置并重新检查环境。'
                      )
                    ) {
                      try {
                        const result = await App.clearAllLlmApiKeys()
                        if (!result.success)
                          throw new Error(result.error || '清除 API Key 失败')
                        navigate('/')
                        localStorage.removeItem('setup-completed')
                        localStorage.removeItem('video-translate-settings')
                        window.location.reload()
                      } catch (error) {
                        setStatusTone('error')
                        setStatus(
                          error instanceof Error ? error.message : '重置失败'
                        )
                      }
                    }
                  }}
                >
                  重置设置
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
