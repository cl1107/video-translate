import type { TaskLog } from 'shared/types/video'

/** 保留原始时间、级别与诊断文本，复制后仍可定位完整的日志上下文。 */
export function formatTaskLogsForCopy(logs: readonly TaskLog[]): string {
  return logs
    .map(log => {
      const summary = `[${log.timestamp}] [${log.level}] ${log.message}`
      return log.details ? `${summary}\n${log.details}` : summary
    })
    .join('\n\n')
}
