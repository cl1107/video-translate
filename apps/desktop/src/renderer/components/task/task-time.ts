export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return (
      hours +
      ':' +
      minutes.toString().padStart(2, '0') +
      ':' +
      secs.toString().padStart(2, '0')
    )
  }
  return minutes + ':' + secs.toString().padStart(2, '0')
}

export function formatProcessingTime(
  createdAt: string,
  completedAt?: string
): string | undefined {
  if (!completedAt) return undefined

  const parseLocalTime = (value: string) =>
    new Date(value.replace(' ', 'T')).getTime()
  const elapsedSeconds = Math.max(
    0,
    Math.round((parseLocalTime(completedAt) - parseLocalTime(createdAt)) / 1000)
  )

  return Number.isFinite(elapsedSeconds)
    ? formatDuration(elapsedSeconds)
    : undefined
}

export function formatLogTime(timestamp: string): string {
  const match = timestamp.match(/(?:T|\s)(\d{2}:\d{2}:\d{2})/)
  return match?.[1] ?? timestamp
}
