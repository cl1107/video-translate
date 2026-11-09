use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::{
    checkpoint,
    command::{resolve_command, run_capture},
    ffmpeg::Ffmpeg,
    model::Segment,
    paths::{models_root, unique_path},
    srt::{Cue, parse_subtitle, segments_from_cues},
};

pub const SENSEVOICE_DIR: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
pub const SENSEVOICE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
pub const FUNASR_NANO_DIR: &str = "sherpa-onnx-funasr-nano-int8-2025-12-30";
const CHUNK_THRESHOLD_SEC: f64 = 90.0;
const MAX_CHUNK_SEC: f64 = 45.0;

#[derive(Debug, Clone)]
pub struct Transcription {
    pub segments: Vec<Segment>,
    pub language: Option<String>,
}

pub trait Transcriber: Send + Sync {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String>;
}

pub struct MockTranscriber;

impl Transcriber for MockTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String> {
        let name = audio
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio");
        Ok(Transcription {
            segments: vec![Segment {
                id: format!("{task_id}:seg-1"),
                start: 0.0,
                end: 2.5,
                original_text: format!("[mock] {name}"),
                polished_text: None,
                translated_text: None,
                translation_status: None,
                confidence: 1.0,
            }],
            language: Some("en".into()),
        })
    }
}

#[derive(Clone)]
pub struct SenseVoicePaths {
    pub dir: PathBuf,
    pub model: PathBuf,
    pub tokens: PathBuf,
}

#[derive(Clone)]
pub struct FunAsrNanoPaths {
    pub dir: PathBuf,
    pub encoder_adaptor: PathBuf,
    pub llm: PathBuf,
    pub embedding: PathBuf,
}

pub fn resolve_sensevoice() -> Option<SenseVoicePaths> {
    let mut dirs = vec![
        models_root().join("sensevoice-small"),
        models_root().join(SENSEVOICE_DIR),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Library/Application Support/Shandianshuo/models/sensevoice-small"));
    }
    for dir in dirs {
        let model = ["model.int8.onnx", "model.onnx"]
            .into_iter()
            .map(|name| dir.join(name))
            .find(|path| path.is_file());
        let tokens = dir.join("tokens.txt");
        if let Some(model) = model
            && tokens.is_file()
        {
            return Some(SenseVoicePaths {
                dir,
                model,
                tokens,
            });
        }
    }
    None
}

pub fn resolve_funasr_nano() -> Option<FunAsrNanoPaths> {
    let dirs = [
        models_root().join("funasr-nano"),
        models_root().join(FUNASR_NANO_DIR),
    ];
    for dir in dirs {
        if !dir.is_dir() {
            continue;
        }
        let encoder = first_file(&dir, &["encoder_adaptor.int8.onnx", "encoder_adaptor.onnx"]);
        let llm = first_file(&dir, &["llm.int8.onnx", "llm.fp16.onnx", "llm.onnx"]);
        let embedding = first_file(&dir, &["embedding.int8.onnx", "embedding.onnx"]);
        if let (Some(encoder_adaptor), Some(llm), Some(embedding)) = (encoder, llm, embedding) {
            return Some(FunAsrNanoPaths {
                dir,
                encoder_adaptor,
                llm,
                embedding,
            });
        }
    }
    None
}

fn first_file(dir: &Path, names: &[&str]) -> Option<PathBuf> {
    names
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.is_file())
}

pub fn funasr_nano_hint() -> String {
    format!(
        "Fun-ASR-Nano 模型未安装。请放到 {} 或 {}（需要 encoder_adaptor / llm / embedding）。当前不会假装已识别。",
        models_root().join("funasr-nano").display(),
        models_root().join(FUNASR_NANO_DIR).display()
    )
}

