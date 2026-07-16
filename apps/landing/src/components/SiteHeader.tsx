import { ArrowDownToLine } from 'lucide-react'

import { AppLink } from '../router'
import { APP_VERSION, releaseUrl, repositoryUrl } from '../site'
import appLogo from '../assets/logo-transparent.png'

type SiteHeaderProps = {
  /** 首页用锚点导航；文档页仅保留跨页链接 */
  variant?: 'home' | 'docs'
}

export function SiteHeader({ variant = 'home' }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <AppLink className="brand" to="/" aria-label="视频翻译助手首页">
        <span className="brand-mark-wrap">
          <img
            className="brand-mark"
            src={appLogo}
            alt=""
            width={34}
            height={34}
            draggable={false}
          />
          <span className="brand-mark-dot" aria-hidden />
        </span>
        <span>视频翻译助手</span>
      </AppLink>
      <nav aria-label="主导航">
        {variant === 'home' ? (
          <>
            <a className="nav-desktop-only" href="#features">
              能力
            </a>
            <a className="nav-desktop-only" href="#workflow">
              工作流
            </a>
            <a className="nav-desktop-only" href="#privacy">
              隐私
            </a>
          </>
        ) : (
          <AppLink to="/">首页</AppLink>
        )}
        <AppLink to="/docs">文档</AppLink>
        <a
          className="nav-desktop-only"
          href={repositoryUrl}
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </nav>
      <a className="header-download" href={releaseUrl}>
        下载 v{APP_VERSION}
        <ArrowDownToLine size={16} />
      </a>
    </header>
  )
}
