//! 在本机原生后端直接运行（`cargo run` / `nsh run`）。

#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
use nsh_platform_linux as platform;
#[cfg(target_os = "macos")]
use nsh_platform_macos as platform;
#[cfg(target_os = "windows")]
use nsh_platform_windows as platform;

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn main() -> impl std::process::Termination {
    env_logger::init();
    platform::set_ui_sets(vec![
        nsh_base::registry(),
        nsh_app_video_translate::__nsh_native_module(),
    ]);
    platform::run_app(
        platform::AppSource::Rust(
            platform::Root::of::<nsh_app_video_translate::App>().tokens(
                nsh_base::Theme::from_json(include_str!("../theme.json"))
                    .expect("theme.json")
                    .into_tokens(),
            ),
        ),
        platform::AppOptions {
            title: "视频翻译助手".to_owned(),
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            app_id: "com.cl1107.video-translate".to_owned(),
            size: (1400, 900),
            ..Default::default()
        },
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
compile_error!(
    "Run this binary on macOS, Windows or Linux; use nsh run for iOS, Android and the web."
);
