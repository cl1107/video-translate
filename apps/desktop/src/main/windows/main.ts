import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createWindow } from 'lib/electron-app/factories/windows/create'
import { ENVIRONMENT } from 'shared/constants'
import { displayName } from '~/package.json'

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    // 开发态：electron-vite 主进程输出在 node_modules/.dev/main
    join(__dirname, '../../../src/resources/build/icons/icon.png'),
    // 以应用根目录为基准
    join(app.getAppPath(), 'src/resources/build/icons/icon.png'),
    join(process.cwd(), 'src/resources/build/icons/icon.png'),
  ]

  return candidates.find(candidate => existsSync(candidate))
}

export async function MainWindow() {
  const window = createWindow({
    id: 'main',
    title: displayName,
    width: 1400,
    height: 900,
    show: false,
    center: true,
    movable: true,
    resizable: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    icon: resolveWindowIconPath(),

    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  window.webContents.on('did-finish-load', () => {
    if (ENVIRONMENT.IS_DEV) {
      window.webContents.openDevTools({ mode: 'detach' })
    }

    window.show()
  })

  window.on('close', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy()
    }
  })

  return window
}
