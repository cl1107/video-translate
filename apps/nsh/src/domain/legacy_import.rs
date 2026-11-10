//! 显式导入 Electron 历史。源库只读；不读取密钥或复制旧流水线断点。
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags, Row, params, types::FromSql};
use serde::Deserialize;

use super::{
    db::Database,
    model::{
        GlossaryEntry, Segment, SubtitleBurnMode, SubtitleOutputLocation, SubtitleProcessingMode,
        TaskKind, TaskLog, TaskOutputArtifacts, TaskRuntimeOptions, TaskStatus, TranslationStatus,
        TranslationTask, VideoFile, new_id, now,
    },
    settings::AppSettings,
};

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    pub imported_tasks: usize,
    pub skipped_tasks: usize,
    pub imported_segments: usize,
    pub imported_logs: usize,
    pub paused_tasks: usize,
    pub tasks_without_options: usize,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyOptions {
    llm_service_id: Option<String>,
    llm_base_url: Option<String>,
    translate_model: Option<String>,
    polish_model: Option<String>,
    glossary: Option<Vec<GlossaryEntry>>,
    asr_engine: Option<String>,
    burn_subtitles: Option<bool>,
    burn_subtitle_mode: Option<SubtitleBurnMode>,
    subtitle_processing_mode: Option<SubtitleProcessingMode>,
    subtitle_output_location: Option<SubtitleOutputLocation>,
    polish_transcript: Option<bool>,
    original_subtitle_color: Option<String>,
    translated_subtitle_color: Option<String>,
    download_proxy: Option<String>,
    download_cookie_browser: Option<String>,
    // Electron shared/settings.ts::migrateLegacyLlmFields 的已记录旧格式。
    polish_provider: Option<String>,
    byok_base_url: Option<String>,
    byok_model_id: Option<String>,
    ollama_model: Option<String>,
    polish_ollama_model: Option<String>,
}

fn options(raw: Option<String>) -> Result<TaskRuntimeOptions, String> {
    let raw: LegacyOptions = match raw {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|e| format!("Electron 任务配置格式错误: {e}"))?
        }
        None => LegacyOptions::default(),
    };
    let mut options = AppSettings::default().to_runtime(
        SubtitleProcessingMode::Translate,
        false,
        SubtitleBurnMode::Bilingual,
    );
    options.llm_service_id = raw.llm_service_id.filter(|id| !id.trim().is_empty());
    options.llm_base_url = raw.llm_base_url.unwrap_or_default().trim().into();
    options.translate_model = raw.translate_model.unwrap_or_default().trim().into();
    options.polish_model = raw.polish_model.unwrap_or_default().trim().into();
    let byok_url = raw.byok_base_url.unwrap_or_default();
    let byok_model = raw.byok_model_id.unwrap_or_default();
    let ollama_model = raw.ollama_model.unwrap_or_default();
    let polish_ollama_model = raw.polish_ollama_model.unwrap_or_default();
    let has_ollama = !ollama_model.trim().is_empty() || !polish_ollama_model.trim().is_empty();
    let has_byok = !byok_url.trim().is_empty() || !byok_model.trim().is_empty();
    if options.llm_base_url.is_empty() || options.translate_model.is_empty() {
        if raw.polish_provider.as_deref() == Some("byok") || (has_byok && !has_ollama) {
            if options.llm_base_url.is_empty() {
                options.llm_base_url = byok_url.trim().into();
            }
            if options.translate_model.is_empty() {
                options.translate_model = byok_model.trim().into();
            }
            if options.polish_model.is_empty() {
                options.polish_model = byok_model.trim().into();
            }
        } else if has_ollama {
            if options.llm_base_url.is_empty() {
                options.llm_base_url = "http://127.0.0.1:11434".into();
            }
            if options.translate_model.is_empty() {
                options.translate_model = ollama_model.trim().into();
            }
            if options.polish_model.is_empty() {
                options.polish_model = if polish_ollama_model.trim().is_empty() {
                    ollama_model.trim()
                } else {
                    polish_ollama_model.trim()
                }
                .into();
            }
        }
    }
    if let Some(value) = raw.asr_engine {
        if !matches!(value.as_str(), "sensevoice" | "funasr-nano") {
            return Err("Electron 任务含不支持的 ASR 引擎".into());
        }
        options.asr_engine = value;
    }
    if let Some(value) = raw.glossary {
        options.glossary = value;
    }
    if let Some(value) = raw.burn_subtitles {
        options.burn_subtitles = value;
    }
    if let Some(value) = raw.burn_subtitle_mode {
        options.burn_subtitle_mode = value;
    }
    if let Some(value) = raw.subtitle_processing_mode {
        options.subtitle_processing_mode = value;
    }
    if options.subtitle_processing_mode == SubtitleProcessingMode::Extract {
        options.burn_subtitle_mode = SubtitleBurnMode::Original;
    }
    if let Some(value) = raw.subtitle_output_location {
        options.subtitle_output_location = value;
    }
    if let Some(value) = raw.polish_transcript {
        options.polish_transcript = value;
    }
    if let Some(value) = raw.original_subtitle_color {
        options.original_subtitle_color = value;
    }
    if let Some(value) = raw.translated_subtitle_color {
        options.translated_subtitle_color = value;
    }
    if let Some(value) = raw.download_proxy {
        options.download_proxy = value;
    }
    if let Some(value) = raw.download_cookie_browser {
        options.download_cookie_browser = value;
    }
    Ok(options)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyArtifacts {
    original_subtitle: Option<String>,
    translated_subtitle: Option<String>,
    bilingual_subtitle: Option<String>,
    bilingual_ass: Option<String>,
    burned_video: Option<String>,
    polished_markdown: Option<String>,
    output_directory: String,
}

