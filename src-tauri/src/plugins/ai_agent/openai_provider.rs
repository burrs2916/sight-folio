// project-sight: OpenAI 兼容 Provider
// 支持 OpenAI Completions / Anthropic Messages / OpenAI Responses 三种 API 格式
// 从 biosphere-terminal-app 移植并适配

use async_trait::async_trait;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::provider::*;

/// SSE 单行的处理结果（`chat_stream` 与 `chat_stream_incremental` 共用同一套解析，
/// 避免两条路径解析逻辑分叉——历史上假流式与真流式各写一份是最典型的行为漂移来源）
enum SseLine {
    /// 空行 / event: 行 / 非 data 行 / JSON 解析失败 —— 跳过
    Skip,
    /// `data: [DONE]` —— 流正常结束
    Done,
    Chunk(ChatChunk),
}

pub struct OpenAiCompatProvider {
    config: ProviderConfig,
    client: Client,
}

impl OpenAiCompatProvider {
    pub fn new(config: ProviderConfig) -> Self {
        OpenAiCompatProvider {
            config,
            client: Client::new(),
        }
    }

    fn build_chat_url(&self) -> String {
        crate::plugins::ai_agent::provider::chat_url_for(&self.config.base_url, &self.config.api_type)
    }

    fn build_auth_header(&self) -> (String, String) {
        crate::plugins::ai_agent::provider::auth_header_for(
            &self.config.auth_type,
            &self.config.custom_auth_header,
            &self.config.api_key,
        )
    }

    fn build_chat_body(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
        stream: bool,
    ) -> Value {
        if self.config.api_type == "anthropic-messages" {
            return self.build_anthropic_body(messages, options, stream);
        }

        let msgs: Vec<Value> = messages
            .iter()
            .map(|m| {
                let mut msg = json!({
                    "role": m.role,
                    "content": m.content,
                });
                if let Some(ref tcs) = m.tool_calls {
                    msg["tool_calls"] = json!(tcs.iter().map(|tc| {
                        json!({
                            "id": tc.id,
                            "type": tc.call_type,
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            }
                        })
                    }).collect::<Vec<_>>());
                }
                if let Some(ref tcid) = m.tool_call_id {
                    msg["tool_call_id"] = json!(tcid);
                }
                msg
            })
            .collect();

        let mut body = json!({
            "model": options.model,
            "messages": msgs,
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
            "stream": stream,
        });

        if let Some(ref tools) = options.tools {
            body["tools"] = json!(tools);
        }

