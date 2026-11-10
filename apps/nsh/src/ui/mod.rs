//! 应用自有的 styled 控件，建立在无外观的 nsh_base 之上。

use nsh_base::{SliderValue, button, input, progress, slider, switch, theme};
use nsh_core::element::ImageSrc;
use nsh_core::prelude::*;

pub(crate) fn primary_button(
    label: impl IntoReactive<SharedString>,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    button()
        .on_press(on_press)
        .h_9()
        .px_4()
        .items_center()
        .justify_center()
        .rounded_md()
        .bg(move || theme().primary)
        .hover(|s| s.opacity(0.9))
        .active(|s| s.opacity(0.85))
        .focus(|s| s.outline(px(2.0)).outline_color(move || theme().ring))
        .disabled_style(|s| s.opacity(0.5))
        .child(
            text(label)
                .text_sm()
                .text_color(move || theme().primary_foreground),
        )
}

pub(crate) fn outline_button(
    label: impl IntoReactive<SharedString>,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    outline_button_enabled(label, || true, on_press)
}

pub(crate) fn outline_button_enabled(
    label: impl IntoReactive<SharedString>,
    enabled: impl Fn() -> bool + 'static,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    button()
        .disabled(move || !enabled())
        .disabled_style(|s| s.opacity(0.5))
        .on_press(on_press)
        .h_9()
        .px_4()
        .items_center()
        .justify_center()
        .rounded_md()
        .border_1()
        .border_color(move || theme().border)
        .bg(move || theme().background)
        .hover(|s| s.bg(move || theme().muted))
        .active(|s| s.bg(move || theme().muted))
        .focus(|s| s.outline(px(2.0)).outline_color(move || theme().ring))
        .child(text(label).text_sm().text_color(move || theme().foreground))
}

pub(crate) fn ghost_button(
    label: impl IntoReactive<SharedString>,
    selected: impl IntoReactive<bool>,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    let selected = selected.into_reactive();
    let selected_bg = selected.clone();
    let selected_fg = selected.clone();
    button()
        .on_press(on_press)
        .h_8()
        .px_3()
        .items_center()
        .justify_center()
        .rounded_md()
        .bg(move || {
            if selected_bg.get() {
                theme().background
            } else {
                theme().background.opacity(0.0)
            }
        })
        .active(|s| s.opacity(0.8))
        .child(text(label).text_sm().text_color(move || {
            if selected_fg.get() {
                theme().foreground
            } else {
                theme().muted_foreground
            }
        }))
}

pub(crate) fn field(
    placeholder: &'static str,
    value: impl Fn() -> String + 'static,
    on_change: impl Fn(&str) + 'static,
) -> impl IntoElement {
    input()
        .value(move || value())
        .on_change(move |text: &str| on_change(text))
        .placeholder(placeholder)
        .placeholder_color(|| color(theme().muted_foreground))
        .caret_color(|| color(theme().primary))
        .h_9()
        .px_3()
        .flex_1()
        .text_sm()
        .rounded_md()
        .border_1()
        .border_color(move || theme().input)
        .focus(|s| s.border_color(move || theme().ring))
}

pub(crate) fn secret_field(
    value: impl Fn() -> String + 'static,
    on_change: impl Fn(&str) + 'static,
) -> impl IntoElement {
    input()
        .masked(true)
        .value(move || value())
        .on_change(move |v: &str| on_change(v))
        .placeholder("可选；本地推理可留空")
        .h_9()
        .px_3()
        .text_sm()
        .rounded_md()
        .border_1()
        .border_color(move || theme().input)
        .focus(|s| s.border_color(move || theme().ring))
}

pub(crate) fn labeled_switch(
    label: &'static str,
    checked: impl Fn() -> bool + 'static,
    on_change: impl Fn(bool) + 'static,
) -> impl IntoElement {
    switch()
        .checked(move || checked())
        .on_change(move |&done: &bool| on_change(done))
        .flex_row()
        .items_center()
        .gap_3()
        .track_class("w-11 rounded-full bg-muted p-0.5 transition-colors checked:bg-primary")
        .thumb_class("size-5 rounded-full bg-background transition-transform checked:translate-x-5")
        .child(text(label).text_sm().text_color(move || theme().foreground))
}

pub(crate) fn bar_progress(value: impl Fn() -> f32 + 'static) -> impl IntoElement {
    progress()
        .value(move || value())
        .h_2()
        .track_class("h-2 rounded-full bg-muted overflow-hidden")
        .indicator_class("h-2 rounded-full bg-chart-1")
}

