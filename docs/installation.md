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

### 2. 安装 Whisper

#### 方法一：使用 pip 安装 OpenAI Whisper

```bash
pip install openai-whisper
```

#### 方法二：使用 whisper.cpp (推荐，性能更好)

```bash
# macOS
brew install whisper-cpp

# 或从源码编译
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
make
```

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

首次使用时，Whisper 会自动下载所需模型。也可以手动下载：

```bash
# 下载基础模型 (推荐)
whisper --model base --download_only

# 下载大型模型 (更高准确率)
whisper --model large-v3 --download_only
```

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

3. **配置设置**
   - 点击"设置"标签页
   - 选择 Whisper 模型（推荐 base 或 small）
   - 选择 Ollama 翻译模型
   - 设置源语言和目标语言
   - 选择输出格式（SRT/VTT/TXT）

### 3. 高级功能

#### 任务管理

- **暂停/恢复**: 长时间任务可以暂停后恢复
- **重试**: 失败的任务可以重新处理
- **删除**: 清理不需要的任务

#### 字幕输出

- **SRT**: 标准字幕格式，兼容性最好
- **VTT**: Web 字幕格式，支持样式
- **TXT**: 纯文本格式
- **硬字幕**: 可选择烧录到视频文件中

## 性能优化建议

### 1. 硬件配置

- **CPU**: 多核处理器，推荐 8 核以上
- **内存**: 16GB 以上，大模型需要更多内存
- **GPU**: 支持 CUDA 的显卡可加速 Whisper 处理

### 2. 模型选择

- **Whisper tiny**: 最快，适合实时处理
- **Whisper base**: 平衡速度和准确率（推荐）
- **Whisper large-v3**: 最高准确率，但速度较慢

### 3. 批处理

- 同时处理多个文件时，建议逐个添加
- 长视频会自动分段处理，提高稳定性

## 故障排除

### 常见问题

#### 1. "Whisper 不可用"

- 确认已安装 Whisper: `whisper --help`
- 检查 PATH 环境变量
- 尝试重新安装 Whisper

#### 2. "Ollama 连接失败"

- 启动 Ollama 服务: `ollama serve`
- 检查端口 11434 是否被占用
- 确认已下载所需模型: `ollama list`

#### 3. "FFmpeg 不可用"

- 确认已安装 FFmpeg: `ffmpeg -version`
- 检查 PATH 环境变量
- 重新安装 FFmpeg

#### 4. 处理速度慢

- 选择较小的 Whisper 模型
- 关闭其他占用 CPU/内存的程序
- 确保有足够的硬盘空间

### 日志查看

- 打开开发者工具 (Ctrl/Cmd + Shift + I)
- 查看 Console 标签页的错误信息
- 检查 Network 标签页的网络请求

## 更新说明

### v0.1.0 (当前版本)

- ✅ 基础视频翻译功能
- ✅ Whisper 语音识别集成
- ✅ Ollama 本地翻译
- ✅ 多格式字幕输出
- ✅ 任务管理和断点续传
- ✅ 现代化用户界面

### 未来计划

- 🔄 GPU 加速支持
- 🔄 批量处理优化
- 🔄 自定义翻译模板
- 🔄 字幕编辑器
- 🔄 云端模型支持

## 技术支持

如遇到问题，请提供以下信息：

- 操作系统版本
- Node.js 版本 (`node --version`)
- 错误日志截图
- 视频文件格式和大小

---

**享受本地化、私密的视频翻译体验！** 🎉
