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

### 2. Whisper 语音识别

**本项目使用 whisper-node 包，无需单独安装 Whisper！**

项目已经包含了 `whisper-node` 依赖，它会自动：

- 包含预编译的 whisper.cpp 二进制文件
- 在需要时自动下载 Whisper 模型
- 提供 Node.js API 接口

**不需要执行以下操作：**

- ❌ 不需要 `pip install openai-whisper`
- ❌ 不需要 `brew install whisper-cpp`
- ❌ 不需要手动编译 whisper.cpp

### 3. 安装 Ollama

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

### Whisper 模型

**无需手动下载！** whisper-node 会在首次使用时自动下载所需的模型文件。

支持的模型：

- `tiny` (~39MB) - 最快，准确率较低
- `base` (~142MB) - 平衡速度和准确率（推荐）
- `small` (~466MB) - 准确率较好
- `medium` (~1.5GB) - 高准确率
- `large-v3` (~2.9GB) - 最高准确率

### Ollama 模型

```bash
# 下载 Llama 3 模型 (推荐)
ollama pull llama3

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
     - Whisper 模型选择（推荐使用 base 模型）
     - 源语言和目标语言
     - Ollama 翻译模型

## 故障排除

### Whisper 相关问题

**问题**: 提示"Whisper 不可用"
**解决**:

1. 确认 `whisper-node` 已安装：`npm list whisper-node`
2. 重新安装依赖：`pnpm install`
3. 检查 Node.js 版本是否 >= 18.0.0

**问题**: 模型下载失败
**解决**:

1. 检查网络连接
2. whisper-node 会自动重试下载
3. 首次使用某个模型时需要时间下载

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
2. 下载所需模型：`ollama pull llama3`
3. 检查 Ollama 服务端口（默认 11434）

## 技术说明

### whisper-node vs 系统 Whisper

本项目使用 `whisper-node` 而不是系统安装的 Whisper：

| 方面 | whisper-node     | 系统 Whisper         |
| ---- | ---------------- | -------------------- |
| 安装 | npm 包，自动安装 | 需要 Python/系统安装 |
| 模型 | 自动下载管理     | 需要手动下载         |
| 集成 | Node.js API      | 命令行调用           |
| 性能 | 优化的 C++ 绑定  | Python 实现          |
| 依赖 | 无外部依赖       | 需要 Python 环境     |

### 性能优化建议

1. **模型选择**:

   - 开发测试：使用 `tiny` 或 `base` 模型
   - 生产环境：使用 `small` 或 `medium` 模型

2. **硬件要求**:

   - CPU: 至少 4 核心
   - 内存: 8GB+ (large 模型需要 16GB+)
   - 存储: SSD 推荐

3. **批处理优化**:
   - 音频会自动分段处理
   - 支持并行处理多个音频段

## 更新日志

### v0.1.0

- 集成 whisper-node 替代系统 Whisper 命令
- 自动模型下载和管理
- 优化转录性能和错误处理
