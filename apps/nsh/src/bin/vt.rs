//! `vt`：无界面入口，覆盖检查、导入字幕与仅提取原文。

use std::{env, fs, path::PathBuf, process::ExitCode};

use nsh_app_video_translate::domain::{
    model::{SubtitleBurnMode, SubtitleProcessingMode, TaskKind, TaskStatus},
    paths,
    pipeline::{AbortFlag, PipelineHooks, Runtime, create_task_from_input, run_task},
    settings::AppSettings,
    system_check,
};

fn main() -> ExitCode {
    let mut args = env::args().skip(1).collect::<Vec<_>>();
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        eprintln!(
            "vt — 视频翻译助手命令行\n\n用法:\n  vt check\n  vt import-srt <file.srt>\n  vt extract <file>\n  vt import-legacy <electron.db>\n"
        );
        return ExitCode::SUCCESS;
    }
    match args.remove(0).as_str() {
        "check" => {
            for item in system_check::run_checks() {
                println!(
                    "{} {} {}",
                    if item.available { "ok" } else { "missing" },
                    item.name,
                    item.version.or(item.error).unwrap_or_default()
                );
            }
            ExitCode::SUCCESS
        }
        "import-legacy" => {
            if args.len() != 1 {
                eprintln!("用法: vt import-legacy <electron.db>");
                return ExitCode::FAILURE;
            }
            match nsh_app_video_translate::domain::legacy_import::import_legacy(
                std::path::Path::new(&args[0]),
                &paths::db_path(),
            ) {
                Ok(report) => {
                    println!(
                        "已导入 {} 个任务、{} 个字幕段、{} 条日志；跳过 {} 个已导入任务。",
                        report.imported_tasks,
                        report.imported_segments,
                        report.imported_logs,
                        report.skipped_tasks
                    );
                    if report.paused_tasks > 0 {
                        println!(
                            "{} 个未完成任务已暂停；旧断点与密钥未导入。",
                            report.paused_tasks
                        );
                    }
                    if report.tasks_without_options > 0 {
                        println!(
                            "{} 个旧任务未保存运行配置，使用原版默认值；恢复前请重新配置模型服务。",
                            report.tasks_without_options
                        );
                    }
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("导入失败: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        "import-srt" | "extract" => {
            let Some(file) = args.first() else {
                eprintln!("缺少文件路径");
                return ExitCode::FAILURE;
            };
            if let Ok(dir) = env::var("VIDEO_TRANSLATE_DATA_DIR") {
                paths::set_data_dir_override(Some(PathBuf::from(dir)));
            }
            let mut settings = AppSettings::default();
            settings.mock_asr = env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1");
            match create_task_from_input(
                file,
                TaskKind::Subtitle,
                &settings,
                SubtitleProcessingMode::Extract,
                false,
                SubtitleBurnMode::Bilingual,
            ) {
                Ok(task) => {
                    let runtime = match Runtime::from_settings(&settings) {
                        Ok(runtime) => runtime,
                        Err(err) => {
                            eprintln!("{err}");
                            return ExitCode::FAILURE;
                        }
                    };
                    let abort = AbortFlag::new();
                    let mut hooks = PipelineHooks {
                        on_event: Box::new(|_| {}),
                    };
                    let task = run_task(task, &runtime, &abort, &mut hooks);
                    if task.status == TaskStatus::Completed {
                        if let Some(path) = task
                            .output_artifacts
                            .as_ref()
                            .and_then(|a| a.original_subtitle.as_ref())
                        {
                            println!(
                                "{}",
                                fs::canonicalize(path)
                                    .unwrap_or_else(|_| PathBuf::from(path))
                                    .display()
                            );
                        }
                        ExitCode::SUCCESS
                    } else {
                        eprintln!("{}", task.error_message.unwrap_or_else(|| "失败".into()));
                        ExitCode::FAILURE
                    }
                }
                Err(err) => {
                    eprintln!("{err}");
                    ExitCode::FAILURE
                }
            }
        }
        other => {
            eprintln!("未知命令: {other}");
            ExitCode::FAILURE
        }
    }
}
