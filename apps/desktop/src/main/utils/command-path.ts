import { constants, accessSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOMEBREW_MEDIA_COMMANDS = new Set(['ffmpeg', 'ffprobe'])
const BUNDLED_MEDIA_COMMANDS = new Set(['ffmpeg', 'ffprobe'])

let pathAugmented = false

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 返回打包后随应用分发的 FFmpeg/FFprobe 路径。
 *
 * electron-builder 会把平台对应的二进制放到 resources/ffmpeg。开发环境和
 * 精简包中该目录不存在，因此自然回退到系统 PATH。
 */
export function resolveBundledMediaCommandPath(
  command: string,
  resourcesPath = process.resourcesPath,
  platform = process.platform
): string | undefined {
  if (
    !resourcesPath ||
    !BUNDLED_MEDIA_COMMANDS.has(command) ||
    !['win32', 'darwin', 'linux'].includes(platform)
  ) {
    return undefined
  }

  const executable = platform === 'win32' ? `${command}.exe` : command
  const candidate = path.join(resourcesPath, 'ffmpeg', executable)
  return isExecutable(candidate) ? candidate : undefined
}

function findInPath(
  command: string,
  pathValue = process.env.PATH
): string | undefined {
  if (!pathValue) return undefined

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue

    const candidate = path.join(directory, command)
    if (isExecutable(candidate)) return candidate
  }

  return undefined
}

function getHomebrewPrefixes(): string[] {
  const prefixes: string[] = []
  const configuredPrefix = process.env.HOMEBREW_PREFIX
  if (configuredPrefix) prefixes.push(configuredPrefix)

  prefixes.push('/opt/homebrew', '/usr/local')
  return [...new Set(prefixes)]
}

function getHomeDirectory(): string {
  return os.homedir()
}

/**
 * 图形应用启动时 PATH 往往只有 /usr/bin:/bin，不包含 Homebrew / 用户本地安装目录。
 * 这里返回应补充进 process.env.PATH 的常见可执行目录。
 */
export function getCommonBinaryDirectories(): string[] {
  const home = getHomeDirectory()
  const directories: string[] = []

  for (const prefix of getHomebrewPrefixes()) {
    directories.push(path.join(prefix, 'bin'))
    directories.push(path.join(prefix, 'sbin'))
  }

  directories.push(
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    // 常见 Node 版本管理器默认 shim
    path.join(home, '.volta', 'bin'),
    path.join(home, '.fnm', 'current', 'bin'),
    path.join(home, '.nvm', 'current', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.deno', 'bin'),
    path.join(home, 'Library', 'pnpm')
  )

  // Ollama macOS App 内置 CLI
  if (process.platform === 'darwin') {
    directories.push('/Applications/Ollama.app/Contents/Resources')
  }

  return [...new Set(directories.filter(dir => existsSync(dir)))]
}

/**
 * 为打包后的 Electron GUI 进程补齐常见命令搜索路径。
 * 应在 app ready 后尽早调用一次。
 */
export function ensureGuiCommandPath(): string {
  if (pathAugmented) {
    return process.env.PATH || ''
  }

  const current = process.env.PATH || ''
  const currentParts = new Set(current.split(path.delimiter).filter(Boolean))
  const extras = getCommonBinaryDirectories().filter(
    dir => !currentParts.has(dir)
  )

  if (extras.length > 0) {
    process.env.PATH = [...extras, current].filter(Boolean).join(path.delimiter)
  }

  pathAugmented = true
  return process.env.PATH || ''
}

/**
 * 解析系统命令路径。macOS 图形应用不会读取 shell 配置，因此额外检查
 * Homebrew 目录、常见用户 bin，以及 Ollama App 内置二进制。
 */
export function resolveCommandPath(command: string): string {
  if (path.isAbsolute(command)) return command

  // 内置版本优先，保证硬字幕烧录始终使用含 libass 的完整构建。
  const bundledCommand = resolveBundledMediaCommandPath(command)
  if (bundledCommand) return bundledCommand

  const pathCommand = findInPath(command)
  if (pathCommand) return pathCommand

  // 即使 PATH 尚未增强，也主动扫描常见目录
  for (const directory of getCommonBinaryDirectories()) {
    const candidate = path.join(directory, command)
    if (isExecutable(candidate)) return candidate
  }

  if (process.platform === 'darwin' && HOMEBREW_MEDIA_COMMANDS.has(command)) {
    for (const prefix of getHomebrewPrefixes()) {
      for (const formula of ['ffmpeg-full', 'ffmpeg']) {
        const candidate = path.join(prefix, 'opt', formula, 'bin', command)
        if (isExecutable(candidate)) return candidate
      }
    }
  }

  // Ollama 官方 macOS 安装路径
  if (command === 'ollama' && process.platform === 'darwin') {
    const appBinary = '/Applications/Ollama.app/Contents/Resources/ollama'
    if (isExecutable(appBinary)) return appBinary
  }

  // 保留原命令，让 child_process 返回明确的 ENOENT 或权限错误。
  return command
}

/** 测试辅助：重置 PATH 增强状态 */
export function resetGuiCommandPathStateForTests(): void {
  pathAugmented = false
}
