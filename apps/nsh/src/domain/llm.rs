use serde_json::{Value, json};

use super::model::GlossaryEntry;

pub trait Completer: Send + Sync {
    fn complete(&self, system: &str, user: &str) -> Result<String, String>;
}

pub struct MockCompleter;

impl Completer for MockCompleter {
    fn complete(&self, system: &str, user: &str) -> Result<String, String> {
        if system.contains("只输出译文") {
            Ok(format!("译：{user}"))
        } else {
            Ok(user.trim().to_string())
        }
    }
}

pub struct OpenAiCompleter {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

pub fn normalize_base_url(raw: &str) -> String {
    let mut url = raw.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return url;
    }
    let lower = url.to_ascii_lowercase();
    if !lower
        .rsplit('/')
        .next()
        .is_some_and(|part| part.starts_with('v') && part[1..].chars().all(|c| c.is_ascii_digit()))
    {
        url.push_str("/v1");
    }
    url
}

impl OpenAiCompleter {
    pub fn new(base_url: &str, api_key: &str, model: &str) -> Result<Self, String> {
        let base_url = normalize_base_url(base_url);
        if base_url.is_empty() {
            return Err("模型服务 Endpoint 不能为空".into());
        }
        if model.trim().is_empty() {
            return Err("模型 ID 不能为空".into());
        }
        Ok(Self {
            base_url,
            api_key: if api_key.trim().is_empty() {
                "local".into()
            } else {
                api_key.trim().into()
            },
            model: model.trim().into(),
        })
    }
}

impl Completer for OpenAiCompleter {
    fn complete(&self, system: &str, user: &str) -> Result<String, String> {
        let url = format!("{}/chat/completions", self.base_url);
        let body = json!({
            "model": self.model,
            "temperature": 0.1,
            "max_tokens": 2000,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        });
        let response = ureq::post(&url)
            .set("Authorization", &format!("Bearer {}", self.api_key))
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|err| format!("模型服务请求失败: {err}"))?;
        let value: Value = response
            .into_json()
            .map_err(|err| format!("解析模型服务响应失败: {err}"))?;
        let content = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(content)
    }
}

pub fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let base = normalize_base_url(base_url);
    if base.is_empty() {
        return Err("Endpoint 为空".into());
    }
    let key = if api_key.trim().is_empty() {
        "local"
    } else {
        api_key.trim()
    };
    let response = ureq::get(&format!("{base}/models"))
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(|err| format!("拉取模型列表失败: {err}"))?;
    let value: Value = response.into_json().map_err(|err| err.to_string())?;
    let mut models = Vec::new();
    if let Some(data) = value.get("data").and_then(Value::as_array) {
        for item in data {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                models.push(id.to_string());
            }
        }
    }
    models.sort();
    models.dedup();
    Ok(models)
}

pub fn translate_system(target: &str, glossary: &[GlossaryEntry]) -> String {
    let mut prompt = format!(
        "你是字幕翻译器。把用户给出的原文译成{target}。只输出译文，不要解释，不要编号。"
    );
    if !glossary.is_empty() {
        prompt.push_str("\n固定译法：\n");
        for entry in glossary {
            if !entry.source.trim().is_empty() {
                prompt.push_str(&format!("- {} => {}\n", entry.source, entry.target));
            }
        }
    }
    prompt
}

pub fn polish_system() -> &'static str {
    "你是语音识别润色器。纠正明显识别错误，保持原意和语言，不要翻译。只输出润色后的文本。"
}

pub fn document_system() -> &'static str {
    "你是文稿整理助手。把口播转录整理为结构清晰的 Markdown，保留事实，不要虚构。"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_v1_suffix() {
        assert_eq!(normalize_base_url("http://127.0.0.1:11434"), "http://127.0.0.1:11434/v1");
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434/v1/"),
            "http://127.0.0.1:11434/v1"
        );
    }
}
