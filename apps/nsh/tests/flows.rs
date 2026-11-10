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
    let fixture =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.srt");
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    app.type_text("text:本地文件、字幕或视频链接", fixture.to_str().unwrap())?;
    app.press("开始")?;
    app.wait_for_within("text:/已完成/", std::time::Duration::from_secs(8))?;
    Ok(())
}

#[test]
fn reuse_transcript_from_completed_task() -> Result<(), String> {
    let fixture =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.srt");
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    app.type_text("text:本地文件、字幕或视频链接", fixture.to_str().unwrap())?;
    app.press("开始")?;
    app.wait_for_within("text:/已完成/", std::time::Duration::from_secs(8))?;
    app.wait_for("复用到字幕")?;
    app.press("复用到字幕 >> nth=0")?;
    app.wait_for_within(
        "已复用识别结果创建字幕任务",
        std::time::Duration::from_secs(8),
    )?;
    Ok(())
}

#[test]
fn asynchronous_import_survives_page_switch_and_exports() -> Result<(), String> {
    let fixture =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.srt");
    let mut app = start();
    unsafe {
        std::env::remove_var("VIDEO_TRANSLATE_SYNC");
    }
    app.wait_for("视频翻译助手")?;
    app.type_text("text:本地文件、字幕或视频链接", fixture.to_str().unwrap())?;
    app.press("开始")?;
    app.press("设置")?;
    app.press("返回工作区")?;
    app.press("text:/^任务/")?;
    app.wait_for_within("text:/已完成/", std::time::Duration::from_secs(10))?;
    app.press("校对工作台")?;
    app.wait_for("应用时间")?;
    app.press("保存并重新导出")?;
    app.wait_for("已重新导出字幕")?;
    Ok(())
}

#[test]
fn model_services_keep_separate_credentials() -> Result<(), String> {
    let mut app = start();
    app.wait_for("视频翻译助手")?;
    app.press("设置")?;
    app.press("模型")?;
    app.wait_for("添加模型服务")?;
    app.type_text("text:可选；本地推理可留空", "test-key-one")?;
    app.press("添加模型服务")?;
    app.type_text("text:可选；本地推理可留空", "test-key-two")?;
    app.press("默认服务")?;
    let raw = std::fs::read_to_string(
        std::path::PathBuf::from(std::env::var("VIDEO_TRANSLATE_DATA_DIR").unwrap())
            .join("secrets.json"),
    )
    .unwrap();
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let keys = value["serviceKeys"].as_object().unwrap();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys["legacy"].as_str(), Some("test-key-one"));
    assert!(keys.values().any(|v| v.as_str() == Some("test-key-two")));
    Ok(())
}
