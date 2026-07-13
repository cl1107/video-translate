# 内置 FFmpeg

`pnpm run build` 默认会下载当前构建平台的 FFmpeg 与 FFprobe，并将其带入安装包。

- `pnpm run build:bundled`：构建带内置 FFmpeg 的离线安装包（默认）。
- `pnpm run build:slim`：构建不含 FFmpeg 的精简安装包，应用会回退到系统 PATH。

构建产物位于平台目录（如 `win32-x64`），由 `.gitignore` 排除；不要将二进制提交到仓库。
下载脚本会验证 `subtitles` 滤镜，确保内置版本包含硬字幕烧录需要的 libass 支持。

若交叉构建，请同时指定目标架构，例如 `FFMPEG_ARCH=arm64 pnpm run build:bundled`。
