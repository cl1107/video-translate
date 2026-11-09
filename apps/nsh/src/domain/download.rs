use std::{fs, path::{Path, PathBuf}};

use super::{
    command::{resolve_command, run_capture},
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

pub fn download_url(
    url: &str,
    task_id: &str,
    proxy: &str,
    cookie_browser: &str,
) -> Result<DownloadResult, String> {
    let yt = resolve_command("yt-dlp").ok_or_else(|| "未找到 yt-dlp，无法下载在线视频".to_string())?;
    let dir = downloads_dir(task_id);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let output = dir.join("%(title).80B.%(ext)s");
    let mut args: Vec<String> = vec![
        "-f".into(),
        "bv*+ba/b".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--write-sub".into(),
        "--write-auto-sub".into(),
        "--convert-subs".into(),
        "srt".into(),
        "-o".into(),
        output.to_string_lossy().into_owned(),
        "--no-playlist".into(),
    ];
    if !proxy.trim().is_empty() {
        let proxy = if proxy.contains("://") {
            proxy.to_string()
        } else {
            format!("http://{proxy}")
        };
        args.extend(["--proxy".into(), proxy]);
    }
    if cookie_browser != "none" && !cookie_browser.is_empty() {
        let browser = if cookie_browser == "auto" {
            "chrome"
        } else {
            cookie_browser
        };
        args.extend(["--cookies-from-browser".into(), browser.into()]);
    }
    args.push(url.trim().into());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (code, stdout, stderr) = run_capture(&yt, &arg_refs)?;
    if code != 0 {
        return Err(format!("yt-dlp 失败: {stderr}\n{stdout}"));
    }
    let media = newest_file(&dir, &["mp4", "mkv", "webm", "mov"]).ok_or("下载完成但未找到视频文件")?;
    let subtitle = newest_file(&dir, &["srt", "vtt"]);
    Ok(DownloadResult {
        media_path: media,
        subtitle_path: subtitle,
        subtitle_language: None,
    })
}

fn newest_file(dir: &Path, exts: &[&str]) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
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
}
