use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use super::{
    model::{
        Segment, TaskKind, TaskLog, TaskOutputArtifacts, TaskStatus, TranslationStatus,
        TranslationTask, VideoFile, new_id, now,
    },
    paths::{db_path, ensure_dir},
};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open_default() -> Result<Self, String> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            ensure_dir(parent).map_err(|err| err.to_string())?;
        }
        Self::open_path(&path)
    }

    pub fn open_path(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|err| err.to_string())?;
        let db = Self { conn };
        db.init()?;
        Ok(db)
    }

    pub fn open_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|err| err.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|err| err.to_string())?;
        let db = Self { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS video_files (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    duration REAL NOT NULL,
                    format TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    source_url TEXT
                );
                CREATE TABLE IF NOT EXISTS translation_tasks (
                    id TEXT PRIMARY KEY,
                    video_file_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress REAL DEFAULT 0,
                    source_language TEXT NOT NULL,
                    detected_language TEXT,
                    target_language TEXT NOT NULL,
                    options_json TEXT,
                    source_url TEXT,
                    platform_subtitle_path TEXT,
                    platform_subtitle_language TEXT,
                    error_message TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    artifacts_json TEXT,
                    FOREIGN KEY (video_file_id) REFERENCES video_files (id)
                );
                CREATE TABLE IF NOT EXISTS transcription_segments (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    start_time REAL NOT NULL,
                    end_time REAL NOT NULL,
                    original_text TEXT NOT NULL,
                    polished_text TEXT,
                    translated_text TEXT,
                    translation_status TEXT,
                    confidence REAL DEFAULT 0,
                    FOREIGN KEY (task_id) REFERENCES translation_tasks (id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS task_logs (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    details TEXT,
                    FOREIGN KEY (task_id) REFERENCES translation_tasks (id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_updated ON translation_tasks (updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_segments_task ON transcription_segments (task_id);
                ",
            )
            .map_err(|err| err.to_string())
    }

    pub fn upsert_task(&self, task: &TranslationTask) -> Result<(), String> {
        let transaction = self
            .conn
            .unchecked_transaction()
            .map_err(|err| err.to_string())?;
        transaction
            .execute(
                "INSERT INTO video_files
                (id, name, path, size, duration, format, created_at, source_url)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, size=excluded.size, duration=excluded.duration, format=excluded.format, source_url=excluded.source_url",
                params![
                    task.video_file.id,
                    task.video_file.name,
                    task.video_file.path,
                    task.video_file.size as i64,
                    task.video_file.duration,
                    task.video_file.format,
                    task.video_file.created_at.to_rfc3339(),
                    task.video_file.source_url,
                ],
            )
            .map_err(|err| err.to_string())?;
        let options = serde_json::to_string(&task.options).map_err(|err| err.to_string())?;
        let artifacts = task
            .output_artifacts
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|err| err.to_string())?;
        transaction
            .execute(
                "INSERT INTO translation_tasks
                (id, video_file_id, kind, status, progress, source_language, detected_language,
                 target_language, options_json, source_url, platform_subtitle_path,
                 platform_subtitle_language, error_message, created_at, updated_at, completed_at,
                 artifacts_json)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                ON CONFLICT(id) DO UPDATE SET video_file_id=excluded.video_file_id, kind=excluded.kind,
                status=excluded.status, progress=excluded.progress, source_language=excluded.source_language,
                detected_language=excluded.detected_language, target_language=excluded.target_language,
                options_json=excluded.options_json, source_url=excluded.source_url,
                platform_subtitle_path=excluded.platform_subtitle_path, platform_subtitle_language=excluded.platform_subtitle_language,
                error_message=excluded.error_message, updated_at=excluded.updated_at,
                completed_at=excluded.completed_at, artifacts_json=excluded.artifacts_json",
                params![
                    task.id,
                    task.video_file.id,
                    task.kind.as_str(),
                    task.status.as_str(),
                    task.progress,
                    task.source_language,
                    task.detected_language,
                    task.target_language,
                    options,
                    task.source_url,
                    task.platform_subtitle_path,
                    task.platform_subtitle_language,
                    task.error_message,
                    task.created_at.to_rfc3339(),
                    task.updated_at.to_rfc3339(),
                    task.completed_at.map(|t| t.to_rfc3339()),
                    artifacts,
                ],
            )
            .map_err(|err| err.to_string())?;
        transaction
            .execute(
                "DELETE FROM transcription_segments WHERE task_id = ?1",
                params![task.id],
            )
            .map_err(|err| err.to_string())?;
        for segment in &task.segments {
            transaction
                .execute(
                    "INSERT INTO transcription_segments
                    (id, task_id, start_time, end_time, original_text, polished_text, translated_text, translation_status, confidence)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        segment.id,
                        task.id,
                        segment.start,
                        segment.end,
                        segment.original_text,
                        segment.polished_text,
                        segment.translated_text,
                        segment.translation_status.map(|s| s.as_str().to_string()),
                        segment.confidence,
                    ],
                )
                .map_err(|err| err.to_string())?;
        }
        for log in &task.logs {
            transaction.execute(
                "INSERT INTO task_logs (id, task_id, timestamp, level, message, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO NOTHING",
                params![log.id, task.id, log.timestamp.to_rfc3339(), log.level, log.message, log.details],
            ).map_err(|err| err.to_string())?;
        }
        transaction.commit().map_err(|err| err.to_string())
    }

    pub fn add_log(&self, task_id: &str, log: &TaskLog) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO task_logs (id, task_id, timestamp, level, message, details)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO NOTHING",
                params![
                    log.id,
                    task_id,
                    log.timestamp.to_rfc3339(),
                    log.level,
                    log.message,
                    log.details
                ],
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn delete_task(&self, task_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM transcription_segments WHERE task_id = ?1",
                params![task_id],
            )
            .map_err(|err| err.to_string())?;
        self.conn
            .execute("DELETE FROM task_logs WHERE task_id = ?1", params![task_id])
            .map_err(|err| err.to_string())?;
        self.conn
            .execute(
                "DELETE FROM translation_tasks WHERE id = ?1",
                params![task_id],
            )
            .map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<TranslationTask>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT t.id FROM translation_tasks t ORDER BY t.updated_at DESC")
            .map_err(|err| err.to_string())?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|err| err.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|err| err.to_string())?;
        ids.into_iter().map(|id| self.load_task(&id)).collect()
    }

    pub fn load_task(&self, id: &str) -> Result<TranslationTask, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT t.id, t.kind, t.status, t.progress, t.source_language, t.detected_language,
                        t.target_language, t.options_json, t.source_url, t.platform_subtitle_path,
                        t.platform_subtitle_language, t.error_message, t.created_at, t.updated_at,
                        t.completed_at, t.artifacts_json,
                        v.id, v.name, v.path, v.size, v.duration, v.format, v.created_at, v.source_url
                 FROM translation_tasks t
                 JOIN video_files v ON v.id = t.video_file_id
                 WHERE t.id = ?1",
            )
            .map_err(|err| err.to_string())?;
        let task = stmt
            .query_row(params![id], |row| {
                let options: String = row.get(7)?;
                let artifacts: Option<String> = row.get(15)?;
                let created: String = row.get(12)?;
                let updated: String = row.get(13)?;
                let completed: Option<String> = row.get(14)?;
                let video_created: String = row.get(22)?;
                Ok(TranslationTask {
                    id: row.get(0)?,
                    kind: TaskKind::parse(&row.get::<_, String>(1)?),
                    status: TaskStatus::parse(&row.get::<_, String>(2)?),
                    progress: row.get(3)?,
                    source_language: row.get(4)?,
                    detected_language: row.get(5)?,
                    target_language: row.get(6)?,
                    options: serde_json::from_str(&options).unwrap_or_else(|_| {
                        crate::domain::settings::AppSettings::default().to_runtime(
                            super::model::SubtitleProcessingMode::Extract,
                            false,
                            super::model::SubtitleBurnMode::Bilingual,
                        )
                    }),
                    source_url: row.get(8)?,
                    platform_subtitle_path: row.get(9)?,
                    platform_subtitle_language: row.get(10)?,
                    error_message: row.get(11)?,
                    created_at: parse_time(&created),
                    updated_at: parse_time(&updated),
                    completed_at: completed.as_deref().map(parse_time),
                    output_artifacts: artifacts
                        .as_deref()
                        .and_then(|raw| serde_json::from_str::<TaskOutputArtifacts>(raw).ok()),
                    video_file: VideoFile {
                        id: row.get(16)?,
                        name: row.get(17)?,
                        path: row.get(18)?,
                        size: row.get::<_, i64>(19)? as u64,
                        duration: row.get(20)?,
                        format: row.get(21)?,
                        created_at: parse_time(&video_created),
                        source_url: row.get(23)?,
                    },
                    segments: Vec::new(),
                    logs: Vec::new(),
                })
            })
            .optional()
            .map_err(|err| err.to_string())?
            .ok_or_else(|| format!("任务不存在: {id}"))?;
        let mut task = task;
        task.segments = self.load_segments(id)?;
        task.logs = self.load_logs(id)?;
        Ok(task)
    }

    fn load_segments(&self, task_id: &str) -> Result<Vec<Segment>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, start_time, end_time, original_text, polished_text, translated_text, translation_status, confidence
                 FROM transcription_segments WHERE task_id = ?1 ORDER BY start_time ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id], |row| {
                let status: Option<String> = row.get(6)?;
                Ok(Segment {
                    id: row.get(0)?,
                    start: row.get(1)?,
                    end: row.get(2)?,
                    original_text: row.get(3)?,
                    polished_text: row.get(4)?,
                    translated_text: row.get(5)?,
                    translation_status: status.as_deref().and_then(TranslationStatus::parse),
                    confidence: row.get(7)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<_, _>>()
            .map_err(|err| err.to_string())
    }

    fn load_logs(&self, task_id: &str) -> Result<Vec<TaskLog>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, timestamp, level, message, details FROM task_logs WHERE task_id = ?1 ORDER BY timestamp ASC",
            )
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![task_id], |row| {
                let ts: String = row.get(1)?;
                Ok(TaskLog {
                    id: row.get(0)?,
                    timestamp: parse_time(&ts),
                    level: row.get(2)?,
                    message: row.get(3)?,
                    details: row.get(4)?,
                })
            })
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<_, _>>()
            .map_err(|err| err.to_string())
    }
}

