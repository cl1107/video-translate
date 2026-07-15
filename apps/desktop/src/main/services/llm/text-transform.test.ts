import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { TextCompletionPort } from './completion-port'
import { cleanModelText } from './completion-port'
import { translateTextBatch } from './text-transform'

test('cleanModelText 翻译与润色分支', () => {
  assert.equal(cleanModelText('译文：你好', 'translation'), '你好')
  assert.equal(cleanModelText('润色结果：修好了', 'polish'), '修好了')
})

test('translateTextBatch 支持 AbortSignal', async () => {
  const controller = new AbortController()
  const client: TextCompletionPort = {
    complete: async () => {
      controller.abort()
      return 'x'
    },
  }

  await assert.rejects(
    translateTextBatch(['a', 'b'], {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      client,
      signal: controller.signal,
    }),
    err => err instanceof Error && err.name === 'AbortError'
  )
})

test('translateTextBatch 串段失败报告位置', async () => {
  let n = 0
  const client: TextCompletionPort = {
    complete: async () => {
      n += 1
      if (n === 2) throw new Error('boom')
      return 'ok'
    },
  }

  await assert.rejects(
    translateTextBatch(['a', 'b', 'c'], {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      client,
    }),
    /segment 2\/3/
  )
})
