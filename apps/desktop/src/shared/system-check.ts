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
