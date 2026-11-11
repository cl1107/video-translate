//! 视频翻译助手：NSH Rust 桌面端。

pub mod domain;
mod nav;
mod pages;
mod shell;
mod store;
mod ui;

use nsh_base::theme;
use nsh_core::desktop::{TitleBarOptions, TitleBarStyle, WindowAttributes};
use nsh_core::element::desktop::current_window;
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
    let mut title_bar = TitleBarOptions::default();
    title_bar.style = TitleBarStyle::Hidden;
    title_bar.height = Some(px(56.0));
    let mut window = WindowAttributes::default();
    window.title_bar = Some(title_bar);
    current_window().set(window);
    view()
        .flex_1()
        .bg(move || theme().background)
        .text_color(move || theme().foreground)
        .text_size(px(14.0))
        .child(shell::shell())
}
