#!/usr/bin/env bash
# 仅生成本地 NSH macOS arm64 分发产物，不创建 tag、不推送、不发布。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo "当前分发脚本仅支持已验收的 macOS arm64。" >&2; exit 1;
}
VERSION="$(node -p "require('./apps/nsh/nsh.json').version")"
CARGO_VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' apps/nsh/Cargo.toml | head -n 1)"
[[ "$VERSION" == "$CARGO_VERSION" ]] || { echo "nsh.json 与 Cargo.toml 版本不一致。" >&2; exit 1; }
pnpm build:desktop
APP_PATH="apps/nsh/.nsh/out/视频翻译助手.app"
codesign --verify --deep --strict "$APP_PATH"
RELEASE_DIR="apps/nsh/.nsh/release/v${VERSION}"
mkdir -p "$RELEASE_DIR"
ARCHIVE_NAME="video-translate-v${VERSION}-mac-arm64-nsh.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$RELEASE_DIR/$ARCHIVE_NAME"
(cd "$RELEASE_DIR" && shasum -a 256 "$ARCHIVE_NAME" > SHA256SUMS.txt)
echo "本地产物: ${REPO_ROOT}/${RELEASE_DIR}/${ARCHIVE_NAME}"
