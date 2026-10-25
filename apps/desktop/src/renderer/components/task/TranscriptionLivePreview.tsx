import { useMemo } from 'react'
import type { TranscriptionSegment } from 'shared/types/video'

/**
 * 转录进行中的实时预览：已识别段数 + 最近几条文本。
 * 数据来自转录的流式回传（taskUpdated 推送），长视频时用户不用干等。
 */
export function TranscriptionLivePreview({
  segments,
}: {
  segments: TranscriptionSegment[]
}) {
  const preview = useMemo(() => segments.slice(-3), [segments])
  if (segments.length === 0) return null

  return (
    <div className="motion-panel-in rounded-md border bg-muted/40 px-3 py-2">
      <p className="text-xs font-medium text-foreground">
        已识别 {segments.length} 段
      </p>
      {preview.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {preview.map(segment => (
            <li key={segment.id} className="truncate">
              {segment.originalText}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
