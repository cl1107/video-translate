//! `vt`：视频翻译助手无界面 CLI，复用 Rust 领域层与流水线。

use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
};

use nsh_app_video_translate::domain::{
    db::Database,
    legacy_import::import_legacy,
    llm,
    model::{GlossaryEntry, SubtitleBurnMode, SubtitleProcessingMode, TaskKind, TaskStatus},
    paths,
    pipeline::{
        AbortFlag, PipelineHooks, Runtime, create_reused_task, create_task_from_input, run_task,
    },
    review,
    settings::{AppSettings, parse_settings_json},
    system_check,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretsFile {
    #[serde(default)]
    service_keys: BTreeMap<String, String>,
    #[serde(default)]
    legacy_key: String,
}

#[derive(Debug, Default)]
struct GlobalOpts {
    json: bool,
    share_desktop: bool,
    data_dir: Option<PathBuf>,
}

#[derive(Debug, Default)]
struct TaskOverrides {
    target_lang: Option<String>,
    source_lang: Option<String>,
    asr: Option<String>,
    llm_base_url: Option<String>,
    translate_model: Option<String>,
    polish_model: Option<String>,
    no_polish: bool,
    burn: bool,
    glossary: Option<PathBuf>,
    mock_asr: bool,
    mock_llm: bool,
}

fn print_help() {
    eprintln!(
        r#"vt — 视频翻译助手命令行

用法:
  vt <命令> [选项]

任务命令:
  vt subtitle <文件或URL> [选项]     翻译并导出字幕
  vt extract <文件或URL> [选项]      仅提取原文字幕
  vt document <文件或URL> [选项]     整篇润色为 Markdown 文稿
  vt import <字幕文件> [选项]        导入已有 SRT/VTT 字幕
  vt import-legacy <electron.db>    只读导入旧版 Electron 任务库

任务管理:
  vt task list [--json]
  vt task get <id> [--json]
  vt task logs <id> [--json]
  vt task markdown <id> [--json]
  vt task issues <id> [--json]
  vt task delete <id> [--json]
  vt task reuse <id> --kind <subtitle|document> [--target-lang <lang>] [--json]

配置与模型:
  vt doctor [--json]                检查系统依赖与当前配置
  vt check [--json]                 doctor 的别名
  vt config get [--json]
  vt config set <key> <value> [--json]
  vt llm models [--json]
  vt llm key set --value <key> [--json]

公共选项:
  --json                            以 JSON 格式输出结果到 stdout
  --share-desktop                   与桌面端共用数据目录
  --data-dir <目录>                 指定数据目录
  -h, --help                        显示帮助

任务覆盖选项:
  --target-lang <lang>              目标语言（默认取配置）
  --source-lang <lang>              源语言（默认 auto）
  --asr <sensevoice|funasr-nano>    ASR 引擎
  --llm-base-url <url>              模型服务 Base URL
  --translate-model <id>            翻译模型 ID
  --polish-model <id>               润色模型 ID
  --no-polish                       关闭识别后润色
  --burn                            启用硬字幕烧录
  --glossary <file.json>            指定术语表 JSON
"#
    );
}

fn strip_global_opts(raw: Vec<String>) -> Result<(GlobalOpts, Vec<String>), String> {
    let mut opts = GlobalOpts::default();
    let mut rest = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--json" => opts.json = true,
            "--share-desktop" => opts.share_desktop = true,
            "--data-dir" => {
                i += 1;
                let val = raw.get(i).ok_or("--data-dir 需要目录参数")?;
                opts.data_dir = Some(PathBuf::from(val));
            }
            _ => rest.push(raw[i].clone()),
        }
        i += 1;
    }
    Ok((opts, rest))
}

