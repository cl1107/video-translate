/** 站点级常量与路由工具（兼容 Vite base / GitHub Pages 子路径） */

export const APP_VERSION = '0.7.0'
export const releaseUrl =
  'https://github.com/cl1107/video-translate/releases/latest'
export const repositoryUrl = 'https://github.com/cl1107/video-translate'
export const siteUrl = 'https://cl1107.github.io/video-translate/'

/** Vite base，始终以 / 结尾，例如 `/` 或 `/video-translate/` */
export function getBaseUrl(): string {
  return import.meta.env.BASE_URL
}

/** 将应用内路径（如 `/docs`）转为可挂到地址栏的完整 pathname */
export function toHref(path: string): string {
  const base = getBaseUrl()
  if (path === '/' || path === '') {
    return base
  }
  const clean = path.startsWith('/') ? path.slice(1) : path
  return `${base}${clean}`
}

/**
 * 从 window.location.pathname 解析应用内路径。
 * `/video-translate/docs` → `/docs`；`/` → `/`
 */
export function getAppPath(pathname = window.location.pathname): string {
  const base = getBaseUrl().replace(/\/$/, '') // '' 或 '/video-translate'
  let path = pathname
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length) || '/'
  }
  if (!path.startsWith('/')) {
    path = `/${path}`
  }
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1)
  }
  return path || '/'
}

export type AppRoute = 'home' | 'docs'

export function pathToRoute(path: string): AppRoute {
  if (path === '/docs' || path.startsWith('/docs/')) {
    return 'docs'
  }
  return 'home'
}
