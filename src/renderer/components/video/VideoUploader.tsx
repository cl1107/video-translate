import { AlertCircle, FileVideo, Upload, Video } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Alert, AlertDescription } from "renderer/components/ui/alert";
import { Button } from "renderer/components/ui/button";
import { Card, CardContent } from "renderer/components/ui/card";

interface VideoUploaderProps {
  onFilesSelected: (files: File[]) => void;
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

export function VideoUploader({ onFilesSelected }: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const validateFiles = (files: FileList | File[]): File[] => {
    const validFiles: File[] = [];
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (!SUPPORTED_VIDEO_FORMATS.includes(file.type)) {
        setError(
          `不支持的文件格式: ${file.name}. 请上传视频文件 (MP4, AVI, MOV, MKV, WebM, WMV, FLV)`
        );
        continue;
      }

      // 检查文件大小 (限制为 2GB)
      if (file.size > 2 * 1024 * 1024 * 1024) {
        setError(`文件过大: ${file.name}. 请上传小于 2GB 的文件`);
        continue;
      }

      validFiles.push(file);
    }

    return validFiles;
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      setError(null);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const validFiles = validateFiles(e.dataTransfer.files);
        if (validFiles.length > 0) {
          onFilesSelected(validFiles);
        }
      }
    },
    [onFilesSelected]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError(null);
      if (e.target.files && e.target.files.length > 0) {
        const validFiles = validateFiles(e.target.files);
        if (validFiles.length > 0) {
          onFilesSelected(validFiles);
        }
      }
    },
    [onFilesSelected]
  );

  const openFileDialog = () => {
    fileInputRef.current?.click();
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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*"
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
