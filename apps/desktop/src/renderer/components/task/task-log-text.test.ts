import assert from 'node:assert/strict'
import { test } from 'vitest'
import { formatTaskLogsForCopy } from './task-log-text'

test('导出保留每条日志完整时间、级别、多行消息及诊断详情', () => {
  const details =
    'ffmpeg diagnostic\n  mapped stream\n' + '完整堆栈 '.repeat(1000)
  const text = formatTaskLogsForCopy([
    {
      id: '1',
      timestamp: '2026-10-26 15:00:01',
      level: 'info',
      message: '开始处理\n准备音频',
    },
    {
      id: '2',
      timestamp: '2026-10-26T15:00:02.123Z',
      level: 'error',
      message: '提取失败',
      details,
    },
    {
      id: '3',
      timestamp: '2026-10-26 15:00:03',
      level: 'warn',
      message: '警告',
      details: '',
    },
    {
      id: '4',
      timestamp: '2026-10-26 15:00:04',
      level: 'success',
      message: '完成',
    },
  ])
  assert.equal(
    text,
    `[2026-10-26 15:00:01] [info] 开始处理\n准备音频\n\n[2026-10-26T15:00:02.123Z] [error] 提取失败\n${details}\n\n[2026-10-26 15:00:03] [warn] 警告\n\n[2026-10-26 15:00:04] [success] 完成`
  )
})

test('没有日志时导出空文本', () => {
  assert.equal(formatTaskLogsForCopy([]), '')
})
