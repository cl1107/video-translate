import { spawn } from 'node:child_process'
import { ensureSenseVoiceModel } from '../services/asr/model-downloader'
import { sherpaTranscriber } from '../services/asr/sherpa-transcriber'
import { ensureGuiCommandPath, resolveCommandPath } from './command-path'
import { writeSystemCheckDiagnostic } from './system-logger'
import type { SystemCheckProgress } from '../../shared/system-check'

export type { SystemCheckProgress } from '../../shared/system-check'

export interface SystemCheckResult {
  name: string
  available: boolean
  version?: string
  error?: string
  /** 实际解析到的可执行文件路径（诊断用） */
  resolvedPath?: string
}

/**
 * 检查命令是否可用
 */
function checkCommand(
  command: string,
  args: string[] = ['-version']
): Promise<SystemCheckResult> {
  return new Promise(resolve => {
    const resolved = resolveCommandPath(command)
    const child = spawn(resolved, args)
    let output = ''
    let error = ''
    let settled = false

    const finish = (result: SystemCheckResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        ...result,
        resolvedPath: resolved !== command ? resolved : result.resolvedPath,
      })
    }

    child.stdout.on('data', data => {
      output += data.toString()
    })

    child.stderr.on('data', data => {
      error += data.toString()
    })

    child.on('error', err => {
      finish({
        name: command,
        available: false,
        error: err.message,
        resolvedPath: resolved,
      })
    })

    child.on('close', code => {
      if (code === 0) {
        const versionMatch =
          (output + error).match(/version\s+(\d+\.\d+\.\d+)/i) ||
          (output + error).match(/(\d+\.\d+\.\d+)/)

        finish({
          name: command,
          available: true,
          version: versionMatch ? versionMatch[1] : 'unknown',
          resolvedPath: resolved,
        })
      } else {
        finish({
          name: command,
          available: false,
          error: `Command failed with code ${code}`,
          resolvedPath: resolved,
        })
      }
    })

    const timeout = setTimeout(() => {
      child.kill()
      finish({
        name: command,
        available: false,
        error: 'Command timeout',
        resolvedPath: resolved,
      })
    }, 5000)
  })
}

/**
 * Electron 自带 Node 运行时，打包后无需系统 Node。
 * 开发与生产统一报告 process.versions.node。
 */
function checkElectronNode(): SystemCheckResult {
  const version = process.versions.node
  return {
    name: 'node',
    available: true,
    version,
    resolvedPath: process.execPath,
  }
}

/**
 * 检查 Ollama：优先 CLI，失败时回退 HTTP API（用户可能只开了 App）。
 */
async function checkOllama(): Promise<SystemCheckResult> {
  const cliResult = await checkCommand('ollama', ['--version'])
  if (cliResult.available) {
    return cliResult
  }

  // CLI 不在 PATH 时，尝试探测本地服务是否已在运行
  try {
    const { ollamaClient } = await import('../services/ollama/client')
    const running = await ollamaClient.isRunning()
    if (running) {
      return {
        name: 'ollama',
        available: true,
        version: 'service',
        resolvedPath: 'http://127.0.0.1:11434',
      }
    }
  } catch {
    // ignore and fall through
  }

  return {
    name: 'ollama',
    available: false,
    error: cliResult.error || 'spawn ollama ENOENT',
    resolvedPath: cliResult.resolvedPath,
  }
}

/**
 * 检查 sherpa-onnx ASR；若默认 SenseVoice 缺失则自动下载。
 */
