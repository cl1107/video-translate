import { Check, Download, Settings } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Separator } from "renderer/components/ui/separator";

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

export function SettingsPanel() {
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

  // 加载设置
  useEffect(() => {
    loadSettings();
    loadOllamaModels();
  }, []);

  const loadSettings = async () => {
    try {
      // TODO: 从本地存储或配置文件加载设置
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

  const loadOllamaModels = async () => {
    try {
      // TODO: 通过 IPC 获取已安装的 Ollama 模型
      // const models = await App.getOllamaModels()
      // setOllamaModels(models)

      // 模拟数据
      setOllamaModels([
        {
          name: "llama3",
          size: "4.7GB",
          description: "Meta Llama 3 8B 模型",
          installed: true,
        },
        {
          name: "llama3:70b",
          size: "40GB",
          description: "Meta Llama 3 70B 模型",
          installed: false,
        },
        {
          name: "qwen2",
          size: "4.4GB",
          description: "阿里通义千问 7B 模型",
          installed: false,
        },
        {
          name: "gemma2",
          size: "5.4GB",
          description: "Google Gemma 2 9B 模型",
          installed: false,
        },
      ]);
    } catch (error) {
      console.error("加载 Ollama 模型失败:", error);
    }
  };

  const downloadModel = async (
    modelName: string,
    type: "whisper" | "ollama"
  ) => {
    setLoading(true);
    setStatus(`正在下载 ${modelName} 模型...`);

    try {
      // TODO: 通过 IPC 下载模型
      // if (type === 'ollama') {
      //   await App.downloadOllamaModel(modelName)
      // } else {
      //   await App.downloadWhisperModel(modelName)
      // }

      // 模拟下载过程
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setStatus(`${modelName} 模型下载完成`);
      if (type === "ollama") {
        loadOllamaModels();
      }
    } catch (error) {
      console.error("下载模型失败:", error);
      setStatus("下载失败");
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(""), 3000);
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
          <CardTitle>翻译设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ollama-model">Ollama 模型</Label>
            <Select
              value={settings.ollamaModel}
              onValueChange={(value) =>
                setSettings((prev) => ({ ...prev, ollamaModel: value }))
              }
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
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadModel(model.name, "ollama");
                            }}
                            disabled={loading}
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
      <Card>
        <CardHeader>
          <CardTitle>系统信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>FFmpeg:</span>
            <Badge variant="outline">已安装</Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span>Whisper:</span>
            <Badge variant="outline">已安装</Badge>
          </div>
          <div className="flex justify-between text-sm">
            <span>Ollama:</span>
            <Badge variant="outline">运行中</Badge>
          </div>
          <Separator />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>版本:</span>
            <span>v0.1.0</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
