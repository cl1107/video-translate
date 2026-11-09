#!/usr/bin/env node
/**
 * 优先用 /Applications 桌面版的 Electron（ELECTRON_RUN_AS_NODE）跑 CLI。
 * 安装包还没有 cli-bootstrap 时，回退到仓库内 tsx + 本地 electron。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

const packagedApp =
  process.env.VIDEO_TRANSLATE_APP?.trim() || '/Applications/视频翻译助手.app'
const packagedBin = path.join(packagedApp, 'Contents/MacOS/视频翻译助手')
const packagedBootstrap = path.join(
  packagedApp,
  'Contents/Resources/cli-bootstrap.cjs'
)
const useSource = process.env.VIDEO_TRANSLATE_USE_SOURCE === '1'
const packagedReady =
  !useSource && existsSync(packagedBin) && existsSync(packagedBootstrap)

const child = packagedReady
  ? spawn(packagedBin, [packagedBootstrap, ...args], {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    })
  : spawn(
      require('electron'),
      ['--import', 'tsx', path.join(here, 'index.ts'), ...args],
      {
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      }
    )

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', error => {
  console.error('启动 CLI 失败:', error.message)
  process.exit(1)
})
