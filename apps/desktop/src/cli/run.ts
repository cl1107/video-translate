import { existsSync } from 'node:fs'
import path from 'node:path'
import { version as appVersion } from '../../package.json'
import { getAsrModelStatus } from '../main/services/asr/model-paths'
import { asrWorkerHost } from '../main/services/asr/asr-worker-host'
import { listEndpointModels } from '../main/services/llm/llm-config'
import {
  clearAllLlmApiKeys,
  clearLlmApiKey,
  getLlmApiKey,
  hasLlmApiKey,
  setLlmApiKey,
} from '../main/services/secure-store'
import { taskManager } from '../main/services/task-manager'
import { tempWorkspace } from '../main/services/temp-workspace'
import {
  checkSystemDependencies,
  getInstallationSuggestions,
} from '../main/utils/system-check'
import { getAppDiagnosticPaths } from '../main/utils/system-logger'
import { resolveTaskArtifactPath } from '../main/utils/task-artifact-path'
import { ASR_ENGINES, type AsrEngineId } from '../shared/constants'
import {
  normalizeGlossary,
  normalizeTaskCreationSettings,
  type SubtitleBurnMode,
  type TaskCreationSettings,
} from '../shared/settings'
import { collectSubtitleReviewIssues } from '../shared/subtitle-review'
import {
  isTaskKind,
  TaskStatus,
  type TaskKind,
  type TranscriptionSegment,
} from '../shared/types/video'
import { fail, ok, printProgress, printText, summarizeTask } from './format'
import { CLI_HELP } from './help'
import { flagString, looksLikeUrl, type ParsedCli } from './parse'
import {
  cliSettingsPath,
  loadCliSettings,
  patchCliSettings,
} from './settings-store'
import { applyCliFlags } from './task-settings'
import { installGlobalCli } from './install-global'

function shouldWait(parsed: ParsedCli): boolean {
  if (parsed.flags.detach === true || parsed.flags['no-wait'] === true) {
    return false
  }
  return parsed.flags.wait !== false
}

function resolveInput(value: string): string {
  if (looksLikeUrl(value)) return value.trim()
  return path.resolve(value)
}

async function createAndMaybeWait(
  input: string,
  settings: TaskCreationSettings,
  kind: TaskKind,
  parsed: ParsedCli
): Promise<number> {
  const taskId = looksLikeUrl(input)
    ? await taskManager.createTaskFromUrl({
        url: input,
        ...settings,
        kind,
      })
    : await taskManager.createTask({
        filePath: input,
        ...settings,
        kind,
      })

  printProgress(`taskId=${taskId}`)
  return waitForTaskId(taskId, parsed.json)
}

async function waitForTaskId(taskId: string, json: boolean): Promise<number> {
  const unsub = taskManager.subscribeTaskUpdates(task => {
    if (task.id !== taskId) return
    const last = task.logs.at(-1)?.message
    printProgress(
      `[${task.status}] ${Math.round(task.progress)}%${last ? ` ${last}` : ''}`
    )
  })
  try {
    const task = await taskManager.waitForTask(taskId)
    if (task.status === TaskStatus.COMPLETED) {
      return ok(
        {
          taskId,
          task: summarizeTask(task, false),
          message: `任务完成 ${taskId}`,
        },
        json
      )
    }
    return fail(task.errorMessage || `任务状态: ${task.status}`, json)
  } finally {
    unsub()
  }
}

async function runCreate(
  parsed: ParsedCli,
  kind: TaskKind,
  mode?: 'extract'
): Promise<number> {
  const input = parsed.positionals[0]
  if (!input) return fail('请提供本地文件路径或在线视频链接', parsed.json)
  const resolved = resolveInput(input)
  if (!looksLikeUrl(resolved) && !existsSync(resolved)) {
    return fail(`文件不存在: ${resolved}`, parsed.json)
  }
  const settings = normalizeTaskCreationSettings({
    ...applyCliFlags(loadCliSettings(), parsed.flags),
    ...(mode === 'extract'
      ? { subtitleProcessingMode: 'extract' as const }
      : {}),
  })
  return createAndMaybeWait(resolved, settings, kind, parsed)
}

