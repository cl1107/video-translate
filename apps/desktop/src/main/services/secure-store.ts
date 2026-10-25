import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

const LLM_KEY_FILE = 'llm-api-key.enc'
/** v0.8.x 及以前的旧文件名；读取回退用，新写入一律走 LLM_KEY_FILE */
const LEGACY_BYOK_KEY_FILE = 'byok-api-key.enc'

function storeDir(): string {
  const dir = path.join(app.getPath('userData'), 'secure')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function keyFilePath(): string {
  return path.join(storeDir(), LLM_KEY_FILE)
}

function legacyKeyFilePath(): string {
  return path.join(storeDir(), LEGACY_BYOK_KEY_FILE)
}

function writeKeyFile(file: string, value: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(file, safeStorage.encryptString(value))
  } else {
    // 极端环境无 OS keychain 时仍落盘，权限依赖 userData 目录
    writeFileSync(file, Buffer.from(value, 'utf8'))
  }
}

function readKeyFile(file: string): string | null {
  if (!existsSync(file)) return null
  const buf = readFileSync(file)
  if (buf.length === 0) return null

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const text = safeStorage.decryptString(buf)
      return text.trim() || null
    } catch {
      // 可能是旧明文回退格式
      const text = buf.toString('utf8').trim()
      return text || null
    }
  }

  const text = buf.toString('utf8').trim()
  return text || null
}

/**
 * 使用 Electron safeStorage 加密保存模型服务 API Key。
 * 不可用时回退为明文文件（仍不写日志）；调用方勿 echo 返回值。
 */
export function setLlmApiKey(apiKey: string): {
  success: boolean
  error?: string
} {
  try {
    const trimmed = (apiKey ?? '').trim()
    if (!trimmed) {
      clearLlmApiKey()
      return { success: true }
    }
    writeKeyFile(keyFilePath(), trimmed)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

/**
 * 读取模型服务 API Key；新文件缺失时回退旧 BYOK 文件（v0.8.x 迁移），
 * 下次保存即写入新文件。切勿把返回值写入任务日志或 console。
 */
export function getLlmApiKey(): string | null {
  try {
    const current = readKeyFile(keyFilePath())
    if (current) return current
    return readKeyFile(legacyKeyFilePath())
  } catch {
    return null
  }
}

export function clearLlmApiKey(): { success: boolean; error?: string } {
  try {
    for (const file of [keyFilePath(), legacyKeyFilePath()]) {
      if (existsSync(file)) {
        writeFileSync(file, Buffer.alloc(0))
      }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

export function hasLlmApiKey(): boolean {
  return Boolean(getLlmApiKey())
}