pub(crate) fn timeline(
    value: impl Fn() -> f64 + 'static,
    max: impl Fn() -> f64 + 'static,
    on_change: impl Fn(f64) + 'static,
) -> impl IntoElement {
    slider()
        .value(move || SliderValue::Single(value()))
        .min(0.0)
        .max(move || max().max(0.1))
        .step(0.05)
        .h_6()
        .track_class("h-6 justify-center")
        .indicator_class("h-1.5 rounded-full bg-muted")
        .range_class("h-1.5 rounded-full bg-chart-1")
        .thumb_class("size-4 rounded-full bg-primary")
        .on_change(move |v: &SliderValue| on_change(v.start()))
}

pub(crate) fn range_timeline(
    start: impl Fn() -> f64 + 'static,
    end: impl Fn() -> f64 + 'static,
    max: impl Fn() -> f64 + 'static,
    on_change: impl Fn(f64, f64) + 'static,
) -> impl IntoElement {
    slider()
        .value(move || SliderValue::Range(start(), end()))
        .min(0.0)
        .max(move || max().max(0.1))
        .step(0.05)
        .h_6()
        .track_class("h-6 justify-center")
        .indicator_class("h-1.5 rounded-full bg-muted")
        .range_class("h-1.5 rounded-full bg-chart-1")
        .thumb_class("size-4 rounded-full bg-primary")
        .on_change(move |v: &SliderValue| on_change(v.start(), v.end()))
}

/// 原 Electron 界面的卡片与内容宽度。
pub(crate) fn section_card() -> View {
    view()
        .rounded_xl()
        .border_1()
        .border_color(move || theme().border)
        .bg(move || theme().card)
        .p_5()
        .gap_4()
}

pub(crate) fn content_column(max: f32) -> View {
    view().w_full().max_w(px(max)).gap_5()
}

pub(crate) fn icon(name: &'static str, size: f32) -> impl IntoElement + Styled {
    let shapes = match name {
        "check" => r#"<path d="m5 12 4 4L19 6"/>"#,
        "chevron" => r#"<path d="m6 9 6 6 6-6"/>"#,
        "upload" => {
            r#"<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>"#
        }
        "video" => {
            r#"<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>"#
        }
        "link" => {
            r#"<path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l2-2"/>"#
        }
        "captions" => {
            r#"<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 10h2m4 0h6M6 14h6m4 0h2"/>"#
        }
        "document" => {
            r#"<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/>"#
        }
        "tasks" => {
            r#"<path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2M10 6h11M10 12h11M10 18h11"/>"#
        }
        "settings" => {
            r#"<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/>"#
        }
        "sun" => {
            r#"<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>"#
        }
        "back" => r#"<path d="m12 5-7 7 7 7M5 12h14"/>"#,
        _ => r#"<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>"#,
    };
    svg(ImageSrc::svg_markup(&format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{shapes}</svg>"#)))
        .w(px(size)).h(px(size)).flex_shrink(0.0)
}

pub(crate) fn nav_button(
    name: &'static str,
    label: impl IntoReactive<SharedString>,
    selected: impl IntoReactive<bool>,
    on_press: impl Fn() + 'static,
) -> impl IntoElement {
    let selected = selected.into_reactive();
    let bg = selected.clone();
    let fg = selected.clone();
    button()
        .on_press(on_press)
        .h_8()
        .px(px(10.0))
        .flex_row()
        .gap(px(6.0))
        .items_center()
        .justify_center()
        .rounded_md()
        .bg(move || {
            if bg.get() {
                theme().muted
            } else {
                theme().background.opacity(0.0)
            }
        })
        .text_color(move || {
            if fg.get() {
                theme().foreground
            } else {
                theme().muted_foreground
            }
        })
        .hover(|s| s.bg(move || theme().muted))
        .focus(|s| s.outline(px(2.0)).outline_color(move || theme().ring))
        .child(icon(name, 16.0))
        .child(text(label).text_sm())
}

pub(crate) fn theme_button() -> impl IntoElement {
    let mode = signal(0_u8);
    button()
        .h_8()
        .w_8()
        .items_center()
        .justify_center()
        .rounded_md()
        .hover(|s| s.bg(move || theme().muted))
        .on_press(move || {
            let next = (mode.get_untracked() + 1) % 3;
            mode.set(next);
            nsh_core::element::set_color_scheme(match next {
                1 => nsh_core::platform::Appearance::Light,
                2 => nsh_core::platform::Appearance::Dark,
                _ => nsh_core::platform::Appearance::System,
            });
        })
        .child(icon("sun", 16.0))
}

pub(crate) fn logo() -> impl IntoElement {
    use base64::Engine;
    static URI: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD
                .encode(include_bytes!("../../assets/logo.png"))
        )
    });
    image(URI.as_str()).w_8().h_8()
}

