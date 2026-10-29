// sight-folio: Agent Engine — agentic loop + 工具注册
// 参考 biosphere-terminal-app 的 engine.rs，适配 sight-folio 的代码分析场景

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

    /// 审批预告：工具自己说清「将把什么改成什么」，追加在 `approval_summary` 之后。
    ///
    /// 为什么放在工具上而不是 `approval_summary` 里：摘要是纯函数（只看得见入参），
    /// 而 before 值在库里。让工具自己回答，一是它能复用自己的读取与校验口径，
    /// 二是新增写工具时不会漏掉这个能力。默认 `None` = 无额外内容。
    ///
    /// **约定**：实现必须只读、不得落库——它在用户批准之前就会被调用。
    async fn approval_preview(&self, _params: &Value) -> Option<String> {
        None
    }
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

/// 引擎即将执行需审批的工具（run_command / 写入类工具）时推给前端的审批请求。
/// 字段与 `agent-tool-approval` 事件的 payload 一致；前端据此弹确认框，
/// 用户点「允许 / 拒绝」后调用 `resolve_tool_approval` 落定。
/// `command`/`cwd` 仅 run_command 填写；其余工具用 `summary` 展示创作者可读的操作说明。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalRequest {
    pub run_id: String,
    pub tool_call_id: String,
    pub tool: String,
    pub command: String,
    pub cwd: String,
    #[serde(default)]
    pub summary: String,
    /// true = 写入类低危工具，前端展示「本会话不再询问」选项
    #[serde(default)]
    pub session_rememberable: bool,
}

/// 组装审批摘要：静态部分（纯函数，只看得见入参）+ 工具自己算的 before→after 预告。
///
/// 为什么单独成函数：预告的数据在库里（工具去读）、文案骨架在这里。两头都有测试，
/// 但若中间这段拼装没有测试，把调用点删掉也不会翻红——而作者的盲批就会回来。
async fn build_approval_summary(tools: &ToolRegistry, tool_name: &str, args: &Value) -> String {
    let mut summary = approval_summary(tool_name, args);
    if let Some(tool) = tools.get(tool_name) {
        if let Some(extra) = tool.approval_preview(args).await {
            let extra = extra.trim_end();
            if !extra.is_empty() {
                summary.push('\n');
                summary.push_str(extra);
            }
        }
    }
    summary
}

/// 审批策略（按工具危险等级）：执行类逐条确认，写入类低危可会话级记住，
/// 只读工具不拦。对标审核结论「写入类低危可会话级记住，删除类高危逐条确认」。
#[derive(Debug, Clone, Copy, PartialEq)]
enum ApprovalMode {
    /// 不需要审批（只读工具）
    Skip,
    /// 会话级记住：用户勾选后本会话内同类操作不再询问
    SessionOnce,
    /// 每次调用都确认（shell 命令）
    EveryCall,
}

/// 按工具与入参判定审批策略。context_insight 的 `list` 是只读，只有
/// `save`/`resolve` 落库，须按 action 区分。写作域写工具（write_chapter /
/// create_chapter）归写入类低危：正文改写前自动存版本快照、可随时恢复，
/// 与 apply_change 同级走「会话级记住」，不必每次动笔都打断创作者。
fn approval_mode(tool_name: &str, args: &Value) -> ApprovalMode {
    match tool_name {
        "run_command" => ApprovalMode::EveryCall,
        // update_character_card 必须列在这里：本函数 default 是 Skip（不拦），
        // 新写工具忘记登记 = AI 可以静默改写作者的人物卡。
        "apply_change" | "write_chapter" | "create_chapter" | "update_character_card" => {
            ApprovalMode::SessionOnce
        }
        "context_insight" => match args.get("action").and_then(|v| v.as_str()) {
            Some("save") | Some("resolve") => ApprovalMode::SessionOnce,
            _ => ApprovalMode::Skip,
        },
        _ => ApprovalMode::Skip,
    }
}