pub fn ensure_sensevoice() -> Result<SenseVoicePaths, String> {
    if let Some(existing) = resolve_sensevoice() {
        return Ok(existing);
    }
    let root = models_root();
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    let archive = root.join(format!("{SENSEVOICE_DIR}.tar.bz2"));
    download_file(SENSEVOICE_URL, &archive)?;
    let tar = resolve_command("tar").ok_or_else(|| "未找到 tar，无法解压 SenseVoice 模型".to_string())?;
    let archive_s = archive.to_string_lossy();
    let root_s = root.to_string_lossy();
    let (code, _, stderr) = run_capture(&tar, &["-xjf", archive_s.as_ref(), "-C", root_s.as_ref()])?;
    if code != 0 {
        return Err(format!("解压 SenseVoice 失败: {stderr}"));
    }
    resolve_sensevoice().ok_or_else(|| "SenseVoice 解压后仍缺少 model/tokens".into())
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let response = ureq::get(url)
        .call()
        .map_err(|err| format!("下载模型失败: {err}"))?;
    let mut reader = response.into_reader();
    let tmp = unique_path(dest.with_extension("part"));
    let mut file = fs::File::create(&tmp).map_err(|err| err.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|err| err.to_string())?;
    file.flush().map_err(|err| err.to_string())?;
    fs::rename(tmp, dest).map_err(|err| err.to_string())?;
    Ok(())
}

pub fn sherpa_bin() -> Option<PathBuf> {
    ["sherpa-onnx-offline", "sherpa-onnx-offline-sense-voice", "sherpa-onnx"]
        .into_iter()
        .find_map(resolve_command)
}

pub fn parse_asr_output(output: &str, task_id: &str, offset: f64) -> Vec<Segment> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return segments_from_json(&value, task_id, offset);
    }
    if let Some(start) = trimmed.find('{')
        && let Some(end) = trimmed.rfind('}')
        && let Ok(value) = serde_json::from_str::<Value>(&trimmed[start..=end])
    {
        let segs = segments_from_json(&value, task_id, offset);
        if !segs.is_empty() {
            return segs;
        }
    }
    if trimmed.contains("-->") {
        let cues = parse_subtitle(trimmed, Some("srt"));
        return shift_cues(task_id, &cues, offset);
    }
    let mut cues = Vec::new();
    for line in trimmed.lines() {
        if let Some(cue) = parse_timestamp_line(line) {
            cues.push(cue);
        }
    }
    if !cues.is_empty() {
        return shift_cues(task_id, &cues, offset);
    }
    let text = trimmed
        .lines()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            !lower.contains("elapsed") && !line.starts_with('/') && !line.trim().is_empty()
        })
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();
    if text.is_empty() {
        Vec::new()
    } else {
        vec![Segment {
            id: format!("{task_id}:seg-1"),
            start: offset,
            end: offset + 2.0,
            original_text: text,
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        }]
    }
}

fn segments_from_json(value: &Value, task_id: &str, offset: f64) -> Vec<Segment> {
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Vec::new();
    }
    let timestamps = value
        .get("timestamps")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_f64)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let start = offset + timestamps.first().copied().unwrap_or(0.0);
    let end = offset + timestamps.last().copied().unwrap_or(start + 2.0).max(start + 0.3);
    vec![Segment {
        id: format!("{task_id}:seg-1"),
        start,
        end,
        original_text: text,
        polished_text: None,
        translated_text: None,
        translation_status: None,
        confidence: 1.0,
    }]
}

fn parse_timestamp_line(line: &str) -> Option<Cue> {
    let line = line.trim();
    let sep = line.find(" -- ").or_else(|| line.find(" - "))?;
    let start = parse_seconds(line[..sep].trim())?;
    let rest = line[sep..].trim_start_matches(['-', ' ']);
    let (end_raw, text) = rest.split_once(':')?;
    let end = parse_seconds(end_raw.trim())?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(Cue {
        index: 0,
        start,
        end,
        text: text.to_string(),
    })
}

