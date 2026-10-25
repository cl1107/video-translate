import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { AsrWorkerHost, type AsrWorkerProcess } from './asr-worker-host'
import type { AsrWorkerRequest, AsrWorkerResponse } from './asr-protocol'

/** 假 worker：记录 postMessage，测试用例手动注入响应 / 模拟退出 */
class FakeWorker implements AsrWorkerProcess {
  sent: AsrWorkerRequest[] = []
  private messageListeners: Array<
    (event: { data: AsrWorkerResponse }) => void
  > = []
  private exitListeners: Array<(code: number) => void> = []
  killed = false

  postMessage(message: AsrWorkerRequest): void {
    this.sent.push(message)
  }

  kill(): void {
    this.killed = true
  }

  on(event: 'message' | 'exit', listener: (...args: never[]) => void): void {
    if (event === 'message') {
      this.messageListeners.push(
        listener as (e: { data: AsrWorkerResponse }) => void
      )
    } else {
      this.exitListeners.push(listener as (code: number) => void)
    }
  }

  emitMessage(response: AsrWorkerResponse): void {
    for (const listener of this.messageListeners) listener({ data: response })
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code)
  }
}

function setup(options?: { requestTimeoutMs?: number; idleKillMs?: number }) {
  const worker = new FakeWorker()
  const host = new AsrWorkerHost({
    fork: () => worker,
    idleKillMs: options?.idleKillMs ?? 60_000,
    requestTimeoutMs: options?.requestTimeoutMs ?? 5_000,
  })
  return { worker, host }
}

const REQUEST = {
  type: 'recognize' as const,
  wavePath: '/tmp/a.wav',
  engine: 'sensevoice' as const,
  language: 'auto',
  numThreads: 4,
  provider: 'cpu',
}

describe('AsrWorkerHost', () => {
  test('请求-响应按 id 关联并返回识别结果', async () => {
    const { worker, host } = setup()
    const promise = host.recognize(REQUEST)
    const sent = worker.sent[0]
    assert.ok(sent)
    worker.emitMessage({
      id: sent.id,
      type: 'result',
      payload: { text: '你好', lang: 'zh' },
    })
    const result = await promise
    assert.equal(result.text, '你好')
    host.dispose()
  })

  test('worker 返回 error 时 reject', async () => {
    const { worker, host } = setup()
    const promise = host.recognize(REQUEST)
    worker.emitMessage({
      id: worker.sent[0]!.id,
      type: 'error',
      message: 'SenseVoice 模型未找到',
    })
    await assert.rejects(promise, /模型未找到/)
    host.dispose()
  })

  test('worker 崩溃时拒绝在途请求，下次调用自动重启', async () => {
    const workers: FakeWorker[] = []
    let count = 0
    const host = new AsrWorkerHost({
      fork: () => {
        const w = new FakeWorker()
        workers.push(w)
        count += 1
        return w
      },
    })

    const promise = host.recognize(REQUEST)
    workers[0]!.emitExit(139)
    await assert.rejects(promise, /异常退出/)

    // 下一次调用 fork 出新 worker
    const second = host.recognize(REQUEST)
    assert.equal(count, 2)
    workers[1]!.emitMessage({
      id: workers[1]!.sent[0]!.id,
      type: 'result',
      payload: { text: 'ok' },
    })
    await second
    host.dispose()
  })

  test('请求超时回收 worker 并 reject', async () => {
    const { worker, host } = setup({ requestTimeoutMs: 30 })
    const promise = host.recognize(REQUEST)
    await assert.rejects(promise, /超时/)
    assert.equal(worker.killed, true)
    host.dispose()
  })

  test('dispose 后拒绝后续在途请求', async () => {
    const { worker, host } = setup()
    const promise = host.recognize(REQUEST)
    host.dispose()
    assert.equal(worker.killed, true)
    await assert.rejects(promise, /已关闭/)
  })
})
