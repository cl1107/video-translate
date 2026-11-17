import assert from 'node:assert/strict'
import { test } from 'vitest'
import { parseArgv } from './parse'

test('无参数时显示 help', () => {
  const parsed = parseArgv([])
  assert.equal(parsed.command, 'help')
})

test('文件路径默认走 subtitle', () => {
  const parsed = parseArgv(['./talk.mp4', '--target-lang', 'zh', '--json'])
  assert.equal(parsed.command, 'subtitle')
  assert.deepEqual(parsed.positionals, ['./talk.mp4'])
  assert.equal(parsed.flags['target-lang'], 'zh')
  assert.equal(parsed.json, true)
})

test('URL 默认走 subtitle', () => {
  const parsed = parseArgv(['https://www.bilibili.com/video/BV1'])
  assert.equal(parsed.command, 'subtitle')
  assert.equal(parsed.positionals[0]?.startsWith('https://'), true)
})

test('task 子命令与位置参数', () => {
  const parsed = parseArgv(['task', 'get', 'abc', '--full'])
  assert.equal(parsed.command, 'task')
  assert.equal(parsed.subcommand, 'get')
  assert.deepEqual(parsed.positionals, ['abc'])
  assert.equal(parsed.flags.full, true)
})

test('别名 doc → document', () => {
  const parsed = parseArgv(['doc', 'a.mp4', '--detach'])
  assert.equal(parsed.command, 'document')
  assert.equal(parsed.flags.detach, true)
})

test('等号形式选项', () => {
  const parsed = parseArgv(['extract', 'a.mp4', '--asr=funasr-nano'])
  assert.equal(parsed.flags.asr, 'funasr-nano')
})

test('--user-data 抽出', () => {
  const parsed = parseArgv(['--user-data', '/tmp/vt', 'stats'])
  assert.equal(parsed.userData, '/tmp/vt')
  assert.equal(parsed.command, 'stats')
})

test('install 解析 bin / app / share-desktop', () => {
  const parsed = parseArgv([
    'install',
    '--bin',
    '/tmp/vt',
    '--app',
    '/Applications/视频翻译助手.app',
    '--share-desktop',
    '--json',
  ])
  assert.equal(parsed.command, 'install')
  assert.equal(parsed.flags.bin, '/tmp/vt')
  assert.equal(parsed.flags.app, '/Applications/视频翻译助手.app')
  assert.equal(parsed.flags['share-desktop'], true)
  assert.equal(parsed.json, true)
})
