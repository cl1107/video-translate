import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 内容寻址的文本断点。目录仅由主进程决定，不接受渲染进程路径。 */
export function createTextPartCache(directory: string, configuration: unknown) {
  const config = JSON.stringify(configuration)
  const fileFor = (index: number, input: string) =>
    path.join(
      directory,
      `${createHash('sha256').update(JSON.stringify({ config, index, input })).digest('hex')}.json`
    )
  return {
    async loadPart({
      index,
      input,
    }: {
      index: number
      input: string
    }): Promise<string | undefined> {
      try {
        const result: unknown = JSON.parse(
          await fs.readFile(fileFor(index, input), 'utf-8')
        )
        return typeof result === 'string' && result.trim() ? result : undefined
      } catch {
        return undefined
      }
    },
    async savePart({
      index,
      input,
      output,
    }: {
      index: number
      input: string
      output: string
    }): Promise<void> {
      await fs.mkdir(directory, { recursive: true })
      const target = fileFor(index, input)
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify(output), {
          encoding: 'utf-8',
          mode: 0o600,
        })
        await fs.rename(temporary, target)
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {})
      }
    },
  }
}
