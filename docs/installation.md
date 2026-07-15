# 视频翻译助手 - 安装和使用指南

## 系统要求

- **操作系统**: macOS 10.15+, Windows 10+, Ubuntu 18.04+
- **Node.js**: v18.0.0 或更高版本
- **内存**: 建议 8GB 以上
- **硬盘**: 至少 10GB 可用空间（用于模型文件）

## 依赖安装

### 1. 安装 FFmpeg

#### macOS (使用 Homebrew)

```bash
brew install ffmpeg
```

#### Windows (使用 Chocolatey)

```powershell
choco install ffmpeg
```

#### Ubuntu/Debian

```bash
sudo apt update
sudo apt install ffmpeg
```

### 2. ASR 语音识别

项目使用 `sherpa-onnx-node` 在本地进行语音识别。默认引擎为 SenseVoice Small，应用会在启动或首次处理任务时自动下载模型到 `apps/desktop/models/asr/`。

可选的 Fun-ASR-Nano 模型需手动准备，详见 [`../apps/desktop/models/asr/README.md`](../apps/desktop/models/asr/README.md)。

### 3. 安装 yt-dlp（在线视频下载，可选）

仅在使用「在线视频链接」功能时需要。本地文件翻译可不安装。

#### macOS

```bash
brew install yt-dlp
```

#### 其他平台

```bash
pip install -U yt-dlp
# 或从 https://github.com/yt-dlp/yt-dlp/releases 下载二进制并加入 PATH
```

### 4. 安装 Ollama

#### macOS

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

#### Windows

下载并安装：https://ollama.ai/download/windows

#### Linux

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

## 模型下载

### ASR 模型

- `sensevoice`（默认）：支持中、英、日、韩和粤语，缺失时自动下载。
- `funasr-nano`：更适合方言、远场和嘈杂场景，需手动下载。

### Ollama 模型

```bash
# 下载 Llama 3 模型 (推荐)
ollama pull qwen3:4b-instruct

# 下载其他模型
ollama pull qwen2        # 阿里通义千问
ollama pull gemma2       # Google Gemma 2
```

## 使用指南

### 1. 启动应用

```bash
cd video-translate
pnpm install
pnpm dev
```

### 2. 基本工作流程

1. **上传视频**

   - 点击"上传视频"标签页
   - 拖拽视频文件到上传区域，或点击"选择文件"
   - 支持格式：MP4, AVI, MOV, MKV, WebM, WMV, FLV

2. **监控进度**

   - 切换到"任务列表"查看处理进度
   - 任务状态：提取音频 → 语音识别 → 翻译 → 生成字幕

3. **设置配置**

   - 在"设置"页面可以配置：
     - ASR 引擎选择
     - 源语言和目标语言
     - Ollama 翻译模型

## 故障排除

### ASR 相关问题

**问题**: 提示 SenseVoice 模型不可用

1. 检查网络连接和 `apps/desktop/models/asr/` 目录写入权限。
2. 重启应用，触发默认模型自动准备。
3. 查看任务日志中的模型下载或解压错误。

### FFmpeg 相关问题

**问题**: 音频提取失败
**解决**:

1. 确认 FFmpeg 已正确安装：`ffmpeg -version`
2. 检查视频文件格式是否支持
3. 确保有足够的磁盘空间

### Ollama 相关问题

**问题**: 翻译服务不可用
**解决**:

1. 确认 Ollama 服务运行：`ollama list`
2. 下载所需模型：`ollama pull qwen3:4b-instruct`
3. 检查 Ollama 服务端口（默认 11434）

## 技术说明

### ASR 技术说明

语音识别通过 `sherpa-onnx-node` 集成，模型在本地运行，无需 Python 环境或独立 ASR 服务。

### 性能优化建议

1. **模型选择**:

   - 常规中英日韩粤字幕：使用 `sensevoice`
   - 方言、远场或嘈杂场景：使用 `funasr-nano`

2. **硬件要求**:

   - CPU: 至少 4 核心
   - 内存: 8GB+
   - 存储: SSD 推荐

3. **批处理优化**:
   - 音频会自动分段处理
   - 支持并行处理多个音频段

## 更新日志

### v0.1.0

- 集成 sherpa-onnx-node 本地 ASR
- 支持 SenseVoice 模型自动下载和管理
- 优化转录性能和错误处理
