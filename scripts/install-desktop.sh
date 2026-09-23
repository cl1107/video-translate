#!/usr/bin/env bash

# ==============================================================================
# 本地编译、签名并安装《视频翻译助手》至 /Applications
# 主要供本地开发、自用部署使用
# ==============================================================================

set -euo pipefail

# 终端色彩定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info() {
  echo -e "${CYAN}${BOLD}==>${RESET} ${BOLD}$1${RESET}"
}

success() {
  echo -e "${GREEN}${BOLD}✓${RESET} $1"
}

warn() {
  echo -e "${YELLOW}${BOLD}!${RESET} $1"
}

error() {
  echo -e "${RED}${BOLD}✗${RESET} $1" >&2
}

# 仅支持 macOS
if [[ "$(uname)" != "Darwin" ]]; then
  error "此脚本仅支持在 macOS 系统上运行。"
  exit 1
fi

# 定位仓库根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DESKTOP_DIR="${REPO_ROOT}/apps/desktop"

# 默认选项
DEST_DIR="/Applications"
SKIP_BUILD=false
BUNDLE_FFMPEG_VAL="0"
SIGN_IDENTITY=""
FORCE_ADHOC=false
AUTO_OPEN=false
CLEAN_BUILD=false

usage() {
  cat << EOF
使用方法: $(basename "$0") [选项]

将《视频翻译助手》本地编译、深度签名并安装至 /Applications（主要用于个人自用）。
默认采用 slim 轻量模式构建（不捆绑 FFmpeg 二进制，体积更小，依赖系统 PATH/Homebrew FFmpeg）。

选项:
  -o, --open              安装完成后自动启动应用
  -s, --skip-build        跳过编译步骤，直接使用已有产物进行签名和安装
  --slim                  不捆绑 FFmpeg 二进制（默认行为，轻量化）
  --bundled               捆绑内置 FFmpeg 二进制（方便完全离线或无系统 FFmpeg 时使用）
  -i, --identity <NAME>   显式指定用于代码签名的证书名称（默认自动检测本地可用证书）
  --ad-hoc                强制使用 Ad-hoc 自签名（无需任何 Apple 开发者证书）
  -d, --dest <PATH>       自定义安装目录（默认: /Applications）
  -c, --clean             构建前清理历史输出产物
  -h, --help              显示此帮助信息

示例:
  pnpm install:local              # 默认以 slim 模式一键编译、自动签名并安装到 /Applications
  pnpm install:local --open       # 编译、签名、安装后直接打开应用
  pnpm install:local --bundled    # 显式捆绑内置 FFmpeg 构建并安装
  pnpm install:local --skip-build # 仅重签并重新部署已有构建产物
  pnpm install:local --ad-hoc     # 强制使用 Ad-hoc 签名安装
EOF
  exit 0
}

# 参数解析
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--open)
      AUTO_OPEN=true
      shift
      ;;
    -s|--skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --slim)
      BUNDLE_FFMPEG_VAL="0"
      shift
      ;;
    --bundled)
      BUNDLE_FFMPEG_VAL="1"
      shift
      ;;
    -i|--identity)
      if [[ -z "${2:-}" ]]; then
        error "--identity 选项需要指定证书名称。"
        exit 1
      fi
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --ad-hoc)
      FORCE_ADHOC=true
      shift
      ;;
    -d|--dest)
      if [[ -z "${2:-}" ]]; then
        error "--dest 选项需要指定目标目录。"
        exit 1
      fi
      DEST_DIR="$2"
      shift 2
      ;;
    -c|--clean)
      CLEAN_BUILD=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      error "未知参数: $1"
      usage
      ;;
  esac
done

cd "${REPO_ROOT}"

# 读取版本和应用名称
VERSION="$(node -p "require('${DESKTOP_DIR}/package.json').version")"
DISPLAY_NAME="$(node -p "require('${DESKTOP_DIR}/package.json').displayName || '视频翻译助手'")"
APP_NAME="${DISPLAY_NAME}"
TARGET_APP_PATH="${DEST_DIR}/${APP_NAME}.app"

