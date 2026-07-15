import assert from 'node:assert/strict'
import { test } from 'vitest'
import { OllamaClient, type OllamaGenerateRequest } from './client'

test('找不到 Ollama 可执行文件时启动守护进程返回失败而不抛出未捕获异常', async () => {
  const client = new OllamaClient(
    'http://127.0.0.1:1',
    `video-translate-missing-ollama-${process.pid}`
  )

  assert.equal(await client.startDaemon(), false)
})

test('translateBatch 在任一段翻译失败时报告段落位置并终止', async () => {
  const client = new OllamaClient()
  client.translate = async text => {
    if (text === 'second') throw new Error('model unavailable')
    return `translated:${text}`
  }

  await assert.rejects(
    client.translateBatch(['first', 'second', 'third'], 'en', 'zh'),
    /segment 2\/3.*model unavailable/
  )
})

test('translateBatch 每次只提交当前段避免翻译串段', async () => {
  const prompts: string[] = []
  const client = new OllamaClient()
  client.generate = async (request: OllamaGenerateRequest) => {
    prompts.push(request.prompt)
    return '译文'
  }

  const translated = await client.translateBatch(
    ['opening', 'current', 'ending'],
    'en',
    'zh'
  )

  assert.deepEqual(translated, ['译文', '译文', '译文'])
  assert.match(prompts[1], /待翻译原文：\ncurrent/)
  assert.doesNotMatch(prompts[1], /opening/)
  assert.doesNotMatch(prompts[1], /ending/)
})

test('翻译模型返回空文本时明确失败', async () => {
  const client = new OllamaClient()
  client.generate = async () => '   '

  await assert.rejects(client.translate('source', 'en', 'zh'), /翻译结果为空/)
})
