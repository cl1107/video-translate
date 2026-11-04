import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import dayjs from 'dayjs'
import {
  normalizeTaskRuntimeOptions,
  taskOptionsFromAppSettings,
} from '../../shared/task-options'
import type { TaskCreationSettings } from '../../shared/settings'
import {
  TaskStatus,
  type TaskKind,
  type TranscriptionSegment,
  type TranslationTask,
} from '../../shared/types/video'
import { resolveSubtitleLanguageSuffixes } from '../../shared/language'
import { databaseManager } from './database/manager'
import { SubtitleGenerator } from '../utils/subtitle-generator'
import { writeSubtitleArtifacts } from '../utils/subtitle-artifacts'
import { resolveSubtitleOutputDirectory } from '../utils/subtitle-output-directory'
import { resolveLlmCompletionConfig } from './llm/llm-config'
import { createCompletionClient } from './llm/openai-completion-client'
import { translateTextBatch } from './llm/text-transform'
import { getLlmApiKey } from './secure-store'
import { seedTaskTranscript } from './checkpoint'

export function assertEditableTask(task: TranslationTask): void {
  if (
    ![
      TaskStatus.COMPLETED,
      TaskStatus.PAUSED,
      TaskStatus.FAILED,
      TaskStatus.CANCELLED,
    ].includes(task.status)
  ) {
    throw new Error('请先暂停任务，等待处理停止后再校对')
  }
}

export function validateSegmentEdit(
  input: unknown,
  existing: TranscriptionSegment
): TranscriptionSegment {
  if (
    !input ||
    typeof input !== 'object' ||
    !('id' in input) ||
    input.id !== existing.id ||
    !('start' in input) ||
    typeof input.start !== 'number' ||
    !Number.isFinite(input.start) ||
    input.start < 0 ||
    !('end' in input) ||
    typeof input.end !== 'number' ||
    !Number.isFinite(input.end) ||
    input.end <= input.start ||
    !('originalText' in input) ||
    typeof input.originalText !== 'string' ||
    !input.originalText.trim() ||
    !('translatedText' in input) ||
    typeof input.translatedText !== 'string'
  ) {
    throw new Error(
      '字幕内容或时间无效：开始时间须非负，结束时间须晚于开始时间'
    )
  }
  const sourceChanged = input.originalText !== existing.originalText
  return {
    ...existing,
    start: input.start,
    end: input.end,
    originalText: input.originalText.trim(),
    polishedText: sourceChanged ? undefined : existing.polishedText,
    translatedText: input.translatedText.trim(),
    translationStatus: 'reviewed',
  }
}

export async function createImportedSubtitleTask(
  filePath: string,
  settings?: Partial<TaskCreationSettings>
): Promise<TranslationTask> {
  const format = path.extname(filePath).slice(1).toLowerCase()
  if (format !== 'srt' && format !== 'vtt')
    throw new Error('仅支持 SRT / VTT 字幕')
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error('字幕必须为不超过 20 MB 的文件')
  const entries = SubtitleGenerator.parseSubtitleContent(
    await fs.readFile(filePath, 'utf-8'),
    format
  )
  if (!entries.length) throw new Error('文件中没有可识别的字幕')
  const segments = entries.map(entry => ({
    id: randomUUID(),
    start: SubtitleGenerator.parseTime(entry.start),
    end: SubtitleGenerator.parseTime(entry.end),
    originalText: entry.text,
    confidence: 1,
  }))
  if (
    segments.some(
      s =>
        !Number.isFinite(s.start) ||
        !Number.isFinite(s.end) ||
        s.start < 0 ||
        s.end <= s.start
    )
  )
    throw new Error('字幕中存在无效时间范围，请修正后导入')
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const task: TranslationTask = {
    id: randomUUID(),
    kind: 'subtitle',
    status: TaskStatus.COMPLETED,
    progress: 100,
    sourceLanguage: settings?.sourceLanguage || 'auto',
    targetLanguage: settings?.targetLanguage || 'zh',
    options: settings
      ? taskOptionsFromAppSettings(settings)
      : normalizeTaskRuntimeOptions(undefined),
    videoFile: {
      id: randomUUID(),
      name: path.basename(filePath),
      path: filePath,
      format,
      size: stat.size,
      duration: segments.reduce((max, s) => Math.max(max, s.end), 0),
      createdAt: now,
    },
    platformSubtitlePath: filePath,
    segments,
    subtitles: [],
    logs: [],
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  }
  databaseManager.saveVideoFile(task.videoFile)
  databaseManager.createTranslationTask(task)
  task.segments = seedTaskTranscript(task.id, segments)
  return task
}

