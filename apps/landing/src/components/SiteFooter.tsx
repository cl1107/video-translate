import { Github } from 'lucide-react'

import { AppLink } from '../router'
import { repositoryUrl } from '../site'
import appLogo from '../assets/logo-transparent.png'

export function SiteFooter() {
  return (
    <footer>
      <AppLink className="brand" to="/">
        <img
          className="brand-mark"
          src={appLogo}
          alt=""
          width={34}
          height={34}
          draggable={false}
        />
        <span>视频翻译助手</span>
      </AppLink>
      <p>把复杂的本地模型，变成一条清晰的字幕工作流。</p>
      <a href={repositoryUrl} aria-label="GitHub 仓库">
        <Github size={20} />
      </a>
    </footer>
  )
}
