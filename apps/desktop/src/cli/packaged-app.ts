import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP_USER_DATA_NAME } from '../main/runtime/app-paths'

export const PACKAGED_APP_NAME = `${APP_USER_DATA_NAME}.app`
export const PACKAGED_EXECUTABLE_NAME = APP_USER_DATA_NAME
export const CLI_BOOTSTRAP_NAME = 'cli-bootstrap.cjs'

export interface PackagedCliTarget {
  kind: 'packaged'
  appPath: string
  electronBin: string
  bootstrap: string
}

export interface SourceCliTarget {
  kind: 'source'
  nodeBin: string
  launcher: string
}

export type CliLaunchTarget = PackagedCliTarget | SourceCliTarget

export function defaultPackagedAppPath(): string {
  return path.join('/Applications', PACKAGED_APP_NAME)
}

export function defaultGlobalBinPath(): string {
  return path.join(os.homedir(), '.local', 'bin', 'vt')
}

export function resolvePackagedCliTarget(
  appPath = defaultPackagedAppPath()
): PackagedCliTarget | null {
  const electronBin = path.join(
    appPath,
    'Contents',
    'MacOS',
    PACKAGED_EXECUTABLE_NAME
  )
  const bootstrap = path.join(
    appPath,
    'Contents',
    'Resources',
    CLI_BOOTSTRAP_NAME
  )
  if (!existsSync(electronBin) || !existsSync(bootstrap)) return null
  return {
    kind: 'packaged',
    appPath: path.resolve(appPath),
    electronBin,
    bootstrap,
  }
}

export function launchedFromPackagedApp(): boolean {
  const resources = process.resourcesPath
  return Boolean(
    process.env.ELECTRON_RUN_AS_NODE &&
    resources &&
    (resources.includes(`${path.sep}Contents${path.sep}Resources`) ||
      resources.endsWith(`${path.sep}resources`))
  )
}

export function renderLaunchShim(target: CliLaunchTarget): string {
  if (target.kind === 'packaged') {
    return `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
exec "${target.electronBin}" "${target.bootstrap}" "$@"
`
  }
  return `#!/bin/sh
exec "${target.nodeBin}" "${target.launcher}" "$@"
`
}
