use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use super::{
    asr::{Transcriber, select_transcriber},
    checkpoint::{self, PipelineCheckpoint},
    download::{download_url_with_cancel, looks_like_url},
    ffmpeg::Ffmpeg,
    llm::{
        Completer, MockCompleter, OpenAiCompleter, document_system, polish_system, translate_system,
    },
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
    let cp = PipelineCheckpoint {
        asr_complete: true,
        asr_fingerprint: None,
        ..PipelineCheckpoint::default()
    };
    checkpoint::save(&task.id, &cp)?;
    Ok(task)
}

pub struct Runtime {
    pub transcriber: Box<dyn Transcriber>,
    pub completer: Option<Box<dyn Completer>>,
    pub ffmpeg: Option<Ffmpeg>,
}

struct LazyTranscriber {
    engine: String,
    mock: bool,
}

impl Transcriber for LazyTranscriber {
    fn transcribe(&self, audio: &Path, task_id: &str) -> Result<super::asr::Transcription, String> {
        select_transcriber(&self.engine, self.mock)?.transcribe(audio, task_id)
    }

    fn transcribe_with_cancel(
        &self,
        audio: &Path,
        task_id: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<super::asr::Transcription, String> {
        select_transcriber(&self.engine, self.mock)?
            .transcribe_with_cancel(audio, task_id, cancelled)
    }
}

impl Runtime {
    pub fn for_task(
        settings: &AppSettings,
        task: &TranslationTask,
        api_key: &str,
    ) -> Result<Self, String> {
        let mut settings = settings.clone();
        settings.asr_engine = task.options.asr_engine.clone();
        settings.llm_base_url = task.options.llm_base_url.clone();
        settings.translate_model = task.options.translate_model.clone();
        settings.polish_model = task.options.polish_model.clone();
        if task.kind == TaskKind::Document && !settings.polish_model.trim().is_empty() {
            settings.translate_model = settings.polish_model.clone();
        }
        if task.kind == TaskKind::Subtitle
            && task.options.subtitle_processing_mode == SubtitleProcessingMode::Extract
        {
            settings.llm_base_url.clear();
        }
        Self::from_settings_with_key(&settings, api_key)
    }

    pub fn from_settings(settings: &AppSettings) -> Result<Self, String> {
        let key = std::env::var("VIDEO_TRANSLATE_LLM_API_KEY").unwrap_or_default();
        Self::from_settings_with_key(settings, &key)
    }