fn parse_time(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|t| t.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| now())
}

pub fn append_log(level: &str, message: impl Into<String>, details: Option<String>) -> TaskLog {
    TaskLog {
        id: new_id(),
        timestamp: now(),
        level: level.into(),
        message: message.into(),
        details,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        model::{SubtitleBurnMode, SubtitleProcessingMode},
        pipeline::create_task_from_input,
        settings::AppSettings,
    };

    #[test]
    fn updating_task_preserves_full_log_history_and_rolls_back_invalid_segments() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("talk.srt");
        std::fs::write(&input, "subtitle").unwrap();
        let mut task = create_task_from_input(
            input.to_str().unwrap(),
            TaskKind::Subtitle,
            &AppSettings::default(),
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let db = Database::open_memory().unwrap();
        task.logs.push(append_log("info", "first", None));
        db.upsert_task(&task).unwrap();
        db.add_log(&task.id, &task.logs[0]).unwrap();
        task.logs.push(append_log("info", "second", None));
        db.upsert_task(&task).unwrap();
        assert_eq!(db.load_task(&task.id).unwrap().logs.len(), 2);
        let segment = Segment {
            id: "same".into(),
            start: 0.0,
            end: 1.0,
            original_text: "original".into(),
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        };
        task.segments = vec![segment.clone()];
        db.upsert_task(&task).unwrap();
        task.segments = vec![segment.clone(), segment];
        task.progress = 50.0;
        assert!(db.upsert_task(&task).is_err());
        let stored = db.load_task(&task.id).unwrap();
        assert_eq!(stored.progress, 0.0);
        assert_eq!(stored.segments.len(), 1);
    }
}
