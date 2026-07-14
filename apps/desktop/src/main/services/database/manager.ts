import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { app } from 'electron'
import path from 'node:path'
import {
  TaskStatus,
  type TaskLog,
  type TranscriptionSegment,
  type TranslationTask,
  type VideoFile,
} from '../../../shared/types/video'

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
        confidence REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES translation_tasks (id)
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
      (id, name, path, size, duration, format, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      videoFile.id,
      videoFile.name,
      videoFile.path,
      videoFile.size,
      videoFile.duration,
      videoFile.format,
      videoFile.createdAt
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
      (id, video_file_id, status, progress, source_language, target_language, created_at, updated_at, completed_at, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      task.id,
      task.videoFile.id,
      task.status,
      task.progress,
      task.sourceLanguage,
      task.targetLanguage,
      task.createdAt,
      task.updatedAt,
      task.completedAt || null,
      task.errorMessage || null
    )
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
             v.duration as video_duration, v.format as video_format, v.created_at as video_created_at
      FROM translation_tasks t
      JOIN video_files v ON t.video_file_id = v.id
      WHERE t.id = ?
    `)

    const row = stmt.get(taskId) as any
    if (!row) return null

    // 获取转录段落
    const segments = this.getTranscriptionSegments(taskId)

    return {
      id: row.id,
      videoFile: {
        id: row.video_file_id,
        name: row.video_name,
        path: row.video_path,
        size: row.video_size,
        duration: row.video_duration,
        format: row.video_format,
        createdAt: row.video_created_at,
      },
      status: row.status as TaskStatus,
      progress: row.progress,
      sourceLanguage: row.source_language,
      targetLanguage: row.target_language,
      segments,
      subtitles: [], // 从段落生成
      logs: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
    }
  }

  /**
   * 获取所有翻译任务
   */
  /**
   * 获取所有翻译任务列表
   * @returns 返回按创建时间倒序排列的翻译任务数组
   */
  getAllTranslationTasks(): TranslationTask[] {
    const stmt = this.db.prepare(`
      SELECT t.*, v.name as video_name, v.path as video_path, v.size as video_size,
             v.duration as video_duration, v.format as video_format, v.created_at as video_created_at
      FROM translation_tasks t
      JOIN video_files v ON t.video_file_id = v.id
      ORDER BY t.created_at DESC
    `)

    const rows = stmt.all() as any[]

    return rows.map(row => {
      const segments = this.getTranscriptionSegments(row.id)

      return {
        id: row.id,
        videoFile: {
          id: row.video_file_id,
          name: row.video_name,
          path: row.video_path,
          size: row.video_size,
          duration: row.video_duration,
          format: row.video_format,
          createdAt: row.video_created_at,
        },
        status: row.status as TaskStatus,
        progress: row.progress,
        sourceLanguage: row.source_language,
        targetLanguage: row.target_language,
        segments: segments,
        subtitles: [],
        logs: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
      }
    })
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
      (id, task_id, start_time, end_time, original_text, polished_text, translated_text, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(
      (segments: TranscriptionSegment[]) => {
        for (const segment of segments) {
          stmt.run(
            segment.id,
            taskId,
            segment.start,
            segment.end,
            segment.originalText,
            segment.polishedText || null,
            segment.translatedText || null,
            segment.confidence
          )
        }
      }
    )

    transaction(segments)
  }

  /**
   * 获取转录段落
   */
  /**
   * 获取指定任务的所有转录段落
   * @param taskId - 任务ID
   * @returns 返回按开始时间排序的转录段落数组
   */
  getTranscriptionSegments(taskId: string): TranscriptionSegment[] {
    const stmt = this.db.prepare(`
      SELECT * FROM transcription_segments
      WHERE task_id = ?
      ORDER BY start_time ASC
    `)

    const rows = stmt.all(taskId) as any[]

    return rows.map(row => ({
      id: row.id,
      start: row.start_time,
      end: row.end_time,
      originalText: row.original_text,
      polishedText: row.polished_text || undefined,
      translatedText: row.translated_text,
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
      SET translated_text = ?
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
      SET polished_text = ?, translated_text = ?
      WHERE id = ?
    `)

    const transaction = this.db.transaction(() => {
      for (const segment of segments) {
        stmt.run(
          segment.polishedText || null,
          segment.translatedText || null,
          segment.id
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
      (id, task_id, start_time, end_time, original_text, polished_text, translated_text, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
