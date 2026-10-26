import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import { LEGACY_LLM_SERVICE_ID } from '../../shared/settings'

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

function usesLegacyKey(serviceId?: string): boolean {
  return serviceId === undefined || serviceId === LEGACY_LLM_SERVICE_ID
}

function keyFilePath(serviceId?: string): string {
  const file =
    serviceId === undefined || serviceId === LEGACY_LLM_SERVICE_ID
      ? LLM_KEY_FILE
      : `llm-api-key-${createHash('sha256').update(serviceId).digest('hex')}.enc`
  return path.join(storeDir(), file)
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
export function setLlmApiKey(
  apiKey: string,
  serviceId?: string
): {
  success: boolean
  error?: string
} {
  try {
    const trimmed = (apiKey ?? '').trim()
    if (!trimmed) {
      return clearLlmApiKey(serviceId)
    }
    writeKeyFile(keyFilePath(serviceId), trimmed)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}

/**
 * 按服务读取 API Key；仅旧任务和 legacy 服务允许回退旧 BYOK 文件。
 * 切勿把返回值写入任务日志或 console。
 */
export function getLlmApiKey(serviceId?: string): string | null {
  try {
    const current = readKeyFile(keyFilePath(serviceId))
    if (current) return current
    return usesLegacyKey(serviceId) ? readKeyFile(legacyKeyFilePath()) : null
  } catch {
    return null
  }
}

export function clearLlmApiKey(serviceId?: string): {
  success: boolean
  error?: string
} {
  try {
    const files = [keyFilePath(serviceId)]
    if (usesLegacyKey(serviceId)) files.push(legacyKeyFilePath())
    for (const file of files) {
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

/** 仅查询是否已保存凭据，不解密或访问系统钥匙串；可用性由实际读取时确认。 */
export function hasLlmApiKey(serviceId?: string): boolean {
  const files = [keyFilePath(serviceId)]
  if (usesLegacyKey(serviceId)) files.push(legacyKeyFilePath())
  return files.some(file => {
    if (!existsSync(file)) return false
    const stat = statSync(file)
    return stat.isFile() && stat.size > 0
  })
}

/** 恢复默认设置时清除全部模型服务的凭证，包括旧版本文件。 */
export function clearAllLlmApiKeys(): { success: boolean; error?: string } {
  try {
    const dir = storeDir()
    for (const file of readdirSync(dir)) {
      if (
        file === LLM_KEY_FILE ||
        file === LEGACY_BYOK_KEY_FILE ||
        /^llm-api-key-[a-f0-9]{64}\.enc$/.test(file)
      ) {
        writeFileSync(path.join(dir, file), Buffer.alloc(0))
      }
    }
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: message }
  }
}
