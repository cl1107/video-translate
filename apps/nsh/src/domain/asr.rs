use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use super::{
    command::{resolve_command, run_capture},
    model::Segment,
    paths::{models_root, unique_path},
    srt::{parse_subtitle, segments_from_cues},
};

pub const SENSEVOICE_DIR: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
pub const SENSEVOICE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";

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

pub fn resolve_sensevoice() -> Option<SenseVoicePaths> {
    let mut dirs = vec![
        models_root().join("sensevoice-small"),
        models_root().join(SENSEVOICE_DIR),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(
            home.join("Library/Application Support/Shandianshuo/models/sensevoice-small"),
        );
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

pub fn ensure_sensevoice() -> Result<SenseVoicePaths, String> {
    if let Some(existing) = resolve_sensevoice() {
        return Ok(existing);
    }
    let root = models_root();
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;
    let archive = root.join(format!("{SENSEVOICE_DIR}.tar.bz2"));
    download_file(SENSEVOICE_URL, &archive)?;
    let tar = resolve_command("tar").ok_or_else(|| "未找到 tar，无法解压 SenseVoice 模型".to_string())?;
    let (code, _, stderr) = run_capture(&tar, &["-xjf", &archive.to_string_lossy(), "-C", &root.to_string_lossy()])?;
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

/// 使用本机 `sherpa-onnx-offline` / `sherpa-onnx` CLI（若已安装）。
pub struct CliTranscriber {
    pub bin: PathBuf,
    pub model: SenseVoicePaths,
}

impl CliTranscriber {
    pub fn discover() -> Option<Self> {
        let bin = resolve_command("sherpa-onnx-offline")
            .or_else(|| resolve_command("sherpa-onnx"))?;
        let model = resolve_sensevoice()?;
        Some(Self { bin, model })
    }
}

impl Transcriber for CliTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<Transcription, String> {
        let srt_out = audio.with_extension("asr.srt");
        let model = self.model.model.to_string_lossy().into_owned();
        let tokens = self.model.tokens.to_string_lossy().into_owned();
        let file = audio.to_string_lossy().into_owned();
        let args = [
            "--sense-voice-model",
            model.as_str(),
            "--tokens",
            tokens.as_str(),
            "--file",
            file.as_str(),
        ];
        let (code, stdout, stderr) = run_capture(&self.bin, &args)?;
        if code != 0 {
            return Err(format!("sherpa-onnx 失败: {stderr}"));
        }
        let content = if srt_out.is_file() {
            fs::read_to_string(&srt_out).map_err(|err| err.to_string())?
        } else {
            stdout
        };
        if content.trim().is_empty() {
            return Err("ASR 没有输出文本".into());
        }
        let cues = if content.contains("-->") {
            parse_subtitle(&content, Some("srt"))
        } else {
            vec![super::srt::Cue {
                index: 1,
                start: 0.0,
                end: 2.0,
                text: content.trim().to_string(),
            }]
        };
        Ok(Transcription {
            segments: segments_from_cues(task_id, &cues),
            language: None,
        })
    }
}

pub fn select_transcriber(prefer_mock: bool) -> Result<Box<dyn Transcriber>, String> {
    if prefer_mock || std::env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1") {
        return Ok(Box::new(MockTranscriber));
    }
    if let Some(cli) = CliTranscriber::discover() {
        return Ok(Box::new(cli));
    }
    Err("未找到可用 ASR：请安装 sherpa-onnx CLI 并下载 SenseVoice，或导入 SRT，或在设置中开启模拟识别。".into())
}

pub fn asr_status() -> Vec<(String, bool, Option<String>)> {
    let sense = resolve_sensevoice();
    let cli = resolve_command("sherpa-onnx-offline").or_else(|| resolve_command("sherpa-onnx"));
    vec![
        (
            "sensevoice".into(),
            sense.is_some(),
            sense.as_ref().map(|p| p.dir.display().to_string()),
        ),
        (
            "sherpa-cli".into(),
            cli.is_some(),
            cli.map(|p| p.display().to_string()),
        ),
    ]
}

pub fn which_ok(name: &str) -> bool {
    resolve_command(name).is_some()
}

/// 保留给后续扩展；当前下载走 ureq。
#[allow(dead_code)]
fn spawn_curl(url: &str, dest: &Path) -> Result<(), String> {
    let status = Command::new("curl")
        .args(["-L", url, "-o", &dest.to_string_lossy()])
        .status()
        .map_err(|err| err.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("curl 下载失败".into())
    }
}