echo -e "${BLUE}${BOLD}======================================================${RESET}"
echo -e "${BOLD}  《${APP_NAME}》本地自用编译、签名与部署工具  ${RESET}"
echo -e "  目标版本: ${CYAN}v${VERSION}${RESET}"
echo -e "  安装目标: ${CYAN}${TARGET_APP_PATH}${RESET}"
echo -e "${BLUE}${BOLD}======================================================${RESET}\n"

# 1. 编译
if [ "${SKIP_BUILD}" = false ]; then
  if [ "${CLEAN_BUILD}" = true ]; then
    info "[1/4] 清理历史构建产物..."
    rm -rf "${DESKTOP_DIR}/dist/v${VERSION}"
    success "历史产物清理完成"
  fi

  info "[1/4] 开始编译桌面应用 (unpacked 模式)..."

  # 1.1 准备应用与构建文件
  info "  -> 执行 prebuild (清理开发缓存、编译主进程/预加载/渲染进程)..."
  pnpm --filter video-translate run prebuild

  # 1.2 若包含 bundled ffmpeg，确保依赖已就位
  if [ "${BUNDLE_FFMPEG_VAL}" = "1" ]; then
    info "  -> 校验并准备 Bundled FFmpeg 资源..."
    pnpm --filter video-translate run prepare:ffmpeg
  fi

  # 1.3 重建原生依赖（better-sqlite3 等）
  info "  -> 重新编译原生模块 (electron-rebuild)..."
  pnpm --filter video-translate run rebuild:native

  # 1.4 通过 electron-builder 快速输出 .app 目录
  info "  -> 执行 electron-builder 生成 macOS 应用目录..."
  BUNDLE_FFMPEG="${BUNDLE_FFMPEG_VAL}" \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  UNSIGNED_BUILD=1 \
  pnpm --filter video-translate exec electron-builder --mac --dir

  success "桌面应用编译完成"
else
  info "[1/4] 跳过编译步骤（使用已有构建产物）"
fi

# 2. 定位生成的 .app 路径
ARCH="$(uname -m)"
CANDIDATE_DIRS=(
  "${DESKTOP_DIR}/dist/v${VERSION}/mac-${ARCH}/${APP_NAME}.app"
  "${DESKTOP_DIR}/dist/v${VERSION}/mac/${APP_NAME}.app"
  "${DESKTOP_DIR}/dist/v${VERSION}/mac-arm64/${APP_NAME}.app"
  "${DESKTOP_DIR}/dist/v${VERSION}/mac-x64/${APP_NAME}.app"
)

SOURCE_APP_PATH=""
for candidate in "${CANDIDATE_DIRS[@]}"; do
  if [ -d "${candidate}" ]; then
    SOURCE_APP_PATH="${candidate}"
    break
  fi
done

if [ -z "${SOURCE_APP_PATH}" ]; then
  error "未找到构建出的 ${APP_NAME}.app，搜索路径包括:\n$(printf '  - %s\n' "${CANDIDATE_DIRS[@]}")"
  error "请检查编译日志，或去掉 --skip-build 参数重新执行构建。"
  exit 1
fi

info "找到应用产物: ${SOURCE_APP_PATH}"

# 3. 确定签名证书与执行代码签名
info "[2/4] 配置代码签名身份..."

if [ "${FORCE_ADHOC}" = true ]; then
  SIGN_IDENTITY="-"
  info "已选择强制 Ad-hoc 签名 (-)"
elif [ -n "${SIGN_IDENTITY}" ]; then
  info "使用用户指定的签名身份: ${SIGN_IDENTITY}"