fn parse_seconds(raw: &str) -> Option<f64> {
    if raw.contains(':') {
        super::srt::parse_time(&raw.replace('.', ","))
    } else {
        raw.parse().ok()
    }
}

fn shift_cues(task_id: &str, cues: &[Cue], offset: f64) -> Vec<Segment> {
    let shifted: Vec<Cue> = cues
        .iter()
        .map(|cue| Cue {
            index: cue.index,
            start: cue.start + offset,
            end: cue.end + offset,
            text: cue.text.clone(),
        })
        .collect();
    segments_from_cues(task_id, &shifted)
}

pub struct CliTranscriber {
    pub bin: PathBuf,
    pub engine: String,
    pub extra: Vec<(String, String)>,
    pub positional: Vec<String>,
}

impl CliTranscriber {
    pub fn sensevoice(model: SenseVoicePaths) -> Option<Self> {
        Some(Self {
            bin: sherpa_bin()?,
            engine: "sensevoice".into(),
            extra: vec![
                ("--sense-voice-model".into(), model.model.to_string_lossy().into_owned()),
                ("--tokens".into(), model.tokens.to_string_lossy().into_owned()),
            ],
            positional: Vec::new(),
        })
    }

    pub fn funasr_nano(model: FunAsrNanoPaths) -> Option<Self> {
        Some(Self {
            bin: sherpa_bin()?,
            engine: "funasr-nano".into(),
            extra: vec![
                ("--encoder".into(), model.encoder_adaptor.to_string_lossy().into_owned()),
                ("--llm".into(), model.llm.to_string_lossy().into_owned()),
                ("--embedding".into(), model.embedding.to_string_lossy().into_owned()),
            ],
            positional: Vec::new(),
        })
    }

    fn run_once(&self, audio: &Path) -> Result<String, String> {
        let file = audio.to_string_lossy().into_owned();
        let mut args: Vec<String> = Vec::new();
        for (flag, value) in &self.extra {
            args.push(flag.clone());
            args.push(value.clone());
        }
        args.push(file.clone());
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let (code, stdout, stderr) = run_capture(&self.bin, &refs)?;
        if code == 0 && !(stdout.trim().is_empty() && stderr.trim().is_empty()) {
            return Ok(format!("{stdout}\n{stderr}"));
        }
        Err(format!(
            "sherpa-onnx ({}) 失败 (exit {code}): {}",
            self.engine,
            if stderr.trim().is_empty() { stdout } else { stderr }
        ))
    }
}

impl Transcriber for CliTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String> {
        let output = self.run_once(audio)?;
        let segments = parse_asr_output(&output, task_id, 0.0);
        if segments.is_empty() {
            return Err("ASR 没有输出文本".into());
        }
        Ok(Transcription {
            segments,
            language: None,
        })
    }
}

pub struct ChunkedTranscriber {
    inner: Box<dyn Transcriber>,
    ffmpeg: Option<Ffmpeg>,
    fingerprint: String,
}

impl ChunkedTranscriber {
    fn new(inner: Box<dyn Transcriber>, fingerprint: String) -> Self {
        Self {
            inner,
            ffmpeg: Ffmpeg::discover().ok(),
            fingerprint,
        }
    }
}

