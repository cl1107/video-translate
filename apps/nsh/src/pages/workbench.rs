use nsh_base::{button, theme};
use nsh_core::file_dialog::{FileFilter, OpenDialog};
use nsh_core::{element::Position, prelude::*};

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
        .child(when(|| store::panel() != Panel::Settings, header))
        .child(banner())
        .child(when(|| store::panel() == Panel::Add, add_panel))
        .child(when(|| store::panel() == Panel::Tasks, tasks_panel))
        .child(when(
            || store::panel() == Panel::Settings,
            crate::pages::settings_page,
        ))
}

fn header() -> impl IntoElement {
    view()
        .h_14()
        .border_b_1()
        .border_b_color(move || theme().border)
        .bg(move || theme().card)
        .window_drag(true)
        .items_center()
        .child(
            view()
                .w_full()
                .max_w(px(1024.0))
                .h_full()
                .px_6()
                .flex_row()
                .items_center()
                .justify_between()
                .gap_4()
                .pl(move || {
                    px(if window().width.0 < 1150.0 {
                        nsh_core::element::desktop::title_bar().left.0.max(24.0)
                    } else {
                        24.0
                    })
                })
                .child(
                    view()
                        .flex_row()
                        .items_center()
                        .gap_3()
                        .child(ui::logo())
                        .child(
                            text("视频翻译助手")
                                .text_base()
                                .font_weight(FontWeight::SEMIBOLD),
                        )
                        .child(view().w(px(1.0)).h_5().bg(move || theme().border))
                        .child(ui::nav_button(
                            "captions",
                            "字幕",
                            || store::kind() == TaskKind::Subtitle,
                            || store::set_kind(TaskKind::Subtitle),
                        ))
                        .child(ui::nav_button(
                            "document",
                            "文稿",
                            || store::kind() == TaskKind::Document,
                            || store::set_kind(TaskKind::Document),
                        )),
                )
                .child(
                    view()
                        .flex_row()
                        .gap_3()
                        .items_center()
                        .child(
                            view()
                                .flex_row()
                                .gap(px(2.0))
                                .p(px(3.0))
                                .rounded_lg()
                                .bg(move || theme().muted)
                                .child(ui::nav_button(
                                    "upload",
                                    "添加",
                                    || store::panel() == Panel::Add,
                                    || store::set_panel(Panel::Add),
                                ))
                                .child(ui::nav_button(
                                    "tasks",
                                    move || {
                                        if store::visible_count() > 0 {
                                            format!("任务  {}", store::visible_count())
                                        } else {
                                            "任务".into()
                                        }
                                    },
                                    || store::panel() == Panel::Tasks,
                                    || store::set_panel(Panel::Tasks),
                                )),
                        )
                        .child(view().w(px(1.0)).h_5().bg(move || theme().border))
                        .child(ui::theme_button())
                        .child(ui::nav_button(
                            "settings",
                            "设置",
                            || false,
                            || store::set_panel(Panel::Settings),
                        )),
                ),
        )
}

fn banner() -> impl IntoElement {
    when(
        || !store::message().is_empty(),
        || {
            view().items_center().px_6().pt_3().child(
                view()
                    .w_full()
                    .max_w(px(976.0))
                    .rounded_md()
                    .bg(move || theme().muted)
                    .px_4()
                    .py_2()
                    .child(
                        text(store::message)
                            .text_sm()
                            .text_color(move || theme().foreground),
                    ),
            )
        },
    )
}

