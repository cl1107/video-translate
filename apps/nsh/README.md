# 视频翻译助手（NSH）

桌面端已迁移到 [Longbridge Native Shell](https://nsh.dev)。默认开发/运行路径是本目录，**不再依赖 Electron**。

截至 2026-11-10，[最新稳定版](https://github.com/longbridge/nsh/releases/tag/v0.4.0) 与本机验证版本均为 `nsh 0.4.0 (e626a8d)`。当前分发验收目标是 macOS arm64。

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
nsh package apps/nsh --target macos --out apps/nsh/.nsh/out
open "apps/nsh/.nsh/out/视频翻译助手.app"
pnpm install:local --open   # 默认 ~/Applications
pnpm make:release          # 仅本地生成 zip + checksum，不发布
```

## 工作流

- **字幕**：导入本地视频 / SRT / VTT / 在线链接（yt-dlp）。平台字幕优先；否则 FFmpeg 抽音 + ASR。
- **仅提取原文**：不调用模型服务，导出原文 SRT。
- **翻译字幕**：OpenAI 兼容 Endpoint；可开模拟翻译。
- **文稿**：转录后整理为 Markdown。
- **校对工作台**：改原文/译文后重新导出。
- **设置**：Endpoint、模型、术语库、颜色、代理、系统自检、SenseVoice 下载。

数据目录：`~/Library/Application Support/video-translate-nsh/`（可用 `VIDEO_TRANSLATE_DATA_DIR` 覆盖）。与 Electron 旧目录独立，目前无自动数据库 / 设置迁移；旧 SRT / VTT 可重新导入。

## ASR

真实识别默认：

1. SenseVoice 模型（设置里「下载 SenseVoice」，或 `VIDEO_TRANSLATE_ASR_MODELS`）
2. 应用内 sherpa-onnx Rust 绑定执行识别，无需 Python 或独立 sherpa CLI。

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

### 从 Electron 导入历史任务

退出 NSH 应用后执行（源库只读，不导入密钥或旧检查点）：

```sh
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- import-legacy "$HOME/Library/Application Support/video-translate/video-translate.db"
```

重复导入会跳过相同任务；冲突或格式错误会明确停止。设置与模型服务凭证仍需在 NSH 中重新配置。请勿将旧数据库直接覆盖到新目录。
