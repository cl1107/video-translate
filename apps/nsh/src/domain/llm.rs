use serde_json::{Value, json};

use super::model::GlossaryEntry;

pub trait Completer: Send + Sync {
    fn complete(&self, system: &str, user: &str) -> Result<String, String>;
    fn complete_with_model(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        let _ = model;
        self.complete(system, user)
    }
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
        self.complete_with_model(&self.model, system, user)
    }

    fn complete_with_model(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        let url = format!("{}/chat/completions", self.base_url);
        let body = json!({
            "model": if model.trim().is_empty() { &self.model } else { model },
            "temperature": 0.1,
            "max_tokens": 2000,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ]
        });
        let response = ureq::post(&url)
            .timeout(std::time::Duration::from_secs(120))
            .set("Authorization", &format!("Bearer {}", self.api_key))
            .set("Content-Type", "application/json")
            .send_json(body)
            .map_err(|err| format!("模型服务请求失败: {err}"))?;
        let value: Value = response
            .into_json()
            .map_err(|err| format!("解析模型服务响应失败: {err}"))?;
        if value
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str)
            == Some("length")
        {
            return Err("模型服务输出达到长度上限，返回内容不完整".into());
        }
        let content = value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or_else(|| "模型服务响应缺少 choices[0].message.content 文本".to_string())?
            .trim();
        if content.is_empty() {
            return Err("模型服务返回空内容".into());
        }
        Ok(content.to_string())
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
        .timeout(std::time::Duration::from_secs(30))
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
    let mut prompt =
        format!("你是字幕翻译器。把用户给出的原文译成{target}。只输出译文，不要解释，不要编号。");
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

pub fn translate_user(text: &str, glossary: &[GlossaryEntry]) -> String {
    if glossary.is_empty() {
        return text.to_string();
    }
    let mut user = String::from("请只翻译当前这一段。术语优先：\n");
    for entry in glossary {
        if !entry.source.trim().is_empty() {
            user.push_str(&format!("- {} => {}\n", entry.source, entry.target));
        }
    }
    user.push_str("原文：\n");
    user.push_str(text);
    user
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
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434/v1/"),
            "http://127.0.0.1:11434/v1"
        );
    }
    #[test]
    fn rejects_missing_or_truncated_completion_content() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        for body in [
            r#"{"choices":[{"message":{}}]}"#,
            r#"{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}"#,
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut byte = [0; 1];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                let headers = String::from_utf8_lossy(&request);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                let mut payload = vec![0; length];
                socket.read_exact(&mut payload).unwrap();
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            });
            let client =
                OpenAiCompleter::new(&format!("http://{address}"), "key", "model").unwrap();
            let error = client
                .complete("system", "user")
                .expect_err("must reject invalid model response");
            assert!(
                error.contains("响应缺少") || error.contains("长度上限"),
                "unexpected error: {error}"
            );
            server.join().unwrap();
        }
    }
}