fn add_panel() -> impl IntoElement {
    let dragging = signal(false);
    scroll().flex_1().child(view().items_center().px_6().py_6()
        .child(ui::content_column(672.0)
            .child(view().gap_1()
                .child(text(move || if store::kind()==TaskKind::Document {"添加要整理的音视频"} else {"添加要生成字幕的视频"}).text_lg().font_weight(FontWeight::SEMIBOLD))
                .child(text(move || if store::kind()==TaskKind::Document {"本地文件或在线链接，识别语音并整理为 Markdown 文稿"} else {"本地文件或在线链接，识别后生成字幕；可翻译或仅提取原文"}).text_sm().text_color(move || theme().muted_foreground)))
            .child(view().flex_row().items_center().gap_3()
                .child(text("模型服务").text_sm().font_weight(FontWeight::MEDIUM))
.child(ui::service_select())
                .child(ui::outline_button("管理服务",||store::set_panel(Panel::Settings))))
            .child(when(|| store::kind()==TaskKind::Subtitle, processing_row))
            .child(ui::section_card().border_dashed().items_center().py_8().gap_3()
                .border_color(move || if dragging.get() {theme().ring} else {theme().border})
                .on_file_drag_enter(move |_: &()| dragging.set(true))
                .on_file_drag_leave(move |_: &()| dragging.set(false))
                .on_file_drop(move |event: &nsh_core::element::FileDropEvent| {
                    dragging.set(false);
                    let paths=event.uris.iter().filter_map(|uri| {
                        let raw=uri.strip_prefix("file://")?;
                        let mut bytes=Vec::new();let raw=raw.as_bytes();let mut i=0;
                        while i<raw.len() { if raw[i]==b'%' && i+2<raw.len() {
                            let hex=std::str::from_utf8(&raw[i+1..i+3]).ok()?;bytes.push(u8::from_str_radix(hex,16).ok()?);i+=3;
                        } else {bytes.push(raw[i]);i+=1;} }
                        Some(std::path::PathBuf::from(String::from_utf8(bytes).ok()?))
                    }).collect();store::add_paths(paths);
                })
                .child(ui::icon("upload",40.0).text_color(move || theme().muted_foreground))
                .child(text(move || if dragging.get(){"释放以添加文件"} else if store::kind()==TaskKind::Document {"拖拽音视频到此处"} else {"拖拽视频到此处"}).text_base().font_weight(FontWeight::SEMIBOLD))
                .child(text("MP4 / AVI / MOV / MKV / WebM · MP3 / WAV / M4A").text_sm().text_color(move || theme().muted_foreground))
                .child(ui::primary_button("选择文件",pick_videos)))
            .child(view().flex_row().gap_3().items_center()
                .child(view().flex_1().h(px(1.0)).bg(move || theme().border))
                .child(text("或使用在线链接").text_xs().text_color(move || theme().muted_foreground))
                .child(view().flex_1().h(px(1.0)).bg(move || theme().border)))
            .child(ui::section_card().gap_3()
                .child(view().flex_row().gap_2().items_start()
                    .child(ui::icon("link",16.0).text_color(move || theme().muted_foreground))
                    .child(view().gap_1().child(text("在线视频链接").text_sm().font_weight(FontWeight::SEMIBOLD))
                        .child(text("支持 YouTube、B 站等 yt-dlp 站点，也可粘贴本地文件路径").text_xs().text_color(move || theme().muted_foreground))))
                .child(ui::path_input())
                .child(view().flex_row().items_center().justify_between()
                    .child(ui::outline_button("导入字幕",pick_subtitles))
                    .child(ui::primary_button("开始",store::submit_input))))))
}

fn processing_row() -> impl IntoElement {
    ui::section_card()
        .p_3()
        .gap_2()
        .child(
            view()
                .flex_row()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    view()
                        .flex_row()
                        .gap(px(2.0))
                        .p(px(2.0))
                        .bg(move || theme().muted)
                        .rounded_lg()
                        .child(ui::ghost_button(
                            "翻译字幕",
                            || store::processing() == SubtitleProcessingMode::Translate,
                            || store::set_processing(SubtitleProcessingMode::Translate),
                        ))
                        .child(ui::ghost_button(
                            "仅提取原文",
                            || store::processing() == SubtitleProcessingMode::Extract,
                            || store::set_processing(SubtitleProcessingMode::Extract),
                        )),
                )
                .child(ui::burn_checkbox()),
        )
        .child(
            text(move || {
                if store::processing() == SubtitleProcessingMode::Extract {
                    "只生成原文 SRT，无需模型服务"
                } else {
                    "生成原文 / 译文 / 双语 · 需配置模型服务"
                }
            })
            .text_xs()
            .text_color(move || theme().muted_foreground),
        )
}

