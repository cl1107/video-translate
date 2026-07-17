/** GitHub Release 资产拉取与平台匹配 */

import { APP_VERSION, releaseUrl } from '../site'
import type { ArchId, DetectedPlatform, OsId } from './platform'

export type PackageVariant = 'bundled' | 'slim'

export type ReleaseAsset = {
  name: string
  url: string
  size: number
}

export type LatestRelease = {
  tag: string
  version: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

export type MatchedDownload = {
  url: string
  name: string
  size: number
  variant: PackageVariant
  formatLabel: string
  sizeLabel: string
}

const RELEASE_API =
  'https://api.github.com/repos/cl1107/video-translate/releases/latest'

const VARIANT_TOKEN: Record<PackageVariant, string> = {
  bundled: 'bundled-ffmpeg',
  slim: 'slim',
}

/** 安装包格式优先级（同平台同变体时优先选） */
const FORMAT_PRIORITY: Record<OsId, string[]> = {
  mac: ['.dmg', '.zip'],
  win: ['.exe', '.zip'],
  linux: ['.AppImage', '.deb', '.rpm', '.pacman'],
  unknown: [],
}

const FORMAT_LABEL: Record<string, string> = {
  '.dmg': 'DMG',
  '.zip': 'ZIP',
  '.exe': 'EXE',
  '.AppImage': 'AppImage',
  '.deb': 'DEB',
  '.rpm': 'RPM',
  '.pacman': 'Pacman',
}

let cachedRelease: LatestRelease | null = null
let inflight: Promise<LatestRelease> | null = null

function stripV(tag: string): string {
  return tag.replace(/^v/i, '')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  if (mb >= 100) return `${Math.round(mb)} MB`
  if (mb >= 10) return `${mb.toFixed(0)} MB`
  return `${mb.toFixed(1)} MB`
}

function assetExtension(name: string): string {
  const lower = name.toLowerCase()
  for (const ext of [
    '.appimage',
    '.pacman',
    '.dmg',
    '.zip',
    '.exe',
    '.deb',
    '.rpm',
  ]) {
    if (lower.endsWith(ext)) {
      return ext === '.appimage' ? '.AppImage' : ext
    }
  }
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

function formatLabelFor(name: string): string {
  const ext = assetExtension(name)
  return FORMAT_LABEL[ext] ?? ext.replace('.', '').toUpperCase()
}

/** 资产名中的架构 token 是否匹配探测结果 */
function archMatches(name: string, arch: ArchId): boolean {
  const lower = name.toLowerCase()
  const isArm =
    lower.includes('-arm64') ||
    lower.includes('-aarch64') ||
    lower.includes('_arm64')
  const isX64 =
    lower.includes('-x64') ||
    lower.includes('-amd64') ||
    lower.includes('-x86_64') ||
    lower.includes('_x64')

  if (arch === 'arm64') return isArm
  if (arch === 'x64') return isX64 && !isArm
  // 未知架构：交给上层按默认架构重试
  return true
}

function osToken(os: OsId): string | null {
  if (os === 'mac') return '-mac-'
  if (os === 'win') return '-win-'
  if (os === 'linux') return '-linux-'
  return null
}

function variantMatches(name: string, variant: PackageVariant): boolean {
  const lower = name.toLowerCase()
  if (variant === 'bundled') {
    return lower.includes('bundled-ffmpeg')
  }
  // slim 不能误匹配 bundled
  return lower.includes('-slim.') || lower.includes('-slim-')
}

function scoreAsset(
  asset: ReleaseAsset,
  os: OsId,
  arch: ArchId,
  variant: PackageVariant
): number {
  const name = asset.name
  const lower = name.toLowerCase()
  if (lower === 'sha256sums.txt' || lower.endsWith('.blockmap')) return -1
  if (!variantMatches(name, variant)) return -1

  const token = osToken(os)
  if (!token || !lower.includes(token)) return -1
  if (!archMatches(name, arch)) return -1

  const ext = assetExtension(name)
  const priority = FORMAT_PRIORITY[os] ?? []
  const formatIndex = priority.indexOf(ext)
  if (formatIndex < 0) return 10 // 可匹配但不在优先列表

  // 格式越靠前分越高；架构精确时再加分
  let score = 100 - formatIndex * 10
  if (arch !== 'unknown' && archMatches(name, arch)) score += 5
  return score
}

/**
 * 在 release 资产列表中为当前平台 + 变体挑选最佳安装包。
 * mac 在探测偏差时允许 arm64 ↔ x64 回退；Windows / Linux 不做跨架构回退，避免下错二进制。
 */
export function matchDownload(
  assets: ReleaseAsset[],
  platform: DetectedPlatform,
  variant: PackageVariant
): MatchedDownload | null {
  if (platform.os === 'unknown') return null

  const tryMatch = (arch: ArchId): ReleaseAsset | null => {
    let best: ReleaseAsset | null = null
    let bestScore = -1
    for (const asset of assets) {
      const score = scoreAsset(asset, platform.os, arch, variant)
      if (score > bestScore) {
        bestScore = score
        best = asset
      }
    }
    return bestScore >= 0 ? best : null
  }

  let matched = tryMatch(platform.arch)

  // 架构未知时：mac 优先 arm64，其余优先 x64
  if (!matched && platform.arch === 'unknown') {
    if (platform.os === 'mac') {
      matched = tryMatch('arm64') ?? tryMatch('x64')
    } else {
      matched = tryMatch('x64') ?? tryMatch('arm64')
    }
  }

  // 仅 mac 允许跨架构回退（发布面以 arm64 为主，Intel 探测偶发偏差）
  if (!matched && platform.os === 'mac' && platform.arch !== 'unknown') {
    matched = tryMatch(platform.arch === 'arm64' ? 'x64' : 'arm64')
  }

  if (!matched) return null

  return {
    url: matched.url,
    name: matched.name,
    size: matched.size,
    variant,
    formatLabel: formatLabelFor(matched.name),
    sizeLabel: formatBytes(matched.size),
  }
}

/** 拉取最新 Release（带内存缓存，避免多 CTA 重复请求） */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  if (cachedRelease) return cachedRelease
  if (inflight) return inflight

  inflight = (async () => {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status}`)
    }
    const data = (await response.json()) as {
      tag_name?: string
      html_url?: string
      assets?: Array<{
        name?: string
        browser_download_url?: string
        size?: number
      }>
    }

    const tag = data.tag_name || `v${APP_VERSION}`
    const release: LatestRelease = {
      tag,
      version: stripV(tag),
      htmlUrl: data.html_url || releaseUrl,
      assets: (data.assets ?? [])
        .filter(a => a.name && a.browser_download_url)
        .map(a => ({
          name: a.name as string,
          url: a.browser_download_url as string,
          size: a.size ?? 0,
        })),
    }
    cachedRelease = release
    return release
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

/** 构造乐观直链（API 失败时的兜底，可能 404） */
export function buildFallbackDownloadUrl(
  platform: DetectedPlatform,
  variant: PackageVariant
): string | null {
  if (platform.os === 'unknown') return null

  const version = APP_VERSION
  const v = VARIANT_TOKEN[variant]
  const arch =
    platform.arch === 'unknown'
      ? platform.os === 'mac'
        ? 'arm64'
        : 'x64'
      : platform.arch

  if (platform.os === 'mac') {
    return `https://github.com/cl1107/video-translate/releases/download/v${version}/video-translate-v${version}-mac-${arch}-${v}.dmg`
  }
  if (platform.os === 'win') {
    return `https://github.com/cl1107/video-translate/releases/download/v${version}/video-translate-v${version}-win-${arch}-${v}.exe`
  }
  if (platform.os === 'linux') {
    // AppImage 使用 x86_64 命名
    const linuxArch = arch === 'arm64' ? 'arm64' : 'x86_64'
    return `https://github.com/cl1107/video-translate/releases/download/v${version}/video-translate-v${version}-linux-${linuxArch}-${v}.AppImage`
  }
  return null
}

export const variantCopy: Record<
  PackageVariant,
  { label: string; hint: string }
> = {
  bundled: {
    label: '完整版',
    hint: '内置 FFmpeg，开箱即用',
  },
  slim: {
    label: '精简版',
    hint: '体积更小，需本机已装 FFmpeg',
  },
}
