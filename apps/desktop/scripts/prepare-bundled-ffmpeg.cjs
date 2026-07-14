/* eslint-disable no-console */
const { spawn } = require('node:child_process')
const { createWriteStream } = require('node:fs')
const {
  access,
  copyFile,
  mkdir,
  readdir,
  rm,
  writeFile,
} = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const { path7za } = require('7zip-bin')

const SOURCE = {
  win32: {
    x64: {
      archive: 'ffmpeg-release-full.7z',
      format: '7z',
      urls: ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.7z'],
    },
  },
  darwin: {
    universal: {
      format: 'zip',
      urls: [
        'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
        'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip',
      ],
    },
  },
  linux: {
    x64: {
      archive: 'ffmpeg-release-amd64-static.tar.xz',
      format: 'tar.xz',
      urls: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
      ],
    },
    arm64: {
      archive: 'ffmpeg-release-arm64-static.tar.xz',
      format: 'tar.xz',
      urls: [
        'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
      ],
    },
  },
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function download(url, destination) {
  console.log(`Downloading bundled FFmpeg from ${url}`)
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination)
  )
}

async function extract(archive, directory, format) {
  if (format === '7z') {
    await run(path7za, ['x', '-y', archive, `-o${directory}`])
    return
  }

  if (format === 'zip') {
    await run('ditto', ['-x', '-k', archive, directory])
    return
  }

  await run('tar', ['-xJf', archive, '-C', directory])
}

async function findFile(directory, fileName) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName)
      if (found) return found
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath
    }
  }
  return undefined
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function verify(ffmpeg, ffprobe) {
  await run(ffmpeg, ['-hide_banner', '-filters'])
  await run(ffprobe, ['-version'])

  const { execFile } = require('node:child_process')
  const output = await new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-hide_banner', '-filters'], (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve(`${stdout}\n${stderr}`)
    })
  })

  if (!/\bsubtitles\b/.test(output)) {
    throw new Error(
      'Downloaded FFmpeg does not include the required subtitles/libass filter'
    )
  }
}

async function main() {
  if (process.env.BUNDLE_FFMPEG === '0') {
    console.log('Skipping bundled FFmpeg because BUNDLE_FFMPEG=0')
    return
  }

  const requestedArch = process.env.FFMPEG_ARCH || process.arch
  const platformSource = SOURCE[process.platform]
  const source =
    platformSource?.[
      process.platform === 'darwin' ? 'universal' : requestedArch
    ]
  if (!source) {
    throw new Error(
      `Bundled FFmpeg is not configured for ${process.platform}-${requestedArch}. ` +
        'Use BUNDLE_FFMPEG=0 for a slim build.'
    )
  }

  const executableExtension = process.platform === 'win32' ? '.exe' : ''
  const destination = path.resolve(
    'src/resources/ffmpeg',
    `${process.platform}-${requestedArch}`
  )
  const ffmpegDestination = path.join(
    destination,
    `ffmpeg${executableExtension}`
  )
  const ffprobeDestination = path.join(
    destination,
    `ffprobe${executableExtension}`
  )
  if ((await exists(ffmpegDestination)) && (await exists(ffprobeDestination))) {
    console.log(`Using existing bundled FFmpeg files in ${destination}`)
    return
  }

  const tempDirectory = await require('node:fs/promises').mkdtemp(
    path.join(os.tmpdir(), 'video-translate-ffmpeg-')
  )

  try {
    for (const [index, url] of source.urls.entries()) {
      const extension = source.format === 'zip' ? '.zip' : `.${source.format}`
      const archive = path.join(
        tempDirectory,
        source.archive || `archive-${index}${extension}`
      )
      const extracted = path.join(tempDirectory, `extracted-${index}`)
      await mkdir(extracted, { recursive: true })
      await download(url, archive)
      await extract(archive, extracted, source.format)
    }

    const ffmpegSource = await findFile(
      tempDirectory,
      `ffmpeg${executableExtension}`
    )
    const ffprobeSource = await findFile(
      tempDirectory,
      `ffprobe${executableExtension}`
    )
    if (!ffmpegSource || !ffprobeSource) {
      throw new Error(
        'Downloaded archive did not contain both ffmpeg and ffprobe'
      )
    }

    await rm(destination, { recursive: true, force: true })
    await mkdir(destination, { recursive: true })
    await copyFile(ffmpegSource, ffmpegDestination)
    await copyFile(ffprobeSource, ffprobeDestination)
    if (process.platform !== 'win32') {
      await run('chmod', ['755', ffmpegDestination, ffprobeDestination])
    }

    const license =
      (await findFile(tempDirectory, 'LICENSE')) ||
      (await findFile(tempDirectory, 'LICENSE.txt'))
    if (license) {
      await copyFile(license, path.join(destination, 'LICENSE.txt'))
    }

    await writeFile(
      path.join(destination, 'NOTICE.txt'),
      `Bundled FFmpeg and FFprobe\nSource: ${source.urls.join(', ')}\n` +
        'This software is distributed as a separate FFmpeg component. See LICENSE.txt and the source distribution for license terms.\n'
    )
    await verify(ffmpegDestination, ffprobeDestination)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
