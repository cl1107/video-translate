use nsh_engine::{EngineConfig, Points, Root, Size};
use nsh_testing::Headless;

fn start() -> Headless {
    let dir = tempfile::tempdir().expect("temp dir");
    unsafe {
        std::env::set_var("VIDEO_TRANSLATE_DATA_DIR", dir.path());
        std::env::set_var("VIDEO_TRANSLATE_MOCK_ASR", "1");
        std::env::set_var("VIDEO_TRANSLATE_MOCK_LLM", "1");
        std::env::set_var("VIDEO_TRANSLATE_SYNC", "1");
    }
    // Keep the tempdir for the process lifetime of the test.
    std::mem::forget(dir);
    Headless::start(EngineConfig {
        viewport: Size::new(Points(1200.0), Points(800.0)),
        ..EngineConfig::new(Root::of::<nsh_app_video_translate::App>())
    })
    .unwrap()
}

#[test]
fn workbench_shows_core_actions() -> Result<(), String> {
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    assert!(app.shows("添加"));
    assert!(app.shows("任务"));
    assert!(app.shows("设置"));
    assert!(app.shows("仅提取原文"));
    Ok(())
}

#[test]
fn import_srt_from_path_field() -> Result<(), String> {
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/sample.srt");
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    app.type_text("text:本地文件、字幕或视频链接", fixture.to_str().unwrap())?;
    app.press("开始")?;
    app.wait_for_within("text:/已完成/", std::time::Duration::from_secs(8))?;
    Ok(())
}

#[test]
fn reuse_transcript_from_completed_task() -> Result<(), String> {
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/sample.srt");
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    app.type_text("text:本地文件、字幕或视频链接", fixture.to_str().unwrap())?;
    app.press("开始")?;
    app.wait_for_within("text:/已完成/", std::time::Duration::from_secs(8))?;
    app.wait_for("复用到字幕")?;
    app.press("复用到字幕 >> nth=0")?;
    app.wait_for_within("已复用识别结果创建字幕任务", std::time::Duration::from_secs(8))?;
    Ok(())
}
