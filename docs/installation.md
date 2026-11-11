# 安装与使用（NSH）

当前桌面源码是 `apps/nsh`，分发验收目标为 macOS Apple Silicon。GitHub Releases v0.8.2 属于旧 Electron 实现；未发布 NSH 安装包前，使用以下源码构建路径。Windows / Linux 的 NSH 应用尚未验收。

## 准备

需要 Xcode Command Line Tools、Rust / Cargo 与 NSH 0.5.0。最新稳定版请以 [官方 Release](https://github.com/longbridge/nsh/releases) 为准，本项目固定验证 `0.5.0 (f4d68f7)`。

```sh
xcode-select --install
# Rust 安装说明：https://rustup.rs
curl -fsSL https://nsh.dev/install.sh -o /tmp/install-nsh.sh
NSH_VERSION=v0.5.0 sh /tmp/install-nsh.sh
export PATH="$HOME/.local/bin:$PATH"
nsh --version
brew install ffmpeg
# 仅在线链接导入需要
brew install yt-dlp
```

硬字幕烧录需要 FFmpeg 的 `subtitles` 滤镜（libass）。若当前 FFmpeg 没有该滤镜，请安装完整构建（例如 Homebrew `ffmpeg-full`）。

## 运行、打包与安装

在仓库根目录运行：

```sh
nsh run apps/nsh
nsh check apps/nsh
nsh test apps/nsh
nsh package apps/nsh --target macos --out apps/nsh/.nsh/out
open "apps/nsh/.nsh/out/视频翻译助手.app"
```

也可使用 pnpm 快捷脚本，需要 Node.js 22.13+ 与 pnpm 11.17.0：

```sh
pnpm install --ignore-scripts
pnpm build:desktop
pnpm install:local --open
# 指定安装目录：pnpm install:local --dest /Applications
pnpm make:release
```

安装默认写入 `~/Applications/视频翻译助手.app`。目标应用仍在运行时脚本会停止，先手动退出再安装；已有应用会改名保留备份，不删除应用数据。`--skip-build` 可安装已有的 `.app`。

分发压缩包位于 `apps/nsh/.nsh/release/v<版本>/video-translate-v<版本>-mac-arm64-nsh.zip`，同目录有 `SHA256SUMS.txt`。本地分发脚本不推送、不创建 GitHub Release。应用为 ad hoc 签名、未公证，且不包含 FFmpeg / yt-dlp 或 ASR 模型。

从可信来源下载后先核对校验和；若被 Gatekeeper 拦截，在系统设置的隐私与安全性中允许打开。需要移除隔离属性时，仅对已核实的应用执行：

```sh
xattr -dr com.apple.quarantine "$HOME/Applications/视频翻译助手.app"
```

## 模型与设置

在「设置」中运行系统自检，点「下载 SenseVoice」下载并解压模型。模型在本机运行，不需要 Python 或独立 sherpa CLI。默认模型目录为 `~/Library/Application Support/video-translate-nsh/models/asr/`；`VIDEO_TRANSLATE_ASR_MODELS` 可指定其他根目录。Fun-ASR-Nano 需手动准备完整模型目录。

仅提取原文字幕时不需要模型服务。字幕翻译、润色和 Markdown 文稿整理使用 OpenAI 兼容 Endpoint；填写服务提供的 Base URL、模型 ID，以及该服务要求的 API Key。使用本地 Ollama 时通常为 `http://localhost:11434/v1`，模型需提前在 Ollama 中准备。

## 第一条任务

1. 选择「字幕」，导入本地音视频；也可导入 SRT / VTT，或粘贴 yt-dlp 支持的在线链接。
2. 先用「仅提取原文」验证本地识别，无需配置翻译凭证。在线链接有匹配平台字幕时优先采用。
3. 任务完成后打开校对工作台，关联或播放媒体，调整文字与时间，再保存并重新导出。
4. 完整转录可复用到「文稿」或新的字幕任务；新的语言和模型使用当前设置，保留原任务。
5. 暂停后等待任务进入暂停状态，再恢复；应用重启后可恢复中断任务。检查点只复用与输入、参数仍匹配的阶段。

字幕与文稿产物默认位于素材旁的 `output/`。字幕可在设置中改为源文件同目录。

## 旧版数据

NSH 数据保存在 `~/Library/Application Support/video-translate-nsh/`，可用 `VIDEO_TRANSLATE_DATA_DIR` 覆盖。它与旧 Electron 数据目录独立，**目前没有自动迁移旧任务、设置和凭证**。保留旧目录和导出文件；可将旧 SRT / VTT 导入 NSH，模型服务需重新配置。不要直接覆盖 SQLite 文件。

## 排查

- 找不到 FFmpeg：执行 `ffmpeg -version` / `ffprobe -version`，安装后在设置重新检查。硬字幕还需 `subtitles` 滤镜。
- 模型不可用：检查模型根目录和文件完整性，重新点「下载 SenseVoice」，查看界面错误信息；重启不会自动修复缺失模型。
- 翻译失败：核对 Endpoint、模型 ID、API Key 和服务连通性。仅提取原文不受模型服务故障影响。
- 在线下载失败：执行 `yt-dlp --version`，检查链接、站点限制、网络与设置里的代理 / 浏览器 Cookie 选项。

### 从 Electron 导入历史任务

退出 NSH 应用后执行（源库只读，不导入密钥或旧检查点）：

```sh
cargo run --manifest-path apps/nsh/Cargo.toml --bin vt -- import-legacy "$HOME/Library/Application Support/video-translate/video-translate.db"
```

重复导入会跳过相同任务；冲突或格式错误会明确停止。设置与模型服务凭证仍需在 NSH 中重新配置。请勿将旧数据库直接覆盖到新目录。
