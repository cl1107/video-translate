import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  applyResolvedTheme,
  getStoredThemePreference,
  getSystemTheme,
  setThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from 'renderer/lib/theme'

function subscribeSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getSystemThemeSnapshot(): ResolvedTheme {
  return getSystemTheme()
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setTheme: (next: ThemePreference) => void
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getStoredThemePreference()
  )

  const systemTheme = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    () => 'light' as ResolvedTheme
  )

  const resolved: ResolvedTheme =
    preference === 'system' ? systemTheme : preference

  useEffect(() => {
    applyResolvedTheme(resolved)
  }, [resolved])

  const setTheme = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    setThemePreference(next)
  }, [])

  const cycleTheme = useCallback(() => {
    const order: ThemePreference[] = ['light', 'dark', 'system']
    const idx = order.indexOf(preference)
    const next = order[(idx + 1) % order.length]
    setTheme(next)
  }, [preference, setTheme])

  const value = useMemo(
    () => ({ preference, resolved, setTheme, cycleTheme }),
    [preference, resolved, setTheme, cycleTheme]
  )

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  )
}

/**
 * 应用主题：支持 light / dark / system，并写入 localStorage。
 * 须在 ThemeProvider 内使用。
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme 必须在 ThemeProvider 内使用')
  }
  return ctx
}
