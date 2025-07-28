import { contextBridge, ipcRenderer } from "electron";
import { TranslationTask } from "../shared/types/video";

declare global {
  interface Window {
    App: typeof API;
  }
}

const API = {
  sayHelloFromBridge: () => console.log("\nHello from bridgeAPI! 👋\n\n"),
  username: process.env.USER,

  // 文件处理
  uploadFiles: (filePaths: string[]) =>
    ipcRenderer.invoke("upload-files", filePaths),

  openFileDialog: () => ipcRenderer.invoke("open-file-dialog"),

  // 任务管理
  getAllTasks: (): Promise<TranslationTask[]> =>
    ipcRenderer.invoke("get-all-tasks"),

  getTask: (taskId: string): Promise<TranslationTask | null> =>
    ipcRenderer.invoke("get-task", taskId),

  pauseTask: (taskId: string) => ipcRenderer.invoke("pause-task", taskId),

  resumeTask: (taskId: string) => ipcRenderer.invoke("resume-task", taskId),

  deleteTask: (taskId: string) => ipcRenderer.invoke("delete-task", taskId),

  retryTask: (taskId: string) => ipcRenderer.invoke("retry-task", taskId),

  // 统计信息
  getStatistics: () => ipcRenderer.invoke("get-statistics"),

  // 事件监听
  onTaskUpdated: (callback: (task: TranslationTask) => void) => {
    ipcRenderer.on("task-updated", (event, task) => callback(task));
    return () => ipcRenderer.removeAllListeners("task-updated");
  },

  onTaskDeleted: (callback: (taskId: string) => void) => {
    ipcRenderer.on("task-deleted", (event, taskId) => callback(taskId));
    return () => ipcRenderer.removeAllListeners("task-deleted");
  },
};

contextBridge.exposeInMainWorld("App", API);
