import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'vitest'
import {
  AsrWorkerHost,
  asrWorkerForkEnv,
  resolveAsrWorkerModule,
  type AsrWorkerProcess,
} from './asr-worker-host'
import type { AsrWorkerRequest, AsrWorkerResponse } from './asr-protocol'

/** 假 worker：记录 postMessage，测试用例手动注入响应 / 模拟退出 */
class FakeWorker implements AsrWorkerProcess {
  sent: AsrWorkerRequest[] = []
  private messageListeners: Array<(message: AsrWorkerResponse) => void> = []
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
        listener as (message: AsrWorkerResponse) => void
      )
    } else {
      this.exitListeners.push(listener as (code: number) => void)
    }
  }

  emitMessage(response: AsrWorkerResponse): void {
    for (const listener of this.messageListeners) listener(response)
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
  test('utilityProcess 直接传递的 message 应立即完成请求，不等待超时', async () => {
    const { worker, host } = setup({ requestTimeoutMs: 40 })
    try {
      const promise = host.recognize(REQUEST)
      const sent = worker.sent[0]
      assert.ok(sent)
      worker.emitMessage({
        id: sent.id,
        type: 'result',
        payload: { text: '识别完成' },
      })
      assert.equal((await promise).text, '识别完成')
    } finally {
      host.dispose()
    }
  })

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

  test('packaged unpacked node_modules 写入 worker NODE_PATH', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'asr-fork-env-'))
    const unpacked = path.join(root, 'app.asar.unpacked', 'node_modules')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(path.join(unpacked, '.keep'), '')
    const env = asrWorkerForkEnv(
      { PATH: '/usr/bin', NODE_PATH: '/custom' },
      root
    )
    assert.ok(env.NODE_PATH?.startsWith(unpacked))
    assert.ok(env.NODE_PATH?.includes('/custom'))
    assert.ok(env.VIDEO_TRANSLATE_ASR_MODELS)
  })

  test('worker 崩溃时附带 stderr', async () => {
    class CrashWorker implements AsrWorkerProcess {
      sent: AsrWorkerRequest[] = []
      private exitListeners: Array<(code: number) => void> = []
      stderr = {
        on: (event: 'data', listener: (chunk: Buffer | string) => void) => {
          if (event === 'data') {
            setTimeout(() => listener('Cannot find module sherpa-onnx-node'), 0)
          }
        },
      }
      postMessage(message: AsrWorkerRequest): void {
        this.sent.push(message)
      }
      kill(): void {}
      on(
        event: 'message' | 'exit',
        listener: (...args: never[]) => void
      ): void {
        if (event === 'exit')
          this.exitListeners.push(listener as (code: number) => void)
      }
      crash(): void {
        for (const listener of this.exitListeners) listener(1)
      }
    }
    const worker = new CrashWorker()
    const host = new AsrWorkerHost({ fork: () => worker })
    const promise = host.recognize(REQUEST)
    await new Promise(resolve => setTimeout(resolve, 10))
    worker.crash()
    await assert.rejects(promise, /sherpa-onnx-node/)
    host.dispose()
  })

  test('dispose 后拒绝后续在途请求', async () => {
    const { worker, host } = setup()
    const promise = host.recognize(REQUEST)
    host.dispose()
    assert.equal(worker.killed, true)
    await assert.rejects(promise, /已关闭/)
  })

  describe('resolveAsrWorkerModule', () => {
    test('当处于 chunks 子目录时能正确解析父目录下的 asr-worker.js', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const chunksDir = path.join(root, 'main', 'chunks')
      mkdirSync(chunksDir, { recursive: true })
      const workerJs = path.join(root, 'main', 'asr-worker.js')
      writeFileSync(workerJs, '// mock worker')

      const resolved = resolveAsrWorkerModule(chunksDir)
      assert.equal(resolved, workerJs)
    })

    test('当同级目录下存在 asr-worker.js 时优先使用', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const mainDir = path.join(root, 'main')
      mkdirSync(mainDir, { recursive: true })
      const workerJs = path.join(mainDir, 'asr-worker.js')
      writeFileSync(workerJs, '// mock worker')

      const resolved = resolveAsrWorkerModule(mainDir)
      assert.equal(resolved, workerJs)
    })

    test('chunks 中有同名 ts 文件时仍使用 main 下已编译的入口', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const chunksDir = path.join(root, 'main', 'chunks')
      mkdirSync(chunksDir, { recursive: true })
      const workerJs = path.join(root, 'main', 'asr-worker.js')
      writeFileSync(workerJs, '// compiled worker')
      writeFileSync(path.join(chunksDir, 'asr-worker.ts'), '// source worker')

      assert.equal(resolveAsrWorkerModule(chunksDir), workerJs)
    })

    test('产物缺失时不从更上级目录寻找其他版本的 worker', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const chunksDir = path.join(root, 'main', 'chunks')
      mkdirSync(chunksDir, { recursive: true })
      writeFileSync(path.join(root, 'asr-worker.js'), '// unrelated worker')
      writeFileSync(
        path.join(root, 'main', 'asr-worker.ts'),
        '// unrelated source'
      )

      assert.throws(
        () => resolveAsrWorkerModule(chunksDir),
        /未找到 ASR worker 脚本/
      )
    })

    test('当只有源码 asr-worker.ts 时回退使用 ts 脚本', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const srcDir = path.join(root, 'src', 'asr')
      mkdirSync(srcDir, { recursive: true })
      const workerTs = path.join(srcDir, 'asr-worker.ts')
      writeFileSync(workerTs, '// mock ts')

      const resolved = resolveAsrWorkerModule(srcDir)
      assert.equal(resolved, workerTs)
    })

    test('所有候选均不存在时抛出明确包含候选路径的错误', () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'asr-worker-resolve-'))
      const emptyDir = path.join(root, 'empty', 'deep')
      mkdirSync(emptyDir, { recursive: true })

      assert.throws(
        () => resolveAsrWorkerModule(emptyDir),
        /未找到 ASR worker 脚本/
      )
    })
  })
})
