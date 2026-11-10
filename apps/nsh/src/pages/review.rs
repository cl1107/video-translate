use nsh_base::{TextViewLinkPressEvent, input, nav_page, text_view, theme};
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

fn header(id: String) -> impl IntoElement {
    let title_id = id.clone();
    view()
        .h_14()
        .window_drag(true)
        .border_b_1()
        .border_b_color(move || theme().border)
        .bg(move || theme().card)
        .flex_row()
        .items_center()
        .justify_between()
        .px_6()
        .pl(move || px(nsh_core::element::desktop::title_bar().left.0.max(24.0)))
        .child(
            view()
                .flex_row()
                .items_center()
                .gap_3()
                .child(when(nav::can_go_back, || {
                    ui::nav_button("back", "返回", || false, nav::pop)
                }))
                .child(
                    view()
                        .gap_1()
                        .child(
                            text("字幕校对")
                                .text_base()
                                .font_weight(FontWeight::SEMIBOLD),
                        )
                        .child(
                            text(move || {
                                store::task_by_id(&title_id)
                                    .map(|t| t.video_file.name)
                                    .unwrap_or_default()
                            })
                            .text_xs()
                            .text_color(move || theme().muted_foreground),
                        ),
                ),
        )
        .child(ui::primary_button("导出", move || {
            store::save_review(&id)
        }))
}

pub(crate) fn review_page(id: String) -> Screen {
    let selected = signal(0_usize);
    let task_id = id.clone();
    let player = element_ref();
    let current = signal(0.0_f64);
    let paused = signal(true);
    let duration = signal(0.0_f64);
    nav_page()
        .title("校对工作台")
        .header(header(task_id.clone()))
        .child(
            view().flex_1().items_center().px_6().py_5().child(
                view()
                    .w_full()
                    .max_w(px(1232.0))
                    .flex_1()
                    .flex_row()
                    .gap_5()
                    .child(
                        view()
                            .flex_1()
                            .max_w(px(540.0))
                            .gap_4()
                            .child(ui::section_card().p_0().child(media_block(
                                task_id.clone(),
                                selected,
                                paused,
                                current,
                                duration,
                                player.clone(),
                            )))
                            .child(
                                ui::section_card()
                                    .gap_3()
                                    .child(
                                        text("检查问题")
                                            .text_sm()
                                            .font_weight(FontWeight::SEMIBOLD),
                                    )
                                    .child(
                                        text({
                                            let id = task_id.clone();
                                            move || {
                                                store::task_by_id(&id)
                                                    .map(|t| {
                                                        let issues = collect_issues(
                                                            &t.segments,
                                                            t.options.subtitle_processing_mode,
                                                        );
                                                        if issues.is_empty() {
                                                            format!(
                                                                "暂无问题 · 共 {} 段字幕",
                                                                t.segments.len()
                                                            )
                                                        } else {
                                                            format!(
                                                                "{} 个问题 · 共 {} 段字幕",
                                                                issues.len(),
                                                                t.segments.len()
                                                            )
                                                        }
                                                    })
                                                    .unwrap_or_default()
                                            }
                                        })
                                        .text_xs()
                                        .text_color(move || theme().muted_foreground),
                                    )
                                    .child(
                                        scroll().flex_1().child(
                                            text({
                                                let id = task_id.clone();
                                                move || {
                                                    store::task_by_id(&id)
                                                        .map(|t| {
                                                            collect_issues(
                                                                &t.segments,
                                                                t.options.subtitle_processing_mode,
                                                            )
                                                            .iter()
                                                            .take(12)
                                                            .map(|i| i.message.clone())
                                                            .collect::<Vec<_>>()
                                                            .join("\n")
                                                        })
                                                        .unwrap_or_default()
                                                }
                                            })
                                            .text_sm()
                                            .text_color(move || theme().muted_foreground),
                                        ),
                                    ),
                            ),
                    )
                    .child(
                        view()
                            .flex_1()
                            .gap_3()
                            .child(
                                view()
                                    .flex_row()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        text("字幕段落")
                                            .text_sm()
                                            .font_weight(FontWeight::SEMIBOLD),
                                    )
                                    .child(
                                        text({
                                            let id = task_id.clone();
                                            move || {
                                                store::task_by_id(&id)
                                                    .map(|t| {
                                                        format!(
                                                            "{} / {}",
                                                            selected.get() + 1,
                                                            t.segments.len()
                                                        )
                                                    })
                                                    .unwrap_or_default()
                                            }
                                        })
                                        .text_xs()
                                        .text_color(move || theme().muted_foreground),
                                    ),
                            )
                            .child(
                                view()
                                    .h(px(96.0))
                                    .rounded_lg()
                                    .border_1()
                                    .border_color(move || theme().border)
                                    .child(
                                        virtual_list(
                                            {
                                                let id = task_id.clone();
                                                move || {
                                                    store::task_by_id(&id)
                                                        .map(|t| t.segments.len())
                                                        .unwrap_or(0)
                                                }
                                            },
                                            {
                                                let id = task_id.clone();
                                                let player = player.clone();
                                                move |at: nsh_core::element::Position| {
                                                    let lookup = id.clone();
                                                    let item = computed(move || {
                                                        current_segment(&lookup, at.index())
                                                    });
                                                    let player = player.clone();
                                                    ui::ghost_button(
                                                        move || {
                                                            item.get()
                                                                .map(|s| {
                                                                    format!(
                                                                        "{:.2} – {:.2}   {}",
                                                                        s.start,
                                                                        s.end,
                                                                        s.original_text
                                                                    )
                                                                })
                                                                .unwrap_or_default()
                                                        },
                                                        move || selected.get() == at.index(),
                                                        move || {
                                                            selected.set(at.index());
                                                            if let Some(s) = item.get_untracked() {
                                                                player.seek(s.start);
                                                                current.set(s.start);
                                                                paused.set(true);
                                                            }
                                                        },
                                                    )
                                                }
                                            },
                                        )
                                        .estimated_item_size(px(32.0))
                                        .flex_1(),
                                    ),
                            )
                            .child(scroll().flex_1().child(editor(
                                task_id, selected, player, current, paused, duration,
                            ))),
                    ),
            ),
        )
}

