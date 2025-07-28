import {
  CheckCircle,
  Clock,
  Download,
  FileVideo,
  Languages,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge } from "renderer/components/ui/badge";
import { Button } from "renderer/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "renderer/components/ui/card";
import { Progress } from "renderer/components/ui/progress";
import { TaskStatus, TranslationTask } from "shared/types/video";

interface TaskListProps {
  tasks: TranslationTask[];
  onTaskAction?: (action: string, taskId: string) => void;
}

const getStatusIcon = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.PENDING:
      return <Clock className="h-4 w-4" />;
    case TaskStatus.COMPLETED:
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case TaskStatus.FAILED:
      return <XCircle className="h-4 w-4 text-red-500" />;
    case TaskStatus.PAUSED:
      return <Pause className="h-4 w-4 text-yellow-500" />;
    default:
      return <Play className="h-4 w-4 text-blue-500" />;
  }
};

const getStatusText = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.PENDING:
      return "等待中";
    case TaskStatus.EXTRACTING_AUDIO:
      return "提取音频";
    case TaskStatus.TRANSCRIBING:
      return "语音识别";
    case TaskStatus.TRANSLATING:
      return "翻译中";
    case TaskStatus.GENERATING_SUBTITLES:
      return "生成字幕";
    case TaskStatus.COMPLETED:
      return "已完成";
    case TaskStatus.FAILED:
      return "失败";
    case TaskStatus.PAUSED:
      return "已暂停";
    default:
      return "未知状态";
  }
};

const getStatusVariant = (status: TaskStatus) => {
  switch (status) {
    case TaskStatus.COMPLETED:
      return "default" as const;
    case TaskStatus.FAILED:
      return "destructive" as const;
    case TaskStatus.PAUSED:
      return "secondary" as const;
    default:
      return "outline" as const;
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

export function TaskList({ tasks, onTaskAction }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <FileVideo className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">暂无翻译任务</h3>
          <p className="text-muted-foreground">
            上传视频文件开始您的第一个翻译任务
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">翻译任务</h2>
        <Badge variant="outline">{tasks.length} 个任务</Badge>
      </div>

      {tasks.map((task) => (
        <Card key={task.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center space-x-2">
                <FileVideo className="h-4 w-4" />
                <span className="truncate">{task.videoFile.name}</span>
              </CardTitle>

              <div className="flex items-center space-x-2">
                <Badge variant={getStatusVariant(task.status)}>
                  {getStatusIcon(task.status)}
                  <span className="ml-1">{getStatusText(task.status)}</span>
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* 文件信息 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
              <div>
                <span className="font-medium">文件大小:</span>
                <br />
                {formatFileSize(task.videoFile.size)}
              </div>
              <div>
                <span className="font-medium">时长:</span>
                <br />
                {formatDuration(task.videoFile.duration)}
              </div>
              <div className="flex items-center space-x-1">
                <Languages className="h-3 w-3" />
                <span>
                  {task.sourceLanguage} → {task.targetLanguage}
                </span>
              </div>
              <div>
                <span className="font-medium">格式:</span>
                <br />
                {task.videoFile.format.toUpperCase()}
              </div>
            </div>

            {/* 进度条 */}
            {task.status !== TaskStatus.PENDING &&
              task.status !== TaskStatus.FAILED && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>进度</span>
                    <span>{Math.round(task.progress)}%</span>
                  </div>
                  <Progress value={task.progress} className="h-2" />
                </div>
              )}

            {/* 错误信息 */}
            {task.errorMessage && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive">{task.errorMessage}</p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex space-x-2">
                {task.status === TaskStatus.PAUSED && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTaskAction?.("resume", task.id)}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    继续
                  </Button>
                )}

                {(task.status === TaskStatus.EXTRACTING_AUDIO ||
                  task.status === TaskStatus.TRANSCRIBING ||
                  task.status === TaskStatus.TRANSLATING ||
                  task.status === TaskStatus.GENERATING_SUBTITLES) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTaskAction?.("pause", task.id)}
                  >
                    <Pause className="h-3 w-3 mr-1" />
                    暂停
                  </Button>
                )}

                {task.status === TaskStatus.FAILED && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTaskAction?.("retry", task.id)}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    重试
                  </Button>
                )}

                {task.status === TaskStatus.COMPLETED && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onTaskAction?.("download", task.id)}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    下载字幕
                  </Button>
                )}
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onTaskAction?.("delete", task.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>

            {/* 时间信息 */}
            <div className="text-xs text-muted-foreground pt-2 border-t">
              创建时间: {task.createdAt.toLocaleString()}
              {task.completedAt && (
                <> • 完成时间: {task.completedAt.toLocaleString()}</>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
