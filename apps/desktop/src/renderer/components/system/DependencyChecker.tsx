import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SystemCheckProgress } from '../../../shared/system-check'
import { SystemCheckProgressView } from './SystemCheckProgress'
import { Badge } from 'renderer/components/ui/badge'
import { Button } from 'renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from 'renderer/components/ui/card'
import { Separator } from 'renderer/components/ui/separator'

const { App } = window

/** 安装文档（GitHub） */
const INSTALLATION_GUIDE_URL =
  'https://github.com/cl1107/video-translate/blob/main/docs/installation.md'

export interface SystemDependency {
  name: string
  available: boolean
  version?: string
  error?: string
  resolvedPath?: string
  /** 可选依赖：缺失不阻断进入应用 */
  optional?: boolean
}

interface DiagnosticPaths {
  logsDir: string
  systemCheckLog: string
  userDataDir: string
}

interface DependencyCheckerProps {
  onAllDependenciesReady?: () => void
  showContinueButton?: boolean
  title?: string
  description?: string
  /** 成功项默认折叠路径细节，降低噪音 */
  compactPaths?: boolean
}

export function DependencyChecker({
  onAllDependenciesReady,
  showContinueButton = false,
  title = '系统依赖检查',
  description = '检查应用运行所需的系统依赖',
  compactPaths = false,
}: DependencyCheckerProps) {
  const [dependencies, setDependencies] = useState<SystemDependency[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [diagnosticPaths, setDiagnosticPaths] =
    useState<DiagnosticPaths | null>(null)
  const [loading, setLoading] = useState(false)
  const [allReady, setAllReady] = useState(false)
  const [openingLogs, setOpeningLogs] = useState(false)
  const [showPaths, setShowPaths] = useState(!compactPaths)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [checkProgress, setCheckProgress] =
    useState<SystemCheckProgress | null>(null)

  const checkDependencies = async () => {
    setLoading(true)
    setActionMessage(null)
    setCheckProgress({
      stage: 'checking-tools',
      percent: 0,
      message: '正在启动系统依赖检查...',
    })
    const removeProgressListener = App.onSystemCheckProgress(setCheckProgress)
    try {
      const result = await App.checkSystemDependencies()
      if (result.success) {
        setDependencies(result.results)
        setSuggestions(result.suggestions)
        if (result.diagnosticPaths) {
          setDiagnosticPaths(result.diagnosticPaths)
        }

        const requiredReady = result.results.every(
          dep => dep.available || dep.optional === true
        )
        setAllReady(requiredReady)

        // 全部就绪时直接进入，减少门禁停留；继续按钮作手动兜底
        if (requiredReady && onAllDependenciesReady) {
          onAllDependenciesReady()
        }
      } else if (result.diagnosticPaths) {
        setDiagnosticPaths(result.diagnosticPaths)
      }
    } catch (error) {
      console.error('检查系统依赖失败:', error)
      setActionMessage('依赖检查失败，请查看日志后重试')
    } finally {
      removeProgressListener()
      setLoading(false)
    }
  }

  useEffect(() => {
    checkDependencies()
  }, [])

  const openLogsDir = async () => {
    setOpeningLogs(true)
    setActionMessage(null)
    try {
      const result = await App.openLogsDir()
      if (!result.success) {
        setActionMessage(result.error || '打开日志目录失败')
      }
    } catch (error) {
      console.error('打开日志目录失败:', error)
      setActionMessage('打开日志目录失败')
    } finally {
      setOpeningLogs(false)
    }
  }

  const openInstallationGuide = async () => {
    setActionMessage(null)
    try {
      const result = await App.openExternalUrl(INSTALLATION_GUIDE_URL)
      if (!result.success) {
        setActionMessage(result.error || '无法打开安装指南')
      }
    } catch {
      setActionMessage('无法打开安装指南')
    }
  }

  const copySuggestion = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setActionMessage('已复制安装命令')
      setTimeout(() => setActionMessage(null), 2500)
    } catch {
      setActionMessage('复制失败，请手动选择文本')
    }
  }

  const getStatusBadge = (dep: SystemDependency) => {
    if (dep.available) {
      return (
        <Badge variant="brand-soft" className="text-xs">
          <Check className="mr-1 h-3 w-3" />
          {dep.version ? `v${dep.version}` : '已安装'}
        </Badge>
      )
    }
    if (dep.optional) {
      return (
        <Badge variant="secondary" className="text-xs">
          可选 · 未安装
        </Badge>
      )
    }
    return (
      <Badge variant="destructive" className="text-xs">
        <AlertCircle className="mr-1 h-3 w-3" />
        未安装
      </Badge>
    )
  }

  const getDisplayName = (name: string) => {
    switch (name) {
      case 'ffmpeg':
        return 'FFmpeg'
      case 'ffprobe':
        return 'FFprobe'
      case 'node':
        return 'Node.js'
      case 'ollama':
        return 'Ollama（本地翻译）'
      case 'sherpa-onnx-asr':
        return '语音识别模型'
      case 'yt-dlp':
        return '在线视频下载'
      default:
        return name
    }
  }

  const getDescription = (name: string) => {
    switch (name) {
      case 'ffmpeg':
        return '提取音频、可选硬字幕烧录'
      case 'ffprobe':
        return '读取视频时长与格式'
      case 'node':
        return '应用内置运行环境'
      case 'ollama':
        return '本机大模型服务，用于翻译'
      case 'sherpa-onnx-asr':
        return '本机语音识别；缺失时会自动下载'
      case 'yt-dlp':
        return '粘贴 YouTube / B 站链接时需要（可选）'
      default:
        return ''
    }
  }

  return (
    <Card className="mx-auto w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="text-base font-semibold">{title}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={checkDependencies}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            重新检查
          </Button>
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          {dependencies.map(dep => (
            <div
              key={dep.name}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {getDisplayName(dep.name)}
                  </span>
                  {getStatusBadge(dep)}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {getDescription(dep.name)}
                </p>
                {!dep.available && dep.error && (
                  <p className="mt-1 text-xs text-destructive">{dep.error}</p>
                )}
                {showPaths &&
                  dep.available &&
                  dep.resolvedPath &&
                  dep.name !== 'node' && (
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {dep.resolvedPath}
                    </p>
                  )}
              </div>
            </div>
          ))}
        </div>

        {compactPaths && dependencies.some(d => d.available && d.resolvedPath) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-0 text-xs text-muted-foreground"
            onClick={() => setShowPaths(v => !v)}
          >
            {showPaths ? '隐藏安装路径' : '显示安装路径'}
          </Button>
        )}

        {loading && checkProgress && (
          <SystemCheckProgressView progress={checkProgress} />
        )}

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <h2 className="text-sm font-medium">安装建议</h2>
            {suggestions.map(suggestion => (
              <div
                key={`suggestion-${suggestion.slice(0, 24)}`}
                className="rounded-lg border bg-muted/40 p-3"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <pre className="select-text whitespace-pre-wrap rounded border bg-background p-2 font-mono text-xs">
                      {suggestion}
                    </pre>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copySuggestion(suggestion)}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      复制命令
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => void openInstallationGuide()}
              className="w-full"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              打开安装文档
            </Button>
          </div>
        )}

        {diagnosticPaths && (
          <div className="space-y-2">
            <Separator />
            <h2 className="text-sm font-medium">排查日志</h2>
            <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                依赖检查结果会写入本机日志，便于排查 PATH 或命令解析问题。
              </p>
              {showPaths && (
                <div className="space-y-1 break-all font-mono text-xs select-text">
                  <div>
                    <span className="text-muted-foreground">日志目录：</span>
                    {diagnosticPaths.logsDir}
                  </div>
                  <div>
                    <span className="text-muted-foreground">检查日志：</span>
                    {diagnosticPaths.systemCheckLog}
                  </div>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openLogsDir()}
                disabled={openingLogs}
                className="w-full"
              >
                {openingLogs ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="mr-2 h-4 w-4" />
                )}
                打开日志目录
              </Button>
            </div>
          </div>
        )}

        {actionMessage && (
          <p className="text-sm text-muted-foreground" role="status">
            {actionMessage}
          </p>
        )}

        <Separator />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {allReady ? (
              <>
                <Check className="h-5 w-5 text-brand-ink" />
                <span className="text-sm font-medium text-brand-ink">
                  环境就绪，可以开始
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  还有依赖未就绪
                </span>
              </>
            )}
          </div>

          {showContinueButton && (
            <Button
              onClick={onAllDependenciesReady}
              disabled={!allReady}
              size="sm"
            >
              进入工作台
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
