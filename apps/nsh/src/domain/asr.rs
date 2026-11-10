use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde_json::Value;
use sherpa_onnx::{
    OfflineFunASRNanoModelConfig, OfflineRecognizer, OfflineRecognizerConfig,
    OfflineRecognizerResult, OfflineSenseVoiceModelConfig, Wave,
};

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
const CHUNK_THRESHOLD_SEC: f64 = 30.0;
const MAX_CHUNK_SEC: f64 = 30.0;

#[derive(Debug, Clone)]
pub struct Transcription {
    pub segments: Vec<Segment>,
    pub language: Option<String>,
}

pub trait Transcriber: Send + Sync {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String>;

    fn transcribe_with_cancel(
        &self,
        audio: &Path,
        task_id: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Transcription, String> {
        check_cancel(cancelled)?;
        let result = self.transcribe(audio, task_id)?;
        check_cancel(cancelled)?;
        Ok(result)
    }
}

fn check_cancel(cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    if cancelled() {
        Err("操作已取消".into())
    } else {
        Ok(())
    }
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
    pub tokenizer: PathBuf,
}

pub fn resolve_sensevoice() -> Option<SenseVoicePaths> {
    let mut dirs = vec![
        models_root().join("sensevoice-small"),
        models_root().join(SENSEVOICE_DIR),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Library/Application Support/Shandianshuo/models/sensevoice-small"));
    }
    if let Some(data) = dirs::data_dir() {
        dirs.push(data.join("video-translate/models/asr").join(SENSEVOICE_DIR));
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
            return Some(SenseVoicePaths { dir, model, tokens });
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
        let tokenizer = dir.join("Qwen3-0.6B");
        if let (Some(encoder_adaptor), Some(llm), Some(embedding)) = (encoder, llm, embedding)
            && tokenizer.join("tokenizer.json").is_file()
        {
            return Some(FunAsrNanoPaths {
                dir,
                encoder_adaptor,
                llm,
                embedding,
                tokenizer,
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
        "Fun-ASR-Nano 模型未安装。请放到 {} 或 {}（需要 encoder_adaptor / llm / embedding 与 Qwen3-0.6B/tokenizer.json）。",
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
    let tar =
        resolve_command("tar").ok_or_else(|| "未找到 tar，无法解压 SenseVoice 模型".to_string())?;
    let archive_s = archive.to_string_lossy();
    let root_s = root.to_string_lossy();
    let (code, _, stderr) =
        run_capture(&tar, &["-xjf", archive_s.as_ref(), "-C", root_s.as_ref()])?;
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
    [
        "sherpa-onnx-offline",
        "sherpa-onnx-offline-sense-voice",
        "sherpa-onnx",
    ]
    .into_iter()
    .find_map(resolve_command)
}

/// Uses the official sherpa-onnx Rust API with statically linked CPU libraries.
/// Model loading is deferred until ASR is needed and shared across audio chunks.
pub struct NativeTranscriber {
    config: OfflineRecognizerConfig,
    recognizer: Mutex<Option<OfflineRecognizer>>,
}

impl NativeTranscriber {
    pub fn sensevoice(model: &SenseVoicePaths) -> Self {
        let mut config = Self::config();
        config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
            model: Some(model.model.to_string_lossy().into_owned()),
            language: Some("auto".into()),
            use_itn: true,
        };
        config.model_config.tokens = Some(model.tokens.to_string_lossy().into_owned());
        Self {
            config,
            recognizer: Mutex::new(None),
        }
    }

    pub fn funasr_nano(model: &FunAsrNanoPaths) -> Self {
        let mut config = Self::config();
        config.model_config.funasr_nano = OfflineFunASRNanoModelConfig {
            encoder_adaptor: Some(model.encoder_adaptor.to_string_lossy().into_owned()),
            llm: Some(model.llm.to_string_lossy().into_owned()),
            embedding: Some(model.embedding.to_string_lossy().into_owned()),
            tokenizer: Some(model.tokenizer.to_string_lossy().into_owned()),
            ..Default::default()
        };
        Self {
            config,
            recognizer: Mutex::new(None),
        }
    }

    fn config() -> OfflineRecognizerConfig {
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.num_threads = 2;
        config.model_config.provider = Some("cpu".into());
        config.decoding_method = Some("greedy_search".into());
        config
    }
}

impl Transcriber for NativeTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String> {
        let audio_path = audio.to_str().ok_or("ASR 音频路径不是有效 UTF-8")?;
        let wave = Wave::read(audio_path)
            .ok_or_else(|| format!("无法读取单声道 WAV: {}", audio.display()))?;
        if wave.sample_rate() <= 0 || wave.samples().is_empty() {
            return Err("ASR 音频为空或采样率无效".into());
        }
        let duration = wave.samples().len() as f64 / wave.sample_rate() as f64;
        let mut slot = self.recognizer.lock().map_err(|_| "ASR 引擎锁已失效")?;
        if slot.is_none() {
            *slot = Some(
                OfflineRecognizer::create(&self.config)
                    .ok_or("无法加载本地 ASR 模型，请检查模型文件是否完整")?,
            );
        }
        let recognizer = slot.as_ref().ok_or("ASR 引擎未初始化")?;
        let stream = recognizer.create_stream();
        stream.accept_waveform(wave.sample_rate(), wave.samples());
        recognizer.decode(&stream);
        let result = stream.get_result().ok_or("ASR 未返回有效识别结果")?;
        // Silence is a valid chunk result. The pipeline reports an empty full
        // transcript, while long audio may contain silent chunks between speech.
        let segments = recognition_segments(&result, task_id, duration);
        Ok(Transcription {
            segments,
            language: None,
        })
    }
}

/// SenseVoice exposes token onsets. Only split when those tokens account for
/// the complete displayed text; configured ITN or other engines may transform
/// text without updating the token alignment. In that case retain block timing.
fn recognition_segments(
    result: &OfflineRecognizerResult,
    task_id: &str,
    duration: f64,
) -> Vec<Segment> {
    let text = result.text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let block = || {
        vec![recognized_segment(
            task_id,
            0,
            0.0,
            duration,
            text.to_string(),
        )]
    };
    let Some(timestamps) = result.timestamps.as_deref() else {
        return block();
    };
    if result.tokens.is_empty()
        || timestamps.len() != result.tokens.len()
        || result.tokens.concat().trim() != text
        || timestamps
            .iter()
            .any(|time| !time.is_finite() || *time < 0.0 || f64::from(*time) >= duration)
        || timestamps.windows(2).any(|pair| pair[1] < pair[0])
    {
        return block();
    }
    let durations = result
        .durations
        .as_deref()
        .filter(|values| !values.is_empty());
    if durations.is_some_and(|values| {
        values.len() != timestamps.len()
            || values.iter().zip(timestamps).any(|(span, start)| {
                !span.is_finite() || *span <= 0.0 || f64::from(start + span) > duration + 0.05
            })
    }) {
        return block();
    }
    let mut segments = Vec::new();
    let mut start_index = 0;
    let mut buffer = String::new();
    let mut width = 0;
    for (index, token) in result.tokens.iter().enumerate() {
        buffer.push_str(token);
        width += token
            .chars()
            .map(|ch| if ch.is_ascii() { 1 } else { 2 })
            .sum::<usize>();
        let last = index + 1 == timestamps.len();
        let next = timestamps
            .get(index + 1)
            .map(|time| f64::from(*time))
            .unwrap_or(duration);
        let start = f64::from(timestamps[start_index]);
        let sentence_end = token
            .trim_end()
            .ends_with(['。', '！', '？', '.', '!', '?', ';', '；']);
        if last || sentence_end || width >= 60 || next - start >= 8.0 {
            let end = durations
                .map(|values| f64::from(timestamps[index] + values[index]).min(duration))
                .unwrap_or(next);
            // Equal token onsets can occur for punctuation. Keep collecting
            // until a positive, measured interval is available.
            if end > start && !buffer.trim().is_empty() {
                segments.push(recognized_segment(
                    task_id,
                    segments.len(),
                    start,
                    end,
                    buffer.trim().to_string(),
                ));
                buffer.clear();
                width = 0;
                start_index = index + 1;
            }
        }
    }
    if !buffer.trim().is_empty() {
        return block();
    }
    segments
}

fn recognized_segment(task_id: &str, index: usize, start: f64, end: f64, text: String) -> Segment {
    Segment {
        id: format!("{task_id}:seg-{}", index + 1),
        start,
        end,
        original_text: text,
        polished_text: None,
        translated_text: None,
        translation_status: None,
        confidence: 1.0,
    }
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
        .map(|items| items.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        .unwrap_or_default();
    let start = offset + timestamps.first().copied().unwrap_or(0.0);
    let end = offset
        + timestamps
            .last()
            .copied()
            .unwrap_or(start + 2.0)
            .max(start + 0.3);
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
                (
                    "--sense-voice-model".into(),
                    model.model.to_string_lossy().into_owned(),
                ),
                (
                    "--tokens".into(),
                    model.tokens.to_string_lossy().into_owned(),
                ),
            ],
            positional: Vec::new(),
        })
    }

