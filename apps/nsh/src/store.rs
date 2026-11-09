//! 应用状态：任务列表、设置与流水线调度。信号私有，页面通过函数读写。

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use nsh_core::prelude::*;

use crate::domain::{
    db::{Database, append_log},
    model::{
        Segment, SubtitleBurnMode, SubtitleProcessingMode, TaskKind, TaskStatus, TranslationTask,
    },
    paths::{self, settings_path},
    pipeline::{AbortFlag, PipelineHooks, Runtime, create_task_from_input, regenerate_subtitles, run_task},
    settings::{AppSettings, parse_settings_json},
    system_check::{self, CheckResult},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Panel {
    Add,
    Tasks,
    Settings,
}

#[derive(Clone)]
struct Workspace {
    tasks: Vec<TranslationTask>,
    settings: AppSettings,
    kind: TaskKind,
    panel: Panel,
    selected: Option<String>,
    path_draft: String,
    processing: SubtitleProcessingMode,
    burn: bool,
    message: String,
    checks: Vec<CheckResult>,
    api_key: String,
}

impl Default for Workspace {
    fn default() -> Self {
        let _ = paths::ensure_dir(&paths::data_dir());
        let settings = load_settings();
        let tasks = Database::open_default()
            .and_then(|db| db.load_all())
            .unwrap_or_default();
        Self {
            tasks,
            settings,
            kind: TaskKind::Subtitle,
            panel: Panel::Add,
            selected: None,
            path_draft: String::new(),
            processing: SubtitleProcessingMode::Extract,
            burn: false,
            message: String::new(),
            checks: Vec::new(),
            api_key: load_api_key(),
        }
    }
}

fn ws() -> Signal<Workspace> {
    global::<Workspace>()
}

static ABORTS: LazyLock<Mutex<HashMap<String, Arc<AbortFlag>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn load_settings() -> AppSettings {
    fs::read_to_string(settings_path())
        .ok()
        .map(|raw| parse_settings_json(&raw))
        .unwrap_or_default()
}

fn save_settings(settings: &AppSettings) {
    let _ = paths::ensure_dir(&paths::data_dir());
    if let Ok(raw) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(settings_path(), raw);
    }
}

fn load_api_key() -> String {
    fs::read_to_string(paths::secrets_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("llmApiKey").and_then(|k| k.as_str()).map(str::to_string))
        .unwrap_or_default()
}

fn save_api_key(key: &str) {
    let _ = paths::ensure_dir(&paths::data_dir());
    let raw = serde_json::json!({ "llmApiKey": key });
    let _ = fs::write(paths::secrets_path(), raw.to_string());
}

fn persist(task: &TranslationTask) {
    if let Ok(db) = Database::open_default() {
        let _ = db.upsert_task(task);
        if let Some(log) = task.logs.last() {
            let _ = db.add_log(&task.id, log);
        }
    }
}

fn upsert_task(task: TranslationTask) {
    persist(&task);
    ws().update(|ws| {
        if let Some(existing) = ws.tasks.iter_mut().find(|item| item.id == task.id) {
            *existing = task;
        } else {
            ws.tasks.insert(0, task);
        }
    });
}

pub(crate) fn kind() -> TaskKind {
    ws().with(|ws| ws.kind)
}

pub(crate) fn set_kind(kind: TaskKind) {
    ws().update(|ws| {
        ws.kind = kind;
        ws.panel = Panel::Add;
    });
}

pub(crate) fn panel() -> Panel {
    ws().with(|ws| ws.panel)
}

pub(crate) fn set_panel(panel: Panel) {
    ws().update(|ws| ws.panel = panel);
}

pub(crate) fn path_draft() -> String {
    ws().with(|ws| ws.path_draft.clone())
}

pub(crate) fn set_path_draft(value: String) {
    ws().update(|ws| ws.path_draft = value);
}

pub(crate) fn processing() -> SubtitleProcessingMode {
    ws().with(|ws| ws.processing)
}

pub(crate) fn set_processing(mode: SubtitleProcessingMode) {
    ws().update(|ws| ws.processing = mode);
}

pub(crate) fn burn() -> bool {
    ws().with(|ws| ws.burn)
}

pub(crate) fn set_burn(value: bool) {
    ws().update(|ws| ws.burn = value);
}

pub(crate) fn message() -> String {
    ws().with(|ws| ws.message.clone())
}

pub(crate) fn settings() -> AppSettings {
    ws().with(|ws| ws.settings.clone())
}

