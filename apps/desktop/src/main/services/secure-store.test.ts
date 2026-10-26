import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const storage = vi.hoisted(() => ({ userData: '', encrypted: true }))
vi.mock('electron', () => ({
  app: { getPath: () => storage.userData },
  safeStorage: {
    isEncryptionAvailable: () => storage.encrypted,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: vi.fn<(value: Buffer) => string>((value: Buffer) => {
      const text = value.toString()
      if (!text.startsWith('encrypted:')) throw new Error('Not encrypted')
      return text.slice('encrypted:'.length)
    }),
  },
}))

import { safeStorage } from 'electron'
import * as secureStore from './secure-store'

beforeEach(() => {
  storage.userData = mkdtempSync(path.join(tmpdir(), 'video-translate-keys-'))
  storage.encrypted = true
  vi.clearAllMocks()
})
afterEach(() => rmSync(storage.userData, { recursive: true, force: true }))

test('服务密钥独立保存，新服务不回退全局密钥', () => {
  expect(secureStore.setLlmApiKey('legacy-key').success).toBe(true)
  expect(secureStore.getLlmApiKey('new-service')).toBeNull()
  secureStore.setLlmApiKey('service-a-key', 'service-a')
  secureStore.setLlmApiKey('service-b-key', 'service-b')
  expect(secureStore.getLlmApiKey('service-a')).toBe('service-a-key')
  expect(secureStore.getLlmApiKey('service-b')).toBe('service-b-key')
  expect(secureStore.getLlmApiKey()).toBe('legacy-key')
  expect(secureStore.hasLlmApiKey('missing')).toBe(false)
})

test('legacy 服务沿用旧 BYOK 密钥，清除后不会重新回退', () => {
  secureStore.hasLlmApiKey()
  writeFileSync(
    path.join(storage.userData, 'secure', 'byok-api-key.enc'),
    'old-key'
  )
  expect(secureStore.getLlmApiKey('legacy')).toBe('old-key')
  secureStore.setLlmApiKey('new-legacy-key', 'legacy')
  expect(secureStore.getLlmApiKey()).toBe('new-legacy-key')
  secureStore.clearLlmApiKey('legacy')
  expect(secureStore.getLlmApiKey()).toBeNull()
  expect(secureStore.getLlmApiKey('legacy')).toBeNull()
})

test('清除单个服务和空值保存不影响其他服务，重置清除全部密钥', () => {
  secureStore.setLlmApiKey('legacy-key')
  secureStore.setLlmApiKey('service-a-key', 'a')
  secureStore.setLlmApiKey('service-b-key', 'b')
  secureStore.clearLlmApiKey('a')
  expect(secureStore.getLlmApiKey('a')).toBeNull()
  expect(secureStore.getLlmApiKey('b')).toBe('service-b-key')
  expect(secureStore.getLlmApiKey()).toBe('legacy-key')
  secureStore.setLlmApiKey('  ', 'b')
  expect(secureStore.getLlmApiKey('b')).toBeNull()
  secureStore.setLlmApiKey('service-b-key', 'b')
  expect(secureStore.clearAllLlmApiKeys().success).toBe(true)
  expect(secureStore.getLlmApiKey()).toBeNull()
  expect(secureStore.getLlmApiKey('b')).toBeNull()
})

test('任意服务 ID 始终映射到 secure 目录中的确定性安全文件名', () => {
  const id = '../../outside/服务'
  secureStore.setLlmApiKey('private-key', id)
  expect(secureStore.getLlmApiKey(id)).toBe('private-key')
  const files = readdirSync(path.join(storage.userData, 'secure'))
  expect(files).toHaveLength(1)
  expect(files[0]).toMatch(/^llm-api-key-[a-f0-9]{64}\.enc$/)
  expect(
    readFileSync(path.join(storage.userData, 'secure', files[0]), 'utf8')
  ).toBe('encrypted:private-key')
})

test('服务状态查询只检查文件，不触发系统钥匙串解密', () => {
  secureStore.setLlmApiKey('legacy-key')
  secureStore.setLlmApiKey('service-key', 'service')
  expect(secureStore.hasLlmApiKey('service')).toBe(true)
  expect(secureStore.hasLlmApiKey('missing')).toBe(false)
  expect(secureStore.hasLlmApiKey('legacy')).toBe(true)
  expect(safeStorage.decryptString).not.toHaveBeenCalled()
})

test('系统不支持加密时仍按服务隔离和清除凭证', () => {
  storage.encrypted = false
  secureStore.setLlmApiKey('local-key', 'local')
  expect(secureStore.getLlmApiKey('local')).toBe('local-key')
  expect(secureStore.getLlmApiKey('other')).toBeNull()
  secureStore.clearAllLlmApiKeys()
  expect(secureStore.hasLlmApiKey('local')).toBe(false)
})
