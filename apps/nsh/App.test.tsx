import { expect, open, test } from 'nsh/test'
import { Workspace } from 'video-translate/native'

const fixture = new URL('./tests/fixtures/sample.srt', import.meta.url).pathname

async function start(sync = true) {
  const dir = Workspace.configureTest(sync)
  const app = await open('.', { width: 1200, height: 800, platform: 'macos' })
  return { app, dir }
}

test('shows the workbench', async () => {
  const { app } = await start()
  expect(app.texts()).toContain('视频翻译助手')
  expect(app.texts()).toContain('字幕')
  expect(app.texts()).toContain('添加')
  expect(app.texts()).toContain('仅提取原文')
})

test('import srt from the path field', async () => {
  const { app } = await start()
  await app.waitFor('视频翻译助手')
  await app.type('text:本地文件、字幕或视频链接', fixture)
  await app.press('开始')
  await app.waitFor('text:/已完成/', { timeout: 8000 })
})

test('reuse transcript from a completed task', async () => {
  const { app } = await start()
  await app.waitFor('视频翻译助手')
  await app.type('text:本地文件、字幕或视频链接', fixture)
  await app.press('开始')
  await app.waitUntil(() => app.shows('text:/已完成/'), { timeout: 8000 })
  if (!app.shows('复用到字幕')) {
    await app.press('text:/^任务/')
  }
  await app.waitUntil(() => app.shows('复用到字幕'), { timeout: 8000 })
  await app.press('复用到字幕')
  await app.waitUntil(() => app.shows('已复用识别结果创建字幕任务'), {
    timeout: 8000,
  })
  await app.waitUntil(() => app.count('text:已完成') === 2, { timeout: 8000 })
  await app.press('复用到文稿')
  await app.waitFor('已复用识别结果创建文稿任务')
  await app.waitFor('text:已完成')
}, 20000)

test('asynchronous import survives page switch and exports', async () => {
  const { app } = await start(false)
  await app.waitFor('视频翻译助手')
  await app.type('text:本地文件、字幕或视频链接', fixture)
  await app.press('开始')
  await app.press('设置')
  await app.press('返回工作区')
  await app.press('text:/^任务/')
  await app.waitUntil(() => app.shows('text:/已完成/'), { timeout: 10000 })
  await app.press('校对工作台')
  await app.waitUntil(() => app.shows('应用时间'), { timeout: 8000 })
  await app.press('保存并重新导出')
  await app.waitUntil(() => app.shows('已重新导出字幕'), { timeout: 8000 })
}, 20000)

test('model services keep separate credentials', async () => {
  const { app } = await start()
  await app.waitFor('视频翻译助手')
  await app.press('设置')
  await app.press('模型')
  await app.waitFor('添加模型服务')
  await app.type('text:可选；本地推理可留空', 'test-key-one')
  await app.press('添加模型服务')
  await app.type('text:可选；本地推理可留空', 'test-key-two')
  await app.press('默认服务')
  expect(app.value('label:API Key（仅存本机，文件权限 600）')).toBe(
    'test-key-one'
  )
  await app.press('服务 2')
  expect(app.value('label:API Key（仅存本机，文件权限 600）')).toBe(
    'test-key-two'
  )
  const reopened = new Workspace()
  expect(reopened.snapshot()).toMatchObject({ api_key: 'test-key-two' })
  reopened.selectService('legacy')
  expect(reopened.snapshot()).toMatchObject({ api_key: 'test-key-one' })
  reopened.dispose()
})

test('can delete an extra model service', async () => {
  const { app } = await start()
  await app.waitFor('视频翻译助手')
  await app.press('设置')
  await app.press('模型')
  await app.waitFor('添加模型服务')
  expect(app.enabled('删除当前服务')).toBe(false)
  await app.press('添加模型服务')
  await app.waitFor('服务 2')
  await app.type('text:可选；本地推理可留空', 'delete-this-key')
  app.onDialog(() => '取消')
  await app.press('删除当前服务')
  expect(app.shows('服务 2')).toBe(true)
  expect(app.value('label:API Key（仅存本机，文件权限 600）')).toBe(
    'delete-this-key'
  )
  app.onDialog(() => '删除')
  await app.press('删除当前服务')
  await app.waitFor('服务 2', { state: 'gone' })
  expect(app.enabled('删除当前服务')).toBe(false)
  expect(app.value('label:API Key（仅存本机，文件权限 600）')).toBe('')
  const reopened = new Workspace()
  expect(reopened.snapshot()).toMatchObject({
    settings: {
      selected_llm_service_id: 'legacy',
      llm_services: [{ id: 'legacy' }],
    },
    api_key: '',
  })
  reopened.dispose()
})
