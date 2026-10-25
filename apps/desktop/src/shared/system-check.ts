export interface SystemDependencyReadiness {
  name: string
  available: boolean
  optional?: boolean
}

/** 可选依赖（yt-dlp 等）缺失不阻断进入工作台。 */
export function areRequiredSystemDependenciesReady(
  dependencies: SystemDependencyReadiness[]
): boolean {
  return dependencies.every(
    dependency => dependency.available || dependency.optional === true
  )
}

export interface SystemCheckProgress {
  stage:
    | 'checking-tools'
    | 'checking-asr'
    | 'downloading'
    | 'extracting'
    | 'done'
    | 'error'
  percent: number
  message: string
}
