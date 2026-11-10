use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

static OVERRIDE: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn override_slot() -> &'static Mutex<Option<PathBuf>> {
    OVERRIDE.get_or_init(|| Mutex::new(None))
}

pub fn set_data_dir_override(path: Option<PathBuf>) {
    *override_slot().lock().expect("data dir override") = path;
}

pub fn data_dir() -> PathBuf {
    if let Some(path) = override_slot().lock().expect("data dir override").clone() {
        return path;
    }
    if let Ok(path) = std::env::var("VIDEO_TRANSLATE_DATA_DIR") {
        return PathBuf::from(path);
    }
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("video-translate-nsh")
}

pub fn ensure_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)
}

pub fn db_path() -> PathBuf {
    data_dir().join("video-translate.db")
}

pub fn settings_path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn secrets_path() -> PathBuf {
    data_dir().join("secrets.json")
}

pub fn models_root() -> PathBuf {
    if let Ok(path) = std::env::var("VIDEO_TRANSLATE_ASR_MODELS") {
        return PathBuf::from(path);
    }
    data_dir().join("models").join("asr")
}

pub fn downloads_dir(task_id: &str) -> PathBuf {
    data_dir().join("downloads").join(task_id)
}

pub fn work_dir(task_id: &str) -> PathBuf {
    data_dir().join("tasks").join(task_id)
}

pub fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    for index in 2..10_000 {
        let candidate = parent.join(format!("{stem}-{index}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

pub fn resolve_output_dir(
    source_path: &Path,
    location: super::model::SubtitleOutputLocation,
) -> PathBuf {
    match location {
        super::model::SubtitleOutputLocation::SourceDirectory => source_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
        super::model::SubtitleOutputLocation::OutputSubdirectory => source_path
            .parent()
            .map(|parent| parent.join("output"))
            .unwrap_or_else(|| PathBuf::from("output")),
    }
}
