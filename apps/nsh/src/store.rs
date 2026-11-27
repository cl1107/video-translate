//! 应用状态：任务列表、设置与流水线调度。TSX 持有 [`Workspace`] 实例。

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use nsh_core::file_dialog::{FileFilter, OpenDialog};
use nsh_core::prelude::*;
use serde::Serialize;

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
enum Panel {
    Add,
    Tasks,
    Settings,
}

impl Panel {
    fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Tasks => "tasks",
            Self::Settings => "settings",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "tasks" => Self::Tasks,
            "settings" => Self::Settings,
            _ => Self::Add,
        }
    }
}

struct AppState {
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
}

impl AppState {
    fn load() -> Self {
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
        }
    }
}

#[derive(Serialize)]
struct Snapshot {
    app_version: String,
    kind: String,
    panel: String,
    path_draft: String,
    processing: String,
    burn: bool,
    message: String,
    selected_id: Option<String>,
    api_key: String,
    settings: AppSettings,
    tasks: Vec<TranslationTask>,
    checks: Vec<CheckResult>,
}

fn build_snapshot(state: &Mutex<AppState>) -> nsh_core::JsonValue {
    let ws = state.lock().expect("workspace");
    let api_key = ws
        .api_keys
        .get(&ws.settings.selected_llm_service_id)
        .cloned()
        .unwrap_or_default();
    serde_json::to_value(Snapshot {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        kind: ws.kind.as_str().to_owned(),
        panel: ws.panel.as_str().to_owned(),
        path_draft: ws.path_draft.clone(),
        processing: ws.processing.as_str().to_owned(),
        burn: ws.burn,
        message: ws.message.clone(),
        selected_id: ws.selected.clone(),
        api_key,
        settings: ws.settings.clone(),
        tasks: ws.tasks.clone(),
        checks: ws.checks.clone(),
    })
    .unwrap_or(nsh_core::JsonValue::Null)
}

fn emit_snapshot(
    state: &Mutex<AppState>,
    listeners: &Mutex<Vec<(u64, Callback<nsh_core::JsonValue>)>>,
) {
    let snap = build_snapshot(state);
    let listeners: Vec<_> = listeners
        .lock()
        .expect("listeners")
        .iter()
        .map(|(_, cb)| cb.clone())
        .collect();
    for cb in listeners {
        cb.post(snap.clone());
    }
}

#[cfg(target_os = "macos")]
fn current_app_bundle_or_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe
        .ancestors()
        .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("app"))
        .map(Path::to_path_buf);
    Some(bundle.unwrap_or(exe))
}

fn load_settings() -> AppSettings {
    fs::read_to_string(settings_path())
        .ok()
        .map(|raw| parse_settings_json(&raw))
        .unwrap_or_default()
}