async function checkSherpaAsr(
  autoDownload = true,
  onProgress?: (progress: SystemCheckProgress) => void
): Promise<SystemCheckResult> {
  try {
    // 先确认原生模块能加载
    try {
      require.resolve('sherpa-onnx-node')
    } catch {
      return {
        name: 'sherpa-onnx-asr',
        available: false,
        error: '未安装 sherpa-onnx-node 依赖，请执行 pnpm install',
      }
    }

    let senseOk = await sherpaTranscriber.isAvailable('sensevoice')
    if (!senseOk && autoDownload) {
      const result = await ensureSenseVoiceModel(progress => {
        if (progress.stage === 'downloading') {
          onProgress?.({
            stage: 'downloading',
            percent: progress.percent ?? 0,
            message: progress.message,
          })
        } else if (progress.stage === 'extracting') {
          onProgress?.({
            stage: 'extracting',
            percent: 95,
            message: progress.message,
          })
        } else if (progress.stage === 'error') {
          onProgress?.({
            stage: 'error',
            percent: 95,
            message: progress.message,
          })
        }
      })
      senseOk = result.available
      if (!senseOk) {
        return {
          name: 'sherpa-onnx-asr',
          available: false,
          error: result.error || 'SenseVoice 模型自动下载失败',
        }
      }
    }

    const nanoOk = await sherpaTranscriber.isAvailable('funasr-nano')
    if (senseOk || nanoOk) {
      return {
        name: 'sherpa-onnx-asr',
        available: true,
        version: senseOk ? 'sensevoice' : 'funasr-nano',
      }
    }

    return {
      name: 'sherpa-onnx-asr',
      available: false,
      error: 'SenseVoice / Fun-ASR-Nano 模型未就绪',
    }
  } catch (error) {
    return {
      name: 'sherpa-onnx-asr',
      available: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 检查所有系统依赖
 * @param options.autoDownloadAsr 默认 true，缺失 SenseVoice 时自动下载
 * @param options.writeLog 默认 true，写入 system-check 诊断日志
 */
export async function checkSystemDependencies(options?: {
  autoDownloadAsr?: boolean
  writeLog?: boolean
  onProgress?: (progress: SystemCheckProgress) => void
}): Promise<SystemCheckResult[]> {
  const autoDownloadAsr = options?.autoDownloadAsr ?? true
  const writeLog = options?.writeLog ?? true
  const onProgress = options?.onProgress

  // 打包 GUI 进程 PATH 极短，先补齐常见二进制目录
  const augmentedPath = ensureGuiCommandPath()

  // ASR 可能触发下载，单独串行，避免和其他检查抢带宽时误报
  onProgress?.({
    stage: 'checking-tools',
    percent: 10,
    message: '正在检查 FFmpeg、Node.js 和 Ollama...',
  })
  const [ffmpeg, ffprobe, ollama] = await Promise.all([
    checkCommand('ffmpeg'),
    checkCommand('ffprobe'),
    checkOllama(),
  ])
  const node = checkElectronNode()

  onProgress?.({
    stage: 'checking-asr',
    percent: 30,
    message: '正在检查 SenseVoice 模型...',
  })
  const asr = await checkSherpaAsr(autoDownloadAsr, onProgress)
  const results = [ffmpeg, ffprobe, node, ollama, asr]

  if (writeLog) {
    writeSystemCheckDiagnostic({
      path: augmentedPath,
      results,
      extra: {
        execPath: process.execPath,
      },
    })
  }

  onProgress?.({
    stage: 'done',
    percent: 100,
    message: '系统依赖检查完成',
  })

  return results
}

/**
 * 生成安装建议
 */
export function getInstallationSuggestions(
  results: SystemCheckResult[]
): string[] {
  const suggestions: string[] = []

  for (const result of results) {
    if (!result.available) {
      switch (result.name) {
        case 'sherpa-onnx-asr':
          suggestions.push(
            'ASR 模型未就绪：应用会在检查时自动下载 SenseVoice。' +
              '若仍失败，请检查网络后点击「重新检查」。' +
              (result.error ? `\n详情: ${result.error}` : '')
          )
          break
        case 'ffmpeg':
        case 'ffprobe':
          suggestions.push(
            '安装 FFmpeg:\n' +
              '- macOS: brew install ffmpeg\n' +
              '  （若需烧录硬字幕，请安装完整版: brew install ffmpeg-full）\n' +
              '- Ubuntu/Debian: sudo apt install ffmpeg libass9\n' +
              '- Windows: 从 https://ffmpeg.org/download.html 下载完整构建并添加到 PATH'
          )
          break
        case 'ollama':
          suggestions.push(
            '安装 Ollama:\n' +
              '- 访问 https://ollama.ai 下载并安装\n' +
              '- macOS 也可: brew install ollama\n' +
              '- 安装后运行: ollama serve\n' +
              '- 或打开 Ollama App，确保菜单栏图标显示已启动'
          )
          break
        case 'node':
          suggestions.push(
            'Node.js 运行时异常：\n' +
              '- 应用内置 Electron Node，通常无需单独安装系统 Node\n' +
              '- 若仍报错，请重新安装应用或反馈诊断日志'
          )
          break
      }
    }
  }

  return [...new Set(suggestions)]
}
