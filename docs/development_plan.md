# 基于 Ollama + Electron 的视频翻译软件开发方案

## 1. 项目目标

1. 本地端全离线：无需外网即可完成视频语音识别 → 翻译 → 字幕合成 → 输出字幕 / 嵌入字幕视频。
2. 友好的跨平台桌面 GUI（macOS / Windows / Linux）。
3. 支持批量处理与断点续传，保证长视频稳定性。
4. 支持模型热插拔（可替换 ASR / 翻译 LLM / 文本后处理模块）。

---

## 2. 技术选型

| 模块           | 主要技术                | 说明                                                     |
| -------------- | ----------------------- | -------------------------------------------------------- |
| 桌面应用壳     | Electron 37.2.3         | 使用 Node 主进程 + Chromium 渲染进程；支持 auto-update。 |
| UI 框架        | React + unocss +antd v5 | 快速构建现代化界面，支持暗黑模式。                       |
| 本地大模型管理 | **Ollama**              | 统一拉取 / 管理 LLM，提供 REST & CLI 两种调用方式。      |
| 语音识别       | Whisper (large-v3)      | 可通过 GGML / Whisper.cpp 加速，CPU/GPU 皆可。           |
| 翻译模型       | seed-x-instruct 等      | 依据效果与运行资源动态切换。                             |
| 媒体处理       | ffmpeg                  | 提取音轨、合成字幕、烧录硬字幕。                         |
| 数据存储       | SQLite (better-sqlite3) | 记录任务、缓存中间结果、断点续传。                       |

> ⚙️ 建议在 `package.json` 中为 Heavy 依赖（`ffmpeg-static`, `whisper.cpp` bindings 等）使用可选安装，减小安装包大小。

---

## 3. 系统架构

```
┌──────────────────────┐
│      Renderer        │  React UI
└──────────────────────┘
           │ IPC
┌──────────────────────┐
│      Main Process    │  Electron 主进程
│  • 创建窗口          │
│  • 管理任务队列      │
│  • 与后台服务通讯    │
└──────────────────────┘
           │ gRPC / REST
┌──────────────────────┐
│  Local AI Services   │  (可独立进程)
│  • Whisper Service   │  (Rust/C++)
│  • Translation LLM   │  (Ollama)
└──────────────────────┘
           │
┌──────────────────────┐
│     System Tools     │  ffmpeg 等
└──────────────────────┘
```

### 3.1 关键流程

1. 选择视频 → `ffmpeg` 提取音轨 (wav)。
2. 音轨根据静音区间切片（≤30s），存储到临时目录。
3. Whisper Service 并行识别片段 → 得到 **`segments.json`** (起止时间 + 原文)。
4. 调用 Ollama 翻译：
   ```bash
   curl localhost:11434/api/generate -d '{"model":"llama3-8b","prompt":"<翻译指令>"}'
   ```
5. 合并翻译结果 → 生成 `subtitles.srt` / `vtt`。
6. 可选：`ffmpeg` 烧录硬字幕，或仅导出文本字幕。
7. 更新任务进度到 SQLite，渲染进度条。

---

## 4. **Ollama 调用模式选择：Daemon vs CLI**

| 维度     | Daemon (默认)                      | CLI (`ollama run …`)            |
| -------- | ---------------------------------- | ------------------------------- |
| 调用方式 | HTTP REST (本地 `127.0.0.1:11434`) | 子进程 + 标准输入输出           |
| 启动成本 | 长驻后台，首帧响应快               | 每次调用需拉起进程，延迟高      |
| 并发能力 | 内建会话管理，可复用上下文         | 实际上串行 (除非自行并发多进程) |
| 资源占用 | 常驻内存 (模型常驻 GPU/CPU 内存)   | 调用后释放，但加载成本高        |
| 适用场景 | **翻译服务高频调用**               | 低频/一次性实验                 |

> **推荐：** 在主进程启动时检测 Ollama Daemon 是否存在；若未运行则以 `child_process.spawn("ollama", ["serve"], {detached:true})` 启动守护进程，并通过 REST API 调用。CLI 仅作为 fallback/debug 工具。

---

## 5. 开发里程碑

1. **环境脚手架**：Electron + React + Tailwind + TS + `electron-builder` 打包。
2. **音视频处理**：封装 `ffmpeg` Node API，完成音轨提取与静音切片。
3. **Whisper 服务**：集成 `whisper.cpp` binding，提供 gRPC/REST 服务；基准测试。
4. **Ollama 翻译接口**：封装 REST Client，支持多条流并发、缓存。
5. **字幕合成器**：实现 SRT 生成、时间轴对齐、文本后处理（Punctuation、Merge）。
6. **任务管理器**：SQLite schema + 断点续传；前端任务卡片展示。
7. **UI/UX**：拖拽导入、进度条、错误回滚、设置页（选择模型、显存限制等）。
8. **性能优化**：管道并行、GPU / CPU 亲和性调优、内存回收。
9. **打包与分发**：免安装 ffmpeg/whisper 数据、增量更新。
10. **多语言本地化 & 插件系统**：允许社区贡献后处理脚本。

---

## 6. 关键代码示例（伪代码）

```ts
// src/main/llm/ollama.ts
import fetch from 'node-fetch';

export async function translate(text: string, targetLang = 'zh') {
  const prompt = `Translate the following to ${targetLang}:\n\n${text}`;
  const res = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'llama3', prompt }),
  });
  const chunks = [];
  for await (const chunk of res.body as any) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
```

```ts
// src/main/asr/whisper.ts
import { spawn } from 'child_process';

export function transcribeSegment(
  wavPath: string
): Promise<{ start: number; end: number; text: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('./bin/whisper', [
      '-m',
      'models/ggml-large.bin',
      '-f',
      wavPath,
      '-otxt',
    ]);
    let output = '';
    p.stdout.on('data', (d) => (output += d));
    p.on('close', (code) => {
      if (code === 0)
        parseWhisper(output)
          ? resolve(parseWhisper(output))
          : reject(new Error('fail'));
    });
  });
}
```

---

## 7. 安全与合规

1. 所有临时文件写入用户家目录 `~/Library/Application Support/VideoTranslate/tmp`。
2. 提供「彻底删除缓存」功能，保护隐私。
3. 渲染进程禁用远程内容；启用 `contextIsolation`、`sandbox`。
4. 签名与代码完整性校验，确保更新渠道安全。

---

## 8. 未来迭代方向

- 在线字典 / 术语记忆库，提高专业领域翻译一致性。
- 自动换行 & 字幕长度控制，多语种排版算法。
- 结合 GPU 编解码 (`hwaccel`) 加速视频烘焙。
- 插件化后处理：敏感词审查、语气风格转换等。

---

> **至此，一份可执行的开发蓝图已完成，可根据里程碑逐步实现并迭代。**
