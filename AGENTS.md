# AGENTS.md

本文件为 Codex (Codex.ai/code) 在此代码库中工作时提供指导。

**重要约定：后续所有沟通必须使用中文。**

## 项目概述

这是一个基于 Electron + React 构建的**视频翻译助手**桌面应用程序。它提供离线视频翻译功能，使用 Whisper 进行语音识别，使用 Ollama 进行 LLM 驱动的翻译。该应用支持从视频中提取音频、转录语音、翻译文本以及生成多种格式的字幕文件。

## 关键开发命令

```bash
# 开发环境
pnpm dev                  # 启动开发服务器（支持热重载）
pnpm start                # 预览已构建的应用

# 构建打包
pnpm build                # 完整的生产环境构建
pnpm compile:app          # 仅编译应用
pnpm make:release         # 创建发布版本

# 代码质量
pnpm lint                 # 运行 Biome 代码检查
pnpm lint:fix             # 自动修复代码检查问题

# 依赖管理
pnpm install              # 安装依赖
pnpm rebuild:native       # 重建原生依赖
```

## 架构概览

### Electron 应用结构
- **主进程** (`src/main/`): 核心服务和任务管理
- **渲染进程** (`src/renderer/`): React UI 组件
- **预加载脚本** (`src/preload/`): 主进程和渲染进程之间的桥梁
- **共享类型** (`src/shared/`): 跨进程使用的 TypeScript 类型

### 核心服务

#### TaskManager (`src/main/services/task-manager.ts`)
管理整个视频翻译流水线的中央协调器：
- 创建和跟踪翻译任务
- 协调 FFmpeg、Whisper 和 Ollama 服务
- 处理任务状态、进度跟踪和错误处理
- 管理数据库持久化以支持任务恢复

#### DatabaseManager (`src/main/services/database/manager.ts`)
基于 SQLite 的数据持久化：
- 存储视频文件、翻译任务和转录段落
- 维护任务日志和进度状态
- 支持统计和清理操作

#### FFmpeg 处理器 (`src/main/services/ffmpeg/processor.ts`)
音视频处理：
- 从视频文件中提取音频
- 将音频分段以进行并行处理
- 支持硬字幕烧录（可选）

#### Whisper 服务 (`src/main/services/whisper/transcriber.ts`)
使用 whisper-node 的语音识别：
- 处理音频段的批量转录
- 管理模型下载和可用性检查
- 为 UI 更新提供进度回调

#### Ollama 客户端 (`src/main/services/ollama/client.ts`)
LLM 驱动的翻译：
- 管理 Ollama 守护进程生命周期
- 提供模型交互的 REST API 接口
- 支持带进度跟踪的批量翻译

### 翻译流水线流程

1. **文件上传** → 创建包含视频元数据的任务
2. **音频提取** → FFmpeg 提取音轨
3. **音频分段** → 分割为可管理的块（约30秒）
4. **语音识别** → Whisper 转录每个段落
5. **翻译** → Ollama 翻译转录的文本
6. **字幕生成** → 创建 SRT、VTT 和 TXT 文件
7. **清理** → 删除临时文件并完成任务

## 关键配置文件

### 构建配置
- `electron.vite.config.ts` - Electron-Vite 构建配置
- `electron-builder.ts` - 应用程序打包和分发
- `tsconfig.json` - TypeScript 配置

### 代码质量
- `biome.json` - 代码格式化和检查规则
- 使用单引号、2空格缩进、按需使用分号
- 检查规则为 React/TypeScript 开发配置

### 开发环境
- 使用 **pnpm** 作为包管理器
- **Electron-Vite** 作为构建工具
- **TailwindCSS** 配合 Radix UI 组件进行样式设计
- **React 19** 配合 TypeScript

## 重要实现细节

### 数据库架构
SQLite 数据库使用以下主要表：
- `video_files` - 源视频元数据
- `translation_tasks` - 任务状态和进度
- `transcription_segments` - 转录的文本段落
- `task_logs` - 详细的任务操作日志

### IPC 通信
主进程暴露以下 IPC 处理器：
- `upload-files` - 创建新的翻译任务
- `get-all-tasks` / `get-task` - 任务检索
- `pause-task` / `resume-task` / `delete-task` - 任务控制
- `get-ollama-models` / `pull-ollama-model` - 模型管理
- `check-system-dependencies` - 系统要求验证

### 任务状态
任务经历以下状态：
- `pending` → `extracting_audio` → `transcribing` → `translating` → `generating_subtitles` → `completed`/`failed`

### 错误处理
- 通过 TaskLog 系统进行全面日志记录
- 服务不可用时优雅降级
- 自动清理临时文件
- 为 UI 显示提供详细错误消息

## 系统依赖

### 必需的外部工具
- **FFmpeg** - 音视频处理（必须在系统 PATH 中）
- **Ollama** - LLM 运行时服务（自动管理）
- **Node.js 18+** - 运行时环境

### 管理的依赖
- **whisper-node** - Whisper 语音识别（自动下载模型）
- **better-sqlite3** - 带有原生绑定的 SQLite 数据库
- **Electron** - 桌面应用程序框架

## 开发说明

### 组件架构
- React 组件使用 Radix UI 原语配合 TailwindCSS
- 通过 React hooks 和 IPC 通信进行状态管理
- 支持响应式设计和暗黑模式

### 测试方法
- 未配置特定的测试框架
- 通过开发服务器进行手动测试
- 考虑为生产就绪性添加测试框架

### 性能考虑
- 音频分段以进行并行处理
- 进度回调以实现实时 UI 更新
- 大视频文件的内存管理
- 数据库索引以提高查询效率

### 安全考虑
- 所有处理在本地进行（离线优先）
- 临时文件自动清理
- 实施了 Electron 安全最佳实践
- 除本地 Ollama 服务外无外部 API 调用