fn configure_data_dir(opts: &GlobalOpts) {
    if let Some(dir) = &opts.data_dir {
        paths::set_data_dir_override(Some(dir.clone()));
    } else if let Ok(dir) = env::var("VIDEO_TRANSLATE_DATA_DIR") {
        if !dir.trim().is_empty() {
            paths::set_data_dir_override(Some(PathBuf::from(dir)));
        }
    } else if !opts.share_desktop {
        let mut dir = paths::data_dir();
        if let Some(name) = dir.file_name().and_then(|s| s.to_str()) {
            if !name.ends_with("-cli") {
                dir.set_file_name(format!("{name}-cli"));
                paths::set_data_dir_override(Some(dir));
            }
        }
    }
}

fn load_settings() -> AppSettings {
    fs::read_to_string(paths::settings_path())
        .map(|raw| parse_settings_json(&raw))
        .unwrap_or_default()
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = paths::settings_path();
    if let Some(parent) = path.parent() {
        paths::ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

fn load_secrets() -> SecretsFile {
    fs::read_to_string(paths::secrets_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<SecretsFile>(&raw).ok())
        .unwrap_or_default()
}

fn save_secrets(secrets: &SecretsFile) -> Result<(), String> {
    let path = paths::secrets_path();
    if let Some(parent) = path.parent() {
        paths::ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(secrets).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn current_api_key(settings: &AppSettings) -> String {
    if let Ok(env_key) = env::var("VIDEO_TRANSLATE_LLM_API_KEY") {
        if !env_key.trim().is_empty() {
            return env_key;
        }
    }
    let secrets = load_secrets();
    secrets
        .service_keys
        .get(&settings.selected_llm_service_id)
        .cloned()
        .filter(|v| !v.is_empty())
        .unwrap_or(secrets.legacy_key)
}

fn parse_task_args(args: &[String]) -> Result<(String, TaskOverrides), String> {
    let mut input: Option<String> = None;
    let mut ov = TaskOverrides::default();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--target-lang" => {
                i += 1;
                ov.target_lang = Some(args.get(i).ok_or("--target-lang 需要参数")?.clone());
            }
            "--source-lang" => {
                i += 1;
                ov.source_lang = Some(args.get(i).ok_or("--source-lang 需要参数")?.clone());
            }
            "--asr" => {
                i += 1;
                ov.asr = Some(args.get(i).ok_or("--asr 需要参数")?.clone());
            }
            "--llm-base-url" => {
                i += 1;
                ov.llm_base_url = Some(args.get(i).ok_or("--llm-base-url 需要参数")?.clone());
            }
            "--translate-model" => {
                i += 1;
                ov.translate_model = Some(args.get(i).ok_or("--translate-model 需要参数")?.clone());
            }
            "--polish-model" => {
                i += 1;
                ov.polish_model = Some(args.get(i).ok_or("--polish-model 需要参数")?.clone());
            }
            "--no-polish" => ov.no_polish = true,
            "--burn" => ov.burn = true,
            "--mock-asr" => ov.mock_asr = true,
            "--mock-llm" => ov.mock_llm = true,
            "--glossary" => {
                i += 1;
                let path = args.get(i).ok_or("--glossary 需要文件路径")?;
                ov.glossary = Some(PathBuf::from(path));
            }
            flag if flag.starts_with('-') => return Err(format!("未知选项: {flag}")),
            val => {
                if input.is_some() {
                    return Err(format!("多余的位置参数: {val}"));
                }
                input = Some(val.to_string());
            }
        }
        i += 1;
    }
    let input = input.ok_or("缺少文件路径或链接")?;
    Ok((input, ov))
}

fn apply_overrides(settings: &mut AppSettings, ov: &TaskOverrides) -> Result<(), String> {
    if let Some(v) = &ov.target_lang {
        settings.target_language = v.clone();
    }
    if let Some(v) = &ov.source_lang {
        settings.source_language = v.clone();
    }
    if let Some(v) = &ov.asr {
        settings.asr_engine = v.clone();
    }
    if let Some(v) = &ov.llm_base_url {
        settings.llm_base_url = v.clone();
    }
    if let Some(v) = &ov.translate_model {
        settings.translate_model = v.clone();
    }
    if let Some(v) = &ov.polish_model {
        settings.polish_model = v.clone();
    }
    if ov.no_polish {
        settings.polish_transcript = false;
    }
    if ov.mock_asr || env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1") {
        settings.mock_asr = true;
    }
    if ov.mock_llm || env::var("VIDEO_TRANSLATE_MOCK_LLM").ok().as_deref() == Some("1") {
        settings.mock_llm = true;
    }
    if let Some(path) = &ov.glossary {
        let raw = fs::read_to_string(path).map_err(|e| format!("读取术语表失败: {e}"))?;
        settings.glossary =
            serde_json::from_str::<Vec<GlossaryEntry>>(&raw).map_err(|e| format!("解析术语表失败: {e}"))?;
    }
    Ok(())
}

