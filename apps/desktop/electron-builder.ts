import type { Configuration } from 'electron-builder'

import {
  author as _author,
  description,
  displayName,
  main,
  name,
  resources,
  version,
} from './package.json'

import { getDevFolder } from './src/lib/electron-app/release/utils/path'

const author = _author?.name ?? _author
const currentYear = new Date().getFullYear()
const authorInKebabCase = author.replace(/\s+/g, '-')
const appId = `com.${authorInKebabCase}.${name}`.toLowerCase()

const bundleFfmpeg = process.env.BUNDLE_FFMPEG !== '0'
const unsignedBuild = process.env.UNSIGNED_BUILD === '1'
const ffmpegArch = process.env.FFMPEG_ARCH || process.arch

export function createArtifactName(includeBundledFfmpeg: boolean): string {
  const packageVariant = includeBundledFfmpeg ? 'bundled-ffmpeg' : 'slim'

  return [
    `${name}-v${version}`,
    `-\${os}-\${arch}`,
    `-${packageVariant}`,
    `.\${ext}`,
  ].join('')
}

const artifactName = createArtifactName(bundleFfmpeg)

const cliBootstrapResource = {
  from: 'src/cli/packaged-bootstrap.cjs',
  to: 'cli-bootstrap.cjs',
}

function extraResourcesFor(
  ffmpegFrom?: string
): NonNullable<Configuration['extraResources']> {
  const items: NonNullable<Configuration['extraResources']> = [
    cliBootstrapResource,
  ]
  if (ffmpegFrom) {
    items.push({
      from: ffmpegFrom,
      to: 'ffmpeg',
      filter: ['**/*'],
    })
  }
  return items
}

export default {
  appId,
  productName: displayName,
  copyright: `Copyright © ${currentYear} — ${author}`,

  directories: {
    app: getDevFolder(main),
    output: `dist/v${version}`,
  },

  asar: true,
  asarUnpack: [
    '**/node_modules/better-sqlite3/build/Release/*.node',
    '**/node_modules/sherpa-onnx-node/**',
    '**/node_modules/sherpa-onnx-*/**',
  ],
  electronLanguages: ['zh_CN', 'zh_TW', 'en', 'en_US'],
  afterPack: './scripts/after-pack.cjs',

  files: [
    'main/**/*',
    'preload/**/*',
    'renderer/**/*',
    'package.json',
    '!**/*.map',
    '!**/*.d.ts',
    '!**/*.d.ts.map',
    '!**/*.md',
    '!**/README*',
    '!**/LICENSE*',
    '!**/CHANGELOG*',
    '!**/test/**',
    '!**/tests/**',
    '!**/__tests__/**',
    '!**/*.test.*',
    '!**/*.spec.*',
    '!**/Makefile',
    '!**/binding.gyp',
    '!**/*.gyp',
    '!**/*.mk',
  ],

  mac: {
    artifactName,
    icon: `${resources}/build/icons/icon.icns`,
    category: 'public.app-category.utilities',
    target: ['zip', 'dmg', 'dir'],
    extraResources: extraResourcesFor(
      bundleFfmpeg ? `${resources}/ffmpeg/darwin-${ffmpegArch}` : undefined
    ),
    ...(unsignedBuild
      ? {
          identity: null,
          hardenedRuntime: false,
          notarize: false,
        }
      : {}),
  },

  linux: {
    artifactName,
    icon: `${resources}/build/icons/icon.png`,
    category: 'Utilities',
    synopsis: description,
    executableName: name,
    target: ['AppImage', 'deb', 'pacman', 'rpm'],
    extraResources: extraResourcesFor(
      bundleFfmpeg ? `${resources}/ffmpeg/linux-${ffmpegArch}` : undefined
    ),
  },

  win: {
    artifactName,
    icon: `${resources}/build/icons/icon.ico`,
    target: ['zip', 'portable'],
    extraResources: extraResourcesFor(
      bundleFfmpeg ? `${resources}/ffmpeg/win32-${ffmpegArch}` : undefined
    ),
    ...(unsignedBuild ? { signExecutable: false } : {}),
  },
} satisfies Configuration
