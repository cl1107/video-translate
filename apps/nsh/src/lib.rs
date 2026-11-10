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
    registry.assets(assets!());
}

/// 根组件：铺满窗口并使用主题背景。
#[component]
pub fn App() -> impl IntoElement {
    store::init_jobs();
    nsh_core::element::desktop::set_title_bar(
        nsh_core::desktop::TitleBarStyle::Hidden,
        Some(px(56.0)),
    );
    view()
        .flex_1()
        .bg(move || theme().background)
        .text_color(move || theme().foreground)
        .text_size(px(14.0))
        .child(shell::shell())
}
