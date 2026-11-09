use nsh_base::{button, theme};
use nsh_core::file_dialog::{FileFilter, OpenDialog};
use nsh_core::{
    element::Position,
    prelude::*,
};

use crate::{
    domain::model::{SubtitleProcessingMode, TaskKind, TaskStatus},
    nav,
    store::{self, Panel},
    ui,
};

pub(crate) fn workbench() -> impl IntoElement {
    view()
        .flex_1()
        .bg(move || theme().background)
        .child(header())
        .child(banner())
        .child(when(|| store::panel() == Panel::Add, add_panel))
        .child(when(|| store::panel() == Panel::Tasks, tasks_panel))
        .child(when(|| store::panel() == Panel::Settings, crate::pages::settings_page))
}

fn header() -> impl IntoElement {
    view()
        .flex_row()
        .items_center()
        .justify_between()
        .h_14()
        .px_6()
        .gap_4()
        .border_b_1()
        .border_b_color(move || theme().border)
        .bg(move || theme().card)
        .child(
            view()
                .flex_row()
                .items_center()
                .gap_3()
                .child(
                    text("视频翻译助手")
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(move || theme().foreground),
                )
                .child(
                    view()
                        .flex_row()
                        .gap_1()
                        .child(ui::ghost_button(
                            "字幕",
                            move || store::kind() == TaskKind::Subtitle,
                            || store::set_kind(TaskKind::Subtitle),
                        ))
                        .child(ui::ghost_button(
                            "文稿",
                            move || store::kind() == TaskKind::Document,
                            || store::set_kind(TaskKind::Document),
                        )),
                ),
        )
        .child(
            view()
                .flex_row()
                .items_center()
                .gap_1()
                .child(ui::ghost_button(
                    "添加",
                    move || store::panel() == Panel::Add,
                    || store::set_panel(Panel::Add),
                ))
                .child(ui::ghost_button(
                    "任务",
                    move || store::panel() == Panel::Tasks,
                    || store::set_panel(Panel::Tasks),
                ))
                .child(ui::ghost_button(
                    "设置",
                    move || store::panel() == Panel::Settings,
                    || store::set_panel(Panel::Settings),
                )),
        )
}

fn banner() -> impl IntoElement {
    view().px_6().py_2().child(
        text(move || store::message()).text_sm().text_color(move || theme().chart_2),
    )
}

fn add_panel() -> impl IntoElement {
    view()
        .flex_1()
        .p_6()
        .gap_4()
        .child(
            text(move || {
                if store::kind() == TaskKind::Document {
                    "把音视频整理成 Markdown 文稿"
                } else {
                    "导入本地视频、字幕或在线链接"
                }
            })
            .text_lg()
            .font_weight(FontWeight::SEMIBOLD),
        )
        .child(
            text("路径输入同时服务测试与无对话框环境；本机也可点选文件。")
                .text_sm()
                .text_color(move || theme().muted_foreground),
        )
        .child(
            view()
                .flex_row()
                .items_center()
                .gap_2()
                .child(ui::field(
                    "本地文件、字幕或视频链接",
                    store::path_draft,
                    |value| store::set_path_draft(value.to_string()),
                ))
                .child(ui::primary_button("开始", store::submit_input)),
        )
        .child(
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("选择视频", pick_videos))
                .child(ui::outline_button("导入字幕", pick_subtitles)),
        )
        .child(when(|| store::kind() == TaskKind::Subtitle, processing_row))
}

fn processing_row() -> impl IntoElement {
    view()
        .flex_row()
        .items_center()
        .gap_3()
        .child(ui::ghost_button(
            "仅提取原文",
            move || store::processing() == SubtitleProcessingMode::Extract,
            || store::set_processing(SubtitleProcessingMode::Extract),
        ))
        .child(ui::ghost_button(
            "翻译字幕",
            move || store::processing() == SubtitleProcessingMode::Translate,
            || store::set_processing(SubtitleProcessingMode::Translate),
        ))
        .child(ui::labeled_switch("烧录硬字幕", store::burn, store::set_burn))
}

fn pick_videos() {
    spawn(async {
        let picked = pick_paths(
            OpenDialog::files()
                .multiple(true)
                .filter(FileFilter::new(
                    "视频",
                    ["mp4", "mkv", "mov", "webm", "m4v", "avi", "mp3", "wav", "m4a"],
                ))
                .title("添加视频")
                .button_label("添加"),
        )
        .await;
        if let Ok(Some(paths)) = picked {
            store::add_paths(paths);
        }
    });
}

fn pick_subtitles() {
    spawn(async {
        let picked = pick_paths(
            OpenDialog::files()
                .multiple(true)
                .filter(FileFilter::new("字幕", ["srt", "vtt"]))
                .title("导入字幕")
                .button_label("导入"),
        )
        .await;
        if let Ok(Some(paths)) = picked {
            store::add_paths(paths);
        }
    });
}

