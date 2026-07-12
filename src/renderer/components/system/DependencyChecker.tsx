import {
  AlertCircle,
  Check,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "renderer/components/ui/badge";
import { Button } from "renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "renderer/components/ui/card";
import { Separator } from "renderer/components/ui/separator";

const { App } = window;

export interface SystemDependency {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
  resolvedPath?: string;
}

interface DiagnosticPaths {
  logsDir: string;
  systemCheckLog: string;
  userDataDir: string;
}

interface DependencyCheckerProps {
  onAllDependenciesReady?: () => void;
  showContinueButton?: boolean;
  title?: string;
  description?: string;
}

export function DependencyChecker({
  onAllDependenciesReady,
  showContinueButton = false,
  title = "系统依赖检查",
  description = "检查应用运行所需的系统依赖",
}: DependencyCheckerProps) {
  const [dependencies, setDependencies] = useState<SystemDependency[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [diagnosticPaths, setDiagnosticPaths] = useState<DiagnosticPaths | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [allReady, setAllReady] = useState(false);
  const [openingLogs, setOpeningLogs] = useState(false);

  const checkDependencies = async () => {
    setLoading(true);
    try {
      const result = await App.checkSystemDependencies();
      if (result.success) {
        setDependencies(result.results);
        setSuggestions(result.suggestions);
        if (result.diagnosticPaths) {
          setDiagnosticPaths(result.diagnosticPaths);
        }

        const allAvailable = result.results.every((dep) => dep.available);
        setAllReady(allAvailable);

        if (allAvailable && onAllDependenciesReady) {
          onAllDependenciesReady();
        }
      } else if (result.diagnosticPaths) {
        setDiagnosticPaths(result.diagnosticPaths);
      }
    } catch (error) {
      console.error("检查系统依赖失败:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkDependencies();
  }, []);

  const openLogsDir = async () => {
    setOpeningLogs(true);
    try {
      const result = await App.openLogsDir();
      if (!result.success) {
        console.error("打开日志目录失败:", result.error);
      }
    } catch (error) {
      console.error("打开日志目录失败:", error);
    } finally {
      setOpeningLogs(false);
    }
  };

  const getStatusBadge = (dep: SystemDependency) => {
    if (dep.available) {
      return (
        <Badge variant="default" className="text-xs">
          <Check className="h-3 w-3 mr-1" />
          {dep.version ? `v${dep.version}` : "已安装"}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="text-xs">
        <AlertCircle className="h-3 w-3 mr-1" />
        未安装
      </Badge>
    );
  };

  const getDisplayName = (name: string) => {
    switch (name) {
      case "ffmpeg":
        return "FFmpeg";
      case "ffprobe":
        return "FFprobe";
      case "node":
        return "Node.js";
      case "ollama":
        return "Ollama";
      case "sherpa-onnx-asr":
        return "语音识别 (SenseVoice)";
      default:
        return name;
    }
  };

  const getDescription = (name: string) => {
    switch (name) {
      case "ffmpeg":
        return "视频处理和音频提取";
      case "ffprobe":
        return "视频信息获取";
      case "node":
        return "Electron 内置 JavaScript 运行环境";
      case "ollama":
        return "本地大语言模型服务";
      case "sherpa-onnx-asr":
        return "sherpa-onnx 本地 ASR，缺失时自动下载 SenseVoice";
      default:
        return "";
    }
  };

  const openInstallationGuide = () => {
    // 这里可以打开安装指南或外部链接
    console.log("打开安装指南");
  };

  return (
    <Card className="w-full mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <Button
            variant="outline"
            size="sm"
            onClick={checkDependencies}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            重新检查
          </Button>
        </CardTitle>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 依赖状态列表 */}
        <div className="space-y-3">
          {dependencies.map((dep) => (
            <div
              key={dep.name}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="font-medium">
                    {getDisplayName(dep.name)}
                  </span>
                  {getStatusBadge(dep)}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {getDescription(dep.name)}
                </p>
                {!dep.available && dep.error && (
                  <p className="text-xs text-destructive mt-1">{dep.error}</p>
                )}
                {dep.available && dep.resolvedPath && dep.name !== "node" && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                    {dep.resolvedPath}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center items-center py-4">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm text-muted-foreground">检查中...</span>
          </div>
        )}

        {/* 安装建议 */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <Separator />
            <h4 className="font-medium text-sm">安装指南</h4>
            {suggestions.map((suggestion) => (
              <div key={`suggestion-${suggestion.substring(0, 20)}`} className="border rounded-lg p-3 bg-muted/50">
                <div className="flex items-start space-x-2">
                  <AlertCircle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <pre className="text-sm whitespace-pre-wrap font-mono bg-background p-2 rounded border select-text">
                      {suggestion}
                    </pre>
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={openInstallationGuide}
              className="w-full"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              查看详细安装指南
            </Button>
          </div>
        )}

        {/* 诊断日志 */}
        {diagnosticPaths && (
          <div className="space-y-2">
            <Separator />
            <h4 className="font-medium text-sm">排查日志</h4>
            <div className="border rounded-lg p-3 bg-muted/40 space-y-2">
              <p className="text-xs text-muted-foreground">
                依赖检查结果会写入诊断日志，便于排查打包后 PATH 或命令解析问题。
              </p>
              <div className="space-y-1 text-xs font-mono select-text break-all">
                <div>
                  <span className="text-muted-foreground">日志目录：</span>
                  {diagnosticPaths.logsDir}
                </div>
                <div>
                  <span className="text-muted-foreground">检查日志：</span>
                  {diagnosticPaths.systemCheckLog}
                </div>
                <div>
                  <span className="text-muted-foreground">数据目录：</span>
                  {diagnosticPaths.userDataDir}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={openLogsDir}
                disabled={openingLogs}
                className="w-full"
              >
                {openingLogs ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <FolderOpen className="h-4 w-4 mr-2" />
                )}
                打开日志目录
              </Button>
            </div>
          </div>
        )}

        {/* 状态总结 */}
        <Separator />
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {allReady ? (
              <>
                <Check className="h-5 w-5 text-green-500" />
                <span className="text-sm font-medium text-green-700">
                  所有依赖检查通过
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <span className="text-sm font-medium text-orange-700">
                  发现缺失的依赖
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
              继续使用应用
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
