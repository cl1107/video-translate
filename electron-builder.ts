import type { Configuration } from 'electron-builder'

import {
  main,
  name,
  version,
  resources,
  description,
  displayName,
  author as _author,
} from './package.json'

import { getDevFolder } from './src/lib/electron-app/release/utils/path'

const author = _author?.name ?? _author
const currentYear = new Date().getFullYear()
const authorInKebabCase = author.replace(/\s+/g, '-')
const appId = `com.${authorInKebabCase}.${name}`.toLowerCase()

const artifactName = [`${name}-v${version}`, '-${os}.${ext}'].join('')
const bundleFfmpeg = process.env.BUNDLE_FFMPEG !== '0'
const ffmpegArch = process.env.FFMPEG_ARCH || process.arch

export default {
  appId,
  productName: displayName,
  copyright: `Copyright © ${currentYear} — ${author}`,

  directories: {
    app: getDevFolder(main),
    output: `dist/v${version}`,
  },

  mac: {
    artifactName,
    icon: `${resources}/build/icons/icon.icns`,
    category: 'public.app-category.utilities',
    target: ['zip', 'dmg', 'dir'],
    ...(bundleFfmpeg
      ? {
          extraResources: [
            {
              from: `${resources}/ffmpeg/darwin-${ffmpegArch}`,
              to: 'ffmpeg',
              filter: ['**/*'],
            },
          ],
        }
      : {}),
  },

  linux: {
    artifactName,
    category: 'Utilities',
    synopsis: description,
    target: ['AppImage', 'deb', 'pacman', 'freebsd', 'rpm'],
    ...(bundleFfmpeg
      ? {
          extraResources: [
            {
              from: `${resources}/ffmpeg/linux-${ffmpegArch}`,
              to: 'ffmpeg',
              filter: ['**/*'],
            },
          ],
        }
      : {}),
  },

  win: {
    artifactName,
    icon: `${resources}/build/icons/icon.ico`,
    target: ['zip', 'portable'],
    ...(bundleFfmpeg
      ? {
          extraResources: [
            {
              from: `${resources}/ffmpeg/win32-${ffmpegArch}`,
              to: 'ffmpeg',
              filter: ['**/*'],
            },
          ],
        }
      : {}),
  },
} satisfies Configuration
