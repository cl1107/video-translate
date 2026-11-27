import { ArrowDownToLine, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

import { APP_VERSION, nshDownloadUrl, nshReleaseUrl, releaseUrl } from '../site'

type Appearance = 'primary' | 'dark' | 'header'

type DownloadCtaProps = {
  appearance?: Appearance
  showHint?: boolean
  secondary?: ReactNode
  compact?: boolean
  className?: string
}

function buttonClass(appearance: Appearance): string {
  if (appearance === 'dark') return 'button button-dark download-btn'
  if (appearance === 'header') return 'header-download'
  return 'button button-primary download-btn'
}

export function DownloadCta({
  appearance = 'primary',
  showHint = true,
  secondary,
  compact = false,
  className,
}: DownloadCtaProps) {
  const downloadButton = (
    <a
      className={buttonClass(appearance)}
      href={nshDownloadUrl}
      aria-label="下载 macOS Apple Silicon 安装包"
    >
      <ArrowDownToLine size={compact ? 16 : 19} aria-hidden />
      {compact ? (
        '下载'
      ) : (
        <span className="download-btn-text">
          <strong>下载 macOS 版</strong>
          <small>Apple Silicon · v{APP_VERSION}</small>
        </span>
      )}
    </a>
  )

  if (compact) {
    return (
      <div
        className={['download-cta download-cta-compact', className]
          .filter(Boolean)
          .join(' ')}
      >
        {downloadButton}
      </div>
    )
  }

  return (
    <div
      className={['download-cta', `download-cta-${appearance}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="download-cta-row">
        {downloadButton}
        {secondary}
      </div>
      {showHint && (
        <div className="download-cta-meta">
          <a className="download-other" href={nshReleaseUrl}>
            版本说明与校验和
            <ExternalLink size={12} aria-hidden />
          </a>
          <a className="download-other" href={releaseUrl}>
            历史 Electron 版本
            <ExternalLink size={12} aria-hidden />
          </a>
        </div>
      )}
    </div>
  )
}
