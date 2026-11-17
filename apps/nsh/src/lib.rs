//! 视频翻译助手：Rust 领域层 + TSX 界面。

pub mod domain;
mod store;

use nsh_core::prelude::*;

/// The app's UI set (`nsh.json` `"rust"`).
#[native_module("video-translate/native")]
fn native(registry: &mut Registry) {
    registry.class::<store::Workspace>();
    registry.assets(assets!());
}