/// 审批请求的摘要文案：面向创作者说清「AI 接下来要对什么动手」，不暴露技术日志。
fn approval_summary(tool_name: &str, args: &Value) -> String {
    match tool_name {
        "run_command" => {
            let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            if cwd.is_empty() {
                cmd.to_string()
            } else {
                format!("{cwd}> {cmd}")
            }
        }
        "apply_change" => {
            let file = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            let reason = args
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let rewriting = args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false);
            let action = if rewriting {
                "整文件重写"
            } else {
                "替换片段"
            };
            if reason.is_empty() {
                format!("修改文件 {file}（{action}）")
            } else {
                format!("修改文件 {file}（{action}）\n原因：{reason}")
            }
        }
        "context_insight" => {
            let action = args
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("save");
            if action == "resolve" {
                let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
                format!("关闭已完成的洞察记录：{title}")
            } else {
                let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
                format!("保存分析结论「{title}」到项目（会展示在画布与导出报告中）")
            }
        }
        "write_chapter" => {
            let chapter = args
                .get("chapter_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let mode = args
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("replace");
            let verb = if mode == "append" {
                "续写"
            } else {
                "替换正文"
            };
            format!(
                "{}《{}》的内容（约 {} 字）；写入前的原稿会自动存入版本历史",
                verb,
                chapter,
                content.chars().count()
            )
        }
        "create_chapter" => {
            let book = args.get("book_id").and_then(|v| v.as_str()).unwrap_or("");
            let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let with_content = args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if with_content {
                format!("在《{book}》新建章节「{title}」并写入初始正文")
            } else {
                format!("在《{book}》新建章节「{title}」（空章）")
            }
        }
        "update_character_card" => {
            let card = args.get("card").and_then(|v| v.as_str()).unwrap_or("");
            // 摘要在**执行前**生成，此时拿不到库里的旧值，所以能交代清楚的只有
            // 「要动哪张卡、动哪几个字段」。旧值改完后由工具回执列出，并同步进修订历史。
            let mut fields: Vec<&str> = Vec::new();
            if args.get("name").and_then(Value::as_str).is_some() {
                fields.push("名字");
            }
            if args.get("subtitle").and_then(Value::as_str).is_some() {
                fields.push("副标题");
            }
            if args.get("description").and_then(Value::as_str).is_some() {
                fields.push("描述");
            }
            if args.get("add_aliases").and_then(Value::as_array).is_some() {
                fields.push("别名");
            }
            let reason = args
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let mut head = format!(
                "修改设定卡「{card}」的{}；没点名的字段保持原样，原值会自动存入该卡的修改历史",
                if fields.is_empty() {
                    "若干字段".to_string()
                } else {
                    fields.join("、")
                }
            );
            if !reason.is_empty() {
                head.push_str(&format!("\n理由：{reason}"));
            }
            head
        }
        other => format!("执行工具 {other}"),
    }
}

// ─── Agent Engine ───

/// 历史滑动窗口：进入本轮对话的历史消息条数上限（不含 system 与本次 user 消息）。
/// 长对话若全量带入，token 成本与首包延迟都会随轮次线性膨胀；裁剪必须落在 user
/// 消息边界上（见 `trim_history`），否则会把 assistant(tool_calls) 与其 tool 结果拆开。
const HISTORY_WINDOW_MESSAGES: usize = 40;

/// 单条工具结果进入上下文前的预算上限（字符数）。各工具内部有自己的截断
/// （如 run_command 20KB），这里是引擎侧兜底：防止某个工具把整本书正文、
/// 巨型日志或全量目录树灌进对话，把后续轮次的 token 成本推到不可控。
const TOOL_OUTPUT_BUDGET_CHARS: usize = 16_000;

/// 历史滑动窗口：超出上限时从最近的消息往回保留，并把起点回退到最近一条
/// user 消息——OpenAI 协议要求 tool 消息必须紧跟其 assistant(tool_calls) 母消息，
/// 从 user 消息起裁才能保证配对完整、请求不被 API 拒绝。
fn trim_history(
    mut history: Vec<super::provider::ChatMessage>,
    max_messages: usize,
) -> Vec<super::provider::ChatMessage> {
    if history.len() <= max_messages {
        return history;
    }
    let mut start = history.len() - max_messages;
    while start > 0 && history[start].role != "user" {
        start -= 1;
    }
    history.split_off(start)
}

