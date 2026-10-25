/**
 * ASR worker 宿主：utilityProcess 生命周期管理 + 请求-响应关联。
 *
 * - 懒启动：首次识别才 fork；空闲超时自杀，下次调用自动重生
 * - 崩溃隔离：worker 异常退出时拒绝所有在途请求（任务失败但应用无恙），
 *   下次识别自动重启 worker
 * - 超时：单请求超 ASR_WORKER_REQUEST_TIMEOUT_MS 视为失败并回收 worker
 *（疑似原生层卡死）
 *
 * fork 经依赖注入（生产传 utilityProcess.fork 的包装），单测用假进程。
 */
import { join } from 'node:path'
import { utilityProcess } from 'electron'
import {
  ASR_WORKER_IDLE_KILL_MS,
  ASR_WORKER_REQUEST_TIMEOUT_MS,
  type AsrWorkerRequest,
  type AsrWorkerResponse,
  type AsrWorkerResult,
} from './asr-protocol'

/** 与 utilityProcess.fork 返回值的最小接口（便于测试注入） */
export interface AsrWorkerProcess {
  postMessage: (message: AsrWorkerRequest) => void
  kill: () => void
  on: (event: 'message' | 'exit', listener: (...args: never[]) => void) => void
}

export type ForkFn = (modulePath: string) => AsrWorkerProcess

interface PendingRequest {
  resolve: (payload: AsrWorkerResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface AsrWorkerHostOptions {
  fork?: ForkFn
  requestTimeoutMs?: number
  idleKillMs?: number
}

export class AsrWorkerHost {
  private readonly forkFn: ForkFn
  private readonly requestTimeoutMs: number
  private readonly idleKillMs: number
  private worker: AsrWorkerProcess | null = null
  private pending = new Map<number, PendingRequest>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null

  constructor(options: AsrWorkerHostOptions = {}) {
    this.forkFn =
      options.fork ??
      ((modulePath: string) =>
        utilityProcess.fork(modulePath) as unknown as AsrWorkerProcess)
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? ASR_WORKER_REQUEST_TIMEOUT_MS
    this.idleKillMs = options.idleKillMs ?? ASR_WORKER_IDLE_KILL_MS
  }

  /** 识别一个 wav 文件；worker 崩溃 / 超时 / 识别失败都以 reject 表达 */
  recognize(request: Omit<AsrWorkerRequest, 'id'>): Promise<AsrWorkerResult> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise<AsrWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        // 超时多半是原生层卡死：回收 worker，下次识别用干净进程
        this.killWorker('识别超时，ASR worker 已回收')
        reject(
          new Error(
            `语音识别超时（${Math.round(this.requestTimeoutMs / 1000)}s）`
          )
        )
      }, this.requestTimeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ ...request, id })
    })
  }

  /** 退出前调用；应用退出时 Electron 也会回收 utilityProcess */
  dispose(): void {
    this.clearIdleTimer()
    if (this.worker) {
      this.worker.kill()
      this.worker = null
    }
    this.rejectAllPending(new Error('ASR worker 已关闭'))
  }

  private ensureWorker(): AsrWorkerProcess {
    if (this.worker) return this.worker
    this.clearIdleTimer()

    const worker = this.forkFn(join(__dirname, 'asr-worker.js'))
    worker.on('message', (...args: never[]) => {
      const event = args[0] as { data: AsrWorkerResponse }
      this.handleMessage(event?.data)
    })
    worker.on('exit', (...args: never[]) => {
      const code = args[0] as number
      // 主动 kill（空闲回收 / 超时回收）也会走到这里，此时 pending 已清
      if (this.worker === worker) {
        this.worker = null
        this.rejectAllPending(
          new Error(
            `ASR worker 进程异常退出（code=${code}）。该任务失败，但不影响应用；重新发起任务会自动重启识别进程`
          )
        )
      }
    })

    this.worker = worker
    return worker
  }

  private handleMessage(response: AsrWorkerResponse): void {
    if (!response || typeof response.id !== 'number') return
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    this.scheduleIdleKill()

    if (response.type === 'result') {
      pending.resolve(response.payload)
    } else {
      pending.reject(new Error(response.message))
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending = new Map()
  }

  private killWorker(reason: string): void {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    this.rejectAllPending(new Error(reason))
    worker.kill()
  }

  private scheduleIdleKill(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      if (this.pending.size === 0) {
        this.worker?.kill()
        this.worker = null
      }
    }, this.idleKillMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}

export const asrWorkerHost = new AsrWorkerHost()
