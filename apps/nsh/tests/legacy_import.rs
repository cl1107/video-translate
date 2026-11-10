use chrono::{Local, NaiveDateTime, TimeZone};
use nsh_app_video_translate::domain::{
    db::Database,
    legacy_import::import_legacy,
    model::{SubtitleProcessingMode, TaskStatus},
};
use rusqlite::{Connection, params};
use serde_json::json;
use std::path::Path;

fn source(path: &Path) -> Connection {
    let db = Connection::open(path).unwrap();
    db.execute_batch(include_str!("fixtures/legacy-electron.sql"))
        .unwrap();
    db.execute("INSERT INTO video_files (id,name,path,size,duration,format,created_at) VALUES ('video','talk.mp4','/media/talk.mp4',123,12.5,'mp4','2026-11-01 12:00:00')",[]).unwrap();
    db
}

fn add_task(db: &Connection, id: &str, status: &str, config: Option<String>) {
    db.execute("INSERT INTO translation_tasks (id,video_file_id,status,progress,source_language,detected_language,target_language,created_at,updated_at,completed_at,options_json,artifacts_json,source_url,kind) VALUES (?1,'video',?2,80,'en','en','zh','2026-11-01 12:00:00','2026-11-01 12:30:00',NULL,?3,?4,'https://example.test/video','subtitle')",params![id,status,config,json!({"originalSubtitle":"/output/original.srt","translatedSubtitle":"/output/translated.srt","bilingualSubtitle":"/output/bilingual.srt","bilingualAss":"/output/bilingual.ass","burnedVideo":"/output/burned.mp4","polishedMarkdown":"/output/doc.md","outputDirectory":"/output"}).to_string()]).unwrap();
    db.execute("INSERT INTO transcription_segments (id,task_id,start_time,end_time,original_text,polished_text,translated_text,translation_status,confidence) VALUES (?1,?2,1.25,2.5,'original','polished','译文','reviewed',0.9)", params![format!("{id}-segment"),id]).unwrap();
    db.execute("INSERT INTO task_logs (id,task_id,timestamp,level,message,details) VALUES (?1,?2,'2026-11-01 12:05:00','info','history','detail')", params![format!("{id}-log"),id]).unwrap();
    db.execute(
        "INSERT INTO pipeline_checkpoints VALUES (?1,1)",
        params![id],
    )
    .unwrap();
}

#[test]
fn import_legacy_roundtrips_fields_is_read_only_and_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("electron.db");
    let target_path = dir.path().join("nsh.db");
    let old = source(&old_path);
    add_task(&old, "legacy-task", "translating", Some(json!({"llmServiceId":"service","llmBaseUrl":"https://models.example.test/v1","translateModel":"translate","polishModel":"polish","asrEngine":"sensevoice","burnSubtitles":true,"burnSubtitleMode":"bilingual","subtitleProcessingMode":"translate","subtitleOutputLocation":"source-directory","polishTranscript":false,"glossary":[{"source":"term","target":"术语"}],"originalSubtitleColor":"#112233","translatedSubtitleColor":"#445566","downloadProxy":"http://127.0.0.1:8080","downloadCookieBrowser":"edge"}).to_string()));
    drop(old);
    let original_bytes = std::fs::read(&old_path).unwrap();
    let report = import_legacy(&old_path, &target_path).unwrap();
    assert_eq!(
        (
            report.imported_tasks,
            report.imported_segments,
            report.imported_logs,
            report.paused_tasks
        ),
        (1, 1, 1, 1)
    );
    assert_eq!(std::fs::read(&old_path).unwrap(), original_bytes);
    let db = Database::open_path(&target_path).unwrap();
    let mut task = db.load_task("legacy-task").unwrap();
    assert_eq!(task.status, TaskStatus::Paused);
    assert_eq!(task.progress, 80.0);
    assert_eq!(
        task.source_url.as_deref(),
        Some("https://example.test/video")
    );
    assert_eq!(task.video_file.size, 123);
    let expected = Local
        .from_local_datetime(
            &NaiveDateTime::parse_from_str("2026-11-01 12:00:00", "%Y-%m-%d %H:%M:%S").unwrap(),
        )
        .single()
        .unwrap();
    assert_eq!(task.created_at.timestamp(), expected.timestamp());
    assert_eq!(task.options.llm_base_url, "https://models.example.test/v1");
    assert_eq!(task.options.translate_model, "translate");
    assert_eq!(task.options.polish_model, "polish");
    assert_eq!(task.options.llm_service_id.as_deref(), Some("service"));
    assert!(!task.options.polish_transcript);
    assert_eq!(task.options.glossary[0].target, "术语");
    assert_eq!(task.options.download_cookie_browser, "edge");
    assert_eq!(task.segments[0].polished_text.as_deref(), Some("polished"));
    assert_eq!(task.segments[0].translated_text.as_deref(), Some("译文"));
    assert_eq!(task.logs[0].details.as_deref(), Some("detail"));
    assert_eq!(
        task.output_artifacts
            .as_ref()
            .unwrap()
            .polished_markdown
            .as_deref(),
        Some("/output/doc.md")
    );
    task.segments[0].original_text = "edited locally".into();
    db.upsert_task(&task).unwrap();
    let repeated = import_legacy(&old_path, &target_path).unwrap();
    assert_eq!((repeated.imported_tasks, repeated.skipped_tasks), (0, 1));
    assert_eq!(
        db.load_task("legacy-task").unwrap().segments[0].original_text,
        "edited locally"
    );
    let conn = Connection::open(&target_path).unwrap();
    let copied_checkpoints: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='pipeline_checkpoints'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(copied_checkpoints, 0);
    assert_eq!(std::fs::read(&old_path).unwrap(), original_bytes);
}

