/**
 * 轻量 argv 解析：子命令 + 位置参数 + 长短选项。
 * 不引入 commander，方便单测与 Agent 调用。
 */

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'h',
  'version',
  'V',
  'wait',
  'detach',
  'no-wait',
  'burn',
  'no-polish',
  'full',
  'yes',
  'y',
  'share-desktop',
])

const COMMANDS = new Set([
  'subtitle',
  'document',
  'extract',
  'import',
  'task',
  'config',
  'llm',
  'asr',
  'doctor',
  'cache',
  'stats',
  'glossary',
  'help',
  'version',
  'install',
])

const ALIASES: Record<string, string> = {
  sub: 'subtitle',
  doc: 'document',
  md: 'document',
  tasks: 'task',
  cfg: 'config',
}

export interface ParsedCli {
  command: string
  subcommand: string | null
  rest: string[]
  positionals: string[]
  flags: Record<string, string | boolean>
  json: boolean
  help: boolean
  version: boolean
  userData?: string
}

export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function normalizeCommand(value: string): string {
  return ALIASES[value] ?? value
}

function isCommand(value: string): boolean {
  return COMMANDS.has(normalizeCommand(value))
}

function flagName(token: string): string {
  return token.replace(/^--?/, '')
}

/**
 * 解析 CLI argv（不含 node / 脚本路径）。
 * 首参若不是已知命令且像文件或 URL，则视为 `subtitle` 的输入。
 */
export function parseArgv(argv: string[]): ParsedCli {
  const flags: Record<string, string | boolean> = {}
  const tokens: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined) break
    if (token === '--') {
      tokens.push(...argv.slice(i + 1))
      break
    }
    if (!token.startsWith('-')) {
      tokens.push(token)
      continue
    }
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=')
      flags[flagName(token.slice(0, eq))] = token.slice(eq + 1)
      continue
    }
    const name = flagName(token)
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      flags[name] = next
      i += 1
      continue
    }
    flags[name] = true
  }

  let command = 'help'
  let subcommand: string | null = null
  const positionals: string[] = []
  const rest: string[] = []

  const first = tokens[0]
  if (!first) {
    command = flags.version || flags.V ? 'version' : 'help'
  } else if (isCommand(first)) {
    command = normalizeCommand(first)
    const second = tokens[1]
    if (
      command === 'task' ||
      command === 'config' ||
      command === 'llm' ||
      command === 'cache' ||
      command === 'glossary'
    ) {
      subcommand = second ?? null
      positionals.push(...tokens.slice(2))
      rest.push(...tokens.slice(1))
    } else {
      positionals.push(...tokens.slice(1))
      rest.push(...tokens.slice(1))
    }
  } else {
    command = 'subtitle'
    positionals.push(...tokens)
    rest.push(...tokens)
  }

  const userData =
    typeof flags['user-data'] === 'string' ? flags['user-data'] : undefined

  return {
    command,
    subcommand,
    rest,
    positionals,
    flags,
    json: flags.json === true,
    help: flags.help === true || flags.h === true,
    version: flags.version === true || flags.V === true,
    userData,
  }
}

export function flagString(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function flagBoolean(
  flags: Record<string, string | boolean>,
  name: string
): boolean | undefined {
  if (flags[name] === true) return true
  if (flags[name] === false) return false
  const value = flags[name]
  if (typeof value !== 'string') return undefined
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return undefined
}
