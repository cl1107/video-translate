# AGENTS.md

本文件为 Codex (Codex.ai/code) 在此代码库中工作时提供指导。

**重要约定：后续所有沟通必须使用中文。**

## 项目概述

这是一个基于 **Longbridge Native Shell（NSH）** 的**视频翻译助手**桌面应用程序（`apps/nsh`）。它使用本机 FFmpeg、可选 sherpa-onnx CLI（SenseVoice）进行语音识别，通过统一的「模型服务」（任意 OpenAI 兼容 Endpoint）做翻译与润色。应用提供两条独立工作流：**字幕**（翻译并导出 SRT/ASS，可选硬字幕烧录）与**文稿**（整篇润色为 Markdown）。

`apps/desktop/` 是已废弃的 Electron 实现，仅供对照，默认 `dev`/`build`/`start` 桌面入口都是 NSH。

## 关键开发命令

```bash
# 桌面（NSH，需要本机 nsh CLI，当前验证版本 0.5.0）
nsh --version
nsh check apps/nsh
nsh test apps/nsh
nsh run apps/nsh          # 或 pnpm dev:desktop / pnpm start:desktop
nsh package apps/nsh --target macos

# 官网
pnpm dev:landing
pnpm build:landing

# 代码质量
pnpm lint
pnpm test                 # 先跑 nsh test，再跑 Vitest / turbo
```

## 架构概览

### NSH 应用结构

- **桌面应用** (`apps/nsh/`): Rust 二进制 + `nsh_base` UI；领域逻辑在 `src/domain/`
- **产品官网** (`apps/landing/`): Vite + React landing page
- **废弃 Electron** (`apps/desktop/`): 见该目录 `DEPRECATED.md`
- **产品官网** (`apps/landing/`): Vite + React landing page
- **主进程** (`apps/desktop/src/main/`): 核心服务和任务管理
- **渲染进程** (`apps/desktop/src/renderer/`): React UI 组件
- **预加载脚本** (`apps/desktop/src/preload/`): 主进程和渲染进程之间的桥梁
- **共享类型** (`apps/desktop/src/shared/`): 跨进程使用的 TypeScript 类型

### 核心服务

#### TaskManager (`apps/desktop/src/main/services/task-manager.ts`)

管理整个视频翻译流水线的中央协调器：

- 创建和跟踪翻译任务
- 协调 FFmpeg、sherpa-onnx ASR 和模型服务（OpenAI 兼容 Endpoint）
- 处理任务状态、进度跟踪和错误处理
- 管理数据库持久化以支持任务恢复

#### DatabaseManager (`apps/desktop/src/main/services/database/manager.ts`)

基于 SQLite 的数据持久化：

- 存储视频文件、翻译任务和转录段落
- 维护任务日志和进度状态
- 支持统计和清理操作

#### FFmpeg 处理器 (`apps/desktop/src/main/services/ffmpeg/processor.ts`)

音视频处理：

- 从视频文件中提取音频
- 将音频分段以进行并行处理
- 支持硬字幕烧录（可选）

#### ASR 服务 (`apps/desktop/src/main/services/asr/sherpa-transcriber.ts`)

使用 sherpa-onnx-node 进行本地语音识别：

- 处理音频段的批量转录
- 管理模型下载和可用性检查
- 为 UI 更新提供进度回调

#### Ollama 客户端 (`apps/desktop/src/main/services/ollama/client.ts`)

LLM 驱动的翻译：

- 管理 Ollama 守护进程生命周期
- 提供模型交互的 REST API 接口
- 支持带进度跟踪的批量翻译

### 翻译流水线流程

1. **文件上传** → 创建包含视频元数据的任务
2. **音频提取** → FFmpeg 提取音轨
3. **音频分段** → 分割为可管理的块（约30秒）
4. **语音识别** → sherpa-onnx 转录每个段落
5. **翻译** → 模型服务翻译转录的文本
6. **字幕生成** → 创建 SRT、VTT 和 TXT 文件
7. **清理** → 删除临时文件并完成任务

## 关键配置文件

### 构建配置

- `apps/nsh/nsh.json` / `apps/nsh/Cargo.toml` - NSH 桌面应用
- `turbo.json` - monorepo 任务编排（官网）
- `pnpm-workspace.yaml` - Workspace 包声明

### 开发环境

- 桌面端：**nsh 0.5.0** + Rust（`apps/nsh`）
- 官网：pnpm + Vite + React（`apps/landing`）

## 重要实现细节

### 数据库架构

SQLite 数据库使用以下主要表：

- `video_files` - 源视频元数据
- `translation_tasks` - 任务状态和进度
- `transcription_segments` - 转录的文本段落
- `task_logs` - 详细的任务操作日志

### 任务类型与状态

- `task.kind`: `subtitle`（默认）| `document`
- 字幕：`pending` →（`downloading`）→ `extracting_audio` → `transcribing` → `polishing` → `translating` → `generating_subtitles` →（`burning_subtitles`）→ `completed`/`failed`
- 文稿：`pending` →（`downloading`）→ `extracting_audio` → `transcribing` → `polishing` → `completed`/`failed`

### 错误处理

- 通过 TaskLog 系统进行全面日志记录
- 服务不可用时优雅降级
- 自动清理临时文件
- 为 UI 显示提供详细错误消息

## 系统依赖

### 必需的外部工具

- **FFmpeg** - 音视频处理（必须在系统 PATH 中）
- **模型服务** - 任意 OpenAI 兼容 Endpoint（本地 Ollama / LM Studio / vLLM 或在线 API，用户自配）
- **nsh 0.5.0 + Rust** - 桌面运行时（`~/.local/bin/nsh`）
- **sherpa-onnx CLI** - 真实 ASR（SenseVoice 模型；Fun-ASR-Nano 可选）

## 开发说明

### 测试方法

- 桌面：`nsh test apps/nsh`（Rust 领域测试 + 无头 UI）
- 官网：Vitest / turbo

### 性能考虑

- 音频分段以进行并行处理
- 进度回调以实现实时 UI 更新
- 大视频文件的内存管理
- 数据库索引以提高查询效率

### 安全考虑

- 所有处理在本地进行（离线优先）
- 临时文件自动清理
- 仅访问用户配置的模型服务 Endpoint；无其他外部 API 调用

## Design Context

UI / 设计工作请先读对应应用的产品与视觉上下文（Impeccable）：

| 应用   | Register | PRODUCT                   | DESIGN                   |
| ------ | -------- | ------------------------- | ------------------------ |
| 桌面端 | product  | `apps/desktop/PRODUCT.md` | `apps/desktop/DESIGN.md` |
| 官网   | brand    | `apps/landing/PRODUCT.md` | `apps/landing/DESIGN.md` |

- **North stars:** desktop = _The Quiet Workbench_；landing = _The Acid Studio_
- **Live 配置:** `apps/desktop/.impeccable/live/config.json`、`apps/landing/.impeccable/live/config.json`
- 命令入口：`$impeccable`（需指定 target 应用）。设计相关原则与 anti-references 以 PRODUCT/DESIGN 为准，勿与实现细节混写。
