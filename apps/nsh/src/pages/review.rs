use nsh_base::{input, nav_page, theme};
use nsh_core::{
    element::Screen,
    file_dialog::{FileFilter, OpenDialog},
    prelude::*,
};

use crate::{
    domain::{
        pipeline::{file_url, is_playable_media},
        review::collect_issues,
    },
    nav, store, ui,
};

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
    let paused = signal(true);
    let current = signal(0.0_f64);
    let duration = signal(0.0_f64);
    let player = element_ref();
    view()
        .flex_1()
        .p_4()
        .gap_3()
        .child(media_block(
            id.clone(),
            selected,
            paused,
            current,
            duration,
            player.clone(),
        ))
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
        .child(text("拖改时间轴").text_sm().font_weight(FontWeight::MEDIUM))
        .child({
            let id_start = id.clone();
            let id_end = id.clone();
            let id_max = id.clone();
            let id_change = id.clone();
            ui::range_timeline(
                move || current_segment(&id_start, selected.get()).map(|s| s.start).unwrap_or(0.0),
                move || current_segment(&id_end, selected.get()).map(|s| s.end).unwrap_or(0.1),
                move || {
                    duration.get().max(
                        current_segment(&id_max, selected.get())
                            .map(|s| s.end)
                            .unwrap_or(1.0),
                    )
                },
                move |start, end| {
                    if let Some(mut segment) = current_segment(&id_change, selected.get_untracked()) {
                        segment.start = start.min(end);
                        segment.end = end.max(start);
                        store::update_segment(&id_change, segment);
                    }
                },
            )
        })
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
                .min_h(px(72.0))
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
                .min_h(px(72.0))
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
        .child(when(
            {
                let id = id.clone();
                move || {
                    store::task_by_id(&id)
                        .is_some_and(|task| crate::domain::pipeline::can_reuse_transcript(&task))
                }
            },
            || {
                view()
                    .flex_row()
                    .gap_2()
                    .child(ui::outline_button("复用到字幕", || {
                        store::reuse_selected(crate::domain::model::TaskKind::Subtitle);
                    }))
                    .child(ui::outline_button("复用到文稿", || {
                        store::reuse_selected(crate::domain::model::TaskKind::Document);
                    }))
            },
        ))
        .child(
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("单段重译", {
                    let id = id.clone();
                    move || {
                        if let Some(segment) = current_segment(&id, selected.get_untracked()) {
                            store::retranslate_current(id.clone(), segment.id);
                        }
                    }
                }))
                .child(ui::primary_button("保存并重新导出", {
                    let id = id.clone();
                    move || store::save_review(&id)
                })),
        )
}

fn media_block(
    id: String,
    selected: Signal<usize>,
    paused: Signal<bool>,
    current: Signal<f64>,
    duration: Signal<f64>,
    player: ElementRef,
) -> impl IntoElement {
    view()
        .gap_2()
        .child(when(
            {
                let id = id.clone();
                move || {
                    store::task_by_id(&id)
                        .is_some_and(|task| is_playable_media(&task.video_file.path))
                }
            },
            {
                let id = id.clone();
                let player = player.clone();
                move || {
                    video({
                        let id = id.clone();
                        move || {
                            store::task_by_id(&id)
                                .map(|task| file_url(&task.video_file.path))
                                .unwrap_or_default()
                        }
                    })
                    .element_ref(&player)
                    .paused(move || paused.get())
                    .h(px(180.0))
                    .on_load(move |info: &VideoInfo| {
                        duration.set(info.duration as f64);
                    })
                    .on_progress(move |progress: &VideoProgress| {
                        current.set(progress.current_time as f64);
                        if progress.duration > 0.0 {
                            duration.set(progress.duration as f64);
                        }
                    })
                }
            },
        ))
        .child(when(
            {
                let id = id.clone();
                move || {
                    store::task_by_id(&id)
                        .is_some_and(|task| !is_playable_media(&task.video_file.path))
                }
            },
            || {
                text("未关联可播放媒体。导入字幕任务可点「关联视频」后同步预览。")
                    .text_sm()
                    .text_color(move || theme().muted_foreground)
            },
        ))
        .child(
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("播放/暂停", move || {
                    paused.update(|value| *value = !*value);
                }))
                .child(ui::outline_button("跳到此段", {
                    let id = id.clone();
                    let player = player.clone();
                    move || {
                        if let Some(segment) = current_segment(&id, selected.get_untracked()) {
                            player.seek(segment.start);
                            current.set(segment.start);
                            paused.set(false);
                        }
                    }
                }))
                .child(ui::outline_button("关联视频", {
                    let id = id.clone();
                    move || attach_media(id.clone())
                })),
        )
        .child(ui::timeline(
            move || current.get(),
            move || duration.get(),
            {
                let player = player.clone();
                move |time| {
                    current.set(time);
                    player.seek(time);
                }
            },
        ))
}

fn attach_media(task_id: String) {
    spawn(async move {
        let picked = pick_paths(
            OpenDialog::files()
                .filter(FileFilter::new(
                    "媒体",
                    ["mp4", "mkv", "mov", "webm", "m4v", "avi", "mp3", "wav"],
                ))
                .title("关联视频")
                .button_label("关联"),
        )
        .await;
        if let Ok(Some(paths)) = picked
            && let Some(path) = paths.into_iter().next()
        {
            store::attach_media(&task_id, path);
        }
    });
}

fn current_segment(id: &str, index: usize) -> Option<crate::domain::model::Segment> {
    store::task_by_id(id)?.segments.into_iter().nth(index)
}
