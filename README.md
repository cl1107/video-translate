# 视频翻译助手 🎬

基于 **sherpa-onnx（SenseVoice / Fun-ASR-Nano）+ Electron** 的本地优先桌面工具：可从视频提取原文字幕、通过任意 **OpenAI 兼容模型服务 Endpoint** 翻译字幕，或把音视频整理成 **Markdown 文稿**。仓库使用 pnpm Workspace 与 Turborepo 管理桌面应用和产品官网。

**产品官网（GitHub Pages）：** [https://cl1107.github.io/video-translate/](https://cl1107.github.io/video-translate/)

![视频翻译助手](https://img.shields.io/badge/version-0.8.2-blue.svg)
![平台支持](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Pages](https://img.shields.io/badge/GitHub%20Pages-live-success.svg)

## ✨ 特性

- 🚀 **本地优先** - 媒体文件、音频提取与 ASR 始终在本机处理；启用远程模型服务时仅发送识别后的文本
- 🔀 **双工作流** - 顶栏切换「字幕」与「文稿」，任务列表与流水线彼此独立
- 🔗 **在线链接** - 粘贴 YouTube / B 站等链接，经 yt-dlp 下载后进入对应流水线
- 📝 **平台字幕优先** - 有站内人工/自动字幕时直接采用，跳过 ASR；无字幕再本地识别
- 🎯 **高精度识别** - 基于 sherpa-onnx，默认 SenseVoice Small（中/英/日/韩/粤）
- 📃 **仅提取原文** - 只生成原文 SRT，可选烧录原文字幕，全程无需模型服务
- 🌍 **多语言翻译** - 字幕线通过配置的 OpenAI 兼容模型服务翻译；可选同一 Endpoint 润色识别原文
- 📄 **Markdown 文稿** - 文稿线整篇 AI 润色为结构化 MD，全屏预览 / 复制 / 导出
- ⚡ **智能处理** - 自动音频提取、分段识别与进度回调
- 🎨 **现代界面** - React 19 + TailwindCSS 4 + Base UI，支持暗黑模式
- 📁 **多格式输出** - 原文 / 译文 / 双语 SRT、ASS 与可选硬字幕；输出到 `output` 或源视频同目录
- 🔄 **任务管理** - 进度、日志、本地时间与处理耗时；支持暂停/恢复和批量删除已结束任务
- 🖊️ **字幕校对工作台** - 同步播放媒体，对照修改原文/译文与起止时间，单段重译后保存并重新导出；未保存草稿会提示
- 📋 **问题清单** - 标记空译、空译回退、时间重叠、时长过短/过长和单行过长；仅提取原文模式不将缺少译文视为问题
- 📥 **字幕导入** - 导入 SRT / VTT 后直接校对，或复用为翻译任务；可关联本地视频同步播放与烧录
- 📚 **术语库** - 设置中维护固定译法；翻译时带上相邻原文作上下文，但只输出当前段
- ♻️ **断点恢复** - 识别、润色、翻译按阶段落盘；恢复时复用匹配结果，成功 ASR 块不重复推理
- 🔗 **跨工作流复用** - 完整转录可按当前模型设置生成字幕或文稿，或换目标语言重译，不必重新识别
- 📑 **文稿来源索引** - 文稿末尾附转录首句时间定位目录，预览可跳到对应媒体位置
- 🛠️ **系统依赖自检** - 启动时检测 FFmpeg、模型服务 Endpoint 与 ASR 模型，缺失 SenseVoice 时自动下载

> GitHub Releases 当前安装包仍为 **v0.8.2**。校对工作台、术语库、断点恢复与跨工作流复用已进入源码，需从源码运行或等待下一版本安装包。断点缓存在本机应用数据目录，删除任务时一并清理；导出的结果文件保留。旧版中断任务首次恢复时，未能确认完成的阶段可能需要重做。

## 🆕 0.8.2 更新

- **深度精简安装包体积**：精简生产环境 node_modules 依赖，排除前端未引用的依赖与源码映射，业务 asar 归档从 72MB 压缩至 11MB（-84.7%）。
- **原生模块与动态库去重**：清除 better-sqlite3 源码与中间编译文件（-22MB），自动去重 sherpa-onnx 动态链接库（-28.3MB）。
- **语言包裁剪**：剔除 Electron 框架中 50+ 个非中英文本地化语言包。
- **Slim 构建模式与自用脚本**：`pnpm install:local` 默认以 Slim 模式安装，整体占用从 557MB 腰斩至 275MB（-50.6%），并提供 `--bundled` 选项。
- **现代化运行时**：模型服务客户端升级为使用 Node 原生 `fetch`，彻底移除 `node-fetch` 依赖。

## 0.8.1 更新

- 字幕翻译单段空结果会自动重试；仍为空时回退该段原文，不再因偶发空译中断整条任务。
- 重试、回退与失败段会写入处理日志（含原文预览），完成时汇总回退段数。
- 模型服务 Endpoint / 模型硬错误仍会在重试耗尽后终止任务并报告段落位置。

## 0.8.0 更新

- 字幕任务可在「翻译字幕」与「仅提取原文」之间选择；仅原文模式不启动润色和翻译。
- 设置中可选择字幕与烧录视频的保存位置：素材旁的 `output` 子目录（默认）或源视频同目录。文稿仍写入 `output`。
- 原文字幕按 ASR 或平台字幕实际检测出的语言命名；同名产物使用递增编号，已有结果不会被覆盖。
- 字幕与文稿任务列表支持批量删除完成、失败或取消的任务。该操作保留源文件和结果文件。
- 任务卡展示本地创建时间与实际处理耗时；旧任务结果目录仍可正常打开。
- 持久化设置损坏时自动恢复默认值并提示重新确认。
- 项目包管理器升级到 pnpm 11，当前固定版本为 `11.17.0`。

## 🖼️ 界面预览

### 主界面

- **工作流切换**: 字幕 / 文稿（次级入口，靠品牌区）
- **添加 / 任务**: 当前工作流内的导入与任务列表
- **设置页面**: ASR 引擎、模型服务 Endpoint、翻译/润色模型、术语库、语言、字幕颜色与输出位置

### 字幕工作流

1. 📹 **本地上传**、🔗 **在线链接（yt-dlp）** 或 📥 **导入 SRT / VTT**
2. 🗣️ **平台字幕** 或 **ASR 识别**
3. 🧭 **仅提取原文**（无需模型服务）或 **可选润色 + 模型服务翻译**
4. 📝 **字幕导出**（可选原文 / 译文 / 双语硬字幕烧录）
5. 🖊️ **校对工作台**（对照修改、问题清单、单段重译；可复用到文稿）

### 文稿工作流

1. 📹 **本地音视频** 或 🔗 **在线链接**
2. 🗣️ **平台字幕** 或 **ASR 识别**
3. ✨ **整篇润色为 Markdown**，文末附时间定位来源索引
4. 📖 **全屏预览 / 导出 `.md`**（预览可跳到对应媒体时间）

## 🚀 快速开始

### 系统要求

- Node.js 22.13+
- pnpm 11+（仓库固定 `pnpm@11.17.0`）
- 8GB+ 内存
- 10GB+ 硬盘空间（含模型）

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/cl1107/video-translate.git
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

#### OpenAI 兼容模型服务 Endpoint

仅提取原文字幕时无需配置模型服务。字幕翻译、字幕润色和文稿整理使用设置中配置的 OpenAI 兼容 Endpoint；可以是本机 Ollama、LM Studio、vLLM，也可以是在线 API。使用在线 Endpoint 时，应用只发送识别后的文本，不会上传视频、音频或本地 ASR 模型。

以 Ollama 为本地服务示例（不是必需依赖）：

```bash
# macOS / Linux
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull kaelri/hy-mt2:1.8b

# Windows：https://ollama.ai/download/windows
```

其他 OpenAI 兼容服务请填写其 Base URL（通常带 `/v1`）、模型 ID，以及服务要求的 API Key。

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

#### 模型服务模型

只使用「仅提取原文」可跳过本节。模型 ID 由你配置的 Endpoint 提供；本机 Ollama 可使用：

```bash
ollama pull kaelri/hy-mt2:1.8b
# 也可使用其他兼容模型，例如：
# ollama pull qwen3:4b-instruct
```

在线或其他本地 OpenAI 兼容服务请按其文档准备模型。

## 🏗️ 技术架构

### 前端 (Renderer Process)

- **React 19** - UI 框架
- **TypeScript 7** - 类型安全
- **TailwindCSS 4** - 样式
- **Base UI（@base-ui/react）** - 交互原语；组件风格兼容 shadcn 设计语言
- **react-markdown + remark-gfm** - 文稿全屏预览

### 后端 (Main Process)

- **Electron 43** - 跨平台桌面应用
- **SQLite (better-sqlite3)** - 本地任务与日志存储
- **FFmpeg** - 音频提取、分段、可选硬字幕烧录
- **sherpa-onnx-node** - 本地 ASR（SenseVoice / Fun-ASR-Nano）
- **OpenAI 兼容模型服务** - 按需使用的本地或在线大语言模型（字幕翻译、润色与文稿整理）；Ollama、LM Studio、vLLM 均可作为本地 Endpoint

### 核心服务

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Task Manager  │    │  Database Mgr   │    │ Subtitle / MD   │
│  任务（双 kind）│ ←→ │   数据库管理    │ ←→ │  字幕 / 文稿产物 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ↓                       ↓                       ↓
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ FFmpeg Service  │    │  ASR (sherpa)   │    │ OpenAI 兼容 LLM   │
│   音视频处理    │    │   语音识别      │    │  翻译 · 润色    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 字幕流水线

1. **本地上传** 或 **在线链接**（yt-dlp 下载视频 + 平台字幕）
2. **源文获取**（二选一）
   - **平台字幕优先**：解析站内人工/自动字幕，跳过音频提取与 ASR
   - **否则 ASR**：FFmpeg 抽音轨 → sherpa-onnx 转录
3. **选择处理方式**
   - **仅提取原文**：跳过润色与翻译，只生成原文 SRT，无需模型服务
   - **翻译字幕**：文本润色（可选）→ 通过配置的 OpenAI 兼容 Endpoint 翻译
4. **字幕生成** → 仅原文模式输出原文 SRT；翻译模式输出原文 / 译文 / 双语 SRT 与 ASS
5. **可选** → 烧录原文、译文或双语硬字幕到视频（需支持 libass 的 FFmpeg）
6. **写入产物** → 默认保存到 `{素材旁}/output/`，也可在设置中改为源视频同目录；实际语言进入文件名且避免覆盖
7. **校对** → 任务列表进入校对工作台，对照媒体修改文本与时间轴，保存后重新导出
8. **清理** → 删除临时文件并完成任务；中断时保留阶段断点，恢复只补未完成部分

### 文稿流水线

1. **本地音视频** 或 **在线链接**（也可从已完成识别的字幕任务复用）
2. **源文获取**（平台字幕或 ASR，与字幕线共享基建）
3. **整篇润色** → 结构化 Markdown（长文分块）
4. **来源索引** → 文末附转录首句时间定位目录，不是模型生成的语义章节摘要
5. **写入** `{素材旁}/output/{文件名}.md` → 应用内全屏预览，可跳到对应媒体时间

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
│   │   ├── llm/             # OpenAI 兼容模型服务客户端与文本处理
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
- 📄 **会议 / 课程笔记** - 把长视频整理成可读 Markdown 文稿
- 🎓 **教育培训** - 课程视频本地化或文档化
- 📰 **新闻媒体** - 新闻视频快速翻译
- 🎬 **内容创作** - YouTube、B 站等视频字幕或文案底稿
- 🏢 **企业培训** - 内部培训材料翻译与归档

## 🔒 隐私安全

- ✅ **本地优先** - 视频、音频提取、ASR 与产物处理在本机完成
- ✅ **本地存储** - 任务、日志与产物保存在本机
- ✅ **沙盒隔离** - 遵循 Electron 安全实践
- ⚠️ **文本发送边界** - 配置本机 Endpoint 时识别文本留在本机；配置在线 Endpoint 时，仅将识别后的文本（以及必要的提示词）发送到该服务，视频、音频、字幕文件和 ASR 模型不会上传

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
- **模型服务 Endpoint**（翻译 / 润色，按需）与 **yt-dlp**（仅在线链接，可选）与 bundled / slim 无关；使用本机 Ollama 时才需要安装 Ollama，其他 Endpoint 按其文档配置。
- 每个 Release 附带 `SHA256SUMS.txt`，下载后请校验完整性。
- 官网文档：https://cl1107.github.io/video-translate/docs
  每个 Release 正文顶部会附带精简的包类型说明（由 `scripts/release-notes-preamble.md` 生成），完整安装与依赖说明见官网文档。

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
- [OpenAI API](https://platform.openai.com/docs) - OpenAI 兼容模型服务接口；Ollama、LM Studio、vLLM 等本地服务也可接入
- [FFmpeg](https://ffmpeg.org) - 音视频处理工具
- [Electron](https://electronjs.org) - 跨平台桌面应用框架

## 📞 支持

如果这个项目对你有帮助，请给个 ⭐️ Star！

有问题或建议？欢迎：

- 提交 [Issue](https://github.com/cl1107/video-translate/issues)
- 发起 [Discussion](https://github.com/cl1107/video-translate/discussions)

---

**让视频翻译变得简单而私密** ❤️
