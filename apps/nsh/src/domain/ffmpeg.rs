use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::command::{resolve_command, run_capture};

#[derive(Debug, Clone, PartialEq)]
pub struct MediaInfo {
    pub duration: f64,
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
}

#[derive(Debug, Clone)]
pub struct Ffmpeg {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl Ffmpeg {
    pub fn discover() -> Result<Self, String> {
        let ffmpeg = resolve_command("ffmpeg").ok_or_else(|| "未找到 ffmpeg".to_string())?;
        let ffprobe = resolve_command("ffprobe").ok_or_else(|| "未找到 ffprobe".to_string())?;
        Ok(Self { ffmpeg, ffprobe })
    }

    pub fn probe(&self, path: &Path) -> Result<MediaInfo, String> {
        let path_str = path.to_string_lossy();
        let (code, stdout, stderr) = run_capture(
            &self.ffprobe,
            &[
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                path_str.as_ref(),
            ],
        )?;
        if code != 0 {
            return Err(format!("ffprobe 失败: {stderr}"));
        }
        let json: Value =
            serde_json::from_str(&stdout).map_err(|err| format!("解析 ffprobe JSON 失败: {err}"))?;
        let duration = json
            .pointer("/format/duration")
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok())
            .or_else(|| {
                json.pointer("/format/duration")
                    .and_then(Value::as_f64)
            })
            .unwrap_or(0.0);
        let format = json
            .pointer("/format/format_name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let mut width = 0;
        let mut height = 0;
        let mut has_audio = false;
        if let Some(streams) = json.get("streams").and_then(Value::as_array) {
            for stream in streams {
                match stream.get("codec_type").and_then(Value::as_str) {
                    Some("audio") => has_audio = true,
                    Some("video") => {
                        width = stream.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
                        height = stream.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
                    }
                    _ => {}
                }
            }
        }
        Ok(MediaInfo {
            duration,
            format,
            width,
            height,
            has_audio,
        })
    }

    pub fn extract_audio(&self, video: &Path, output: &Path) -> Result<PathBuf, String> {
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let video_s = video.to_string_lossy();
        let output_s = output.to_string_lossy();
        let (code, _, stderr) = run_capture(
            &self.ffmpeg,
            &[
                "-hide_banner",
                "-i",
                video_s.as_ref(),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-y",
                output_s.as_ref(),
            ],
        )?;
        if code != 0 {
            if stderr.contains("does not contain any stream") || stderr.contains("Stream map") {
                return Err("源文件没有音轨，无法识别。请改用导入字幕。".into());
            }
            return Err(format!("提取音频失败: {stderr}"));
        }
        let meta = fs::metadata(output).map_err(|err| err.to_string())?;
        if meta.len() == 0 {
            return Err("音频文件为空".into());
        }
        Ok(output.to_path_buf())
    }

    pub fn extract_clip(
        &self,
        input: &Path,
        start: f64,
        duration: f64,
        output: &Path,
    ) -> Result<PathBuf, String> {
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let input_s = input.to_string_lossy();
        let output_s = output.to_string_lossy();
        let start_s = format!("{start:.3}");
        let dur_s = format!("{duration:.3}");
        let (code, _, stderr) = run_capture(
            &self.ffmpeg,
            &[
                "-hide_banner",
                "-ss",
                &start_s,
                "-t",
                &dur_s,
                "-i",
                input_s.as_ref(),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-y",
                output_s.as_ref(),
            ],
        )?;
        if code != 0 {
            return Err(format!("切分音频失败: {stderr}"));
        }
        Ok(output.to_path_buf())
    }

    pub fn burn_subtitles(
        &self,
        video: &Path,
        subtitle: &Path,
        output: &Path,
    ) -> Result<PathBuf, String> {
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let video_s = video.to_string_lossy();
        let output_s = output.to_string_lossy();
        let sub = subtitle.to_string_lossy().replace('\\', "\\\\").replace(':', "\\:");
        let filter = format!("subtitles='{sub}'");
        let (code, _, stderr) = run_capture(
            &self.ffmpeg,
            &[
                "-hide_banner",
                "-i",
                video_s.as_ref(),
                "-vf",
                &filter,
                "-c:a",
                "copy",
                "-y",
                output_s.as_ref(),
            ],
        )?;
        if code != 0 {
            return Err(format!("烧录字幕失败: {stderr}"));
        }
        Ok(output.to_path_buf())
    }
}
