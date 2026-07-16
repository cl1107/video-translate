## 下载说明：bundled-ffmpeg 与 slim

每个平台会发布 **两种** 安装包，文件名中带对应标记：

| 类型 | 文件名标记 | 说明 | 何时选用 |
| --- | --- | --- | --- |
| **bundled-ffmpeg** | `-bundled-ffmpeg.` | 安装包**内置** FFmpeg / FFprobe（含硬字幕所需 libass） | **推荐大多数用户**。不想单独装 FFmpeg，或希望开箱即用 |
| **slim** | `-slim.` | **不内置** FFmpeg，运行时使用系统 PATH（及 macOS 上常见 Homebrew 路径）中的 `ffmpeg` / `ffprobe` | 本机已装完整 FFmpeg，或希望安装包更小 |

示例（版本号随 release 变化）：

- `video-translate-vX.Y.Z-mac-arm64-bundled-ffmpeg.dmg`
- `video-translate-vX.Y.Z-mac-arm64-slim.dmg`
- `video-translate-vX.Y.Z-win-x64-bundled-ffmpeg.exe`（或 zip / portable）
- `video-translate-vX.Y.Z-linux-x64-bundled-ffmpeg.AppImage`（另有 deb 等格式）

> **slim 包**仍需自行安装 FFmpeg；硬字幕烧录需要带 `subtitles` 滤镜（libass）的完整构建。  
> **Ollama**（翻译必需）、**yt-dlp**（仅在线链接）仍按应用内依赖检查提示安装，与 bundled / slim 无关。可选 BYOK 仅用于识别润色，不能替代 Ollama 翻译。

更完整的安装与使用说明见产品文档：  
https://cl1107.github.io/video-translate/docs

## 非签名构建注意事项

本仓库 GitHub Actions 产物均为 **未代码签名** 构建（`UNSIGNED_BUILD=1`），**未** 做 Apple 公证 / Windows Authenticode 签名，适合自用与内测。正式对外分发应使用开发者证书签名后再发布。

### macOS（Gatekeeper / 隔离属性）

从浏览器下载的 `.dmg` / `.zip` 会带 quarantine。若提示「已损坏」「无法打开」或无法验证开发者：

1. 将应用拖到「应用程序」或解压出 `.app`
2. 在终端对 `.app` 执行：

```bash
xattr -cr "/Applications/视频翻译助手.app"
# 路径按实际安装位置修改
```

3. 再从 Finder 打开。若仍失败可试：`sudo xattr -cr "/path/to/视频翻译助手.app"`

也可在「系统设置 → 隐私与安全性」中对拦截提示选择仍要打开（视系统版本而定）。

### Windows（SmartScreen）

未签名安装包 / 便携版可能被 SmartScreen 拦截（「Windows 已保护你的电脑」）：

1. 点击 **更多信息**
2. 再点 **仍要运行**

若被 Defender 隔离，可在安全中心还原后按上式打开。请仅从本仓库 [Releases](https://github.com/cl1107/video-translate/releases) 下载。

### Linux

- **AppImage**：下载后赋予执行权限再运行：

```bash
chmod +x video-translate-vX.Y.Z-linux-x64-*.AppImage
./video-translate-vX.Y.Z-linux-x64-*.AppImage
```

- **deb / rpm / pacman**：包本身未做发行版仓库签名；请用发行版包管理器本地安装，并确认校验和与下方 `SHA256SUMS.txt` 一致。
- 桌面环境若提示「未知来源」或无法执行，检查可执行位与 FUSE（部分旧环境运行 AppImage 需要）。

### 校验下载

每个 Release 附带 `SHA256SUMS.txt`，下载后请校验文件完整性。
