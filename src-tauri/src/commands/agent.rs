// sight-folio: AI Agent Tauri 命令
// 提供 CRUD + run_agent（流式对话 + 工具调用）给前端

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Emitter, State};

use crate::commands::corpus::CorpusState;
use crate::infrastructure::database::ai_repository::*;
use crate::infrastructure::Database;

// ─── DTO（前后端传输对象）───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDto {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub color: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDto {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub auth_type: String,
    pub custom_auth_header: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDto {
    pub id: String,
    pub name: String,
    pub ref_key: String,
    pub endpoint_id: String,
    pub reasoning: bool,
    pub input_types: Vec<String>,
    pub context_window: i64,
    pub max_tokens: i64,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub model_id: String,
    pub system_prompt: String,
    pub temperature: f64,
    pub max_iterations: i32,
    pub tool_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDto {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDto {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: String,
    pub created_at: i64,
}

// ─── 转换函数 ───

/// api_key 掩码：接口层只下发 `••••` + 末 4 位，明文只留在后端。
/// `•` 不是合法密钥字符，保存时据此识别「用户未改动密钥」并沿用库中原值。
fn mask_api_key(key: &str) -> String {
    if key.is_empty() {
        return String::new();
    }
    let tail_start = key.char_indices().rev().nth(3).map(|(i, _)| i).unwrap_or(0);
    format!("••••{}", &key[tail_start..])
}

fn is_masked_api_key(key: &str) -> bool {
    key.contains('•')
}

fn to_provider_dto(p: &AiProviderRow) -> ProviderDto {
    ProviderDto {
        id: p.id.clone(),
        name: p.name.clone(),
        api_key: mask_api_key(&p.api_key),
        color: p.color.clone(),
        enabled: p.enabled,
        created_at: p.created_at,
        updated_at: p.updated_at,
    }
}

fn to_endpoint_dto(e: &AiEndpointRow) -> EndpointDto {
    EndpointDto {
        id: e.id.clone(),
        provider_id: e.provider_id.clone(),
        name: e.name.clone(),
        api_type: e.api_type.clone(),
        base_url: e.base_url.clone(),
        auth_type: e.auth_type.clone(),
        custom_auth_header: e.custom_auth_header.clone(),
        enabled: e.enabled,
        created_at: e.created_at,
        updated_at: e.updated_at,
    }
}

fn to_model_dto(m: &AiModelRow) -> ModelDto {
    ModelDto {
        id: m.id.clone(),
        name: m.name.clone(),
        ref_key: m.ref_key.clone(),
        endpoint_id: m.endpoint_id.clone(),
        reasoning: m.reasoning,
        input_types: m.input_types.clone(),
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        enabled: m.enabled,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn to_agent_dto(a: &AiAgentRow) -> AgentDto {
    AgentDto {
        id: a.id.clone(),
        name: a.name.clone(),
        description: a.description.clone(),
        model_id: a.model_id.clone(),
        system_prompt: a.system_prompt.clone(),
        temperature: a.temperature,
        max_iterations: a.max_iterations,
        tool_ids: a.tool_ids.clone(),
        created_at: a.created_at,
        updated_at: a.updated_at,
    }
}

fn to_conversation_dto(c: &AiConversationRow) -> ConversationDto {
    ConversationDto {
        id: c.id.clone(),
        agent_id: c.agent_id.clone(),
        title: c.title.clone(),
        created_at: c.created_at,
        updated_at: c.updated_at,
    }
}

fn to_message_dto(m: &AiMessageRow) -> MessageDto {
    MessageDto {
        id: m.id.clone(),
        conversation_id: m.conversation_id.clone(),
        role: m.role.clone(),
        content: m.content.clone(),
        tool_calls: m.tool_calls.clone(),
        created_at: m.created_at,
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ─── Provider 命令 ───

#[tauri::command]
pub fn list_providers(db: State<'_, Arc<Database>>) -> Result<Vec<ProviderDto>, String> {
    let rows = AiProviderRepo::list(&db)?;
    Ok(rows.iter().map(to_provider_dto).collect())
}

#[tauri::command]
pub fn save_provider(db: State<'_, Arc<Database>>, provider: ProviderDto) -> Result<(), String> {
    let mut api_key = provider.api_key;
    // 前端回传的仍是掩码值（用户未改动密钥）：沿用库中原值，避免掩码覆盖真实密钥
    if is_masked_api_key(&api_key) {
        api_key = match AiProviderRepo::get_by_id(&db, &provider.id) {
            Ok(Some(existing)) => existing.api_key,
            _ => String::new(),
        };
    }
    AiProviderRepo::save(
        &db,
        &AiProviderRow {
            id: provider.id,
            name: provider.name,
            api_key,
            color: provider.color,
            enabled: provider.enabled,
            created_at: provider.created_at,
            updated_at: provider.updated_at,
        },
    )
}

#[tauri::command]
pub fn delete_provider(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    AiProviderRepo::delete(&db, &id)
}

// ─── Endpoint 命令 ───

#[tauri::command]
pub fn list_endpoints(db: State<'_, Arc<Database>>) -> Result<Vec<EndpointDto>, String> {
    let rows = AiEndpointRepo::list(&db)?;
    Ok(rows.iter().map(to_endpoint_dto).collect())
}

#[tauri::command]
pub fn list_endpoints_by_provider(
    db: State<'_, Arc<Database>>,
    provider_id: String,
) -> Result<Vec<EndpointDto>, String> {
    let rows = AiEndpointRepo::list_by_provider(&db, &provider_id)?;
    Ok(rows.iter().map(to_endpoint_dto).collect())
}

#[tauri::command]
pub fn save_endpoint(db: State<'_, Arc<Database>>, endpoint: EndpointDto) -> Result<(), String> {
    AiEndpointRepo::save(
        &db,
        &AiEndpointRow {
            id: endpoint.id,
            provider_id: endpoint.provider_id,
            name: endpoint.name,
            api_type: endpoint.api_type,
            base_url: endpoint.base_url,
            auth_type: endpoint.auth_type,
            custom_auth_header: endpoint.custom_auth_header,
            enabled: endpoint.enabled,
            created_at: endpoint.created_at,
            updated_at: endpoint.updated_at,
        },
    )
}

#[tauri::command]
pub fn delete_endpoint(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    AiEndpointRepo::delete(&db, &id)
}

// ─── Model 命令 ───

#[tauri::command]
pub fn list_models(db: State<'_, Arc<Database>>) -> Result<Vec<ModelDto>, String> {
    let rows = AiModelRepo::list(&db)?;
    Ok(rows.iter().map(to_model_dto).collect())
}

#[tauri::command]
pub fn list_models_by_endpoint(
    db: State<'_, Arc<Database>>,
    endpoint_id: String,
) -> Result<Vec<ModelDto>, String> {
    let rows = AiModelRepo::list_by_endpoint(&db, &endpoint_id)?;
    Ok(rows.iter().map(to_model_dto).collect())
}

#[tauri::command]
pub fn save_model(db: State<'_, Arc<Database>>, model: ModelDto) -> Result<(), String> {
    AiModelRepo::save(
        &db,
        &AiModelRow {
            id: model.id,
            name: model.name,
            ref_key: model.ref_key,
            endpoint_id: model.endpoint_id,
            reasoning: model.reasoning,
            input_types: model.input_types,
            context_window: model.context_window,
            max_tokens: model.max_tokens,
            enabled: model.enabled,
            created_at: model.created_at,
            updated_at: model.updated_at,
        },
    )
}

#[tauri::command]
pub fn delete_model(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    AiModelRepo::delete(&db, &id)
}

// ─── 连接测试 ───

#[tauri::command]
pub async fn test_endpoint_connection(
    db: State<'_, Arc<Database>>,
    endpoint_id: String,
) -> Result<String, String> {
    let endpoints = AiEndpointRepo::list(&db)?;
    let endpoint = endpoints
        .iter()
        .find(|e| e.id == endpoint_id)
        .ok_or_else(|| "Endpoint not found".to_string())?;
    let providers = AiProviderRepo::list(&db)?;
    let provider = providers
        .iter()
        .find(|p| p.id == endpoint.provider_id)
        .ok_or_else(|| "Provider not found".to_string())?;

    let url = format!("{}/models", endpoint.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut req = client.get(&url);

    // 与真实调用共用同一套 auth 解析，杜绝「测试通过但真实调用失败」的漂移
    let (auth_header_name, auth_header_value) = crate::plugins::ai_agent::provider::auth_header_for(
        &endpoint.auth_type,
        &endpoint.custom_auth_header,
        &provider.api_key,
    );
    req = req.header(&auth_header_name, &auth_header_value);

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(format!("Connection successful (HTTP {})", status))
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!(
            "Connection failed (HTTP {}): {}",
            status,
            body.chars().take(200).collect::<String>()
        ))
    }
}

#[tauri::command]
pub async fn test_model_chat(
    db: State<'_, Arc<Database>>,
    model_id: String,
) -> Result<String, String> {
    let models = AiModelRepo::list(&db)?;
    let model = models
        .iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| "Model not found".to_string())?;
    let endpoints = AiEndpointRepo::list(&db)?;
    let endpoint = endpoints
        .iter()
        .find(|e| e.id == model.endpoint_id)
        .ok_or_else(|| "Endpoint not found".to_string())?;
    let providers = AiProviderRepo::list(&db)?;
    let provider = providers
        .iter()
        .find(|p| p.id == endpoint.provider_id)
        .ok_or_else(|| "Provider not found".to_string())?;

    let url =
        crate::plugins::ai_agent::provider::chat_url_for(&endpoint.base_url, &endpoint.api_type);
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model.ref_key,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 10,
    });

    // 与真实调用共用同一套 auth 解析，杜绝「测试通过但真实调用失败」的漂移
    let (auth_header_name, auth_header_value) = crate::plugins::ai_agent::provider::auth_header_for(
        &endpoint.auth_type,
        &endpoint.custom_auth_header,
        &provider.api_key,
    );
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header(&auth_header_name, &auth_header_value)
        .json(&body);

    if endpoint.api_type == "anthropic-messages" {
        req = req.header("anthropic-version", "2023-06-01");
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = resp.status();
    if status.is_success() {
        Ok(format!("Model test successful (HTTP {})", status))
    } else {
        let body = resp.text().await.unwrap_or_default();
        Err(format!(
            "Model test failed (HTTP {}): {}",
            status,
            body.chars().take(200).collect::<String>()
        ))
    }
}

// ─── Agent 命令 ───

#[tauri::command]
pub fn list_agents(db: State<'_, Arc<Database>>) -> Result<Vec<AgentDto>, String> {
    let rows = AiAgentRepo::list(&db)?;
    Ok(rows.iter().map(to_agent_dto).collect())
}

#[tauri::command]
pub fn save_agent(db: State<'_, Arc<Database>>, agent: AgentDto) -> Result<(), String> {
    AiAgentRepo::save(
        &db,
        &AiAgentRow {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            model_id: agent.model_id,
            system_prompt: agent.system_prompt,
            temperature: agent.temperature,
            max_iterations: agent.max_iterations,
            tool_ids: agent.tool_ids,
            created_at: agent.created_at,
            updated_at: agent.updated_at,
        },
    )
}

#[tauri::command]
pub fn delete_agent(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    AiAgentRepo::delete(&db, &id)
}

// ─── Conversation 命令 ───

#[tauri::command]
pub fn list_conversations(
    db: State<'_, Arc<Database>>,
    agent_id: String,
) -> Result<Vec<ConversationDto>, String> {
    let rows = AiConversationRepo::list_by_agent(&db, &agent_id)?;
    Ok(rows.iter().map(to_conversation_dto).collect())
}

#[tauri::command]
pub fn create_conversation(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    title: String,
) -> Result<ConversationDto, String> {
    let now = now_ms();
    let conv = AiConversationRow {
        id: uuid::Uuid::new_v4().to_string(),
        agent_id,
        title,
        created_at: now,
        updated_at: now,
    };
    AiConversationRepo::save(&db, &conv)?;
    Ok(to_conversation_dto(&conv))
}

#[tauri::command]
pub fn delete_conversation(db: State<'_, Arc<Database>>, id: String) -> Result<(), String> {
    AiConversationRepo::delete(&db, &id)
}

// ─── Message 命令 ───

#[tauri::command]
pub fn list_messages(
    db: State<'_, Arc<Database>>,
    conversation_id: String,
) -> Result<Vec<MessageDto>, String> {
    let rows = AiMessageRepo::list_by_conversation(&db, &conversation_id)?;
    Ok(rows.iter().map(to_message_dto).collect())
}

/// Delete a tail of the transcript (explicit message ids).
///
/// Used by the AI panel's message actions: "retry" re-runs the last request and "edit & resend"
/// rewrites it - both must drop the old turn first, otherwise the conversation would keep two
/// copies of the same request and the model would see a duplicated turn next round.
/// Ids are supplied by the panel, which already holds the ordered message list.
#[tauri::command]
pub fn delete_messages(db: State<'_, Arc<Database>>, ids: Vec<String>) -> Result<usize, String> {
    AiMessageRepo::delete_many(&db, &ids)
}

#[tauri::command]
pub fn save_message(db: State<'_, Arc<Database>>, msg: MessageDto) -> Result<(), String> {
    AiMessageRepo::save(
        &db,
        &AiMessageRow {
            id: msg.id,
            conversation_id: msg.conversation_id,
            role: msg.role,
            content: msg.content,
            tool_calls: msg.tool_calls,
            created_at: msg.created_at,
        },
    )
}

// ─── run_agent: 核心 AI 对话命令（流式 + 工具调用）───

#[tauri::command]
pub async fn run_agent(
    agent_id: String,
    message: String,
    conversation_id: Option<String>,
    allowed_tools: Option<Vec<String>>,
    run_id: Option<String>,
    model_id: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, Arc<Database>>,
    corpus: State<'_, CorpusState>,
) -> Result<String, String> {
    // 1. 加载 Agent 配置
    let agents = AiAgentRepo::list(&db)?;
    let agent = agents
        .iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| "Agent not found".to_string())?;

    // 2. 加载关联的 Model → Endpoint → Provider
    let models = AiModelRepo::list(&db)?;
    // 模型覆盖：前端模型选择器显式选了某个模型（model_id）则用它覆盖，
    // 否则回退到 Agent 配置里绑定的 model_id。覆盖时必须重新解析 endpoint/provider，
    // 因为不同模型可能挂在别的 endpoint 下（不同的 base_url / api_key）。
    let effective_model_id = model_id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| agent.model_id.clone());
    let model = models
        .iter()
        .find(|m| m.id == effective_model_id)
        .ok_or_else(|| "Model not found".to_string())?;
    let endpoints = AiEndpointRepo::list(&db)?;
    let endpoint = endpoints
        .iter()
        .find(|e| e.id == model.endpoint_id)
        .ok_or_else(|| "Endpoint not found".to_string())?;
    let providers = AiProviderRepo::list(&db)?;
    let provider = providers
        .iter()
        .find(|p| p.id == endpoint.provider_id)
        .ok_or_else(|| "Provider not found".to_string())?;

    // 3. 构建 LLM Provider
    let config = crate::plugins::ai_agent::provider::ProviderConfig {
        api_key: provider.api_key.clone(),
        base_url: endpoint.base_url.clone(),
        api_type: endpoint.api_type.clone(),
        auth_type: endpoint.auth_type.clone(),
        custom_auth_header: endpoint.custom_auth_header.clone(),
    };
    let llm_provider = crate::plugins::ai_agent::openai_provider::OpenAiCompatProvider::new(config);
    let llm_provider_arc: Arc<dyn crate::plugins::ai_agent::provider::LlmProvider> =
        Arc::new(llm_provider);

    // 4. 注册工具
    // `allowed_tools` 是「单次调用的工具白名单覆盖」：传入时本次调用在 Agent 既有工具基础上
    // 累加这些工具（additive override），既不污染用户 Agent 配置，又能让诊断类调用临时启用
    // apply_change / context_insight 等写回工具，而不必像旧实现那样 saveAgent 永久改写用户配置。
    // 未传入时回退到 Agent 配置（分析页 / 聊天页走这条，行为不变）。
    let effective_tool_ids: Vec<String> = match &allowed_tools {
        Some(allowed) => {
            let mut ids = agent.tool_ids.clone();
            for t in allowed {
                if !ids.contains(t) {
                    ids.push(t.clone());
                }
            }
            ids
        }
        None => agent.tool_ids.clone(),
    };
    // 语料仓储可能因初始化失败而不可用：拿不到就传 None，
    // search_corpus 会干脆不注册，而不是注册一个每次调用都报错的工具。
    let corpus_repo = corpus.repo().ok().cloned();
    let tool_registry = crate::plugins::ai_agent::tools::create_project_sight_tools(
        db.inner().clone(),
        corpus_repo,
        &effective_tool_ids,
        // 写作域写工具（write_chapter / create_chapter）落库后把变更事件推给前端，
        // WritingPage 据此刷新目录 / 提示当前章节被外部修改。未启用写工具时为 None。
        {
            let app = app_handle.clone();
            Some(
                std::sync::Arc::new(move |book_id: &str, chapter_id: &str, action: &str| {
                    use tauri::Emitter;
                    let _ = app.emit(
                        "writing-chapter-external-change",
                        serde_json::json!({
                            "bookId": book_id,
                            "chapterId": chapter_id,
                            "action": action,
                        }),
                    );
                }) as crate::plugins::ai_agent::tools::WritingChangeNotifier,
            )
        },
        // 设定卡写工具（update_character_card）的变更事件。与章节分开：
        // 卡被改时要刷新的是设定列表，以及"作者正在编辑的这张卡"的冲突提示。
        {
            let app = app_handle.clone();
            Some(std::sync::Arc::new(move |book_id: &str, setting_id: &str| {
                use tauri::Emitter;
                let _ = app.emit(
                    "writing-setting-external-change",
                    serde_json::json!({ "bookId": book_id, "settingId": setting_id }),
                );
            })
                as crate::plugins::ai_agent::tools::SettingChangeNotifier)
        },
    );
    let tools = Arc::new(tokio::sync::Mutex::new(tool_registry));

    // 4.5 登记取消令牌：run_id 由前端下发（用于 cancel_agent_run 精准取消单次运行），缺失则后端生成
    let run_id = run_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cancel_token = crate::plugins::ai_agent::register_run_token(&run_id);

    // 5. 构建 Agent Engine
    // max_tokens 用「本次实际生效的模型」的库值：effective_model_id 已把前端模型选择器的
    // 覆盖算进来（见上方 model 解析），所以切换模型时输出上限跟着模型走。
    let engine = crate::plugins::ai_agent::engine::AgentEngine::new(
        llm_provider_arc,
        tools,
        model.ref_key.clone(),
        agent.system_prompt.clone(),
        agent.temperature,
        agent.max_iterations,
        model.max_tokens,
    );

    // 6. 准备对话
    //
    // 持久化的唯一权威在后端：调用方（聊天页 / 扫描深度分析 / 未来任意模块）只管发消息，
    // 用户消息与助手回复都由这里落库。前端若也预存一份就会重复，故前端只做乐观渲染。
    let conv_id = conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // 会话不存在则补建：ai_messages 对 ai_conversations 有外键，缺会话会直接写入失败
    let convs = AiConversationRepo::list_by_agent(&db, &agent_id).unwrap_or_default();
    if !convs.iter().any(|c| c.id == conv_id) {
        let now = now_ms();
        let title: String = message.chars().take(30).collect();
        let _ = AiConversationRepo::save(
            &db,
            &AiConversationRow {
                id: conv_id.clone(),
                agent_id: agent_id.clone(),
                title: if title.is_empty() {
                    "新对话".to_string()
                } else {
                    title
                },
                created_at: now,
                updated_at: now,
            },
        );
    }

    // 历史 = 本轮之前已落库的消息。防御性剔除尾部与本轮完全相同的 user 消息，
    // 兼容「调用方已经预存过一次」的旧行为，避免同一句话进两遍上下文白烧 token。
    let mut history: Vec<crate::plugins::ai_agent::provider::ChatMessage> =
        if let Ok(db_msgs) = AiMessageRepo::list_by_conversation(&db, &conv_id) {
            db_msgs
                .iter()
                .map(|m| crate::plugins::ai_agent::provider::ChatMessage {
                    role: m.role.clone(),
                    content: m.content.clone(),
                    tool_calls: None,
                    tool_call_id: None,
                })
                .collect()
        } else {
            Vec::new()
        };
    if history
        .last()
        .map(|m| m.role == "user" && m.content == message)
        .unwrap_or(false)
    {
        history.pop();
    } else {
        // 未预存 → 由后端落库用户消息
        let now = now_ms();
        let _ = AiMessageRepo::save(
            &db,
            &AiMessageRow {
                id: uuid::Uuid::new_v4().to_string(),
                conversation_id: conv_id.clone(),
                role: "user".to_string(),
                content: message.clone(),
                tool_calls: String::new(),
                created_at: now,
            },
        );
    }

    // 7. 运行 Agent（流式 + 工具调用）
    let emit_handle = app_handle.clone();
    let conv_id_clone = conv_id.clone();
    let emit_tool = app_handle.clone();
    let conv_id_tool = conv_id.clone();
    let emit_approval = app_handle.clone();
    let conv_id_approval = conv_id.clone();
    let run_id_approval = run_id.clone();

    // 工具轨迹：Agent 模式下「读了哪些文件 / 搜了什么 / 用 apply_change 改了哪儿」就是转录的主内容。
    // 以前只推事件不落库 —— 流式一结束前端 loadMessages 重刷转录，这段记录就整体消失，
    // 历史会话完全看不出 AI 动过什么（写盘工具尤其是追责漏洞）。这里同步累积，随助手消息一起入库。
    let tool_trace: Arc<std::sync::Mutex<Vec<crate::plugins::ai_agent::engine::ToolCallEvent>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));
    let trace_sink = tool_trace.clone();

    let result = engine
        .run(
            &message,
            history,
            &run_id,
            Some(cancel_token.clone()),
            move |chunk| {
                let _ = emit_handle.emit(
                    "agent-chunk",
                    serde_json::json!({
                        "conversationId": conv_id_clone,
                        "chunk": chunk,
                    }),
                );
            },
            move |tool_event| {
                // 先记账再推事件：即使前端窗口错过事件（切窗口/新开面板），落库轨迹也不会缺步骤
                if let Ok(mut trace) = trace_sink.lock() {
                    crate::plugins::ai_agent::engine::merge_tool_call_event(
                        &mut trace,
                        &tool_event,
                    );
                }
                let _ = emit_tool.emit(
                    "agent-tool-call",
                    serde_json::json!({
                        "conversationId": conv_id_tool,
                        "toolCall": tool_event,
                    }),
                );
            },
            move |approval: crate::plugins::ai_agent::engine::ToolApprovalRequest| {
                // 高危工具（run_command）执行前推审批请求，前端弹确认框，用户落定后引擎继续。
                let _ = emit_approval.emit(
                    "agent-tool-approval",
                    serde_json::json!({
                        "conversationId": conv_id_approval,
                        "runId": run_id_approval,
                        "toolCallId": approval.tool_call_id,
                        "tool": approval.tool,
                        "command": approval.command,
                        "cwd": approval.cwd,
                    }),
                );
            },
        )
        .await;

    // 运行结束，移除取消令牌（避免表无限增长）
    crate::plugins::ai_agent::deregister_run_token(&run_id);

    match result {
        Ok((response, was_cancelled)) => {
            // 工具轨迹序列化随消息入库；空轨迹写空串，保持与历史行数据一致（前端按 falsy 跳过渲染）。
            // 被取消的运行同样保留 —— 「我按停止之前它已经改了哪些文件」正是最需要回看的场景。
            let tool_trace_json = tool_trace
                .lock()
                .ok()
                .filter(|trace| !trace.is_empty())
                .and_then(|trace| serde_json::to_string(&*trace).ok())
                .unwrap_or_default();

            // 助手回复落库（与用户消息同一权威路径），任何调用方都能直接从 DB 回看
            let _ = AiMessageRepo::save(
                &db,
                &AiMessageRow {
                    id: uuid::Uuid::new_v4().to_string(),
                    conversation_id: conv_id.clone(),
                    role: "assistant".to_string(),
                    content: response.clone(),
                    tool_calls: tool_trace_json,
                    created_at: now_ms(),
                },
            );
            if was_cancelled {
                // 真取消：通知前端本轮是被用户中止的（前端据此保留「已停止」状态）
                let _ = app_handle.emit(
                    "agent-cancelled",
                    serde_json::json!({
                        "conversationId": conv_id,
                        "runId": run_id,
                    }),
                );
            }
            let _ = app_handle.emit(
                "agent-done",
                serde_json::json!({
                    "conversationId": conv_id,
                    "response": response,
                }),
            );
            Ok(response)
        }
        Err(e) => {
            let _ = app_handle.emit(
                "agent-error",
                serde_json::json!({
                    "conversationId": conv_id,
                    "error": e,
                }),
            );
            Err(e)
        }
    }
}

/// 取消一次正在运行的 `run_agent`：按 run_id 置位取消令牌，引擎在下一轮迭代前停下。
/// 幂等：未知 / 已结束的 run_id 也返回成功，前端可重复点击停止。
#[tauri::command]
pub fn cancel_agent_run(run_id: String) -> Result<(), String> {
    crate::plugins::ai_agent::request_cancel(&run_id);
    Ok(())
}

/// 落定一次待审批的工具调用（run_command 逐条确认；写入类工具可勾选本会话不再询问）。
/// 前端弹确认框，用户点「允许 / 拒绝」后调用；引擎在审批闸门里 await 此结果。
#[tauri::command]
pub fn resolve_tool_approval(
    run_id: String,
    tool_call_id: String,
    approved: bool,
    remember: Option<bool>,
) -> Result<bool, String> {
    let decision = crate::plugins::ai_agent::ApprovalDecision {
        approved,
        remember_session: remember.unwrap_or(false),
    };
    let ok = crate::plugins::ai_agent::resolve_approval(
        &format!("{}:{}", run_id, tool_call_id),
        decision,
    );
    Ok(ok)
}
