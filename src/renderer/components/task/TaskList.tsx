import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileVideo,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
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
import { TaskLogs } from "./TaskLogs";

const { App } = window;

interface TaskListProps {
  tasks: TranslationTask[];
  onTasksChange: () => void;
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

const formatDate = (date: Date): string => {
  return date.toLocaleDateString();
};

export function TaskList({ tasks, onTasksChange }: TaskListProps) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  const handleTaskAction = useCallback(
    async (action: string, taskId: string) => {
      try {
        switch (action) {
          case "pause":
            await App.pauseTask(taskId);
            break;
          case "resume":
            await App.resumeTask(taskId);
            break;
          case "delete":
            if (confirm("确定要删除这个任务吗？")) {
              await App.deleteTask(taskId);
            }
            break;
          case "retry":
            await App.retryTask(taskId);
            break;
          default:
            console.warn("未知的任务操作:", action);
        }

        // 刷新任务列表
        onTasksChange();
      } catch (error) {
        console.error("任务操作失败:", error);
        alert(`操作失败: ${error.message || error}`);
      }
    },
    [onTasksChange]
  );

  const toggleTaskExpanded = (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };

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

      {tasks.map((task) => {
        const isExpanded = expandedTasks.has(task.id);
        return (
          <Card key={task.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FileVideo className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">
                      {task.videoFile.name}
                    </CardTitle>
                    <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-1">
                      <span className="flex items-center">
                        <Clock className="h-4 w-4 mr-1" />
                        {formatDuration(task.videoFile.duration)}
                      </span>
                      <span>{formatFileSize(task.videoFile.size)}</span>
                      <span className="flex items-center">
                        <Calendar className="h-4 w-4 mr-1" />
                        {formatDate(task.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Badge variant={getStatusVariant(task.status)}>
                    {getStatusText(task.status)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleTaskExpanded(task.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
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
                  <p className="text-sm text-destructive">
                    {task.errorMessage}
                  </p>
                </div>
              )}

              {/* 展开的详细信息 */}
              {isExpanded && (
                <div className="space-y-4 pt-4 border-t">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">源语言:</span>{" "}
                      {task.sourceLanguage}
                    </div>
                    <div>
                      <span className="font-medium">目标语言:</span>{" "}
                      {task.targetLanguage}
                    </div>
                  </div>

                  {/* 任务日志 */}
                  <TaskLogs taskId={task.id} />
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex space-x-2">
                  {task.status === TaskStatus.PENDING ||
                  task.status === TaskStatus.EXTRACTING_AUDIO ||
                  task.status === TaskStatus.TRANSCRIBING ||
                  task.status === TaskStatus.TRANSLATING ||
                  task.status === TaskStatus.GENERATING_SUBTITLES ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction("pause", task.id)}
                    >
                      <Pause className="h-4 w-4 mr-1" />
                      暂停
                    </Button>
                  ) : null}

                  {task.status === TaskStatus.PAUSED && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction("resume", task.id)}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      继续
                    </Button>
                  )}

                  {task.status === TaskStatus.FAILED && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTaskAction("retry", task.id)}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      重试
                    </Button>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTaskAction("delete", task.id)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
