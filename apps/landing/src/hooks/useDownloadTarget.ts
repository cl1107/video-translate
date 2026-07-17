import { useEffect, useMemo, useState } from 'react'

import {
  detectPlatform,
  refinePlatformArch,
  type DetectedPlatform,
} from '../lib/platform'
import {
  buildFallbackDownloadUrl,
  fetchLatestRelease,
  matchDownload,
  type MatchedDownload,
  type PackageVariant,
} from '../lib/releases'
import { APP_VERSION, releaseUrl } from '../site'

export type DownloadTargetState = {
  platform: DetectedPlatform
  variant: PackageVariant
  setVariant: (v: PackageVariant) => void
  /** 直接下载地址；加载中或失败时可能回退到 release 页 */
  href: string
  matched: MatchedDownload | null
  version: string
  releasePageUrl: string
  status: 'loading' | 'ready' | 'fallback'
  isDirect: boolean
}

/**
 * 平台探测 + 最新 Release 匹配。
 * Release 资产由 releases 模块内存缓存，多 CTA 不会重复打 API。
 */
export function useDownloadTarget(
  initialVariant: PackageVariant = 'bundled'
): DownloadTargetState {
  const [platform, setPlatform] = useState<DetectedPlatform>(() =>
    detectPlatform()
  )
  const [variant, setVariant] = useState<PackageVariant>(initialVariant)
  const [matched, setMatched] = useState<MatchedDownload | null>(null)
  const [version, setVersion] = useState(APP_VERSION)
  const [releasePageUrl, setReleasePageUrl] = useState(releaseUrl)
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>(
    'loading'
  )

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const refined = await refinePlatformArch(detectPlatform())
      if (cancelled) return
      setPlatform(refined)

      try {
        const release = await fetchLatestRelease()
        if (cancelled) return
        setVersion(release.version)
        setReleasePageUrl(release.htmlUrl)
      } catch {
        // 保留 APP_VERSION + releaseUrl 兜底
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setStatus('loading')
      try {
        const release = await fetchLatestRelease()
        if (cancelled) return
        const hit = matchDownload(release.assets, platform, variant)
        setMatched(hit)
        setStatus(hit ? 'ready' : 'fallback')
      } catch {
        if (cancelled) return
        setMatched(null)
        setStatus('fallback')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [variant, platform])

  const fallbackUrl = useMemo(
    () => buildFallbackDownloadUrl(platform, variant),
    [platform, variant]
  )

  const href = matched?.url ?? fallbackUrl ?? releasePageUrl
  const isDirect = Boolean(matched?.url || fallbackUrl)

  return {
    platform,
    variant,
    setVariant,
    href,
    matched,
    version,
    releasePageUrl,
    status,
    isDirect,
  }
}
