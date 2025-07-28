# 视频翻译助手 🎬

基于 Ollama + Electron 的本地视频翻译软件，支持离线语音识别、翻译和字幕生成。

![视频翻译助手](https://img.shields.io/badge/version-0.1.0-blue.svg)
![平台支持](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ 特性

- 🚀 **完全本地化** - 无需联网，保护隐私
- 🎯 **高精度识别** - 集成 Whisper AI 语音识别
- 🌍 **多语言支持** - 支持 15+ 种语言互译
- ⚡ **智能处理** - 自动音频分段，并行处理
- 🎨 **现代界面** - React 19 + TailwindCSS，支持暗黑模式
- 📁 **多格式输出** - SRT、VTT、TXT 字幕格式
- 🔄 **断点续传** - 任务管理，支持暂停/恢复
- 🛠️ **模块化设计** - 可扩展的插件架构

## 🖼️ 界面预览

### 主界面

- **上传视频**: 拖拽或选择视频文件
- **任务列表**: 实时查看处理进度
- **设置页面**: 配置模型和参数

### 工作流程

1. 📹 **视频上传** → 2. 🎵 **音频提取** → 3. 🗣️ **语音识别** → 4. 🌐 **文本翻译** → 5. 📝 **字幕生成**

## 🚀 快速开始

### 系统要求

- Node.js 18.0+
- 8GB+ 内存
- 10GB+ 硬盘空间

### 安装依赖

```bash
# 克隆项目
git clone https://github.com/your-username/video-translate.git
cd video-translate

# 安装 Node.js 依赖
pnpm install

# 安装系统依赖 (macOS)
brew install ffmpeg ollama

# 安装 Whisper
pip install openai-whisper
```

### 启动应用

```bash
# 开发模式
pnpm dev

# 生产构建
pnpm build
```

### 下载模型

```bash
# Ollama 翻译模型
ollama pull llama3

# Whisper 会在首次使用时自动下载
```

## 🏗️ 技术架构

### 前端 (Renderer Process)

- **React 19** - 最新的 React 框架
- **TypeScript 5** - 类型安全
- **TailwindCSS 4** - 现代化样式
- **shadcn/ui** - 高质量组件库

### 后端 (Main Process)

- **Electron 37** - 跨平台桌面应用
- **SQLite** - 本地数据存储
- **FFmpeg** - 音视频处理
- **Whisper** - AI 语音识别
- **Ollama** - 本地大语言模型

### 核心服务

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Task Manager  │    │  Database Mgr   │    │  Subtitle Gen   │
│   任务管理器    │ ←→ │   数据库管理    │ ←→ │   字幕生成器    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ↓                       ↓                       ↓
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ FFmpeg Service  │    │ Whisper Service │    │ Ollama Service  │
│   音视频处理    │    │   语音识别      │    │   文本翻译      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📚 详细文档

- [安装指南](docs/installation.md) - 完整的安装和配置说明
- [开发计划](docs/development_plan.md) - 技术方案和架构设计
- [API 文档](docs/api.md) - 内部 API 接口说明

## 🛠️ 开发

### 项目结构

```
src/
├── main/                 # 主进程
│   ├── services/        # 核心服务
│   │   ├── ollama/      # Ollama 翻译
│   │   ├── whisper/     # Whisper 识别
│   │   ├── ffmpeg/      # 音视频处理
│   │   └── database/    # 数据库管理
│   └── utils/           # 工具函数
├── renderer/            # 渲染进程
│   ├── components/      # React 组件
│   └── screens/         # 页面组件
├── preload/             # 预加载脚本
└── shared/              # 共享类型
```

### 开发命令

```bash
# 启动开发服务器
pnpm dev

# 类型检查
pnpm lint

# 构建应用
pnpm build

# 重建原生依赖
pnpm rebuild:native
```

## 🎯 使用场景

- 📺 **视频字幕制作** - 为视频添加多语言字幕
- 🎓 **教育培训** - 课程视频本地化
- 📰 **新闻媒体** - 新闻视频快速翻译
- 🎬 **内容创作** - YouTube、B 站视频字幕
- 🏢 **企业培训** - 内部培训材料翻译

## 🔒 隐私安全

- ✅ **完全离线** - 所有处理在本地完成
- ✅ **数据加密** - SQLite 数据库加密存储
- ✅ **沙盒隔离** - Electron 安全沙盒
- ✅ **无网络传输** - 视频文件不上传到云端

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

- [Whisper](https://github.com/openai/whisper) - OpenAI 语音识别模型
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
