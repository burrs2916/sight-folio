// project-sight: Agent Engine — agentic loop + 工具注册
// 参考 biosphere-terminal-app 的 engine.rs，适配 project-sight 的代码分析场景

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

// ─── 工具 trait ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub success: bool,
    pub result: String,
    #[serde(default)]
    pub metadata: Value,
}

#[async_trait]
pub trait AgentTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    async fn execute(&self, params: Value) -> Result<ToolOutput, String>;
}

// ─── 工具注册表 ───

pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        ToolRegistry {
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn AgentTool>> {
        self.tools.get(name)
    }

    pub fn list_definitions(&self) -> Vec<super::provider::ToolDefinition> {
        self.tools
            .iter()
            .map(|(_, tool)| super::provider::ToolDefinition {
                def_type: "function".to_string(),
                function: super::provider::ToolFunctionDef {
                    name: tool.name().to_string(),
                    description: tool.description().to_string(),
                    parameters: tool.parameters(),
                },
            })
            .collect()
    }

    pub fn list_names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    /// 单次调用工具白名单：只保留 `keep` 中（大小写不敏感）已注册的工具。
    /// 与 Agent 配置里的 `tool_ids` 取交集——本函数只在此基础上进一步收窄，
    /// 不会凭空启用 Agent 未授权的工具。
    pub fn filter_keep(&mut self, keep: &[String]) {
        self.tools
            .retain(|name, _| keep.iter().any(|k| k.eq_ignore_ascii_case(name)));
    }
}

// ─── 工具调用事件（通过 Tauri event 推送前端）───

/// 注意 `rename_all = "camelCase"`：本结构体直接被 `serde_json::json!` 塞进 `agent-tool-call`
/// 事件，前端 `ToolCallEvent`（src/services/tauri.ts）读的是 `toolName`。缺这一行就会序列化成
/// `tool_name`，前端拿到 `undefined`——面板把工具步骤渲染成「undefined · running」，
/// 且 `mergeToolCallEvent` 按 `undefined === undefined` 恒真配对，一轮多工具会把 done 合到错误的卡片上。
/// 该字段同时也是落库轨迹（ai_messages.tool_calls）的格式，改名会一起破坏历史回看。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEvent {
    pub tool_name: String,
    pub arguments: Value,
    pub result: Option<String>,
    pub success: Option<bool>,
    pub status: String,
}

/// 把新到达的工具事件合并进轨迹：同一次调用后端会推两次（running 带入参 / done|error 带结果），
/// 直接 push 会得到 2N 条重复步骤。语义与前端孪生实现 `src/utils/toolCallDisplay.ts::mergeToolCallEvent`
/// 保持一致——收尾事件就地更新最后一条同名 running（保留其入参），配不上才追加。
///
/// 引擎是**顺序**执行工具的（running1→done1→running2→done2），所以「最后一条同名 running」
/// 即本次调用，同名工具连调两次也不会错配。
pub fn merge_tool_call_event(list: &mut Vec<ToolCallEvent>, incoming: &ToolCallEvent) {
    if incoming.status == "running" {
        list.push(incoming.clone());
        return;
    }
    if let Some(slot) = list
        .iter_mut()
        .rev()
        .find(|e| e.tool_name == incoming.tool_name && e.status == "running")
    {
        // 收尾事件的 arguments 为 Null，保留 running 时记下的入参
        slot.result = incoming.result.clone();
        slot.success = incoming.success;
        slot.status = incoming.status.clone();
        return;
    }
    list.push(incoming.clone());
}

/// 引擎即将执行需审批的工具（当前仅 `run_command`）时推给前端的审批请求。
/// 字段与 `agent-tool-approval` 事件的 payload 一致；前端据此弹确认框，
/// 用户点「允许 / 拒绝」后调用 `resolve_tool_approval` 落定。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalRequest {
    pub run_id: String,
    pub tool_call_id: String,
    pub tool: String,
    pub command: String,
    pub cwd: String,
}

