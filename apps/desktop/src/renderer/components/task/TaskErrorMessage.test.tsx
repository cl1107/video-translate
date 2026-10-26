import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { test, vi } from 'vitest'
import {
  TaskStatus,
  type TaskKind,
  type TranslationTask,
} from 'shared/types/video'

vi.stubGlobal('window', { App: {} })
const { TaskList } = await import('./TaskList')
const { DocumentTaskList } = await import('./DocumentTaskList')

const errorMessage =
  '音频提取失败\nFFmpeg: No audio stream\n' + '完整诊断内容 '.repeat(500)

function failedTask(kind: TaskKind, error = errorMessage): TranslationTask {
  return {
    id: `${kind}-failed`,
    kind,
    videoFile: {
      id: 'source',
      name: 'source.mp4',
      path: '/source.mp4',
      size: 1024,
      duration: 60,
      format: 'mp4',
      createdAt: '2026-10-26 10:00:00',
    },
    status: TaskStatus.FAILED,
    progress: 0,
    sourceLanguage: 'auto',
    targetLanguage: 'zh',
    segments: [],
    subtitles: [],
    logs: [],
    errorMessage: error,
    createdAt: '2026-10-26 10:00:00',
    updatedAt: '2026-10-26 10:01:00',
  }
}

test.each(['subtitle', 'document'] satisfies TaskKind[])(
  '%s 任务完整错误可手动选择并保留换行',
  kind => {
    const task = failedTask(kind)
    const html = renderToStaticMarkup(
      kind === 'subtitle' ? (
        <TaskList tasks={[task]} onTasksChange={() => {}} />
      ) : (
        <DocumentTaskList tasks={[task]} onTasksChange={() => {}} />
      )
    )
    const errorParagraph = html.match(
      /<p\b[^>]*>音频提取失败[\s\S]*?<\/p>/
    )?.[0]
    assert.ok(errorParagraph, '错误详情必须完整渲染')
    assert.ok(
      errorParagraph.includes('select-text'),
      '错误文字必须覆盖全局禁止选择规则'
    )
    assert.ok(
      errorParagraph.includes('whitespace-pre-wrap'),
      '错误换行必须可见'
    )
    assert.ok(errorParagraph.includes(errorMessage), '长错误内容不能截断')
    assert.ok(html.includes('复制错误'), '错误详情必须提供明确复制操作')
  }
)

test.each(['subtitle', 'document'] satisfies TaskKind[])(
  '%s 缺少音轨时只显示素材修复建议',
  kind => {
    const message =
      '源文件没有音轨，无法提取语音。请使用包含音轨的视频或音频文件；若视频与音频分开下载，请先合并后重试。'
    const task = failedTask(kind, message)
    const html = renderToStaticMarkup(
      kind === 'subtitle' ? (
        <TaskList tasks={[task]} onTasksChange={() => {}} />
      ) : (
        <DocumentTaskList tasks={[task]} onTasksChange={() => {}} />
      )
    )
    assert.ok(html.includes(message))
    assert.ok(!html.includes('可点「重试」'))
    assert.ok(!html.includes('模型服务 检查'))
  }
)
