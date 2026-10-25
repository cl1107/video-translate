import assert from 'node:assert/strict'
import { test } from 'vitest'

import { resolveWindowChrome } from './window-chrome'

test('macOS 隐藏原生标题栏并内嵌红绿灯', () => {
  assert.deepEqual(resolveWindowChrome('darwin'), {
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 22 },
  })
})

test('其它平台保留系统原生标题栏', () => {
  assert.deepEqual(resolveWindowChrome('win32'), {})
  assert.deepEqual(resolveWindowChrome('linux'), {})
})