impl Transcriber for ChunkedTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String> {
        let Some(ffmpeg) = self.ffmpeg.as_ref() else {
            return self.inner.transcribe(audio, task_id);
        };
        let info = ffmpeg.probe(audio)?;
        if info.duration <= CHUNK_THRESHOLD_SEC {
            return self.inner.transcribe(audio, task_id);
        }
        let mut segments = Vec::new();
        let mut index = 0usize;
        let mut start = 0.0;
        while start < info.duration - 0.05 {
            let duration = (info.duration - start).min(MAX_CHUNK_SEC);
            if let Some(saved) =
                checkpoint::load_chunk(task_id, index, &self.fingerprint, start, duration)
            {
                segments.extend(saved);
            } else {
                let clip = audio.with_file_name(format!("chunk-{index}.wav"));
                ffmpeg.extract_clip(audio, start, duration, &clip)?;
                let part = self.inner.transcribe(&clip, &format!("{task_id}:c{index}"))?;
                let shifted: Vec<Segment> = part
                    .segments
                    .into_iter()
                    .map(|mut segment| {
                        segment.start += start;
                        segment.end += start;
                        segment.id = format!("{task_id}:seg-{}", segments.len() + 1);
                        segment
                    })
                    .collect();
                checkpoint::save_chunk(task_id, index, &self.fingerprint, start, duration, &shifted)?;
                segments.extend(shifted);
            }
            start += duration;
            index += 1;
        }
        if segments.is_empty() {
            return Err("ASR 分块后没有文本".into());
        }
        Ok(Transcription {
            segments,
            language: None,
        })
    }
}

pub fn select_transcriber(engine: &str, prefer_mock: bool) -> Result<Box<dyn Transcriber>, String> {
    if prefer_mock || std::env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1") {
        return Ok(Box::new(MockTranscriber));
    }
    let engine = if engine.trim().is_empty() {
        "sensevoice"
    } else {
        engine.trim()
    };
    if engine == "funasr-nano" {
        let model = resolve_funasr_nano().ok_or_else(funasr_nano_hint)?;
        let cli = CliTranscriber::funasr_nano(model)
            .ok_or_else(|| "未找到 sherpa-onnx CLI（sherpa-onnx-offline）。Fun-ASR-Nano 不会假装已识别。".to_string())?;
        let fp = format!("funasr-nano:{}", model_stamp());
        return Ok(Box::new(ChunkedTranscriber::new(Box::new(cli), fp)));
    }
    let model = resolve_sensevoice().ok_or_else(|| {
        "未找到 SenseVoice 模型。请在设置中下载，或导入 SRT。".to_string()
    })?;
    let cli = CliTranscriber::sensevoice(model).ok_or_else(|| {
        "未找到 sherpa-onnx CLI。请安装 sherpa-onnx-offline 并保证在 PATH 中；也可导入 SRT 或开启模拟识别。".to_string()
    })?;
    let fp = format!("sensevoice:{}", model_stamp());
    Ok(Box::new(ChunkedTranscriber::new(Box::new(cli), fp)))
}

fn model_stamp() -> String {
    resolve_sensevoice()
        .map(|p| p.dir.display().to_string())
        .or_else(|| resolve_funasr_nano().map(|p| p.dir.display().to_string()))
        .unwrap_or_default()
}

pub fn asr_status() -> Vec<(String, bool, Option<String>)> {
    let sense = resolve_sensevoice();
    let nano = resolve_funasr_nano();
    let cli = sherpa_bin();
    vec![
        (
            "sensevoice".into(),
            sense.is_some(),
            sense.as_ref().map(|p| p.dir.display().to_string()),
        ),
        (
            "funasr-nano".into(),
            nano.is_some(),
            nano.as_ref().map(|p| p.dir.display().to_string()),
        ),
        (
            "sherpa-cli".into(),
            cli.is_some(),
            cli.map(|p| p.display().to_string()),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_json_text() {
        let segs = parse_asr_output(r#"{"text":"你好","timestamps":[0.1,0.8]}"#, "t", 1.0);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].original_text, "你好");
        assert!((segs[0].start - 1.1).abs() < 0.001);
    }

    #[test]
    fn parse_timestamp_lines() {
        let segs = parse_asr_output("0.00 -- 1.20: hello\n1.20 -- 2.00: world", "t", 0.0);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[1].original_text, "world");
    }

    #[test]
    fn funasr_missing_is_explicit() {
        match select_transcriber("funasr-nano", false) {
            Err(err) => {
                assert!(
                    err.contains("Fun-ASR-Nano") || err.contains("sherpa-onnx CLI"),
                    "{err}"
                );
            }
            Ok(_) => {}
        }
    }
}
