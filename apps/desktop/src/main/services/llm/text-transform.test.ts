import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { TextCompletionPort } from './completion-port'
import { cleanModelText } from './completion-port'
import {
  type TranslateSegmentIssue,
  translateTextBatch,
} from './text-transform'

test('cleanModelText 翻译与润色分支', () => {
  assert.equal(cleanModelText('译文：你好', 'translation'), '你好')
  assert.equal(cleanModelText('润色结果：修好了', 'polish'), '修好了')
})

test('cleanModelText 仅回显标签时视为空', () => {
  assert.equal(
    cleanModelText('源语言：英语\n\n目标语言：中文', 'translation'),
    ''
  )
  assert.equal(cleanModelText('译文：', 'translation'), '')
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

test('translateTextBatch 服务错误重试耗尽后报告位置并终止', async () => {
  let n = 0
  const issues: TranslateSegmentIssue[] = []
  const client: TextCompletionPort = {
    complete: async () => {
      n += 1
      // 第 1 段成功；第 2 段两次均失败（maxAttempts=2）
      if (n === 1) return 'ok'
      throw new Error('boom')
    },
  }

  await assert.rejects(
    translateTextBatch(['a', 'b', 'c'], {
      sourceLanguage: 'en',
      targetLanguage: 'zh',
      client,
      maxAttempts: 2,
      onSegmentIssue: issue => issues.push(issue),
    }),
    /segment 2\/3.*boom/
  )
  assert.equal(n, 3) // 1 成功 + 第 2 段 2 次
  assert.equal(issues.at(-1)?.action, 'error')
  assert.equal(issues.at(-1)?.index, 2)
})

test('translateTextBatch 空结果重试成功后继续', async () => {
  let n = 0
  const client: TextCompletionPort = {
    complete: async () => {
      n += 1
      if (n === 1) return '   '
      return '译文A'
    },
  }

  const translated = await translateTextBatch(['hello'], {
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    client,
    maxAttempts: 2,
  })

  assert.deepEqual(translated, ['译文A'])
  assert.equal(n, 2)
})

test('translateTextBatch 空结果重试后回退原文且不中断批次', async () => {
  const issues: TranslateSegmentIssue[] = []
  let n = 0
  const client: TextCompletionPort = {
    complete: async () => {
      n += 1
      if (n <= 2) return '源语言：英语\n目标语言：中文'
      return '第三段译文'
    },
  }

  const translated = await translateTextBatch(['// TODO: fix', 'third'], {
    sourceLanguage: 'en',
    targetLanguage: 'zh',
    client,
    maxAttempts: 2,
    onSegmentIssue: issue => issues.push(issue),
  })

  assert.deepEqual(translated, ['// TODO: fix', '第三段译文'])
  assert.ok(issues.some(i => i.action === 'retry'))
  assert.ok(issues.some(i => i.action === 'fallback' && i.index === 1))
  assert.equal(issues.filter(i => i.action === 'fallback').length, 1)
})
