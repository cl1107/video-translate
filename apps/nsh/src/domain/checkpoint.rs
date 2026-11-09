use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

use super::{model::Segment, paths::work_dir};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PipelineCheckpoint {
    pub asr_complete: bool,
    pub asr_fingerprint: Option<String>,
    pub polish_complete: bool,
    pub polish_fingerprint: Option<String>,
    pub translation_complete: bool,
    pub translation_fingerprint: Option<String>,
    pub translation_completed_count: usize,
    pub document_complete: bool,
    pub document_fingerprint: Option<String>,
    pub document_markdown: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AsrChunkRecord {
    pub fingerprint: String,
    pub start: f64,
    pub duration: f64,
    pub segments: Vec<Segment>,
}

fn checkpoint_file(task_id: &str) -> PathBuf {
    work_dir(task_id).join("checkpoint.json")
}

fn chunk_dir(task_id: &str) -> PathBuf {
    work_dir(task_id).join("asr-chunks")
}

pub fn load(task_id: &str) -> PipelineCheckpoint {
    fs::read_to_string(checkpoint_file(task_id))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(task_id: &str, checkpoint: &PipelineCheckpoint) -> Result<(), String> {
    let path = checkpoint_file(task_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(checkpoint).map_err(|err| err.to_string())?)
        .map_err(|err| err.to_string())
}

pub fn fingerprint(parts: &[&str]) -> String {
    parts.join("|")
}

pub fn asr_fingerprint(engine: &str, path: &str, size: u64, mtime: u64) -> String {
    fingerprint(&[engine, path, &size.to_string(), &mtime.to_string()])
}

pub fn file_mtime_size(path: &str) -> (u64, u64) {
    fs::metadata(path)
        .map(|meta| {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (meta.len(), mtime)
        })
        .unwrap_or((0, 0))
}

pub fn load_chunk(task_id: &str, index: usize, fingerprint: &str, start: f64, duration: f64) -> Option<Vec<Segment>> {
    let path = chunk_dir(task_id).join(format!("{index}.json"));
    let raw = fs::read_to_string(path).ok()?;
    let record: AsrChunkRecord = serde_json::from_str(&raw).ok()?;
    if record.fingerprint == fingerprint
        && (record.start - start).abs() < 0.05
        && (record.duration - duration).abs() < 0.05
    {
        Some(record.segments)
    } else {
        None
    }
}

pub fn save_chunk(
    task_id: &str,
    index: usize,
    fingerprint: &str,
    start: f64,
    duration: f64,
    segments: &[Segment],
) -> Result<(), String> {
    let dir = chunk_dir(task_id);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let record = AsrChunkRecord {
        fingerprint: fingerprint.to_string(),
        start,
        duration,
        segments: segments.to_vec(),
    };
    fs::write(
        dir.join(format!("{index}.json")),
        serde_json::to_string(&record).map_err(|err| err.to_string())?,
    )
    .map_err(|err| err.to_string())
}

pub fn matches(stored: &Option<String>, current: &str) -> bool {
    stored.as_deref() == Some(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_changes_with_inputs() {
        assert_ne!(asr_fingerprint("a", "p", 1, 2), asr_fingerprint("b", "p", 1, 2));
        assert!(matches(&Some("x".into()), "x"));
        assert!(!matches(&Some("x".into()), "y"));
    }
}