fn artifacts(raw: Option<String>) -> Result<Option<TaskOutputArtifacts>, String> {
    raw.map(|raw| {
        let value: LegacyArtifacts =
            serde_json::from_str(&raw).map_err(|e| format!("Electron 产物配置格式错误: {e}"))?;
        Ok(TaskOutputArtifacts {
            original_subtitle: value.original_subtitle,
            translated_subtitle: value.translated_subtitle,
            bilingual_subtitle: value.bilingual_subtitle,
            bilingual_ass: value.bilingual_ass,
            burned_video: value.burned_video,
            polished_markdown: value.polished_markdown,
            output_directory: value.output_directory,
        })
    })
    .transpose()
}

fn time(raw: &str) -> Result<DateTime<Utc>, String> {
    if let Ok(value) = DateTime::parse_from_rfc3339(raw) {
        return Ok(value.with_timezone(&Utc));
    }
    // Electron TaskManager / DatabaseManager 写入 dayjs().format('YYYY-MM-DD HH:mm:ss')。
    let value = NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.f")
        .map_err(|_| "Electron 日期格式无效".to_string())?;
    Local
        .from_local_datetime(&value)
        .single()
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| "Electron 本地日期处于时区歧义或无效区间".into())
}

fn get<T: FromSql>(row: &Row<'_>, name: &str) -> Result<T, String> {
    row.get(name)
        .map_err(|error| format!("Electron 字段 {name} 无效: {error}"))
}