export async function translateWorkbenchSegment(
  task: TranslationTask,
  segmentId: string
): Promise<TranscriptionSegment> {
  const index = task.segments.findIndex(s => s.id === segmentId)
  const segment = task.segments[index]
  if (!segment) throw new Error('字幕段不存在')
  const options = normalizeTaskRuntimeOptions(task.options)
  const resolved = resolveLlmCompletionConfig(
    {
      llmBaseUrl: options.llmBaseUrl,
      model: options.translateModel,
      apiKey: getLlmApiKey(options.llmServiceId) ?? undefined,
    },
    '翻译'
  )
  if (!resolved.ok) throw new Error(resolved.reason)
  let fallback = false
  const texts = await translateTextBatch(
    [segment.polishedText || segment.originalText],
    {
      client: createCompletionClient(resolved.config),
      sourceLanguage: task.sourceLanguage,
      targetLanguage: task.targetLanguage,
      glossary: options.glossary,
      contextBefore: task.segments
        .slice(Math.max(0, index - 1), index)
        .map(s => s.polishedText || s.originalText),
      contextAfter: task.segments
        .slice(index + 1, index + 2)
        .map(s => s.polishedText || s.originalText),
      onSegmentIssue: issue => {
        if (issue.action === 'fallback') fallback = true
      },
    }
  )
  return {
    ...segment,
    translatedText: texts[0] ?? '',
    translationStatus: fallback ? 'fallback' : 'translated',
  }
}

export async function exportWorkbenchSubtitles(
  task: TranslationTask
): Promise<void> {
  if (!task.segments.length) throw new Error('没有可导出的字幕')
  const options = normalizeTaskRuntimeOptions(task.options)
  const suffixes = resolveSubtitleLanguageSuffixes(
    task.detectedLanguage ?? task.sourceLanguage,
    task.targetLanguage
  )
  const paths = await writeSubtitleArtifacts({
    segments: task.segments,
    outputDir: resolveSubtitleOutputDirectory(
      task.videoFile.path,
      options.subtitleOutputLocation
    ),
    baseName: `${path.parse(task.videoFile.name).name}-校对`,
    ...suffixes,
    colors: {
      originalColor: options.originalSubtitleColor,
      translatedColor: options.translatedSubtitleColor,
    },
  })
  task.outputArtifacts = {
    ...task.outputArtifacts,
    originalSubtitle: paths.original,
    translatedSubtitle: paths.translated,
    bilingualSubtitle: paths.bilingual,
    bilingualAss: paths.bilingualAss,
    outputDirectory: paths.outputDirectory,
  }
  databaseManager.saveTaskArtifacts(task.id, task.outputArtifacts)
}

export function createReusedTask(
  source: TranslationTask,
  options: {
    kind: TaskKind
    targetLanguage: string
    settings?: Partial<TaskCreationSettings>
  }
): TranslationTask {
  if (!source.segments.length) throw new Error('任务尚无可复用的识别结果')
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const task: TranslationTask = {
    ...source,
    id: randomUUID(),
    videoFile: { ...source.videoFile, id: randomUUID() },
    kind: options.kind,
    targetLanguage: options.targetLanguage,
    options: {
      ...(options.settings
        ? taskOptionsFromAppSettings(options.settings)
        : normalizeTaskRuntimeOptions(source.options)),
      burnSubtitles: false,
      subtitleProcessingMode: 'translate',
    },
    status: TaskStatus.PENDING,
    progress: 0,
    errorMessage: undefined,
    completedAt: undefined,
    createdAt: now,
    updatedAt: now,
    outputArtifacts: undefined,
    subtitles: [],
    logs: [],
    segments: source.segments.map(s => ({
      ...s,
      id: randomUUID(),
      polishedText: undefined,
      translatedText: undefined,
      translationStatus: undefined,
    })),
  }
  databaseManager.saveVideoFile(task.videoFile)
  databaseManager.createTranslationTask(task)
  task.segments = seedTaskTranscript(task.id, task.segments)
  return task
}
