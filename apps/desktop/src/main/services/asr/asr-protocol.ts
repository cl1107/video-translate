/**
 * ASR worker 与主进程之间的消息协议。
 * worker 通过 utilityProcess.fork 运行（electron.vite main 多入口 `asr-worker`），
 * 只做单文件识别；分段、进度编排与 DB 均留在主进程。
 */
import type { AsrEngineId } from '../../../shared/constants'

/** 主进程 → worker */
export type AsrWorkerRequest = {
  id: number
  type: 'recognize'
  /** 16kHz wav 文件路径（ffmpeg 分段产物，worker 只读） */
  wavePath: string
  engine: AsrEngineId
  /** SenseVoice 的语言码（auto/zh/en/ja/ko/yue）；Fun-ASR-Nano 忽略 */
  language: string
  numThreads: number
  provider: string
}

/** worker → 主进程 */
export type AsrWorkerResponse =
  | { id: number; type: 'result'; payload: AsrWorkerResult }
  | { id: number; type: 'error'; message: string }

/** 与主进程旧 OfflineRecognizer.getResult 的形状一致 */
export interface AsrWorkerResult {
  text?: string
  tokens?: string[]
  timestamps?: number[]
  lang?: string
}

export const ASR_WORKER_IDLE_KILL_MS = 10 * 60 * 1000
/** 模型加载发生在首个 recognize 请求里，给足冷启动时间 */
export const ASR_WORKER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
