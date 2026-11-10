//! 应用状态：任务列表、设置与流水线调度。信号私有，页面通过函数读写。

use std::{
    collections::{HashMap, HashSet},
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
    pipeline::{
        AbortFlag, PipelineHooks, Runtime, can_reuse_transcript, create_reused_task,
        create_task_from_input, regenerate_subtitles, retranslate_segment, run_task,
    },
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
    api_keys: HashMap<String, String>,
    jobs: Option<Owner>,
}

impl Default for Workspace {
    fn default() -> Self {
        let _ = paths::ensure_dir(&paths::data_dir());
        let settings = load_settings();
        let (tasks, load_error) = match Database::open_default().and_then(|db| db.load_all()) {
            Ok(mut tasks) => {
                for task in &mut tasks {
                    if task.status.is_running() || task.status == TaskStatus::Pending {
                        task.status = TaskStatus::Paused;
                        task.logs
                            .push(append_log("warn", "上次运行已中断，可点恢复继续", None));
                    }
                }
                (tasks, String::new())
            }
            Err(err) => (Vec::new(), format!("读取任务失败: {err}")),
        };
        Self {
            tasks,
            settings,
            kind: TaskKind::Subtitle,
            panel: Panel::Add,
            selected: None,
            path_draft: String::new(),
            processing: SubtitleProcessingMode::Extract,
            burn: false,
            message: load_error,
            checks: Vec::new(),
            api_keys: load_api_keys(),
            jobs: None,
        }
    }
}

fn ws() -> Signal<Workspace> {
    global::<Workspace>()
}

static PAUSED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
static DELETED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

static ABORTS: LazyLock<Mutex<HashMap<String, Arc<AbortFlag>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn load_settings() -> AppSettings {
    fs::read_to_string(settings_path())
        .ok()
        .map(|raw| parse_settings_json(&raw))
        .unwrap_or_default()
}

fn save_settings(settings: &AppSettings) {
    let result = paths::ensure_dir(&paths::data_dir())
        .map_err(|e| e.to_string())
        .and_then(|_| serde_json::to_vec_pretty(settings).map_err(|e| e.to_string()))
        .and_then(|raw| fs::write(settings_path(), raw).map_err(|e| e.to_string()));
    if let Err(err) = result {
        set_message(format!("保存设置失败: {err}"));
    }
}

fn load_api_keys() -> HashMap<String, String> {
    let Ok(raw) = fs::read_to_string(paths::secrets_path()) else {
        return HashMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return HashMap::new();
    };
    if let Some(keys) = value.get("serviceKeys") {
        return serde_json::from_value(keys.clone()).unwrap_or_default();
    }
    // 0.9.0 初始 NSH 格式只有默认服务的一把密钥。
    value
        .get("llmApiKey")
        .and_then(|v| v.as_str())
        .map(|key| {
            HashMap::from([(
                crate::domain::settings::LEGACY_LLM_SERVICE_ID.to_owned(),
                key.to_owned(),
            )])
        })
        .unwrap_or_default()
}

fn save_api_keys(keys: &HashMap<String, String>) {
    use std::io::Write;
    let result = (|| -> Result<(), std::io::Error> {
        paths::ensure_dir(&paths::data_dir())?;
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            options.mode(0o600);
            if paths::secrets_path().exists() {
                fs::set_permissions(paths::secrets_path(), fs::Permissions::from_mode(0o600))?;
            }
        }
        let mut file = options.open(paths::secrets_path())?;
        file.write_all(
            serde_json::json!({ "serviceKeys": keys })
                .to_string()
                .as_bytes(),
        )
    })();
    if let Err(err) = result {
        set_message(format!("保存凭证失败: {err}"));
    }
}

fn persist(task: &TranslationTask) -> Result<(), String> {
    Database::open_default()?.upsert_task(task)
}