    pub fn from_settings_with_key(settings: &AppSettings, api_key: &str) -> Result<Self, String> {
        let mock_asr = settings.mock_asr
            || std::env::var("VIDEO_TRANSLATE_MOCK_ASR").ok().as_deref() == Some("1");
        let mock_llm = settings.mock_llm
            || std::env::var("VIDEO_TRANSLATE_MOCK_LLM").ok().as_deref() == Some("1");
        let transcriber = Box::new(LazyTranscriber {
            engine: settings.asr_engine.clone(),
            mock: mock_asr,
        });
        let completer: Option<Box<dyn Completer>> = if mock_llm {
            Some(Box::new(MockCompleter))
        } else if settings.llm_base_url.trim().is_empty() {
            None
        } else {
            Some(Box::new(OpenAiCompleter::new(
                &settings.llm_base_url,
                api_key,
                &settings.translate_model,
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
    if (looks_like_url(task.source_url.as_deref().unwrap_or(&task.video_file.path))
        || ext == "url"
        || task.video_file.format == "url")
        && !Path::new(&task.video_file.path).is_file()
    {
        set_status(task, TaskStatus::Downloading, 5.0);
        log_task(task, "info", "正在用 yt-dlp 下载");
        hooks.emit(task);
        let downloaded = download_url_with_cancel(
            task.source_url.as_deref().unwrap_or(&task.video_file.path),
            &task.id,
            &task.options.download_proxy,
            &task.options.download_cookie_browser,
            &task.source_language,
            &|| abort.is_cancelled(),
        )?;
        task.video_file.path = downloaded.media_path.to_string_lossy().into_owned();
        task.video_file.format = downloaded
            .media_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("mp4")
            .into();
        task.platform_subtitle_language = downloaded.subtitle_language;
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
    let asr_fp =
        checkpoint::asr_fingerprint(&task.options.asr_engine, &task.video_file.path, size, mtime);

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
        if cues.is_empty() {
            return Err("平台字幕没有有效条目".into());
        }
        task.detected_language = task.platform_subtitle_language.clone();
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
        let info = ffmpeg.probe_with_cancel(&path, &|| abort.is_cancelled())?;
        if !info.has_audio {
            return Err("源文件没有音轨，无法识别。请改用导入字幕。".into());
        }
        task.video_file.duration = info.duration;
        task.video_file.format = info.format;
        let audio = work_dir(&task.id).join("audio.wav");
        fs::create_dir_all(audio.parent().unwrap()).map_err(|err| err.to_string())?;
        let audio_fingerprint = audio.with_extension("source");
        if !audio.is_file()
            || fs::read_to_string(&audio_fingerprint).ok().as_deref() != Some(&asr_fp)
        {
            ffmpeg.extract_audio_with_cancel(&path, &audio, &|| abort.is_cancelled())?;
            fs::write(&audio_fingerprint, &asr_fp).map_err(|error| error.to_string())?;
        }
        set_status(task, TaskStatus::Transcribing, 35.0);
        log_task(task, "info", "语音识别（成功块会落盘，恢复时不重跑）");
        hooks.emit(task);
        check_abort(abort)?;
        let transcription =
            runtime
                .transcriber
                .transcribe_with_cancel(&audio, &task.id, &|| abort.is_cancelled())?;
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
    let source_content_fp = segment_content_fingerprint(task, false)?;
    let polish_fp = checkpoint::fingerprint(&[
        &source_content_fp,
        &asr_fp,
        &task.options.llm_base_url,
        &task.options.polish_model,
        &task.options.translate_model,
        if task.options.polish_transcript {
            "polish"
        } else {
            "raw"
        },
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
        let mut inputs = Vec::new();
        let mut input = String::new();
        let mut input_len = 0;
        for segment in &task.segments {
            let line = format!(
                "[{}] {}\n\n",
                super::srt::format_srt_time(segment.start),
                segment.asr_text()
            );
            for character in line.chars() {
                input.push(character);
                input_len += 1;
                // Bound input and output per request even for a single long ASR segment.
                if input_len >= 1200 {
                    inputs.push(std::mem::take(&mut input));
                    input_len = 0;
                }
            }
        }
        if !input.is_empty() {
            inputs.push(input);
        }
        if !checkpoint::matches(&cp.document_parts_fingerprint, &polish_fp) {
            cp.document_parts.clear();
            cp.document_parts_fingerprint = Some(polish_fp.clone());
        }
        for input in inputs.iter().skip(cp.document_parts.len()) {
            check_abort(abort)?;
            cp.document_parts
                .push(complete_document_part(runtime, task, input)?);
            checkpoint::save(&task.id, &cp)?;
        }
        let mut markdown = cp.document_parts.join("\n\n");
        markdown.push_str("\n\n## 来源索引\n\n");
        for segment in &task.segments {
            markdown.push_str(&format!(
                "- [{}](#t={:.3})\n",
                super::srt::format_srt_time(segment.start),
                segment.start
            ));
        }
        check_abort(abort)?;
        cp.document_complete = true;
        cp.document_fingerprint = Some(polish_fp);
        cp.document_markdown = Some(markdown.clone());
        checkpoint::save(&task.id, &cp)?;
        write_document_artifacts(task, &markdown)?;
        return Ok(());
    }

    if !extract_only {
        if task.options.polish_transcript {
            if cp.polish_complete
                && checkpoint::matches(&cp.polish_fingerprint, &polish_fp)
                && task.segments.iter().all(|segment| {
                    segment
                        .polished_text
                        .as_ref()
                        .is_some_and(|text| !text.trim().is_empty())
                })
            {
                log_task(task, "info", "复用已完成的润色");
            } else if let Some(completer) = runtime.completer.as_ref() {
                set_status(task, TaskStatus::Polishing, 55.0);
                log_task(task, "info", "润色原文");
                hooks.emit(task);
                check_abort(abort)?;
                for segment in &mut task.segments {
                    check_abort(abort)?;
                    let polished = completer.complete_with_model(
                        &task.options.polish_model,
                        polish_system(),
                        segment.asr_text(),
                    )?;
                    if !polished.trim().is_empty() {
                        segment.polished_text = Some(polished);
                    }
                }
                cp.polish_complete = true;
                cp.polish_fingerprint = Some(polish_fp.clone());
                checkpoint::save(&task.id, &cp)?;
            }
        }
        let translation_content_fp = segment_content_fingerprint(task, true)?;
        let translation_fp = checkpoint::fingerprint(&[
            &polish_fp,
            &translation_content_fp,
            &task.options.translate_model,
            &task.target_language,
            &serde_json::to_string(&task.options.glossary).map_err(|error| error.to_string())?,
        ]);
        if cp.translation_complete
            && checkpoint::matches(&cp.translation_fingerprint, &translation_fp)
            && task.segments.iter().all(|segment| {
                segment
                    .translated_text
                    .as_ref()
                    .is_some_and(|text| !text.trim().is_empty())
            })
        {
            log_task(task, "info", "复用已完成的翻译");
        } else {
            let completer = runtime.completer.as_ref().ok_or(
                "翻译需要模型服务。请在设置中填写 Endpoint，或改用「仅提取原文」，或开启模拟翻译。",
            )?;
            set_status(task, TaskStatus::Translating, 75.0);
            log_task(task, "info", "翻译字幕");
            hooks.emit(task);
            let system = translate_system(&task.target_language, &task.options.glossary);
            let skip = if checkpoint::matches(&cp.translation_fingerprint, &translation_fp) {
                cp.translation_completed_count
            } else {
                0
            };
            for index in 0..task.segments.len() {
                let segment = &mut task.segments[index];
                if index < skip
                    && segment
                        .translated_text
                        .as_ref()
                        .is_some_and(|t| !t.trim().is_empty())
                {
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
                hooks.emit(task);
            }
            cp.translation_complete = true;
            checkpoint::save(&task.id, &cp)?;
        }
    }

    check_abort(abort)?;
    set_status(task, TaskStatus::GeneratingSubtitles, 90.0);
    log_task(task, "info", "导出字幕文件");
    hooks.emit(task);
    write_subtitle_artifacts(task)?;

    if task.options.burn_subtitles {
        let ffmpeg = runtime.ffmpeg.as_ref().ok_or("烧录需要 FFmpeg")?;
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
        check_abort(abort)?;
        let path = ffmpeg.burn_subtitles_with_cancel(
            Path::new(&task.video_file.path),
            Path::new(&sub),
            &burned,
            &|| abort.is_cancelled(),
        )?;
        check_abort(abort)?;
        if let Some(artifacts) = task.output_artifacts.as_mut() {
            artifacts.burned_video = Some(path.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

fn segment_content_fingerprint(
    task: &TranslationTask,
    translated_input: bool,
) -> Result<String, String> {
    use std::hash::Hasher;
    let content: Vec<_> = task
        .segments
        .iter()
        .map(|segment| {
            (
                &segment.id,
                segment.start,
                segment.end,
                if translated_input {
                    segment.translate_input()
                } else {
                    segment.asr_text()
                },
            )
        })
        .collect();
    let encoded = serde_json::to_vec(&content).map_err(|error| error.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    hash.write(&encoded);
    Ok(format!("{:016x}", hash.finish()))
}

fn complete_document_part(
    runtime: &Runtime,
    task: &TranslationTask,
    input: &str,
) -> Result<String, String> {
    let completer = runtime
        .completer
        .as_ref()
        .ok_or("整理文稿需要模型服务，请在设置中填写 Endpoint 和模型 ID")?;
    completer.complete_with_model(&task.options.polish_model, document_system(), input)
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
        assert!(
            task.output_artifacts
                .as_ref()
                .unwrap()
                .translated_subtitle
                .is_none()
        );
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
        assert_eq!(
            reused.segments[0].original_text,
            source.segments[0].original_text
        );
        assert!(reused.segments[0].translated_text.is_none());
        assert!(reused.segments[0].polished_text.is_none());

        let reused = run_task(reused, &runtime, &abort, &mut hooks);
        assert_eq!(reused.status, TaskStatus::Completed);
        assert!(
            reused
                .logs
                .iter()
                .any(|log| log.message.contains("跳过 ASR"))
        );
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
    #[test]
    fn runtime_does_not_require_asr_for_subtitle_import() {
        let settings = AppSettings {
            asr_engine: "funasr-nano".into(),
            ..AppSettings::default()
        };
        let runtime =
            Runtime::from_settings(&settings).expect("ASR should be initialized only when needed");
        let dir = tempdir().unwrap();
        let srt = dir.path().join("input.srt");
        fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\nHello\n").unwrap();
        let task = create_task_from_input(
            srt.to_str().unwrap(),
            TaskKind::Subtitle,
            &settings,
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        let task = run_task(task, &runtime, &AbortFlag::new(), &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
    }

    struct RecordingCompleter(std::sync::Arc<std::sync::Mutex<Vec<(String, String)>>>);
    impl Completer for RecordingCompleter {
        fn complete(&self, _: &str, user: &str) -> Result<String, String> {
            Ok(format!("译：{user}"))
        }
        fn complete_with_model(&self, model: &str, _: &str, user: &str) -> Result<String, String> {
            self.0.lock().unwrap().push((model.into(), user.into()));
            Ok(format!("正文：{user}"))
        }
    }

    #[test]
    fn document_uses_polish_model_in_bounded_parts_with_source_links() {
        let dir = tempdir().unwrap();
        let input = dir.path().join("long.srt");
        fs::write(
            &input,
            format!("1\n00:00:03,500 --> 00:00:05,000\n{}\n", "文".repeat(3000)),
        )
        .unwrap();
        let settings = AppSettings {
            polish_model: "polisher".into(),
            ..AppSettings::default()
        };
        let task = create_task_from_input(
            input.to_str().unwrap(),
            TaskKind::Document,
            &settings,
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: Some(Box::new(RecordingCompleter(calls.clone()))),
            ffmpeg: None,
        };
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        let task = run_task(task, &runtime, &AbortFlag::new(), &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        let calls = calls.lock().unwrap();
        assert!(calls.len() >= 3);
        assert!(
            calls
                .iter()
                .all(|(model, input)| model == "polisher" && input.chars().count() <= 1200)
        );
        let markdown =
            fs::read_to_string(task.output_artifacts.unwrap().polished_markdown.unwrap()).unwrap();
        assert!(markdown.contains("#t=3.500"));
    }

    #[test]
    fn document_resume_keeps_successful_parts() {
        use std::sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        };
        struct CancelAfterFirst {
            calls: Arc<AtomicUsize>,
            abort: Arc<AbortFlag>,
        }
        impl Completer for CancelAfterFirst {
            fn complete(&self, _: &str, input: &str) -> Result<String, String> {
                if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    self.abort.cancel();
                }
                Ok(input.into())
            }
        }
        let dir = tempdir().unwrap();
        let input = dir.path().join("resume-doc.srt");
        fs::write(
            &input,
            format!("1\n00:00:01,000 --> 00:00:05,000\n{}\n", "文".repeat(3000)),
        )
        .unwrap();
        let task = create_task_from_input(
            input.to_str().unwrap(),
            TaskKind::Document,
            &AppSettings::default(),
            SubtitleProcessingMode::Extract,
            false,
            SubtitleBurnMode::Bilingual,
        )
        .unwrap();
        let abort = Arc::new(AbortFlag::new());
        let calls = Arc::new(AtomicUsize::new(0));
        let runtime = Runtime {
            transcriber: Box::new(MockTranscriber),
            completer: Some(Box::new(CancelAfterFirst {
                calls: calls.clone(),
                abort: abort.clone(),
            })),
            ffmpeg: None,
        };
        let mut hooks = PipelineHooks {
            on_event: Box::new(|_| {}),
        };
        let task = run_task(task, &runtime, &abort, &mut hooks);
        assert_eq!(task.status, TaskStatus::Cancelled);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let task = run_task(task, &runtime, &AbortFlag::new(), &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "resume must not request the first part again"
        );
    }

    #[test]
    fn resume_repairs_checkpoint_when_translated_segments_were_not_persisted() {
        let dir = tempdir().unwrap();
        let input = dir.path().join("crash.srt");
        fs::write(&input, "1\n00:00:00,000 --> 00:00:01,000\nHello\n").unwrap();
        let settings = AppSettings {
            polish_transcript: false,
            ..AppSettings::default()
        };
        let task = create_task_from_input(
            input.to_str().unwrap(),
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
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = events.clone();
        let mut hooks = PipelineHooks {
            on_event: Box::new(move |event| {
                captured.lock().unwrap().push(event.task);
            }),
        };
        let mut task = run_task(task, &runtime, &AbortFlag::new(), &mut hooks);
        assert!(
            events
                .lock()
                .unwrap()
                .iter()
                .any(|event| event.status == TaskStatus::Translating
                    && event.segments[0].translated_text.is_some())
        );
        task.segments[0].translated_text = None;
        task = run_task(task, &runtime, &AbortFlag::new(), &mut hooks);
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(
            task.segments[0].translated_text.as_deref(),
            Some("译：Hello")
        );
    }
}