fn persist(task: &TranslationTask) -> Result<(), String> {
    Database::open_default()?.upsert_task(task)
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

/// 桌面工作区：任务、设置与流水线。
#[class]
pub struct Workspace {
    state: Arc<Mutex<AppState>>,
    listeners: Arc<Mutex<Vec<(u64, Callback<nsh_core::JsonValue>)>>>,
    listener_id: AtomicU64,
    paused: Mutex<HashSet<String>>,
    deleted: Mutex<HashSet<String>>,
    aborts: Mutex<HashMap<String, Arc<AbortFlag>>>,
}

#[class]
impl Workspace {
    /// 打开工作区。
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AppState::load())),
            listeners: Arc::new(Mutex::new(Vec::new())),
            listener_id: AtomicU64::new(1),
            paused: Mutex::new(HashSet::new()),
            deleted: Mutex::new(HashSet::new()),
            aborts: Mutex::new(HashMap::new()),
        }
    }

    /// 测试前设置隔离数据目录与模拟流水线，返回数据目录。
    pub fn configure_test(_sync: bool) -> String {
        let dir = std::env::temp_dir().join(format!("vt-nsh-{}", crate::domain::model::new_id()));
        let _ = fs::create_dir_all(&dir);
        unsafe {
            std::env::set_var("VIDEO_TRANSLATE_DATA_DIR", &dir);
            std::env::set_var("VIDEO_TRANSLATE_MOCK_ASR", "1");
            std::env::set_var("VIDEO_TRANSLATE_MOCK_LLM", "1");
            std::env::remove_var("VIDEO_TRANSLATE_SYNC");
        }
        let mut settings = crate::domain::settings::AppSettings::default();
        settings.mock_asr = true;
        settings.mock_llm = true;
        if let Ok(raw) = serde_json::to_vec_pretty(&settings) {
            let _ = fs::write(crate::domain::paths::settings_path(), raw);
        }
        dir.to_string_lossy().into_owned()
    }

    /// 当前工作区快照。
    pub fn snapshot(&self) -> nsh_core::JsonValue {
        self.snapshot_value()
    }

    /// 工作区变化时调用。
    pub fn on_change(
        &self,
        #[args(snapshot)] listener: Callback<nsh_core::JsonValue>,
    ) -> nsh_core::element::Stop {
        let id = self.listener_id.fetch_add(1, Ordering::Relaxed);
        self.listeners
            .lock()
            .expect("listeners")
            .push((id, listener));
        let listeners = self.listeners.clone();
        nsh_core::element::Stop::new(move || {
            listeners
                .lock()
                .expect("listeners")
                .retain(|(item, _)| *item != id);
        })
    }

    /// 切换字幕 / 文稿工作流。
    pub fn set_kind(&self, kind: String) {
        let mut ws = self.state.lock().expect("workspace");
        ws.kind = TaskKind::parse(&kind);
        ws.panel = Panel::Add;
        drop(ws);
        self.notify();
    }

    /// 切换添加 / 任务 / 设置面板。
    pub fn set_panel(&self, panel: String) {
        self.state.lock().expect("workspace").panel = Panel::parse(&panel);
        self.notify();
    }

    /// 输入框草稿。
    pub fn set_path_draft(&self, value: String) {
        self.state.lock().expect("workspace").path_draft = value;
        self.notify();
    }

    /// 字幕处理方式。
    pub fn set_processing(&self, mode: String) {
        self.state.lock().expect("workspace").processing = SubtitleProcessingMode::parse(&mode);
        self.notify();
    }

    /// 是否烧录硬字幕。
    pub fn set_burn(&self, value: bool) {
        self.state.lock().expect("workspace").burn = value;
        self.notify();
    }

    /// 覆盖保存设置。
    pub fn update_settings(&self, value: nsh_core::JsonValue) {
        match serde_json::from_value::<AppSettings>(value) {
            Ok(next) => self.write_settings(next),
            Err(err) => {
                self.set_message_inner(format!("设置无效: {err}"));
                self.notify();
            }
        }
    }

    /// 当前选中服务的 API Key。
    pub fn set_api_key(&self, value: String) {
        let keys = {
            let mut ws = self.state.lock().expect("workspace");
            let id = ws.settings.selected_llm_service_id.clone();
            if ws
                .api_keys
                .get(&id)
                .is_some_and(|current| current == &value)
            {
                return;
            }
            ws.api_keys.insert(id, value);
            ws.api_keys.clone()
        };
        self.save_api_keys(&keys);
        self.notify();
    }

    /// 选中一个模型服务。
    pub fn select_service(&self, id: String) {
        let mut next = self.settings();
        if next.selected_llm_service_id == id {
            return;
        }
        let Some(service) = next.llm_services.iter().find(|s| s.id == id).cloned() else {
            return;
        };
        next.selected_llm_service_id = service.id;
        next.llm_base_url = service.llm_base_url;
        next.translate_model = service.translate_model;
        next.polish_model = service.polish_model;
        self.write_settings(next);
    }

    /// 新增模型服务。
    pub fn add_service(&self) {
        let mut next = self.settings();
        let id = crate::domain::model::new_id();
        next.llm_services
            .push(crate::domain::settings::LlmServiceConfig {
                id: id.clone(),
                name: format!("服务 {}", next.llm_services.len() + 1),
                llm_base_url: String::new(),
                translate_model: String::new(),
                polish_model: String::new(),
            });
        self.write_settings(next);
        self.select_service(id);
    }

    /// 删除当前模型服务；至少保留一个。
    pub fn remove_service(&self) {
        let mut next = self.settings();
        if next.llm_services.len() <= 1 {
            self.set_message_inner("至少保留一个模型服务".into());
            self.notify();
            return;
        }
        let id = next.selected_llm_service_id.clone();
        next.llm_services.retain(|s| s.id != id);
        let fallback = next.llm_services[0].clone();
        next.selected_llm_service_id = fallback.id;
        next.llm_base_url = fallback.llm_base_url;
        next.translate_model = fallback.translate_model;
        next.polish_model = fallback.polish_model;
        {
            let mut ws = self.state.lock().expect("workspace");
            ws.api_keys.remove(&id);
            let keys = ws.api_keys.clone();
            drop(ws);
            self.save_api_keys(&keys);
        }
        self.write_settings(next);
    }

    /// 选中任务。
    pub fn select_task(&self, id: String) {
        let mut ws = self.state.lock().expect("workspace");
        ws.selected = Some(id);
        ws.panel = Panel::Tasks;
        drop(ws);
        self.notify();
    }

    /// 从输入创建任务。
    pub async fn submit_input(this: Instance<Self>) {
        let (input, kind, settings, processing, burn) = this.with(|ws| {
            let state = ws.state.lock().expect("workspace");
            (
                state.path_draft.clone(),
                state.kind,
                state.settings.clone(),
                state.processing,
                state.burn,
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
                this.with(|ws| {
                    let mut state = ws.state.lock().expect("workspace");
                    state.path_draft.clear();
                    state.panel = Panel::Tasks;
                    state.selected = Some(id.clone());
                    state.message.clear();
                });
                this.with(|ws| ws.upsert_task(task));
                timer(Duration::from_millis(0)).await;
                Workspace::start_task(this, id).await;
            }
            Err(err) => {
                this.with(|ws| {
                    ws.set_message_inner(err);
                    ws.notify();
                });
            }
        }
    }

    /// 加入本地路径并创建任务。
    pub async fn add_paths(this: Instance<Self>, paths: Vec<String>) {
        for path in paths {
            this.with(|ws| {
                ws.state.lock().expect("workspace").path_draft = path;
            });
            Workspace::submit_input(this.clone()).await;
        }
    }

    /// 系统文件选择器。
    pub async fn pick_files(this: Instance<Self>, kind: String) -> Vec<String> {
        let _ = &this;
        let dialog = match kind.as_str() {
            "subtitles" => OpenDialog::files()
                .multiple(true)
                .filter(FileFilter::new("字幕", ["srt", "vtt"]))
                .title("导入字幕")
                .button_label("导入"),
            "media" => OpenDialog::files()
                .filter(FileFilter::new(
                    "媒体",
                    ["mp4", "mkv", "mov", "webm", "m4v", "avi", "mp3", "wav"],
                ))
                .title("关联视频")
                .button_label("关联"),
            _ => OpenDialog::files()
                .multiple(true)
                .filter(FileFilter::new(
                    "视频",
                    [
                        "mp4", "mkv", "mov", "webm", "m4v", "avi", "mp3", "wav", "m4a",
                    ],
                ))
                .title("添加视频")
                .button_label("添加"),
        };
        match pick_paths(dialog).await {
            Ok(Some(paths)) => paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// 启动任务流水线。
    pub async fn start_task(this: Instance<Self>, id: String) {
        let started = this.with(|ws| ws.take_start(id.clone()));
        let Some((task, settings, api_key, flag)) = started else {
            return;
        };
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
                this.with(|ws| {
                    ws.aborts.lock().expect("aborts").remove(&id);
                    ws.set_message_inner(format!("无法启动流水线: {err}"));
                    ws.notify();
                });
                return;
            }
        };
        loop {
            let batch = {
                let mut guard = events.lock().expect("events");
                std::mem::take(&mut *guard)
            };
            this.with(|ws| {
                for item in batch {
                    ws.upsert_task(item);
                }
            });
            if join.is_finished() {
                match join.join() {
                    Ok(Ok(final_task)) => this.with(|ws| ws.upsert_task(final_task)),
                    Ok(Err(err)) => this.with(|ws| {
                        ws.set_message_inner(err);
                        ws.notify();
                    }),
                    Err(_) => this.with(|ws| {
                        ws.set_message_inner("流水线线程失败".into());
                        ws.notify();
                    }),
                }
                this.with(|ws| {
                    ws.aborts.lock().expect("aborts").remove(&id);
                });
                break;
            }
            timer(Duration::from_millis(80)).await;
        }
    }

    /// 暂停任务。
    pub fn pause_task(&self, id: String) {
        if let Some(flag) = self.aborts.lock().expect("aborts").get(&id) {
            self.paused.lock().expect("paused").insert(id);
            flag.cancel();
            self.set_message_inner("正在暂停，等待当前识别或模型请求结束".into());
            self.notify();
        }
    }

    /// 取消任务。
    pub fn cancel_task(&self, id: String) {
        self.paused.lock().expect("paused").remove(&id);
        if let Some(flag) = self.aborts.lock().expect("aborts").get(&id) {
            flag.cancel();
            self.set_message_inner("正在取消，等待当前识别或模型请求结束".into());
            self.notify();
        }
    }

    /// 恢复任务。
    pub async fn resume_task(this: Instance<Self>, id: String) {
        let busy = this.with(|ws| ws.aborts.lock().expect("aborts").contains_key(&id));
        if busy {
            this.with(|ws| {
                ws.set_message_inner("任务仍在停止，请稍后恢复".into());
                ws.notify();
            });
            return;
        }
        this.with(|ws| {
            ws.paused.lock().expect("paused").remove(&id);
            if let Some(mut task) = ws.task_by_id(&id) {
                task.status = TaskStatus::Pending;
                task.error_message = None;
                if task.source_url.is_some() && !Path::new(&task.video_file.path).is_file() {
                    let settings = ws.settings();
                    task.options.download_proxy = settings.download_proxy;
                    task.options.download_cookie_browser = settings.download_cookie_browser;
                }
                ws.upsert_task(task);
            }
        });
        Workspace::start_task(this, id).await;
    }

    /// 重试任务。
    pub async fn retry_task(this: Instance<Self>, id: String) {
        Workspace::resume_task(this, id).await;
    }

    /// 删除任务。
    pub fn delete_task(&self, id: String) {
        self.pause_task(id.clone());
        if let Err(err) = Database::open_default().and_then(|db| db.delete_task(&id)) {
            self.set_message_inner(format!("删除任务失败: {err}"));
            self.notify();
            return;
        }
        self.deleted.lock().expect("deleted").insert(id.clone());
        {
            let mut ws = self.state.lock().expect("workspace");
            ws.tasks.retain(|task| task.id != id);
            if ws.selected.as_deref() == Some(id.as_str()) {
                ws.selected = None;
            }
        }
        self.notify();
    }

    /// 清理当前工作流中已结束的任务。
    pub fn delete_finished(&self) {
        let ids: Vec<String> = self
            .visible_tasks()
            .into_iter()
            .filter(|task| task.status.is_bulk_deletable())
            .map(|task| task.id)
            .collect();
        for id in ids {
            self.delete_task(id);
        }
    }

    /// 复用识别结果。
    pub async fn reuse_selected(this: Instance<Self>, kind: String) {
        let kind = TaskKind::parse(&kind);
        let source = this.with(|ws| {
            let state = ws.state.lock().expect("workspace");
            state
                .selected
                .as_ref()
                .and_then(|id| state.tasks.iter().find(|task| &task.id == id).cloned())
        });
        let Some(source) = source else {
            this.with(|ws| {
                ws.set_message_inner("请先选择任务".into());
                ws.notify();
            });
            return;
        };
        let settings = this.with(|ws| ws.settings());
        match create_reused_task(&source, kind, &settings) {
            Ok(task) => {
                let id = task.id.clone();
                this.with(|ws| {
                    let mut state = ws.state.lock().expect("workspace");
                    state.kind = kind;
                    state.panel = Panel::Tasks;
                    state.selected = Some(id.clone());
                    state.message = if kind == TaskKind::Document {
                        "已复用识别结果创建文稿任务".into()
                    } else {
                        "已复用识别结果创建字幕任务".into()
                    };
                });
                this.with(|ws| ws.upsert_task(task));
                timer(Duration::from_millis(0)).await;
                Workspace::start_task(this, id).await;
            }
            Err(err) => {
                this.with(|ws| {
                    ws.set_message_inner(err);
                    ws.notify();
                });
            }
        }
    }

    /// 更新一段字幕。
    pub fn update_segment(&self, task_id: String, value: nsh_core::JsonValue) {
        if self.task_is_busy(&task_id) {
            return;
        }
        let Ok(segment) = serde_json::from_value::<Segment>(value) else {
            return;
        };
        let mut task = match self.task_by_id(&task_id) {
            Some(task) => task,
            None => return,
        };
        if let Some(existing) = task.segments.iter_mut().find(|item| item.id == segment.id) {
            if let Err(err) = crate::domain::review::validate_times(
                segment.start,
                segment.end,
                (task.video_file.duration > 0.0).then_some(task.video_file.duration),
            ) {
                self.set_message_inner(err);
                self.notify();
                return;
            }
            let mut segment = segment;
            if existing.original_text != segment.original_text {
                segment.polished_text = None;
            }
            if *existing == segment {
                return;
            }
            *existing = segment;
        }
        task.updated_at = crate::domain::model::now();
        self.set_message_inner(String::new());
        self.upsert_task(task);
    }

    /// 关联媒体文件。
    pub async fn attach_media(this: Instance<Self>, task_id: String, path: String) {
        if this.with(|ws| ws.task_is_busy(&task_id)) {
            return;
        }
        let probe_path = PathBuf::from(&path);
        let info =
            match blocking(move || crate::domain::ffmpeg::Ffmpeg::discover()?.probe(&probe_path))
                .await
            {
                Ok(Ok(info)) => info,
                Ok(Err(err)) => {
                    this.with(|ws| {
                        ws.set_message_inner(err);
                        ws.notify();
                    });
                    return;
                }
                Err(err) => {
                    this.with(|ws| {
                        ws.set_message_inner(format!("读取媒体失败: {err}"));
                        ws.notify();
                    });
                    return;
                }
            };
        this.with(|ws| {
            let Some(mut task) = ws.task_by_id(&task_id) else {
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
            task.video_file.path = path.clone();
            task.video_file.duration = info.duration;
            task.video_file.name = std::path::Path::new(&path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&task.video_file.name)
                .to_string();
            task.updated_at = crate::domain::model::now();
            ws.upsert_task(task);
        });
    }

    /// 按术语库重译当前段。
    pub async fn retranslate_current(this: Instance<Self>, task_id: String, segment_id: String) {
        if this.with(|ws| ws.task_is_busy(&task_id)) {
            return;
        }
        let settings = this.with(|ws| ws.settings());
        let Some(task) = this.with(|ws| ws.task_by_id(&task_id)) else {
            return;
        };
        let api_key = this.with(|ws| ws.task_api_key(&task));
        let version = task.updated_at;
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
                let stale = this.with(|ws| {
                    ws.task_by_id(&task.id)
                        .is_none_or(|current| current.updated_at != version)
                });
                if stale {
                    this.with(|ws| {
                        ws.set_message_inner("校对内容已变化，本次重译未覆盖，请重新执行".into());
                        ws.notify();
                    });
                    return;
                }
                this.with(|ws| {
                    ws.upsert_task(task);
                    ws.set_message_inner("已按术语库重译当前段".into());
                    ws.notify();
                });
            }
            Ok(Err(err)) => this.with(|ws| {
                ws.set_message_inner(err);
                ws.notify();
            }),
            Err(err) => this.with(|ws| {
                ws.set_message_inner(format!("{err}"));
                ws.notify();
            }),
        }
    }

    /// 保存校对结果并重新导出。
    pub async fn save_review(this: Instance<Self>, task_id: String) {
        if this.with(|ws| ws.task_is_busy(&task_id)) {
            return;
        }
        let is_document = this.with(|ws| {
            ws.task_by_id(&task_id)
                .is_some_and(|t| t.kind == TaskKind::Document)
        });
        if is_document {
            Workspace::resume_task(this, task_id).await;
            return;
        }
        this.with(|ws| {
            let mut task = match ws.task_by_id(&task_id) {
                Some(task) => task,
                None => return,
            };
            match regenerate_subtitles(&mut task) {
                Ok(()) => {
                    task.logs
                        .push(append_log("success", "已根据校对结果重新导出字幕", None));
                    ws.upsert_task(task);
                    ws.set_message_inner("已重新导出字幕".into());
                    ws.notify();
                }
                Err(err) => {
                    ws.set_message_inner(err);
                    ws.notify();
                }
            }
        });
    }

    /// 系统自检。
    pub async fn run_system_check(this: Instance<Self>) {
        let results = match blocking(system_check::run_checks).await {
            Ok(results) => results,
            Err(err) => {
                this.with(|ws| {
                    ws.set_message_inner(format!("系统自检失败: {err}"));
                    ws.notify();
                });
                return;
            }
        };
        this.with(|ws| {
            let mut state = ws.state.lock().expect("workspace");
            state.checks = results;
            state.message = "系统自检完成".into();
            drop(state);
            ws.notify();
        });
    }

    /// 下载 SenseVoice 模型。
    pub async fn download_sensevoice(this: Instance<Self>) {
        this.with(|ws| {
            ws.set_message_inner("正在下载 SenseVoice…".into());
            ws.notify();
        });
        match blocking(crate::domain::asr::ensure_sensevoice).await {
            Ok(Ok(paths)) => this.with(|ws| {
                ws.set_message_inner(format!("SenseVoice 已就绪: {}", paths.dir.display()));
                ws.notify();
            }),
            Ok(Err(err)) => this.with(|ws| {
                ws.set_message_inner(err);
                ws.notify();
            }),
            Err(_) => this.with(|ws| {
                ws.set_message_inner("下载失败".into());
                ws.notify();
            }),
        }
    }

    /// 获取当前服务返回的完整模型列表。
    pub async fn list_models(this: Instance<Self>) -> Result<Vec<String>, String> {
        let (url, key) = this.with(Self::model_credentials);
        blocking(move || crate::domain::llm::list_models(&url, &key))
            .await
            .map_err(|err| err.to_string())?
    }

    /// 使用与正式任务相同的请求，测试指定模型能否返回文本。
    pub async fn test_model(this: Instance<Self>, model: String) -> Result<(), String> {
        use crate::domain::llm::{Completer, OpenAiCompleter};

        let (url, key) = this.with(Self::model_credentials);
        blocking(move || {
            OpenAiCompleter::new(&url, &key, &model)?
                .complete(
                    "你是视频翻译助手。请按要求只输出译文。",
                    "把 Hello 翻译成中文。",
                )
                .map(|_| ())
        })
        .await
        .map_err(|err| err.to_string())?
    }

    /// 界面提示。
    pub fn set_message(&self, message: String) {
        self.set_message_inner(message);
        self.notify();
    }

    /// 打开系统完全磁盘访问权限设置，并在 Finder 中定位当前应用以便拖拽授权。
    pub fn prepare_full_disk_access(&self) {
        self.open_full_disk_access();
        self.reveal_app_in_finder();
    }

    /// 打开系统设置中的完全磁盘访问权限页面。
    pub fn open_full_disk_access(&self) {
        #[cfg(target_os = "macos")]
        {
            if let Err(err) = std::process::Command::new("open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
                .spawn()
            {
                self.set_message_inner(format!("无法打开系统设置: {err}"));
                self.notify();
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.set_message_inner("当前系统不支持自动打开完全磁盘访问权限设置".into());
            self.notify();
        }
    }

    /// 在 Finder 中显示当前应用（或可执行文件），方便拖拽进权限列表。
    pub fn reveal_app_in_finder(&self) {
        #[cfg(target_os = "macos")]
        {
            if let Some(target) = current_app_bundle_or_exe() {
                if let Err(err) = std::process::Command::new("open")
                    .arg("-R")
                    .arg(&target)
                    .spawn()
                {
                    self.set_message_inner(format!("无法在 Finder 中显示应用: {err}"));
                    self.notify();
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.set_message_inner("当前系统不支持在 Finder 中显示应用".into());
            self.notify();
        }
    }

    /// 修改一段的起止时间。
    pub fn edit_timing(&self, task_id: String, index: f64, start: f64, end: f64) {
        let index = index as usize;
        if let Some(mut segment) = self
            .task_by_id(&task_id)
            .and_then(|t| t.segments.get(index).cloned())
        {
            segment.start = start;
            segment.end = end;
            self.update_segment(
                task_id,
                serde_json::to_value(segment).unwrap_or(nsh_core::JsonValue::Null),
            );
        }
    }

    /// 在播放头处分段，或合并下一段。
    pub fn cut_segment(&self, task_id: String, index: f64, at: Option<f64>) {
        if self.task_is_busy(&task_id) {
            return;
        }
        let index = index as usize;
        let Some(mut task) = self.task_by_id(&task_id) else {
            return;
        };
        let result = match at {
            Some(at) => crate::domain::review::split_segment(&mut task.segments, index, at),
            None => crate::domain::review::merge_next(&mut task.segments, index),
        };
        match result {
            Ok(()) => {
                task.updated_at = crate::domain::model::now();
                self.upsert_task(task);
            }
            Err(err) => {
                self.set_message_inner(err);
                self.notify();
            }
        }
    }

    /// 校对问题列表。
    pub fn collect_issues(&self, task_id: String) -> nsh_core::JsonValue {
        let Some(task) = self.task_by_id(&task_id) else {
            return nsh_core::JsonValue::Array(Vec::new());
        };
        let issues = crate::domain::review::collect_issues(
            &task.segments,
            task.options.subtitle_processing_mode,
        );
        serde_json::to_value(
            issues
                .into_iter()
                .map(|issue| {
                    serde_json::json!({
                        "kind": issue.kind,
                        "segmentId": issue.segment_id,
                        "message": issue.message,
                    })
                })
                .collect::<Vec<_>>(),
        )
        .unwrap_or(nsh_core::JsonValue::Array(Vec::new()))
    }

    /// 是否可复用识别结果。
    pub fn can_reuse(&self, task_id: String) -> bool {
        self.task_by_id(&task_id)
            .is_some_and(|task| can_reuse_transcript(&task))
    }

    /// 本地文件是否可播放。
    pub fn is_playable(&self, path: String) -> bool {
        crate::domain::pipeline::is_playable_media(&path)
    }

    /// 本地路径转 file URL。
    pub fn file_url(&self, path: String) -> String {
        crate::domain::pipeline::file_url(&path)
    }

    /// 读取 Markdown 文稿。
    pub fn read_markdown(&self, path: String) -> String {
        fs::read_to_string(path).unwrap_or_else(|err| format!("读取文稿失败: {err}"))
    }
}

impl Workspace {
    fn model_credentials(&self) -> (String, String) {
        let state = self.state.lock().expect("workspace");
        let key = state
            .api_keys
            .get(&state.settings.selected_llm_service_id)
            .cloned()
            .unwrap_or_default();
        (state.settings.llm_base_url.clone(), key)
    }

    fn snapshot_value(&self) -> nsh_core::JsonValue {
        build_snapshot(&self.state)
    }

    fn notify(&self) {
        emit_snapshot(&self.state, &self.listeners);
    }

    fn set_message_inner(&self, message: String) {
        self.state.lock().expect("workspace").message = message;
    }

    fn settings(&self) -> AppSettings {
        self.state.lock().expect("workspace").settings.clone()
    }

    fn write_settings(&self, mut next: AppSettings) {
        if let Some(service) = next
            .llm_services
            .iter_mut()
            .find(|s| s.id == next.selected_llm_service_id)
        {
            service.llm_base_url = next.llm_base_url.clone();
            service.translate_model = next.translate_model.clone();
            service.polish_model = next.polish_model.clone();
        }
        let result = paths::ensure_dir(&paths::data_dir())
            .map_err(|e| e.to_string())
            .and_then(|_| serde_json::to_vec_pretty(&next).map_err(|e| e.to_string()))
            .and_then(|raw| fs::write(settings_path(), raw).map_err(|e| e.to_string()));
        if let Err(err) = result {
            self.set_message_inner(format!("保存设置失败: {err}"));
        }
        self.state.lock().expect("workspace").settings = next;
        self.notify();
    }

    fn save_api_keys(&self, keys: &HashMap<String, String>) {
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
            self.set_message_inner(format!("保存凭证失败: {err}"));
        }
    }

    fn task_by_id(&self, id: &str) -> Option<TranslationTask> {
        self.state
            .lock()
            .expect("workspace")
            .tasks
            .iter()
            .find(|task| task.id == id)
            .cloned()
    }

    fn task_api_key(&self, task: &TranslationTask) -> String {
        let id = task
            .options
            .llm_service_id
            .as_deref()
            .unwrap_or(crate::domain::settings::LEGACY_LLM_SERVICE_ID);
        self.state
            .lock()
            .expect("workspace")
            .api_keys
            .get(id)
            .cloned()
            .unwrap_or_default()
    }

    fn visible_tasks(&self) -> Vec<TranslationTask> {
        let ws = self.state.lock().expect("workspace");
        ws.tasks
            .iter()
            .filter(|task| task.kind == ws.kind)
            .cloned()
            .collect()
    }

    fn upsert_task(&self, mut task: TranslationTask) {
        if task.status == TaskStatus::Cancelled
            && self.paused.lock().expect("paused").contains(&task.id)
        {
            task.status = TaskStatus::Paused;
        }
        if matches!(task.status, TaskStatus::Paused | TaskStatus::Cancelled) {
            task.error_message = None;
        }
        if self.deleted.lock().expect("deleted").contains(&task.id) {
            return;
        }
        if let Err(err) = persist(&task) {
            self.set_message_inner(format!("保存任务失败: {err}"));
            self.notify();
            return;
        }
        {
            let mut ws = self.state.lock().expect("workspace");
            if ws.message.starts_with("正在暂停") && task.status == TaskStatus::Paused {
                ws.message = "任务已暂停，可点恢复继续".into();
            } else if ws.message.starts_with("正在取消") && task.status == TaskStatus::Cancelled
            {
                ws.message = "任务已取消".into();
            }
            if let Some(existing) = ws.tasks.iter_mut().find(|item| item.id == task.id) {
                *existing = task;
            } else {
                ws.tasks.insert(0, task);
            }
        }
        self.notify();
    }

    fn task_is_busy(&self, id: &str) -> bool {
        if self.aborts.lock().expect("aborts").contains_key(id) {
            self.set_message_inner("请先暂停任务，再校对或导出".into());
            self.notify();
            true
        } else {
            false
        }
    }

    fn take_start(
        &self,
        id: String,
    ) -> Option<(TranslationTask, AppSettings, String, Arc<AbortFlag>)> {
        if self.aborts.lock().expect("aborts").contains_key(&id) {
            return None;
        }
        let flag = Arc::new(AbortFlag::new());
        self.aborts
            .lock()
            .expect("aborts")
            .insert(id.clone(), flag.clone());
        let Some(task) = self.task_by_id(&id) else {
            self.aborts.lock().expect("aborts").remove(&id);
            return None;
        };
        let settings = self.settings();
        let api_key = self.task_api_key(&task);
        Some((task, settings, api_key, flag))
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
