use nsh_base::theme;
use nsh_core::prelude::*;

use crate::{
    domain::{model::GlossaryEntry, settings::AppSettings},
    store, ui,
};

pub(crate) fn settings_page() -> impl IntoElement {
    let glossary_source = signal(String::new());
    let glossary_target = signal(String::new());
    let category = signal(0_u8);
    view().flex_1().flex_row()
        .child(view().w(px(224.0)).flex_shrink(0.0).pt_12().px_3().gap_2()
            .border_r_1().border_r_color(move || theme().border).bg(move || theme().card)
            .child(ui::nav_button("back", "返回工作区", || false, || store::set_panel(store::Panel::Add)))
            .child(ui::nav_button("settings", "常规", move || category.get()==0, move || category.set(0)))
            .child(ui::nav_button("document", "模型", move || category.get()==1, move || category.set(1)))
            .child(ui::nav_button("tasks", "系统", move || category.get()==2, move || category.set(2)))
            .child(view().flex_1())
            .child(view().flex_row().items_center().justify_between().py_3().border_t_1().border_t_color(move || theme().border)
                .child(text("外观").text_xs().text_color(move || theme().muted_foreground))
                .child(ui::theme_button())))
        .child(scroll().flex_1().child(view().items_center().p_8()
            .child(ui::content_column(768.0)
                .child(text(move || match category.get(){1=>"模型",2=>"系统",_=>"常规"}).text_size(px(22.0)).font_weight(FontWeight::SEMIBOLD))
                .child(when(move || category.get()==0, move || view().gap_5()
                    .child(ui::section_card().child(text("外观").text_base().font_weight(FontWeight::SEMIBOLD))
                        .child(view().flex_row().items_center().justify_between()
                            .child(text("主题").text_sm())
                            .child(view().flex_row().gap_1().p_1().rounded_lg().bg(move ||theme().muted)
                                .child(ui::outline_button("浅色",||nsh_core::element::set_color_scheme(nsh_core::platform::Appearance::Light)))
                                .child(ui::outline_button("暗色",||nsh_core::element::set_color_scheme(nsh_core::platform::Appearance::Dark)))
                                .child(ui::outline_button("跟随系统",||nsh_core::element::set_color_scheme(nsh_core::platform::Appearance::System))))))
                    .child(ui::section_card().child(text("语言与输出").text_base().font_weight(FontWeight::SEMIBOLD))
                        .child(ui::option_field("目标语言",||store::settings().target_language,vec![("zh","中文"),("en","英语"),("ja","日语"),("ko","韩语"),("fr","法语"),("de","德语"),("es","西班牙语")],|v|patch_settings(|s|s.target_language=v)))
                        .child(ui::option_field("源语言",||store::settings().source_language,vec![("auto","自动检测"),("zh","中文"),("en","英语"),("ja","日语"),("ko","韩语"),("yue","粤语")],|v|patch_settings(|s|s.source_language=v)))
                        .child(ui::option_field("字幕输出位置",|| match store::settings().subtitle_output_location {crate::domain::model::SubtitleOutputLocation::SourceDirectory=>"source".into(),_=>"output".into()},vec![("output","output 子目录（默认）"),("source","源文件同目录")],|v|patch_settings(|s|s.subtitle_output_location=if v=="source" {crate::domain::model::SubtitleOutputLocation::SourceDirectory}else{crate::domain::model::SubtitleOutputLocation::OutputSubdirectory}))))
                    .child(ui::section_card().child(text("字幕颜色").text_base().font_weight(FontWeight::SEMIBOLD))
                        .child(view().flex_row().gap_4()
                            .child(view().flex_1().child(labeled_field("原文颜色","#FFFFFF",||store::settings().original_subtitle_color,|v|patch_settings(|s|s.original_subtitle_color=v))))
                            .child(view().flex_1().child(labeled_field("译文颜色","#FFFF00",||store::settings().translated_subtitle_color,|v|patch_settings(|s|s.translated_subtitle_color=v))))))
                    .child(ui::section_card()
            .child(
                text("术语库")
                    .text_base()
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
            ))))
                .child(when(move || category.get()==1, || view().gap_5()
                    .child(ui::section_card().child(text("模型服务").text_sm().font_weight(FontWeight::SEMIBOLD))
            .child(
                view()
                    .flex_row()
                    .gap_2()
                    .child(each(
                        || store::settings().llm_services,
                        |service| service.id.clone(),
                        |service, _| {
                            ui::ghost_button(
                                move || service.get().name,
                                move || {
                                    store::settings().selected_llm_service_id == service.get().id
                                },
                                move || store::select_service(&service.get_untracked().id),
                            )
                        },
                    ))
                    .child(ui::outline_button("添加模型服务", store::add_service)),
            )
            .child(labeled_field(
                "服务名称",
                "服务名称",
                || {
                    let s = store::settings();
                    s.llm_services
                        .iter()
                        .find(|v| v.id == s.selected_llm_service_id)
                        .map(|v| v.name.clone())
                        .unwrap_or_default()
                },
                |value| {
                    patch_settings(|s| {
                        if let Some(v) = s
                            .llm_services
                            .iter_mut()
                            .find(|v| v.id == s.selected_llm_service_id)
                        {
                            v.name = value;
                        }
                    })
                },
            ))
            .child(labeled_field(
                "模型服务 Endpoint",
                "http://127.0.0.1:11434/v1",
                || store::settings().llm_base_url,
                |value| patch_settings(|settings| settings.llm_base_url = value),
            ))
            .child(
                view()
                    .gap_1()
                    .child(text("API Key（仅存本机，文件权限 600）").text_sm())
                    .child(ui::secret_field(store::api_key, |value| {
                        store::set_api_key(value.to_owned())
                    })),
            )
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
)
                    .child(ui::section_card().child(text("语音识别").text_sm().font_weight(FontWeight::SEMIBOLD))
            .child(
                view()
                    .flex_row()
                    .gap_2()
                    .child(ui::ghost_button(
                        "SenseVoice",
                        || store::settings().asr_engine != "funasr-nano",
                        || patch_settings(|settings| settings.asr_engine = "sensevoice".into()),
                    ))
                    .child(ui::ghost_button(
                        "Fun-ASR-Nano",
                        || store::settings().asr_engine == "funasr-nano",
                        || patch_settings(|settings| settings.asr_engine = "funasr-nano".into()),
                    )),
            )
            .child(
                text("内置 sherpa-onnx 本地识别；模型缺失时点「下载 SenseVoice」。")
                    .text_sm()
                    .text_color(move || theme().muted_foreground),
            )
            .child(ui::labeled_switch(
                "模拟识别（仅供测试）",
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
))))
                .child(when(move || category.get()==2, || ui::section_card().child(text("系统与下载").text_sm().font_weight(FontWeight::SEMIBOLD))
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
))))
}

fn labeled_field(
    label: &'static str,
    placeholder: &'static str,
    value: impl Fn() -> String + 'static,
    on_change: impl Fn(String) + 'static,
) -> impl IntoElement {
    view()
        .gap_1()
        .child(
            text(label)
                .text_sm()
                .text_color(move || theme().muted_foreground),
        )
        .child(ui::field(placeholder, value, move |text| {
            on_change(text.to_string())
        }))
}

fn patch_settings(patch: impl FnOnce(&mut AppSettings)) {
    let mut settings = store::settings();
    patch(&mut settings);
    store::update_settings(settings);
}
