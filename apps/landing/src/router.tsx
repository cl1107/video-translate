import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'

import { getAppPath, pathToRoute, toHref, type AppRoute } from './site'

type RouterContextValue = {
  path: string
  route: AppRoute
  navigate: (path: string) => void
}

const RouterContext = createContext<RouterContextValue | null>(null)

function normalizeAppPath(path: string): string {
  let next = path.startsWith('/') ? path : `/${path}`
  if (next.length > 1 && next.endsWith('/')) {
    next = next.slice(0, -1)
  }
  return next || '/'
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => getAppPath())

  useEffect(() => {
    const onPopState = () => setPath(getAppPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: string) => {
    const nextAppPath = normalizeAppPath(next)
    if (getAppPath() === nextAppPath) {
      return
    }
    window.history.pushState({}, '', toHref(nextAppPath))
    setPath(nextAppPath)
    window.scrollTo(0, 0)
  }, [])

  const value = useMemo(
    () => ({
      path,
      route: pathToRoute(path),
      navigate,
    }),
    [path, navigate]
  )

  return (
    <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
  )
}

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) {
    throw new Error('useRouter 必须在 RouterProvider 内使用')
  }
  return ctx
}

type AppLinkProps = {
  to: string
  className?: string
  children: ReactNode
  'aria-label'?: string
  onClick?: () => void
}

/** 应用内链接：拦截点击，走 History API，保留完整刷新可用性 */
export function AppLink({
  to,
  className,
  children,
  onClick,
  ...rest
}: AppLinkProps) {
  const { navigate, path } = useRouter()
  const targetPath = normalizeAppPath(to)
  const href = toHref(targetPath)

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return
    }
    event.preventDefault()
    navigate(targetPath)
    onClick?.()
  }

  const isActive =
    targetPath === '/'
      ? path === '/'
      : path === targetPath || path.startsWith(`${targetPath}/`)

  return (
    <a
      href={href}
      className={className}
      data-active={isActive ? 'true' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {children}
    </a>
  )
}
