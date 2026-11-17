// sight-folio: AI Agent 核心类型定义
// 参考 biosphere-terminal-app 的 provider.rs，适配 sight-folio 的代码分析场景

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

// ─── 消息与工具调用 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

// ─── 请求选项 ───

#[derive(Debug, Clone)]
pub struct ChatOptions {
    pub model: String,
    pub temperature: f64,
    pub max_tokens: i64,
    pub tools: Option<Vec<ToolDefinition>>,
}

// ─── 工具定义（发送给 LLM 的 schema）───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub def_type: String,
    pub function: ToolFunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

// ─── 响应 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub role: String,
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub finish_reason: Option<String>,
}

// ─── 流式块 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCallDelta>>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallDelta {
    pub index: i32,
    pub id: Option<String>,
    pub function: Option<FunctionCallDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCallDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

// ─── Provider 配置 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub api_key: String,
    pub base_url: String,
    pub api_type: String,
    pub auth_type: String,
    pub custom_auth_header: String,
}

// ─── 共享的请求构造（真实调用与 test_* 命令必须共用，杜绝行为漂移）───
//
// 历史坑：test_endpoint_connection / test_model_chat 曾各自重写 auth_type 匹配与
// api_type→URL 路由，与 `OpenAiCompatProvider` 不同步。结果「测试连接」通过但真实对话
// 失败（或反之），用户感知为「配置的调用都不一致」。这里把两份逻辑收口为同一组函数，
// 任何一边改动都自动同步到另一边。

/// 按 `auth_type` 解析 `(请求头名, 请求头值)`。
/// - `none`：**不需要认证**（本机 Ollama 这类本地服务），返回**空名**表示"一个头都不发"
/// - `x-api-key`：自定义头 `x-api-key`
/// - `custom`：用 `custom_auth_header` 作为头名
/// - 其余（含 `bearer` 与空串/未知值）：`Authorization: Bearer <key>`（OpenAI 兼容默认）
///
/// 为什么要有 `none`：本地服务压根没有 Key 这个概念，以前一律发
/// `Authorization: Bearer `（空串），挂在严格校验的网关后面可能被 401，
/// 界面上还会跟着问一句"未配置 Key"。判定只在这里一处，五个调用点共用
/// （见 [`with_auth_header`]），不许各自发挥。
pub fn auth_header_for(
    auth_type: &str,
    custom_auth_header: &str,
    api_key: &str,
) -> (String, String) {
    match auth_type {
        // 空名 = 不发头。由 with_auth_header 统一解释，别处不得自己判空。
        "none" => (String::new(), String::new()),
        "x-api-key" => ("x-api-key".to_string(), api_key.to_string()),
        "custom" => (custom_auth_header.to_string(), api_key.to_string()),
        _ => ("Authorization".to_string(), format!("Bearer {}", api_key)),
    }
}

/// 把认证头装到请求上：`none`（头名为空）就**原样返回、一个认证头都不加**。
/// 真实对话（含流式/取消）与 `test_endpoint_connection`/`test_model_chat` 全走这里，
/// 这样"测试通过但真实调用失败"那类漂移没有藏身处。
pub fn with_auth_header(
    req: reqwest::RequestBuilder,
    auth_type: &str,
    custom_auth_header: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let (name, value) = auth_header_for(auth_type, custom_auth_header, api_key);
    if name.trim().is_empty() {
        req
    } else {
        req.header(name, value)
    }
}

/// 按 `base_url` + `api_type` 解析聊天请求 URL。
/// - `anthropic-messages` → `<base>/v1/messages`
/// - `openai-responses`   → `<base>/v1/responses`
/// - 其余（含 `openai-completions` 与空串/未知值）→ `<base>/chat/completions`
pub fn chat_url_for(base_url: &str, api_type: &str) -> String {
    let base = base_url.trim_end_matches('/');
    match api_type {
        "anthropic-messages" => format!("{}/v1/messages", base),
        "openai-responses" => format!("{}/v1/responses", base),
        _ => format!("{}/chat/completions", base),
    }
}

