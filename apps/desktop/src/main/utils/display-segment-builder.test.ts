import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { TranscriptionSegment } from '../../shared/types/video'
import { buildDisplaySegments } from './display-segment-builder'

test('buildDisplaySegments merges short adjacent fragments before sentence end', () => {
  const segments: TranscriptionSegment[] = [
    {
      id: '1',
      start: 0,
      end: 0.4,
      originalText: 'Hello',
      confidence: 0.9,
    },
    {
      id: '2',
      start: 0.45,
      end: 1.2,
      originalText: 'world.',
      confidence: 0.9,
    },
    {
      id: '3',
      start: 2.0,
      end: 3.0,
      originalText: 'Next sentence.',
      confidence: 0.9,
    },
  ]

  const display = buildDisplaySegments(segments)
  assert.equal(display.length, 2)
  assert.equal(display[0].originalText, 'Hello world.')
  assert.deepEqual(display[0].sourceSegmentIds, ['1', '2'])
  assert.equal(display[1].originalText, 'Next sentence.')
})

test('buildDisplaySegments does not merge across large gaps', () => {
  const segments: TranscriptionSegment[] = [
    {
      id: '1',
      start: 0,
      end: 1,
      originalText: 'First',
      confidence: 0.9,
    },
    {
      id: '2',
      start: 3,
      end: 4,
      originalText: 'Second',
      confidence: 0.9,
    },
  ]

  const display = buildDisplaySegments(segments, { maxGapSeconds: 0.75 })
  assert.equal(display.length, 2)
})

test.each([
  ['Hello.', 'Next sentence'],
  ['He said hello."', 'Next sentence'],
])(
  'buildDisplaySegments keeps adjacent English sentences separate: %s',
  (first, second) => {
    const segments: TranscriptionSegment[] = [
      {
        id: '1',
        start: 0,
        end: 1,
        originalText: first,
        confidence: 0.9,
      },
      {
        id: '2',
        start: 1.1,
        end: 2,
        originalText: second,
        confidence: 0.9,
      },
    ]

    const display = buildDisplaySegments(segments)

    assert.equal(display.length, 2)
    assert.equal(display[0].originalText, first)
    assert.equal(display[1].originalText, second)
  }
)
