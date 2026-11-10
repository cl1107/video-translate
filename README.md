# 视频翻译助手

基于 **Longbridge Native Shell（NSH）+ sherpa-onnx** 的本地字幕与文稿工具。桌面应用在 `apps/nsh`，官网在 `apps/landing`；`apps/desktop` 是保留作对照的旧 Electron 实现。

[产品官网](https://cl1107.github.io/video-translate/) · [安装指南](docs/installation.md) · [NSH 开发说明](apps/nsh/README.md)

![源码版本](https://img.shields.io/badge/NSH_source-0.9.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

当前 NSH 分发目标为 **macOS Apple Silicon**。Windows / Linux 的原生后端尚未在本项目验收。GitHub Releases 的 **v0.8.2 是历史 Electron 安装包**，不包含当前 NSH 重构；尚未发布 NSH 安装包时，请从源码构建。

## 功能

- 本地音视频、SRT / VTT 与 yt-dlp 在线链接导入；平台字幕优先，否则本地识别。
- 字幕工作流支持仅提取原文，或通过 OpenAI 兼容模型服务润色、翻译，导出原文 / 译文 / 双语 SRT 与 ASS，可选硬字幕烧录。
- 文稿工作流将转录整理为 Markdown，并附转录时间来源索引。
- 校对工作台支持媒体播放、原文 / 译文编辑、起止时间调整、问题检查、单段重译与重新导出。
- 完整转录可复用为字幕、文稿，或按当前设置更换目标语言，无需再次识别。
- 阶段检查点与成功识别块保存在本机；暂停或中断后，恢复会复用仍匹配的结果。
- 模型服务、语言、术语库、字幕颜色、输出位置和下载代理可在设置中调整。

媒体处理和 ASR 在本机执行。使用远程模型 Endpoint 时，仅发送文本及必要提示词；在线下载与模型下载会访问相应站点。

## 从源码运行（macOS arm64）

需要 Rust / Cargo、Xcode Command Line Tools，以及 **NSH 0.4.0**。截至 2026-11-10，[官方最新稳定版](https://github.com/longbridge/nsh/releases/tag/v0.4.0) 为 `0.4.0 (e626a8d)`；nightly 不作为本项目分发基线。

```sh
xcode-select --install
# Rust 按 https://rustup.rs 安装
curl -fsSL https://nsh.dev/install.sh -o /tmp/install-nsh.sh
NSH_VERSION=v0.4.0 sh /tmp/install-nsh.sh
export PATH="$HOME/.local/bin:$PATH"

# FFmpeg 必需；yt-dlp 仅在线链接需要
brew install ffmpeg yt-dlp
# 硬字幕需要 libass/subtitles 滤镜，可按本机情况安装 ffmpeg-full

nsh --version
nsh run apps/nsh
```

启动后在设置里点「下载 SenseVoice」准备模型。真实识别通过应用内 sherpa-onnx 运行，不需要 Python 或单独的 sherpa CLI。模型也可通过 `VIDEO_TRANSLATE_ASR_MODELS` 指定目录。Fun-ASR-Nano 需单独准备模型。

仅提取原文无需模型服务。翻译、润色和文稿整理需填写 OpenAI 兼容 Base URL（通常含 `/v1`）、模型 ID，以及该服务要求的 API Key；本机 Ollama / LM Studio / vLLM 与在线 Endpoint 均按其实际配置填写。

## 构建与安装

Node.js 22.13+、仓库固定的 pnpm 11.17.0 用于官网和快捷脚本。安装 workspace 时可用 `--ignore-scripts`，避免执行旧 Electron 包的 postinstall。

```sh
pnpm install --ignore-scripts
nsh check apps/nsh
nsh test apps/nsh
pnpm build:desktop
# macOS .app: apps/nsh/.nsh/out/视频翻译助手.app
open "apps/nsh/.nsh/out/视频翻译助手.app"

pnpm install:local --open
# 默认安装至 ~/Applications；用 --dest /Applications 更改
pnpm make:release
# 本地 zip + SHA256SUMS: apps/nsh/.nsh/release/v0.9.0/
```

`pnpm release` / `pnpm make:release` **只生成本地 NSH 分发文件**，不会提交、打 tag、推送或发布。应用为 ad hoc 签名，未做 Apple 公证；FFmpeg / FFprobe、yt-dlp 与 ASR 模型不打进当前应用包。

默认 Release workflow 只构建 NSH macOS arm64。真正发布前需同步 `apps/nsh/nsh.json` 与 `apps/nsh/Cargo.toml` 版本、使用匹配 tag，并在干净机器验收安装、依赖检测和真实转录。历史 Electron 发布入口保留为 `release:electron` / `make:release:electron`，workflow 仅允许显式手动运行。

## 数据与迁移

NSH 使用独立目录 `~/Library/Application Support/video-translate-nsh/`，保存 SQLite 任务、设置、模型与检查点；可用 `VIDEO_TRANSLATE_DATA_DIR` 覆盖。字幕默认导出至素材旁 `output/`，也可改为源文件目录；文稿写入 `output/`。

**当前没有旧 Electron 数据库和设置的自动迁移。** 原有数据保持原位，不要把旧数据库直接覆盖到 NSH 目录。可导入旧版导出的 SRT / VTT 后继续校对，重新填写模型服务配置；备份旧数据后再决定是否卸载旧应用。

## 开发

```sh
pnpm dev:desktop                  # nsh run apps/nsh
pnpm start:desktop                # 同上，运行源码
pnpm dev:landing
pnpm build:landing
pnpm lint
pnpm test                       # NSH 与当前仓库配置测试
pnpm test:electron              # 仅回归废弃 Electron 实现
```

桌面领域逻辑位于 `apps/nsh/src/domain`，界面位于 `apps/nsh/src/pages`，应用样式控件位于 `apps/nsh/src/ui`。CLI `vt` 与桌面共享领域逻辑：

```sh
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- check
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- import-srt talk.srt
```

开发模拟开关 `VIDEO_TRANSLATE_MOCK_ASR=1` / `VIDEO_TRANSLATE_MOCK_LLM=1` 仅用于测试；模拟结果不能作为真实识别或翻译验收。

### 从 Electron 导入历史任务

退出 NSH 应用后执行（源库只读，不导入密钥或旧检查点）：

```sh
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- import-legacy "$HOME/Library/Application Support/video-translate/video-translate.db"
```

重复导入会跳过相同任务；冲突或格式错误会明确停止。设置与模型服务凭证仍需在 NSH 中重新配置。请勿将旧数据库直接覆盖到新目录。