fn emit_ok(opts: &GlobalOpts, data: Value, human: &str) -> ExitCode {
    if opts.json {
        println!("{}", json!({ "ok": true, "data": data }));
    } else if !human.is_empty() {
        println!("{human}");
    }
    ExitCode::SUCCESS
}

fn emit_err(opts: &GlobalOpts, err: &str) -> ExitCode {
    if opts.json {
        println!("{}", json!({ "ok": false, "error": err }));
    } else {
        eprintln!("{err}");
    }
    ExitCode::FAILURE
}

fn run_pipeline_task(
    opts: &GlobalOpts,
    input: &str,
    kind: TaskKind,
    processing: SubtitleProcessingMode,
    ov: &TaskOverrides,
) -> ExitCode {
    let mut settings = load_settings();
    if let Err(err) = apply_overrides(&mut settings, ov) {
        return emit_err(opts, &err);
    }
    let task = match create_task_from_input(
        input,
        kind,
        &settings,
        processing,
        ov.burn,
        SubtitleBurnMode::Bilingual,
    ) {
        Ok(task) => task,
        Err(err) => return emit_err(opts, &err),
    };
    let db = match Database::open_default() {
        Ok(db) => db,
        Err(err) => return emit_err(opts, &err),
    };
    let _ = db.upsert_task(&task);

    let api_key = current_api_key(&settings);
    let runtime = match Runtime::for_task(&settings, &task, &api_key) {
        Ok(rt) => rt,
        Err(err) => return emit_err(opts, &err),
    };

    let abort = AbortFlag::new();
    let json_mode = opts.json;
    let mut hooks = PipelineHooks {
        on_event: Box::new(move |ev| {
            if json_mode {
                eprintln!("[{} {}%]", ev.task.id, ev.task.progress as u32);
            }
            let _ = db.upsert_task(&ev.task);
        }),
    };
    let task = run_task(task, &runtime, &abort, &mut hooks);
    if let Ok(db) = Database::open_default() {
        let _ = db.upsert_task(&task);
    }

    if task.status == TaskStatus::Completed {
        let primary_path = task
            .output_artifacts
            .as_ref()
            .and_then(|a| {
                a.polished_markdown
                    .as_ref()
                    .or(a.bilingual_subtitle.as_ref())
                    .or(a.translated_subtitle.as_ref())
                    .or(a.original_subtitle.as_ref())
            })
            .map(|p| {
                fs::canonicalize(p)
                    .unwrap_or_else(|_| PathBuf::from(p))
                    .display()
                    .to_string()
            })
            .unwrap_or_default();
        emit_ok(
            opts,
            json!({ "task": task, "artifacts": task.output_artifacts }),
            &primary_path,
        )
    } else {
        let msg = task
            .error_message
            .clone()
            .unwrap_or_else(|| "任务执行失败".into());
        if opts.json {
            println!("{}", json!({ "ok": false, "error": msg, "task": task }));
            ExitCode::FAILURE
        } else {
            emit_err(opts, &msg)
        }
    }
}

