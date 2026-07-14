import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  OllamaClient,
  type OllamaGenerateRequest,
  supportsTranscriptPolish,
} from './client'

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

test('polishTranscriptBatch 在任一段润色失败时报告段落位置并终止', async () => {
  const client = new OllamaClient()
  client.polishTranscript = async text => {
    if (text === 'second') throw new Error('model unavailable')
    return `polished:${text}`
  }

  await assert.rejects(
    client.polishTranscriptBatch(['first', 'second'], 'en'),
    /segment 2\/2.*model unavailable/
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

test('翻译和润色模型返回空文本时明确失败', async () => {
  const client = new OllamaClient()
  client.generate = async () => '   '

  await assert.rejects(client.translate('source', 'en', 'zh'), /翻译结果为空/)
  await assert.rejects(
    client.polishTranscript('source', 'en', 'qwen2.5:7b'),
    /润色结果为空/
  )
})

test('翻译专用 hy-mt 模型不执行识别文本润色', async () => {
  assert.equal(supportsTranscriptPolish('kaelri/hy-mt2:1.8b'), false)
  assert.equal(supportsTranscriptPolish('custom/HY-MT:latest'), false)
  assert.equal(supportsTranscriptPolish('qwen2.5:7b'), true)

  const client = new OllamaClient()
  await assert.rejects(
    client.polishTranscript(
      '時刻は間もなく深夜1時',
      'ja',
      'kaelri/hy-mt2:1.8b'
    ),
    /翻译专用模型.*不支持润色/
  )
})