    pub fn funasr_nano(model: FunAsrNanoPaths) -> Option<Self> {
        Some(Self {
            bin: sherpa_bin()?,
            engine: "funasr-nano".into(),
            extra: vec![
                (
                    "--encoder".into(),
                    model.encoder_adaptor.to_string_lossy().into_owned(),
                ),
                ("--llm".into(), model.llm.to_string_lossy().into_owned()),
                (
                    "--embedding".into(),
                    model.embedding.to_string_lossy().into_owned(),
                ),
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
            if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            }
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
        self.transcribe_with_cancel(audio, task_id, &|| false)
    }

    fn transcribe_with_cancel(
        &self,
        audio: &Path,
        task_id: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Transcription, String> {
        check_cancel(cancelled)?;
        let Some(ffmpeg) = self.ffmpeg.as_ref() else {
            return self.inner.transcribe_with_cancel(audio, task_id, cancelled);
        };
        let info = ffmpeg.probe_with_cancel(audio, cancelled)?;
        if info.duration <= CHUNK_THRESHOLD_SEC {
            return self.inner.transcribe_with_cancel(audio, task_id, cancelled);
        }
        let metadata =
            fs::metadata(audio).map_err(|err| format!("无法读取 ASR 音频元数据: {err}"))?;
        let mtime = metadata
            .modified()
            .map_err(|err| err.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|err| err.to_string())?
            .as_nanos();
        let fingerprint = format!(
            "{}:{}:{}:{mtime}",
            self.fingerprint,
            audio.display(),
            metadata.len()
        );
        let mut segments = Vec::new();
        let mut index = 0usize;
        let mut start = 0.0;
        while start < info.duration - 0.05 {
            check_cancel(cancelled)?;
            let duration = (info.duration - start).min(MAX_CHUNK_SEC);
            if let Some(saved) =
                checkpoint::load_chunk(task_id, index, &fingerprint, start, duration)
            {
                segments.extend(saved);
            } else {
                let clip = audio.with_file_name(format!("chunk-{index}.wav"));
                ffmpeg.extract_clip_with_cancel(audio, start, duration, &clip, cancelled)?;
                check_cancel(cancelled)?;
                let part = self.inner.transcribe_with_cancel(
                    &clip,
                    &format!("{task_id}:c{index}"),
                    cancelled,
                )?;
                let shifted = offset_chunk_segments(part.segments, task_id, start, segments.len());
                checkpoint::save_chunk(task_id, index, &fingerprint, start, duration, &shifted)?;
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

fn offset_chunk_segments(
    mut segments: Vec<Segment>,
    task_id: &str,
    start: f64,
    base: usize,
) -> Vec<Segment> {
    for (offset, segment) in segments.iter_mut().enumerate() {
        segment.start += start;
        segment.end += start;
        segment.id = format!("{task_id}:seg-{}", base + offset + 1);
    }
    segments
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
        let native = NativeTranscriber::funasr_nano(&model);
        let fp = format!(
            "native-v2-funasr-nano:{}",
            model_stamp(&[
                &model.encoder_adaptor,
                &model.llm,
                &model.embedding,
                &model.tokenizer.join("tokenizer.json")
            ])
        );
        return Ok(Box::new(ChunkedTranscriber::new(Box::new(native), fp)));
    }
    if engine != "sensevoice" {
        return Err(format!("不支持的 ASR 引擎: {engine}"));
    }
    let model = resolve_sensevoice()
        .ok_or_else(|| "未找到 SenseVoice 模型。请在设置中下载，或导入 SRT。".to_string())?;
    let native = NativeTranscriber::sensevoice(&model);
    let fp = format!(
        "native-v2-sensevoice:{}",
        model_stamp(&[&model.model, &model.tokens])
    );
    Ok(Box::new(ChunkedTranscriber::new(Box::new(native), fp)))
}

fn model_stamp(paths: &[&Path]) -> String {
    paths
        .iter()
        .map(|path| {
            let (size, mtime) = checkpoint::file_mtime_size(&path.to_string_lossy());
            format!("{}:{size}:{mtime}", path.display())
        })
        .collect::<Vec<_>>()
        .join("|")
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

    fn recognition(tokens: &[&str], timestamps: Vec<f32>) -> OfflineRecognizerResult {
        OfflineRecognizerResult {
            text: tokens.concat(),
            tokens: tokens.iter().map(|token| (*token).to_string()).collect(),
            timestamps: Some(timestamps),
            durations: None,
        }
    }

    #[test]
    fn native_sentences_use_measured_token_boundaries() {
        let mut result = recognition(&["你好", "。", "下一句", "！"], vec![0.3, 1.1, 2.8, 4.2]);
        result.durations = Some(vec![0.7, 0.1, 1.1, 0.2]);
        let segments = recognition_segments(&result, "t", 5.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].original_text, "你好。");
        assert!((segments[0].start - 0.3).abs() < 0.001);
        assert!((segments[0].end - 1.2).abs() < 0.001);
        assert!((segments[1].start - 2.8).abs() < 0.001);
        assert!((segments[1].end - 4.4).abs() < 0.001);
    }

    #[test]
    fn native_long_speech_splits_at_token_onset_without_estimated_word_times() {
        let result = recognition(&["one ", "two ", "three"], vec![0.2, 7.9, 8.3]);
        let segments = recognition_segments(&result, "t", 10.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].original_text, "one two");
        assert!((segments[0].end - 8.3).abs() < 0.001);
        assert!((segments[1].start - 8.3).abs() < 0.001);
        assert_eq!(segments[1].end, 10.0);
    }

    #[test]
    fn native_unaligned_or_invalid_timestamps_preserve_complete_block() {
        let mut result = recognition(&["你好", "。"], vec![0.3, 1.1]);
        for timestamps in [
            vec![],
            vec![0.3],
            vec![1.1, 0.3],
            vec![f32::NAN, 1.1],
            vec![0.3, 9.0],
        ] {
            result.timestamps = Some(timestamps);
            let segments = recognition_segments(&result, "t", 5.0);
            assert_eq!((segments[0].start, segments[0].end), (0.0, 5.0));
            assert_eq!(segments[0].original_text, "你好。");
        }
        result.timestamps = Some(vec![0.3, 1.1]);
        result.text = "已被 ITN 变换的文本".into();
        let segments = recognition_segments(&result, "t", 5.0);
        assert_eq!(segments[0].original_text, result.text);
        assert_eq!((segments[0].start, segments[0].end), (0.0, 5.0));
    }

    #[test]
    fn chunk_segments_keep_unique_ids_and_offset_times() {
        let input = vec![
            recognized_segment("c", 0, 0.3, 1.0, "a".into()),
            recognized_segment("c", 1, 2.0, 3.0, "b".into()),
        ];
        let segments = offset_chunk_segments(input, "task", 30.0, 4);
        assert_eq!(segments[0].id, "task:seg-5");
        assert_eq!(segments[1].id, "task:seg-6");
        assert_eq!(segments[0].start, 30.3);
        assert_eq!(segments[1].end, 33.0);
    }

    #[test]
    fn cancelled_transcription_does_not_read_audio() {
        let result =
            MockTranscriber.transcribe_with_cancel(Path::new("missing.wav"), "task", &|| true);
        assert_eq!(result.unwrap_err(), "操作已取消");
    }

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
