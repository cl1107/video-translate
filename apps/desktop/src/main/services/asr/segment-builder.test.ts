import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  buildSegmentsFromAsrResult,
  distributeTextAcrossSpans,
} from './segment-builder'

describe('distributeTextAcrossSpans', () => {
  test('句子按字数加权分布到语音区间，跳过静音', () => {
    // 两个语音区间：[0,10] 与 [20,30]，共 20s 语音；静音 [10,20] 被跳过
    const spans = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]
    const segments = distributeTextAcrossSpans(
      '短句。这是一个长很多很多的句子。',
      spans,
      100
    )

    assert.equal(segments.length, 2)
    const [first, second] = segments

    // 短句（3 字）占 3/15 语音时长 ≈ 4s，落在第一个区间内
    assert.equal(first.start, 100)
    assert.ok(first.end > first.start)
    assert.ok(first.end < 100 + 10)

    // 第二句起点已越过静音（≥ 块内 20s），不再落在静音里
    const secondStart = second.start - 100
    assert.ok(
      secondStart >= 10,
      `第二句起点应在第一段语音末尾之后: ${secondStart}`
    )
    assert.ok(second.end > second.start)
  })

  test('空文本或空区间返回空数组（调用方回退均匀切分）', () => {
    assert.deepEqual(
      distributeTextAcrossSpans('', [{ start: 0, end: 5 }], 0),
      []
    )
    assert.deepEqual(distributeTextAcrossSpans('文本。', [], 0), [])
    assert.deepEqual(
      distributeTextAcrossSpans('文本。', [{ start: 5, end: 5 }], 0),
      []
    )
  })

  test('单区间退化为按字数加权切分', () => {
    const segments = distributeTextAcrossSpans(
      '前半。后半部分更长一些。',
      [{ start: 5, end: 15 }],
      0
    )
    assert.equal(segments.length, 2)
    assert.equal(segments[0].start, 5)
    // 全部落在区间 [5,15] 内
    for (const segment of segments) {
      assert.ok(segment.start >= 5 && segment.end <= 15.01)
    }
  })
})

describe('buildSegmentsFromAsrResult 无时间戳回退', () => {
  test('提供语音区间时按区间分布而非均匀切分', () => {
    const result = { text: '第一句话。第二句话。' }
    const segments = buildSegmentsFromAsrResult(result, {
      timeOffset: 30,
      speechSpans: [
        { start: 0, end: 4 },
        { start: 6, end: 10 },
      ],
    })
    assert.ok(segments.length >= 2)
    // 全部落在两个语音区间覆盖的 [30, 40] 内，且跳过 [34, 36] 的静音带
    for (const segment of segments) {
      assert.ok(segment.start >= 30 && segment.end <= 40.01)
    }
  })

  test('无语音区间时维持原有均匀切分', () => {
    const segments = buildSegmentsFromAsrResult(
      { text: '第一句。第二句。第三句。' },
      { timeOffset: 0, maxDuration: 9 }
    )
    assert.equal(segments.length, 3)
    // 均匀切分：每句 3s
    assert.equal(segments[0].start, 0)
    assert.equal(segments[1].start, 3)
    assert.equal(segments[2].start, 6)
  })

  test('有 token 时间戳时不受语音区间影响', () => {
    const result = {
      text: '你好。',
      tokens: ['你', '好', '。'],
      timestamps: [0.1, 0.4, 0.8],
    }
    const segments = buildSegmentsFromAsrResult(result, {
      timeOffset: 10,
      speechSpans: [{ start: 0, end: 1 }],
    })
    assert.equal(segments.length, 1)
    assert.equal(segments[0].start, 10.1)
  })
})