// ─── Agent Engine ───

pub struct AgentEngine {
    provider: Arc<dyn super::provider::LlmProvider>,
    tools: Arc<Mutex<ToolRegistry>>,
    model: String,
    system_prompt: String,
    temperature: f64,
    max_iterations: i32,
    max_tokens: i64,
}

impl AgentEngine {
    pub fn new(
        provider: Arc<dyn super::provider::LlmProvider>,
        tools: Arc<Mutex<ToolRegistry>>,
        model: String,
        system_prompt: String,
        temperature: f64,
        max_iterations: i32,
    ) -> Self {
        AgentEngine {
            provider,
            tools,
            model,
            system_prompt,
            temperature,
            max_iterations,
            max_tokens: 4096,
        }
    }

    pub async fn run(
        &self,
        user_message: &str,
        history: Vec<super::provider::ChatMessage>,
        run_id: &str,
        cancel: Option<Arc<AtomicBool>>,
        // Send + Sync：文本回调要传进 provider 的增量流式接口并跨 await 使用（真流式的前提）
        on_chunk: impl Fn(String) + Send + Sync,
        on_tool_call: impl Fn(ToolCallEvent),
        // 高危工具（run_command）执行前推给前端求确认；引擎在循环内 await 其结果。
        on_approval: impl Fn(ToolApprovalRequest) + Send + Sync,
    ) -> Result<(String, bool), String> {
        let mut messages: Vec<super::provider::ChatMessage> = Vec::new();

        messages.push(super::provider::ChatMessage {
            role: "system".to_string(),
            content: self.system_prompt.clone(),
            tool_calls: None,
            tool_call_id: None,
        });

        for msg in history {
            if msg.role == "system" {
                continue;
            }
            messages.push(msg);
        }

        messages.push(super::provider::ChatMessage {
            role: "user".to_string(),
            content: user_message.to_string(),
            tool_calls: None,
            tool_call_id: None,
        });

        let tool_defs = {
            let tools = self.tools.lock().await;
            tools.list_definitions()
        };

        let tools_opt = if tool_defs.is_empty() {
            None
        } else {
            Some(tool_defs)
        };

        let mut cancelled = false;
        for _iteration in 0..self.max_iterations {
            // 真取消 · 关口一：每轮迭代前检查令牌，置位则不再发起新请求。
            if let Some(token) = &cancel {
                if token.load(Ordering::SeqCst) {
                    cancelled = true;
                    break;
                }
            }

            let options = super::provider::ChatOptions {
                model: self.model.clone(),
                temperature: self.temperature,
                max_tokens: self.max_tokens,
                tools: tools_opt.clone(),
            };

            // 始终使用流式：分片到达即回调，同时收集 chunks 得到完整响应
            let (response, stream_cancelled) = self
                .chat_stream_collect(&messages, &options, &on_chunk, cancel.clone())
                .await?;

            let assistant_msg = super::provider::ChatMessage {
                role: "assistant".to_string(),
                content: response.content.clone().unwrap_or_default(),
                tool_calls: response.tool_calls.clone(),
                tool_call_id: None,
            };
            messages.push(assistant_msg);

            // 真取消 · 关口二：流内被中止。保留已吐出的部分文本（对标 VS Code 停止后留半截回答），
            // 但绝不执行本轮的 tool_calls —— 用户已经喊停，不该再有任何副作用。
            if stream_cancelled {
                cancelled = true;
                break;
            }

            match &response.tool_calls {
                Some(tool_calls) if !tool_calls.is_empty() => {
                    // 执行工具调用，将结果追加到消息列表
                    for tc in tool_calls {
                        // 真取消 · 关口三：每个工具执行前检查令牌。
                        // 一轮里模型可能一次要调 5 个工具（含 apply_change 这种会**写文件**的），
                        // 少了这道关口，用户点了停止之后 AI 仍会把剩余工具全部执行完 —— 停止形同虚设。
                        if let Some(token) = &cancel {
                            if token.load(Ordering::SeqCst) {
                                cancelled = true;
                                break;
                            }
                        }

                        let tool_name = &tc.function.name;
                        let args: Value = serde_json::from_str(&tc.function.arguments)
                            .unwrap_or(Value::Null);

                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: args.clone(),
                            result: None,
                            success: None,
                            status: "running".to_string(),
                        });

                        // ── 审批闸门（human-in-the-loop）──
                        // 仅 run_command 走此闸门：即便助手已授权该工具，每条 shell 命令仍须用户在 UI
                        // 确认（对标 VS Code Agent「Run command?」拦截）。其余工具保持原行为，零回归。
                        let approved = if tool_name == "run_command" {
                            let cmd = args
                                .get("command")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let sub = args
                                .get("cwd")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let key = format!("{}:{}", run_id, tc.id);
                            let mut rx =
                                crate::plugins::ai_agent::register_approval(&key);
                            on_approval(ToolApprovalRequest {
                                run_id: run_id.to_string(),
                                tool_call_id: tc.id.clone(),
                                tool: tool_name.clone(),
                                command: cmd.to_string(),
                                cwd: sub.to_string(),
                            });
                            // 等待前端落定；超时(5min)/取消/通道异常一律按「拒绝」（安全默认，绝不静默执行）。
                            let timeout = Duration::from_secs(300);
                            let start = tokio::time::Instant::now();
                            let mut decision = false;
                            loop {
                                if let Some(token) = &cancel {
                                    if token.load(Ordering::SeqCst) {
                                        break;
                                    }
                                }
                                if start.elapsed() >= timeout {
                                    break;
                                }
                                match rx.try_recv() {
                                    Ok(d) => {
                                        decision = d;
                                        break;
                                    }
                                    Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                                        // 尚未落定：让出 200ms 再查，期间可响应取消/超时
                                        tokio::time::sleep(Duration::from_millis(200)).await;
                                    }
                                    Err(_) => {
                                        // 发送端被丢弃（前端异常）：按拒绝处理
                                        decision = false;
                                        break;
                                    }
                                }
                            }
                            crate::plugins::ai_agent::clear_approval(&key);
                            decision
                        } else {
                            true
                        };

                        if !approved {
                            let denied = "[run_command] DENIED by user — command was not executed."
                                .to_string();
                            on_tool_call(ToolCallEvent {
                                tool_name: tool_name.clone(),
                                arguments: Value::Null,
                                result: Some(denied.clone()),
                                success: Some(false),
                                status: "denied".to_string(),
                            });
                            messages.push(super::provider::ChatMessage {
                                role: "tool".to_string(),
                                content: denied,
                                tool_calls: None,
                                tool_call_id: Some(tc.id.clone()),
                            });
                            continue;
                        }

                        let tool_result = {
                            let tools = self.tools.lock().await;
                            if let Some(tool) = tools.get(tool_name) {
                                tool.execute(args).await.unwrap_or_else(|e| ToolOutput {
                                    success: false,
                                    result: format!("Error: {}", e),
                                    metadata: Value::Null,
                                })
                            } else {
                                ToolOutput {
                                    success: false,
                                    result: format!("Tool '{}' not found", tool_name),
                                    metadata: Value::Null,
                                }
                            }
                        };

                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: Value::Null,
                            result: Some(tool_result.result.clone()),
                            success: Some(tool_result.success),
                            status: if tool_result.success {
                                "done".to_string()
                            } else {
                                "error".to_string()
                            },
                        });

