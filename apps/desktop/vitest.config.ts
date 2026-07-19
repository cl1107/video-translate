import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const srcRoot = resolve(import.meta.dirname, 'src')

export default defineConfig({
  resolve: {
    // 与 tsconfig paths `"*": ["./src/*"]` 对齐，便于组件测试解析 renderer/shared
    alias: [
      { find: '~', replacement: resolve(import.meta.dirname) },
      { find: 'renderer', replacement: resolve(srcRoot, 'renderer') },
      { find: 'shared', replacement: resolve(srcRoot, 'shared') },
      { find: 'main', replacement: resolve(srcRoot, 'main') },
      { find: 'preload', replacement: resolve(srcRoot, 'preload') },
      { find: 'assets', replacement: resolve(srcRoot, 'assets') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