fn upsert_task(mut task: TranslationTask) {
    if task.status == TaskStatus::Cancelled && PAUSED.lock().expect("paused").contains(&task.id) {
        task.status = TaskStatus::Paused;
    }
    if matches!(task.status, TaskStatus::Paused | TaskStatus::Cancelled) {
        task.error_message = None;
    }
    if DELETED.lock().expect("deleted").contains(&task.id) {
        return;
    }
    if let Err(err) = persist(&task) {
        set_message(format!("保存任务失败: {err}"));
        return;
    }
    ws().update(|ws| {
        if ws.message.starts_with("正在暂停") && task.status == TaskStatus::Paused {
            ws.message = "任务已暂停，可点恢复继续".into();
        } else if ws.message.starts_with("正在取消") && task.status == TaskStatus::Cancelled {
            ws.message = "任务已取消".into();
        }
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

pub(crate) fn update_settings(mut next: AppSettings) {
    if let Some(service) = next
        .llm_services
        .iter_mut()
        .find(|s| s.id == next.selected_llm_service_id)
    {
        service.llm_base_url = next.llm_base_url.clone();
        service.translate_model = next.translate_model.clone();
        service.polish_model = next.polish_model.clone();
    }
    save_settings(&next);
    ws().update(|ws| ws.settings = next);
}

pub(crate) fn api_key() -> String {
    ws().with(|ws| {
        ws.api_keys
            .get(&ws.settings.selected_llm_service_id)
            .cloned()
            .unwrap_or_default()
    })
}
fn task_api_key(task: &TranslationTask) -> String {
    let id = task
        .options
        .llm_service_id
        .as_deref()
        .unwrap_or(crate::domain::settings::LEGACY_LLM_SERVICE_ID);
    ws().with(|ws| ws.api_keys.get(id).cloned().unwrap_or_default())
}

pub(crate) fn set_api_key(value: String) {
    let keys = ws().with(|ws| {
        let mut keys = ws.api_keys.clone();
        keys.insert(ws.settings.selected_llm_service_id.clone(), value);
        keys
    });
    save_api_keys(&keys);
    ws().update(|ws| ws.api_keys = keys);
}

pub(crate) fn select_service(id: &str) {
    let mut next = settings();
    let Some(service) = next.llm_services.iter().find(|s| s.id == id).cloned() else {
        return;
    };
    next.selected_llm_service_id = service.id;
    next.llm_base_url = service.llm_base_url;
    next.translate_model = service.translate_model;
    next.polish_model = service.polish_model;
    update_settings(next);
}

pub(crate) fn add_service() {
    let mut next = settings();
    let id = crate::domain::model::new_id();
    next.llm_services
        .push(crate::domain::settings::LlmServiceConfig {
            id: id.clone(),
            name: format!("服务 {}", next.llm_services.len() + 1),
            llm_base_url: String::new(),
            translate_model: String::new(),
            polish_model: String::new(),
        });
    update_settings(next);
    select_service(&id);
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

pub(crate) fn selected_can_reuse() -> bool {
    selected_task().is_some_and(|task| can_reuse_transcript(&task))
}

pub(crate) fn reuse_selected(kind: TaskKind) {
    let Some(source) = selected_task() else {
        ws().update(|ws| ws.message = "请先选择任务".into());
        return;
    };
    let settings = settings();
    match create_reused_task(&source, kind, &settings) {
        Ok(task) => {
            let id = task.id.clone();
            ws().update(|ws| {
                ws.kind = kind;
                ws.panel = Panel::Tasks;
                ws.selected = Some(id.clone());
                ws.message = if kind == TaskKind::Document {
                    "已复用识别结果创建文稿任务".into()
                } else {
                    "已复用识别结果创建字幕任务".into()
                };
            });
            upsert_task(task);
            start_task(id);
        }
        Err(err) => ws().update(|ws| ws.message = err),
    }
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
    let runtime = match Runtime::for_task(&settings, &task, &api_key) {
        Ok(runtime) => runtime,
        Err(err) => {
            let mut task = task;
            task.status = TaskStatus::Failed;
            task.error_message = Some(err.clone());
            task.logs.push(append_log("error", &err, None));
            task.updated_at = crate::domain::model::now();
            return Ok(task);
        }
    };
    let mut hooks = PipelineHooks {
        on_event: Box::new(move |event| on_event(event.task)),
    };
    Ok(run_task(task, &runtime, flag.as_ref(), &mut hooks))
}

pub(crate) fn start_task(id: String) {
    if ABORTS.lock().expect("aborts").contains_key(&id) {
        return;
    }
    let flag = Arc::new(AbortFlag::new());
    ABORTS
        .lock()
        .expect("aborts")
        .insert(id.clone(), flag.clone());
    let snapshot = task_by_id(&id);
    let Some(task) = snapshot else {
        return;
    };
    let settings = settings();
    let api_key = task_api_key(&task);
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
            ABORTS.lock().expect("aborts").remove(&id);
            ws().update(|ws| ws.message = format!("无法启动流水线: {err}"));
            return;
        }
    };
    spawn_job(async move {
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
        PAUSED.lock().expect("paused").insert(id.to_owned());
        flag.cancel();
        set_message("正在暂停，等待当前识别或模型请求结束".into());
    }
}

pub(crate) fn cancel_task(id: &str) {
    PAUSED.lock().expect("paused").remove(id);
    if let Some(flag) = ABORTS.lock().expect("aborts").get(id) {
        flag.cancel();
        set_message("正在取消，等待当前识别或模型请求结束".into());
    }
}

pub(crate) fn resume_task(id: String) {
    if ABORTS.lock().expect("aborts").contains_key(&id) {
        set_message("任务仍在停止，请稍后恢复".into());
        return;
    }
    PAUSED.lock().expect("paused").remove(&id);
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
    if let Err(err) = Database::open_default().and_then(|db| db.delete_task(id)) {
        set_message(format!("删除任务失败: {err}"));
        return;
    }
    DELETED.lock().expect("deleted").insert(id.to_owned());
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
    if task_is_busy(task_id) {
        return;
    }
    let mut task = match task_by_id(task_id) {
        Some(task) => task,
        None => return,
    };
    if let Some(existing) = task.segments.iter_mut().find(|item| item.id == segment.id) {
        if let Err(err) = crate::domain::review::validate_times(
            segment.start,
            segment.end,
            (task.video_file.duration > 0.0).then_some(task.video_file.duration),
        ) {
            set_message(err);
            return;
        }
        let mut segment = segment;
        if existing.original_text != segment.original_text {
            segment.polished_text = None;
        }
        *existing = segment;
    }
    task.updated_at = crate::domain::model::now();
    set_message(String::new());
    upsert_task(task);
}

pub(crate) fn attach_media(task_id: &str, path: PathBuf) {
    if task_is_busy(task_id) {
        return;
    }
    let task_id = task_id.to_owned();
    spawn_job(async move {
        let probe_path = path.clone();
        let info =
            match blocking(move || crate::domain::ffmpeg::Ffmpeg::discover()?.probe(&probe_path))
                .await
            {
                Ok(Ok(info)) => info,
                Ok(Err(err)) => {
                    set_message(err);
                    return;
                }
                Err(err) => {
                    set_message(format!("读取媒体失败: {err}"));
                    return;
                }
            };
        let Some(mut task) = task_by_id(&task_id) else {
            return;
        };
        let old_path = std::path::Path::new(&task.video_file.path);
        if old_path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| matches!(s.to_ascii_lowercase().as_str(), "srt" | "vtt"))
        {
            task.platform_subtitle_path = Some(task.video_file.path.clone());
        }
        task.video_file.path = path.to_string_lossy().into_owned();
        task.video_file.duration = info.duration;
        task.video_file.name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&task.video_file.name)
            .to_string();
        task.updated_at = crate::domain::model::now();
        upsert_task(task);
    });
}

pub(crate) fn retranslate_current(task_id: String, segment_id: String) {
    if task_is_busy(&task_id) {
        return;
    }
    let settings = settings();
    let Some(task) = task_by_id(&task_id) else {
        return;
    };
    let api_key = task_api_key(&task);
    let version = task.updated_at;
    spawn_job(async move {
        let result = blocking(move || {
            let runtime = Runtime::for_task(&settings, &task, &api_key)?;
            let completer = runtime
                .completer
                .ok_or_else(|| "翻译需要模型服务或模拟翻译".to_string())?;
            let mut task = task;
            retranslate_segment(&mut task, &segment_id, completer.as_ref())?;
            Ok::<_, String>(task)
        })
        .await;
        match result {
            Ok(Ok(task)) => {
                if task_by_id(&task.id).is_none_or(|current| current.updated_at != version) {
                    set_message("校对内容已变化，本次重译未覆盖，请重新执行".into());
                    return;
                }
                upsert_task(task);
                ws().update(|ws| ws.message = "已按术语库重译当前段".into());
            }
            Ok(Err(err)) => ws().update(|ws| ws.message = err),
            Err(err) => ws().update(|ws| ws.message = format!("{err}")),
        }
    });
}

pub(crate) fn save_review(task_id: &str) {
    if task_is_busy(task_id) {
        return;
    }
    if task_by_id(task_id).is_some_and(|t| t.kind == TaskKind::Document) {
        resume_task(task_id.to_owned());
        return;
    }
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
    spawn_job(async move {
        let results = match blocking(system_check::run_checks).await {
            Ok(results) => results,
            Err(err) => {
                set_message(format!("系统自检失败: {err}"));
                return;
            }
        };
        ws().update(|ws| {
            ws.checks = results;
            ws.message = "系统自检完成".into();
        });
    });
}

pub(crate) fn download_sensevoice() {
    spawn_job(async move {
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
    spawn_job(async move {
        let (url, key) = ws().with(|ws| {
            (
                ws.settings.llm_base_url.clone(),
                ws.api_keys
                    .get(&ws.settings.selected_llm_service_id)
                    .cloned()
                    .unwrap_or_default(),
            )
        });
        let listed = blocking(move || crate::domain::llm::list_models(&url, &key)).await;
        match listed {
            Ok(Ok(models)) => ws().update(|ws| {
                ws.message = if models.is_empty() {
                    "已连接，但未返回模型".into()
                } else {
                    format!(
                        "可用模型 {} 个：{}",
                        models.len(),
                        models.into_iter().take(8).collect::<Vec<_>>().join(", ")
                    )
                };
            }),
            Ok(Err(err)) => ws().update(|ws| ws.message = err),
            Err(err) => ws().update(|ws| ws.message = format!("{err}")),
        }
    });
}

pub(crate) fn set_message(message: String) {
    ws().update(|ws| ws.message = message);
}

pub(crate) fn edit_timing(task_id: &str, index: usize, start: f64, end: f64) {
    if let Some(mut segment) = task_by_id(task_id).and_then(|t| t.segments.get(index).cloned()) {
        segment.start = start;
        segment.end = end;
        update_segment(task_id, segment);
    }
}

pub(crate) fn cut_segment(task_id: &str, index: usize, at: Option<f64>) {
    if task_is_busy(task_id) {
        return;
    }
    let Some(mut task) = task_by_id(task_id) else {
        return;
    };
    let result = match at {
        Some(at) => crate::domain::review::split_segment(&mut task.segments, index, at),
        None => crate::domain::review::merge_next(&mut task.segments, index),
    };
    match result {
        Ok(()) => {
            task.updated_at = crate::domain::model::now();
            upsert_task(task);
        }
        Err(err) => set_message(err),
    }
}

/// 流水线与设置作业属于应用；切换页面不会取消事件接收。
pub(crate) fn init_jobs() {
    let owner = Owner::current();
    ws().update(|ws| ws.jobs = Some(owner));
}
fn spawn_job(future: impl std::future::Future<Output = ()> + 'static) {
    let owner = ws()
        .with(|ws| ws.jobs.clone())
        .expect("App initializes jobs");
    owner.run(|| {
        spawn(future);
    });
}

fn task_is_busy(id: &str) -> bool {
    if ABORTS.lock().expect("aborts").contains_key(id) {
        set_message("请先暂停任务，再校对或导出".into());
        true
    } else {
        false
    }
}