function requireTask(taskId: string | undefined, json: boolean) {
  if (!taskId) {
    return { task: null, error: fail('请提供任务 ID', json) }
  }
  const task = taskManager.getTask(taskId)
  if (!task) return { task: null, error: fail('任务不存在', json) }
  return { task, error: null }
}

async function runTaskCommand(parsed: ParsedCli): Promise<number> {
  const sub = parsed.subcommand
  const json = parsed.json
  const full = parsed.flags.full === true

  if (sub === 'list' || sub === null) {
    const kindRaw = flagString(parsed.flags, 'kind')
    const kind = isTaskKind(kindRaw) ? kindRaw : undefined
    const tasks = taskManager
      .getAllTasks(kind)
      .map(task => summarizeTask(task, full))
    if (!json) {
      if (tasks.length === 0) printText('没有任务')
      else {
        for (const task of tasks) {
          printText(
            `${task.id}  ${task.kind}  ${task.status}  ${task.progress}%  ${(task.video as { name: string }).name}`
          )
        }
      }
      return 0
    }
    return ok({ tasks }, true)
  }

  if (sub === 'get') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    return ok({ task: summarizeTask(task, full) }, json)
  }

  if (sub === 'wait') {
    const id = parsed.positionals[0]
    if (!id) return fail('请提供任务 ID', json)
    return waitForTaskId(id, json)
  }

  if (sub === 'logs') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    const logs = taskManager.getTaskLogs(task.id)
    if (!json) {
      for (const log of logs) {
        printText(`${log.timestamp} [${log.level}] ${log.message}`)
      }
      return 0
    }
    return ok({ logs }, true)
  }

  if (sub === 'artifacts') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    return ok(
      {
        artifacts: task.outputArtifacts ?? null,
        video: resolveTaskArtifactPath(task, 'video'),
        subtitle: resolveTaskArtifactPath(task, 'subtitle'),
        markdown: resolveTaskArtifactPath(task, 'markdown'),
        result: resolveTaskArtifactPath(task, 'result'),
      },
      json
    )
  }

  if (sub === 'markdown') {
    const id = parsed.positionals[0]
    if (!id) return fail('请提供任务 ID', json)
    const result = await taskManager.getTaskMarkdownContent(id)
    if (!result.success) return fail(result.error || '读取文稿失败', json)
    if (!json) {
      printText(result.content ?? '')
      return 0
    }
    return ok({ content: result.content, path: result.path }, true)
  }

  if (sub === 'issues') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    const issues = collectSubtitleReviewIssues(task.segments, {
      requireTranslation: task.options?.subtitleProcessingMode !== 'extract',
    })
    if (!json) {
      if (issues.length === 0) printText('没有校对问题')
      else
        for (const issue of issues)
          printText(`${issue.kind}  ${issue.segmentId}  ${issue.message}`)
      return 0
    }
    return ok({ issues }, true)
  }

  if (sub === 'pause') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    taskManager.pauseTask(task.id)
    return ok({ taskId: task.id, message: '已请求暂停' }, json)
  }

  if (sub === 'resume') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    taskManager.resumeTask(task.id)
    if (shouldWait(parsed)) return waitForTaskId(task.id, json)
    return ok({ taskId: task.id, message: '已恢复' }, json)
  }

  if (sub === 'retry') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    taskManager.retryTask(task.id)
    if (shouldWait(parsed)) return waitForTaskId(task.id, json)
    return ok({ taskId: task.id, message: '已重新排队' }, json)
  }

  if (sub === 'delete') {
    const idsFlag = flagString(parsed.flags, 'ids')
    const ids = idsFlag
      ? idsFlag
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
      : parsed.positionals
    if (ids.length === 0) return fail('请提供任务 ID', json)
    if (ids.length === 1 && ids[0]) {
      taskManager.deleteTask(ids[0])
      return ok({ deletedTaskIds: ids, message: '已删除' }, json)
    }
    const result = await taskManager.deleteTasks(ids)
    return ok(result, json)
  }

  if (sub === 'burn') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    const modeRaw = flagString(parsed.flags, 'mode') ?? 'bilingual'
    const mode: SubtitleBurnMode =
      modeRaw === 'translated' ||
      modeRaw === 'original' ||
      modeRaw === 'bilingual'
        ? modeRaw
        : 'bilingual'
    const result = await taskManager.burnSubtitlesForTask(task.id, mode, {
      originalColor: flagString(parsed.flags, 'original-color'),
      translatedColor: flagString(parsed.flags, 'translated-color'),
    })
    if (!result.success) return fail(result.error || '烧录失败', json)
    return ok({ burnedVideo: result.burnedVideo, message: '烧录完成' }, json)
  }

  if (sub === 'attach-media') {
    const taskId = parsed.positionals[0]
    const filePath = parsed.positionals[1]
    if (!taskId || !filePath)
      return fail('用法: vt task attach-media <id> <视频>', json)
    await taskManager.attachTaskMedia(taskId, path.resolve(filePath))
    return ok({ taskId, message: '已关联视频' }, json)
  }

  if (sub === 'regenerate-subtitles') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    await taskManager.regenerateTaskSubtitles(task.id)
    return ok({ taskId: task.id, message: '已重新导出字幕' }, json)
  }

  if (sub === 'reuse') {
    const { task, error } = requireTask(parsed.positionals[0], json)
    if (error !== null) return error
    const kindRaw = flagString(parsed.flags, 'kind')
    if (!isTaskKind(kindRaw)) {
      return fail('请使用 --kind subtitle 或 --kind document', json)
    }
    const targetLanguage =
      flagString(parsed.flags, 'target-lang') ||
      loadCliSettings().targetLanguage
    const newId = await taskManager.reuseTaskTranscript(task.id, {
      kind: kindRaw,
      targetLanguage,
      settings: applyCliFlags(loadCliSettings(), parsed.flags),
    })
    if (shouldWait(parsed)) return waitForTaskId(newId, json)
    return ok({ taskId: newId, message: `已复用为 ${newId}` }, json)
  }

  if (sub === 'segment') {
    return runSegmentCommand(parsed)
  }

  return fail(`未知任务子命令: ${sub ?? ''}`, json)
}