pub(crate) fn update_settings(next: AppSettings) {
    save_settings(&next);
    ws().update(|ws| ws.settings = next);
}

pub(crate) fn api_key() -> String {
    ws().with(|ws| ws.api_key.clone())
}

pub(crate) fn set_api_key(value: String) {
    save_api_key(&value);
    ws().update(|ws| ws.api_key = value);
}

pub(crate) fn checks() -> Vec<CheckResult> {
    ws().with(|ws| ws.checks.clone())
}

pub(crate) fn visible_tasks() -> Vec<TranslationTask> {
    let kind = kind();
    ws().with(|ws| {
        ws.tasks
            .iter()
            .filter(|task| task.kind == kind)
            .cloned()
            .collect()
    })
}

pub(crate) fn visible_count() -> usize {
    visible_tasks().len()
}

pub(crate) fn visible_ids() -> Vec<String> {
    visible_tasks().into_iter().map(|task| task.id).collect()
}

pub(crate) fn visible_at(index: usize) -> Option<TranslationTask> {
    visible_tasks().into_iter().nth(index)
}

pub(crate) fn task_by_id(id: &str) -> Option<TranslationTask> {
    ws().with(|ws| ws.tasks.iter().find(|task| task.id == id).cloned())
}

pub(crate) fn selected_id() -> Option<String> {
    ws().with(|ws| ws.selected.clone())
}

pub(crate) fn select_task(id: String) {
    ws().update(|ws| {
        ws.selected = Some(id);
        ws.panel = Panel::Tasks;
    });
}

pub(crate) fn selected_task() -> Option<TranslationTask> {
    let id = selected_id()?;
    task_by_id(&id)
}

pub(crate) fn submit_input() {
    let (input, kind, settings, processing, burn) = ws().with(|ws| {
        (
            ws.path_draft.clone(),
            ws.kind,
            ws.settings.clone(),
            ws.processing,
            ws.burn,
        )
    });
    match create_task_from_input(
        &input,
        kind,
        &settings,
        processing,
        burn,
        SubtitleBurnMode::Bilingual,
    ) {
        Ok(task) => {
            let id = task.id.clone();
            ws().update(|ws| {
                ws.path_draft.clear();
                ws.panel = Panel::Tasks;
                ws.selected = Some(id.clone());
                ws.message.clear();
            });
            upsert_task(task);
            start_task(id);
        }
        Err(err) => ws().update(|ws| ws.message = err),
    }
}

pub(crate) fn add_paths(paths: Vec<PathBuf>) {
    for path in paths {
        ws().update(|ws| ws.path_draft = path.to_string_lossy().into_owned());
        submit_input();
    }
}

fn run_pipeline_now(
    task: TranslationTask,
    settings: AppSettings,
    api_key: String,
    flag: Arc<AbortFlag>,
    on_event: impl Fn(TranslationTask) + Send + 'static,
) -> Result<TranslationTask, String> {
    if !api_key.is_empty() {
        unsafe { std::env::set_var("VIDEO_TRANSLATE_LLM_API_KEY", &api_key) };
    }
    let runtime = Runtime::from_settings(&settings)?;
    let mut hooks = PipelineHooks {
        on_event: Box::new(move |event| on_event(event.task)),
    };
    Ok(run_task(task, &runtime, flag.as_ref(), &mut hooks))
}

pub(crate) fn start_task(id: String) {
    let flag = Arc::new(AbortFlag::new());
    ABORTS.lock().expect("aborts").insert(id.clone(), flag.clone());
    let snapshot = task_by_id(&id);
    let Some(task) = snapshot else {
        return;
    };
    let settings = settings();
    let api_key = api_key();
    if std::env::var("VIDEO_TRANSLATE_SYNC").ok().as_deref() == Some("1") {
        match run_pipeline_now(task, settings, api_key, flag, upsert_task) {
            Ok(final_task) => upsert_task(final_task),
            Err(err) => ws().update(|ws| ws.message = err),
        }
        ABORTS.lock().expect("aborts").remove(&id);
        return;
    }
    let events: Arc<Mutex<Vec<TranslationTask>>> = Arc::new(Mutex::new(Vec::new()));
    let events_bg = events.clone();
    let join = std::thread::Builder::new()
        .name(format!("pipeline-{id}"))
        .spawn({
            let flag = flag.clone();
            move || {
                run_pipeline_now(task, settings, api_key, flag, move |item| {
                    events_bg.lock().expect("events").push(item);
                })
            }
        });
    let join = match join {
        Ok(join) => join,
        Err(err) => {
            ws().update(|ws| ws.message = format!("无法启动流水线: {err}"));
            return;
        }
    };
    spawn(async move {
        loop {
            {
                let batch = {
                    let mut guard = events.lock().expect("events");
                    std::mem::take(&mut *guard)
                };
                for item in batch {
                    upsert_task(item);
                }
            }
            if join.is_finished() {
                match join.join() {
                    Ok(Ok(final_task)) => upsert_task(final_task),
                    Ok(Err(err)) => ws().update(|ws| ws.message = err),
                    Err(_) => ws().update(|ws| ws.message = "流水线线程失败".into()),
                }
                ABORTS.lock().expect("aborts").remove(&id);
                break;
            }
            timer(Duration::from_millis(80)).await;
        }
    });
}

