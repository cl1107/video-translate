import { FileText, Settings, Upload, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsPanel } from "renderer/components/settings/SettingsPanel";
import { TaskList } from "renderer/components/task/TaskList";
import { Button } from "renderer/components/ui/button";
import { VideoUploader } from "renderer/components/video/VideoUploader";
import { TranslationTask } from "shared/types/video";

// The "App" comes from the context bridge in preload/index.ts
const { App } = window;

export function MainScreen() {
  const [tasks, setTasks] = useState<TranslationTask[]>([]);
  const [activeTab, setActiveTab] = useState<"upload" | "tasks" | "settings">(
    "upload"
  );
  const [loading, setLoading] = useState(false);

  // 加载所有任务
  const loadTasks = useCallback(async () => {
    try {
      const allTasks = await App.getAllTasks();
      setTasks(allTasks);
    } catch (error) {
      console.error("加载任务失败:", error);
    }
  }, []);

  // 初始化加载任务
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // 监听任务更新
  useEffect(() => {
    const unsubscribeTaskUpdated = App.onTaskUpdated(
      (updatedTask: TranslationTask) => {
        setTasks((prevTasks) => {
          const index = prevTasks.findIndex(
            (task) => task.id === updatedTask.id
          );
          if (index >= 0) {
            // 更新现有任务
            const newTasks = [...prevTasks];
            newTasks[index] = updatedTask;
            return newTasks;
          } else {
            // 添加新任务
            return [updatedTask, ...prevTasks];
          }
        });
      }
    );

    const unsubscribeTaskDeleted = App.onTaskDeleted((taskId: string) => {
      setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
    });

    return () => {
      unsubscribeTaskUpdated();
      unsubscribeTaskDeleted();
    };
  }, []);

  const handleFileUpload = useCallback(async (files: File[]) => {
    // 对于拖拽上传，我们使用文件选择对话框作为替代
    handleSelectFiles();
  }, []);

  const handleSelectFiles = useCallback(async () => {
    setLoading(true);
    try {
      const filePaths = await App.openFileDialog();
      if (filePaths.length > 0) {
        const result = await App.uploadFiles(filePaths);
        if (result.success) {
          console.log("文件上传成功，任务ID:", result.taskIds);
          // 切换到任务列表
          setActiveTab("tasks");
          // 刷新任务列表
          await loadTasks();
        } else {
          console.error("文件上传失败:", result.error);
          alert(`文件上传失败: ${result.error}`);
        }
      }
    } catch (error) {
      console.error("文件选择失败:", error);
      alert(`文件选择失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [loadTasks]);

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
        await loadTasks();
      } catch (error) {
        console.error("任务操作失败:", error);
        alert(`操作失败: ${error.message}`);
      }
    },
    [loadTasks]
  );

  const renderContent = () => {
    switch (activeTab) {
      case "upload":
        return (
          <div className="space-y-4">
            <VideoUploader onFilesSelected={handleFileUpload} />
            <div className="text-center">
              <Button onClick={handleSelectFiles} disabled={loading} size="lg">
                <Upload className="h-4 w-4 mr-2" />
                {loading ? "处理中..." : "或点击选择文件"}
              </Button>
            </div>
          </div>
        );
      case "tasks":
        return <TaskList tasks={tasks} onTaskAction={handleTaskAction} />;
      case "settings":
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部导航栏 */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Video className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-semibold">视频翻译助手</h1>
            </div>

            <div className="flex space-x-1">
              <Button
                variant={activeTab === "upload" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("upload")}
              >
                <Upload className="h-4 w-4 mr-2" />
                上传视频
              </Button>
              <Button
                variant={activeTab === "tasks" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("tasks")}
              >
                <FileText className="h-4 w-4 mr-2" />
                任务列表 {tasks.length > 0 && `(${tasks.length})`}
              </Button>
              <Button
                variant={activeTab === "settings" ? "default" : "ghost"}
                size="sm"
                onClick={() => setActiveTab("settings")}
              >
                <Settings className="h-4 w-4 mr-2" />
                设置
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 主要内容区域 */}
      <main className="container mx-auto px-4 py-6">{renderContent()}</main>
    </div>
  );
}
