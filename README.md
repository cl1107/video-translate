# 视频翻译助手 🎬

基于 **sherpa-onnx（SenseVoice / Fun-ASR-Nano）+ Ollama + Electron** 的本地视频翻译软件，支持离线语音识别、翻译和字幕生成。仓库使用 pnpm Workspace 与 Turborepo 管理桌面应用和产品官网。

![视频翻译助手](https://img.shields.io/badge/version-0.4.1-blue.svg)
![平台支持](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ 特性

- 🚀 **本地处理** - 视频、识别结果和翻译内容无需上传到第三方服务
- 🎯 **高精度识别** - 基于 sherpa-onnx，默认 SenseVoice Small（中/英/日/韩/粤）
- 🌍 **多语言翻译** - 通过本地 Ollama 大模型进行文本翻译
- ⚡ **智能处理** - 自动音频提取、分段识别与进度回调
- 🎨 **现代界面** - React 19 + TailwindCSS，支持暗黑模式
- 📁 **多格式输出** - SRT、VTT、TXT 字幕；可选硬字幕烧录
- 🔄 **任务管理** - 支持任务进度跟踪、暂停/恢复与日志查看
- 🛠️ **系统依赖自检** - 启动时检测 FFmpeg / Ollama / ASR 模型，缺失 SenseVoice 时自动下载

## 🖼️ 界面预览

### 主界面

- **上传视频**: 拖拽或选择视频文件
- **任务列表**: 实时查看处理进度与任务日志
- **设置页面**: 配置 ASR 引擎、Ollama 模型、语言与硬字幕选项

### 工作流程

1. 📹 **视频上传** → 2. 🎵 **音频提取** → 3. 🗣️ **语音识别 (ASR)** → 4. 🌐 **文本翻译** → 5. 📝 **字幕生成**（可选硬字幕烧录）

## 🚀 快速开始

### 系统要求

- Node.js 22.13+
- 8GB+ 内存
- 10GB+ 硬盘空间（含模型）

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/your-username/video-translate.git
cd video-translate

# 安装 Node.js 依赖
pnpm install
```

### 安装系统工具

#### FFmpeg

```bash
# macOS
brew install ffmpeg
# 若需要烧录硬字幕（libass / subtitles 滤镜），推荐：
brew install ffmpeg-full

# Ubuntu / Debian
sudo apt update
sudo apt install ffmpeg libass9

# Windows
# 从 https://ffmpeg.org/download.html 下载完整构建，并加入 PATH
```

> **说明**
>
> - 应用会解析系统 PATH 中的 `ffmpeg` / `ffprobe`。
> - 在 macOS 上，图形界面启动时 PATH 可能不包含 Homebrew；应用会额外查找 `ffmpeg-full` / `ffmpeg` 的 keg 路径。
> - 硬字幕烧录依赖 FFmpeg 的 `subtitles` 滤镜（libass）。精简版 FFmpeg 可能不可用，此时请安装完整构建。

#### Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows：https://ollama.ai/download/windows
```

### 启动应用

```bash
# 开发模式
pnpm dev:desktop

# 预览已构建应用
pnpm start:desktop

# 生产构建
pnpm build:desktop
```

### 模型准备

#### ASR（语音识别）

默认引擎为 **SenseVoice Small**，由 sherpa-onnx 在本地执行语音识别。应用在依赖检查、启动或首次处理任务时，会自动下载并解压模型到 `models/asr/`，无需额外安装 Python 运行环境。

可选引擎：

| 引擎                 | 说明                                             | 获取方式                                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `sensevoice`（默认） | 中/英/日/韩/粤，速度快，适合 CJK 字幕            | 自动下载                                         |
| `funasr-nano`        | 方言 / 远场 / 嘈杂场景更强，模型更大（约 950MB） | 手动下载，见 `apps/desktop/models/asr/README.md` |

也可通过环境变量指定模型目录：

```bash
export VIDEO_TRANSLATE_ASR_MODELS=/path/to/models/asr
```

#### Ollama 翻译模型

```bash
# 默认模型（与应用设置一致）
ollama pull kaelri/hy-mt2:1.8b

# 也可使用其他兼容模型，例如：
# ollama pull qwen3:4b-instruct
```

## 🏗️ 技术架构

### 前端 (Renderer Process)

- **React 19** - UI 框架
- **TypeScript 7** - 类型安全
- **TailwindCSS 4** - 样式
- **Radix UI / shadcn 风格组件** - 交互组件

### 后端 (Main Process)

- **Electron 43** - 跨平台桌面应用
- **SQLite (better-sqlite3)** - 本地任务与日志存储
- **FFmpeg** - 音频提取、分段、可选硬字幕烧录
- **sherpa-onnx-node** - 本地 ASR（SenseVoice / Fun-ASR-Nano）
- **Ollama** - 本地大语言模型翻译

### 核心服务

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Task Manager  │    │  Database Mgr   │    │  Subtitle Gen   │
│   任务管理器    │ ←→ │   数据库管理    │ ←→ │   字幕生成器    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ↓                       ↓                       ↓
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ FFmpeg Service  │    │  ASR (sherpa)   │    │ Ollama Service  │
│   音视频处理    │    │   语音识别      │    │   文本翻译      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 翻译流水线

1. **文件上传** → 创建任务与视频元数据
2. **音频提取** → FFmpeg 提取音轨
3. **语音识别** → sherpa-onnx 转录（SenseVoice / Fun-ASR-Nano）
4. **文本翻译** → Ollama 批量翻译
5. **字幕生成** → 输出 SRT / VTT / TXT
6. **可选** → 硬字幕烧录到视频（需支持 libass 的 FFmpeg）
7. **清理** → 删除临时文件并完成任务

## 📚 详细文档

- [安装指南](docs/installation.md) - 安装与使用说明（部分内容可能仍待同步）
- [开发计划](docs/development_plan.md) - 技术方案与架构设计
- [任务日志功能](docs/task-logs-feature.md) - 任务日志相关说明
- [ASR 模型说明](apps/desktop/models/asr/README.md) - SenseVoice / Fun-ASR-Nano 目录与下载

## 🛠️ 开发

### 项目结构

```
apps/
├── desktop/                 # Electron 桌面应用
│   └── src/
│       ├── main/            # 主进程
│   ├── services/
│   │   ├── asr/             # sherpa-onnx ASR（SenseVoice / Fun-ASR-Nano）
│   │   ├── ollama/          # Ollama 翻译客户端
│   │   ├── ffmpeg/          # 音视频处理
│   │   ├── database/        # SQLite 数据管理
│   │   └── task-manager.ts  # 任务流水线协调
│   └── utils/               # 系统检查、字幕生成、命令路径解析等
│       ├── renderer/        # 渲染进程（React UI）
│       ├── preload/         # 预加载脚本（IPC 桥接）
│       └── shared/          # 共享类型与常量
└── landing/                 # Vite + React 产品官网
turbo.json                   # Turborepo 任务编排
pnpm-workspace.yaml          # Workspace 包声明
```

### 开发命令

```bash
# 启动开发服务器（热重载）
pnpm dev:desktop

# 启动 landing page
pnpm dev:landing

# 预览构建结果
pnpm start:desktop

# 代码检查 / 自动修复
pnpm lint
pnpm lint:fix

# Oxfmt 格式化 / 格式检查
pnpm format
pnpm format:check

# 运行 Vitest 测试
pnpm test

# 系统依赖检测相关测试
pnpm --filter video-translate test:system-check

# 完整构建 / 仅编译 / 发布
pnpm build
pnpm build:desktop
pnpm build:landing
pnpm make:release

# 重建原生依赖（better-sqlite3、sherpa-onnx-node 等）
pnpm --filter video-translate rebuild:native
```

## 🎯 使用场景

- 📺 **视频字幕制作** - 为视频添加多语言字幕
- 🎓 **教育培训** - 课程视频本地化
- 📰 **新闻媒体** - 新闻视频快速翻译
- 🎬 **内容创作** - YouTube、B 站等视频字幕
- 🏢 **企业培训** - 内部培训材料翻译

## 🔒 隐私安全

- ✅ **离线优先** - 识别与翻译均在本地完成
- ✅ **本地存储** - 任务与日志保存在 SQLite
- ✅ **沙盒隔离** - 遵循 Electron 安全实践
- ✅ **无云端上传** - 视频文件不上传到第三方云服务（除本地 Ollama / 首次下载 ASR 模型外）

## ⚠️ 常见问题

### macOS 上提示找不到 FFmpeg

从 Finder / 启动台打开的 Electron 应用不会加载 shell 的 PATH。应用会尝试解析 Homebrew 中的 `ffmpeg` / `ffmpeg-full`。若仍失败，请确认已安装 FFmpeg，或在终端中用 `pnpm dev` 启动。

### 硬字幕烧录失败

错误信息中若出现缺少 `subtitles` 滤镜 / libass：

- macOS: `brew install ffmpeg-full`
- Ubuntu/Debian: 安装带 libass 的完整 FFmpeg（如 `ffmpeg` + `libass9`）
- Windows: 使用官方完整构建

### ASR 模型未就绪

默认会自动下载 SenseVoice。若失败：

1. 检查网络后重新打开应用或点击「重新检查」
2. 手动按 `apps/desktop/models/asr/README.md` 放置模型
3. 确认 `pnpm install` 已正确安装 `sherpa-onnx-node`

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - 本地语音识别运行时
- [SenseVoice / FunASR](https://github.com/modelscope/FunASR) - ASR 模型
- [Ollama](https://ollama.ai) - 本地大语言模型运行时
- [FFmpeg](https://ffmpeg.org) - 音视频处理工具
- [Electron](https://electronjs.org) - 跨平台桌面应用框架

## 📞 支持

如果这个项目对你有帮助，请给个 ⭐️ Star！

有问题或建议？欢迎：

- 提交 [Issue](https://github.com/your-username/video-translate/issues)
- 发起 [Discussion](https://github.com/your-username/video-translate/discussions)

---

**让视频翻译变得简单而私密** ❤️
