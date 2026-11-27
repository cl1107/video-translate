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

fn download_error(stage: &str, stderr: &str, cookie_browser: &str) -> String {
    let raw_error = format!("yt-dlp {stage}失败: {}", stderr.trim());
    let browser = cookie_browser.split([':', '+']).next().unwrap_or_default();
    let missing_database = format!("ERROR: could not find {browser} cookies database in \"");
    if let Some(directory) = stderr
        .lines()
        .find_map(|line| line.strip_prefix(&missing_database)?.strip_suffix('"'))
    {
        let blocked = dirs::home_dir().is_some_and(|home| {
            let path = Path::new(directory);
            path.is_absolute()
                && path.starts_with(&home)
                && fs::read_dir(path)
                    .is_err_and(|err| err.kind() == std::io::ErrorKind::PermissionDenied)
        });
        let hint = if blocked {
            "系统拒绝读取浏览器配置目录。请在系统隐私设置中检查当前应用的访问权限，或导入本地音视频文件。"
        } else {
            "找不到所选浏览器的 Cookie 数据库。请用该浏览器的普通窗口登录网站，或选择实际用于登录的浏览器。"
        };
        return format!("{hint}\n\n{raw_error}");
    }
    raw_error
}

pub fn download_url(
    url: &str,
    task_id: &str,
    proxy: &str,
    cookie_browser: &str,
) -> Result<DownloadResult, String> {
    download_url_with_cancel(url, task_id, proxy, cookie_browser, "auto", &|| false)
}

fn ffmpeg_location(ffmpeg: &Path) -> String {
    let target = ffmpeg
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(ffmpeg);
    target.to_string_lossy().into_owned()
}

struct TempCookieFile(PathBuf);

impl Drop for TempCookieFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn export_ego_cookies(
    dir: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<TempCookieFile, String> {
    let ego = resolve_command("ego-browser").ok_or_else(|| {
        "未找到 ego-browser（Ego Lite）。请先安装 Ego Lite 并在其中登录目标网站，或改用其他浏览器。"
            .to_string()
    })?;
    let cookie_path = dir.join(".ego-cookies.txt");
    let cookie_guard = TempCookieFile(cookie_path.clone());
    let path_json = serde_json::to_string(&cookie_path.to_string_lossy().as_ref())
        .map_err(|err| format!("路径序列化失败: {err}"))?;
    let script = format!(
        r##"
const fs = await import("node:fs/promises");
const task = await taskSpace("video-translate-cookie");
try {{
  const page = task.page("p1");
  const {{ cookies }} = await page.cdp("Network.getAllCookies");
  const lines = ["# Netscape HTTP Cookie File"];
  for (const c of cookies || []) {{
    const domain = String(c.domain || "").replace(/[\r\n\t]/g, "");
    const path = String(c.path || "/").replace(/[\r\n\t]/g, "");
    const name = String(c.name || "").replace(/[\r\n\t]/g, "");
    const value = String(c.value || "").replace(/[\r\n\t]/g, "");
    if (!domain || !name) continue;
    const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires =
      c.session || !Number.isFinite(c.expires) || c.expires <= 0
        ? 0
        : Math.floor(c.expires);
    lines.push([domain, includeSubdomains, path, secure, expires, name, value].join("\t"));
  }}
  await fs.writeFile({path_json}, lines.join("\n") + "\n", "utf8");
  console.log("COOKIE_OK:" + (lines.length - 1));
}} finally {{
  await task.finish({{ keep: false }}).catch(() => {{}});
}}
"##
    );
    let (code, stdout, stderr) =
        run_capture_cancellable(&ego, &["nodejs", "-e", &script], cancelled)?;
    if code != 0 {
        return Err(format!(
            "从 Ego Lite 读取 Cookie 失败: {}",
            if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            }
        ));
    }
    let combined = format!("{stdout}\n{stderr}");
    let count = combined
        .lines()
        .find_map(|line| line.strip_prefix("COOKIE_OK:")?.trim().parse::<usize>().ok());
    match count {
        Some(0) => {
            return Err(
                "未从 Ego Lite 读取到任何 Cookie。请先在 Ego Lite 中打开并登录目标网站后重试。"
                    .into(),
            );
        }
        Some(_) => {}
        None => {
            return Err(format!(
                "从 Ego Lite 读取 Cookie 失败：输出格式无效 ({})",
                combined.trim()
            ));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&cookie_path, fs::Permissions::from_mode(0o600));
    }
    Ok(cookie_guard)
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
    let mut common: Vec<String> = vec![
        "--no-playlist".into(),
        "--no-js-runtimes".into(),
        "--js-runtimes".into(),
        resolve_command("node")
            .map_or_else(|| "node".into(), |path| format!("node:{}", path.display())),
    ];
    if let Some(ffmpeg) = resolve_command("ffmpeg") {
        common.extend(["--ffmpeg-location".into(), ffmpeg_location(&ffmpeg)]);
    }
    if !proxy.trim().is_empty() {
        let proxy = if proxy.contains("://") {
            proxy.to_string()
        } else {
            format!("http://{proxy}")
        };
        common.extend(["--proxy".into(), proxy]);
    }
    let _ego_cookies = if cookie_browser == "ego" {
        let cookies = export_ego_cookies(&dir, cancelled)?;
        common.extend([
            "--cookies".into(),
            cookies.0.to_string_lossy().into_owned(),
        ]);
        Some(cookies)
    } else {
        // auto starts anonymously; an explicitly chosen browser supplies cookies.
        if !matches!(cookie_browser, "none" | "auto" | "") {
            common.extend(["--cookies-from-browser".into(), cookie_browser.into()]);
        }
        None
    };
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
        return Err(download_error("解析", &stderr, cookie_browser));
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
        return Err(download_error(
            "下载",
            &format!("{stderr}\n{stdout}"),
            cookie_browser,
        ));
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

    #[test]
    fn resolves_ffmpeg_location_to_parent_dir_when_present() {
        assert_eq!(
            ffmpeg_location(Path::new("/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg")),
            "/opt/homebrew/opt/ffmpeg-full/bin"
        );
        assert_eq!(ffmpeg_location(Path::new("ffmpeg")), "ffmpeg");
    }
}