fn tasks_panel() -> impl IntoElement {
    view()
        .flex_1()
        .flex_row()
        .child(
            view()
                .w(px(360.0))
                .border_r_1()
                .border_r_color(move || theme().border)
                .child(
                    view()
                        .flex_row()
                        .items_center()
                        .justify_between()
                        .px_4()
                        .py_3()
                        .gap_2()
                        .child(
                            text(move || format!("任务 {}", store::visible_count()))
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM),
                        )
                        .child(when(store::selected_can_reuse, || {
                            view()
                                .flex_row()
                                .gap_1()
                                .child(ui::outline_button("复用到字幕", || {
                                    store::reuse_selected(TaskKind::Subtitle);
                                }))
                                .child(ui::outline_button("复用到文稿", || {
                                    store::reuse_selected(TaskKind::Document);
                                }))
                        }))
                        .child(ui::outline_button("清理已结束", store::delete_finished)),
                )
                .child(
                    virtual_list(store::visible_count, task_row)
                        .keys(store::visible_ids)
                        .estimated_item_size(px(88.0))
                        .flex_1(),
                ),
        )
        .child(task_detail())
}

fn task_row(at: Position) -> impl IntoElement {
    let task = computed(move || store::visible_at(at.index()));
    button()
        .flex_col()
        .items_start()
        .gap_1()
        .px_4()
        .py_3()
        .border_b_1()
        .border_b_color(move || theme().border)
        .bg(move || {
            let selected = store::selected_id();
            match (task.get(), selected) {
                (Some(task), Some(id)) if task.id == id => theme().secondary,
                _ => theme().background,
            }
        })
        .active(|s| s.bg(move || theme().muted))
        .on_press(move || {
            if let Some(task) = task.get_untracked() {
                store::select_task(task.id);
            }
        })
        .child(
            text(move || {
                task.get()
                    .map(|task| task.video_file.name)
                    .unwrap_or_default()
            })
            .text_sm()
            .font_weight(FontWeight::MEDIUM)
            .text_color(move || theme().foreground),
        )
        .child(
            text(move || {
                task.get()
                    .map(|task| {
                        format!(
                            "{} · {}%",
                            task.status.label(),
                            task.progress.round() as i32
                        )
                    })
                    .unwrap_or_default()
            })
            .text_xs()
            .text_color(move || theme().muted_foreground),
        )
        .child(ui::bar_progress(move || {
            task.get().map(|task| task.progress as f32).unwrap_or(0.0)
        }))
}

fn task_detail() -> impl IntoElement {
    view()
        .flex_1()
        .p_6()
        .gap_3()
        .child(when(
            || store::selected_task().is_none(),
            || {
                text("选择左侧任务查看进度、日志与产物")
                    .text_sm()
                    .text_color(move || theme().muted_foreground)
            },
        ))
        .child(when(|| store::selected_task().is_some(), selected_body))
}

fn selected_body() -> impl IntoElement {
    view()
        .flex_1()
        .gap_3()
        .child(
            text(move || {
                store::selected_task()
                    .map(|task| task.video_file.name)
                    .unwrap_or_default()
            })
            .text_lg()
            .font_weight(FontWeight::SEMIBOLD),
        )
        .child(
            text(move || {
                store::selected_task()
                    .map(|task| {
                        format!(
                            "{} · {} 段 · {}",
                            task.status.label(),
                            task.segments.len(),
                            task.error_message.clone().unwrap_or_default()
                        )
                    })
                    .unwrap_or_default()
            })
            .text_sm()
            .text_color(move || theme().muted_foreground),
        )
        .child(ui::bar_progress(move || {
            store::selected_task()
                .map(|task| task.progress as f32)
                .unwrap_or(0.0)
        }))
        .child(
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("暂停", || {
                    if let Some(id) = store::selected_id() {
                        store::pause_task(&id);
                    }
                }))
                .child(ui::outline_button("恢复", || {
                    if let Some(id) = store::selected_id() {
                        store::resume_task(id);
                    }
                }))
                .child(ui::outline_button("重试", || {
                    if let Some(id) = store::selected_id() {
                        store::retry_task(id);
                    }
                }))
                .child(ui::outline_button("删除", || {
                    if let Some(id) = store::selected_id() {
                        store::delete_task(&id);
                    }
                }))
                .child(ui::primary_button("校对工作台", || {
                    if let Some(id) = store::selected_id() {
                        nav::push_review(id);
                    }
                })),
        )
        .child(when(store::selected_can_reuse, || {
            view()
                .flex_row()
                .gap_2()
                .child(ui::outline_button("复用到字幕", || {
                    store::reuse_selected(TaskKind::Subtitle);
                }))
                .child(ui::outline_button("复用到文稿", || {
                    store::reuse_selected(TaskKind::Document);
                }))
        }))
        .child(
            text(move || {
                store::selected_task()
                    .and_then(|task| task.output_artifacts)
                    .map(|art| {
                        format!(
                            "产物目录: {}",
                            art.output_directory
                        )
                    })
                    .unwrap_or_default()
            })
            .text_sm()
            .text_color(move || theme().chart_2),
        )
        .child(
            scroll().flex_1().child(
                text(move || {
                    store::selected_task()
                        .map(|task| {
                            task.logs
                                .iter()
                                .rev()
                                .take(40)
                                .map(|log| format!("[{}] {}", log.level, log.message))
                                .collect::<Vec<_>>()
                                .join("\n")
                        })
                        .unwrap_or_default()
                })
                .text_sm()
                .text_color(move || theme().muted_foreground),
            ),
        )
}

#[allow(dead_code)]
fn status_color(status: TaskStatus) -> bool {
    status == TaskStatus::Completed
}
