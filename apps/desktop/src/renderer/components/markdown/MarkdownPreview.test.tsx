import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { test } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

test('MarkdownPreview 渲染标题与 GFM 表格', () => {
  const source = `# 文稿标题

一段说明。

| 列A | 列B |
| --- | --- |
| 1 | 2 |
`

  const html = renderToStaticMarkup(<MarkdownPreview source={source} />)

  assert.match(html, /data-slot="markdown-preview"/)
  assert.match(html, /文稿标题/)
  assert.match(html, /一段说明/)
  assert.match(html, /<table/)
  assert.match(html, /列A/)
})

test('MarkdownPreview 空源使用默认占位', () => {
  const html = renderToStaticMarkup(<MarkdownPreview source="   " />)
  assert.match(html, /暂无内容/)
})

test('MarkdownPreview 支持自定义空占位', () => {
  const html = renderToStaticMarkup(
    <MarkdownPreview source="" emptyFallback={<span>自定义空</span>} />
  )
  assert.match(html, /自定义空/)
  assert.doesNotMatch(html, /暂无内容/)
})

test('MarkdownPreview 渲染任务列表与删除线（GFM）', () => {
  const source = `- [x] 完成项
- [ ] 未完成

~~删除~~ 与 **强调**
`
  const html = renderToStaticMarkup(<MarkdownPreview source={source} />)
  assert.match(html, /type="checkbox"/)
  assert.match(html, /完成项/)
  assert.match(html, /<del>/)
})