// ─── LLM Provider trait ───

#[async_trait]
pub trait LlmProvider: Send + Sync {
    #[allow(dead_code)]
    async fn chat(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<ChatResponse, String>;

    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
    ) -> Result<Vec<ChatChunk>, String>;

    /// 真增量流式：每解析出一个 chunk **立刻**回调（对标 IDE 的逐字吐出），
    /// 并在读取每个网络分片前检查取消令牌 —— 置位即停止读取并断开连接，实质止损 token。
    ///
    /// 返回 `(已收集的全部 chunk, 是否被流内取消)`。
    /// chunk 仍需完整收集：上层要按 index 合并 tool_calls 的 arguments 分片。
    ///
    /// 默认实现回退到 `chat_stream`（收完再一次性回调、不可取消），
    /// 保证任何未覆写本方法的 Provider 行为与改造前完全一致（零回归）。
    ///
    /// 回调按**值**接收 chunk：`async_trait` 会把方法体包成
    /// `Pin<Box<dyn Future + Send + 'async_trait>>`，若回调签名写成 `&ChatChunk`，
    /// 其入参生命周期会被绑到 `'async_trait` 而非高阶（HRTB），导致调用点借用无法在
    /// 本轮循环内释放（E0597/E0505）。按值传是最省事且零歧义的写法。
    async fn chat_stream_incremental(
        &self,
        messages: &[ChatMessage],
        options: &ChatOptions,
        on_chunk: &(dyn Fn(ChatChunk) + Send + Sync),
        _cancel: Option<Arc<AtomicBool>>,
    ) -> Result<(Vec<ChatChunk>, bool), String> {
        let chunks = self.chat_stream(messages, options).await?;
        for chunk in &chunks {
            on_chunk(chunk.clone());
        }
        Ok((chunks, false))
    }

    #[allow(dead_code)]
    fn validate_config(&self, config: &ProviderConfig) -> Result<(), String>;
}

#[cfg(test)]
mod tests {
    use super::{auth_header_for, with_auth_header};

    /// 四种认证方式各自发什么头 —— 这条判据被 5 个调用点共用，改错了是全站一致地错。
    #[test]
    fn auth_四种方式各自发什么() {
        // none = 不需要认证：返回空名，由 with_auth_header 解释成「一个头都不发」
        assert_eq!(
            auth_header_for("none", "", "sk-1"),
            (String::new(), String::new())
        );
        assert_eq!(
            auth_header_for("bearer", "", "sk-1"),
            ("Authorization".to_string(), "Bearer sk-1".to_string())
        );
        assert_eq!(
            auth_header_for("x-api-key", "", "sk-1"),
            ("x-api-key".to_string(), "sk-1".to_string())
        );
        assert_eq!(
            auth_header_for("custom", "X-Auth", "sk-1"),
            ("X-Auth".to_string(), "sk-1".to_string())
        );
        // 空串/未知值仍按 OpenAI 兼容默认走 Bearer：老数据一行没改，行为也不许变
        assert_eq!(
            auth_header_for("", "", "sk-1"),
            ("Authorization".to_string(), "Bearer sk-1".to_string())
        );
    }

    /// `none` 到底有没有真的不发头 —— 直接看装出来的请求里有没有 Authorization。
    #[test]
    fn none_真的一个认证头都不发_bearer_照发() {
        let client = reqwest::Client::new();
        let url = "http://127.0.0.1:11434/v1/models";

        let req = with_auth_header(client.get(url), "none", "", "")
            .build()
            .expect("构造请求不该失败");
        assert!(
            req.headers().get("Authorization").is_none(),
            "本地服务不该收到空 Bearer —— 本地压根没有 Key 这个概念"
        );

        let req2 = with_auth_header(client.get(url), "bearer", "", "sk-1")
            .build()
            .expect("构造请求不该失败");
        let got = req2
            .headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        assert_eq!(
            got.as_deref(),
            Some("Bearer sk-1"),
            "bearer 这一路行为不许变"
        );
    }
}
