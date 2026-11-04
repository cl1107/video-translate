import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { app } from 'electron'
import path from 'node:path'
import { normalizeDetectedLanguage } from '../../../shared/language'
import {
  parseTaskRuntimeOptionsJson,
  serializeTaskRuntimeOptions,
} from '../../../shared/task-options'
import {
  normalizeTaskKind,
  TaskStatus,
  type TaskKind,
  type TaskLog,
  type TaskOutputArtifacts,
  type TaskRuntimeOptions,
  type TranscriptionSegment,
  type TranslationTask,
  type VideoFile,
} from '../../../shared/types/video'

export interface PipelineCheckpoint {
  taskId: string
  asrComplete: boolean
  asrFingerprint?: string
  polishComplete: boolean
  polishFingerprint?: string
  translationComplete: boolean
  translationFingerprint?: string
  translationCompletedCount: number
  documentComplete: boolean
  documentFingerprint?: string
  documentMarkdown?: string
  manualReviewed: boolean
  updatedAt: string
}

export function scopeTranscriptionSegmentId(
  taskId: string,
  segmentId: string,
  index = 0
): string {
  const value = segmentId.trim() || `segment-${index + 1}`
  return value.startsWith(`${taskId}:`) ? value : `${taskId}:${value}`
}

export class DatabaseManager {
  private db: Database.Database
  private dbPath: string

  /**
   * 数据库管理器构造函数，初始化SQLite数据库连接并创建必要的表结构
   */
  constructor() {
    // 数据库文件存储在用户数据目录
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'video-translate.db')

    this.db = new Database(this.dbPath)

    // 启用外键约束
    this.db.pragma('foreign_keys = ON')

