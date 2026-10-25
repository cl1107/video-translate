/**
 * ASR worker 执行体（utilityProcess 入口）。
 *
 * 只做一件事：加载 sherpa-onnx 模型并对单个 wav 文件识别。
 * 把原生推理隔离在独立进程，原生层 OOM / 段错误只死 worker，
 * 主进程（UI 与任务编排）不受影响——这是从 BaoCut model-worker 学到的实践。
 *
 * 协议见 asr-protocol.ts。worker 内的 decode 是同步阻塞调用，没关系：
 * 阻塞的是 worker 自己，任务队列本来就是串行的。
 */
import type { AsrEngineId } from '../../../shared/constants'
import { resolveFunAsrNanoPaths, resolveSenseVoicePaths } from './model-paths'
import type {
  AsrWorkerRequest,
  AsrWorkerResponse,
  AsrWorkerResult,
} from './asr-protocol'

// sherpa-onnx-node 无完整 TS 类型
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sherpaOnnx = require('sherpa-onnx-node')

type OfflineRecognizer = {
  createStream: () => OfflineStream
  decode: (stream: unknown) => void
  getResult: (stream: unknown) => AsrWorkerResult
}

interface OfflineStream {
  acceptWaveform: (wave: { sampleRate: number; samples: Float32Array }) => void
}

const recognizers = new Map<string, OfflineRecognizer>()

function getRecognizer(
  engine: AsrEngineId,
  language: string,
  numThreads: number,
  provider: string
): OfflineRecognizer {
  const key = `${engine}:${language}`
  const cached = recognizers.get(key)
  if (cached) return cached

  let recognizer: OfflineRecognizer
  if (engine === 'funasr-nano') {
    const paths = resolveFunAsrNanoPaths()
    if (!paths) {
      throw new Error('Fun-ASR-Nano 模型未找到（models/asr/ 目录）')
    }
    recognizer = new sherpaOnnx.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        funasrNano: {
          encoderAdaptor: paths.encoderAdaptor,
          llm: paths.llm,
          embedding: paths.embedding,
          tokenizer: paths.tokenizer,
        },
        tokens: '',
        numThreads,
        provider,
        debug: 0,
      },
    }) as OfflineRecognizer
  } else {
    const paths = resolveSenseVoicePaths()
    if (!paths) {
      throw new Error('SenseVoice 模型未找到（models/asr/ 目录）')
    }
    recognizer = new sherpaOnnx.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: {
          model: paths.model,
          language,
          useInverseTextNormalization: 1,
        },
        tokens: paths.tokens,
        numThreads,
        provider,
        debug: 0,
      },
    }) as OfflineRecognizer
  }

  recognizers.set(key, recognizer)
  return recognizer
}

/**
 * Electron 禁用了 N-API external buffer：readWave 关闭 external buffer 后，
 * 再拷贝到全新 ArrayBuffer，彻底避免 external / SharedArrayBuffer。
 */
function toOwnedFloat32(
  samples: Float32Array | ArrayLike<number>
): Float32Array {
  const length =
    typeof (samples as Float32Array).length === 'number'
      ? (samples as Float32Array).length
      : Array.from(samples as ArrayLike<number>).length

  const ab = new ArrayBuffer(length * 4)
  const copy = new Float32Array(ab)
  if (samples instanceof Float32Array) {
    for (let i = 0; i < length; i++) {
      copy[i] = samples[i]
    }
  } else {
    for (let i = 0; i < length; i++) {
      copy[i] = Number((samples as ArrayLike<number>)[i] ?? 0)
    }
  }
  return copy
}

function recognize(request: AsrWorkerRequest): AsrWorkerResult {
  const recognizer = getRecognizer(
    request.engine,
    request.language,
    request.numThreads,
    request.provider
  )
  // enableExternalBuffer=false：关键 Electron 下 "External buffers are not allowed"
  const wave = sherpaOnnx.readWave(request.wavePath, false)
  const samples = toOwnedFloat32(wave.samples)
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: wave.sampleRate, samples })
  recognizer.decode(stream)
  return recognizer.getResult(stream)
}

const parentPort = (
  process as unknown as {
    parentPort: {
      on: (
        event: 'message',
        listener: (event: { data: unknown }) => void
      ) => void
      postMessage: (message: AsrWorkerResponse) => void
    }
  }
).parentPort

parentPort.on('message', event => {
  const request = event.data as AsrWorkerRequest
  if (!request || request.type !== 'recognize') return

  try {
    const payload = recognize(request)
    parentPort.postMessage({ id: request.id, type: 'result', payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    parentPort.postMessage({ id: request.id, type: 'error', message })
  }
})
