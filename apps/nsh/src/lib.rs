//! 视频翻译助手：NSH Rust 桌面端。

pub mod domain;
mod nav;
mod pages;
mod shell;
mod store;
mod ui;

use nsh_base::theme;
use nsh_core::prelude::*;

/// The app's UI set (`nsh.json` `"rust"`).
#[native_module("video-translate/native")]
fn native(registry: &mut Registry) {
    registry.register::<App>();
}

/// 根组件：铺满窗口并使用主题背景。
#[component]
pub fn App() -> impl IntoElement {
    view()
        .flex_1()
        .bg(move || theme().background)
        .text_color(move || theme().foreground)
        .child(shell::shell())
}
