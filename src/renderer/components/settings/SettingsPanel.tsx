import { AlertCircle, Check, Download, Loader2, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DependencyChecker } from "renderer/components/system/DependencyChecker";
import { Alert, AlertDescription } from "renderer/components/ui/alert";
import { Badge } from "renderer/components/ui/badge";
import { Button } from "renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "renderer/components/ui/card";
import { Label } from "renderer/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "renderer/components/ui/select";

const { App } = window;

interface ModelInfo {
  name: string;
  size: string;
  description: string;
  installed?: boolean;
}

interface LanguageInfo {
  code: string;
  name: string;
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

interface DownloadProgress {
  [modelName: string]: string;
}

export function SettingsPanel() {
  const navigate = useNavigate();
  const [whisperModels] = useState<ModelInfo[]>([
    {
      name: "tiny",
      size: "~39MB",
      description: "最小模型，速度最快但准确率较低",
    },
    { name: "base", size: "~142MB", description: "基础模型，平衡速度和准确率" },
    { name: "small", size: "~466MB", description: "小型模型，准确率较好" },
    { name: "medium", size: "~1.5GB", description: "中型模型，高准确率" },
    {
      name: "large-v3",
      size: "~2.9GB",
      description: "最新大型模型，最高准确率",
    },
  ]);

  const [ollamaModels, setOllamaModels] = useState<ModelInfo[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<{
    isRunning: boolean;
    loading: boolean;
    error?: string;
  }>({ isRunning: false, loading: true });

  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>(
    {}
  );
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set()
  );

  const [languages] = useState<LanguageInfo[]>([
    { code: "auto", name: "自动检测" },
    { code: "en", name: "English" },
    { code: "zh", name: "中文" },
    { code: "ja", name: "日本語" },
    { code: "ko", name: "한국어" },
    { code: "es", name: "Español" },
    { code: "fr", name: "Français" },
    { code: "de", name: "Deutsch" },
    { code: "it", name: "Italiano" },
    { code: "pt", name: "Português" },
    { code: "ru", name: "Русский" },
  ]);

  const [settings, setSettings] = useState({
    whisperModel: "base",
    ollamaModel: "llama3",
    sourceLanguage: "auto",
    targetLanguage: "zh",
    outputFormat: "srt" as "srt" | "vtt" | "txt",
    burnSubtitles: false,
  });

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  // 推荐的模型列表
  const recommendedModels = [
    {
      name: "llama3",
      size: "4.7GB",
      description: "Meta Llama 3 8B 模型 - 推荐",
    },
    {
      name: "llama3:70b",
      size: "40GB",
      description: "Meta Llama 3 70B 模型 - 高性能",
    },
    {
      name: "qwen2",
      size: "4.4GB",
      description: "阿里通义千问 7B 模型 - 中文优化",
    },
    {
      name: "gemma2",
      size: "5.4GB",
      description: "Google Gemma 2 9B 模型",
    },
    {
      name: "codellama",
      size: "3.8GB",
      description: "Code Llama 7B 模型 - 代码理解",
    },
  ];

  // 加载设置
  useEffect(() => {
    loadSettings();
    checkOllamaStatus();
    loadOllamaModels();

    // 监听模型下载进度
    const unsubscribe = App.onOllamaPullProgress((data) => {
      setDownloadProgress((prev) => ({
        ...prev,
        [data.modelName]: data.progress,
      }));
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = localStorage.getItem("video-translate-settings");
      if (savedSettings) {
        setSettings(JSON.parse(savedSettings));
      }
    } catch (error) {
      console.error("加载设置失败:", error);
    }
  };

  const saveSettings = async () => {
    try {
      localStorage.setItem(
        "video-translate-settings",
        JSON.stringify(settings)
      );
      setStatus("设置已保存");
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      console.error("保存设置失败:", error);
      setStatus("保存失败");
    }
  };

  const checkOllamaStatus = async () => {
    try {
      setOllamaStatus((prev) => ({ ...prev, loading: true }));
      const result = await App.checkOllamaStatus();
      setOllamaStatus({
        isRunning: result.isRunning,
        loading: false,
        error: result.success ? undefined : "检查状态失败",
      });
    } catch (error) {
      console.error("检查 Ollama 状态失败:", error);
      setOllamaStatus({
        isRunning: false,
        loading: false,
        error: "无法连接到 Ollama 服务",
      });
    }
  };

  const loadOllamaModels = async () => {
    try {
      const result = await App.getOllamaModels();
      if (result.success) {
        // 转换格式并合并推荐模型
        const installedModels = result.models.map((model: OllamaModel) => ({
          name: model.name,
          size: formatBytes(model.size),
          description: getModelDescription(model.name),
          installed: true,
        }));

        // 添加未安装的推荐模型
        const installedNames = new Set(installedModels.map((m) => m.name));
        const notInstalledModels = recommendedModels
          .filter((model) => !installedNames.has(model.name))
          .map((model) => ({ ...model, installed: false }));

        setOllamaModels([...installedModels, ...notInstalledModels]);
      } else {
        console.error("获取 Ollama 模型失败:", result.error);
        // 如果获取失败，只显示推荐模型
        setOllamaModels(
          recommendedModels.map((model) => ({ ...model, installed: false }))
        );
      }
    } catch (error) {
      console.error("加载 Ollama 模型失败:", error);
      setOllamaModels(
        recommendedModels.map((model) => ({ ...model, installed: false }))
      );
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${
      sizes[i]
    }`;
  };

  const getModelDescription = (modelName: string): string => {
    const recommended = recommendedModels.find((m) => m.name === modelName);
    return recommended?.description || `${modelName} 模型`;
  };

  const downloadModel = async (modelName: string) => {
    setDownloadingModels((prev) => new Set(prev).add(modelName));
    setLoading(true);
    setStatus(`正在下载 ${modelName} 模型...`);

    try {
      const result = await App.pullOllamaModel(modelName);
      if (result.success) {
        setStatus(`${modelName} 模型下载完成`);
        // 重新加载模型列表
        await loadOllamaModels();
      } else {
        setStatus(`下载失败: ${result.error}`);
      }
    } catch (error) {
      console.error("下载模型失败:", error);
      setStatus("下载失败");
    } finally {
      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });
      setDownloadProgress((prev) => {
        const newProgress = { ...prev };
        delete newProgress[modelName];
        return newProgress;
      });
      setLoading(false);
      setTimeout(() => setStatus(""), 5000);
    }
  };

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

      {/* Whisper 设置 */}
      <Card>
        <CardHeader>
          <CardTitle>语音识别设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="whisper-model">Whisper 模型</Label>
            <Select
              value={settings.whisperModel}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, whisperModel: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 Whisper 模型" />
              </SelectTrigger>
              <SelectContent>
                {whisperModels.map((model) => (
                  <SelectItem key={model.name} value={model.name}>
                    <div className="flex items-center justify-between w-full">
                      <span>{model.name}</span>
                      <Badge variant="outline" className="ml-2">
                        {model.size}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {
                whisperModels.find((m) => m.name === settings.whisperModel)
                  ?.description
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-language">源语言</Label>
            <Select
              value={settings.sourceLanguage}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, sourceLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择源语言" />
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
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
            <Badge variant={ollamaStatus.isRunning ? "default" : "destructive"}>
              {ollamaStatus.loading
                ? "检查中..."
                : ollamaStatus.isRunning
                ? "运行中"
                : "未运行"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ollama-model">Ollama 模型</Label>
            <Select
              value={settings.ollamaModel}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, ollamaModel: value }))
              }
              disabled={!ollamaStatus.isRunning}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择翻译模型" />
              </SelectTrigger>
              <SelectContent>
                {ollamaModels.map((model) => (
                  <SelectItem
                    key={model.name}
                    value={model.name}
                    disabled={!model.installed}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={
                          !model.installed ? "text-muted-foreground" : ""
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
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadModel(model.name);
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
                ollamaModels.find((m) => m.name === settings.ollamaModel)
                  ?.description
              }
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-language">目标语言</Label>
            <Select
              value={settings.targetLanguage}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, targetLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择目标语言" />
              </SelectTrigger>
              <SelectContent>
                {languages
                  .filter((lang) => lang.code !== "auto")
                  .map((lang) => (
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
              onValueChange={(value: "srt" | "vtt" | "txt") =>
                setSettings((prev) => ({ ...prev, outputFormat: value }))
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
              id="burn-subtitles"
              checked={settings.burnSubtitles}
              onChange={(e) =>
                setSettings((prev) => ({
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
        </CardContent>
      </Card>

      {/* 系统信息 */}
      <DependencyChecker
        title="系统依赖状态"
        description="当前系统环境检查结果"
      />

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
                    "确定要重置应用设置吗？这将清除所有配置并重新启动应用。"
                  )
                ) {
                  navigate("/");
                  localStorage.removeItem("setup-completed");
                  localStorage.removeItem("video-translate-settings");
                  window.location.reload();
                }
              }}
            >
              重置设置
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