fn handle_doctor(opts: &GlobalOpts) -> ExitCode {
    let checks = system_check::run_checks();
    let settings = load_settings();
    let has_key = !current_api_key(&settings).trim().is_empty();
    let human = checks
        .iter()
        .map(|item| {
            format!(
                "{} {} {}",
                if item.available { "ok" } else { "missing" },
                item.name,
                item.error.as_deref().or(item.version.as_deref()).unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    emit_ok(
        opts,
        json!({
            "checks": checks,
            "dataDir": paths::data_dir(),
            "settings": {
                "asrEngine": settings.asr_engine,
                "llmBaseUrl": settings.llm_base_url,
                "translateModel": settings.translate_model,
                "polishModel": settings.polish_model,
                "hasApiKey": has_key,
            }
        }),
        &human,
    )
}

fn handle_config(opts: &GlobalOpts, args: &[String]) -> ExitCode {
    let sub = args.first().map(String::as_str).unwrap_or("");
    match sub {
        "get" => {
            let settings = load_settings();
            let raw = serde_json::to_string_pretty(&settings).unwrap_or_default();
            emit_ok(opts, serde_json::to_value(&settings).unwrap_or(Value::Null), &raw)
        }
        "set" => {
            if args.len() < 3 {
                return emit_err(opts, "用法: vt config set <key> <value>");
            }
            let key = args[1].as_str();
            let val = args[2].clone();
            let mut settings = load_settings();
            match key {
                "llmBaseUrl" | "llm_base_url" => settings.llm_base_url = val,
                "translateModel" | "translate_model" => settings.translate_model = val,
                "polishModel" | "polish_model" => settings.polish_model = val,
                "sourceLanguage" | "source_language" => settings.source_language = val,
                "targetLanguage" | "target_language" => settings.target_language = val,
                "asrEngine" | "asr_engine" => settings.asr_engine = val,
                "downloadProxy" | "download_proxy" => settings.download_proxy = val,
                "downloadCookieBrowser" | "download_cookie_browser" => {
                    settings.download_cookie_browser = val;
                }
                "polishTranscript" | "polish_transcript" => {
                    settings.polish_transcript = matches!(val.as_str(), "true" | "1" | "yes")
                }
                _ => return emit_err(opts, &format!("不支持的配置项: {key}")),
            }
            if let Err(err) = save_settings(&settings) {
                return emit_err(opts, &err);
            }
            emit_ok(
                opts,
                serde_json::to_value(&settings).unwrap_or(Value::Null),
                &format!("已更新 {key}"),
            )
        }
        _ => emit_err(opts, "用法: vt config <get|set>"),
    }
}

fn handle_llm(opts: &GlobalOpts, args: &[String]) -> ExitCode {
    let sub = args.first().map(String::as_str).unwrap_or("");
    match sub {
        "models" => {
            let settings = load_settings();
            let key = current_api_key(&settings);
            match llm::list_models(&settings.llm_base_url, &key) {
                Ok(models) => emit_ok(opts, json!({ "models": models }), &models.join("\n")),
                Err(err) => emit_err(opts, &err),
            }
        }
        "key" => {
            if args.get(1).map(String::as_str) != Some("set") {
                return emit_err(opts, "用法: vt llm key set --value <key>");
            }
            let mut value: Option<String> = None;
            let mut i = 2;
            while i < args.len() {
                if args[i] == "--value" {
                    i += 1;
                    value = args.get(i).cloned();
                }
                i += 1;
            }
            let Some(val) = value else {
                return emit_err(opts, "缺少 --value <key>");
            };
            let settings = load_settings();
            let mut secrets = load_secrets();
            secrets
                .service_keys
                .insert(settings.selected_llm_service_id, val);
            if let Err(err) = save_secrets(&secrets) {
                return emit_err(opts, &err);
            }
            emit_ok(opts, json!({ "saved": true }), "API Key 已保存")
        }
        _ => emit_err(opts, "用法: vt llm <models|key set --value <key>>"),
    }
}

fn handle_task(opts: &GlobalOpts, args: &[String]) -> ExitCode {
    let db = match Database::open_default() {
        Ok(db) => db,
        Err(err) => return emit_err(opts, &err),
    };
    let sub = args.first().map(String::as_str).unwrap_or("");
    match sub {
        "list" => match db.load_all() {
            Ok(tasks) => {
                let summary = tasks
                    .iter()
                    .map(|t| format!("{}  {}  {:?}  {}", t.id, t.video_file.name, t.status, t.progress))
                    .collect::<Vec<_>>()
                    .join("\n");
                emit_ok(opts, json!({ "tasks": tasks }), &summary)
            }
            Err(err) => emit_err(opts, &err),
        },
        "get" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task get <id>");
            };
            match db.load_task(id) {
                Ok(task) => emit_ok(
                    opts,
                    json!({ "task": task }),
                    &serde_json::to_string_pretty(&task).unwrap_or_default(),
                ),
                Err(err) => emit_err(opts, &err),
            }
        }
        "logs" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task logs <id>");
            };
            match db.load_task(id) {
                Ok(task) => {
                    let text = task
                        .logs
                        .iter()
                        .map(|l| format!("[{}] {}", l.level, l.message))
                        .collect::<Vec<_>>()
                        .join("\n");
                    emit_ok(opts, json!({ "logs": task.logs }), &text)
                }
                Err(err) => emit_err(opts, &err),
            }
        }
        "markdown" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task markdown <id>");
            };
            match db.load_task(id) {
                Ok(task) => {
                    let Some(path) = task
                        .output_artifacts
                        .as_ref()
                        .and_then(|a| a.polished_markdown.as_ref())
                    else {
                        return emit_err(opts, "该任务尚未生成 Markdown 文稿");
                    };
                    match fs::read_to_string(path) {
                        Ok(md) => emit_ok(opts, json!({ "path": path, "markdown": md }), &md),
                        Err(err) => emit_err(opts, &format!("读取文稿失败: {err}")),
                    }
                }
                Err(err) => emit_err(opts, &err),
            }
        }
        "issues" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task issues <id>");
            };
            match db.load_task(id) {
                Ok(task) => {
                    let mode = task.options.subtitle_processing_mode;
                    let issues = review::collect_issues(&task.segments, mode);
                    let summary = issues
                        .iter()
                        .map(|item| format!("[{}] {}: {}", item.segment_id, item.kind, item.message))
                        .collect::<Vec<_>>()
                        .join("\n");
                    emit_ok(opts, json!({ "issues": issues }), &summary)
                }
                Err(err) => emit_err(opts, &err),
            }
        }
        "delete" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task delete <id>");
            };
            match db.delete_task(id) {
                Ok(()) => emit_ok(opts, json!({ "deleted": id }), &format!("已删除任务 {id}")),
                Err(err) => emit_err(opts, &err),
            }
        }
        "reuse" => {
            let Some(id) = args.get(1) else {
                return emit_err(opts, "用法: vt task reuse <id> --kind <subtitle|document> [--target-lang <lang>]");
            };
            let mut kind = TaskKind::Subtitle;
            let mut target_lang: Option<String> = None;
            let mut i = 2;
            while i < args.len() {
                match args[i].as_str() {
                    "--kind" => {
                        i += 1;
                        if let Some(k) = args.get(i) {
                            kind = TaskKind::parse(k);
                        }
                    }
                    "--target-lang" => {
                        i += 1;
                        target_lang = args.get(i).cloned();
                    }
                    _ => {}
                }
                i += 1;
            }
            let source = match db.load_task(id) {
                Ok(t) => t,
                Err(err) => return emit_err(opts, &err),
            };
            let mut settings = load_settings();
            if let Some(lang) = target_lang {
                settings.target_language = lang;
            }
            let task = match create_reused_task(&source, kind, &settings) {
                Ok(t) => t,
                Err(err) => return emit_err(opts, &err),
            };
            let _ = db.upsert_task(&task);
            let api_key = current_api_key(&settings);
            let runtime = match Runtime::for_task(&settings, &task, &api_key) {
                Ok(rt) => rt,
                Err(err) => return emit_err(opts, &err),
            };
            let abort = AbortFlag::new();
            let mut hooks = PipelineHooks {
                on_event: Box::new(|_| {}),
            };
            let finished = run_task(task, &runtime, &abort, &mut hooks);
            let _ = db.upsert_task(&finished);
            if finished.status == TaskStatus::Completed {
                emit_ok(
                    opts,
                    json!({ "task": finished, "artifacts": finished.output_artifacts }),
                    &finished.id,
                )
            } else {
                emit_err(
                    opts,
                    finished.error_message.as_deref().unwrap_or("复用任务失败"),
                )
            }
        }
        _ => emit_err(opts, "用法: vt task <list|get|logs|markdown|issues|delete|reuse>"),
    }
}