pub(crate) fn pause_task(id: &str) {
    if let Some(flag) = ABORTS.lock().expect("aborts").get(id) {
        flag.cancel();
    }
}

pub(crate) fn resume_task(id: String) {
    if let Some(mut task) = task_by_id(&id) {
        task.status = TaskStatus::Pending;
        task.error_message = None;
        upsert_task(task);
        start_task(id);
    }
}

pub(crate) fn retry_task(id: String) {
    resume_task(id);
}

pub(crate) fn delete_task(id: &str) {
    pause_task(id);
    if let Ok(db) = Database::open_default() {
        let _ = db.delete_task(id);
    }
    ws().update(|ws| {
        ws.tasks.retain(|task| task.id != id);
        if ws.selected.as_deref() == Some(id) {
            ws.selected = None;
        }
    });
}

pub(crate) fn delete_finished() {
    let ids: Vec<String> = visible_tasks()
        .into_iter()
        .filter(|task| task.status.is_bulk_deletable())
        .map(|task| task.id)
        .collect();
    for id in ids {
        delete_task(&id);
    }
}

pub(crate) fn update_segment(task_id: &str, segment: Segment) {
    let mut task = match task_by_id(task_id) {
        Some(task) => task,
        None => return,
    };
    if let Some(existing) = task.segments.iter_mut().find(|item| item.id == segment.id) {
        *existing = segment;
    }
    task.updated_at = crate::domain::model::now();
    upsert_task(task);
}

pub(crate) fn save_review(task_id: &str) {
    let mut task = match task_by_id(task_id) {
        Some(task) => task,
        None => return,
    };
    match regenerate_subtitles(&mut task) {
        Ok(()) => {
            task.logs
                .push(append_log("success", "已根据校对结果重新导出字幕", None));
            upsert_task(task);
            ws().update(|ws| ws.message = "已重新导出字幕".into());
        }
        Err(err) => ws().update(|ws| ws.message = err),
    }
}

pub(crate) fn run_system_check() {
    spawn(async move {
        let results = blocking(system_check::run_checks).await.unwrap_or_default();
        ws().update(|ws| {
            ws.checks = results;
            ws.message = "系统自检完成".into();
        });
    });
}

pub(crate) fn download_sensevoice() {
    spawn(async move {
        ws().update(|ws| ws.message = "正在下载 SenseVoice…".into());
        match blocking(crate::domain::asr::ensure_sensevoice).await {
            Ok(Ok(paths)) => ws().update(|ws| {
                ws.message = format!("SenseVoice 已就绪: {}", paths.dir.display());
            }),
            Ok(Err(err)) => ws().update(|ws| ws.message = err),
            Err(_) => ws().update(|ws| ws.message = "下载失败".into()),
        }
    });
}

pub(crate) fn list_models() {
    spawn(async move {
        let (url, key) = ws().with(|ws| (ws.settings.llm_base_url.clone(), ws.api_key.clone()));
        let listed = blocking(move || crate::domain::llm::list_models(&url, &key)).await;
        match listed {
            Ok(Ok(models)) => ws().update(|ws| {
                ws.message = if models.is_empty() {
                    "已连接，但未返回模型".into()
                } else {
                    format!("可用模型 {} 个：{}", models.len(), models.into_iter().take(8).collect::<Vec<_>>().join(", "))
                };
            }),
            Ok(Err(err)) => ws().update(|ws| ws.message = err),
            Err(err) => ws().update(|ws| ws.message = format!("{err}")),
        }
    });
}
