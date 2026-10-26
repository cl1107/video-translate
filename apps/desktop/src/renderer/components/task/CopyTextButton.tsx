import { Copy, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from 'renderer/components/ui/button'

interface CopyTextButtonProps {
  text: string
  label: string
  disabled?: boolean
}

type CopyState = {
  kind: 'idle' | 'copying' | 'copied' | 'failed'
  text: string
}

export function CopyTextButton({
  text,
  label,
  disabled = false,
}: CopyTextButtonProps) {
  const [state, setState] = useState<CopyState>({ kind: 'idle', text: '' })
  const requestId = useRef(0)
  const kind =
    state.kind === 'copied' && state.text !== text ? 'idle' : state.kind

  async function copyText() {
    const currentRequest = ++requestId.current
    setState({ kind: 'copying', text })
    try {
      await navigator.clipboard.writeText(text)
      if (requestId.current === currentRequest)
        setState({ kind: 'copied', text })
    } catch {
      if (requestId.current === currentRequest)
        setState({ kind: 'failed', text })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled || !text || kind === 'copying'}
        onClick={() => void copyText()}
      >
        {kind === 'copying' ? (
          <Loader2
            data-icon="inline-start"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {kind === 'copying' ? '复制中…' : label}
      </Button>
      {kind === 'copied' && (
        <span role="status" className="text-xs text-brand-ink">
          已复制
        </span>
      )}
      {kind === 'failed' && (
        <span role="alert" className="text-xs text-destructive">
          复制失败，请手动选择文字复制
        </span>
      )}
    </div>
  )
}