        body
    }

    fn build_anthropic_body(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
        stream: bool,
    ) -> Value {
        let system_msg = messages.iter().find(|m| m.role == "system").map(|m| m.content.clone());
        let non_system: Vec<Value> = messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let mut body = json!({
            "model": options.model,
            "messages": non_system,
            "max_tokens": options.max_tokens,
            "stream": stream,
        });

        if let Some(sys) = system_msg {
            body["system"] = json!(sys);
        }

        if let Some(ref tools) = options.tools {
            body["tools"] = json!(tools.iter().map(|t| {
                json!({
                    "name": t.function.name,
                    "description": t.function.description,
                    "input_schema": t.function.parameters,
                })
            }).collect::<Vec<_>>());
        }

        body
    }

    fn parse_anthropic_response(&self, json: &Value) -> Result<ChatResponse, String> {
        let stop_reason = json["stop_reason"].as_str().map(|s| match s {
            "end_turn" => "stop".to_string(),
            "max_tokens" => "length".to_string(),
            other => other.to_string(),
        });

        let mut content_parts = Vec::new();
        let mut tool_calls = Vec::new();

        if let Some(blocks) = json["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(text) = block["text"].as_str() {
                            content_parts.push(text.to_string());
                        }
                    }
                    Some("tool_use") => {
                        tool_calls.push(ToolCall {
                            id: block["id"].as_str().unwrap_or("").to_string(),
                            call_type: "function".to_string(),
                            function: FunctionCall {
                                name: block["name"].as_str().unwrap_or("").to_string(),
                                arguments: block["input"].to_string(),
                            },
                        });
                    }
                    _ => {}
                }
            }
        }

        Ok(ChatResponse {
            role: "assistant".to_string(),
            content: if content_parts.is_empty() {
                None
            } else {
                Some(content_parts.join(""))
            },
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
            finish_reason: stop_reason,
        })
    }

    /// 解析 SSE 单行 → chunk。语义与改造前 `chat_stream` 内联逻辑逐字一致：
    /// 空行跳过、anthropic 的 `event: ` 行跳过、非 `data: ` 行跳过、`[DONE]` 结束、
    /// JSON 坏行跳过；openai 分支即使 delta 为空也产出一个 chunk（保持原行为）。
    fn parse_sse_line(&self, raw: &str) -> SseLine {
        let line = raw.trim();
        if line.is_empty() {
            return SseLine::Skip;
        }
        // Anthropic SSE: skip event: lines
        if self.config.api_type == "anthropic-messages" && line.starts_with("event: ") {
            return SseLine::Skip;
        }
        if !line.starts_with("data: ") {
            return SseLine::Skip;
        }
        let data = &line[6..];
        if data == "[DONE]" {
            return SseLine::Done;
        }
        let json: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => return SseLine::Skip,
        };

        if self.config.api_type == "anthropic-messages" {
            return match self.parse_anthropic_chunk(&json) {
                Some(chunk) => SseLine::Chunk(chunk),
                None => SseLine::Skip,
            };
        }

        let choice = &json["choices"][0];
        let delta = &choice["delta"];

        let content = delta["content"].as_str().map(|s| s.to_string());
        let finish_reason = choice["finish_reason"].as_str().map(|s| s.to_string());

        let tool_calls = delta["tool_calls"].as_array().map(|tc| {
            tc.iter()
                .map(|t| ToolCallDelta {
                    index: t["index"].as_i64().unwrap_or(0) as i32,
                    id: t["id"].as_str().map(|s| s.to_string()),
                    function: if t["function"].is_object() {
                        Some(FunctionCallDelta {
                            name: t["function"]["name"].as_str().map(|s| s.to_string()),
                            arguments: t["function"]["arguments"].as_str().map(|s| s.to_string()),
                        })
                    } else {
                        None
                    },
                })
                .collect()
        });

        SseLine::Chunk(ChatChunk {
            content,
            tool_calls,
            finish_reason,
        })
    }

    fn parse_anthropic_chunk(&self, json: &Value) -> Option<ChatChunk> {
        match json["type"].as_str() {
            Some("content_block_delta") => {
                let delta = &json["delta"];
                match delta["type"].as_str() {
                    Some("text_delta") => Some(ChatChunk {
                        content: delta["text"].as_str().map(|s| s.to_string()),
                        tool_calls: None,
                        finish_reason: None,
                    }),
                    Some("input_json_delta") => Some(ChatChunk {
                        content: None,
                        tool_calls: Some(vec![ToolCallDelta {
                            index: json["index"].as_i64().unwrap_or(0) as i32,
                            id: None,
                            function: Some(FunctionCallDelta {
                                name: None,
                                arguments: delta["partial_json"]
                                    .as_str()
                                    .map(|s| s.to_string()),
                            }),
                        }]),
                        finish_reason: None,
                    }),
                    _ => None,
                }
            }
            Some("message_delta") => {
                let stop_reason = json["delta"]["stop_reason"]
                    .as_str()
                    .map(|s| s.to_string());
                Some(ChatChunk {
                    content: None,
                    tool_calls: None,
                    finish_reason: stop_reason,
                })
            }
            Some("content_block_start") => {
                let content_block = &json["content_block"];
                if content_block["type"].as_str() == Some("tool_use") {
                    Some(ChatChunk {
                        content: None,
                        tool_calls: Some(vec![ToolCallDelta {
                            index: json["index"].as_i64().unwrap_or(0) as i32,
                            id: content_block["id"].as_str().map(|s| s.to_string()),
                            function: Some(FunctionCallDelta {
                                name: content_block["name"].as_str().map(|s| s.to_string()),
                                arguments: None,
                            }),
                        }]),
                        finish_reason: None,
                    })
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn chat(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<ChatResponse, String> {
        let url = self.build_chat_url();
        let body = self.build_chat_body(messages, options, false);
        let (auth_header_name, auth_header_value) = self.build_auth_header();

        let mut req = self
            .client
            .post(&url)
            .header(&auth_header_name, &auth_header_value)
            .header("Content-Type", "application/json");

        if self.config.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let json: Value = response.json().await.map_err(|e| e.to_string())?;

        if self.config.api_type == "anthropic-messages" {
            return self.parse_anthropic_response(&json);
        }

        let choice = &json["choices"][0];
        let message = &choice["message"];

        let content = message["content"].as_str().map(|s| s.to_string());
        let tool_calls: Option<Vec<ToolCall>> = message["tool_calls"]
            .as_array()
            .map(|tc| {
                tc.iter()
                    .map(|t| serde_json::from_value(t.clone()).unwrap_or_else(|_| ToolCall {
                        id: t["id"].as_str().unwrap_or("").to_string(),
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: t["function"]["name"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            arguments: t["function"]["arguments"]
                                .as_str()
                                .unwrap_or("{}")
                                .to_string(),
                        },
                    }))
                    .collect()
            });

        let finish_reason = choice["finish_reason"].as_str().map(|s| s.to_string());

        Ok(ChatResponse {
            role: "assistant".to_string(),
            content,
            tool_calls,
            finish_reason,
        })
    }

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<Vec<ChatChunk>, String> {
        let url = self.build_chat_url();
        let body = self.build_chat_body(messages, options, true);
        let (auth_header_name, auth_header_value) = self.build_auth_header();

        let mut req = self
            .client
            .post(&url)
            .header(&auth_header_name, &auth_header_value)
            .header("Content-Type", "application/json");

        if self.config.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        let response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let text = response.text().await.map_err(|e| e.to_string())?;
        let mut chunks = Vec::new();

        for line in text.lines() {
            match self.parse_sse_line(line) {
                SseLine::Skip => continue,
                SseLine::Done => break,
                SseLine::Chunk(chunk) => chunks.push(chunk),
            }
        }

        Ok(chunks)
    }

    /// 真增量流式：逐网络分片读取 SSE，解析出一个 chunk 就立刻回调。
    ///
    /// 与 `chat_stream` 的本质区别：`chat_stream` 用 `response.text()` **先把整个响应体收完**
    /// 才开始解析回调 —— 那是「假流式」，界面表现为长时间静默后一次性刷出全部文本，
    /// 且期间无法取消（body 已在一次 await 里读到底，token 必然烧到完）。
    /// 本方法在每次读分片前检查取消令牌，置位即 break —— `response` 随即 drop、连接断开，
    /// 服务端停止继续生成，是真正的「点停止就止损」。
    async fn chat_stream_incremental(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
        on_chunk: &(dyn Fn(ChatChunk) + Send + Sync),
        cancel: Option<Arc<AtomicBool>>,
    ) -> Result<(Vec<ChatChunk>, bool), String> {
        let url = self.build_chat_url();
        let body = self.build_chat_body(messages, options, true);
        let (auth_header_name, auth_header_value) = self.build_auth_header();

        let mut req = self
            .client
            .post(&url)
            .header(&auth_header_name, &auth_header_value)
            .header("Content-Type", "application/json");

        if self.config.api_type == "anthropic-messages" {
            req = req.header("anthropic-version", "2023-06-01");
        }

        let mut response = req
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, text));
        }

        let mut chunks: Vec<ChatChunk> = Vec::new();
        let mut buf: Vec<u8> = Vec::new();
        let mut cancelled = false;
        let mut done = false;

        'read: loop {
            // 取消检查放在「读下一分片之前」：命中即不再读，连接 drop 后上游停止生成
            if let Some(token) = &cancel {
                if token.load(Ordering::SeqCst) {
                    cancelled = true;
                    break 'read;
                }
            }

            let piece = match response.chunk().await {
                Ok(Some(p)) => p,
                Ok(None) => break 'read, // 流自然结束（未见 [DONE] 也照常收尾）
                Err(e) => return Err(format!("stream error: {}", e)),
            };
            buf.extend_from_slice(&piece);

            // SSE 以 \n 分隔。只处理「完整行」，残段留在缓冲区等下一分片 ——
            // 网络分片边界会切断 UTF-8 字符与 JSON，逐行攒齐才能安全解析。
            while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
                let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line_bytes);
                match self.parse_sse_line(&line) {
                    SseLine::Skip => {}
                    SseLine::Done => {
                        done = true;
                        break 'read;
                    }
                    SseLine::Chunk(chunk) => {
                        on_chunk(chunk.clone());
                        chunks.push(chunk);
                    }
                }
            }
        }

        // 收尾：部分服务端最后一行不补换行符，缓冲区残段也要解析一次
        if !done && !cancelled && !buf.is_empty() {
            let line = String::from_utf8_lossy(&buf);
            if let SseLine::Chunk(chunk) = self.parse_sse_line(&line) {
                on_chunk(chunk.clone());
                chunks.push(chunk);
            }
        }

        Ok((chunks, cancelled))
    }

    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String> {
        if config.base_url.is_empty() {
            return Err("Base URL is required".to_string());
        }
        if config.auth_type == "custom" && config.custom_auth_header.is_empty() {
            return Err("Custom auth header name is required when auth type is 'custom'".to_string());
        }
        Ok(())
    }
}