fn columns(
    connection: &Connection,
    table: &str,
    required: &[&str],
) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names: HashSet<String> = statement
        .query_map([], |row| row.get(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    for name in required {
        if !names.contains(*name) {
            return Err(format!("Electron 数据库缺少 {table}.{name}"));
        }
    }
    Ok(names)
}

fn optional(names: &HashSet<String>, prefix: &str, name: &str, alias: &str) -> String {
    if names.contains(name) {
        format!("{prefix}.{name} AS {alias}")
    } else {
        format!("NULL AS {alias}")
    }
}

fn read_tasks(source: &Connection) -> Result<(Vec<TranslationTask>, usize), String> {
    let task_columns = columns(
        source,
        "translation_tasks",
        &[
            "id",
            "video_file_id",
            "status",
            "progress",
            "source_language",
            "target_language",
            "created_at",
            "updated_at",
        ],
    )?;
    let video_columns = columns(
        source,
        "video_files",
        &[
            "id",
            "name",
            "path",
            "size",
            "duration",
            "format",
            "created_at",
        ],
    )?;
    let segment_columns = columns(
        source,
        "transcription_segments",
        &[
            "id",
            "task_id",
            "start_time",
            "end_time",
            "original_text",
            "translated_text",
            "confidence",
        ],
    )?;
    let log_columns = columns(
        source,
        "task_logs",
        &["id", "task_id", "timestamp", "level", "message"],
    )?;
    let mut fields = vec!["t.id, t.video_file_id, t.status, t.progress, t.source_language, t.target_language, t.created_at, t.updated_at, v.name AS v_name, v.path AS v_path, v.size AS v_size, v.duration AS v_duration, v.format AS v_format, v.created_at AS v_created_at".to_string()];
    for name in [
        "kind",
        "detected_language",
        "options_json",
        "artifacts_json",
        "source_url",
        "platform_subtitle_path",
        "platform_subtitle_language",
        "completed_at",
        "error_message",
    ] {
        fields.push(optional(&task_columns, "t", name, name));
    }
    fields.push(optional(&video_columns, "v", "source_url", "v_source_url"));
    let sql = format!(
        "SELECT {} FROM translation_tasks t JOIN video_files v ON v.id=t.video_file_id ORDER BY t.created_at, t.id",
        fields.join(", ")
    );
    let mut statement = source.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    let mut tasks = Vec::new();
    let mut without_options = 0;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let id: String = get(row, "id")?;
        let raw_options: Option<String> = get(row, "options_json")?;
        if raw_options.is_none() {
            without_options += 1;
        }
        let kind = match get::<Option<String>>(row, "kind")?.as_deref() {
            None | Some("subtitle") => TaskKind::Subtitle,
            Some("document") => TaskKind::Document,
            _ => return Err("Electron 任务类型无效".into()),
        };
        let status_text: String = get(row, "status")?;
        let mut status: TaskStatus = serde_json::from_value(serde_json::Value::String(status_text))
            .map_err(|_| "Electron 任务状态无效".to_string())?;
        if !status.is_terminal() {
            status = TaskStatus::Paused;
        }
        let size: i64 = get(row, "v_size")?;
        let source_url: Option<String> = get(row, "source_url")?;
        let video_url: Option<String> = get(row, "v_source_url")?;
        let mut task = TranslationTask {
            id: id.clone(),
            kind,
            status,
            progress: get(row, "progress")?,
            source_language: get(row, "source_language")?,
            detected_language: get(row, "detected_language")?,
            target_language: get(row, "target_language")?,
            options: options(raw_options).map_err(|e| format!("任务 {id}: {e}"))?,
            source_url: source_url.clone().or_else(|| video_url.clone()),
            platform_subtitle_path: get(row, "platform_subtitle_path")?,
            platform_subtitle_language: get(row, "platform_subtitle_language")?,
            segments: Vec::new(),
            logs: Vec::new(),
            error_message: get(row, "error_message")?,
            created_at: time(&get::<String>(row, "created_at")?)?,
            updated_at: time(&get::<String>(row, "updated_at")?)?,
            completed_at: get::<Option<String>>(row, "completed_at")?
                .map(|value| time(&value))
                .transpose()?,
            output_artifacts: artifacts(get(row, "artifacts_json")?)?,
            video_file: VideoFile {
                id: get(row, "video_file_id")?,
                name: get(row, "v_name")?,
                path: get(row, "v_path")?,
                size: u64::try_from(size).map_err(|_| "Electron 视频文件大小为负数".to_string())?,
                duration: get(row, "v_duration")?,
                format: get(row, "v_format")?,
                created_at: time(&get::<String>(row, "v_created_at")?)?,
                source_url: video_url.or(source_url),
            },
        };
        let sql = format!(
            "SELECT s.id, s.start_time, s.end_time, s.original_text, s.translated_text, s.confidence, {}, {} FROM transcription_segments s WHERE task_id=?1 ORDER BY start_time, id",
            optional(&segment_columns, "s", "polished_text", "polished_text"),
            optional(
                &segment_columns,
                "s",
                "translation_status",
                "translation_status"
            )
        );
        let mut statement = source.prepare(&sql).map_err(|e| e.to_string())?;
        let mut segments = statement.query(params![id]).map_err(|e| e.to_string())?;
        while let Some(row) = segments.next().map_err(|e| e.to_string())? {
            let raw_status: Option<String> = get(row, "translation_status")?;
            let translation_status = raw_status
                .map(|value| {
                    TranslationStatus::parse(&value)
                        .ok_or_else(|| "Electron 字幕翻译状态无效".to_string())
                })
                .transpose()?;
            task.segments.push(Segment {
                id: format!("{id}:legacy:{}", get::<String>(row, "id")?),
                start: get(row, "start_time")?,
                end: get(row, "end_time")?,
                original_text: get(row, "original_text")?,
                polished_text: get(row, "polished_text")?,
                translated_text: get(row, "translated_text")?,
                translation_status,
                confidence: get(row, "confidence")?,
            });
        }
        let mut statement = source.prepare(&format!("SELECT l.id, l.timestamp, l.level, l.message, {} FROM task_logs l WHERE task_id=?1 ORDER BY timestamp, id", optional(&log_columns, "l", "details", "details"))).map_err(|e| e.to_string())?;
        let mut logs = statement.query(params![id]).map_err(|e| e.to_string())?;
        while let Some(row) = logs.next().map_err(|e| e.to_string())? {
            let level: String = get(row, "level")?;
            if !matches!(level.as_str(), "info" | "warn" | "error" | "success") {
                return Err("Electron 日志级别无效".into());
            }
            task.logs.push(TaskLog {
                id: format!("{id}:legacy:{}", get::<String>(row, "id")?),
                timestamp: time(&get::<String>(row, "timestamp")?)?,
                level,
                message: get(row, "message")?,
                details: get(row, "details")?,
            });
        }
        tasks.push(task);
    }
    let count: i64 = source
        .query_row("SELECT COUNT(*) FROM translation_tasks", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    if tasks.len() as i64 != count {
        return Err("Electron 任务引用的视频记录缺失，未导入".into());
    }
    Ok((tasks, without_options))
}

fn same_file(source: &Path, destination: &Path) -> bool {
    if source.canonicalize().ok() == destination.canonicalize().ok() {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(a), Ok(b)) = (source.metadata(), destination.metadata()) {
            return a.dev() == b.dev() && a.ino() == b.ino();
        }
    }
    false
}