async function runSegmentCommand(parsed: ParsedCli): Promise<number> {
  const json = parsed.json
  const action = parsed.positionals[0]
  const taskId = parsed.positionals[1]
  if (action === 'update') {
    const { task, error } = requireTask(taskId, json)
    if (error !== null) return error
    const segmentId = flagString(parsed.flags, 'segment-id')
    if (!segmentId) return fail('请提供 --segment-id', json)
    const existing = task.segments.find(segment => segment.id === segmentId)
    if (!existing) return fail('字幕段不存在', json)
    const startRaw = flagString(parsed.flags, 'start')
    const endRaw = flagString(parsed.flags, 'end')
    const patch: TranscriptionSegment = {
      ...existing,
      start: startRaw !== undefined ? Number(startRaw) : existing.start,
      end: endRaw !== undefined ? Number(endRaw) : existing.end,
      originalText:
        flagString(parsed.flags, 'original') ?? existing.originalText,
      translatedText:
        flagString(parsed.flags, 'translated') ?? existing.translatedText ?? '',
    }
    await taskManager.updateTaskSegment(task.id, patch)
    return ok({ taskId: task.id, segmentId, message: '已更新字幕段' }, json)
  }
  if (action === 'retranslate') {
    const { task, error } = requireTask(taskId, json)
    if (error !== null) return error
    const segmentId = flagString(parsed.flags, 'segment-id')
    if (!segmentId) return fail('请提供 --segment-id', json)
    await taskManager.retranslateTaskSegment(task.id, segmentId)
    return ok({ taskId: task.id, segmentId, message: '已重译该段' }, json)
  }
  return fail(
    '用法: vt task segment update|retranslate <id> --segment-id <sid>',
    json
  )
}

const CONFIG_KEYS = new Set([
  'asrEngine',
  'llmBaseUrl',
  'translateModel',
  'polishModel',
  'selectedLlmServiceId',
  'sourceLanguage',
  'targetLanguage',
  'subtitleOutputLocation',
  'polishTranscript',
  'originalSubtitleColor',
  'translatedSubtitleColor',
  'downloadProxy',
  'downloadCookieBrowser',
  'subtitleProcessingMode',
  'burnSubtitles',
  'burnSubtitleMode',
])

function parseConfigValue(key: string, raw: string): unknown {
  if (raw === 'true' || raw === 'false') return raw === 'true'
  return raw
}

