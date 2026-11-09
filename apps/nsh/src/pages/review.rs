use nsh_base::{input, nav_page, theme};
use nsh_core::{element::Screen, prelude::*};

use crate::{domain::review::collect_issues, nav, store, ui};

fn header(title: &'static str) -> impl IntoElement {
    view()
        .flex_row()
        .items_center()
        .gap_3()
        .p_3()
        .border_b_1()
        .border_b_color(move || theme().border)
        .child(when(nav::can_go_back, || ui::outline_button("返回", nav::pop)))
        .child(
            text(title)
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(move || theme().foreground),
        )
}

pub(crate) fn review_page(id: String) -> Screen {
    let selected = signal(0_usize);
    let task_id = id.clone();
    nav_page()
        .title("校对工作台")
        .header(header("校对工作台"))
        .child(
            view()
                .flex_1()
                .flex_row()
                .child(
                    view()
                        .w(px(280.0))
                        .border_r_1()
                        .border_r_color(move || theme().border)
                        .child(
                            text({
                                let task_id = task_id.clone();
                                move || {
                                    let Some(task) = store::task_by_id(&task_id) else {
                                        return "任务不存在".into();
                                    };
                                    let issues = collect_issues(
                                        &task.segments,
                                        task.options.subtitle_processing_mode,
                                    );
                                    format!("问题 {} · 共 {} 段", issues.len(), task.segments.len())
                                }
                            })
                            .text_sm()
                            .p_3()
                            .text_color(move || theme().muted_foreground),
                        )
                        .child(scroll().flex_1().child(each(
                            {
                                let task_id = task_id.clone();
                                move || {
                                    store::task_by_id(&task_id)
                                        .map(|task| task.segments)
                                        .unwrap_or_default()
                                }
                            },
                            |segment| segment.id.clone(),
                            move |segment, index| {
                                ui::ghost_button(
                                    move || segment.get().original_text,
                                    move || selected.get() == index.get(),
                                    move || selected.set(index.get_untracked()),
                                )
                            },
                        ))),
                )
                .child(editor(task_id, selected)),
        )
}

fn editor(id: String, selected: Signal<usize>) -> impl IntoElement {
    view()
        .flex_1()
        .p_4()
        .gap_3()
        .child(
            text({
                let id = id.clone();
                move || {
                    current_segment(&id, selected.get())
                        .map(|segment| format!("{:.2}s – {:.2}s", segment.start, segment.end))
                        .unwrap_or_default()
                }
            })
            .text_sm()
            .text_color(move || theme().muted_foreground),
        )
        .child(text("原文").text_sm().font_weight(FontWeight::MEDIUM))
        .child(
            input()
                .multiline(true)
                .value({
                    let id = id.clone();
                    move || {
                        current_segment(&id, selected.get())
                            .map(|segment| segment.original_text)
                            .unwrap_or_default()
                    }
                })
                .on_change({
                    let id = id.clone();
                    move |value: &str| {
                        if let Some(mut segment) = current_segment(&id, selected.get_untracked()) {
                            segment.original_text = value.to_string();
                            store::update_segment(&id, segment);
                        }
                    }
                })
                .min_h(px(80.0))
                .p_3()
                .border_1()
                .border_color(move || theme().input)
                .rounded(move || theme().radius),
        )
        .child(text("译文").text_sm().font_weight(FontWeight::MEDIUM))
        .child(
            input()
                .multiline(true)
                .value({
                    let id = id.clone();
                    move || {
                        current_segment(&id, selected.get())
                            .map(|segment| segment.translated_text.unwrap_or_default())
                            .unwrap_or_default()
                    }
                })
                .on_change({
                    let id = id.clone();
                    move |value: &str| {
                        if let Some(mut segment) = current_segment(&id, selected.get_untracked()) {
                            segment.translated_text = Some(value.to_string());
                            store::update_segment(&id, segment);
                        }
                    }
                })
                .min_h(px(80.0))
                .p_3()
                .border_1()
                .border_color(move || theme().input)
                .rounded(move || theme().radius),
        )
        .child(
            text({
                let id = id.clone();
                move || {
                    let Some(task) = store::task_by_id(&id) else {
                        return String::new();
                    };
                    collect_issues(&task.segments, task.options.subtitle_processing_mode)
                        .into_iter()
                        .map(|issue| format!("{}: {}", issue.kind, issue.message))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            })
            .text_sm()
            .text_color(move || theme().destructive),
        )
        .child(ui::primary_button("保存并重新导出", {
            let id = id.clone();
            move || store::save_review(&id)
        }))
}

fn current_segment(id: &str, index: usize) -> Option<crate::domain::model::Segment> {
    store::task_by_id(id)?.segments.into_iter().nth(index)
}
