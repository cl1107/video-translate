# 视频翻译助手（NSH）

桌面端已迁移到 [Longbridge Native Shell](https://nsh.dev)。默认开发/运行路径是本目录，**不再依赖 Electron**。

当前 CLI：`nsh 0.4.0 (e626a8d)`（以本机 `nsh --version` 为准）。

## 命令

在仓库根目录：

```sh
nsh check apps/nsh     # cargo check + TS 测试类型
nsh test apps/nsh      # 领域测试、无头 UI、App.test.tsx
nsh run apps/nsh       # 本机 AppKit 窗口（macOS）
cargo run --manifest-path apps/nsh/Cargo.toml
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- check
```

打包：

```sh
nsh package apps/nsh --target macos    # 产出 .nsh/out/ 下的 .app
```

## 工作流

- **字幕**：导入本地视频 / SRT / VTT / 在线链接（yt-dlp）。平台字幕优先；否则 FFmpeg 抽音 + ASR。
- **仅提取原文**：不调用模型服务，导出原文 SRT。
- **翻译字幕**：OpenAI 兼容 Endpoint；可开模拟翻译。
- **文稿**：转录后整理为 Markdown。
- **校对工作台**：改原文/译文后重新导出。
- **设置**：Endpoint、模型、术语库、颜色、代理、系统自检、SenseVoice 下载。

数据目录：`~/Library/Application Support/video-translate-nsh/`（可用 `VIDEO_TRANSLATE_DATA_DIR` 覆盖）。

## ASR

真实识别默认：

1. SenseVoice 模型（设置里「下载 SenseVoice」，或 `VIDEO_TRANSLATE_ASR_MODELS`）
2. 本机 `sherpa-onnx-offline`（或 `sherpa-onnx-offline-sense-voice` / `sherpa-onnx`）

Fun-ASR-Nano 是可选引擎：模型不在时会明确报错，不会假装已识别。长音频按块落盘，恢复时跳过已成功 ASR 块。

开发与测试可开设置中的「模拟识别」，或：

```sh
export VIDEO_TRANSLATE_MOCK_ASR=1
export VIDEO_TRANSLATE_MOCK_LLM=1
```

## CLI `vt`

```sh
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- check
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- import-srt talk.srt
```
