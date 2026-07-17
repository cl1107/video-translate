/** 浏览器端平台 / 架构探测，供下载 CTA 自动匹配安装包 */

export type OsId = 'mac' | 'win' | 'linux' | 'unknown'
export type ArchId = 'arm64' | 'x64' | 'unknown'

export type DetectedPlatform = {
  os: OsId
  arch: ArchId
  /** 完整描述，如「macOS · Apple Silicon」 */
  label: string
  /** 按钮主文案用，如「macOS」 */
  shortLabel: string
}

function readUserAgentData(): {
  platform?: string
  architecture?: string
  bitness?: string
} {
  const nav = navigator as Navigator & {
    userAgentData?: {
      platform?: string
      architecture?: string
      getHighEntropyValues?: (hints: string[]) => Promise<{
        architecture?: string
        bitness?: string
        platform?: string
      }>
    }
  }
  return nav.userAgentData ?? {}
}

function normalizeArch(raw: string | undefined): ArchId {
  if (!raw) return 'unknown'
  const value = raw.toLowerCase()
  if (
    value.includes('arm') ||
    value.includes('aarch') ||
    value === 'arm64' ||
    value === 'aarch64'
  ) {
    return 'arm64'
  }
  if (
    value.includes('x86_64') ||
    value.includes('amd64') ||
    value.includes('x64') ||
    value.includes('intel') ||
    value === 'x86'
  ) {
    return 'x64'
  }
  return 'unknown'
}

function detectOs(): OsId {
  const ua = navigator.userAgent
  const platform = navigator.platform || ''
  const uaDataPlatform = readUserAgentData().platform?.toLowerCase() ?? ''

  // 移动端没有桌面安装包，交给「其他下载」/ Releases
  if (
    /iPhone|iPad|iPod/.test(ua) ||
    /iPhone|iPad|iPod/.test(platform) ||
    (uaDataPlatform.includes('android') || /Android/.test(ua))
  ) {
    return 'unknown'
  }

  // iPadOS 13+ 常伪装成 Mac；用触控点数辅助识别
  const isTouchMac =
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  if (isTouchMac) return 'unknown'

  if (
    uaDataPlatform.includes('mac') ||
    /Mac/.test(platform) ||
    /Macintosh|Mac OS X/.test(ua)
  ) {
    return 'mac'
  }
  if (
    uaDataPlatform.includes('win') ||
    /Win/.test(platform) ||
    /Windows/.test(ua)
  ) {
    return 'win'
  }
  if (
    uaDataPlatform.includes('linux') ||
    /Linux/.test(platform) ||
    /Linux/.test(ua) ||
    /CrOS/.test(ua)
  ) {
    return 'linux'
  }
  return 'unknown'
}

function detectArch(os: OsId): ArchId {
  const uaData = readUserAgentData()
  const fromUaData = normalizeArch(uaData.architecture)
  if (fromUaData !== 'unknown') return fromUaData

  // 部分 Chromium 只在 high-entropy 里给 architecture；同步探测先读 UA
  const ua = navigator.userAgent
  if (/arm64|aarch64/i.test(ua)) return 'arm64'
  if (/x86_64|Win64|WOW64|amd64/i.test(ua)) return 'x64'

  // Apple Silicon 在 Safari 上 UA 常不暴露架构；现代 Mac 默认 arm64
  if (os === 'mac') return 'arm64'
  // Windows / Linux 桌面发行以 x64 为主
  if (os === 'win' || os === 'linux') return 'x64'
  return 'unknown'
}

function buildLabel(os: OsId, arch: ArchId): { label: string; shortLabel: string } {
  if (os === 'mac') {
    const chip =
      arch === 'x64' ? 'Intel' : arch === 'arm64' ? 'Apple Silicon' : 'macOS'
    return {
      shortLabel: 'macOS',
      label: arch === 'unknown' ? 'macOS' : `macOS · ${chip}`,
    }
  }
  if (os === 'win') {
    return {
      shortLabel: 'Windows',
      label: arch === 'arm64' ? 'Windows · ARM64' : 'Windows · x64',
    }
  }
  if (os === 'linux') {
    return {
      shortLabel: 'Linux',
      label: arch === 'arm64' ? 'Linux · ARM64' : 'Linux · x64',
    }
  }
  return { shortLabel: '本机', label: '未能识别本机平台' }
}

let cachedPlatform: DetectedPlatform | null = null

/** 同步探测当前访客平台（首屏即可用，结果会缓存） */
export function detectPlatform(): DetectedPlatform {
  if (cachedPlatform) return cachedPlatform

  if (typeof navigator === 'undefined') {
    return {
      os: 'unknown',
      arch: 'unknown',
      label: '未能识别本机平台',
      shortLabel: '本机',
    }
  }

  const os = detectOs()
  const arch = detectArch(os)
  const { label, shortLabel } = buildLabel(os, arch)
  cachedPlatform = { os, arch, label, shortLabel }
  return cachedPlatform
}

/**
 * 尝试用 User-Agent Client Hints 补全架构。
 * 在支持的浏览器里异步 refine；不支持则原样返回。
 */
export async function refinePlatformArch(
  current: DetectedPlatform
): Promise<DetectedPlatform> {
  if (typeof navigator === 'undefined') return current

  const nav = navigator as Navigator & {
    userAgentData?: {
      getHighEntropyValues?: (hints: string[]) => Promise<{
        architecture?: string
        bitness?: string
      }>
    }
  }

  const getHighEntropy = nav.userAgentData?.getHighEntropyValues
  if (!getHighEntropy) return current

  try {
    const values = await getHighEntropy(['architecture', 'bitness'])
    let arch = normalizeArch(values.architecture)
    if (arch === 'unknown' && values.bitness === '64') {
      arch = 'x64'
    }
    if (arch === 'unknown' || arch === current.arch) return current
    const { label, shortLabel } = buildLabel(current.os, arch)
    const refined = { os: current.os, arch, label, shortLabel }
    cachedPlatform = refined
    return refined
  } catch {
    return current
  }
}