fn handle_import_legacy(opts: &GlobalOpts, args: &[String]) -> ExitCode {
    if args.len() != 1 {
        return emit_err(opts, "用法: vt import-legacy <electron.db>");
    }
    match import_legacy(Path::new(&args[0]), &paths::db_path()) {
        Ok(report) => emit_ok(
            opts,
            json!({
                "importedTasks": report.imported_tasks,
                "importedSegments": report.imported_segments,
                "importedLogs": report.imported_logs,
                "skippedTasks": report.skipped_tasks,
                "pausedTasks": report.paused_tasks,
            }),
            &format!(
                "已导入 {} 个任务、{} 个字幕段、{} 条日志；跳过 {} 个已导入任务。",
                report.imported_tasks,
                report.imported_segments,
                report.imported_logs,
                report.skipped_tasks
            ),
        ),
        Err(err) => emit_err(opts, &format!("导入失败: {err}")),
    }
}

fn main() -> ExitCode {
    let raw: Vec<String> = env::args().skip(1).collect();
    if raw.is_empty() || raw.iter().any(|a| a == "-h" || a == "--help") {
        print_help();
        return ExitCode::SUCCESS;
    }
    let (opts, mut args) = match strip_global_opts(raw) {
        Ok(v) => v,
        Err(err) => {
            eprintln!("{err}");
            return ExitCode::FAILURE;
        }
    };
    if args.is_empty() {
        print_help();
        return ExitCode::SUCCESS;
    }
    configure_data_dir(&opts);
    let cmd = args.remove(0);
    match cmd.as_str() {
        "doctor" | "check" => handle_doctor(&opts),
        "subtitle" => match parse_task_args(&args) {
            Ok((input, ov)) => run_pipeline_task(&opts, &input, TaskKind::Subtitle, SubtitleProcessingMode::Translate, &ov),
            Err(err) => emit_err(&opts, &err),
        },
        "extract" | "import" | "import-srt" => match parse_task_args(&args) {
            Ok((input, ov)) => run_pipeline_task(&opts, &input, TaskKind::Subtitle, SubtitleProcessingMode::Extract, &ov),
            Err(err) => emit_err(&opts, &err),
        },
        "document" => match parse_task_args(&args) {
            Ok((input, ov)) => run_pipeline_task(&opts, &input, TaskKind::Document, SubtitleProcessingMode::Translate, &ov),
            Err(err) => emit_err(&opts, &err),
        },
        "import-legacy" => handle_import_legacy(&opts, &args),
        "task" => handle_task(&opts, &args),
        "config" => handle_config(&opts, &args),
        "llm" => handle_llm(&opts, &args),
        other => emit_err(&opts, &format!("未知命令: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_global_and_task_flags() {
        let raw = vec![
            "subtitle".into(),
            "/tmp/demo.mp4".into(),
            "--target-lang".into(),
            "zh".into(),
            "--no-polish".into(),
            "--burn".into(),
            "--json".into(),
        ];
        let (opts, mut rest) = strip_global_opts(raw).expect("global opts");
        assert!(opts.json);
        assert_eq!(rest.remove(0), "subtitle");
        let (input, ov) = parse_task_args(&rest).expect("task args");
        assert_eq!(input, "/tmp/demo.mp4");
        assert_eq!(ov.target_lang.as_deref(), Some("zh"));
        assert!(ov.no_polish);
        assert!(ov.burn);
    }
}
