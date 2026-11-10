use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

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
    // Finder 启动的应用 PATH 通常没有 Homebrew / ~/.local/bin。
    for dir in common_bin_dirs() {
        let candidate = dir.join(command_file(name));
        if is_executable(&candidate) {
            return Some(candidate);
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
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn run_capture(program: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    run_capture_cancellable(program, args, &|| false)
}

pub fn run_capture_cancellable(
    program: &Path,
    args: &[&str],
    cancelled: &dyn Fn() -> bool,
) -> Result<(i32, String, String), String> {
    use std::{io::Read, process::Stdio, thread, time::Duration};
    if cancelled() {
        return Err("操作已取消".into());
    }
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|err| format!("无法启动 {}: {err}", program.display()))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let err = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let result = loop {
        if cancelled() {
            #[cfg(unix)]
            unsafe {
                unsafe extern "C" {
                    fn kill(pid: i32, signal: i32) -> i32;
                }
                kill(-(child.id() as i32), 9);
            }
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &child.id().to_string()])
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
            break Err("操作已取消".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.code().unwrap_or(-1)),
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error.to_string());
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| "读取进程输出失败".to_string())?
        .map_err(|e| e.to_string())?;
    let stderr = err
        .join()
        .map_err(|_| "读取进程错误输出失败".to_string())?
        .map_err(|e| e.to_string())?;
    let code = result?;
    Ok((
        code,
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
    ))
}

pub fn first_version_line(text: &str) -> Option<String> {
    text.lines().next().map(|line| line.trim().to_string())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn cancellation_stops_running_process_and_children() {
        let started = std::time::Instant::now();
        let result =
            run_capture_cancellable(Path::new("/bin/sh"), &["-c", "sleep 30 & wait"], &|| {
                started.elapsed() > std::time::Duration::from_millis(100)
            });
        assert_eq!(result.unwrap_err(), "操作已取消");
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
    }
}
