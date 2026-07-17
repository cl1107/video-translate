import { ArrowDownToLine, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'

import { useDownloadTarget } from '../hooks/useDownloadTarget'
import { variantCopy, type PackageVariant } from '../lib/releases'

type Appearance = 'primary' | 'dark' | 'header'

type DownloadCtaProps = {
  /** 按钮外观 */
  appearance?: Appearance
  /** 是否展示完整版 / 精简版切换 */
  showVariantToggle?: boolean
  /** 是否展示「其他下载」链接 */
  showOtherLink?: boolean
  /** 是否展示平台与体积提示 */
  showHint?: boolean
  /** 主按钮旁的次要操作（如「看它如何工作」） */
  secondary?: ReactNode
  /** header 紧凑模式：仅一颗下载钮 */
  compact?: boolean
  className?: string
}

function buttonClass(appearance: Appearance): string {
  if (appearance === 'dark') return 'button button-dark download-btn'
  if (appearance === 'header') return 'header-download'
  return 'button button-primary download-btn'
}

function primaryLabel(opts: {
  compact: boolean
  shortLabel: string
  version: string
  isDirect: boolean
}): string {
  const { compact, shortLabel, version, isDirect } = opts
  if (compact) {
    if (isDirect && shortLabel !== '本机') return `下载 ${shortLabel}`
    return `下载 v${version}`
  }
  if (isDirect && shortLabel !== '本机') return `下载 ${shortLabel}`
  return '免费下载'
}

export function DownloadCta({
  appearance = 'primary',
  showVariantToggle = true,
  showOtherLink = true,
  showHint = true,
  secondary,
  compact = false,
  className,
}: DownloadCtaProps) {
  const {
    platform,
    variant,
    setVariant,
    href,
    matched,
    version,
    releasePageUrl,
    status,
    isDirect,
  } = useDownloadTarget('bundled')

  const label = primaryLabel({
    compact,
    shortLabel: platform.shortLabel,
    version,
    isDirect,
  })

  const metaLine = matched
    ? `${matched.formatLabel}${matched.sizeLabel ? ` · ${matched.sizeLabel}` : ''}`
    : `v${version}`

  const downloadButton = (
    <a
      className={buttonClass(appearance)}
      href={href}
      target={isDirect ? undefined : '_blank'}
      rel={isDirect ? undefined : 'noreferrer'}
      data-status={status}
      aria-label={
        isDirect
          ? `下载 ${platform.label} ${variantCopy[variant].label}`
          : '打开 GitHub Releases 下载'
      }
    >
      <ArrowDownToLine size={compact ? 16 : 19} aria-hidden />
      {compact ? (
        label
      ) : (
        <span className="download-btn-text">
          <strong>{label}</strong>
          <small>{metaLine}</small>
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

      {(showVariantToggle || showOtherLink) && (
        <div className="download-cta-meta">
          {showVariantToggle && (
            <div
              className="download-variant"
              role="group"
              aria-label="安装包类型"
            >
              {(['bundled', 'slim'] as PackageVariant[]).map(key => {
                const copy = variantCopy[key]
                const active = variant === key
                return (
                  <button
                    key={key}
                    type="button"
                    className={
                      active
                        ? 'download-variant-btn is-active'
                        : 'download-variant-btn'
                    }
                    aria-pressed={active}
                    title={copy.hint}
                    onClick={() => setVariant(key)}
                  >
                    {copy.label}
                  </button>
                )
              })}
            </div>
          )}

          {showOtherLink && (
            <a
              className="download-other"
              href={releasePageUrl}
              target="_blank"
              rel="noreferrer"
            >
              其他下载
              <ExternalLink size={12} strokeWidth={2.2} aria-hidden />
            </a>
          )}
        </div>
      )}

      {showHint && (
        <p className="download-hint">
          <span className="download-hint-platform">{platform.label}</span>
          <span className="download-hint-dot" aria-hidden />
          <span>{variantCopy[variant].hint}</span>
          {!isDirect && status !== 'loading' ? (
            <>
              <span className="download-hint-dot" aria-hidden />
              <span>将打开 GitHub Releases</span>
            </>
          ) : null}
        </p>
      )}
    </div>
  )
}
