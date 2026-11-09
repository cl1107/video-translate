//! 领域层：与 NSH 无关的任务、字幕、流水线与存储。

pub mod asr;
pub mod checkpoint;
pub mod command;
pub mod db;
pub mod download;
pub mod ffmpeg;
pub mod llm;
pub mod model;
pub mod paths;
pub mod pipeline;
pub mod review;
pub mod settings;
pub mod srt;
pub mod system_check;

pub use model::*;
pub use settings::{AppSettings, DEFAULT_APP_SETTINGS};
