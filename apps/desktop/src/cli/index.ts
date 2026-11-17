import { bootstrapCliRuntime } from './bootstrap'
import { fail } from './format'
import { parseArgv } from './parse'

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2))
  bootstrapCliRuntime({
    userData: parsed.userData,
    shareDesktop: parsed.flags['share-desktop'] === true,
  })
  const { runCli } = await import('./run')
  const code = await runCli(parsed)
  process.exit(code)
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  const json = process.argv.includes('--json')
  process.exit(fail(message, json))
})
