import { CopyTextButton } from './CopyTextButton'

interface TaskErrorMessageProps {
  message: string
}

export function TaskErrorMessage({ message }: TaskErrorMessageProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
      <p
        className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-destructive select-text"
        style={{ userSelect: 'text' }}
      >
        {message}
      </p>
      <CopyTextButton text={message} label="复制错误" />
    </div>
  )
}
