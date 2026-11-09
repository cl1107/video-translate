import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultGlobalBinPath,
  defaultPackagedAppPath,
  renderLaunchShim,
  resolvePackagedCliTarget,
  type CliLaunchTarget,
} from './packaged-app'

export interface InstallGlobalResult {
  binPath: string
  source: 'packaged' | 'source'
  appPath?: string
}

export function resolveSourceLauncher(
  fromDir = path.dirname(fileURLToPath(import.meta.url))
): string {
  const candidates = [
    path.join(fromDir, 'bin.mjs'),
    path.resolve(fromDir, '../../src/cli/bin.mjs'),
  ]
  const found = candidates.find(file => existsSync(file))
  if (!found) {
    throw new Error('找不到源码 CLI 入口 src/cli/bin.mjs')
  }
  return found
}

export function resolveSourceNodeBin(explicit?: string): string {
  if (explicit) return explicit
  if (process.env.ELECTRON_RUN_AS_NODE) {
    return process.env.npm_node_execpath?.trim() || 'node'
  }
  return process.execPath
}

export function resolveCliLaunchTarget(options?: {
  appPath?: string
  nodeBin?: string
}): CliLaunchTarget {
  const packaged = resolvePackagedCliTarget(
    options?.appPath || defaultPackagedAppPath()
  )
  if (packaged) return packaged
  return {
    kind: 'source',
    nodeBin: resolveSourceNodeBin(options?.nodeBin),
    launcher: resolveSourceLauncher(),
  }
}

export function installGlobalCli(options?: {
  appPath?: string
  binPath?: string
  nodeBin?: string
}): InstallGlobalResult {
  const target = resolveCliLaunchTarget(options)
  const binPath = options?.binPath || defaultGlobalBinPath()
  mkdirSync(path.dirname(binPath), { recursive: true })
  writeFileSync(binPath, renderLaunchShim(target), { encoding: 'utf8' })
  chmodSync(binPath, 0o755)
  return {
    binPath,
    source: target.kind,
    ...(target.kind === 'packaged' ? { appPath: target.appPath } : {}),
  }
}
