import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTaskArtifactPath } from './task-artifact-path'

const task = (outputArtifacts?: Record<string, string>) =>
  ({
    videoFile: { path: 'D:/videos/movie.mp4' },
    outputArtifacts,
  }) as Parameters<typeof resolveTaskArtifactPath>[0]

describe('resolveTaskArtifactPath', () => {
  it('prefers the persisted output directory', () => {
    expect(
      resolveTaskArtifactPath(
        task({ outputDirectory: 'D:/videos/output' }),
        'result',
        () => false
      )
    ).toBe('D:/videos/output')
  })

  it('falls back to the legacy output directory', () => {
    expect(
      resolveTaskArtifactPath(
        task(),
        'result',
        value => value === path.join('D:/videos', 'output')
      )
    ).toBe(path.join('D:/videos', 'output'))
  })

  it('falls back to the source video directory for old records', () => {
    expect(resolveTaskArtifactPath(task(), 'result', () => false)).toBe(
      path.dirname('D:/videos/movie.mp4')
    )
  })

  it('does not invent paths for missing file artifacts', () => {
    expect(
      resolveTaskArtifactPath(task(), 'subtitle', () => true)
    ).toBeUndefined()
  })
})
