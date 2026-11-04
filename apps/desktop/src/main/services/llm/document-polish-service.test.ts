import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  polishDocumentToMarkdown,
  splitRawTextForDocumentPolish,
  stripOuterMarkdownFence,
} from './document-polish-service'

test('splitRawTextForDocumentPolish 短文不分块', () => {
  const chunks = splitRawTextForDocumentPolish('你好世界', 100)
  assert.deepEqual(chunks, ['你好世界'])
})

test('splitRawTextForDocumentPolish 长文按段切分', () => {
  const parts = Array.from({ length: 20 }, (_, i) => `段落${i}内容较多一些。`)
  const raw = parts.join('\n\n')
  const chunks = splitRawTextForDocumentPolish(raw, 40)
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join('').replace(/\s/g, ''), raw.replace(/\s/g, ''))
})

test('stripOuterMarkdownFence 去掉外层围栏', () => {
  assert.equal(
    stripOuterMarkdownFence('```markdown\n# 标题\n\n正文\n```'),
    '# 标题\n\n正文'
  )
  assert.equal(stripOuterMarkdownFence('# 直接正文'), '# 直接正文')
})

test('polishDocumentToMarkdown 调用模型并补标题', async () => {
  const md = await polishDocumentToMarkdown('这是一段识别原文没有结构', {
    title: '演示视频',
    sourceLanguage: 'zh',
    durationSeconds: 120,
    config: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'x',
      model: 'test',
    },
    client: {
      async complete() {
        return '## 开场\n\n这是整理后的段落。'
      },
    },
  })

  assert.match(md, /^# 演示视频/m)
  assert.match(md, /## 开场/)
  assert.match(md, /这是整理后的段落/)
})

test('polishDocumentToMarkdown 失败重试时恢复已保存的前块', async () => {
  const saved = new Map<number, string>()
  let requests = 0
  const baseOptions = {
    title: '演示视频',
    sourceLanguage: 'zh',
    maxChunkChars: 8,
    config: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'x',
      model: 'test',
    },
    loadPart: async ({ index, input }: { index: number; input: string }) =>
      saved.has(index) && input ? saved.get(index) : undefined,
    savePart: async ({ index, output }: { index: number; output: string }) => {
      saved.set(index, output)
    },
  }
  const failingClient = {
    async complete() {
      requests++
      if (requests === 2) throw new Error('temporary failure')
      return '前块'
    },
  }

  await assert.rejects(() =>
    polishDocumentToMarkdown('第一段内容很长。\n\n第二段内容很长。', {
      ...baseOptions,
      client: failingClient,
    })
  )
  assert.equal(requests, 2)

  const result = await polishDocumentToMarkdown(
    '第一段内容很长。\n\n第二段内容很长。',
    {
      ...baseOptions,
      client: {
        async complete() {
          requests++
          return '后块'
        },
      },
    }
  )
  assert.match(result, /前块/)
  assert.match(result, /后块/)
  assert.equal(requests, 3)
})

test('polishDocumentToMarkdown 空文失败', async () => {
  await assert.rejects(
    () =>
      polishDocumentToMarkdown('   ', {
        title: 'x',
        sourceLanguage: 'zh',
        config: {
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKey: 'x',
          model: 'test',
        },
        client: {
          async complete() {
            return 'ok'
          },
        },
      }),
    /原文为空/
  )
})
