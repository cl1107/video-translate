import { FileText, Settings, Upload, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TaskList } from "renderer/components/task/TaskList";
import { Button } from "renderer/components/ui/button";
import { VideoUploader } from "renderer/components/video/VideoUploader";
import type { TranslationTask } from "shared/types/video";

// The "App" comes from the context bridge in preload/index.ts
const { App } = window;

export function MainScreen() {
  const [tasks, setTasks] = useState<TranslationTask[]>([]);
  const [activeTab, setActiveTab] = useState<"upload" | "tasks">("upload");
  const navigate = useNavigate();

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
          }
          // 添加新任务
          return [updatedTask, ...prevTasks];
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

  const handleUploadSuccess = () => {
    setActiveTab("tasks");
    loadTasks();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Video className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">视频翻译助手</h1>
            </div>

            <div className="flex items-center space-x-4">
              {/* 标签页导航 */}
              <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                <Button
                  variant={activeTab === "upload" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("upload")}
                  className="flex items-center space-x-2"
                >
                  <Upload className="h-4 w-4" />
                  <span>上传视频</span>
                </Button>
                <Button
                  variant={activeTab === "tasks" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("tasks")}
                  className="flex items-center space-x-2"
                >
                  <FileText className="h-4 w-4" />
                  <span>任务列表</span>
                  {tasks.length > 0 && (
                    <span className="bg-blue-600 text-white text-xs rounded-full px-2 py-0.5 min-w-[20px] text-center">
                      {tasks.length}
                    </span>
                  )}
                </Button>
              </div>

              {/* 设置按钮 */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/settings")}
                className="flex items-center space-x-2"
              >
                <Settings className="h-4 w-4" />
                <span>设置</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容区域 */}
      <div className="container mx-auto px-6 py-8">
        {activeTab === "upload" && (
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold text-gray-900">
                上传您的视频文件
              </h2>
              <p className="text-xl text-gray-600">
                支持多种格式，自动生成翻译字幕
              </p>
            </div>

            <VideoUploader onUploadSuccess={handleUploadSuccess} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div className="p-6 bg-white rounded-lg shadow-sm border">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🎬</span>
                </div>
                <h3 className="font-semibold mb-2">智能处理</h3>
                <p className="text-sm text-gray-600">
                  自动提取音频，智能分段处理
                </p>
              </div>
              <div className="p-6 bg-white rounded-lg shadow-sm border">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🎯</span>
                </div>
                <h3 className="font-semibold mb-2">高精度识别</h3>
                <p className="text-sm text-gray-600">
                  使用 sherpa-onnx 和 SenseVoice 进行本地语音识别
                </p>
              </div>
              <div className="p-6 bg-white rounded-lg shadow-sm border">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🌐</span>
                </div>
                <h3 className="font-semibold mb-2">本地翻译</h3>
                <p className="text-sm text-gray-600">
                  本地 Ollama 模型，保护隐私安全
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="max-w-6xl mx-auto">
            <TaskList tasks={tasks} onTasksChange={loadTasks} />
          </div>
        )}
      </div>
    </div>
  );
}
