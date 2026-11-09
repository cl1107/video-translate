use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

const MEDIA: &[&str] = &["ffmpeg", "ffprobe"];

pub fn common_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(prefix) = env::var("HOMEBREW_PREFIX") {
        dirs.push(PathBuf::from(prefix).join("bin"));
        dirs.push(PathBuf::from(env::var("HOMEBREW_PREFIX").unwrap()).join("opt/ffmpeg-full/bin"));
    }
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/opt/ffmpeg-full/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
    }
    dirs
}

pub fn resolve_command(name: &str) -> Option<PathBuf> {
    if let Ok(explicit) = env::var(format!("{}_PATH", name.to_ascii_uppercase())) {
        let path = PathBuf::from(explicit);
        if is_executable(&path) {
            return Some(path);
        }
    }
    if name.contains(std::path::MAIN_SEPARATOR) {
        let path = PathBuf::from(name);
        return is_executable(&path).then_some(path);
    }
    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(command_file(name));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    if MEDIA.contains(&name) {
        for dir in common_bin_dirs() {
            let candidate = dir.join(command_file(name));
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn command_file(name: &str) -> String {
    if cfg!(windows) && !name.ends_with(".exe") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}

pub fn run_capture(program: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|err| format!("无法启动 {}: {err}", program.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let code = output.status.code().unwrap_or(-1);
    Ok((code, stdout, stderr))
}

pub fn first_version_line(text: &str) -> Option<String> {
    text.lines().next().map(|line| line.trim().to_string())
}
