import { expect, it } from 'vitest'
import { SubtitleGenerator } from './subtitle-generator'

it('WebVTT 支持短时间戳、cue标识、显示设置并忽略元数据', () => {
  const entries = SubtitleGenerator.parseVTT(`WEBVTT

STYLE
::cue { color: red; }

NOTE comment
00:00.000 --> 00:01.000
not a cue

chapter-1
01:02.300 --> 01:04.500 align:start position:10%
<b>Hello</b>
world

02:00:01.000 --> 02:00:02.000
Long video
`)
  expect(entries).toEqual([
    {
      index: 1,
      start: '00:01:02,300',
      end: '00:01:04,500',
      text: 'Hello\nworld',
    },
    {
      index: 2,
      start: '02:00:01,000',
      end: '02:00:02,000',
      text: 'Long video',
    },
  ])
})
