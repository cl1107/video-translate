use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use super::{
    asr::{Transcriber, select_transcriber},
    checkpoint::{self, PipelineCheckpoint},
    download::{download_url, looks_like_url},
    ffmpeg::Ffmpeg,
    llm::{Completer, MockCompleter, OpenAiCompleter, document_system, polish_system, translate_system},
    model::{
        Segment, SubtitleBurnMode, SubtitleProcessingMode, TaskKind, TaskLog, TaskOutputArtifacts,
        TaskStatus, TranslationStatus, TranslationTask, VideoFile, new_id, now,
    },
    paths::{resolve_output_dir, unique_path, work_dir},
    settings::AppSettings,
    srt::{
        Track, cues_from_segments, generate_ass, generate_srt, parse_subtitle, segments_from_cues,
    },
};

#[derive(Clone)]
pub struct PipelineEvent {
    pub task: TranslationTask,
}

pub type EventFn = Box<dyn FnMut(PipelineEvent) + Send>;

pub struct PipelineHooks {
    pub on_event: EventFn,
}

impl PipelineHooks {
    fn emit(&mut self, task: &TranslationTask) {
        (self.on_event)(PipelineEvent { task: task.clone() });
    }
}

pub struct AbortFlag(pub AtomicBool);

impl AbortFlag {
    pub fn new() -> Self {
        Self(AtomicBool::new(false))
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

impl Default for AbortFlag {
    fn default() -> Self {
        Self::new()
    }
}

fn log_task(task: &mut TranslationTask, level: &str, message: &str) {
    task.logs.push(TaskLog {
        id: new_id(),
        timestamp: now(),
        level: level.into(),
        message: message.into(),
        details: None,
    });
    task.updated_at = now();
}

fn set_status(task: &mut TranslationTask, status: TaskStatus, progress: f64) {
    task.status = status;
    task.progress = progress;
    task.updated_at = now();
}

fn check_abort(flag: &AbortFlag) -> Result<(), String> {
    if flag.is_cancelled() {
        Err("操作已取消".into())
    } else {
        Ok(())
    }
}

pub fn create_task_from_input(
    input: &str,
    kind: TaskKind,
    settings: &AppSettings,
    processing: SubtitleProcessingMode,
    burn: bool,
    burn_mode: SubtitleBurnMode,
) -> Result<TranslationTask, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("请输入文件路径、字幕或链接".into());
    }
    let now_ts = now();
    let (path, source_url, format) = if looks_like_url(input) {
        (input.to_string(), Some(input.to_string()), "url".into())
    } else {
        let path = PathBuf::from(input);
        if !path.exists() {
            return Err(format!("找不到文件: {input}"));
        }
        let format = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("bin")
            .to_ascii_lowercase();
        (path.to_string_lossy().into_owned(), None, format)
    };
    let name = Path::new(&path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名")
        .to_string();
    let size = Path::new(&path).metadata().map(|m| m.len()).unwrap_or(0);
    let video = VideoFile {
        id: new_id(),
        name: name.clone(),
        path,
        size,
        duration: 0.0,
        format,
        created_at: now_ts,
        source_url: source_url.clone(),
    };
    Ok(TranslationTask {
        id: new_id(),
        video_file: video,
        kind,
        status: TaskStatus::Pending,
        progress: 0.0,
        source_language: settings.source_language.clone(),
        detected_language: None,
        target_language: settings.target_language.clone(),
        options: settings.to_runtime(processing, burn, burn_mode),
        source_url,
        platform_subtitle_path: None,
        platform_subtitle_language: None,
        segments: Vec::new(),
        logs: Vec::new(),
        error_message: None,
        created_at: now_ts,
        updated_at: now_ts,
        completed_at: None,
        output_artifacts: None,
    })
}

pub fn can_reuse_transcript(task: &TranslationTask) -> bool {
    !task.segments.is_empty()
        && task
            .segments
            .iter()
            .any(|segment| !segment.asr_text().is_empty())
}

/// 用已有识别结果新建字幕或文稿任务，不重新 ASR。
pub fn create_reused_task(
    source: &TranslationTask,
    kind: TaskKind,
    settings: &AppSettings,
) -> Result<TranslationTask, String> {
    if !can_reuse_transcript(source) {
        return Err("任务尚无可复用的识别结果".into());
    }
    let now_ts = now();
    let mut video = source.video_file.clone();
    video.id = new_id();
    video.created_at = now_ts;
    let processing = if kind == TaskKind::Subtitle {
        SubtitleProcessingMode::Translate
    } else {
        SubtitleProcessingMode::Extract
    };
    let id = new_id();
    let segments = source
        .segments
        .iter()
        .enumerate()
        .map(|(index, segment)| Segment {
            id: format!("{id}:seg-{}", index + 1),
            start: segment.start,
            end: segment.end,
            original_text: segment.original_text.clone(),
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: segment.confidence,
        })
        .collect();
    let mut task = TranslationTask {
        id: id.clone(),
        video_file: video,
        kind,
        status: TaskStatus::Pending,
        progress: 0.0,
        source_language: source.source_language.clone(),
        detected_language: source.detected_language.clone(),
        target_language: settings.target_language.clone(),
        options: settings.to_runtime(processing, false, SubtitleBurnMode::Bilingual),
        source_url: source.source_url.clone(),
        platform_subtitle_path: source.platform_subtitle_path.clone(),
        platform_subtitle_language: source.platform_subtitle_language.clone(),
        segments,
        logs: Vec::new(),
        error_message: None,
        created_at: now_ts,
        updated_at: now_ts,
        completed_at: None,
        output_artifacts: None,
    };
    log_task(
        &mut task,
        "info",
        &format!("从任务 {} 复用识别结果，跳过 ASR", source.id),
    );
    let mut cp = PipelineCheckpoint {
        asr_complete: true,
        asr_fingerprint: None,
        ..PipelineCheckpoint::default()
    };
    checkpoint::save(&task.id, &cp)?;
    let _ = cp;
    Ok(task)
}

pub struct Runtime {
    pub transcriber: Box<dyn Transcriber>,
    pub completer: Option<Box<dyn Completer>>,
    pub ffmpeg: Option<Ffmpeg>,
}

impl Runtime {
    pub fn from_settings(settings: &AppSettings) -> Result<Self, String> {
        let mock_asr = settings.mock_asr
            || std::env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1");
        let mock_llm = settings.mock_llm
            || std::env::var("VIDEO_TRANSLATE_MOCK_LLM").ok().as_deref() == Some("1");
        let transcriber = select_transcriber(&settings.asr_engine, mock_asr)?;
        let completer: Option<Box<dyn Completer>> = if mock_llm {
            Some(Box::new(MockCompleter))
        } else if settings.llm_base_url.trim().is_empty() {
            None
        } else {
            let key = std::env::var("VIDEO_TRANSLATE_LLM_API_KEY").unwrap_or_default();
            Some(Box::new(OpenAiCompleter::new(
                &settings.llm_base_url,
                &key,
                if settings.translate_model.trim().is_empty() {
                    "gpt-4o-mini"
                } else {
                    &settings.translate_model
                },
            )?))
        };
        Ok(Self {
            transcriber,
            completer,
            ffmpeg: Ffmpeg::discover().ok(),
        })
    }
}

pub fn run_task(
    mut task: TranslationTask,
    runtime: &Runtime,
    abort: &AbortFlag,
    hooks: &mut PipelineHooks,
) -> TranslationTask {
    let result = run_inner(&mut task, runtime, abort, hooks);
    match result {
        Ok(()) => {
            if task.status != TaskStatus::Cancelled && task.status != TaskStatus::Paused {
                set_status(&mut task, TaskStatus::Completed, 100.0);
                task.completed_at = Some(now());
                log_task(&mut task, "success", "任务完成");
            }
        }
        Err(err) => {
            let progress = task.progress;
            if abort.is_cancelled() {
                set_status(&mut task, TaskStatus::Cancelled, progress);
                task.error_message = Some(err.clone());
                log_task(&mut task, "warn", &err);
            } else {
                set_status(&mut task, TaskStatus::Failed, progress);
                task.error_message = Some(err.clone());
                log_task(&mut task, "error", &err);
            }
        }
    }
    hooks.emit(&task);
    task
}

fn run_inner(
    task: &mut TranslationTask,
    runtime: &Runtime,
    abort: &AbortFlag,
    hooks: &mut PipelineHooks,
) -> Result<(), String> {
    check_abort(abort)?;
    let ext = Path::new(&task.video_file.path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if looks_like_url(task.source_url.as_deref().unwrap_or(&task.video_file.path))
        || ext == "url"
        || task.video_file.format == "url"
    {
        set_status(task, TaskStatus::Downloading, 5.0);
        log_task(task, "info", "正在用 yt-dlp 下载");
        hooks.emit(task);
        let downloaded = download_url(
            task.source_url.as_deref().unwrap_or(&task.video_file.path),
            &task.id,
            &task.options.download_proxy,
            &task.options.download_cookie_browser,
        )?;
        task.video_file.path = downloaded.media_path.to_string_lossy().into_owned();
        task.video_file.format = downloaded
            .media_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("mp4")
            .into();
        if let Some(sub) = downloaded.subtitle_path {
            task.platform_subtitle_path = Some(sub.to_string_lossy().into_owned());
        }
        hooks.emit(task);
    }

    let path = PathBuf::from(&task.video_file.path);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut cp = checkpoint::load(&task.id);
    let (size, mtime) = checkpoint::file_mtime_size(&task.video_file.path);
    let asr_fp = checkpoint::asr_fingerprint(
        &task.options.asr_engine,
        &task.video_file.path,
        size,
        mtime,
    );

    if checkpoint::stage_valid(cp.asr_complete, &cp.asr_fingerprint, &asr_fp)
        && !task.segments.is_empty()
    {
        log_task(task, "info", "复用已完成的识别结果，跳过 ASR");
        hooks.emit(task);
    } else if matches!(ext.as_str(), "srt" | "vtt") {
        log_task(task, "info", "导入字幕文件");
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let cues = parse_subtitle(&content, Some(&ext));
        if cues.is_empty() {
            return Err("字幕文件没有有效条目".into());
        }
        task.segments = segments_from_cues(&task.id, &cues);
        task.video_file.duration = cues.last().map(|c| c.end).unwrap_or(0.0);
        task.detected_language = Some(task.source_language.clone());
        mark_asr(&mut cp, &task.id, &asr_fp)?;
        hooks.emit(task);
    } else if let Some(platform) = task.platform_subtitle_path.clone() {
        log_task(task, "info", "使用平台字幕，跳过 ASR");
        let content = fs::read_to_string(&platform).map_err(|err| err.to_string())?;
        let cues = parse_subtitle(&content, None);
        task.segments = segments_from_cues(&task.id, &cues);
        mark_asr(&mut cp, &task.id, &asr_fp)?;
        hooks.emit(task);
    } else {
        let ffmpeg = runtime
            .ffmpeg
            .as_ref()
            .ok_or("未找到 FFmpeg，无法从视频提取音频")?;
        set_status(task, TaskStatus::ExtractingAudio, 15.0);
        log_task(task, "info", "提取音轨");
        hooks.emit(task);
        check_abort(abort)?;
        let info = ffmpeg.probe(&path)?;
        if !info.has_audio {
            return Err("源文件没有音轨，无法识别。请改用导入字幕。".into());
        }
        task.video_file.duration = info.duration;
        task.video_file.format = info.format;
        let audio = work_dir(&task.id).join("audio.wav");
        fs::create_dir_all(audio.parent().unwrap()).map_err(|err| err.to_string())?;
        if !audio.is_file() {
            ffmpeg.extract_audio(&path, &audio)?;
        }
        set_status(task, TaskStatus::Transcribing, 35.0);
        log_task(task, "info", "语音识别（成功块会落盘，恢复时不重跑）");
        hooks.emit(task);
        check_abort(abort)?;
        let transcription = runtime.transcriber.transcribe(&audio, &task.id)?;
        task.segments = transcription.segments;
        task.detected_language = transcription.language.or(task.detected_language.clone());
        mark_asr(&mut cp, &task.id, &asr_fp)?;
        hooks.emit(task);
    }

    if task.segments.is_empty() {
        return Err("没有识别到任何字幕段".into());
    }

    let extract_only = task.kind == TaskKind::Subtitle
        && task.options.subtitle_processing_mode == SubtitleProcessingMode::Extract;
    let polish_fp = checkpoint::fingerprint(&[&asr_fp, &task.options.polish_model]);
    let translation_fp = checkpoint::fingerprint(&[
        &polish_fp,
        &task.options.translate_model,
        &task.target_language,
        &serde_json::to_string(&task.options.glossary).unwrap_or_default(),
    ]);

    if task.kind == TaskKind::Document {
        if cp.document_complete && checkpoint::matches(&cp.document_fingerprint, &polish_fp) {
            if let Some(markdown) = &cp.document_markdown {
                write_document_artifacts(task, markdown)?;
                return Ok(());
            }
        }
        set_status(task, TaskStatus::Polishing, 70.0);
        log_task(task, "info", "整理文稿");
        hooks.emit(task);
        let transcript = task
            .segments
            .iter()
            .map(|seg| format!("[{}] {}", super::srt::format_srt_time(seg.start), seg.asr_text()))
            .collect::<Vec<_>>()
            .join("\n\n");
        let markdown = if let Some(completer) = runtime.completer.as_ref() {
            completer.complete(document_system(), &transcript)?
        } else {
            format!("# 文稿\n\n{transcript}\n")
        };
        cp.document_complete = true;
        cp.document_fingerprint = Some(polish_fp);
        cp.document_markdown = Some(markdown.clone());
        checkpoint::save(&task.id, &cp)?;
        write_document_artifacts(task, &markdown)?;
        return Ok(());
    }

    if !extract_only {
        if task.options.polish_transcript {
            if cp.polish_complete && checkpoint::matches(&cp.polish_fingerprint, &polish_fp) {
                log_task(task, "info", "复用已完成的润色");
            } else if let Some(completer) = runtime.completer.as_ref() {
                set_status(task, TaskStatus::Polishing, 55.0);
                log_task(task, "info", "润色原文");
                hooks.emit(task);
                check_abort(abort)?;
                for segment in &mut task.segments {
                    let polished = completer.complete(polish_system(), segment.asr_text())?;
                    if !polished.trim().is_empty() {
                        segment.polished_text = Some(polished);
                    }
                }
                cp.polish_complete = true;
                cp.polish_fingerprint = Some(polish_fp.clone());
                checkpoint::save(&task.id, &cp)?;
            }
        }
        if cp.translation_complete && checkpoint::matches(&cp.translation_fingerprint, &translation_fp)
        {
            log_task(task, "info", "复用已完成的翻译");
        } else {
            let completer = runtime
                .completer
                .as_ref()
                .ok_or("翻译需要模型服务。请在设置中填写 Endpoint，或改用「仅提取原文」，或开启模拟翻译。")?;
            set_status(task, TaskStatus::Translating, 75.0);
            log_task(task, "info", "翻译字幕");
            hooks.emit(task);
            let system = translate_system(&task.target_language, &task.options.glossary);
            let skip = if checkpoint::matches(&cp.translation_fingerprint, &translation_fp) {
                cp.translation_completed_count
            } else {
                0
            };
            for (index, segment) in task.segments.iter_mut().enumerate() {
                if index < skip && segment.translated_text.as_ref().is_some_and(|t| !t.trim().is_empty()) {
                    continue;
                }
                check_abort(abort)?;
                let input = segment.translate_input().to_string();
                let user = super::llm::translate_user(&input, &task.options.glossary);
                let translated = completer.complete(&system, &user)?;
                if translated.trim().is_empty() {
                    segment.translated_text = Some(input);
                    segment.translation_status = Some(TranslationStatus::Fallback);
                } else {
                    segment.translated_text = Some(translated);
                    segment.translation_status = Some(TranslationStatus::Translated);
                }
                cp.translation_fingerprint = Some(translation_fp.clone());
                cp.translation_completed_count = index + 1;
                checkpoint::save(&task.id, &cp)?;
            }
            cp.translation_complete = true;
            checkpoint::save(&task.id, &cp)?;
        }
    }

    set_status(task, TaskStatus::GeneratingSubtitles, 90.0);
    log_task(task, "info", "导出字幕文件");
    hooks.emit(task);
    write_subtitle_artifacts(task)?;

    if task.options.burn_subtitles {
        let ffmpeg = runtime
            .ffmpeg
            .as_ref()
            .ok_or("烧录需要 FFmpeg")?;
        let sub = match task.options.burn_subtitle_mode {
            SubtitleBurnMode::Original => task
                .output_artifacts
                .as_ref()
                .and_then(|a| a.original_subtitle.clone()),
            SubtitleBurnMode::Translated => task
                .output_artifacts
                .as_ref()
                .and_then(|a| a.translated_subtitle.clone())
                .or_else(|| {
                    task.output_artifacts
                        .as_ref()
                        .and_then(|a| a.original_subtitle.clone())
                }),
            SubtitleBurnMode::Bilingual => task
                .output_artifacts
                .as_ref()
                .and_then(|a| a.bilingual_ass.clone())
                .or_else(|| {
                    task.output_artifacts
                        .as_ref()
                        .and_then(|a| a.bilingual_subtitle.clone())
                }),
        }
        .ok_or("没有可烧录的字幕文件")?;
        set_status(task, TaskStatus::BurningSubtitles, 95.0);
        log_task(task, "info", "烧录硬字幕");
        hooks.emit(task);
        let output_dir = PathBuf::from(
            &task
                .output_artifacts
                .as_ref()
                .map(|a| a.output_directory.clone())
                .unwrap_or_default(),
        );
        let burned = unique_path(output_dir.join(format!(
            "{}-burned.mp4",
            Path::new(&task.video_file.name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("video")
        )));
        let path = ffmpeg.burn_subtitles(Path::new(&task.video_file.path), Path::new(&sub), &burned)?;
        if let Some(artifacts) = task.output_artifacts.as_mut() {
            artifacts.burned_video = Some(path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

fn write_subtitle_artifacts(task: &mut TranslationTask) -> Result<(), String> {
    let source = PathBuf::from(&task.video_file.path);
    let dir = resolve_output_dir(&source, task.options.subtitle_output_location);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("subtitle");
    let lang = task
        .detected_language
        .as_deref()
        .filter(|s| *s != "auto" && !s.is_empty())
        .unwrap_or("und");
    let original = unique_path(dir.join(format!("{stem}.{lang}.srt")));
    fs::write(
        &original,
        generate_srt(&cues_from_segments(&task.segments, Track::Original)),
    )
    .map_err(|err| err.to_string())?;
    let mut artifacts = TaskOutputArtifacts {
        original_subtitle: Some(original.to_string_lossy().into_owned()),
        translated_subtitle: None,
        bilingual_subtitle: None,
        bilingual_ass: None,
        burned_video: None,
        polished_markdown: None,
        output_directory: dir.to_string_lossy().into_owned(),
    };
    if task.options.subtitle_processing_mode == SubtitleProcessingMode::Translate {
        let translated = unique_path(dir.join(format!("{stem}.{}.srt", task.target_language)));
        fs::write(
            &translated,
            generate_srt(&cues_from_segments(&task.segments, Track::Translated)),
        )
        .map_err(|err| err.to_string())?;
        let bilingual = unique_path(dir.join(format!("{stem}.bilingual.srt")));
        fs::write(
            &bilingual,
            generate_srt(&cues_from_segments(&task.segments, Track::Bilingual)),
        )
        .map_err(|err| err.to_string())?;
        let ass = unique_path(dir.join(format!("{stem}.bilingual.ass")));
        fs::write(
            &ass,
            generate_ass(
                &cues_from_segments(&task.segments, Track::Bilingual),
                &task.options.original_subtitle_color,
                &task.options.translated_subtitle_color,
            ),
        )
        .map_err(|err| err.to_string())?;
        artifacts.translated_subtitle = Some(translated.to_string_lossy().into_owned());
        artifacts.bilingual_subtitle = Some(bilingual.to_string_lossy().into_owned());
        artifacts.bilingual_ass = Some(ass.to_string_lossy().into_owned());
    }
    task.output_artifacts = Some(artifacts);
    Ok(())
}

pub fn regenerate_subtitles(task: &mut TranslationTask) -> Result<(), String> {
    write_subtitle_artifacts(task)
}

fn mark_asr(cp: &mut PipelineCheckpoint, task_id: &str, fingerprint: &str) -> Result<(), String> {
    cp.asr_complete = true;
    cp.asr_fingerprint = Some(fingerprint.to_string());
    checkpoint::save(task_id, cp)
}

pub fn is_playable_media(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp4" | "mkv" | "mov" | "webm" | "m4v" | "avi" | "mp3" | "wav" | "m4a" | "aac"
    )
}

pub fn file_url(path: &str) -> String {
    let mut url = String::from("file://");
    for ch in path.chars() {
        match ch {
            ' ' => url.push_str("%20"),
            '#' => url.push_str("%23"),
            _ => url.push(ch),
        }
    }
    url
}

pub fn retranslate_segment(
    task: &mut TranslationTask,
    segment_id: &str,
    completer: &dyn Completer,
) -> Result<(), String> {
    let system = translate_system(&task.target_language, &task.options.glossary);
    let Some(segment) = task.segments.iter_mut().find(|item| item.id == segment_id) else {
        return Err("找不到该字幕段".into());
    };
    let input = segment.translate_input().to_string();
    let user = super::llm::translate_user(&input, &task.options.glossary);
    let translated = completer.complete(&system, &user)?;
    if translated.trim().is_empty() {
        segment.translated_text = Some(input);
        segment.translation_status = Some(TranslationStatus::Fallback);
    } else {
        segment.translated_text = Some(translated);
        segment.translation_status = Some(TranslationStatus::Translated);
    }
    Ok(())
}

fn write_document_artifacts(task: &mut TranslationTask, markdown: &str) -> Result<(), String> {
    let source = PathBuf::from(&task.video_file.path);
    let dir = source
        .parent()
        .map(|p| p.join("output"))
        .unwrap_or_else(|| PathBuf::from("output"));
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let path = unique_path(dir.join(format!("{stem}.md")));
    fs::write(&path, markdown).map_err(|err| err.to_string())?;
    task.output_artifacts = Some(TaskOutputArtifacts {
        polished_markdown: Some(path.to_string_lossy().into_owned()),
        output_directory: dir.to_string_lossy().into_owned(),
        ..TaskOutputArtifacts::default()
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::asr::MockTranscriber;
    use tempfile::tempdir;

    #[test]
    fn import_srt_extract_only() {
        let dir = tempdir().unwrap();
        let srt = dir.path().join("talk.srt");
        fs::write(
            &srt,
            "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\nWorld\n",
        )
        .unwrap();
        let mut settings = AppSettings::default();
        settings.mock_asr = true;
        settings.mock_llm = true;
        let mut task = create_task_from_input(
            srt.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: Some(Box::new(MockCompleter)),
            ffmpeg: None,
        };
        let abort = AbortFlag::new();
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        task = run_task(task, &runtime, &abort, &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.segments.len(), 2);
        let original = task
            .output_artifacts
            .as_ref()
            .and_then(|a| a.original_subtitle.as_ref())
            .unwrap();
        let body = fs::read_to_string(original).unwrap();
        assert!(body.contains("Hello"));
        assert!(task
            .output_artifacts
            .as_ref()
            .unwrap()
            .translated_subtitle
            .is_none());
    }

    #[test]
    fn mock_translate_path() {
        let dir = tempdir().unwrap();
        let srt = dir.path().join("talk.srt");
        fs::write(&srt, "1\n00:00:01,000 --> 00:00:02,000\nHello\n").unwrap();
        let mut settings = AppSettings::default();
        settings.mock_llm = true;
        let mut task = create_task_from_input(
            srt.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Translate,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: Some(Box::new(MockCompleter)),
            ffmpeg: None,
        };
        let abort = AbortFlag::new();
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        task = run_task(task, &runtime, &abort, &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(
            task.segments[0].translated_text.as_deref(),
            Some("译：Hello")
        );
    }

    #[test]
    fn resume_skips_successful_asr() {
        let dir = tempdir().unwrap();
        let media = dir.path().join("clip.mp4");
        fs::write(&media, b"fake").unwrap();
        let mut settings = AppSettings::default();
        settings.mock_asr = true;
        let mut task = create_task_from_input(
            media.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        task.segments = vec![crate::domain::model::Segment {
            id: format!("{}:seg-1", task.id),
            start: 0.0,
            end: 1.0,
            original_text: "cached".into(),
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        }];
        let (size, mtime) = checkpoint::file_mtime_size(&task.video_file.path);
        let fp = checkpoint::asr_fingerprint(
            &task.options.asr_engine,
            &task.video_file.path,
            size,
            mtime,
        );
        let mut cp = PipelineCheckpoint::default();
        mark_asr(&mut cp, &task.id, &fp).unwrap();
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: None,
            ffmpeg: None,
        };
        let abort = AbortFlag::new();
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        task = run_task(task, &runtime, &abort, &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.segments[0].original_text, "cached");
        assert!(task.logs.iter().any(|log| log.message.contains("跳过 ASR")));
    }

    #[test]
    fn retranslate_uses_glossary() {
        let dir = tempdir().unwrap();
        let srt = dir.path().join("talk.srt");
        fs::write(&srt, "1\n00:00:01,000 --> 00:00:02,000\nHello\n").unwrap();
        let mut settings = AppSettings::default();
        settings.glossary = vec![crate::domain::model::GlossaryEntry {
            source: "Hello".into(),
            target: "你好".into(),
        }];
        let mut task = create_task_from_input(
            srt.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Translate,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        task.segments = vec![crate::domain::model::Segment {
            id: "s1".into(),
            start: 0.0,
            end: 1.0,
            original_text: "Hello".into(),
            polished_text: None,
            translated_text: None,
            translation_status: None,
            confidence: 1.0,
        }];
        retranslate_segment(&mut task, "s1", &MockCompleter).unwrap();
        let text = task.segments[0].translated_text.clone().unwrap();
        assert!(text.contains("你好"), "{text}");
    }

    #[test]
    fn reuse_transcript_creates_new_task_without_asr() {
        let dir = tempdir().unwrap();
        let srt = dir.path().join("talk.srt");
        fs::write(&srt, "1\n00:00:01,000 --> 00:00:02,000\nHello\n").unwrap();
        let mut settings = AppSettings::default();
        settings.mock_asr = true;
        settings.mock_llm = true;
        settings.target_language = "ja".into();
        let mut source = create_task_from_input(
            srt.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: Some(Box::new(MockCompleter)),
            ffmpeg: None,
        };
        let abort = AbortFlag::new();
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        source = run_task(source, &runtime, &abort, &mut hooks);
        assert_eq!(source.status, TaskStatus::Completed);
        source.segments[0].translated_text = Some("旧译文".into());

        let reused = create_reused_task(&source, TaskKind::Subtitle, &settings).unwrap();
        assert_ne!(reused.id, source.id);
        assert_eq!(reused.kind, TaskKind::Subtitle);
        assert_eq!(reused.target_language, "ja");
        assert_eq!(reused.segments[0].original_text, source.segments[0].original_text);
        assert!(reused.segments[0].translated_text.is_none());
        assert!(reused.segments[0].polished_text.is_none());

        let reused = run_task(reused, &runtime, &abort, &mut hooks);
        assert_eq!(reused.status, TaskStatus::Completed);
        assert!(reused.logs.iter().any(|log| log.message.contains("跳过 ASR")));
        assert_ne!(reused.segments[0].original_text, "[mock]");

        let empty = TranslationTask {
            segments: Vec::new(),
            ..source.clone()
        };
        assert_eq!(
            create_reused_task(&empty, TaskKind::Document, &settings).unwrap_err(),
            "任务尚无可复用的识别结果"
        );
    }
}
