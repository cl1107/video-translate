import assert from 'node:assert/strict'
import { test } from 'vitest'

import { name, version } from '../../package.json'

process.env.BUNDLE_FFMPEG = '0'
process.env.UNSIGNED_BUILD = '1'

const builderConfigModule = import('../../electron-builder')

test('内置 FFmpeg 与 slim 产物使用包含平台和架构的不同文件名', async () => {
  const { createArtifactName } = await builderConfigModule

  assert.equal(
    createArtifactName(true),
    `${name}-v${version}-\${os}-\${arch}-bundled-ffmpeg.\${ext}`
  )
  assert.equal(
    createArtifactName(false),
    `${name}-v${version}-\${os}-\${arch}-slim.\${ext}`
  )
})

test('unsigned 发布明确关闭 macOS 与 Windows 签名', async () => {
  const { default: config } = await builderConfigModule

  assert.equal(config.mac.identity, null)
  assert.equal(config.mac.hardenedRuntime, false)
  assert.equal(config.mac.notarize, false)
  assert.equal(config.win.signExecutable, false)
})

test('Linux 发布只生成 Linux 平台安装包', async () => {
  const { default: config } = await builderConfigModule

  assert.deepEqual(config.linux.target, ['AppImage', 'deb', 'pacman', 'rpm'])
})
