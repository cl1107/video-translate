import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

const BYOK_KEY_FILE = 'byok-api-key.enc'

function storeDir(): string {
  const dir = path.join(app.getPath('userData'), 'secure')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function keyFilePath(): string {
  return path.join(storeDir(), BYOK_KEY_FILE)
}

/**
 * 使用 Electron safeStorage 加密保存 BYOK API Key。
 * 不可用时回退为明文文件（仍不写日志）；调用方勿 echo 返回值。
 */
export function setByokApiKey(apiKey: string): { success: boolean; error?: string } {
  try {
    const trimmed = (apiKey ?? '').trim()
    if (!trimmed) {
      clearByokApiKey()
      return { success: true }
    }

    const file = keyFilePath()
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(trimmed)
      writeFileSync(file, encrypted)
    } else {
      // 极端环境无 OS keychain 时仍落盘，权限依赖 userData 目录
      writeFileSync(file, Buffer.from(trimmed, 'utf8'))
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

/**
 * 读取 BYOK API Key；不存在或解密失败时返回 null。
 * 切勿把返回值写入任务日志或 console。
 */
export function getByokApiKey(): string | null {
  try {
    const file = keyFilePath()
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
  } catch {
    return null
  }
}

export function clearByokApiKey(): { success: boolean; error?: string } {
  try {
    const file = keyFilePath()
    if (existsSync(file)) {
      writeFileSync(file, Buffer.alloc(0))
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

export function hasByokApiKey(): boolean {
  return Boolean(getByokApiKey())
}
