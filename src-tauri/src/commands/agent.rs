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

// ─── 本地 Ollama 自动发现 ───
//
// 两个命令刻意分开：**扫**是只读的（打开设置页就自动跑，不许顺手写库），
// **接入**是显式动作（建 provider/端点/模型是往用户配置里写东西，得由用户点）。

use crate::plugins::ai_agent::ollama::{self, ExistingEndpoint};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaAdoptResult {
    pub provider_id: String,
    pub endpoint_id: String,
    /// 这次新加的模型 ref_key
    pub added: Vec<String>,
    /// 库里已有、这次没动的模型 ref_key
    pub kept: Vec<String>,
    /// 库里原本挂着占位上下文、这次被补成服务报出的真实值的模型 ref_key
    pub refreshed: Vec<String>,
    pub created_provider: bool,
    pub created_endpoint: bool,
}

/// 只读扫描本机 Ollama（macOS / Windows 同一实现，走回环，见模块注释）。
#[tauri::command]
pub async fn scan_ollama() -> Result<ollama::OllamaScan, String> {
    Ok(ollama::scan().await)
}

/// 把扫到的模型接入模型表。幂等 + **只增不删**（判据在 `ollama::plan_adopt`，这里只执行）。
/// 上下文窗口自动填：新模型直接用服务报出的 `context_length`；老记录只在仍是占位值时补一次。
#[tauri::command]
pub async fn import_ollama_models(
    db: State<'_, Arc<Database>>,
) -> Result<OllamaAdoptResult, String> {
    let scan = ollama::scan().await;
    if !scan.found {
        // 如实报错，不返回一个"成功但啥也没干"的空壳 —— 那会让前端只能显示假成功
        let why = if scan.attempts.is_empty() {
            "没有可探测的地址".to_string()
        } else {
            scan.attempts.join("；")
        };
        return Err(format!("未发现本机 Ollama：{why}"));
    }
    let endpoints: Vec<ExistingEndpoint> = AiEndpointRepo::list(&db)?
        .iter()
        .map(|e| ExistingEndpoint {
            id: e.id.clone(),
            provider_id: e.provider_id.clone(),
            base_url: e.base_url.clone(),
        })
        .collect();
    let providers = AiProviderRepo::list(&db)?;
    let provider_names: Vec<String> = providers.iter().map(|p| p.name.clone()).collect();
    // 「哪个端点算这一台 Ollama」只有一处判据：ollama::find_endpoint_by_base（与 plan_adopt 同一个）
    let hit = ollama::find_endpoint_by_base(&endpoints, &scan.openai_base_url);
    // 已有模型只读不改：命中端点上的模型（标识 + 库里现有的上下文数值）进判定，其余端点的模型与本函数无关。
    // 带上 context_window 只为了一个判据：库里还挂着占位值的那些才允许被补成真实值（见 plan_adopt 第 4 条）。
    let existing_models: Vec<ollama::ExistingModel> = match hit {
        Some(e) => AiModelRepo::list_by_endpoint(&db, &e.id)?
            .iter()
            .map(|m| ollama::ExistingModel {
                ref_key: m.ref_key.clone(),
                context_window: m.context_window,
            })
            .collect(),
        None => Vec::new(),
    };
    let plan = ollama::plan_adopt(&endpoints, &provider_names, &existing_models, &scan);
    let now = now_ms();
    let new_id = |prefix: &str| format!("{prefix}_{}", uuid::Uuid::new_v4().simple());

    let provider_id = if plan.create_provider {
        let id = new_id("prov");
        AiProviderRepo::save(
            &db,
            &AiProviderRow {
                id: id.clone(),
                name: ollama::OLLAMA_PROVIDER_NAME.to_string(),
                // 本地服务没有密钥：留空比塞一个假 key 诚实，端点那边认证方式记成 none
                api_key: String::new(),
                color: "#6B7280".to_string(),
                enabled: true,
                created_at: now,
                updated_at: now,
            },
        )?;
        id
    } else if !plan.provider_id.is_empty() {
        plan.provider_id.clone()
    } else {
        return Err("命中的端点缺少所属供应商，已停止接入（不猜一个挂上去）".to_string());
    };

    let endpoint_id = if plan.create_endpoint {
        let id = new_id("ep");
        AiEndpointRepo::save(
            &db,
            &AiEndpointRow {
                id: id.clone(),
                provider_id: provider_id.clone(),
                name: "本地 Ollama".to_string(),
                // Ollama 的 OpenAI 兼容面就是 /v1/chat/completions，沿用既有协议实现，
                // 不为它再写一个 provider（那才是第二份真源）
                api_type: "openai-completions".to_string(),
                base_url: plan.openai_base_url.clone(),
                // 本地服务**没有 Key 这个概念**：认证方式就是 none（一个认证头都不发）。
                // 早先记成 bearer 是为了走 auth_header_for 的空 Bearer 兜底，那是将就，不是正解。
                auth_type: "none".to_string(),
                custom_auth_header: String::new(),
                enabled: true,
                created_at: now,
                updated_at: now,
            },
        )?;
        id
    } else {
        plan.endpoint_id.clone()
    };

    // 早先的自动接入把本地端点记成了 `bearer`（那会儿还没有 `none` 这个选项），每次调用都发一个
    // 空 Bearer。这里正名一次，**三个条件同时成立才动**：还是 bearer ＋ 地址在本机回环 ＋ 这家
    // 供应商的密钥本来就是空的。用户自己填过 key 或换过认证方式，一律不碰（同占位值补数的口径）。
    if !plan.create_endpoint {
        let rows = AiEndpointRepo::list_by_provider(&db, &provider_id)?;
        if let Some(mut ep) = rows.into_iter().find(|e| e.id == endpoint_id) {
            let key_empty = AiProviderRepo::get_by_id(&db, &provider_id)
                .map(|p| p.map(|p| p.api_key.trim().is_empty()).unwrap_or(true))
                .unwrap_or(true);
            if ep.auth_type == "bearer" && ollama::is_loopback_base_url(&ep.base_url) && key_empty {
                ep.auth_type = "none".to_string();
                ep.updated_at = now;
                AiEndpointRepo::save(&db, &ep)?;
            }
        }
    }

    let mut added: Vec<String> = Vec::new();
    for m in &plan.add {
        AiModelRepo::save(
            &db,
            &AiModelRow {
                id: new_id("mdl"),
                name: m.name.clone(),
                ref_key: m.ref_key.clone(),
                endpoint_id: endpoint_id.clone(),
                // 推理模型徽章由扫描到的能力表认出来（`/api/show` 的 capabilities 含 thinking）；
                // 服务没报就是 false。这两个字段目前只作徽章与元数据，不进请求构造。
                reasoning: m.reasoning,
                input_types: vec!["text".to_string()],
                // 上下文窗口**自动填**：本机 `/api/tags` 会报 `details.context_length`
                // （0.34.3 实测：qwen3:32b → 40960、gpt-oss:20b → 131072），判据在
                // `ollama::context_window_of` —— 报了就用报的，没报才退回占位值。
                // 本机 `/api/ps` 实测 gpt-oss 实际加载的 context_length 就是 131072（与自报一致）；
                // 但 Ollama 会按显存/`OLLAMA_CONTEXT_LENGTH` 自行取值，嫌大可在模型卡里调小。
                context_window: m.context_window,
                // 与手动添加模型的表单默认同口径（4096）：本地模型不许天生比云端少一半输出预算
                max_tokens: ollama::DEFAULT_MAX_TOKENS,
                enabled: true,
                created_at: now,
                updated_at: now,
            },
        )?;
        added.push(m.ref_key.clone());
    }
    // 补数：第 1 刀那批模型是在"扫不出上下文"的误判下建的，库里还挂着占位值。
    // 这次服务报出了真实值就补上，**只改 context_window 与 updated_at**，其余字段原样回写；
    // 用户在模型卡里改过的数值不会进这个列表（判据见 plan_adopt 第 4 条）。
    let mut refreshed: Vec<String> = Vec::new();
    if !plan.refresh.is_empty() {
        let rows = AiModelRepo::list_by_endpoint(&db, &endpoint_id)?;
        for r in &plan.refresh {
            let Some(row) = rows.iter().find(|x| x.ref_key == r.ref_key).cloned() else {
                continue; // 计划与库不一致（刚被删掉）：跳过，不猜一条新的出来
            };
            let mut row = row;
            row.context_window = r.context_window;
            row.updated_at = now;
            AiModelRepo::save(&db, &row)?;
            refreshed.push(r.ref_key.clone());
        }
    }
    Ok(OllamaAdoptResult {
        provider_id,
        endpoint_id,
        added,
        kept: plan.kept.clone(),
        refreshed,
        created_provider: plan.create_provider,
        created_endpoint: plan.create_endpoint,
    })
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
    // 与真实调用共用同一套 auth 装载（判据在 provider::with_auth_header），杜绝「测试通过但真实调用失败」的漂移。
    // auth_type = none 的本地服务（如本机 Ollama）一个认证头都不发 —— 本地没有 Key 这个概念。
    let req = crate::plugins::ai_agent::provider::with_auth_header(
        client.get(&url),
        &endpoint.auth_type,
        &endpoint.custom_auth_header,
        &provider.api_key,
    );

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

    // 用**这个模型库里配置的 max_tokens** 探，不再写死 10：
    // 推理模型的 token 先被 reasoning 吃掉，10 个必然只剩空正文，
    // 于是「测试成功」变成了假绿（本机 gpt-oss 实测 finish=length、content=""）。
    let probe_max = if model.max_tokens > 0 {
        model.max_tokens
    } else {
        512
    };
    let body = serde_json::json!({
        "model": model.ref_key,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": probe_max,
    });

    // 与真实调用共用同一套 auth 装载（判据在 provider::with_auth_header），杜绝「测试通过但真实调用失败」的漂移
    let mut req = crate::plugins::ai_agent::provider::with_auth_header(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body),
        &endpoint.auth_type,
        &endpoint.custom_auth_header,
        &provider.api_key,
    );

    if endpoint.api_type == "anthropic-messages" {
        req = req.header("anthropic-version", "2023-06-01");
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Model test failed (HTTP {}): {}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    // HTTP 200 只代表"打通了"，不代表"模型会回话"。以前这里只看状态就报成功，
    // 推理模型（token 先给 reasoning）实测能返回 200 + 空正文 —— 那就是假绿。
    // 现在把正文与截断原因一起说清楚，空正文绝不冒充成功。
    let raw = resp.text().await.unwrap_or_default();
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return Ok(format!(
                "Model reachable (HTTP {}) but the response is not JSON: {}",
                status,
                raw.chars().take(120).collect::<String>()
            ));
        }
    };
    let choice = v.get("choices").and_then(|c| c.get(0));
    let content = choice
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or_default();
    // anthropic-messages 的正文在 content[0].text，形状不同，两条路都要能测
    let content = if content.is_empty() {
        v.get("content")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or_default()
    } else {
        content
    };
    let finish = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|f| f.as_str())
        .unwrap_or("unknown");
    if !content.trim().is_empty() {
        let preview: String = content.trim().chars().take(60).collect();
        return Ok(format!(
            "Model test successful (HTTP {}): {}",
            status, preview
        ));
    }
    // 空正文不当成功：说清楚是"预算被吃掉"还是"根本没出内容"
    if finish == "length" {
        return Ok(format!(
            "Model reachable (HTTP {}) but returned no answer text: output budget exhausted (finish=length, max_tokens={}). Increase \"max output\" on this model.",
            status, probe_max
        ));
    }
    Ok(format!(
        "Model reachable (HTTP {}) but the answer text is empty (finish={}).",
        status, finish
    ))
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
