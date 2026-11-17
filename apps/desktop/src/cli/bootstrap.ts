import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  configureAppPaths,
  defaultCliUserDataDir,
  defaultUserDataDir,
} from '../main/runtime/app-paths'
import { ensureGuiCommandPath } from '../main/utils/command-path'
import { launchedFromPackagedApp } from './packaged-app'

export function bootstrapCliRuntime(options?: {
  userData?: string
  shareDesktop?: boolean
}): string {
  const shareDesktop = options?.shareDesktop || launchedFromPackagedApp()
  const userData = path.resolve(
    options?.userData ||
      process.env.VIDEO_TRANSLATE_USER_DATA?.trim() ||
      (shareDesktop ? defaultUserDataDir() : defaultCliUserDataDir())
  )
  mkdirSync(userData, { recursive: true })
  configureAppPaths({
    userData,
    logs: path.join(userData, 'logs'),
    isPackaged: launchedFromPackagedApp(),
  })
  ensureGuiCommandPath()
  return userData
}
