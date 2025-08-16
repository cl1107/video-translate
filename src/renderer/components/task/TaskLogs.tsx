import { AlertCircle, CheckCircle, Info, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "renderer/components/ui/card";
import type { TaskLog } from "shared/types/video";

interface TaskLogsProps {
  taskId: string;
}

export function TaskLogs({ taskId }: TaskLogsProps) {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, [taskId]);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const taskLogs = await App.getTaskLogs(taskId);
      setLogs(taskLogs);
    } catch (error) {
      console.error("加载任务日志失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const getLogIcon = (level: TaskLog["level"]) => {
    switch (level) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warn":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogBgColor = (level: TaskLog["level"]) => {
    switch (level) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "warn":
        return "bg-yellow-50 border-yellow-200";
      default:
        return "bg-blue-50 border-blue-200";
    }
  };

  const formatTime = (timestamp: Date) => {
    return new Date(timestamp).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 1,
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>处理日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          处理日志 ({logs.length} 条)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            暂无日志记录
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto" style={{ userSelect: 'text' }}>
            {logs.map((log) => (
              <div
                key={log.id}
                className={`p-3 rounded-lg border ${getLogBgColor(log.level)}`}
                style={{ userSelect: 'text' }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    {getLogIcon(log.level)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-900" style={{ userSelect: 'text' }}>
                        {log.message}
                      </div>
                      <div className="text-xs text-gray-500 ml-2" style={{ userSelect: 'text' }}>
                        {formatTime(log.timestamp)}
                      </div>
                    </div>
                    {log.details && (
                      <div className="mt-1 text-xs text-gray-600 break-all" style={{ userSelect: 'text' }}>
                        {log.details}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
