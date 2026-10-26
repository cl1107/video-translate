import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  userData: '',
  isEncryptionAvailable: vi.fn<() => boolean>(() => true),
  decryptString: vi.fn<(value: Buffer) => string>(() => 'test-api-key'),
  encryptString: vi.fn<(value: string) => Buffer>(() =>
    Buffer.from('encrypted-test-key')
  ),
}))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  safeStorage: electron,
}))

import {
  clearLlmApiKey,
  getLlmApiKey,
  hasLlmApiKey,
  setLlmApiKey,
} from './secure-store'

beforeEach(() => {
  electron.userData = mkdtempSync(
    path.join(tmpdir(), 'secure-store-status-test-')
  )
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(electron.userData, { recursive: true, force: true })
})

test.each([
  {
    name: '没有凭据',
    current: undefined,
    legacy: undefined,
    configured: false,
  },
  {
    name: '当前凭据已保存',
    current: 'ciphertext',
    legacy: undefined,
    configured: true,
  },
  {
    name: '旧版凭据已保存',
    current: undefined,
    legacy: 'ciphertext',
    configured: true,
  },
  { name: '凭据已清空', current: '', legacy: '', configured: false },
  {
    name: '当前凭据为空时检查旧版',
    current: '',
    legacy: 'ciphertext',
    configured: true,
  },
])('查询配置状态不访问钥匙串：$name', ({ current, legacy, configured }) => {
  const dir = path.join(electron.userData, 'secure')
  mkdirSync(dir)
  if (current !== undefined)
    writeFileSync(path.join(dir, 'llm-api-key.enc'), current)
  if (legacy !== undefined)
    writeFileSync(path.join(dir, 'byok-api-key.enc'), legacy)

  expect(hasLlmApiKey()).toBe(configured)
  expect(electron.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(electron.decryptString).not.toHaveBeenCalled()
  expect(electron.encryptString).not.toHaveBeenCalled()
})

test('清除当前和旧版凭据后，状态为未配置且不访问钥匙串', () => {
  const dir = path.join(electron.userData, 'secure')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'llm-api-key.enc'), 'ciphertext')
  writeFileSync(path.join(dir, 'byok-api-key.enc'), 'legacy-ciphertext')

  expect(clearLlmApiKey()).toEqual({ success: true })
  expect(hasLlmApiKey()).toBe(false)
  expect(electron.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(electron.decryptString).not.toHaveBeenCalled()
})

test('实际读取凭据时仍执行解密', () => {
  const dir = path.join(electron.userData, 'secure')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'llm-api-key.enc'), 'ciphertext')

  expect(getLlmApiKey()).toBe('test-api-key')
  expect(electron.decryptString).toHaveBeenCalledWith(Buffer.from('ciphertext'))
})

test('查询单个服务状态不访问钥匙串，也不回退其他服务的凭据', () => {
  expect(setLlmApiKey('global-key')).toEqual({ success: true })
  expect(setLlmApiKey('service-key', 'service-a')).toEqual({ success: true })
  vi.clearAllMocks()

  expect(hasLlmApiKey('service-a')).toBe(true)
  expect(hasLlmApiKey('service-b')).toBe(false)
  expect(clearLlmApiKey('service-a')).toEqual({ success: true })
  expect(hasLlmApiKey('service-a')).toBe(false)
  expect(hasLlmApiKey()).toBe(true)
  expect(electron.isEncryptionAvailable).not.toHaveBeenCalled()
  expect(electron.decryptString).not.toHaveBeenCalled()
  expect(electron.encryptString).not.toHaveBeenCalled()
})
