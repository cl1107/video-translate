//! 应用自有的 styled 控件，建立在无外观的 nsh_base 之上。

use nsh_base::{button, input, progress, slider, switch, theme, SliderValue};
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
        .rounded(move || theme().radius)
        .bg(move || theme().primary)
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
    button()
        .on_press(on_press)
        .h_9()
        .px_4()
        .items_center()
        .justify_center()
        .rounded(move || theme().radius)
        .border_1()
        .border_color(move || theme().border)
        .bg(move || theme().background)
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
        .rounded(move || theme().radius)
        .bg(move || {
            if selected_bg.get() {
                theme().secondary
            } else {
                theme().background.opacity(0.0)
            }
        })
        .active(|s| s.opacity(0.8))
        .child(
            text(label)
                .text_sm()
                .text_color(move || {
                    if selected_fg.get() {
                        theme().foreground
                    } else {
                        theme().muted_foreground
                    }
                }),
        )
}

pub(crate) fn field(placeholder: &'static str, value: impl Fn() -> String + 'static, on_change: impl Fn(&str) + 'static) -> impl IntoElement {
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
        .rounded(move || theme().radius)
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

pub(crate) fn surface() -> View {
    view()
        .flex_1()
        .bg(move || theme().background)
        .text_color(move || theme().foreground)
}

pub(crate) fn card() -> View {
    view()
        .rounded(move || theme().radius)
        .border_1()
        .border_color(move || theme().border)
        .bg(move || theme().card)
        .p_4()
        .gap_3()
}