pub fn import_legacy(source_path: &Path, destination_path: &Path) -> Result<ImportReport, String> {
    if !source_path.is_file() {
        return Err("找不到 Electron 数据库文件".into());
    }
    if same_file(source_path, destination_path) {
        return Err("源数据库与 NSH 数据库相同，不能导入".into());
    }
    let source = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法只读打开 Electron 数据库: {e}"))?;
    source
        .execute_batch("PRAGMA query_only=ON; BEGIN;")
        .map_err(|e| e.to_string())?;
    let (tasks, without_options) = read_tasks(&source)?;
    if let Some(parent) = destination_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    drop(Database::open_path(destination_path)?);
    let mut target = Connection::open(destination_path).map_err(|e| e.to_string())?;
    target
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    let transaction = target
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS legacy_imports (task_id TEXT PRIMARY KEY REFERENCES translation_tasks(id) ON DELETE CASCADE, source_database TEXT NOT NULL, source_identity TEXT NOT NULL, imported_at TEXT NOT NULL);").map_err(|e| e.to_string())?;
    let source_name = source_path
        .canonicalize()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    let mut report = ImportReport {
        tasks_without_options: without_options,
        ..ImportReport::default()
    };
    let mut videos: HashMap<String, String> = HashMap::new();
    for mut task in tasks {
        let identity = serde_json::to_string(&(
            &task.video_file.id,
            &task.video_file.path,
            task.created_at,
            task.kind,
        ))
        .map_err(|e| e.to_string())?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM translation_tasks WHERE id=?1)",
                params![task.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            use rusqlite::OptionalExtension;
            let previous: Option<String> = transaction
                .query_row(
                    "SELECT source_identity FROM legacy_imports WHERE task_id=?1",
                    params![task.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if previous.as_deref() != Some(&identity) {
                return Err(format!("任务 {} 与现有 NSH 任务冲突，未导入", task.id));
            }
            report.skipped_tasks += 1;
            continue;
        }
        let original_video_id = task.video_file.id.clone();
        if let Some(id) = videos.get(&original_video_id) {
            task.video_file.id = id.clone();
        } else {
            use rusqlite::OptionalExtension;
            let matching: Option<String> = transaction
                .query_row(
                    "SELECT id FROM video_files WHERE path=?1 ORDER BY id LIMIT 1",
                    params![task.video_file.path],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(id) = matching {
                task.video_file.id = id;
            } else {
                let collision: bool = transaction
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM video_files WHERE id=?1)",
                        params![task.video_file.id],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if collision {
                    task.video_file.id = new_id();
                }
                let video = &task.video_file;
                transaction.execute("INSERT INTO video_files (id,name,path,size,duration,format,created_at,source_url) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![video.id,video.name,video.path,video.size as i64,video.duration,video.format,video.created_at.to_rfc3339(),video.source_url]).map_err(|e| e.to_string())?;
            }
            videos.insert(original_video_id, task.video_file.id.clone());
        }
        let options = serde_json::to_string(&task.options).map_err(|e| e.to_string())?;
        let artifacts = task
            .output_artifacts
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO translation_tasks (id,video_file_id,kind,status,progress,source_language,detected_language,target_language,options_json,source_url,platform_subtitle_path,platform_subtitle_language,error_message,created_at,updated_at,completed_at,artifacts_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)", params![task.id,task.video_file.id,task.kind.as_str(),task.status.as_str(),task.progress,task.source_language,task.detected_language,task.target_language,options,task.source_url,task.platform_subtitle_path,task.platform_subtitle_language,task.error_message,task.created_at.to_rfc3339(),task.updated_at.to_rfc3339(),task.completed_at.map(|v|v.to_rfc3339()),artifacts]).map_err(|e| e.to_string())?;
        for segment in &task.segments {
            transaction.execute("INSERT INTO transcription_segments (id,task_id,start_time,end_time,original_text,polished_text,translated_text,translation_status,confidence) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![segment.id,task.id,segment.start,segment.end,segment.original_text,segment.polished_text,segment.translated_text,segment.translation_status.map(|v|v.as_str()),segment.confidence]).map_err(|e| e.to_string())?;
        }
        for log in &task.logs {
            transaction.execute("INSERT INTO task_logs (id,task_id,timestamp,level,message,details) VALUES (?1,?2,?3,?4,?5,?6)",params![log.id,task.id,log.timestamp.to_rfc3339(),log.level,log.message,log.details]).map_err(|e| e.to_string())?;
        }
        transaction.execute("INSERT INTO legacy_imports (task_id,source_database,source_identity,imported_at) VALUES (?1,?2,?3,?4)", params![task.id,source_name,identity,now().to_rfc3339()]).map_err(|e| e.to_string())?;
        report.imported_tasks += 1;
        report.imported_segments += task.segments.len();
        report.imported_logs += task.logs.len();
        if task.status == TaskStatus::Paused {
            report.paused_tasks += 1;
        }
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(report)
}
