use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    Subtitle,
    Document,
}

impl TaskKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Subtitle => "subtitle",
            Self::Document => "document",
        }
    }

    pub fn parse(value: &str) -> Self {
        if value == "document" {
            Self::Document
        } else {
            Self::Subtitle
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Downloading,
    ExtractingAudio,
    Transcribing,
    Polishing,
    Translating,
    GeneratingSubtitles,
    BurningSubtitles,
    Completed,
    Failed,
    Paused,
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Downloading => "downloading",
            Self::ExtractingAudio => "extracting_audio",
            Self::Transcribing => "transcribing",
            Self::Polishing => "polishing",
            Self::Translating => "translating",
            Self::GeneratingSubtitles => "generating_subtitles",
            Self::BurningSubtitles => "burning_subtitles",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "downloading" => Self::Downloading,
            "extracting_audio" => Self::ExtractingAudio,
            "transcribing" => Self::Transcribing,
            "polishing" => Self::Polishing,
            "translating" => Self::Translating,
            "generating_subtitles" => Self::GeneratingSubtitles,
            "burning_subtitles" => Self::BurningSubtitles,
            "completed" => Self::Completed,
            "failed" => Self::Failed,
            "paused" => Self::Paused,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Pending => "排队中",
            Self::Downloading => "下载中",
            Self::ExtractingAudio => "提取音频",
            Self::Transcribing => "识别中",
            Self::Polishing => "润色中",
            Self::Translating => "翻译中",
            Self::GeneratingSubtitles => "生成字幕",
            Self::BurningSubtitles => "烧录字幕",
            Self::Completed => "已完成",
            Self::Failed => "失败",
            Self::Paused => "已暂停",
            Self::Cancelled => "已取消",
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    pub fn is_bulk_deletable(self) -> bool {
        self.is_terminal()
    }

    pub fn is_running(self) -> bool {
        !self.is_terminal() && self != Self::Paused && self != Self::Pending
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleProcessingMode {
    Translate,
    Extract,
}

impl SubtitleProcessingMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Translate => "translate",
            Self::Extract => "extract",
        }
    }

    pub fn parse(value: &str) -> Self {
        if value == "extract" {
            Self::Extract
        } else {
            Self::Translate
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitleBurnMode {
    Bilingual,
    Translated,
    Original,
}

impl SubtitleBurnMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "translated" => Self::Translated,
            "original" => Self::Original,
            _ => Self::Bilingual,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleOutputLocation {
    OutputSubdirectory,
    SourceDirectory,
}

impl SubtitleOutputLocation {
    pub fn parse(value: &str) -> Self {
        if value == "source-directory" {
            Self::SourceDirectory
        } else {
            Self::OutputSubdirectory
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranslationStatus {
    Translated,
    Fallback,
    Reviewed,
}

impl TranslationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Translated => "translated",
            Self::Fallback => "fallback",
            Self::Reviewed => "reviewed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "translated" => Some(Self::Translated),
            "fallback" => Some(Self::Fallback),
            "reviewed" => Some(Self::Reviewed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GlossaryEntry {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskRuntimeOptions {
    pub llm_service_id: Option<String>,
    pub llm_base_url: String,
    pub translate_model: String,
    pub polish_model: String,
    pub glossary: Vec<GlossaryEntry>,
    pub asr_engine: String,
    pub burn_subtitles: bool,
    pub burn_subtitle_mode: SubtitleBurnMode,
    pub subtitle_processing_mode: SubtitleProcessingMode,
    pub subtitle_output_location: SubtitleOutputLocation,
    pub polish_transcript: bool,
    pub original_subtitle_color: String,
    pub translated_subtitle_color: String,
    pub download_proxy: String,
    pub download_cookie_browser: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TaskOutputArtifacts {
    pub original_subtitle: Option<String>,
    pub translated_subtitle: Option<String>,
    pub bilingual_subtitle: Option<String>,
    pub bilingual_ass: Option<String>,
    pub burned_video: Option<String>,
    pub polished_markdown: Option<String>,
    pub output_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub duration: f64,
    pub format: String,
    pub created_at: DateTime<Utc>,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub original_text: String,
    pub polished_text: Option<String>,
    pub translated_text: Option<String>,
    pub translation_status: Option<TranslationStatus>,
    pub confidence: f64,
}

impl Segment {
    pub fn asr_text(&self) -> &str {
        self.original_text.trim()
    }

    pub fn display_source(&self) -> &str {
        self.polished_text
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| self.asr_text())
    }

    pub fn translate_input(&self) -> &str {
        self.display_source()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TaskLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranslationTask {
    pub id: String,
    pub video_file: VideoFile,
    pub kind: TaskKind,
    pub status: TaskStatus,
    pub progress: f64,
    pub source_language: String,
    pub detected_language: Option<String>,
    pub target_language: String,
    pub options: TaskRuntimeOptions,
    pub source_url: Option<String>,
    pub platform_subtitle_path: Option<String>,
    pub platform_subtitle_language: Option<String>,
    pub segments: Vec<Segment>,
    pub logs: Vec<TaskLog>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub output_artifacts: Option<TaskOutputArtifacts>,
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now() -> DateTime<Utc> {
    Utc::now()
}
