use std::{
    fs,
    path::{Path, PathBuf},
};

use super::{
    command::{resolve_command, run_capture_cancellable},
    paths::downloads_dir,
};

pub fn looks_like_url(value: &str) -> bool {
    let value = value.trim();
    value.starts_with("http://") || value.starts_with("https://")
}

pub struct DownloadResult {
    pub media_path: PathBuf,
    pub subtitle_path: Option<PathBuf>,
    pub subtitle_language: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct SubtitleChoice {
    language: String,
    automatic: bool,
}

fn language_matches(code: &str, wanted: &str) -> bool {
    fn family(code: &str) -> &str {
        match code.split('-').next().unwrap_or(code) {
            "eng" => "en",
            "zho" | "chi" | "cmn" | "yue" => "zh",
            "jpn" | "jp" => "ja",
            "kor" => "ko",
            value => value,
        }
    }
    let code = code.to_ascii_lowercase();
    let wanted = wanted.to_ascii_lowercase();
    family(&code) == family(&wanted)
}

fn select_subtitle(info: &serde_json::Value, source_language: &str) -> Option<SubtitleChoice> {
    let language = if source_language.is_empty() || source_language == "auto" {
        info.get("language")?.as_str()?
    } else {
        source_language
    };
    for (field, automatic) in [("subtitles", false), ("automatic_captions", true)] {
        let Some(tracks) = info.get(field).and_then(serde_json::Value::as_object) else {
            continue;
        };
        let mut languages: Vec<&String> = tracks
            .iter()
            .filter(|(code, formats)| {
                language_matches(code, language)
                    && formats
                        .as_array()
                        .is_some_and(|formats| !formats.is_empty())
            })
            .map(|(code, _)| code)
            .collect();
        languages.sort_by_key(|code| {
            (
                !code.eq_ignore_ascii_case(language),
                !code.ends_with("-orig"),
                code.len(),
            )
        });
        if let Some(code) = languages.first() {
            return Some(SubtitleChoice {
                language: (*code).clone(),
                automatic,
            });
        }
    }
    None
}

pub fn download_url(
    url: &str,
    task_id: &str,
    proxy: &str,
    cookie_browser: &str,
) -> Result<DownloadResult, String> {
    download_url_with_cancel(url, task_id, proxy, cookie_browser, "auto", &|| false)
}

pub fn download_url_with_cancel(
    url: &str,
    task_id: &str,
    proxy: &str,
    cookie_browser: &str,
    source_language: &str,
    cancelled: &dyn Fn() -> bool,
) -> Result<DownloadResult, String> {
    let yt =
        resolve_command("yt-dlp").ok_or_else(|| "未找到 yt-dlp，无法下载在线视频".to_string())?;
    let dir = downloads_dir(task_id);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let output = dir.join("%(title).80B.%(ext)s");
    let mut common: Vec<String> = vec!["--no-playlist".into()];
    if !proxy.trim().is_empty() {
        let proxy = if proxy.contains("://") {
            proxy.to_string()
        } else {
            format!("http://{proxy}")
        };
        common.extend(["--proxy".into(), proxy]);
    }
    // auto starts anonymously; an explicitly chosen browser supplies cookies.
    if !matches!(cookie_browser, "none" | "auto" | "") {
        common.extend(["--cookies-from-browser".into(), cookie_browser.into()]);
    }
    let mut metadata_args = common.clone();
    metadata_args.extend([
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--".into(),
        url.trim().into(),
    ]);
    let metadata_refs: Vec<&str> = metadata_args.iter().map(String::as_str).collect();
    let (code, stdout, stderr) = run_capture_cancellable(&yt, &metadata_refs, cancelled)?;
    if code != 0 {
        return Err(format!("yt-dlp 解析失败: {stderr}"));
    }
    let info: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|error| format!("解析视频信息失败: {error}"))?;
    let choice = select_subtitle(&info, source_language);
    let mut args = common;
    args.extend([
        "-f".into(),
        "bv*+ba/b".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "-o".into(),
        output.to_string_lossy().into_owned(),
    ]);
    if let Some(subtitle) = &choice {
        args.extend([
            if subtitle.automatic {
                "--write-auto-subs"
            } else {
                "--write-subs"
            }
            .into(),
            "--sub-langs".into(),
            subtitle.language.clone(),
            "--convert-subs".into(),
            "srt".into(),
        ]);
    }
    args.extend(["--".into(), url.trim().into()]);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (code, stdout, stderr) = run_capture_cancellable(&yt, &arg_refs, cancelled)?;
    if code != 0 {
        return Err(format!("yt-dlp 失败: {stderr}\n{stdout}"));
    }
    let media =
        newest_file(&dir, &["mp4", "mkv", "webm", "mov"]).ok_or("下载完成但未找到视频文件")?;
    let subtitle = choice.as_ref().and_then(|choice| {
        ["srt", "vtt"]
            .into_iter()
            .map(|ext| media.with_extension(format!("{}.{ext}", choice.language)))
            .find(|path| path.is_file())
    });
    Ok(DownloadResult {
        media_path: media,
        subtitle_language: subtitle.as_ref().and(choice.map(|c| c.language)),
        subtitle_path: subtitle,
    })
}

fn newest_file(dir: &Path, exts: &[&str]) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if !exts.contains(&ext.as_str()) {
            continue;
        }
        let modified = entry.metadata().ok()?.modified().ok()?;
        if best.as_ref().is_none_or(|(time, _)| modified > *time) {
            best = Some((modified, path));
        }
    }
    best.map(|(_, path)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_urls() {
        assert!(looks_like_url("https://youtu.be/x"));
        assert!(!looks_like_url("/tmp/a.mp4"));
    }
    #[test]
    fn selects_source_language_and_manual_track_before_auto() {
        let info = serde_json::json!({ "language": "ja", "subtitles": { "en": [{}], "ja": [{}] }, "automatic_captions": { "ja-orig": [{}] } });
        assert_eq!(
            select_subtitle(&info, "auto"),
            Some(SubtitleChoice {
                language: "ja".into(),
                automatic: false
            })
        );
        assert_eq!(
            select_subtitle(&info, "en"),
            Some(SubtitleChoice {
                language: "en".into(),
                automatic: false
            })
        );
        assert!(select_subtitle(&info, "de").is_none());
        assert!(
            select_subtitle(&serde_json::json!({ "subtitles": { "en": [{}] } }), "auto").is_none()
        );
        let auto = serde_json::json!({ "language": "ja", "automatic_captions": { "en": [{}], "ja-orig": [{}] } });
        assert!(select_subtitle(&auto, "auto").unwrap().automatic);
    }
}
