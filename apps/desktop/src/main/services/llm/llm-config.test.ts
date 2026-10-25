import assert from 'node:assert/strict'
import { afterEach, test } from 'vitest'
import { listEndpointModels } from './llm-config'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function stubFetch(
  payload: unknown,
  ok = true,
  status = 200
): { calls: () => number } {
  const state = { calls: 0 }
  globalThis.fetch = (async () => {
    state.calls += 1
    return {
      ok,
      status,
      json: async () => payload,
    } as Response
  }) as typeof fetch
  return { calls: () => state.calls }
}

test('listEndpointModels 解析 OpenAI 兼容 /models 并排序去重', async () => {
  const stub = stubFetch({
    data: [{ id: 'qwen3:4b' }, { id: 'auto' }, { id: 'qwen3:4b' }, {}],
  })
  const result = await listEndpointModels('http://127.0.0.1:11434')
  assert.equal(stub.calls(), 1)
  assert.equal(result.ok, true)
  assert.deepEqual(result.models, ['auto', 'qwen3:4b'])
})

test('listEndpointModels 对 HTTP 错误 / 异常载荷给出中文原因', async () => {
  stubFetch({}, false, 401)
  const unauthorized = await listEndpointModels(
    'https://api.example.com',
    'sk-x'
  )
  assert.equal(unauthorized.ok, false)
  assert.match(unauthorized.error ?? '', /401/)

  stubFetch({ unexpected: true })
  const malformed = await listEndpointModels('http://127.0.0.1:11434')
  assert.equal(malformed.ok, false)
  assert.match(malformed.error ?? '', /响应格式异常/)

  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED')
  }) as typeof fetch
  const refused = await listEndpointModels('http://127.0.0.1:1')
  assert.equal(refused.ok, false)
  assert.match(refused.error ?? '', /ECONNREFUSED/)
})