async function runConfig(parsed: ParsedCli): Promise<number> {
  const json = parsed.json
  const sub = parsed.subcommand
  if (sub === 'path') {
    return ok({ path: cliSettingsPath() }, json)
  }
  if (sub === 'get' || sub === null) {
    const settings = loadCliSettings()
    const key = parsed.positionals[0]
    if (key) {
      const value = (settings as unknown as Record<string, unknown>)[key]
      if (value === undefined) return fail(`未知配置项: ${key}`, json)
      if (!json) {
        printText(
          typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        )
        return 0
      }
      return ok({ key, value }, true)
    }
    return ok({ settings, path: cliSettingsPath() }, json)
  }
  if (sub === 'set') {
    const key = parsed.positionals[0]
    const value = parsed.positionals[1]
    if (!key || value === undefined) {
      return fail('用法: vt config set <key> <value>', json)
    }
    if (!CONFIG_KEYS.has(key)) return fail(`不支持的配置项: ${key}`, json)
    if (
      key === 'asrEngine' &&
      value !== 'sensevoice' &&
      value !== 'funasr-nano'
    ) {
      return fail('asrEngine 只能是 sensevoice 或 funasr-nano', json)
    }
    const settings = patchCliSettings({
      [key]: parseConfigValue(key, value),
    } as Partial<TaskCreationSettings>)
    return ok({ settings, message: `已更新 ${key}` }, json)
  }
  return fail(`未知 config 子命令: ${sub ?? ''}`, json)
}

async function runGlossary(parsed: ParsedCli): Promise<number> {
  const json = parsed.json
  const sub = parsed.subcommand
  const settings = loadCliSettings()
  if (sub === 'list' || sub === null) {
    return ok({ glossary: settings.glossary }, json)
  }
  if (sub === 'add') {
    const source = flagString(parsed.flags, 'source')
    const target = flagString(parsed.flags, 'target')
    if (!source || !target)
      return fail('用法: vt glossary add --source 词 --target 译', json)
    const glossary = normalizeGlossary([
      ...settings.glossary,
      { source, target },
    ])
    patchCliSettings({ glossary })
    return ok({ glossary, message: '已添加术语' }, json)
  }
  if (sub === 'remove') {
    const source = flagString(parsed.flags, 'source')
    if (!source) return fail('用法: vt glossary remove --source 词', json)
    const glossary = settings.glossary.filter(
      entry => entry.source.toLocaleLowerCase() !== source.toLocaleLowerCase()
    )
    patchCliSettings({ glossary })
    return ok({ glossary, message: '已删除术语' }, json)
  }
  return fail('用法: vt glossary list|add|remove', json)
}

async function runLlm(parsed: ParsedCli): Promise<number> {
  const json = parsed.json
  const sub = parsed.subcommand
  const serviceId = flagString(parsed.flags, 'service-id')
  if (sub === 'key') {
    const action = parsed.positionals[0]
    if (action === 'status') {
      return ok(
        { configured: hasLlmApiKey(serviceId), serviceId: serviceId ?? null },
        json
      )
    }
    if (action === 'clear') {
      const result =
        parsed.flags.all === true
          ? clearAllLlmApiKeys()
          : clearLlmApiKey(serviceId)
      if (!result.success) return fail(result.error || '清除失败', json)
      return ok({ message: '已清除密钥' }, json)
    }
    if (action === 'set') {
      const value =
        flagString(parsed.flags, 'value') ||
        parsed.positionals[1] ||
        process.env.VIDEO_TRANSLATE_LLM_API_KEY ||
        ''
      if (!value.trim())
        return fail('请通过 --value 或环境变量提供 API Key', json)
      const result = setLlmApiKey(value, serviceId)
      if (!result.success) return fail(result.error || '保存失败', json)
      return ok({ message: '已保存 API Key', configured: true }, json)
    }
    return fail('用法: vt llm key set|status|clear', json)
  }
  if (sub === 'models') {
    const settings = applyCliFlags(loadCliSettings(), parsed.flags)
    const baseUrl = flagString(parsed.flags, 'base-url') || settings.llmBaseUrl
    const apiKey =
      flagString(parsed.flags, 'api-key') ||
      getLlmApiKey(serviceId) ||
      undefined
    const result = await listEndpointModels(baseUrl, apiKey)
    if (!result.ok) return fail(result.error || '拉取模型失败', json)
    if (!json) {
      for (const model of result.models) printText(model)
      return 0
    }
    return ok({ models: result.models }, true)
  }
  return fail('用法: vt llm key|models', json)
}

