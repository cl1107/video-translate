## 下载说明

当前分发为 **NSH 原生 macOS arm64 应用**，文件名带 `-mac-arm64-nsh.zip`。解压后将「视频翻译助手.app」放入 Applications；FFmpeg / FFprobe 需单独安装，硬字幕需要含 libass 的完整构建。SenseVoice 模型在设置中下载，翻译与文稿整理另需配置模型服务。

> 应用采用 ad hoc 签名，未经 Apple 公证。下载后请用 `SHA256SUMS.txt` 校验；若被 Gatekeeper 拦截，先核对来源，再在系统设置中允许打开，必要时对已核实的 `.app` 执行 `xattr -dr com.apple.quarantine`。

历史 v0.8.2 的 `bundled-ffmpeg` / `slim` 包属于 Electron 实现。Windows / Linux 的 NSH 安装包尚未验收。

安装与使用说明：
https://cl1107.github.io/video-translate/docs