else
  # 自动检测本地证书
  # 优先级: Developer ID Application -> Apple Development -> 其他 codesigning 证书 -> Ad-hoc (-)
  AVAILABLE_IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"

  DEV_ID="$(echo "${AVAILABLE_IDENTITIES}" | grep 'Developer ID Application:' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  APPLE_DEV="$(echo "${AVAILABLE_IDENTITIES}" | grep 'Apple Development:' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  OTHER_ID="$(echo "${AVAILABLE_IDENTITIES}" | grep -E '^[[:space:]]*[0-9]+\)' | head -n 1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"

  if [ -n "${DEV_ID}" ]; then
    SIGN_IDENTITY="${DEV_ID}"
    info "检测到 Developer ID 证书: ${SIGN_IDENTITY}"
  elif [ -n "${APPLE_DEV}" ]; then
    SIGN_IDENTITY="${APPLE_DEV}"
    info "检测到 Apple Development 证书: ${SIGN_IDENTITY}"
  elif [ -n "${OTHER_ID}" ]; then
    SIGN_IDENTITY="${OTHER_ID}"
    info "检测到有效代码签名证书: ${SIGN_IDENTITY}"
  else
    SIGN_IDENTITY="-"
    warn "未在钥匙串中发现可用的 Apple 代码签名证书，自动降级为 Ad-hoc 自签名 (-)"
  fi
fi

info "[3/4] 对应用进行深度代码签名 (Identity: ${SIGN_IDENTITY})..."

# 使用 codesign 进行递归强制签名
codesign --force --deep --sign "${SIGN_IDENTITY}" "${SOURCE_APP_PATH}"

# 严格校验签名
codesign --verify --deep --strict --verbose=1 "${SOURCE_APP_PATH}"
success "代码签名验证通过"

# 4. 安装至目标目录
info "[4/4] 部署至 ${DEST_DIR}..."

# 4.1 检查目标应用是否正在运行，若运行则安全退出
RUNNING_PIDS="$(pgrep -f "${TARGET_APP_PATH}/Contents/MacOS" || true)"
if [ -n "${RUNNING_PIDS}" ]; then
  warn "检测到正在运行的《${APP_NAME}》实例 (PID: ${RUNNING_PIDS})，正在尝试关闭..."
  pkill -f "${TARGET_APP_PATH}/Contents/MacOS" || true
  sleep 1
fi

# 4.2 确认目标目录存在
if [ ! -d "${DEST_DIR}" ]; then
  mkdir -p "${DEST_DIR}"
fi

# 4.3 写入权限与复制操作
USE_SUDO=false
if [ -e "${TARGET_APP_PATH}" ] && [ ! -w "${TARGET_APP_PATH}" ]; then
  USE_SUDO=true
elif [ ! -w "${DEST_DIR}" ]; then
  USE_SUDO=true
fi

if [ -e "${TARGET_APP_PATH}" ]; then
  info "  -> 移除旧版本: ${TARGET_APP_PATH}"
  if [ "${USE_SUDO}" = true ]; then
    warn "需要管理员权限移除已存在的旧版本..."
    sudo rm -rf "${TARGET_APP_PATH}"
  else
    rm -rf "${TARGET_APP_PATH}"
  fi
fi

info "  -> 拷贝新版本应用 (ditto)..."
if [ "${USE_SUDO}" = true ]; then
  warn "需要管理员权限复制应用至 ${DEST_DIR}..."
  sudo ditto "${SOURCE_APP_PATH}" "${TARGET_APP_PATH}"
else
  ditto "${SOURCE_APP_PATH}" "${TARGET_APP_PATH}"
fi

# 4.4 移除隔离属性 (Gatekeeper 隔离标签，避免系统提示“已损坏”)
info "  -> 清除扩展隔离属性 (xattr -cr)..."
if [ "${USE_SUDO}" = true ]; then
  sudo xattr -cr "${TARGET_APP_PATH}"
else
  xattr -cr "${TARGET_APP_PATH}"
fi

# 4.5 再次验证安装后的签名
codesign --verify --deep --strict "${TARGET_APP_PATH}"
success "安装后签名校验通过"

echo -e "\n${GREEN}${BOLD}======================================================${RESET}"
echo -e "${GREEN}${BOLD}  部署成功！《${APP_NAME}》已安装至 /Applications  ${RESET}"
echo -e "  应用路径: ${CYAN}${TARGET_APP_PATH}${RESET}"
echo -e "  应用版本: ${CYAN}v${VERSION}${RESET}"
echo -e "  签名身份: ${CYAN}${SIGN_IDENTITY}${RESET}"
echo -e "${GREEN}${BOLD}======================================================${RESET}\n"

if [ "${AUTO_OPEN}" = true ]; then
  info "正在启动《${APP_NAME}》..."
  open "${TARGET_APP_PATH}"
else
  echo -e "如需启动应用，可执行:\n  ${CYAN}open \"${TARGET_APP_PATH}\"${RESET}\n"
fi
