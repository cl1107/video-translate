export interface SystemDependencyReadiness {
  name: string
  available: boolean
  optional?: boolean
}

/** Ollama 仅用于翻译，不阻止用户进入工作台执行原文提取。 */
export function areRequiredSystemDependenciesReady(
  dependencies: SystemDependencyReadiness[]
): boolean {
  return dependencies.every(
    dependency =>
      dependency.available ||
      dependency.optional === true ||
      dependency.name === 'ollama'
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
