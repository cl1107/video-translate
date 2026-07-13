import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveCommandPath } from '../../utils/command-path'
import { tempWorkspace } from '../temp-workspace'

/**
 * 视频文件信息接口
 */
export interface VideoInfo {
  /** 视频时长（秒） */
  duration: number
  /** 视频格式 */
  format: string
  /** 视频宽度（像素） */
  width: number
  /** 视频高度（像素） */
  height: number
  /** 帧率（FPS） */
  frameRate: number
  /** 比特率（bps） */
  bitRate: number
  /** 音频编码器 */
  audioCodec: string
  /** 视频编码器 */
  videoCodec: string
}

/**
 * 音频段落信息接口
 */
export interface AudioSegment {
  /** 音频文件路径 */
  path: string
  /** 开始时间（秒） */
  startTime: number
  /** 段落时长（秒） */
  duration: number
}

export function calculateTranslatedSubtitleMargin(videoHeight: number): number {
  if (!Number.isFinite(videoHeight) || videoHeight <= 0) {
    throw new Error(`无效的视频高度: ${videoHeight}`)
  }

  return Math.min(96, Math.max(28, Math.round(videoHeight * 0.04)))
}

export class FFmpegProcessor {
  private ffmpegPath: string
  private ffprobePath: string
  private tempDir: string

  /**
   * FFmpeg处理器构造函数
   * @param ffmpegPath - FFmpeg可执行文件路径（默认：ffmpeg）
   * @param ffprobePath - FFprobe可执行文件路径（默认：ffprobe）
   */
  constructor(
    ffmpegPath = resolveCommandPath('ffmpeg'),
    ffprobePath = resolveCommandPath('ffprobe')
  ) {
    this.ffmpegPath = ffmpegPath
    this.ffprobePath = ffprobePath
    // 默认回落到统一缓存根目录；任务处理时应传入 workDir（tasks/<taskId>）
    this.tempDir = tempWorkspace.rootDir
    void this.ensureDir(this.tempDir)
  }