                        messages.push(super::provider::ChatMessage {
                            role: "tool".to_string(),
                            content: tool_result.result,
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                        });
                    }
                    // 工具执行途中被取消：不再进入下一轮推理（消息完整性无需顾虑，本次运行到此结束）
                    if cancelled {
                        break;
                    }
                    // 继续循环，让 LLM 根据工具结果继续推理
                }
                _ => {
                    // 没有工具调用，LLM 给出了最终回答
                    break;
                }
            }
        }

        // 返回最后一条 assistant 消息的 content，并标记是否被取消
        let content = messages
            .iter()
            .rev()
            .find(|m| m.role == "assistant")
            .map(|m| m.content.clone())
            .unwrap_or_default();
        Ok((content, cancelled))
    }

    /// 流式调用 LLM 并通过 on_chunk 回调推送文本，同时收集完整响应。
    ///
    /// 走 provider 的 `chat_stream_incremental`：**文本在网络分片到达的当刻就回调出去**
    /// （对标 IDE 的逐字吐出），而不是等整个响应体收完再一次性重放。
    /// 返回 `(响应, 是否被流内取消)`；取消时 content 是「已吐出的部分文本」，会被保留。
    async fn chat_stream_collect(
        &self,
        messages: &[super::provider::ChatMessage],
        options: &super::provider::ChatOptions,
        on_chunk: &(impl Fn(String) + Send + Sync),
        cancel: Option<Arc<AtomicBool>>,
    ) -> Result<(super::provider::ChatResponse, bool), String> {
        // 增量回调：只推有内容的文本分片；tool_calls 分片仍靠下方全量合并
        let emit = |chunk: super::provider::ChatChunk| {
            if let Some(text) = chunk.content {
                if !text.is_empty() {
                    on_chunk(text);
                }
            }
        };
        let (chunks, cancelled) = self
            .provider
            .chat_stream_incremental(messages, options, &emit, cancel)
            .await?;

        let mut content_parts = Vec::new();
        let mut finish_reason = None;

        // 收集 tool_calls（按 index 合并 arguments）
        let mut tool_call_map: HashMap<i32, (Option<String>, Option<String>, String)> = HashMap::new();

        for chunk in &chunks {
            // 注意：文本已在 emit 里实时推送过，此处只做聚合，绝不能再调 on_chunk（会翻倍）
            if let Some(ref text) = chunk.content {
                content_parts.push(text.clone());
            }
            if chunk.finish_reason.is_some() {
                finish_reason = chunk.finish_reason.clone();
            }
            if let Some(ref tcs) = chunk.tool_calls {
                for tc in tcs {
                    let entry = tool_call_map
                        .entry(tc.index)
                        .or_insert_with(|| (None, None, String::new()));
                    if let Some(ref id) = tc.id {
                        entry.0 = Some(id.clone());
                    }
                    if let Some(ref func) = tc.function {
                        if let Some(ref name) = func.name {
                            entry.1 = Some(name.clone());
                        }
                        if let Some(ref args) = func.arguments {
                            entry.2.push_str(args);
                        }
                    }
                }
            }
        }

        let tool_calls: Option<Vec<super::provider::ToolCall>> = if tool_call_map.is_empty() {
            None
        } else {
            let mut calls = Vec::new();
            let mut indices: Vec<i32> = tool_call_map.keys().cloned().collect();
            indices.sort();
            for idx in indices {
                let (id, name, args) = tool_call_map.get(&idx).unwrap();
                calls.push(super::provider::ToolCall {
                    id: id.clone().unwrap_or_default(),
                    call_type: "function".to_string(),
                    function: super::provider::FunctionCall {
                        name: name.clone().unwrap_or_default(),
                        arguments: if args.is_empty() {
                            "{}".to_string()
                        } else {
                            args.clone()
                        },
                    },
                });
            }
            Some(calls)
        };

        Ok((
            super::provider::ChatResponse {
                role: "assistant".to_string(),
                content: if content_parts.is_empty() {
                    None
                } else {
                    Some(content_parts.join(""))
                },
                tool_calls,
                finish_reason,
            },
            cancelled,
        ))
    }
}
