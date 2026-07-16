/** 主题偏好：浅色 / 暗色 / 跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 解析后的实际外观 */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'video-translate-theme'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePreference(raw)) return raw
  } catch {
    // localStorage 不可用时回退系统
  }
  return 'system'
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference
}

/** 将解析后的主题应用到 documentElement */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // 忽略持久化失败
  }
  const resolved = resolveTheme(preference)
  applyResolvedTheme(resolved)
  return resolved
}
