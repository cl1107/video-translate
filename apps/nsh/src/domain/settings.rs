use serde::{Deserialize, Serialize};

use super::model::{
    GlossaryEntry, SubtitleBurnMode, SubtitleOutputLocation, SubtitleProcessingMode,
    TaskRuntimeOptions,
};

pub const DEFAULT_ASR_ENGINE: &str = "sensevoice";
pub const DEFAULT_ORIGINAL_SUBTITLE_COLOR: &str = "#FFFFFF";
pub const DEFAULT_TRANSLATED_SUBTITLE_COLOR: &str = "#FFFF00";
pub const LEGACY_LLM_SERVICE_ID: &str = "legacy";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LlmServiceConfig {
    pub id: String,
    pub name: String,
    pub llm_base_url: String,
    pub translate_model: String,
    pub polish_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub asr_engine: String,
    pub llm_services: Vec<LlmServiceConfig>,
    pub selected_llm_service_id: String,
    pub llm_base_url: String,
    pub translate_model: String,
    pub polish_model: String,
    pub source_language: String,
    pub target_language: String,
    pub output_format: String,
    pub subtitle_output_location: SubtitleOutputLocation,
    pub polish_transcript: bool,
    pub glossary: Vec<GlossaryEntry>,
    pub original_subtitle_color: String,
    pub translated_subtitle_color: String,
    pub download_proxy: String,
    pub download_cookie_browser: String,
    pub mock_asr: bool,
    pub mock_llm: bool,
}

pub static DEFAULT_APP_SETTINGS: std::sync::LazyLock<AppSettings> =
    std::sync::LazyLock::new(|| AppSettings {
        asr_engine: DEFAULT_ASR_ENGINE.to_string(),
        llm_services: vec![LlmServiceConfig {
            id: LEGACY_LLM_SERVICE_ID.to_string(),
            name: "默认服务".to_string(),
            llm_base_url: String::new(),
            translate_model: String::new(),
            polish_model: String::new(),
        }],
        selected_llm_service_id: LEGACY_LLM_SERVICE_ID.to_string(),
        llm_base_url: String::new(),
        translate_model: String::new(),
        polish_model: String::new(),
        source_language: "auto".to_string(),
        target_language: "zh".to_string(),
        output_format: "srt".to_string(),
        subtitle_output_location: SubtitleOutputLocation::OutputSubdirectory,
        polish_transcript: true,
        glossary: Vec::new(),
        original_subtitle_color: DEFAULT_ORIGINAL_SUBTITLE_COLOR.to_string(),
        translated_subtitle_color: DEFAULT_TRANSLATED_SUBTITLE_COLOR.to_string(),
        download_proxy: String::new(),
        download_cookie_browser: "auto".to_string(),
        mock_asr: false,
        mock_llm: false,
    });

impl Default for AppSettings {
    fn default() -> Self {
        DEFAULT_APP_SETTINGS.clone()
    }
}

impl AppSettings {
    pub fn to_runtime(
        &self,
        processing: SubtitleProcessingMode,
        burn: bool,
        burn_mode: SubtitleBurnMode,
    ) -> TaskRuntimeOptions {
        TaskRuntimeOptions {
            llm_service_id: Some(self.selected_llm_service_id.clone()),
            llm_base_url: self.llm_base_url.clone(),
            translate_model: self.translate_model.clone(),
            polish_model: self.polish_model.clone(),
            glossary: self.glossary.clone(),
            asr_engine: self.asr_engine.clone(),
            burn_subtitles: burn,
            burn_subtitle_mode: burn_mode,
            subtitle_processing_mode: processing,
            subtitle_output_location: self.subtitle_output_location,
            polish_transcript: self.polish_transcript,
            original_subtitle_color: self.original_subtitle_color.clone(),
            translated_subtitle_color: self.translated_subtitle_color.clone(),
            download_proxy: self.download_proxy.clone(),
            download_cookie_browser: self.download_cookie_browser.clone(),
        }
    }
}

pub fn parse_settings_json(raw: &str) -> AppSettings {
    serde_json::from_str(raw).unwrap_or_else(|_| AppSettings::default())
}
