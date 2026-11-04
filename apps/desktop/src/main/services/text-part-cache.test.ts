import { expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTextPartCache } from './text-part-cache'

it('文本分块断点按输入、位置与配置隔离，损坏缓存视为未完成', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'text-part-cache-'))
  try {
    const cache = createTextPartCache(dir, { model: 'model-a' })
    await cache.savePart({ index: 0, input: 'hello', output: '你好' })
    expect(await cache.loadPart({ index: 0, input: 'hello' })).toBe('你好')
    expect(await cache.loadPart({ index: 1, input: 'hello' })).toBeUndefined()
    expect(await cache.loadPart({ index: 0, input: 'changed' })).toBeUndefined()
    expect(
      await createTextPartCache(dir, { model: 'model-b' }).loadPart({
        index: 0,
        input: 'hello',
      })
    ).toBeUndefined()
    const names = await fs.readdir(dir)
    expect(names).toHaveLength(1)
    await fs.writeFile(path.join(dir, names[0] ?? ''), '{bad json')
    expect(await cache.loadPart({ index: 0, input: 'hello' })).toBeUndefined()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
