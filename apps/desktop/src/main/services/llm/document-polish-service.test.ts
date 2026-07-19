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
