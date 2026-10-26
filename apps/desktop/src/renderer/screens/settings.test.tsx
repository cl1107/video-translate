import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { test, vi } from 'vitest'
import { SettingsScreen } from './settings'

vi.mock('renderer/components/settings/SettingsPanel', () => ({
  SettingsPanel: ({ category }: { category: string }) => (
    <section data-category={category} />
  ),
}))

vi.mock('renderer/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

test.each([
  ['/settings', 'general'],
  ['/settings?category=models', 'models'],
  ['/settings?category=system', 'system'],
  ['/settings?category=unknown', 'general'],
])('设置路由 %s 打开 %s 分类', (url, category) => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <SettingsScreen />
    </MemoryRouter>
  )
  assert.ok(html.includes(`data-category="${category}"`))
})