    this.initializeDatabase()
  }

  /**
   * 初始化数据库表结构，创建所有必需的表和索引
   */
  private initializeDatabase(): void {
    // 创建视频文件表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS video_files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        duration REAL NOT NULL,
        format TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建翻译任务表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS translation_tasks (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL DEFAULT 0,
        source_language TEXT NOT NULL,
        detected_language TEXT NULL,
        target_language TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        error_message TEXT NULL,
        FOREIGN KEY (video_file_id) REFERENCES video_files (id)
      )
    `)

    // 创建转录段落表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcription_segments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        original_text TEXT NOT NULL,
        polished_text TEXT NULL,
        translated_text TEXT NULL,
        translation_status TEXT NULL,
        confidence REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES translation_tasks (id)
      )
    `)

    // 任务级断点：只有 asr_complete=true 才允许把识别结果当作完整结果恢复。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
        task_id TEXT PRIMARY KEY,
        asr_complete INTEGER NOT NULL DEFAULT 0,
        asr_fingerprint TEXT NULL,
        polish_complete INTEGER NOT NULL DEFAULT 0,
        polish_fingerprint TEXT NULL,
        translation_complete INTEGER NOT NULL DEFAULT 0,
        translation_fingerprint TEXT NULL,
        translation_completed_count INTEGER NOT NULL DEFAULT 0,
        document_complete INTEGER NOT NULL DEFAULT 0,
        document_fingerprint TEXT NULL,
        document_markdown TEXT NULL,
        manual_reviewed INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL,
        FOREIGN KEY (task_id) REFERENCES translation_tasks (id) ON DELETE CASCADE
      )
    `)

    // 兼容旧库：补充润色字段
    const segmentColumns = this.db
      .prepare(`PRAGMA table_info(transcription_segments)`)
      .all() as Array<{ name: string }>
    if (!segmentColumns.some(column => column.name === 'polished_text')) {
      this.db.exec(
        `ALTER TABLE transcription_segments ADD COLUMN polished_text TEXT NULL`
      )
    }
    if (!segmentColumns.some(column => column.name === 'translation_status')) {
      this.db.exec(
        `ALTER TABLE transcription_segments ADD COLUMN translation_status TEXT NULL`
      )
    }

    // 创建任务日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        FOREIGN KEY (task_id) REFERENCES translation_tasks (id)
      )
    `)

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON translation_tasks (status);
      CREATE INDEX IF NOT EXISTS idx_segments_task ON transcription_segments (task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON translation_tasks (created_at);
    `)

    this.migrateTaskColumns()
  }

  /** 兼容旧库：任务运行配置与产物路径一等字段 */
  private migrateTaskColumns(): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(translation_tasks)`)
      .all() as Array<{ name: string }>
    const names = new Set(columns.map(c => c.name))
    if (!names.has('options_json')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN options_json TEXT NULL`
      )
    }
    if (!names.has('artifacts_json')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN artifacts_json TEXT NULL`
      )
    }
    if (!names.has('source_url')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN source_url TEXT NULL`
      )
    }
    if (!names.has('platform_subtitle_path')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN platform_subtitle_path TEXT NULL`
      )
    }
    if (!names.has('platform_subtitle_language')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN platform_subtitle_language TEXT NULL`
      )
    }
    if (!names.has('kind')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'subtitle'`
      )
    }
    if (!names.has('detected_language')) {
      this.db.exec(
        `ALTER TABLE translation_tasks ADD COLUMN detected_language TEXT NULL`
      )
    }

    const videoColumns = this.db
      .prepare(`PRAGMA table_info(video_files)`)
      .all() as Array<{ name: string }>
    const videoNames = new Set(videoColumns.map(c => c.name))
    if (!videoNames.has('source_url')) {
      this.db.exec(`ALTER TABLE video_files ADD COLUMN source_url TEXT NULL`)
    }
  }

  private parseArtifactsJson(
    json: string | null | undefined
  ): TaskOutputArtifacts | undefined {
    if (!json) return undefined
    try {
      const parsed = JSON.parse(json) as TaskOutputArtifacts
      if (!parsed || typeof parsed !== 'object') return undefined
      if (typeof parsed.outputDirectory !== 'string') return undefined
      return parsed
    } catch {
      return undefined
    }
  }

  private mapTaskRow(row: Record<string, unknown>): TranslationTask {
    const taskId = String(row.id)
    const segments = this.getTranscriptionSegments(taskId)
    const sourceUrl =
      (row.source_url as string | null | undefined) ||
      (row.video_source_url as string | null | undefined) ||
      undefined
    return {
      id: taskId,
      videoFile: {
        id: String(row.video_file_id),
        name: String(row.video_name),
        path: String(row.video_path),
        size: Number(row.video_size),
        duration: Number(row.video_duration),
        format: String(row.video_format),
        createdAt: String(row.video_created_at),
        sourceUrl:
          (row.video_source_url as string | null | undefined) || sourceUrl,
      },
      kind: normalizeTaskKind(row.kind),
      status: row.status as TaskStatus,
      progress: Number(row.progress ?? 0),
      sourceLanguage: String(row.source_language),
      detectedLanguage: normalizeDetectedLanguage(
        row.detected_language as string | null | undefined
      ),
      targetLanguage: String(row.target_language),
      options: parseTaskRuntimeOptionsJson(
        row.options_json as string | null | undefined
      ),
      outputArtifacts: this.parseArtifactsJson(
        row.artifacts_json as string | null | undefined
      ),
      sourceUrl,
      platformSubtitlePath:
        (row.platform_subtitle_path as string | null | undefined) || undefined,
      platformSubtitleLanguage:
        (row.platform_subtitle_language as string | null | undefined) ||
        undefined,
      segments,
      subtitles: [],
      logs: [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: (row.completed_at as string | null) || undefined,
      errorMessage: (row.error_message as string | null) || undefined,
    }
  }

  /**
   * 保存视频文件信息
   */
  /**
   * 保存视频文件信息到数据库
   * @param videoFile - 视频文件对象
   */
  saveVideoFile(videoFile: VideoFile): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO video_files
      (id, name, path, size, duration, format, created_at, source_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      videoFile.id,
      videoFile.name,
      videoFile.path,
      videoFile.size,
      videoFile.duration,
      videoFile.format,
      videoFile.createdAt,
      videoFile.sourceUrl || null
    )
  }

  /** 更新已下载视频的元数据（路径/时长等），只更新既有记录。 */
  updateVideoFile(videoFile: VideoFile): void {
    this.db
      .prepare(
        `UPDATE video_files
         SET name = ?, path = ?, size = ?, duration = ?, format = ?,
             created_at = ?, source_url = ?
         WHERE id = ?`
      )
      .run(
        videoFile.name,
        videoFile.path,
        videoFile.size,
        videoFile.duration,
        videoFile.format,
        videoFile.createdAt,
        videoFile.sourceUrl || null,
        videoFile.id
      )
  }

  /**
   * 获取视频文件信息
   */
  /**
   * 根据ID获取视频文件信息
   * @param id - 视频文件ID
   * @returns 返回视频文件对象，如果不存在则返回null
   */
  getVideoFile(id: string): VideoFile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM video_files WHERE id = ?
    `)

    const row = stmt.get(id) as any
    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      path: row.path,
      size: row.size,
      duration: row.duration,
      format: row.format,
      createdAt: row.created_at,
      sourceUrl: row.source_url || undefined,
    }
  }

  /**
   * 创建翻译任务
   */
  /**
   * 创建新的翻译任务记录
   * @param task - 翻译任务对象（不包含segments、subtitles、logs字段）
   */
  createTranslationTask(
    task: Omit<TranslationTask, 'segments' | 'subtitles' | 'logs'>
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO translation_tasks
      (id, video_file_id, status, progress, source_language, detected_language, target_language,
       created_at, updated_at, completed_at, error_message, options_json, artifacts_json,
       source_url, platform_subtitle_path, platform_subtitle_language, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      task.id,
      task.videoFile.id,
      task.status,
      task.progress,
      task.sourceLanguage,
      task.detectedLanguage || null,
      task.targetLanguage,
      task.createdAt,
      task.updatedAt,
      task.completedAt || null,
      task.errorMessage || null,
      task.options ? serializeTaskRuntimeOptions(task.options) : null,
      task.outputArtifacts ? JSON.stringify(task.outputArtifacts) : null,
      task.sourceUrl || task.videoFile.sourceUrl || null,
      task.platformSubtitlePath || null,
      task.platformSubtitleLanguage || null,
      normalizeTaskKind(task.kind)
    )
  }

  /** 持久化 ASR / 平台字幕实际检测语言；undefined 表示清空。 */
  saveDetectedLanguage(
    taskId: string,
    language: TranslationTask['detectedLanguage']
  ): void {
    const stmt = this.db.prepare(`
      UPDATE translation_tasks
      SET detected_language = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(language || null, dayjs().format('YYYY-MM-DD HH:mm:ss'), taskId)
  }

  /** 更新平台字幕路径（下载后写入；可清空） */
  savePlatformSubtitle(
    taskId: string,
    pathValue: string | null | undefined,
    language?: string | null
  ): void {
    const stmt = this.db.prepare(`
      UPDATE translation_tasks
      SET platform_subtitle_path = ?, platform_subtitle_language = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(
      pathValue || null,
      language || null,
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      taskId
    )
  }

  /** 持久化任务运行配置 */
  saveTaskOptions(taskId: string, options: TaskRuntimeOptions): void {
    const stmt = this.db.prepare(`
      UPDATE translation_tasks
      SET options_json = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(
      serializeTaskRuntimeOptions(options),
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      taskId
    )
  }

  /** 持久化产物路径（不再依赖日志解析） */
  saveTaskArtifacts(taskId: string, artifacts: TaskOutputArtifacts): void {
    const stmt = this.db.prepare(`
      UPDATE translation_tasks
      SET artifacts_json = ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(
      JSON.stringify(artifacts),
      dayjs().format('YYYY-MM-DD HH:mm:ss'),
      taskId
    )
  }

  /** 合并更新产物路径中的部分字段 */
  mergeTaskArtifacts(
    taskId: string,
    partial: Partial<TaskOutputArtifacts>
  ): TaskOutputArtifacts {
    const existing = this.getTranslationTask(taskId)?.outputArtifacts
    const merged: TaskOutputArtifacts = {
      outputDirectory:
        partial.outputDirectory || existing?.outputDirectory || '',
      originalSubtitle: partial.originalSubtitle ?? existing?.originalSubtitle,
      translatedSubtitle:
        partial.translatedSubtitle ?? existing?.translatedSubtitle,
      bilingualSubtitle:
        partial.bilingualSubtitle ?? existing?.bilingualSubtitle,
      bilingualAss: partial.bilingualAss ?? existing?.bilingualAss,
      burnedVideo: partial.burnedVideo ?? existing?.burnedVideo,
      polishedMarkdown: partial.polishedMarkdown ?? existing?.polishedMarkdown,
    }
    this.saveTaskArtifacts(taskId, merged)
    return merged
  }

  /**
   * 更新任务状态
   */
  /**
   * 更新翻译任务状态
   * @param taskId - 任务ID
   * @param status - 新的任务状态
   * @param progress - 任务进度（可选，0-100）
   * @param errorMessage - 错误消息（可选）
   */
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    errorMessage?: string
  ): void {
    const updates: string[] = ['status = ?', 'updated_at = ?']
    const values: any[] = [status, dayjs().format('YYYY-MM-DD HH:mm:ss')]

    if (progress !== undefined) {
      updates.push('progress = ?')
      values.push(progress)
    }

    if (errorMessage !== undefined) {
      updates.push('error_message = ?')
      values.push(errorMessage)
    }

    if (status === TaskStatus.COMPLETED) {
      updates.push('completed_at = ?')
      values.push(dayjs().format('YYYY-MM-DD HH:mm:ss'))
    }

    const stmt = this.db.prepare(`
      UPDATE translation_tasks
      SET ${updates.join(', ')}
      WHERE id = ?
    `)

    values.push(taskId)
    stmt.run(...values)
  }

  /**
   * 获取翻译任务
   */
  /**
   * 根据ID获取翻译任务详情
   * @param taskId - 任务ID
   * @returns 返回完整的翻译任务对象，包含视频信息和转录段落，如果不存在则返回null
   */
  getTranslationTask(taskId: string): TranslationTask | null {
    const stmt = this.db.prepare(`
      SELECT t.*, v.name as video_name, v.path as video_path, v.size as video_size,
             v.duration as video_duration, v.format as video_format, v.created_at as video_created_at,
             v.source_url as video_source_url
      FROM translation_tasks t
      JOIN video_files v ON t.video_file_id = v.id
      WHERE t.id = ?
    `)

    const row = stmt.get(taskId) as Record<string, unknown> | undefined
    if (!row) return null
    return this.mapTaskRow(row)
  }

  /**
   * 获取所有翻译任务列表（按创建时间倒序）
   */
  getAllTranslationTasks(kind?: TaskKind): TranslationTask[] {
    const base = `
      SELECT t.*, v.name as video_name, v.path as video_path, v.size as video_size,
             v.duration as video_duration, v.format as video_format, v.created_at as video_created_at,
             v.source_url as video_source_url
      FROM translation_tasks t
      JOIN video_files v ON t.video_file_id = v.id
    `
    const stmt = kind
      ? this.db.prepare(
          `${base} WHERE COALESCE(t.kind, 'subtitle') = ? ORDER BY t.created_at DESC`
        )
      : this.db.prepare(`${base} ORDER BY t.created_at DESC`)

    const rows = (kind ? stmt.all(kind) : stmt.all()) as Array<
      Record<string, unknown>
    >
    return rows.map(row => this.mapTaskRow(row))
  }

  /**
   * 保存转录段落
   */
  /**
   * 保存转录段落到数据库
   * @param taskId - 关联的任务ID
   * @param segments - 转录段落数组
   */
  saveTranscriptionSegments(
    taskId: string,
    segments: TranscriptionSegment[]
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO transcription_segments
      (id, task_id, start_time, end_time, original_text, polished_text,
       translated_text, translation_status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction((items: TranscriptionSegment[]) => {
      for (const [index, segment] of items.entries()) {
        stmt.run(
          scopeTranscriptionSegmentId(taskId, segment.id, index),
          taskId,
          segment.start,
          segment.end,
          segment.originalText,
          segment.polishedText || null,
          segment.translatedText || null,
          segment.translationStatus || null,
          segment.confidence
        )
      }
    })

    transaction(segments)
  }

  /** 用完整识别快照替换任务段落，避免旧 partial 与新结果混存。 */
  seedTaskTranscript(
    taskId: string,
    segments: TranscriptionSegment[]
  ): TranscriptionSegment[] {
    const normalized = segments.map((segment, index) => ({
      ...segment,
      id: scopeTranscriptionSegmentId(taskId, segment.id, index),
    }))
    const deleteStmt = this.db.prepare(
      'DELETE FROM transcription_segments WHERE task_id = ?'
    )
    const insertStmt = this.db.prepare(`
      INSERT INTO transcription_segments
      (id, task_id, start_time, end_time, original_text, polished_text,
       translated_text, translation_status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const transaction = this.db.transaction(() => {
      deleteStmt.run(taskId)
      for (const segment of normalized) {
        insertStmt.run(
          segment.id,
          taskId,
          segment.start,
          segment.end,
          segment.originalText,
          segment.polishedText || null,
          segment.translatedText || null,
          segment.translationStatus || null,
          segment.confidence
        )
      }
    })
    transaction()
    return normalized
  }

  /**
   * 获取转录段落
   */
  /**
   * 获取指定任务的所有转录段落
   * @param taskId - 任务ID
   * @returns 返回按开始时间排序的转录段落数组
   */
  /** 清空任务既有分段；重试前调用，避免旧识别残留与新结果混存 */
  deleteTranscriptionSegments(taskId: string): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM transcription_segments WHERE task_id = ?')
        .run(taskId)
      // 重试必须同时清除所有阶段断点，尤其是文稿 Markdown，避免复用旧结果。
      this.db
        .prepare('DELETE FROM pipeline_checkpoints WHERE task_id = ?')
        .run(taskId)
    })
    transaction()
  }

  getPipelineCheckpoint(taskId: string): PipelineCheckpoint {
    const row = this.db
      .prepare('SELECT * FROM pipeline_checkpoints WHERE task_id = ?')
      .get(taskId) as Record<string, unknown> | undefined
    if (!row) {
      return {
        taskId,
        asrComplete: false,
        polishComplete: false,
        translationComplete: false,
        translationCompletedCount: 0,
        documentComplete: false,
        manualReviewed: false,
        updatedAt: '',
      }
    }
    return {
      taskId,
      asrComplete: Number(row.asr_complete) === 1,
      asrFingerprint: (row.asr_fingerprint as string | null) || undefined,
      polishComplete: Number(row.polish_complete) === 1,
      polishFingerprint: (row.polish_fingerprint as string | null) || undefined,
      translationComplete: Number(row.translation_complete) === 1,
      translationFingerprint:
        (row.translation_fingerprint as string | null) || undefined,
      translationCompletedCount: Number(row.translation_completed_count || 0),
      documentComplete: Number(row.document_complete) === 1,
      documentFingerprint:
        (row.document_fingerprint as string | null) || undefined,
      documentMarkdown: (row.document_markdown as string | null) || undefined,
      manualReviewed: Number(row.manual_reviewed) === 1,
      updatedAt: String(row.updated_at || ''),
    }
  }

  updatePipelineCheckpoint(
    taskId: string,
    patch: Partial<Omit<PipelineCheckpoint, 'taskId' | 'updatedAt'>>
  ): void {
    const current = this.getPipelineCheckpoint(taskId)
    const next = { ...current, ...patch }
    const updatedAt = dayjs().format('YYYY-MM-DD HH:mm:ss')
    this.db
      .prepare(`
        INSERT INTO pipeline_checkpoints
        (task_id, asr_complete, asr_fingerprint, polish_complete,
         polish_fingerprint, translation_complete, translation_fingerprint,
         translation_completed_count, document_complete, document_fingerprint,
         document_markdown, manual_reviewed, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          asr_complete = excluded.asr_complete,
          asr_fingerprint = excluded.asr_fingerprint,
          polish_complete = excluded.polish_complete,
          polish_fingerprint = excluded.polish_fingerprint,
          translation_complete = excluded.translation_complete,
          translation_fingerprint = excluded.translation_fingerprint,
          translation_completed_count = excluded.translation_completed_count,
          document_complete = excluded.document_complete,
          document_fingerprint = excluded.document_fingerprint,
          document_markdown = excluded.document_markdown,
          manual_reviewed = excluded.manual_reviewed,
          updated_at = excluded.updated_at
      `)
      .run(
        taskId,
        next.asrComplete ? 1 : 0,
        next.asrFingerprint || null,
        next.polishComplete ? 1 : 0,
        next.polishFingerprint || null,
        next.translationComplete ? 1 : 0,
        next.translationFingerprint || null,
        next.translationCompletedCount,
        next.documentComplete ? 1 : 0,
        next.documentFingerprint || null,
        next.documentMarkdown || null,
        next.manualReviewed ? 1 : 0,
        updatedAt
      )
  }

  clearPolishAndTranslation(taskId: string): void {
    this.db
      .prepare(
        `UPDATE transcription_segments
         SET polished_text = NULL, translated_text = NULL,
             translation_status = NULL
         WHERE task_id = ?`
      )
      .run(taskId)
  }

  clearTranslationResults(taskId: string): void {
    this.db
      .prepare(
        `UPDATE transcription_segments
         SET translated_text = NULL, translation_status = NULL
         WHERE task_id = ?`
      )
      .run(taskId)
  }

  getTranscriptionSegments(taskId: string): TranscriptionSegment[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transcription_segments
      WHERE task_id = ?
      ORDER BY start_time ASC, id ASC
    `)

    const rows = stmt.all(taskId) as any[]

    return rows.map(row => ({
      id: row.id,
      start: row.start_time,
      end: row.end_time,
      originalText: row.original_text,
      polishedText: row.polished_text || undefined,
      translatedText: row.translated_text || undefined,
      translationStatus:
        row.translation_status === 'translated' ||
        row.translation_status === 'fallback' ||
        row.translation_status === 'reviewed'
          ? row.translation_status
          : undefined,
      confidence: row.confidence,
    }))
  }

  /**
   * 更新段落翻译
   */
  /**
   * 更新单个段落的翻译文本
   * @param segmentId - 段落ID
   * @param translatedText - 翻译后的文本
   */
  updateSegmentTranslation(segmentId: string, translatedText: string): void {
    const stmt = this.db.prepare(`
      UPDATE transcription_segments
      SET translated_text = ?, translation_status = 'translated'
      WHERE id = ?
    `)

    stmt.run(translatedText, segmentId)
  }

  /**
   * 删除翻译任务
   */
  /**
   * 删除翻译任务及其相关数据
   * @param taskId - 要删除的任务ID
   * @note 此操作会删除任务的所有日志、转录段落，并在没有其他任务引用时删除视频文件记录
   */
  deleteTranslationTask(taskId: string): void {
    const transaction = this.db.transaction(() => {
      // 首先获取视频文件ID，在删除任务之前
      const videoFileStmt = this.db.prepare(`
        SELECT video_file_id FROM translation_tasks WHERE id = ?
      `)
      const videoFileId = videoFileStmt.get(taskId) as any

      // 删除任务日志
      this.db.prepare('DELETE FROM task_logs WHERE task_id = ?').run(taskId)

      // 删除转录段落
      this.db
        .prepare('DELETE FROM transcription_segments WHERE task_id = ?')
        .run(taskId)

      // 删除任务
      const taskStmt = this.db.prepare(
        'DELETE FROM translation_tasks WHERE id = ?'
      )
      taskStmt.run(taskId)

      // 检查是否需要删除视频文件记录
      if (videoFileId?.video_file_id) {
        // 检查是否还有其他任务使用这个视频文件
        const countStmt = this.db.prepare(`
          SELECT COUNT(*) as count FROM translation_tasks WHERE video_file_id = ?
        `)
        const count = countStmt.get(videoFileId?.video_file_id) as any

        if (count.count === 0) {
          // 没有其他任务使用，可以删除视频文件记录
          this.db
            .prepare('DELETE FROM video_files WHERE id = ?')
            .run(videoFileId.video_file_id)
        }
      }
    })

    transaction()
  }

  /**
   * 添加任务日志
   */
  /**
   * 添加任务日志记录
   * @param taskId - 任务ID
   * @param log - 日志对象（不包含id字段）
   */
  addTaskLog(taskId: string, log: Omit<TaskLog, 'id'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_logs (id, task_id, timestamp, level, message, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const logId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    stmt.run(
      logId,
      taskId,
      log.timestamp,
      log.level,
      log.message,
      log.details || null
    )
  }

  /**
   * 获取任务日志
   */
  /**
   * 获取指定任务的所有日志记录
   * @param taskId - 任务ID
   * @returns 返回按时间戳排序的日志记录数组
   */
  getTaskLogs(taskId: string): TaskLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM task_logs
      WHERE task_id = ?
      ORDER BY timestamp ASC
    `)

    const rows = stmt.all(taskId) as any[]
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      details: row.details,
    }))
  }

  /**
   * 清除任务日志
   */
  /**
   * 清除指定任务的所有日志记录
   * @param taskId - 任务ID
   */
  clearTaskLogs(taskId: string): void {
    const stmt = this.db.prepare('DELETE FROM task_logs WHERE task_id = ?')
    stmt.run(taskId)
  }

  /**
   * 更新翻译后的段落
   */
  /**
   * 批量更新段落的翻译文本
   * @param taskId - 任务ID
   * @param segments - 包含翻译结果的段落数组
   */
  updateTranslatedSegments(
    taskId: string,
    segments: TranscriptionSegment[]
  ): void {
    const stmt = this.db.prepare(`
      UPDATE transcription_segments
      SET polished_text = ?, translated_text = ?, translation_status = ?
      WHERE task_id = ? AND id = ?
    `)

    const transaction = this.db.transaction(() => {
      for (const segment of segments) {
        stmt.run(
          segment.polishedText || null,
          segment.translatedText || null,
          segment.translationStatus || null,
          taskId,
          scopeTranscriptionSegmentId(taskId, segment.id)
        )
      }
    })

    transaction()
  }

  /**
   * 用显示段整体替换任务段落（合并/润色/翻译后的权威结果）。
   */
  replaceTranscriptionSegments(
    taskId: string,
    segments: TranscriptionSegment[]
  ): void {
    const deleteStmt = this.db.prepare(
      'DELETE FROM transcription_segments WHERE task_id = ?'
    )
    const insertStmt = this.db.prepare(`
      INSERT INTO transcription_segments
      (id, task_id, start_time, end_time, original_text, polished_text,
       translated_text, translation_status, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      deleteStmt.run(taskId)
      for (const segment of segments) {
        insertStmt.run(
          segment.id,
          taskId,
          segment.start,
          segment.end,
          segment.originalText,
          segment.polishedText || null,
          segment.translatedText || null,
          segment.translationStatus || null,
          segment.confidence
        )
      }
    })

    transaction()
  }

  /**
   * 获取数据库统计信息
   */
  /**
   * 获取数据库统计信息
   * @returns 返回包含任务和视频统计数据的对象
   */
  getStatistics(): {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    totalVideos: number
  } {
    const taskStats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM translation_tasks
    `
      )
      .get() as any

    const videoStats = this.db
      .prepare(
        `
      SELECT COUNT(*) as total FROM video_files
    `
      )
      .get() as any

    return {
      totalTasks: taskStats.total,
      completedTasks: taskStats.completed,
      failedTasks: taskStats.failed,
      totalVideos: videoStats.total,
    }
  }

  /**
   * 清理数据库
   */
  /**
   * 清理数据库，执行VACUUM操作优化数据库文件
   */
  cleanup(): void {
    this.db.exec('VACUUM')
  }

  /**
   * 关闭数据库连接
   */
  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }
}

// 单例实例
export const databaseManager = new DatabaseManager()
