import { app, dialog, ipcMain } from "electron";
import { ollamaClient } from "./services/ollama/client";
import { taskManager } from "./services/task-manager";
import {
  checkSystemDependencies,
  getInstallationSuggestions,
} from "./utils/system-check";

import { makeAppWithSingleInstanceLock } from "lib/electron-app/factories/app/instance";
import { makeAppSetup } from "lib/electron-app/factories/app/setup";
import { MainWindow } from "./windows/main";

// IPC 处理器
function setupIpcHandlers() {
  // 文件上传处理
  ipcMain.handle("upload-files", async (event, filePaths: string[]) => {
    try {
      const taskIds: string[] = [];

      for (const filePath of filePaths) {
        const taskId = await taskManager.createTask({
          filePath,
          sourceLanguage: "English",
          targetLanguage: "Chinese",
        });
        taskIds.push(taskId);
      }

      return { success: true, taskIds };
    } catch (error) {
      console.error("文件上传失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  // 获取所有任务
  ipcMain.handle("get-all-tasks", () => {
    return taskManager.getAllTasks();
  });

  // 获取特定任务
  ipcMain.handle("get-task", (event, taskId: string) => {
    return taskManager.getTask(taskId);
  });

  // 暂停任务
  ipcMain.handle("pause-task", (event, taskId: string) => {
    taskManager.pauseTask(taskId);
    return { success: true };
  });

  // 恢复任务
  ipcMain.handle("resume-task", (event, taskId: string) => {
    taskManager.resumeTask(taskId);
    return { success: true };
  });

  // 删除任务
  ipcMain.handle("delete-task", (event, taskId: string) => {
    taskManager.deleteTask(taskId);
    return { success: true };
  });

  // 重试任务
  ipcMain.handle("retry-task", (event, taskId: string) => {
    taskManager.retryTask(taskId);
    return { success: true };
  });

  // 获取任务日志
  ipcMain.handle("get-task-logs", (event, taskId: string) => {
    return taskManager.getTaskLogs(taskId);
  });

  // 获取 Ollama 模型列表
  ipcMain.handle("get-ollama-models", async () => {
    try {
      const models = await ollamaClient.listModels();
      return { success: true, models };
    } catch (error) {
      console.error("获取 Ollama 模型失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, models: [] };
    }
  });

  // 检查 Ollama 服务状态
  ipcMain.handle("check-ollama-status", async () => {
    try {
      const isRunning = await ollamaClient.isRunning();
      return { success: true, isRunning };
    } catch (error) {
      console.error("检查 Ollama 状态失败:", error);
      return { success: false, isRunning: false };
    }
  });

  // 拉取 Ollama 模型
  ipcMain.handle("pull-ollama-model", async (event, modelName: string) => {
    try {
      await ollamaClient.pullModel(modelName, (progress) => {
        // 发送进度更新到前端
        event.sender.send("ollama-pull-progress", { modelName, progress });
      });
      return { success: true };
    } catch (error) {
      console.error("拉取 Ollama 模型失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  });

  // 检查系统依赖
  ipcMain.handle("check-system-dependencies", async () => {
    try {
      const results = await checkSystemDependencies();
      const suggestions = getInstallationSuggestions(results);
      return { success: true, results, suggestions };
    } catch (error) {
      console.error("检查系统依赖失败:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        results: [],
        suggestions: [],
      };
    }
  });

  // 打开文件对话框
  ipcMain.handle("open-file-dialog", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "视频文件",
          extensions: ["mp4", "avi", "mov", "mkv", "webm", "wmv", "flv"],
        },
      ],
    });

    return result.filePaths;
  });

  // 获取统计信息
  ipcMain.handle("get-statistics", () => {
    return taskManager.getStatistics();
  });
}

makeAppWithSingleInstanceLock(async () => {
  await app.whenReady();

  // 设置 IPC 处理器
  setupIpcHandlers();

  // 创建主窗口
  const mainWindow = await makeAppSetup(MainWindow);

  // 设置任务管理器的主窗口引用
  taskManager.setMainWindow(mainWindow);
});

// 应用退出时清理资源
app.on("before-quit", () => {
  taskManager.cleanup();
});
