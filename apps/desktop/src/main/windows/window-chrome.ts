import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * macOS 使用自绘标题栏：隐藏原生标题栏，只把红绿灯按钮浮在应用顶栏内，
 * 让窗口顶边与应用顶栏连成一片（Linear / Raycast 一类桌面工具的做法）。
 *
 * 其它平台保留系统原生边框与标题栏，避免出现没有窗口按钮的无边框窗口。
 */
export function resolveWindowChrome(
  platform: NodeJS.Platform = process.platform
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin') return {}

  return {
    titleBarStyle: 'hidden',
    // 红绿灯（12pt）在 56px 顶栏内垂直居中：22 + 12 / 2 = 28
    trafficLightPosition: { x: 20, y: 22 },
  }
}