  /**
   * 确保目录存在且可写
   */
  private async ensureDir(dir: string): Promise<string> {
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.access(dir, fs.constants.W_OK)
      return dir
    } catch (error) {
      console.error('Failed to create or access temp directory:', error)
      console.error(`Temp directory path: ${dir}`)
      throw error
    }
  }

  private async resolveWorkDir(workDir?: string): Promise<string> {
    return this.ensureDir(workDir || this.tempDir)
  }

  /**
   * 检查 FFmpeg 是否可用
   */
  /**
   * 检查FFmpeg是否可用
   * @returns 返回true表示FFmpeg可用，false表示不可用
   */
  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const process = spawn(this.ffmpegPath, ['-version'])

      process.on('error', () => resolve(false))
      process.on('close', code => resolve(code === 0))

      // 超时检查
      setTimeout(() => {
        process.kill()
        resolve(false)
      }, 5000)
    })
  }

  /**
   * 检查 FFprobe 是否可用
   */
  /**
   * 检查FFprobe是否可用
   * @returns 返回true表示FFprobe可用，false表示不可用
   */
  async isFFprobeAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const process = spawn(this.ffprobePath, ['-version'])

      process.on('error', () => resolve(false))
      process.on('close', code => resolve(code === 0))

      // 超时检查
      setTimeout(() => {
        process.kill()
        resolve(false)
      }, 5000)
    })
  }

  /**
   * 获取视频文件信息
   */
  /**
   * 获取视频文件的详细信息
   * @param videoPath - 视频文件路径
   * @returns 返回包含视频详细信息的对象
   * @throws 当FFprobe不可用或视频解析失败时抛出错误
   */
  async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    // 首先检查 ffprobe 是否可用
    const isFFprobeAvailable = await this.isFFprobeAvailable()
    if (!isFFprobeAvailable) {
      throw new Error(
        'FFprobe 不可用。请确保已安装 FFmpeg 并且 ffprobe 命令在系统 PATH 中。\n' +
          '安装方法：\n' +
          '- macOS: brew install ffmpeg\n' +
          '- Ubuntu/Debian: sudo apt install ffmpeg\n' +
          '- Windows: 从 https://ffmpeg.org/download.html 下载并添加到 PATH'
      )
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        videoPath,
        '-hide_banner',
        '-show_format',
        '-show_streams',
        '-select_streams',
        'v:0',
        '-of',
        'json',
      ]

      const process = spawn(this.ffprobePath, args)
      let output = ''
      let error = ''

      process.stdout.on('data', data => {
        output += data.toString()
      })

      process.stderr.on('data', data => {
        error += data.toString()
      })

      process.on('error', err => {
        reject(new Error(`FFprobe 执行失败: ${err.message}`))
      })

      process.on('close', code => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${error}`))
          return
        }

        try {
          const data = JSON.parse(output)
          const videoStream = data.streams.find(
            (s: any) => s.codec_type === 'video'
          )
          const audioStream = data.streams.find(
            (s: any) => s.codec_type === 'audio'
          )

          if (!videoStream) {
            reject(new Error('No video stream found'))
            return
          }

          const info: VideoInfo = {
            duration: Number.parseFloat(data.format.duration) || 0,
            format: data.format.format_name || 'unknown',
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            frameRate: this.parseFrameRate(videoStream.r_frame_rate) || 0,
            bitRate: Number.parseInt(data.format.bit_rate) || 0,
            audioCodec: audioStream?.codec_name || 'none',
            videoCodec: videoStream.codec_name || 'unknown',
          }

          resolve(info)
        } catch (parseError) {
          const message =
            parseError instanceof Error
              ? parseError.message
              : String(parseError)
          reject(new Error(`Failed to parse video info: ${message}`))
        }
      })
    })
  }

  /**
   * 解析帧率字符串（如 "30/1"）为数值
   * @param rFrameRate - FFmpeg返回的帧率字符串
   * @returns 返回帧率的数值
   */
  private parseFrameRate(rFrameRate: string): number {
    if (!rFrameRate || rFrameRate === '0/0') return 0

    const parts = rFrameRate.split('/')
    if (parts.length === 2) {
      const numerator = Number.parseFloat(parts[0])
      const denominator = Number.parseFloat(parts[1])
      return denominator !== 0 ? numerator / denominator : 0
    }

    return Number.parseFloat(rFrameRate) || 0
  }

  /**
   * 获取媒体文件时长（支持音频和视频文件）
   */
  /**
   * 获取媒体文件时长（支持音频和视频文件）
   * @param mediaPath - 媒体文件路径
   * @returns 返回媒体文件时长（秒）
   * @throws 当文件解析失败时抛出错误
   */
  async getMediaDuration(mediaPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        mediaPath,
        '-hide_banner',
        '-show_format',
        '-of',
        'json',
      ]
      const process = spawn(this.ffprobePath, args)
      let output = ''
      let error = ''
      process.stdout.on('data', data => {
        output += data.toString()
      })
      process.stderr.on('data', data => {
        error += data.toString()
      })
      process.on('error', err => {
        reject(new Error(`FFprobe 执行失败: ${err.message}`))
      })
      process.on('close', code => {
        if (code !== 0) {
          reject(new Error(`FFprobe failed: ${error}`))
          return
        }
        try {
          const data = JSON.parse(output)
          const duration = Number.parseFloat(data.format.duration) || 0
          resolve(duration)
        } catch (parseError) {
          const message =
            parseError instanceof Error
              ? parseError.message
              : String(parseError)
          reject(new Error(`Failed to parse media duration: ${message}`))
        }
      })
    })
  }

  /**
   * 提取音频轨道
   */
  /**
   * 从视频文件中提取音频轨道
   * @param videoPath - 视频文件路径
   * @param outputPath - 输出音频文件路径（可选，默认为临时文件）
   * @param onProgress - 进度回调函数（可选）
   * @returns 返回提取的音频文件路径
   * @throws 当音频提取失败时抛出错误
   */
  async extractAudio(
    videoPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void,
    workDir?: string
  ): Promise<string> {
    const dir = await this.resolveWorkDir(workDir)
    const audioPath = outputPath || path.join(dir, `audio_${Date.now()}.wav`)

    // 若显式指定了 outputPath，确保其父目录存在
    await this.ensureDir(path.dirname(audioPath))

    console.log('Starting audio extraction:')
    console.log(`  Input: ${videoPath}`)
    console.log(`  Output: ${audioPath}`)
    console.log(`  Work dir: ${dir}`)

    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        videoPath,
        '-vn', // 不包含视频
        '-acodec',
        'pcm_s16le', // 16位 PCM 编码
        '-ar',
        '16000', // 16kHz 采样率，适合语音识别
        '-ac',
        '1', // 单声道
        '-y', // 覆盖输出文件
        audioPath,
      ]

      const process = spawn(this.ffmpegPath, args)
      let error = ''

      process.stderr.on('data', data => {
        const output = data.toString()
        error += output

        // 解析进度信息
        if (onProgress) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
          if (timeMatch) {
            const hours = Number.parseInt(timeMatch[1])
            const minutes = Number.parseInt(timeMatch[2])
            const seconds = Number.parseFloat(timeMatch[3])
            const currentTime = hours * 3600 + minutes * 60 + seconds

            // 需要视频总时长来计算百分比，这里先简化处理
            // 实际使用时应该先获取视频信息
            const progress = Math.min(currentTime / 100, 1) * 100 // 简化计算
            onProgress(progress)
          }
        }
      })

      process.on('close', async code => {
        if (code !== 0) {
          reject(new Error(`Audio extraction failed: ${error}`))
          return
        }

        // 验证文件是否真的被创建
        try {
          await fs.access(audioPath)
          const stats = await fs.stat(audioPath)
          if (stats.size === 0) {
            reject(
              new Error(`Audio file was created but is empty: ${audioPath}`)
            )
            return
          }
          console.log(
            `Audio extraction successful: ${audioPath} (${stats.size} bytes)`
          )
          resolve(audioPath)
        } catch (fileError) {
          reject(
            new Error(
              `Audio file was not created or is not accessible: ${audioPath}. Error: ${fileError}`
            )
          )
        }
      })
    })
  }

  /**
   * 根据静音区间切分音频
   */
  /**
   * 根据静音区间切分音频为多个段落
   * @param audioPath - 音频文件路径
   * @param maxSegmentLength - 最大段落长度（秒，默认：30）
   * @param silenceThreshold - 静音阈值（dB，默认：-40）
   * @returns 返回音频段落数组
   */
  async segmentAudio(
    audioPath: string,
    maxSegmentLength = 30, // 最大段落长度（秒）
    silenceThreshold = -40, // 静音阈值（dB）
    workDir?: string
  ): Promise<AudioSegment[]> {
    const dir = await this.resolveWorkDir(workDir)
    const segments: AudioSegment[] = []
    const maxLen = Math.max(1, maxSegmentLength)

    // 首先检测静音区间（失败时回退为空，走固定时长切分）
    let silenceIntervals: Array<{ start: number; end: number }> = []
    try {
      silenceIntervals = await this.detectSilence(audioPath, silenceThreshold)
    } catch (error) {
      console.warn(
        'Silence detection failed, falling back to fixed-length split:',
        error
      )
    }

    // 根据静音区间和最大长度切分
    let currentStart = 0
    let segmentIndex = 0

    for (const silence of silenceIntervals) {
      const segmentDuration = silence.start - currentStart

      if (segmentDuration >= maxLen) {
        // 段落过长：强制按 maxLen 切分
        const { segments: parts, nextIndex } =
          await this.createFixedLengthSegments(
            audioPath,
            currentStart,
            silence.start,
            maxLen,
            segmentIndex,
            dir
          )
        segments.push(...parts)
        segmentIndex = nextIndex
      } else if (segmentDuration > 0.5) {
        // 忽略过短的段落
        const segmentPath = await this.extractAudioSegment(
          audioPath,
          currentStart,
          silence.start,
          segmentIndex++,
          dir
        )

        segments.push({
          path: segmentPath,
          startTime: currentStart,
          duration: silence.start - currentStart,
        })
      }

      currentStart = silence.end
    }

    // 处理最后一个静音区间到音频末尾的剩余部分（必须强制按时长切分）
    const audioDuration = await this.getMediaDuration(audioPath)
    if (currentStart < audioDuration && audioDuration - currentStart > 0.5) {
      console.log(
        `Creating final segment(s) from ${currentStart}s to end (${audioDuration}s), maxLen=${maxLen}s`
      )
      const { segments: parts, nextIndex } =
        await this.createFixedLengthSegments(
          audioPath,
          currentStart,
          audioDuration,
          maxLen,
          segmentIndex,
          dir
        )
      segments.push(...parts)
      segmentIndex = nextIndex
    }

    // 若仍无段落（例如静音覆盖整段），按固定时长切整轨
    if (segments.length === 0) {
      console.log(
        `No silence-based segments, creating fixed-length segments for entire audio (${audioDuration}s)`
      )
      const { segments: parts } = await this.createFixedLengthSegments(
        audioPath,
        0,
        audioDuration,
        maxLen,
        segmentIndex,
        dir
      )
      segments.push(...parts)
    }

    console.log(
      `Audio segmentation complete: ${segments.length} segments created`
    )
    return segments
  }

  /**
   * 将 [start, end) 按固定最大时长切成多个音频段。
   * 避免超长音频一次性送入 ASR 导致进程 OOM/原生崩溃。
   */
  private async createFixedLengthSegments(
    audioPath: string,
    start: number,
    end: number,
    maxSegmentLength: number,
    startIndex: number,
    workDir: string
  ): Promise<{ segments: AudioSegment[]; nextIndex: number }> {
    const segments: AudioSegment[] = []
    let segmentStart = start
    let index = startIndex
    const maxLen = Math.max(1, maxSegmentLength)

    while (segmentStart < end - 0.05) {
      const segmentEnd = Math.min(segmentStart + maxLen, end)
      const duration = segmentEnd - segmentStart
      if (duration < 0.1) break

      const segmentPath = await this.extractAudioSegment(
        audioPath,
        segmentStart,
        segmentEnd,
        index++,
        workDir
      )

      segments.push({
        path: segmentPath,
        startTime: segmentStart,
        duration,
      })

      segmentStart = segmentEnd
    }

    return { segments, nextIndex: index }
  }

  /**
   * 检测音频中的静音区间
   * @param audioPath - 音频文件路径
   * @param threshold - 静音阈值（dB）
   * @returns 返回静音区间数组，每个区间包含开始和结束时间
   */
  private async detectSilence(
    audioPath: string,
    threshold: number
  ): Promise<Array<{ start: number; end: number }>> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        audioPath,
        '-af',
        `silencedetect=noise=${threshold}dB:d=0.5`,
        '-f',
        'null',
        '-',
      ]

      const process = spawn(this.ffmpegPath, args)
      let output = ''

      process.stderr.on('data', data => {
        output += data.toString()
      })

      process.on('close', code => {
        if (code !== 0) {
          reject(new Error('Silence detection failed'))
          return
        }

        const silences: Array<{ start: number; end: number }> = []
        const silenceRegex = /silence_start: ([\d.]+)|silence_end: ([\d.]+)/g
        let match: RegExpExecArray | null
        let currentSilence: { start?: number; end?: number } = {}

        match = silenceRegex.exec(output)
        while (match !== null) {
          if (match[1]) {
            currentSilence.start = Number.parseFloat(match[1])
          } else if (match[2]) {
            currentSilence.end = Number.parseFloat(match[2])
            if (currentSilence.start !== undefined) {
              silences.push({
                start: currentSilence.start,
                end: currentSilence.end,
              })
              currentSilence = {}
            }
          }
          match = silenceRegex.exec(output)
        }

        resolve(silences)
      })
    })
  }

  /**
   * 提取音频的指定时间段作为单独文件
   * @param audioPath - 源音频文件路径
   * @param start - 开始时间（秒）
   * @param end - 结束时间（秒，-1表示到文件末尾）
   * @param index - 段落索引
   * @returns 返回提取的音频段落文件路径
   */
  private async extractAudioSegment(
    audioPath: string,
    start: number,
    end: number,
    index: number,
    workDir: string
  ): Promise<string> {
    const segmentPath = path.join(workDir, `segment_${index}_${Date.now()}.wav`)

    return new Promise((resolve, reject) => {
      const args = ['-i', audioPath, '-ss', start.toString()]

      // 只有当 end 不为 -1 时才添加持续时间参数
      if (end !== -1) {
        args.push('-t', (end - start).toString())
      }

      args.push('-acodec', 'copy', '-y', segmentPath)

      const process = spawn(this.ffmpegPath, args)
      let error = ''

      process.stderr.on('data', data => {
        error += data.toString()
      })

      process.on('close', code => {
        if (code !== 0) {
          reject(new Error(`Segment extraction failed: ${error}`))
          return
        }

        resolve(segmentPath)
      })
    })
  }

  /**
   * 合成字幕到视频
   */
  /**
   * 将字幕文件烧录到视频中（硬字幕）
   * @param videoPath - 源视频文件路径
   * @param subtitlePath - 字幕文件路径
   * @param outputPath - 输出视频文件路径
   * @param onProgress - 进度回调函数（可选）
   * @returns 返回烧录字幕后的视频文件路径
   * @throws 当字幕烧录失败时抛出错误
   */
  async burnSubtitles(
    videoPath: string,
    subtitlePath: string,
    outputPath: string,
    onProgress?: (progress: number) => void,
    workDir?: string
  ): Promise<string> {
    // Homebrew 精简版 ffmpeg 不含 libass，subtitles 滤镜不可用；优先找带 libass 的 ffmpeg
    const ffmpegBin = await this.resolveFfmpegWithSubtitlesFilter()
    if (!ffmpegBin) {
      throw new Error(
        '硬字幕烧录失败：当前 FFmpeg 未启用 libass（缺少 subtitles 滤镜）。\n' +
          '安装方法：\n' +
          '- macOS: brew install ffmpeg-full\n' +
          '  （安装后确保 PATH 中优先使用含 libass 的 ffmpeg，或使用 /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg）\n' +
          '- Ubuntu/Debian: sudo apt install ffmpeg libass9\n' +
          '- 也可安装官方完整构建：https://ffmpeg.org/download.html'
      )
    }

    // 中文路径等非 ASCII 路径容易触发 filtergraph 解析错误，复制到临时 ASCII 路径
    const dir = await this.resolveWorkDir(workDir)
    const tempSubtitlePath = path.join(dir, `burn_sub_${Date.now()}.srt`)
    await fs.copyFile(subtitlePath, tempSubtitlePath)

    try {
      const videoInfo = await this.getVideoInfo(videoPath)
      const subtitleMargin = calculateTranslatedSubtitleMargin(videoInfo.height)
      return await this.runBurnSubtitles(
        ffmpegBin,
        videoPath,
        tempSubtitlePath,
        outputPath,
        subtitleMargin,
        onProgress
      )
    } finally {
      await fs.unlink(tempSubtitlePath).catch(() => {})
    }
  }

  /**
   * 转义路径供 FFmpeg filtergraph 使用
   */
  private escapeFilterPath(filePath: string): string {
    // 统一为正斜杠后，转义 filtergraph 特殊字符 : '
    return path
      .resolve(filePath)
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'")
  }

  /**
   * 检测指定 ffmpeg 是否支持 subtitles 滤镜（依赖 libass）
   */
  private async binarySupportsSubtitlesFilter(
    ffmpegBin: string
  ): Promise<boolean> {
    return new Promise(resolve => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      }

      const proc = spawn(ffmpegBin, ['-hide_banner', '-filters'])
      let output = ''

      proc.stdout.on('data', data => {
        output += data.toString()
      })
      proc.stderr.on('data', data => {
        output += data.toString()
      })
      proc.on('error', () => finish(false))
      proc.on('close', () => {
        // 匹配 filters 列表中的 subtitles 滤镜行
        finish(/(?:^|\n)\s*[T.]{2}\s+subtitles\s+/m.test(output))
      })

      const timeout = setTimeout(() => {
        proc.kill()
        finish(false)
      }, 8000)
    })
  }

  /**
   * 解析可用的、支持硬字幕烧录的 ffmpeg 路径
   */
  private async resolveFfmpegWithSubtitlesFilter(): Promise<string | null> {
    const candidates = [
      this.ffmpegPath,
      '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
      '/usr/local/opt/ffmpeg-full/bin/ffmpeg',
    ]

    const seen = new Set<string>()
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      if (await this.binarySupportsSubtitlesFilter(candidate)) {
        if (candidate !== this.ffmpegPath) {
          console.log(`使用支持 libass 的 FFmpeg 进行硬字幕烧录: ${candidate}`)
        }
        return candidate
      }
    }
    return null
  }

  private runBurnSubtitles(
    ffmpegBin: string,
    videoPath: string,
    subtitlePath: string,
    outputPath: string,
    subtitleMargin: number,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const escapedSub = this.escapeFilterPath(subtitlePath)
      const args = [
        '-i',
        videoPath,
        '-vf',
        `subtitles='${escapedSub}':force_style='Alignment=2,MarginV=${subtitleMargin}'`,
        '-c:a',
        'copy',
        '-y',
        outputPath,
      ]

      const process = spawn(ffmpegBin, args)
      let error = ''

      process.stderr.on('data', data => {
        const output = data.toString()
        error += output

        if (onProgress) {
          const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/)
          if (timeMatch) {
            const hours = Number.parseInt(timeMatch[1])
            const minutes = Number.parseInt(timeMatch[2])
            const seconds = Number.parseFloat(timeMatch[3])
            const currentTime = hours * 3600 + minutes * 60 + seconds

            // 简化的进度计算
            const progress = Math.min(currentTime / 100, 1) * 100
            onProgress(progress)
          }
        }
      })

      process.on('error', err => {
        reject(new Error(`Subtitle burning failed: ${err.message}`))
      })

      process.on('close', code => {
        if (code !== 0) {
          const hint =
            /Unknown filter ['"]?subtitles/i.test(error) ||
            /No such filter/i.test(error)
              ? '\n提示：当前 FFmpeg 缺少 libass。macOS 可执行: brew install ffmpeg-full'
              : ''
          reject(new Error(`Subtitle burning failed: ${error}${hint}`))
          return
        }

        resolve(outputPath)
      })
    })
  }

  /**
   * 清理临时文件（委托统一缓存管理；退出时使用）。
   * 进行中的任务目录由 TaskManager 单独维护，此处可清空全部。
   */
  async cleanup(): Promise<void> {
    try {
      await tempWorkspace.clearCache()
    } catch (error) {
      console.error('Cleanup failed:', error)
    }
  }
}

// 单例实例
export const ffmpegProcessor = new FFmpegProcessor()
