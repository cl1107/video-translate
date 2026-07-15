# Domain glossary — video-translate

本文件记录领域术语，供架构与实现保持同一套说法。

## 核心概念

| 术语 | 含义 |
|------|------|
| **TranslationTask** | 一次视频翻译作业：绑定源视频、语言对、运行配置、阶段状态、段落与产物。 |
| **TaskRuntimeOptions** | 任务运行配置（ASR 引擎、翻译/润色模型、烧录模式与颜色等）。一等持久化字段；**不含** BYOK API Key。 |
| **TaskOutputArtifacts** | 任务产物路径（原文/译文/双语 SRT、ASS、烧录视频、输出目录）。一等持久化字段，**不**从日志解析。 |
| **VideoFile** | 源视频元数据（路径、时长、格式等）。 |
| **TranscriptionSegment** | 识别/显示粒度的字幕段。见「段文本语义」。 |
| **DisplaySegment** | 为阅读合并后的显示段，可一对多溯源 `sourceSegmentIds`。 |
| **TaskLog** | 操作日志，仅供人读；不是产物索引。 |
| **Translation Pipeline** | （可选平台字幕）或 音频提取 → ASR → 显示段 → 润色 → 翻译 → 字幕产物 → 可选烧录。接口：`run` + 协作式 `AbortSignal`。 |
| **Platform Subtitle** | yt-dlp 下载的平台人工/自动字幕轨；有可用轨时**优先于 ASR** 作为 `originalText` 源。 |
| **TextCompletionPort** | LLM 完成接缝；Ollama generate 与 OpenAI chat 为两个适配器。 |
| **AppSettings** | 用户默认设置；创建任务时映射为 `TaskRuntimeOptions`。 |
| **IPC 契约** | `shared/ipc.ts` 中的 channel 名与载荷形状。 |

## 段文本语义（钉死）

| 字段 / 策略 | 含义 |
|-------------|------|
| `originalText` | **源语文稿**（ASR 识别结果或平台字幕），不可变语义。 |
| `polishedText` | **润色后源语**，用于翻译输入与展示源。 |
| `translatedText` | **目标语译文**。 |
| 产物「原文」轨 | 始终用源语文稿（`getAsrSourceForArtifacts`），避免润色覆盖。 |
| 翻译输入 | `polishedText \|\| originalText`（`getTranslateInput`）。 |

## 任务状态

`pending` →（可选）`downloading` → `extracting_audio` → `transcribing` → `polishing` → `translating` → `generating_subtitles` → `completed`  
旁路：`burning_subtitles`、`paused`、`failed`、`cancelled`。

在线链接任务在 `downloading` 阶段用系统 **yt-dlp** 拉取最高画质 + 平台字幕到 `userData/downloads/<taskId>/`。  
**字幕优先级**：平台人工/自动字幕（匹配源语）→ 否则本地 ASR。

## 明确非目标（当前）

- 断点续跑（resume 会协作取消后**重跑**流水线，检查点未实现）。
- 将 BYOK API Key 写入任务行或日志。