fn editor(
    id: String,
    selected: Signal<usize>,
    player: ElementRef,
    current: Signal<f64>,
    paused: Signal<bool>,
    duration: Signal<f64>,
) -> impl IntoElement {
    ui::section_card()
        .gap_3()
        .child(when(
            {
                let id = id.clone();
                move || {
                    store::task_by_id(&id)
                        .is_some_and(|t| t.kind == crate::domain::model::TaskKind::Document)
                }
            },
            {
                let id = id.clone();
                let player = player.clone();
                move || document_preview(id.clone(), player.clone(), current, paused)
            },
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
        .child(timing_controls(id.clone(), selected, current, duration))
        .child(text("拖改时间轴").text_sm().font_weight(FontWeight::MEDIUM))
        .child({
            let id_start = id.clone();
            let id_end = id.clone();
            let id_max = id.clone();
            let id_change = id.clone();
            ui::range_timeline(
                move || {
                    current_segment(&id_start, selected.get())
                        .map(|s| s.start)
                        .unwrap_or(0.0)
                },
                move || {
                    current_segment(&id_end, selected.get())
                        .map(|s| s.end)
                        .unwrap_or(0.1)
                },
                move || {
                    duration.get().max(
                        store::task_by_id(&id_max)
                            .map(|t| t.segments.iter().map(|s| s.end).fold(1.0_f64, f64::max))
                            .unwrap_or(1.0),
                    )
                },
                move |start, end| {
                    if let Some(mut segment) = current_segment(&id_change, selected.get_untracked())
                    {
                        segment.start = start;
                        segment.end = end;
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
                    let selected_id = task.segments.get(selected.get()).map(|s| s.id.as_str());
                    collect_issues(&task.segments, task.options.subtitle_processing_mode)
                        .into_iter()
                        .filter(|issue| Some(issue.segment_id.as_str()) == selected_id)
                        .map(|issue| format!("{}: {}", issue.kind, issue.message))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
            })
            .text_sm()
            .text_color(move || theme().destructive),
        )
        .child(
            text(store::message)
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
                .child(ui::primary_button(
                    {
                        let id = id.clone();
                        move || {
                            if store::task_by_id(&id)
                                .is_some_and(|t| t.kind == crate::domain::model::TaskKind::Document)
                            {
                                "保存并重新整理"
                            } else {
                                "保存并重新导出"
                            }
                        }
                    },
                    {
                        let id = id.clone();
                        move || store::save_review(&id)
                    },
                )),
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
    let stop_at = signal(None::<f64>);
    view()
        .gap_3()
        .p_4()
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
                    .h(px(260.0))
                    .on_load(move |info: &VideoInfo| {
                        duration.set(info.duration as f64);
                    })
                    .on_end(move |_: &()| paused.set(true))
                    .on_error(|err: &str| store::set_message(format!("媒体无法播放: {err}")))
                    .on_progress(move |progress: &VideoProgress| {
                        let time = progress.current_time as f64;
                        current.set(time);
                        if stop_at.get_untracked().is_some_and(|end| time >= end) {
                            paused.set(true);
                            stop_at.set(None);
                        }
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
                view()
                    .h(px(240.0))
                    .items_center()
                    .justify_center()
                    .gap_3()
                    .bg(move || theme().muted)
                    .rounded_lg()
                    .child(ui::icon("video", 36.0).text_color(move || theme().muted_foreground))
                    .child(
                        text("关联视频以预览字幕")
                            .text_sm()
                            .text_color(move || theme().muted_foreground),
                    )
            },
        ))
        .child(
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("播放/暂停", move || {
                    stop_at.set(None);
                    paused.update(|value| *value = !*value);
                }))
                .child(ui::outline_button("预览此段", {
                    let id = id.clone();
                    let player = player.clone();
                    move || {
                        if let Some(segment) = current_segment(&id, selected.get_untracked()) {
                            player.seek(segment.start);
                            current.set(segment.start);
                            stop_at.set(Some(segment.end));
                            paused.set(false);
                        }
                    }
                }))
                .child(ui::outline_button("关联视频", {
                    let id = id.clone();
                    move || attach_media(id.clone())
                })),
        )
        .child(text(move || format!("{:.3} / {:.3} 秒", current.get(), duration.get())).text_sm())
        .child(
            text({
                let id = id.clone();
                move || {
                    store::task_by_id(&id)
                        .and_then(|t| {
                            t.segments
                                .into_iter()
                                .find(|s| current.get() >= s.start && current.get() < s.end)
                        })
                        .map(|s| s.original_text)
                        .unwrap_or_default()
                }
            })
            .text_sm(),
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

fn timing_controls(
    id: String,
    selected: Signal<usize>,
    current: Signal<f64>,
    _duration: Signal<f64>,
) -> impl IntoElement {
    let start_draft = signal(String::new());
    let end_draft = signal(String::new());
    let lookup = id.clone();
    effect(move || {
        if let Some(s) = current_segment(&lookup, selected.get()) {
            start_draft.set(format!("{:.3}", s.start));
            end_draft.set(format!("{:.3}", s.end));
        }
    });
    view()
        .gap_2()
        .child(
            view()
                .flex_row()
                .gap_2()
                .items_center()
                .child(text("开始（秒）").text_sm())
                .child(ui::field(
                    "开始秒数",
                    move || start_draft.get(),
                    move |v| start_draft.set(v.into()),
                ))
                .child(text("结束（秒）").text_sm())
                .child(ui::field(
                    "结束秒数",
                    move || end_draft.get(),
                    move |v| end_draft.set(v.into()),
                ))
                .child(ui::outline_button("应用时间", {
                    let id = id.clone();
                    move || match (
                        start_draft.get_untracked().parse::<f64>(),
                        end_draft.get_untracked().parse::<f64>(),
                    ) {
                        (Ok(start), Ok(end)) => {
                            store::edit_timing(&id, selected.get_untracked(), start, end)
                        }
                        _ => store::set_message("请输入有效秒数，例如 1.250".into()),
                    }
                })),
        )
        .child(
            view()
                .flex_row()
                .flex_wrap()
                .gap_2()
                .child(ui::outline_button("起点设为播放头", {
                    let id = id.clone();
                    move || {
                        if let Some(s) = current_segment(&id, selected.get_untracked()) {
                            store::edit_timing(
                                &id,
                                selected.get_untracked(),
                                current.get_untracked(),
                                s.end,
                            );
                        }
                    }
                }))
                .child(ui::outline_button("终点设为播放头", {
                    let id = id.clone();
                    move || {
                        if let Some(s) = current_segment(&id, selected.get_untracked()) {
                            store::edit_timing(
                                &id,
                                selected.get_untracked(),
                                s.start,
                                current.get_untracked(),
                            );
                        }
                    }
                }))
                .child(ui::outline_button("播放头处分段", {
                    let id = id.clone();
                    move || {
                        store::cut_segment(
                            &id,
                            selected.get_untracked(),
                            Some(current.get_untracked()),
                        );
                    }
                }))
                .child(ui::outline_button("合并下一段", move || {
                    store::cut_segment(&id, selected.get_untracked(), None)
                })),
        )
}

fn document_preview(
    id: String,
    player: ElementRef,
    current: Signal<f64>,
    paused: Signal<bool>,
) -> impl IntoElement {
    let path = computed(move || {
        store::task_by_id(&id)
            .and_then(|t| t.output_artifacts)
            .and_then(|a| a.polished_markdown)
    });
    let markdown = computed(move || match path.get() {
        Some(path) => match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(err) => format!("读取文稿失败: {err}"),
        },
        None => "文稿尚未生成。".into(),
    });
    text_view()
        .markdown(move || Some(SharedString::from(markdown.get())))
        .selectable(true)
        .on_link_press(move |event: &TextViewLinkPressEvent| {
            if let Some(seconds) = event
                .url
                .strip_prefix("#t=")
                .and_then(|s| s.parse::<f64>().ok())
            {
                if seconds.is_finite() && seconds >= 0.0 {
                    player.seek(seconds);
                    current.set(seconds);
                    paused.set(false);
                }
            }
        })
        .gap_3()
        .text_size(px(14.0))
        .text_color(move || theme().foreground)
}