#[test]
fn import_legacy_migrates_documented_old_llm_fields_and_missing_options() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("electron.db");
    let target_path = dir.path().join("nsh.db");
    let old = source(&old_path);
    add_task(&old,"ollama","completed",Some(json!({"polishProvider":"ollama","ollamaModel":"translator","polishOllamaModel":"polisher"}).to_string()));
    add_task(&old,"byok","completed",Some(json!({"polishProvider":"byok","byokBaseUrl":"https://api.example.test","byokModelId":"remote"}).to_string()));
    add_task(&old, "missing", "failed", None);
    drop(old);
    let report = import_legacy(&old_path, &target_path).unwrap();
    assert_eq!(
        (report.imported_tasks, report.tasks_without_options),
        (3, 1)
    );
    let target = Database::open_path(&target_path).unwrap();
    let ollama = target.load_task("ollama").unwrap();
    assert_eq!(ollama.options.llm_base_url, "http://127.0.0.1:11434");
    assert_eq!(ollama.options.translate_model, "translator");
    assert_eq!(ollama.options.polish_model, "polisher");
    let byok = target.load_task("byok").unwrap();
    assert_eq!(byok.options.translate_model, "remote");
    assert_eq!(byok.options.llm_base_url, "https://api.example.test");
    assert_eq!(
        target
            .load_task("missing")
            .unwrap()
            .options
            .subtitle_processing_mode,
        SubtitleProcessingMode::Translate
    );
}

#[test]
fn import_legacy_is_atomic_on_task_conflict_and_rejects_same_database() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("electron.db");
    let target_path = dir.path().join("nsh.db");
    let old = source(&old_path);
    add_task(&old, "existing", "completed", None);
    drop(old);
    import_legacy(&old_path, &target_path).unwrap();
    let target = Connection::open(&target_path).unwrap();
    target
        .execute("DELETE FROM legacy_imports WHERE task_id='existing'", [])
        .unwrap();
    let old = Connection::open(&old_path).unwrap();
    add_task(&old, "a-new-task", "completed", None);
    drop(old);
    assert!(
        import_legacy(&old_path, &target_path)
            .unwrap_err()
            .contains("冲突")
    );
    assert_eq!(
        Database::open_path(&target_path)
            .unwrap()
            .load_all()
            .unwrap()
            .len(),
        1
    );
    let bytes = std::fs::read(&old_path).unwrap();
    assert!(
        import_legacy(&old_path, &old_path)
            .unwrap_err()
            .contains("相同")
    );
    assert_eq!(std::fs::read(&old_path).unwrap(), bytes);
}

#[test]
fn import_legacy_reuses_matching_media_and_remaps_colliding_media_ids() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("electron.db");
    let target_path = dir.path().join("nsh.db");
    let old = source(&old_path);
    add_task(&old, "first", "completed", None);
    add_task(&old, "second", "completed", None);
    drop(old);
    drop(Database::open_path(&target_path).unwrap());
    let target = Connection::open(&target_path).unwrap();
    target.execute("INSERT INTO video_files VALUES ('video','other','/other.mp4',1,1,'mp4','2026-11-01T00:00:00Z',NULL)",[]).unwrap();
    import_legacy(&old_path, &target_path).unwrap();
    let target = Database::open_path(&target_path).unwrap();
    let first = target.load_task("first").unwrap();
    let second = target.load_task("second").unwrap();
    assert_ne!(first.video_file.id, "video");
    assert_eq!(first.video_file.id, second.video_file.id);
    let old = Connection::open(&old_path).unwrap();
    add_task(&old, "third", "completed", None);
    drop(old);
    import_legacy(&old_path, &target_path).unwrap();
    assert_eq!(
        target.load_task("third").unwrap().video_file.id,
        first.video_file.id
    );
}

#[test]
fn import_legacy_rejects_invalid_config_without_silent_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let old_path = dir.path().join("electron.db");
    let target_path = dir.path().join("nsh.db");
    let old = source(&old_path);
    add_task(
        &old,
        "broken",
        "completed",
        Some(json!({"burnSubtitles":"false"}).to_string()),
    );
    drop(old);
    assert!(
        import_legacy(&old_path, &target_path)
            .unwrap_err()
            .contains("配置格式错误")
    );
    assert!(!target_path.exists());
}
