import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatLogTime,
  formatProcessingTime,
} from './task-time'

describe('task time formatting', () => {
  it('formats media and processing durations', () => {
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(
      formatProcessingTime('2026-07-22 14:00:00', '2026-07-22 14:03:42')
    ).toBe('3:42')
  })

  it('omits processing time until the task is complete', () => {
    expect(formatProcessingTime('2026-07-22 14:00:00')).toBeUndefined()
  })

  it('shows the stored local log time without timezone conversion', () => {
    expect(formatLogTime('2026-07-22 14:03:42')).toBe('14:03:42')
    expect(formatLogTime('2026-07-22T14:03:42')).toBe('14:03:42')
  })
})