fn pick_videos() {
    spawn(async {
        let picked = pick_paths(
            OpenDialog::files()
                .multiple(true)
                .filter(FileFilter::new(
                    "视频",
                    [
                        "mp4", "mkv", "mov", "webm", "m4v", "avi", "mp3", "wav", "m4a",
                    ],
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
    view().flex_1().items_center().px_6().py_6().child(
        view()
            .w_full()
            .max_w(px(976.0))
            .flex_1()
            .gap_4()
            .child(
                view()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .child(
                        text(move || {
                            if store::kind() == TaskKind::Document {
                                "文稿任务"
                            } else {
                                "翻译任务"
                            }
                        })
                        .text_lg()
                        .font_weight(FontWeight::SEMIBOLD),
                    )
                    .child(
                        view()
                            .flex_row()
                            .gap_2()
                            .child(ui::outline_button("导入字幕", pick_subtitles))
                            .child(ui::outline_button("清理已结束", store::delete_finished)),
                    ),
            )
            .child(when(
                || store::visible_count() == 0,
                || {
                    ui::section_card()
                        .items_center()
                        .py_10()
                        .gap_3()
                        .child(ui::icon("video", 36.0).text_color(move || theme().muted_foreground))
                        .child(
                            text("暂无翻译任务")
                                .text_base()
                                .font_weight(FontWeight::SEMIBOLD),
                        )
                        .child(
                            text("添加本地视频或在线链接，开始第一个任务")
                                .text_sm()
                                .text_color(move || theme().muted_foreground),
                        )
                        .child(ui::primary_button("去添加视频", || {
                            store::set_panel(Panel::Add)
                        }))
                },
            ))
            .child(
                virtual_list(store::visible_count, task_row)
                    .keys(store::visible_ids)
                    .estimated_item_size(px(124.0))
                    .flex_1(),
            ),
    )
}

fn task_row(at: Position) -> impl IntoElement {
    let task = computed(move || store::visible_at(at.index()));
    view().pb_3().child(
        ui::section_card()
            .p_4()
            .gap_3()
            .child(
                button()
                    .flex_row()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .w_full()
                    .on_press(move || {
                        if let Some(t) = task.get_untracked() {
                            store::select_task(t.id);
                        }
                    })
                    .child(ui::icon("video", 20.0).text_color(move || theme().muted_foreground))
                    .child(
                        view()
                            .flex_1()
                            .gap_1()
                            .child(
                                text(move || {
                                    task.get().map(|t| t.video_file.name).unwrap_or_default()
                                })
                                .text_sm()
                                .font_weight(FontWeight::SEMIBOLD),
                            )
                            .child(
                                text(move || {
                                    task.get()
                                        .map(|t| {
                                            format!(
                                                "{}  ·  {} 段  ·  {} → {}",
                                                t.created_at.format("%m-%d %H:%M"),
                                                t.segments.len(),
                                                t.source_language,
                                                t.target_language
                                            )
                                        })
                                        .unwrap_or_default()
                                })
                                .text_xs()
                                .text_color(move || theme().muted_foreground),
                            ),
                    )
                    .child(
                        view()
                            .px_2()
                            .py_1()
                            .rounded_full()
                            .bg(move || theme().muted)
                            .child(
                                text(move || task.get().map(|t| t.status.label()).unwrap_or(""))
                                    .text_xs()
                                    .text_color(move || theme().foreground),
                            ),
                    ),
            )
            .child(when(
                move || task.get().is_some_and(|t| t.status.is_running()),
                move || {
                    ui::bar_progress(move || task.get().map(|t| t.progress as f32).unwrap_or(0.0))
                },
            ))
            .child(when(
                move || {
                    task.get()
                        .is_some_and(|t| store::selected_id().as_deref() == Some(&t.id))
                },
                || view().gap_3().child(selected_body()),
            )),
    )
}

fn selected_body() -> impl IntoElement {
    let logs = signal(false);
    view()
        .gap_3()
        .child(when(
            || store::selected_task().is_some_and(|t| t.status.is_running()),
            || {
                ui::bar_progress(|| {
                    store::selected_task()
                        .map(|t| t.progress as f32)
                        .unwrap_or(0.0)
                })
            },
        ))
        .child(when(
            || store::selected_task().is_some_and(|t| t.error_message.is_some()),
            || {
                text(|| {
                    store::selected_task()
                        .and_then(|t| t.error_message)
                        .unwrap_or_default()
                })
                .text_sm()
                .text_color(move || theme().destructive)
            },
        ))
        .child(
            view()
                .flex_row()
                .flex_wrap()
                .items_center()
                .gap_2()
                .child(when(
                    || store::selected_task().is_some_and(|t| t.status.is_running()),
                    || {
                        view()
                            .flex_row()
                            .gap_2()
                            .child(ui::outline_button("暂停", || {
                                if let Some(id) = store::selected_id() {
                                    store::pause_task(&id);
                                }
                            }))
                            .child(ui::outline_button("取消", || {
                                if let Some(id) = store::selected_id() {
                                    store::cancel_task(&id);
                                }
                            }))
                    },
                ))
                .child(when(
                    || {
                        store::selected_task().is_some_and(|t| {
                            matches!(t.status, TaskStatus::Paused | TaskStatus::Cancelled)
                        })
                    },
                    || {
                        ui::outline_button("恢复", || {
                            if let Some(id) = store::selected_id() {
                                store::resume_task(id);
                            }
                        })
                    },
                ))
                .child(when(
                    || {
                        store::selected_task().is_some_and(|t| {
                            matches!(t.status, TaskStatus::Failed | TaskStatus::Completed)
                        })
                    },
                    || {
                        ui::outline_button("重试", || {
                            if let Some(id) = store::selected_id() {
                                store::retry_task(id);
                            }
                        })
                    },
                ))
                .child(ui::primary_button("校对工作台", || {
                    if let Some(id) = store::selected_id() {
                        nav::push_review(id);
                    }
                }))
                .child(when(store::selected_can_reuse, || {
                    view()
                        .flex_row()
                        .gap_2()
                        .child(ui::outline_button("复用到字幕", || {
                            store::reuse_selected(TaskKind::Subtitle)
                        }))
                        .child(ui::outline_button("复用到文稿", || {
                            store::reuse_selected(TaskKind::Document)
                        }))
                }))
                .child(ui::outline_button(
                    move || {
                        if logs.get() {
                            "收起日志"
                        } else {
                            "查看日志"
                        }
                    },
                    move || logs.update(|v| *v = !*v),
                ))
                .child(ui::outline_button("删除", || {
                    if let Some(id) = store::selected_id() {
                        store::delete_task(&id);
                    }
                })),
        )
        .child(when(
            || store::selected_task().is_some_and(|t| t.output_artifacts.is_some()),
            || {
                text(|| {
                    store::selected_task()
                        .and_then(|t| t.output_artifacts)
                        .map(|a| format!("产物目录  {}", a.output_directory))
                        .unwrap_or_default()
                })
                .text_xs()
                .text_color(move || theme().muted_foreground)
            },
        ))
        .child(when(
            move || logs.get(),
            || {
                scroll().h(px(160.0)).child(
                    text(|| {
                        store::selected_task()
                            .map(|t| {
                                t.logs
                                    .iter()
                                    .rev()
                                    .take(40)
                                    .map(|log| format!("[{}] {}", log.level, log.message))
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            })
                            .unwrap_or_default()
                    })
                    .text_xs()
                    .text_color(move || theme().muted_foreground),
                )
            },
        ))
}
