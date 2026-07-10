import { AlertCircle, FileVideo, Upload, Video } from "lucide-react";
import { useCallback, useState } from "react";
import { Alert, AlertDescription } from "renderer/components/ui/alert";
import { Button } from "renderer/components/ui/button";
import { Card, CardContent } from "renderer/components/ui/card";

interface VideoUploaderProps {
  onUploadSuccess?: () => void;
}

const SUPPORTED_VIDEO_FORMATS = [
  "video/mp4",
  "video/avi",
  "video/mov",
  "video/mkv",
  "video/webm",
  "video/wmv",
  "video/flv",
];

export function VideoUploader({ onUploadSuccess }: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setError(null);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      // 对于拖拽上传，我们也使用系统文件对话框
      openFileDialog();
    }
  }, []);

  const openFileDialog = async () => {
    try {
      // 直接调用系统文件选择对话框
      const filePaths = await (window as any).App.openFileDialog();
      if (filePaths.length > 0) {
        // 从localStorage读取设置
        const savedSettings = localStorage.getItem("video-translate-settings");
        const settings = savedSettings
          ? JSON.parse(savedSettings)
          : {
              sourceLanguage: "auto",
              targetLanguage: "zh",
              ollamaModel: "kaelri/hy-mt2:1.8b",
              asrEngine: "sensevoice",
              burnSubtitles: false,
            };

        const result = await (window as any).App.uploadFiles(filePaths, {
          sourceLanguage: settings.sourceLanguage ?? "auto",
          targetLanguage: settings.targetLanguage ?? "zh",
          ollamaModel: settings.ollamaModel,
          asrEngine: settings.asrEngine ?? "sensevoice",
          burnSubtitles: settings.burnSubtitles ?? false,
        });
        if (result.success) {
          console.log("文件上传成功，任务ID:", result.taskIds);
          onUploadSuccess?.();
        } else {
          console.error("文件上传失败:", result.error);
          setError(`文件上传失败: ${result.error}`);
        }
      }
    } catch (error) {
      console.error("文件选择失败:", error);
      setError(
        `文件选择失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card
        className={`transition-colors duration-200 ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-dashed border-2 hover:border-primary/50"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4">
            {dragActive ? (
              <FileVideo className="h-12 w-12 text-primary animate-pulse" />
            ) : (
              <Upload className="h-12 w-12 text-muted-foreground" />
            )}
          </div>

          <h3 className="text-lg font-semibold mb-2">
            {dragActive ? "释放文件开始上传" : "拖拽视频文件到此处"}
          </h3>

          <p className="text-muted-foreground mb-4">
            支持 MP4, AVI, MOV, MKV, WebM, WMV, FLV 格式
          </p>

          <div className="flex items-center space-x-4">
            <Button onClick={openFileDialog} variant="outline">
              <Video className="h-4 w-4 mr-2" />
              选择文件
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            最大文件大小: 2GB
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
