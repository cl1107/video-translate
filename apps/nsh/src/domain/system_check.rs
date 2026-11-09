use super::{
    asr::resolve_sensevoice,
    command::{first_version_line, resolve_command, run_capture},
};

#[derive(Debug, Clone, PartialEq)]
pub struct CheckResult {
    pub name: String,
    pub available: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    pub optional: bool,
}

pub fn run_checks() -> Vec<CheckResult> {
    let mut results = Vec::new();
    results.push(check_cmd("ffmpeg", &["-version"], false));
    results.push(check_cmd("ffprobe", &["-version"], false));
    results.push(check_cmd("yt-dlp", &["--version"], true));
    let sense = resolve_sensevoice();
    results.push(CheckResult {
        name: "SenseVoice".into(),
        available: sense.is_some(),
        version: sense.as_ref().map(|p| p.dir.display().to_string()),
        error: if sense.is_some() {
            None
        } else {
            Some("模型未安装，可在设置中下载，或导入 SRT。".into())
        },
        optional: true,
    });
    let sherpa = resolve_command("sherpa-onnx-offline").or_else(|| resolve_command("sherpa-onnx"));
    results.push(CheckResult {
        name: "sherpa-onnx".into(),
        available: sherpa.is_some(),
        version: sherpa.map(|p| p.display().to_string()),
        error: None,
        optional: true,
    });
    results
}

fn check_cmd(name: &str, args: &[&str], optional: bool) -> CheckResult {
    match resolve_command(name) {
        None => CheckResult {
            name: name.into(),
            available: false,
            version: None,
            error: Some(format!("未找到 {name}")),
            optional,
        },
        Some(path) => match run_capture(&path, args) {
            Ok((0, stdout, stderr)) => CheckResult {
                name: name.into(),
                available: true,
                version: first_version_line(&stdout).or_else(|| first_version_line(&stderr)),
                error: None,
                optional,
            },
            Ok((_, _, stderr)) => CheckResult {
                name: name.into(),
                available: false,
                version: None,
                error: Some(stderr),
                optional,
            },
            Err(err) => CheckResult {
                name: name.into(),
                available: false,
                version: None,
                error: Some(err),
                optional,
            },
        },
    }
}

pub fn required_ready(results: &[CheckResult]) -> bool {
    results.iter().all(|item| item.optional || item.available)
}
