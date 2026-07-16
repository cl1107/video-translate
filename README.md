# 视频翻译助手 🎬

基于 **sherpa-onnx（SenseVoice / Fun-ASR-Nano）+ Ollama + Electron** 的本地视频翻译软件，支持离线语音识别、翻译和字幕生成。仓库使用 pnpm Workspace 与 Turborepo 管理桌面应用和产品官网。

**产品官网（GitHub Pages）：** [https://cl1107.github.io/video-translate/](https://cl1107.github.io/video-translate/)

![视频翻译助手](https://img.shields.io/badge/version-0.6.1-blue.svg)
![平台支持](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Pages](https://img.shields.io/badge/GitHub%20Pages-live-success.svg)

## ✨ 特性

- 🚀 **本地处理** - 视频、识别结果和翻译内容无需上传到第三方服务
- 🔗 **在线链接** - 粘贴 YouTube / B 站等链接，经 yt-dlp 下载后走同一流水线
- 📝 **平台字幕优先** - 有站内人工/自动字幕时直接翻译，跳过 ASR；无字幕再本地识别
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

1. 📹 **本地上传** 或 🔗 **在线链接（yt-dlp）**
2. 🎵 **音频提取**（有平台字幕时可跳过）
3. 🗣️ **语音识别 (ASR)** 或 直接使用**平台字幕**
4. 🌐 **文本翻译** → 5. 📝 **字幕生成**（可选硬字幕烧录）

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

1. **本地上传** 或 **在线链接**（yt-dlp 下载视频 + 平台字幕）
2. **源文获取**（二选一）
   - **平台字幕优先**：解析站内人工/自动字幕，跳过音频提取与 ASR
   - **否则 ASR**：FFmpeg 抽音轨 → sherpa-onnx 转录
3. **文本润色（可选）** → 本地 Ollama 或在线 BYOK；**翻译** → 本地 Ollama
4. **字幕生成** → 输出 SRT / ASS 等
5. **可选** → 硬字幕烧录到视频（需支持 libass 的 FFmpeg）
6. **清理** → 删除临时文件并完成任务

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

# 构建 / 预览产品官网（GitHub Pages 同源构建）
pnpm build:landing
pnpm preview:landing

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

## 📦 发布包说明

GitHub Releases 为每个平台提供 **两种** 安装包（文件名中带标记）：

| 类型               | 文件名标记         | 说明                                                                                       | 何时选用                                        |
| ------------------ | ------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **bundled-ffmpeg** | `-bundled-ffmpeg.` | 安装包**内置** FFmpeg / FFprobe（含硬字幕所需 libass）                                     | **推荐大多数用户**：开箱可用，不必单独装 FFmpeg |
| **slim**           | `-slim.`           | **不内置** FFmpeg，使用系统 PATH（及 macOS 上 Homebrew 常见路径）中的 `ffmpeg` / `ffprobe` | 本机已装完整 FFmpeg，或希望安装包更小           |

示例：

```text
video-translate-vX.Y.Z-mac-arm64-bundled-ffmpeg.dmg
video-translate-vX.Y.Z-mac-arm64-slim.dmg
video-translate-vX.Y.Z-win-x64-bundled-ffmpeg.exe
video-translate-vX.Y.Z-linux-x64-bundled-ffmpeg.AppImage
```

说明：

- **slim** 仍需自行安装 FFmpeg；硬字幕烧录需要带 `subtitles` 滤镜（libass）的完整构建。
- **Ollama**（默认翻译）与 **yt-dlp**（仅在线链接，可选）与 bundled / slim 无关，按应用内依赖检查提示安装即可。
- 每个 Release 附带 `SHA256SUMS.txt`，下载后请校验完整性。
- 官网文档：https://cl1107.github.io/video-translate/docs
  固定说明也会写在每个 Release 正文顶部（由 `scripts/release-notes-preamble.md` 生成）。

### 非签名构建注意事项

CI 产物均为 **未代码签名** 构建（`UNSIGNED_BUILD=1`），适合自用 / 内测。正式对外分发应使用平台开发者证书签名后再发布。

#### macOS（Gatekeeper / quarantine）

从浏览器下载后可能被隔离。若提示「已损坏」「无法打开」或无法验证开发者，对 `.app` 执行：

```bash
# 推荐：清除隔离与扩展属性（路径按实际修改）
xattr -cr "/Applications/视频翻译助手.app"

# 若只想去掉 quarantine：
# xattr -dr com.apple.quarantine "/path/to/视频翻译助手.app"
```

仍失败时可试 `sudo xattr -cr "…"`，或在「系统设置 → 隐私与安全性」中选择仍要打开。

#### Windows（SmartScreen）

未签名安装包 / 便携版可能被 SmartScreen 拦截：

1. 点击 **更多信息**
2. 再点 **仍要运行**

请仅从本仓库 [Releases](https://github.com/cl1107/video-translate/releases) 下载。

#### Linux

```bash
# AppImage：先赋予执行权限
chmod +x video-translate-vX.Y.Z-linux-x64-*.AppImage
./video-translate-vX.Y.Z-linux-x64-*.AppImage
```

deb / rpm / pacman 包未做发行版仓库签名；请用本地包管理器安装，并与 `SHA256SUMS.txt` 核对。部分环境运行 AppImage 可能需要 FUSE。

### 在线下载（yt-dlp，可选）

```bash
# macOS
brew install yt-dlp

# 或其他平台
pip install -U yt-dlp
```

仅本地文件翻译可不安装。部分站点（如 YouTube）可能要求本机浏览器已登录，应用会在需要时尝试读取 Chrome / Safari 等 Cookie。

## ⚠️ 常见问题

### macOS 上 CI / 网盘下载的应用打不开

见上文 [非签名构建注意事项](#非签名构建注意事项)：对 `.app` 执行 `xattr -cr`。

### Windows 提示「已保护你的电脑」

见上文 [非签名构建注意事项](#非签名构建注意事项)：SmartScreen → 更多信息 → 仍要运行。

### 该下 bundled 还是 slim？

见上文 [发布包说明](#-发布包说明)。多数用户选 **bundled-ffmpeg**；已自备 FFmpeg 可选 **slim**。

### macOS 上提示找不到 FFmpeg

- 若使用 **slim** 包：从 Finder / 启动台打开的应用不会加载 shell 的 PATH。应用会尝试解析 Homebrew 中的 `ffmpeg` / `ffmpeg-full`。若仍失败，请确认已安装 FFmpeg。
- 若使用 **bundled-ffmpeg** 包仍报错：请反馈版本与诊断日志（理论上应优先使用内置二进制）。

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
