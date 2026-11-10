-- Electron DatabaseManager 初始化后的实际 schema；保留其非级联外键和日期默认值。
CREATE TABLE video_files (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
 duration REAL NOT NULL, format TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 source_url TEXT NULL
);
CREATE TABLE translation_tasks (
 id TEXT PRIMARY KEY, video_file_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL DEFAULT 0,
 source_language TEXT NOT NULL, detected_language TEXT NULL, target_language TEXT NOT NULL,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 completed_at DATETIME NULL, error_message TEXT NULL, options_json TEXT NULL, artifacts_json TEXT NULL,
 source_url TEXT NULL, platform_subtitle_path TEXT NULL, platform_subtitle_language TEXT NULL,
 kind TEXT NOT NULL DEFAULT 'subtitle', FOREIGN KEY(video_file_id) REFERENCES video_files(id)
);
CREATE TABLE transcription_segments (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, start_time REAL NOT NULL, end_time REAL NOT NULL,
 original_text TEXT NOT NULL, polished_text TEXT NULL, translated_text TEXT NULL,
 translation_status TEXT NULL, confidence REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(task_id) REFERENCES translation_tasks(id)
);
CREATE TABLE task_logs (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, timestamp TEXT NOT NULL, level TEXT NOT NULL,
 message TEXT NOT NULL, details TEXT, FOREIGN KEY(task_id) REFERENCES translation_tasks(id)
);
CREATE TABLE pipeline_checkpoints (task_id TEXT PRIMARY KEY, asr_complete INTEGER NOT NULL DEFAULT 0);
