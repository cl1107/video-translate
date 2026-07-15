import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 使用项目子路径；本地开发继续从根路径提供资源。
  base: process.env.GITHUB_ACTIONS ? '/video-translate/' : '/',
  server: {
    port: 4173,
  },
})