async function runDoctor(parsed: ParsedCli): Promise<number> {
  const results = await checkSystemDependencies()
  const suggestions = getInstallationSuggestions(results)
  const asr = getAsrModelStatus()
  const diagnosticPaths = getAppDiagnosticPaths()
  const payload = { results, suggestions, asr, diagnosticPaths }
  if (!parsed.json) {
    for (const item of results) {
      printText(
        `${item.available ? 'OK' : 'MISSING'}  ${item.name}${item.version ? `  ${item.version}` : ''}${item.optional ? '  (optional)' : ''}`
      )
    }
    for (const engine of asr) {
      printText(
        `${engine.available ? 'OK' : 'MISSING'}  asr:${engine.engine}  ${engine.detail ?? ''}`
      )
    }
    if (suggestions.length > 0) {
      printText('建议:')
      for (const line of suggestions) printText(`- ${line}`)
    }
    return results.every(item => item.optional || item.available) ? 0 : 1
  }
  return ok(payload, true)
}

async function runCache(parsed: ParsedCli): Promise<number> {
  const json = parsed.json
  const sub = parsed.subcommand
  if (sub === 'stats' || sub === null) {
    const stats = await tempWorkspace.getStats()
    return ok({ ...stats }, json)
  }
  if (sub === 'clear') {
    const result = await taskManager.clearTempCache()
    return ok({ ...result, message: '已清理临时缓存' }, json)
  }
  return fail('用法: vt cache stats|clear', json)
}

export async function runCli(parsed: ParsedCli): Promise<number> {
  try {
    if (parsed.command === 'help' || parsed.help) {
      printText(CLI_HELP)
      return 0
    }
    if (parsed.command === 'version' || parsed.version) {
      if (parsed.json) return ok({ version: appVersion }, true)
      printText(appVersion)
      return 0
    }
    if (parsed.command === 'subtitle') {
      return runCreate(parsed, 'subtitle')
    }
    if (parsed.command === 'extract') {
      return runCreate(parsed, 'subtitle', 'extract')
    }
    if (parsed.command === 'document') {
      return runCreate(parsed, 'document')
    }
    if (parsed.command === 'import') {
      const filePath = parsed.positionals[0]
      if (!filePath) return fail('请提供 SRT / VTT 文件', parsed.json)
      const taskId = await taskManager.importSubtitles(
        path.resolve(filePath),
        applyCliFlags(loadCliSettings(), parsed.flags)
      )
      return ok({ taskId, message: `已导入字幕 ${taskId}` }, parsed.json)
    }
    if (parsed.command === 'task') return runTaskCommand(parsed)
    if (parsed.command === 'config') return runConfig(parsed)
    if (parsed.command === 'glossary') return runGlossary(parsed)
    if (parsed.command === 'llm') return runLlm(parsed)
    if (parsed.command === 'asr') {
      const models = getAsrModelStatus().map(model => ({
        ...model,
        name: ASR_ENGINES[model.engine as AsrEngineId]?.name,
      }))
      return ok({ models }, parsed.json)
    }
    if (parsed.command === 'doctor') return runDoctor(parsed)
    if (parsed.command === 'cache') return runCache(parsed)
    if (parsed.command === 'stats') {
      return ok({ statistics: taskManager.getStatistics() }, parsed.json)
    }
    if (parsed.command === 'install') {
      const binPath = flagString(parsed.flags, 'bin')
      const appPath = flagString(parsed.flags, 'app')
      const result = installGlobalCli({ binPath, appPath })
      const message =
        result.source === 'packaged'
          ? `已安装全局命令 ${result.binPath}（绑定 ${result.appPath}）`
          : `已安装全局命令 ${result.binPath}（当前安装包不含 CLI，暂绑定源码入口；重新打包桌面版后再执行 vt install）`
      return ok({ ...result, message }, parsed.json)
    }
    return fail(`未知命令: ${parsed.command}`, parsed.json)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(message, parsed.json)
  } finally {
    asrWorkerHost.dispose()
    taskManager.cleanup()
  }
}
