#!/usr/bin/env bash
# 构建并安装 NSH 桌面应用；不会关闭正在运行的实例或删除应用数据。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${REPO_ROOT}/apps/nsh"
DEST_DIR="${HOME}/Applications"
SKIP_BUILD=false
AUTO_OPEN=false
SIGN_IDENTITY="-"

usage() {
  cat <<'HELP'
用法: pnpm install:local [选项]
构建 NSH macOS 应用并安装到 ~/Applications。FFmpeg 需自行安装。
  --skip-build       安装 apps/nsh/.nsh/out 中已有的应用
  --dest <目录>      安装目录（默认 ~/Applications）
  --identity <证书>  重签名使用指定证书（默认 ad hoc）
  --ad-hoc           使用 ad hoc 签名
  --open             安装后启动
  --help             查看帮助
旧版 Electron 的 bundled/slim 参数不适用于 NSH。
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build|-s) SKIP_BUILD=true; shift ;;
    --open|-o) AUTO_OPEN=true; shift ;;
    --ad-hoc) SIGN_IDENTITY="-"; shift ;;
    --dest|-d|--identity|-i)
      [[ -n "${2:-}" ]] || { echo "$1 需要参数" >&2; exit 1; }
      if [[ "$1" == --dest || "$1" == -d ]]; then DEST_DIR="$2"; else SIGN_IDENTITY="$2"; fi
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "不支持的参数: $1" >&2; usage >&2; exit 1 ;;
  esac
done
[[ "$(uname -s)" == Darwin ]] || { echo "本脚本只安装 macOS 应用。" >&2; exit 1; }
cd "${REPO_ROOT}"
if [[ "$SKIP_BUILD" == false ]]; then
  pnpm build:desktop
fi
SOURCE_APP="${APP_DIR}/.nsh/out/视频翻译助手.app"
[[ -d "$SOURCE_APP" ]] || { echo "未找到 NSH 应用: $SOURCE_APP；请先执行 pnpm build:desktop。" >&2; exit 1; }
TARGET_APP="${DEST_DIR}/视频翻译助手.app"
if pgrep -f "${TARGET_APP}/Contents/MacOS/" >/dev/null; then
  echo "目标应用仍在运行，请退出后重新安装: $TARGET_APP" >&2
  exit 1
fi
mkdir -p "$DEST_DIR"
STAGING_DIR="$(mktemp -d "${DEST_DIR}/.video-translate-install.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT
ditto "$SOURCE_APP" "${STAGING_DIR}/视频翻译助手.app"
codesign --force --deep --sign "$SIGN_IDENTITY" "${STAGING_DIR}/视频翻译助手.app"
codesign --verify --deep --strict "${STAGING_DIR}/视频翻译助手.app"
if [[ -e "$TARGET_APP" ]]; then
  BACKUP_PATH="${TARGET_APP}.backup-$(date +%Y%m%d-%H%M%S)"
  [[ ! -e "$BACKUP_PATH" ]] || { echo "备份路径已存在: $BACKUP_PATH" >&2; exit 1; }
  mv "$TARGET_APP" "$BACKUP_PATH"
  echo "旧应用已保留: $BACKUP_PATH"
fi
mv "${STAGING_DIR}/视频翻译助手.app" "$TARGET_APP"
echo "NSH 应用已安装: $TARGET_APP"
if [[ "$AUTO_OPEN" == true ]]; then open "$TARGET_APP"; fi
