use nsh_base::theme;
use nsh_core::prelude::*;

use crate::{
    domain::{model::GlossaryEntry, settings::AppSettings},
    store,
    ui,
};

pub(crate) fn settings_page() -> impl IntoElement {
    let glossary_source = signal(String::new());
    let glossary_target = signal(String::new());
    scroll().flex_1().child(
        view()
            .p_6()
            .gap_4()
            .child(
                text("设置")
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD),
            )
            .child(
                text("ASR、模型服务与术语库。颜色与输出位置写入本机 settings.json。")
                    .text_sm()
                    .text_color(move || theme().muted_foreground),
            )
            .child(ui::labeled_switch(
                "模拟识别（无 sherpa 时仍可跑通视频路径）",
                || store::settings().mock_asr,
                |value| {
                    let mut settings = store::settings();
                    settings.mock_asr = value;
                    store::update_settings(settings);
                },
            ))
            .child(ui::labeled_switch(
                "模拟翻译",
                || store::settings().mock_llm,
                |value| {
                    let mut settings = store::settings();
                    settings.mock_llm = value;
                    store::update_settings(settings);
                },
            ))
            .child(ui::labeled_switch(
                "识别后润色",
                || store::settings().polish_transcript,
                |value| {
                    let mut settings = store::settings();
                    settings.polish_transcript = value;
                    store::update_settings(settings);
                },
            ))
            .child(labeled_field(
                "模型服务 Endpoint",
                "http://127.0.0.1:11434/v1",
                || store::settings().llm_base_url,
                |value| patch_settings(|settings| settings.llm_base_url = value),
            ))
            .child(labeled_field(
                "API Key（仅存本机 secrets.json）",
                "可选；本地推理可留空",
                store::api_key,
                |value| store::set_api_key(value),
            ))
            .child(labeled_field(
                "翻译模型",
                "qwen2.5:7b",
                || store::settings().translate_model,
                |value| patch_settings(|settings| settings.translate_model = value),
            ))
            .child(labeled_field(
                "润色模型（空=跟随翻译）",
                "",
                || store::settings().polish_model,
                |value| patch_settings(|settings| settings.polish_model = value),
            ))
            .child(labeled_field(
                "源语言",
                "auto",
                || store::settings().source_language,
                |value| patch_settings(|settings| settings.source_language = value),
            ))
            .child(labeled_field(
                "目标语言",
                "zh",
                || store::settings().target_language,
                |value| patch_settings(|settings| settings.target_language = value),
            ))
            .child(labeled_field(
                "原文字幕颜色",
                "#FFFFFF",
                || store::settings().original_subtitle_color,
                |value| patch_settings(|settings| settings.original_subtitle_color = value),
            ))
            .child(labeled_field(
                "译文字幕颜色",
                "#FFFF00",
                || store::settings().translated_subtitle_color,
                |value| patch_settings(|settings| settings.translated_subtitle_color = value),
            ))
            .child(labeled_field(
                "下载代理",
                "127.0.0.1:7890",
                || store::settings().download_proxy,
                |value| patch_settings(|settings| settings.download_proxy = value),
            ))
            .child(
                view()
                    .flex_row()
                    .gap_2()
                    .child(ui::outline_button("系统自检", store::run_system_check))
                    .child(ui::outline_button("测试模型服务", store::list_models))
                    .child(ui::outline_button(
                        "下载 SenseVoice",
                        store::download_sensevoice,
                    )),
            )
            .child(
                text(move || {
                    store::checks()
                        .into_iter()
                        .map(|item| {
                            format!(
                                "{} {} {}",
                                item.name,
                                if item.available { "就绪" } else { "缺失" },
                                item.version.or(item.error).unwrap_or_default()
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .text_sm()
                .text_color(move || theme().muted_foreground),
            )
            .child(
                text("术语库")
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(move || theme().foreground),
            )
            .child(
                text(move || {
                    store::settings()
                        .glossary
                        .into_iter()
                        .map(|entry| format!("{} → {}", entry.source, entry.target))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .text_sm()
                .text_color(move || theme().muted_foreground),
            )
            .child(
                view()
                    .flex_row()
                    .gap_2()
                    .child(ui::field(
                        "原文",
                        move || glossary_source.get(),
                        move |value| glossary_source.set(value.to_string()),
                    ))
                    .child(ui::field(
                        "译文",
                        move || glossary_target.get(),
                        move |value| glossary_target.set(value.to_string()),
                    ))
                    .child(ui::primary_button("添加术语", move || {
                        let source = glossary_source.get_untracked();
                        let target = glossary_target.get_untracked();
                        if source.trim().is_empty() {
                            return;
                        }
                        patch_settings(|settings| {
                            settings.glossary.push(GlossaryEntry { source, target });
                        });
                        glossary_source.set(String::new());
                        glossary_target.set(String::new());
                    })),
            ),
    )
}

fn labeled_field(
    label: &'static str,
    placeholder: &'static str,
    value: impl Fn() -> String + 'static,
    on_change: impl Fn(String) + 'static,
) -> impl IntoElement {
    view()
        .gap_1()
        .child(text(label).text_sm().text_color(move || theme().muted_foreground))
        .child(ui::field(placeholder, value, move |text| on_change(text.to_string())))
}

fn patch_settings(patch: impl FnOnce(&mut AppSettings)) {
    let mut settings = store::settings();
    patch(&mut settings);
    store::update_settings(settings);
}