pub(crate) fn burn_checkbox() -> impl IntoElement {
    nsh_base::checkbox()
        .checked(crate::store::burn)
        .on_change(|checked: &bool| crate::store::set_burn(*checked))
        .flex_row()
        .items_center()
        .gap_2()
        .indicator_class("size-3.5 border border-input rounded-xs bg-background checked:bg-primary")
        .indicator(when(crate::store::burn, || {
            icon("check", 10.0).text_color(move || theme().primary_foreground)
        }))
        .child(
            text("烧录硬字幕")
                .text_xs()
                .text_color(move || theme().muted_foreground),
        )
}

pub(crate) fn service_select() -> impl IntoElement {
    use nsh_base::{SelectEntry, SelectItem, select};
    select()
        .items(|| {
            crate::store::settings()
                .llm_services
                .into_iter()
                .map(|s| SelectItem::new(s.id, s.name))
                .collect::<Vec<_>>()
        })
        .value(|| {
            Some(SharedString::from(
                crate::store::settings().selected_llm_service_id,
            ))
        })
        .on_change(|value: &Option<SharedString>| {
            if let Some(id) = value {
                crate::store::select_service(id);
            }
        })
        .accessibility_label("模型服务")
        .popup_style(|s| {
            s.p_1()
                .rounded_md()
                .border_1()
                .border_color(move || theme().border)
                .bg(move || theme().popover)
                .shadow_md()
        })
        .item_class("rounded-md focus:bg-accent selected:font-medium")
        .render_item(|item: &SelectEntry| {
            view()
                .px_3()
                .py_2()
                .child(text(item.title.clone()).text_sm())
        })
        .trigger(
            view()
                .w(px(288.0))
                .h_8()
                .px_3()
                .flex_row()
                .items_center()
                .justify_between()
                .border_1()
                .border_color(move || theme().input)
                .rounded_md()
                .child(
                    text(|| {
                        let s = crate::store::settings();
                        s.llm_services
                            .into_iter()
                            .find(|v| v.id == s.selected_llm_service_id)
                            .map(|v| v.name)
                            .unwrap_or_default()
                    })
                    .text_sm(),
                )
                .child(icon("chevron", 14.0)),
        )
}

pub(crate) fn path_input() -> impl IntoElement {
    input()
        .multiline(true)
        .value(crate::store::path_draft)
        .on_change(|v: &str| crate::store::set_path_draft(v.into()))
        .placeholder("本地文件、字幕或视频链接")
        .placeholder_color(|| color(theme().muted_foreground))
        .min_h(px(80.0))
        .px_3()
        .py_2()
        .rounded_md()
        .border_1()
        .border_color(move || theme().input)
        .text_sm()
        .focus(|s| s.border_color(move || theme().ring))
}

pub(crate) fn option_field(
    label: &'static str,
    value: impl Fn() -> String + 'static,
    items: Vec<(&'static str, &'static str)>,
    on_change: impl Fn(String) + 'static,
) -> impl IntoElement {
    use nsh_base::{SelectEntry, SelectItem, select};
    let value = std::rc::Rc::new(value);
    let display = value.clone();
    let names = items.clone();
    view().gap_2().child(text(label).text_sm()).child(
        select()
            .items(
                items
                    .into_iter()
                    .map(|(v, t)| SelectItem::new(v, t))
                    .collect::<Vec<_>>(),
            )
            .value(move || Some(SharedString::from(value())))
            .on_change(move |next: &Option<SharedString>| {
                if let Some(v) = next {
                    on_change(v.to_string());
                }
            })
            .popup_style(|s| {
                s.p_1()
                    .rounded_md()
                    .border_1()
                    .border_color(move || theme().border)
                    .bg(move || theme().popover)
                    .shadow_md()
            })
            .render_item(|item: &SelectEntry| {
                view()
                    .px_3()
                    .py_2()
                    .child(text(item.title.clone()).text_sm())
            })
            .trigger(
                view()
                    .h_8()
                    .px_3()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .border_1()
                    .border_color(move || theme().input)
                    .rounded_md()
                    .child(
                        text(move || {
                            let v = display();
                            names
                                .iter()
                                .find(|(key, _)| *key == v)
                                .map(|(_, t)| t.to_string())
                                .unwrap_or(v)
                        })
                        .text_sm(),
                    )
                    .child(icon("chevron", 14.0)),
            ),
    )
}
