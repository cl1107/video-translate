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
 * Electron GUI 默认 utilityProcess；CLI / ELECTRON_RUN_AS_NODE 走 child_process.fork。
 */
import { existsSync } from 'node:fs'
import { fork as forkChildProcess } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { getAsrModelsRoot } from './model-paths'
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
  stderr?: {
    on: (event: 'data', listener: (chunk: Buffer | string) => void) => void
  } | null
}

export type ForkFn = (modulePath: string) => AsrWorkerProcess

export function asrWorkerForkEnv(
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath = process.resourcesPath
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }
  try {
    next.VIDEO_TRANSLATE_ASR_MODELS = getAsrModelsRoot()
  } catch {
    // 模型根目录解析失败时仍启动 worker，识别阶段会给出明确错误
  }
  if (resourcesPath) {
    const unpacked = join(resourcesPath, 'app.asar.unpacked', 'node_modules')
    if (existsSync(unpacked)) {
      next.NODE_PATH = [unpacked, env.NODE_PATH].filter(Boolean).join(delimiter)
    }
  }
  return next
}

export function resolveAsrWorkerModule(baseDir = __dirname): string {
  // 多入口构建会把宿主提取到 main/chunks；worker 入口始终输出在 main。
  // 源码直跑（tsx）则使用宿主同级的 TypeScript 入口。
  const candidates = [
    join(baseDir, 'asr-worker.js'),
    join(baseDir, '..', 'asr-worker.js'),
    join(baseDir, 'asr-worker.ts'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `未找到 ASR worker 脚本（已检查候选路径: ${candidates.join(', ')}）`
  )
}

function forkNodeAsrWorker(modulePath: string): AsrWorkerProcess {
  const child = forkChildProcess(modulePath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    execArgv: modulePath.endsWith('.ts') ? process.execArgv : [],
    env: asrWorkerForkEnv(),
  })
  return {
    stderr: child.stderr ?? undefined,
    postMessage: message => {
      child.send(message)
    },
    kill: () => {
      child.kill()
    },
    on: (event, listener) => {
      if (event === 'message') {
        child.on('message', data => {
          ;(listener as (message: AsrWorkerResponse) => void)(
            data as AsrWorkerResponse
          )
        })
        return
      }
      child.on('exit', code => {
        ;(listener as (code: number) => void)(code ?? 0)
      })
    },
  }
}

function forkUtilityProcess(modulePath: string): AsrWorkerProcess {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { utilityProcess } = require('electron') as typeof import('electron')
  return utilityProcess.fork(modulePath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'video-translate-asr',
    env: asrWorkerForkEnv(),
  }) as unknown as AsrWorkerProcess
}

function shouldUseUtilityProcess(): boolean {
  if (process.env.ELECTRON_RUN_AS_NODE) return false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron') | string
    if (!electron || typeof electron === 'string') return false
    return typeof electron.utilityProcess?.fork === 'function'
  } catch {
    return false
  }
}

function defaultFork(modulePath: string): AsrWorkerProcess {
  return shouldUseUtilityProcess()
    ? forkUtilityProcess(modulePath)
    : forkNodeAsrWorker(modulePath)
}

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
  private lastStderr = ''

  constructor(options: AsrWorkerHostOptions = {}) {
    this.forkFn = options.fork ?? defaultFork
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

    const worker = this.forkFn(resolveAsrWorkerModule())
    this.lastStderr = ''
    worker.stderr?.on('data', chunk => {
      this.lastStderr = `${this.lastStderr}${String(chunk)}`.slice(-4000)
    })
    worker.on('message', (...args: never[]) => {
      // UtilityProcess 的 message 参数就是响应；只有 worker 侧 parentPort 使用 event.data。
      this.handleMessage(args[0] as AsrWorkerResponse)
    })
    worker.on('exit', (...args: never[]) => {
      const code = args[0] as number
      // 主动 kill（空闲回收 / 超时回收）也会走到这里，此时 pending 已清
      if (this.worker === worker) {
        this.worker = null
        const stderr = this.lastStderr.trim().replace(/\s+/g, ' ')
        this.rejectAllPending(
          new Error(
            stderr
              ? `ASR worker 进程异常退出（code=${code}）：${stderr.slice(0, 500)}`
              : `ASR worker 进程异常退出（code=${code}）。该任务失败，但不影响应用；重新发起任务会自动重启识别进程`
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