/// 工具输出预算：超限截断并附「为什么截断、下一步怎么办」的提示
/// （同时面向模型与 UI 卡片，禁止只给一个哑的半截字符串）。
fn clamp_tool_output(result: String) -> String {
    let total = result.chars().count();
    if total <= TOOL_OUTPUT_BUDGET_CHARS {
        return result;
    }
    let mut clamped: String = result.chars().take(TOOL_OUTPUT_BUDGET_CHARS).collect();
    clamped.push_str(&format!(
        "\n\n[输出已截断：原结果共 {total} 字符，仅保留前 {TOOL_OUTPUT_BUDGET_CHARS} 字符。\
         如需其余内容，请缩小范围（指定章节 / 文件 / 行区间）分多次获取。]"
    ));
    clamped
}

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

        for msg in trim_history(history, HISTORY_WINDOW_MESSAGES) {
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
                        let args: Value =
                            serde_json::from_str(&tc.function.arguments).unwrap_or(Value::Null);

                        on_tool_call(ToolCallEvent {
                            tool_name: tool_name.clone(),
                            arguments: args.clone(),
                            result: None,
                            success: None,
                            status: "running".to_string(),
                        });

                        // ── 审批闸门（human-in-the-loop）──
                        // run_command 每条确认；写入类（apply_change / context_insight 的
                        // save|resolve）可会话级记住；只读工具不拦。
                        let mode = approval_mode(tool_name, &args);
                        let approved = match mode {
                            ApprovalMode::Skip => true,
                            ApprovalMode::SessionOnce
                                if crate::plugins::ai_agent::is_session_granted(tool_name) =>
                            {
                                true
                            }
                            ApprovalMode::SessionOnce | ApprovalMode::EveryCall => {
                                let cmd =
                                    args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                                let sub = args.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
                                let key = format!("{}:{}", run_id, tc.id);
                                let mut rx = crate::plugins::ai_agent::register_approval(&key);
                                // 审批预告：把库里的 before 值一并给作者看，否则他只能凭
                                // AI 自述批准一次覆盖。这里刻意不等用户点按钮——等按钮最长
                                // 5 分钟，绝不能抱着 tools 锁干等（会把整条工具链堵死）。
                                let summary = {
                                    let tools = self.tools.lock().await;
                                    build_approval_summary(&tools, tool_name, &args).await
                                };
                                on_approval(ToolApprovalRequest {
                                    run_id: run_id.to_string(),
                                    tool_call_id: tc.id.clone(),
                                    tool: tool_name.clone(),
                                    command: cmd.to_string(),
                                    cwd: sub.to_string(),
                                    summary,
                                    session_rememberable: mode == ApprovalMode::SessionOnce,
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
                                            decision = d.approved;
                                            if d.approved && d.remember_session {
                                                crate::plugins::ai_agent::grant_tool_for_session(
                                                    tool_name,
                                                );
                                            }
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
                            }
                        };

                        if !approved {
                            // 文案同时面向创作者（UI 卡片）与模型（工具结果）：说清发生了什么、下一步怎么办
                            let denied = format!(
                                "[{tool_name}] 你没有批准这次操作，操作没有执行。\
                                 如确需执行，请先向用户说明这次操作的用途，再次发起并等待批准。"
                            );
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

                        let mut tool_result = {
                            let tools = self.tools.lock().await;
                            if let Some(tool) = tools.get(tool_name) {
                                tool.execute(args).await.unwrap_or_else(|e| ToolOutput {
                                    success: false,
                                    result: format!("工具执行出错：{e}"),
                                    metadata: Value::Null,
                                })
                            } else {
                                ToolOutput {
                                    success: false,
                                    result: format!(
                                        "工具 {tool_name} 当前不可用（未启用或不存在）。\
                                         请换用其他工具，或基于已有信息直接回答用户。"
                                    ),
                                    metadata: Value::Null,
                                }
                            }
                        };
                        // 引擎侧兜底预算：无论工具内部是否截断，进入上下文 / UI 卡片的结果都有界
                        tool_result.result = clamp_tool_output(tool_result.result);

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
        let mut tool_call_map: HashMap<i32, (Option<String>, Option<String>, String)> =
            HashMap::new();

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::ai_agent::provider::ChatMessage;
    use serde_json::json;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            tool_call_id: None,
        }
    }

    // ── 历史滑动窗口 ──

    #[test]
    fn trim_history_keeps_short_history_unchanged() {
        let history = vec![msg("user", "你好"), msg("assistant", "你好！")];
        let trimmed = trim_history(history, 40);
        assert_eq!(trimmed.len(), 2);
    }

    #[test]
    fn trim_history_windows_to_recent_and_starts_at_user() {
        // 45 条历史：u/a 交替。窗口 40 的裸边界落在 assistant 上，
        // 裁剪必须回退到紧邻的 user 消息（第 4 条，下标 4 起）。
        let mut history = Vec::new();
        for i in 0..45 {
            let role = if i % 2 == 0 { "user" } else { "assistant" };
            history.push(msg(role, &format!("m{i}")));
        }
        let trimmed = trim_history(history, 40);
        assert_eq!(trimmed.len(), 41); // 40 + 回退到 user 的 1 条
        assert_eq!(trimmed[0].role, "user");
        assert_eq!(trimmed[0].content, "m4");
        assert_eq!(trimmed.last().unwrap().content, "m44");
    }

    #[test]
    fn trim_history_never_splits_tool_call_group() {
        // 窗口裸边界落在 tool 结果中间：u1, a(tool), tool, tool, u2, a
        let history = vec![
            msg("user", "u1"),
            msg("assistant", "a1"),
            msg("tool", "t1"),
            msg("tool", "t2"),
            msg("user", "u2"),
            msg("assistant", "a2"),
        ];
        // 窗口 2：裸边界指向最后一条 a2，回退到 u2 —— tool 组整体保留在窗口外
        let trimmed = trim_history(history.clone(), 2);
        assert_eq!(trimmed.len(), 2);
        assert_eq!(trimmed[0].role, "user");
        assert_eq!(trimmed[0].content, "u2");

        // 窗口 4：裸边界指向 tool "t1"，回退到 a1？—— 回退目标是「最近一条 user」，
        // 会把 tool 组连同其 user 母消息一起带回窗口，绝不从 tool/assistant(tool_calls) 中段起裁
        let trimmed = trim_history(history, 4);
        assert_eq!(trimmed[0].role, "user");
        assert_eq!(trimmed[0].content, "u1");
        assert_eq!(trimmed.len(), 6);
    }

    #[test]
    fn trim_history_without_any_user_message_falls_back_to_head() {
        let history = vec![
            msg("assistant", "a1"),
            msg("tool", "t1"),
            msg("assistant", "a2"),
        ];
        let trimmed = trim_history(history, 2);
        // 找不到 user 边界：保留从头部开始的完整窗口，不产生孤立 tool 消息
        assert_eq!(trimmed.len(), 3);
        assert_eq!(trimmed[0].content, "a1");
    }

    // ── 工具输出预算 ──

    #[test]
    fn clamp_tool_output_passes_short_result_through() {
        let out = clamp_tool_output("第一章 初雪".to_string());
        assert_eq!(out, "第一章 初雪");
    }

    #[test]
    fn clamp_tool_output_truncates_with_actionable_notice() {
        let big = "x".repeat(TOOL_OUTPUT_BUDGET_CHARS + 500);
        let clamped = clamp_tool_output(big);
        assert!(clamped.chars().count() < TOOL_OUTPUT_BUDGET_CHARS + 200);
        assert!(clamped.contains("输出已截断"));
        assert!(clamped.contains("缩小范围"));
        // 截断提示必须是「下一步怎么办」，不是干巴巴的报错
        assert!(clamped.contains("分多次获取"));
    }

    #[test]
    fn clamp_tool_output_handles_multibyte_chars_without_panic() {
        // 中文按字符截断，不能切出非法 UTF-8 或 panic
        let big = "雪".repeat(TOOL_OUTPUT_BUDGET_CHARS + 10);
        let clamped = clamp_tool_output(big);
        assert!(clamped.chars().count() >= TOOL_OUTPUT_BUDGET_CHARS);
        assert!(clamped.contains("输出已截断"));
    }

    // ── 审批策略分级 ──

    #[test]
    fn approval_mode_matches_danger_levels() {
        let json = |s: &str| serde_json::from_str::<Value>(s).unwrap();

        // 执行类：逐条确认
        assert_eq!(
            approval_mode("run_command", &json("{}")),
            ApprovalMode::EveryCall
        );
        // 写入类：可会话级记住
        assert_eq!(
            approval_mode("apply_change", &json(r#"{"file_path":"a.ts"}"#)),
            ApprovalMode::SessionOnce
        );
        // context_insight 按 action 区分：save/resolve 落库要审，list 只读不审
        assert_eq!(
            approval_mode("context_insight", &json(r#"{"action":"save"}"#)),
            ApprovalMode::SessionOnce
        );
        assert_eq!(
            approval_mode("context_insight", &json(r#"{"action":"resolve"}"#)),
            ApprovalMode::SessionOnce
        );
        assert_eq!(
            approval_mode("context_insight", &json(r#"{"action":"list"}"#)),
            ApprovalMode::Skip
        );
        // 只读工具与未知工具：不拦
        assert_eq!(approval_mode("file_read", &json("{}")), ApprovalMode::Skip);
        assert_eq!(
            approval_mode("unknown_tool", &json("{}")),
            ApprovalMode::Skip
        );
        // 写作域写工具：写入类低危（改稿前自动存快照），与 apply_change 同级
        assert_eq!(
            approval_mode(
                "write_chapter",
                &json(r#"{"chapter_id":"c1","mode":"replace"}"#)
            ),
            ApprovalMode::SessionOnce
        );
        assert_eq!(
            approval_mode(
                "create_chapter",
                &json(r#"{"book_id":"b1","title":"第二章"}"#)
            ),
            ApprovalMode::SessionOnce
        );
        // 设定卡写工具（批次③ 增-3）：与正文写同级要审。
        // 这条断言是**防线本身**——approval_mode 的 default 是 Skip，
        // 以后再加任何写工具忘记登记，本测试就是最后一道闸。
        assert_eq!(
            approval_mode(
                "update_character_card",
                &json(r#"{"card":"s1","description":"改设定"}"#)
            ),
            ApprovalMode::SessionOnce
        );
        // 新增的只读工具必须**不**拦：拦了就是给作者添无意义弹窗
        assert_eq!(
            approval_mode("search_corpus", &json(r#"{"query":"孤独"}"#)),
            ApprovalMode::Skip
        );
        assert_eq!(
            approval_mode("read_character_card", &json("{}")),
            ApprovalMode::Skip
        );
    }

    /// 审批摘要必须说清"要动哪张卡的哪些字段"——这是作者点允许前唯一的依据。
    #[test]
    fn approval_summary_for_card_write_names_fields() {
        let json = |s: &str| serde_json::from_str::<Value>(s).unwrap();
        let s = approval_summary(
            "update_character_card",
            &json(r#"{"card":"沈砚","add_aliases":["沈公子"],"reason":"体检报出未登记别名"}"#),
        );
        assert!(s.contains("沈砚"), "{}", s);
        assert!(s.contains("别名"), "{}", s);
        // 未点名的字段要明说保持原样，作者才知道这不是整卡覆写
        assert!(s.contains("没点名的字段保持原样"), "{}", s);
        assert!(s.contains("修改历史"), "{}", s);
        assert!(s.contains("体检报出未登记别名"), "{}", s);
        // 一个字段都没给时也不能印出空话
        let bare = approval_summary("update_character_card", &json(r#"{"card":"沈砚"}"#));
        assert!(bare.contains("若干字段"), "{}", bare);
    }

    // ── 审批预告的拼装接线 ──
    //
    // 数据在工具里读、文案骨架在 approval_summary 里，中间这段拼装若被删掉，作者的
    // 盲批就会悄悄回来，而两侧各自的测试都发现不了。所以这里用双件把接线本身锁住。

    struct PreviewDouble {
        preview: Option<String>,
    }

    #[async_trait]
    impl AgentTool for PreviewDouble {
        fn name(&self) -> &str {
            "preview_double"
        }
        fn description(&self) -> &str {
            "test double"
        }
        fn parameters(&self) -> Value {
            json!({})
        }
        async fn execute(&self, _params: Value) -> Result<ToolOutput, String> {
            Ok(ToolOutput {
                success: true,
                result: "ok".to_string(),
                metadata: Value::Null,
            })
        }
        async fn approval_preview(&self, _params: &Value) -> Option<String> {
            self.preview.clone()
        }
    }

    /// 完全不实现 `approval_preview` 的工具：用来锁 trait 的默认实现。
    struct PlainDouble;

    #[async_trait]
    impl AgentTool for PlainDouble {
        fn name(&self) -> &str {
            "plain_double"
        }
        fn description(&self) -> &str {
            "test double"
        }
        fn parameters(&self) -> Value {
            json!({})
        }
        async fn execute(&self, _params: Value) -> Result<ToolOutput, String> {
            Ok(ToolOutput {
                success: true,
                result: "ok".to_string(),
                metadata: Value::Null,
            })
        }
    }

    #[tokio::test]
    async fn approval_summary_appends_the_tools_preview() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(PreviewDouble {
            preview: Some("现在：描述 8 字".to_string()),
        }));
        let s = build_approval_summary(&reg, "preview_double", &json!({})).await;
        assert!(s.contains("现在：描述 8 字"), "预告没拼进摘要：{s}");
    }

    #[tokio::test]
    async fn approval_summary_ignores_blank_and_unimplemented_preview() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(PreviewDouble {
            preview: Some("   ".to_string()),
        }));
        reg.register(Arc::new(PlainDouble));
        // 空白预告不许留下悬空换行；没实现预告的工具（走 trait 默认 None）摘要不许多出内容
        let blank = build_approval_summary(&reg, "preview_double", &json!({})).await;
        assert!(!blank.ends_with('\n'), "空白预告留下悬空换行：[{blank}]");
        let plain = build_approval_summary(&reg, "plain_double", &json!({})).await;
        assert_eq!(plain, approval_summary("plain_double", &json!({})));
    }

    #[test]
    fn approval_summary_is_creator_friendly() {
        let json = |s: &str| serde_json::from_str::<Value>(s).unwrap();

        let patch = approval_summary(
            "apply_change",
            &json(
                r#"{"file_path":"src/main.rs","old_text":"a","new_text":"b","reason":"修复空指针"}"#,
            ),
        );
        assert!(patch.contains("src/main.rs"));
        assert!(patch.contains("替换片段"));
        assert!(patch.contains("修复空指针"));

        let rewrite = approval_summary(
            "apply_change",
            &json(r#"{"file_path":"a.md","content":"全新内容正文"}"#),
        );
        assert!(rewrite.contains("整文件重写"));

        let save = approval_summary(
            "context_insight",
            &json(r#"{"action":"save","title":"循环复杂度过高"}"#),
        );
        assert!(save.contains("循环复杂度过高"));

        let cmd = approval_summary(
            "run_command",
            &json(r#"{"command":"cargo test","cwd":"src-tauri"}"#),
        );
        assert!(cmd.contains("cargo test"));

        // 写作域写工具：说清动哪一章、多大动作、原稿可恢复
        let write = approval_summary(
            "write_chapter",
            &json(r#"{"chapter_id":"第三章 夜行","content":"雨点砸在屋檐上。","mode":"replace"}"#),
        );
        assert!(write.contains("替换正文"));
        assert!(write.contains("第三章 夜行"));
        assert!(write.contains("约 8 字"));
        assert!(write.contains("版本历史"));

        let append = approval_summary(
            "write_chapter",
            &json(r#"{"chapter_id":"第三章","content":"续写的句子","mode":"append"}"#),
        );
        assert!(append.contains("续写"));

        let create = approval_summary(
            "create_chapter",
            &json(r#"{"book_id":"长夜余生","title":"第四章 归途"}"#),
        );
        assert!(create.contains("长夜余生"));
        assert!(create.contains("第四章 归途"));
        assert!(create.contains("空章"));

        let create_with_body = approval_summary(
            "create_chapter",
            &json(r#"{"book_id":"长夜余生","title":"第四章","content":"正文若干"}"#),
        );
        assert!(create_with_body.contains("初始正文"));
    }
}
