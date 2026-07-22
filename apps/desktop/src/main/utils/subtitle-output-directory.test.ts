import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSubtitleOutputDirectory } from './subtitle-output-directory'

describe('resolveSubtitleOutputDirectory', () => {
  const videoPath = path.join('media', 'movie.mp4')

  it('默认使用 output 子目录', () => {
    expect(resolveSubtitleOutputDirectory(videoPath, undefined)).toBe(
      path.join('media', 'output')
    )
    expect(
      resolveSubtitleOutputDirectory(videoPath, 'output-subdirectory')
    ).toBe(path.join('media', 'output'))
  })

  it('可选择源视频同目录', () => {
    expect(resolveSubtitleOutputDirectory(videoPath, 'source-directory')).toBe(
      'media'
    )
  })
})
