// sight-folio: AI Agent 数据仓储层
// 6 张表：ai_providers, ai_endpoints, ai_models, ai_agents, ai_conversations, ai_messages

use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::infrastructure::Database;

// ─── 数据行定义 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderRow {
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
pub struct AiEndpointRow {
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
pub struct AiModelRow {
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
pub struct AiAgentRow {
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
pub struct AiConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: String,
    pub created_at: i64,
}

// ─── Provider CRUD ───

pub struct AiProviderRepo;

impl AiProviderRepo {
    pub fn list(db: &Arc<Database>) -> Result<Vec<AiProviderRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, api_key, color, enabled, created_at, updated_at FROM ai_providers ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let enabled: i32 = row.get(4)?;
                Ok(AiProviderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    api_key: row.get(2)?,
                    color: row.get(3)?,
                    enabled: enabled != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, p: &AiProviderRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let enabled = if p.enabled { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO ai_providers (id, name, api_key, color, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![p.id, p.name, p.api_key, p.color, enabled, p.created_at, p.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 按 id 取单个 Provider（含明文 api_key，仅供后端内部使用；接口层一律走掩码 DTO）。
    pub fn get_by_id(db: &Arc<Database>, id: &str) -> Result<Option<AiProviderRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, api_key, color, enabled, created_at, updated_at FROM ai_providers WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([id], |row| {
                let enabled: i32 = row.get(4)?;
                Ok(AiProviderRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    api_key: row.get(2)?,
                    color: row.get(3)?,
                    enabled: enabled != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(row) => row.map(Some).map_err(|e| e.to_string()),
            None => Ok(None),
        }
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_models WHERE endpoint_id IN (SELECT id FROM ai_endpoints WHERE provider_id = ?1)", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_endpoints WHERE provider_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_providers WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Endpoint CRUD ───

pub struct AiEndpointRepo;

impl AiEndpointRepo {
    pub fn list(db: &Arc<Database>) -> Result<Vec<AiEndpointRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at FROM ai_endpoints ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let enabled: i32 = row.get(7)?;
                Ok(AiEndpointRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    name: row.get(2)?,
                    api_type: row.get(3)?,
                    base_url: row.get(4)?,
                    auth_type: row.get(5)?,
                    custom_auth_header: row.get(6)?,
                    enabled: enabled != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn list_by_provider(
        db: &Arc<Database>,
        provider_id: &str,
    ) -> Result<Vec<AiEndpointRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at FROM ai_endpoints WHERE provider_id = ?1 ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![provider_id], |row| {
                let enabled: i32 = row.get(7)?;
                Ok(AiEndpointRow {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    name: row.get(2)?,
                    api_type: row.get(3)?,
                    base_url: row.get(4)?,
                    auth_type: row.get(5)?,
                    custom_auth_header: row.get(6)?,
                    enabled: enabled != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, e: &AiEndpointRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let enabled = if e.enabled { 1 } else { 0 };
        conn.execute(
            "INSERT OR REPLACE INTO ai_endpoints (id, provider_id, name, api_type, base_url, auth_type, custom_auth_header, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![e.id, e.provider_id, e.name, e.api_type, e.base_url, e.auth_type, e.custom_auth_header, enabled, e.created_at, e.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_models WHERE endpoint_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_endpoints WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Model CRUD ───

pub struct AiModelRepo;

impl AiModelRepo {
    pub fn list(db: &Arc<Database>) -> Result<Vec<AiModelRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at FROM ai_models ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let reasoning: i32 = row.get(4)?;
                let enabled: i32 = row.get(8)?;
                let input_types_str: String = row.get(5)?;
                let input_types: Vec<String> = serde_json::from_str(&input_types_str)
                    .unwrap_or_else(|_| vec!["text".to_string()]);
                Ok(AiModelRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    ref_key: row.get(2)?,
                    endpoint_id: row.get(3)?,
                    reasoning: reasoning != 0,
                    input_types,
                    context_window: row.get(6)?,
                    max_tokens: row.get(7)?,
                    enabled: enabled != 0,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn list_by_endpoint(
        db: &Arc<Database>,
        endpoint_id: &str,
    ) -> Result<Vec<AiModelRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at FROM ai_models WHERE endpoint_id = ?1 ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![endpoint_id], |row| {
                let reasoning: i32 = row.get(4)?;
                let enabled: i32 = row.get(8)?;
                let input_types_str: String = row.get(5)?;
                let input_types: Vec<String> = serde_json::from_str(&input_types_str)
                    .unwrap_or_else(|_| vec!["text".to_string()]);
                Ok(AiModelRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    ref_key: row.get(2)?,
                    endpoint_id: row.get(3)?,
                    reasoning: reasoning != 0,
                    input_types,
                    context_window: row.get(6)?,
                    max_tokens: row.get(7)?,
                    enabled: enabled != 0,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, m: &AiModelRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let enabled = if m.enabled { 1 } else { 0 };
        let reasoning = if m.reasoning { 1 } else { 0 };
        let input_types_json =
            serde_json::to_string(&m.input_types).unwrap_or_else(|_| "[\"text\"]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO ai_models (id, name, ref_key, endpoint_id, reasoning, input_types, context_window, max_tokens, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![m.id, m.name, m.ref_key, m.endpoint_id, reasoning, input_types_json, m.context_window, m.max_tokens, enabled, m.created_at, m.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_models WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Agent CRUD ───

pub struct AiAgentRepo;

impl AiAgentRepo {
    pub fn list(db: &Arc<Database>) -> Result<Vec<AiAgentRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, created_at, updated_at FROM ai_agents ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let tool_ids_str: String = row.get(7)?;
                let tool_ids: Vec<String> = serde_json::from_str(&tool_ids_str).unwrap_or_default();
                Ok(AiAgentRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    model_id: row.get(3)?,
                    system_prompt: row.get(4)?,
                    temperature: row.get(5)?,
                    max_iterations: row.get(6)?,
                    tool_ids,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, a: &AiAgentRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let tool_ids_json = serde_json::to_string(&a.tool_ids).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO ai_agents (id, name, description, model_id, system_prompt, temperature, max_iterations, tool_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![a.id, a.name, a.description, a.model_id, a.system_prompt, a.temperature, a.max_iterations, tool_ids_json, a.created_at, a.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_conversations WHERE agent_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_agents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Conversation CRUD ───

pub struct AiConversationRepo;

impl AiConversationRepo {
    pub fn list_by_agent(
        db: &Arc<Database>,
        agent_id: &str,
    ) -> Result<Vec<AiConversationRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, agent_id, title, created_at, updated_at FROM ai_conversations WHERE agent_id = ?1 ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![agent_id], |row| {
                Ok(AiConversationRow {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, c: &AiConversationRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO ai_conversations (id, agent_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![c.id, c.agent_id, c.title, c.created_at, c.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_messages WHERE conversation_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_conversations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ─── Message CRUD ───

pub struct AiMessageRepo;

impl AiMessageRepo {
    pub fn list_by_conversation(
        db: &Arc<Database>,
        conversation_id: &str,
    ) -> Result<Vec<AiMessageRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, conversation_id, role, content, tool_calls, created_at FROM ai_messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![conversation_id], |row| {
                Ok(AiMessageRow {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    tool_calls: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn save(db: &Arc<Database>, m: &AiMessageRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, tool_calls, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.created_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Delete the given messages (by id) inside a single transaction.
    ///
    /// Needed by the chat panel's "retry" / "edit & resend" actions: both must drop the
    /// tail of the transcript before re-running it, otherwise the same request would be
    /// persisted twice and the model would see a duplicated turn on the next round.
    /// Scoped to explicit ids on purpose - never "delete everything after a timestamp",
    /// because created_at ties would silently take neighbouring rows with them.
    pub fn delete_many(db: &Arc<Database>, ids: &[String]) -> Result<usize, String> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut removed = 0usize;
        {
            let mut stmt = tx
                .prepare("DELETE FROM ai_messages WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            for id in ids {
                removed += stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(removed)
    }
}

// ─── AI 上下文包（模块供给者产物持久化）───

/// serde 缺省值：未声明可信度的分节存 "{}"，读侧按「可信」处理（兼容旧调用方与历史行）
fn empty_json_object() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSectionInput {
    pub section_key: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub token_estimate: i64,
    pub priority: i64,
    pub facts_json: String,
    /// 分节数据可信度 JSON（前端 dataQuality 判定，后端只透传存取）。
    /// 缺省 "{}" 表示未声明，读侧按「可信」处理，兼容历史数据。
    #[serde(default = "empty_json_object")]
    pub data_quality_json: String,
    /// 分节内容指纹（前端 sectionDiff 计算，后端只透传存取）
    #[serde(default)]
    pub digest: String,
    /// 内容最后一次真正变化的时刻（ms）；0 表示未知
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextPackRow {
    pub id: String,
    pub scope_id: String,
    pub module_id: String,
    pub scope_label: String,
    pub schema_version: i64,
    pub generated_at: i64,
    pub token_estimate: i64,
    pub digest: String,
    pub truncated_sections: Vec<String>,
    pub section_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSectionRow {
    pub id: String,
    pub pack_id: String,
    pub section_key: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub token_estimate: i64,
    pub priority: i64,
    pub facts_json: String,
    pub data_quality_json: String,
    pub digest: String,
    pub updated_at: i64,
}

/// 分节戳：只带指纹与时间，不带正文。
/// 持久化层用它水合「上次写了什么」，UI 也可用它展示新鲜度——
/// 关键是**不把几十 KB 正文读出来**，否则增量判定本身就成了开销。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSectionStamp {
    pub section_key: String,
    pub digest: String,
    pub updated_at: i64,
    pub token_estimate: i64,
}

pub struct AiContextPackRepo;

impl AiContextPackRepo {
    /// 保存整个包（pack 级 + 所有分节），在一个事务内完成：先删旧分节再插入，pack_id 唯一即覆盖。
    pub fn save_pack(
        db: &Arc<Database>,
        pack: &AiContextPackRow,
        sections: &[AiContextSectionInput],
    ) -> Result<(), String> {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO ai_context_packs
             (id, scope_id, module_id, scope_label, schema_version, generated_at, token_estimate, digest, truncated_sections, section_keys, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10, strftime('%s','now'))",
            params![
                pack.id, pack.scope_id, pack.module_id, pack.scope_label,
                pack.schema_version, pack.generated_at, pack.token_estimate, pack.digest,
                serde_json::to_string(&pack.truncated_sections).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&pack.section_keys).unwrap_or_else(|_| "[]".to_string()),
            ],
        ).map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM ai_context_sections WHERE pack_id = ?1",
            params![pack.id],
        )
        .map_err(|e| e.to_string())?;
        for sec in sections {
            let sid = format!("{}#{}", pack.id, sec.section_key);
            tx.execute(
                "INSERT OR REPLACE INTO ai_context_sections
                 (id, pack_id, section_key, title, summary, content, token_estimate, priority, facts_json, data_quality_json, digest, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    sid, pack.id, sec.section_key, sec.title, sec.summary, sec.content,
                    sec.token_estimate, sec.priority, sec.facts_json, sec.data_quality_json,
                    sec.digest, sec.updated_at,
                ],
            ).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 分节级增量保存：更新包元信息 + **只重写传入的分节**，不动其余分节。
    ///
    /// 与 save_pack 的关键差别是没有 `DELETE FROM ai_context_sections`。
    /// 增量重扫下大部分分节内容原封不动，整包重写既浪费 IO，又会把所有分节的
    /// updated_at 一起刷新，Agent 就再也分不清「哪一节真的变了」——增量分析随之失效。
    ///
    /// 调用方（前端 decidePersistMode）负责保证分节集合与库内一致；
    /// 集合有增删时应走 save_pack 整包重写，否则这里会留下孤儿分节。
    pub fn save_sections_partial(
        db: &Arc<Database>,
        pack: &AiContextPackRow,
        sections: &[AiContextSectionInput],
    ) -> Result<usize, String> {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        // 这里**必须**用 UPSERT（ON CONFLICT DO UPDATE），不能用 INSERT OR REPLACE：
        // REPLACE 的语义是「先 DELETE 再 INSERT」，而 ai_context_sections 对 pack_id 挂了
        // ON DELETE CASCADE —— 删一次包行就会把全部分节连根带走，
        // 增量保存反而变成「只剩这次写入的那几节」的数据丢失事故。
        tx.execute(
            "INSERT INTO ai_context_packs
             (id, scope_id, module_id, scope_label, schema_version, generated_at, token_estimate, digest, truncated_sections, section_keys, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10, strftime('%s','now'))
             ON CONFLICT(id) DO UPDATE SET
                scope_id = excluded.scope_id,
                module_id = excluded.module_id,
                scope_label = excluded.scope_label,
                schema_version = excluded.schema_version,
                generated_at = excluded.generated_at,
                token_estimate = excluded.token_estimate,
                digest = excluded.digest,
                truncated_sections = excluded.truncated_sections,
                section_keys = excluded.section_keys",
            params![
                pack.id, pack.scope_id, pack.module_id, pack.scope_label,
                pack.schema_version, pack.generated_at, pack.token_estimate, pack.digest,
                serde_json::to_string(&pack.truncated_sections).unwrap_or_else(|_| "[]".to_string()),
                serde_json::to_string(&pack.section_keys).unwrap_or_else(|_| "[]".to_string()),
            ],
        ).map_err(|e| e.to_string())?;

        let mut written = 0usize;
        for sec in sections {
            let sid = format!("{}#{}", pack.id, sec.section_key);
            tx.execute(
                "INSERT OR REPLACE INTO ai_context_sections
                 (id, pack_id, section_key, title, summary, content, token_estimate, priority, facts_json, data_quality_json, digest, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                params![
                    sid, pack.id, sec.section_key, sec.title, sec.summary, sec.content,
                    sec.token_estimate, sec.priority, sec.facts_json, sec.data_quality_json,
                    sec.digest, sec.updated_at,
                ],
            ).map_err(|e| e.to_string())?;
            written += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(written)
    }

    pub fn get_pack(db: &Arc<Database>, id: &str) -> Result<Option<AiContextPackRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, scope_id, module_id, scope_label, schema_version, generated_at, token_estimate, digest, truncated_sections, section_keys \
                 FROM ai_context_packs WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![id], |row| {
                let ts: String = row.get(8)?;
                let sk: String = row.get(9)?;
                Ok(AiContextPackRow {
                    id: row.get(0)?,
                    scope_id: row.get(1)?,
                    module_id: row.get(2)?,
                    scope_label: row.get(3)?,
                    schema_version: row.get(4)?,
                    generated_at: row.get(5)?,
                    token_estimate: row.get(6)?,
                    digest: row.get(7)?,
                    truncated_sections: serde_json::from_str(&ts).unwrap_or_default(),
                    section_keys: serde_json::from_str(&sk).unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(r)) => Ok(Some(r)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn list_packs(
        db: &Arc<Database>,
        scope_id: Option<&str>,
    ) -> Result<Vec<AiContextPackRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let rows = if let Some(sid) = scope_id {
            let mut stmt = conn
                .prepare(
                    "SELECT id, scope_id, module_id, scope_label, schema_version, generated_at, token_estimate, digest, truncated_sections, section_keys \
                     FROM ai_context_packs WHERE scope_id = ?1 ORDER BY generated_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(rusqlite::params![sid], |row| {
                    let ts: String = row.get(8)?;
                    let sk: String = row.get(9)?;
                    Ok(AiContextPackRow {
                        id: row.get(0)?,
                        scope_id: row.get(1)?,
                        module_id: row.get(2)?,
                        scope_label: row.get(3)?,
                        schema_version: row.get(4)?,
                        generated_at: row.get(5)?,
                        token_estimate: row.get(6)?,
                        digest: row.get(7)?,
                        truncated_sections: serde_json::from_str(&ts).unwrap_or_default(),
                        section_keys: serde_json::from_str(&sk).unwrap_or_default(),
                    })
                })
                .map_err(|e| e.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, scope_id, module_id, scope_label, schema_version, generated_at, token_estimate, digest, truncated_sections, section_keys \
                     FROM ai_context_packs ORDER BY generated_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(rusqlite::params![], |row| {
                    let ts: String = row.get(8)?;
                    let sk: String = row.get(9)?;
                    Ok(AiContextPackRow {
                        id: row.get(0)?,
                        scope_id: row.get(1)?,
                        module_id: row.get(2)?,
                        scope_label: row.get(3)?,
                        schema_version: row.get(4)?,
                        generated_at: row.get(5)?,
                        token_estimate: row.get(6)?,
                        digest: row.get(7)?,
                        truncated_sections: serde_json::from_str(&ts).unwrap_or_default(),
                        section_keys: serde_json::from_str(&sk).unwrap_or_default(),
                    })
                })
                .map_err(|e| e.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        Ok(rows)
    }

    pub fn delete_pack(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_context_packs WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub struct AiContextSectionRepo;

impl AiContextSectionRepo {
    pub fn list_by_pack(
        db: &Arc<Database>,
        pack_id: &str,
    ) -> Result<Vec<AiContextSectionRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, pack_id, section_key, title, summary, content, token_estimate, priority, facts_json, data_quality_json, digest, updated_at \
                 FROM ai_context_sections WHERE pack_id = ?1 ORDER BY priority ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pack_id], |row| {
                Ok(AiContextSectionRow {
                    id: row.get(0)?,
                    pack_id: row.get(1)?,
                    section_key: row.get(2)?,
                    title: row.get(3)?,
                    summary: row.get(4)?,
                    content: row.get(5)?,
                    token_estimate: row.get(6)?,
                    priority: row.get(7)?,
                    facts_json: row.get(8)?,
                    data_quality_json: row.get(9)?,
                    digest: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    /// 只取分节戳（指纹 + 更新时间 + token 估算），**不读正文**。
    /// 增量判定与新鲜度展示都只需要这些，读正文会让「省 IO」的初衷落空。
    pub fn list_stamps(
        db: &Arc<Database>,
        pack_id: &str,
    ) -> Result<Vec<AiContextSectionStamp>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT section_key, digest, updated_at, token_estimate \
                 FROM ai_context_sections WHERE pack_id = ?1 ORDER BY priority ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pack_id], |row| {
                Ok(AiContextSectionStamp {
                    section_key: row.get(0)?,
                    digest: row.get(1)?,
                    updated_at: row.get(2)?,
                    token_estimate: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }

    pub fn get_section(
        db: &Arc<Database>,
        pack_id: &str,
        section_key: &str,
    ) -> Result<Option<AiContextSectionRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, pack_id, section_key, title, summary, content, token_estimate, priority, facts_json, data_quality_json, digest, updated_at \
                 FROM ai_context_sections WHERE pack_id = ?1 AND section_key = ?2",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![pack_id, section_key], |row| {
                Ok(AiContextSectionRow {
                    id: row.get(0)?,
                    pack_id: row.get(1)?,
                    section_key: row.get(2)?,
                    title: row.get(3)?,
                    summary: row.get(4)?,
                    content: row.get(5)?,
                    token_estimate: row.get(6)?,
                    priority: row.get(7)?,
                    facts_json: row.get(8)?,
                    data_quality_json: row.get(9)?,
                    digest: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(r)) => Ok(Some(r)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }
}

// ─── AI 洞察（Agent 基于上下文包产出的结论沉淀）───

/// 一条证据的快照：结论产出当时，被点名的那个文件是什么内容。
///
/// `hash` 为 None 有两种情况，含义不同但都表示「无从比对」：
///   · 该引用在当时就没能对应到任何扫描到的文件（模型写错或写了幻觉路径）；
///   · 对应到的是目录，目录没有内容哈希。
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsightEvidence {
    /// 规范化后的相对路径（已剥掉 `:行号`）
    pub path: String,
    /// 结论产出当时该文件的 content_hash
    pub hash: Option<String>,
}

/// 结论时效：拿当前扫描结果回头验证「这条结论所依据的代码还是不是当初那份」。
///
/// 为什么必须有这个概念：洞察是**对某一时刻代码的判断**，而代码天天在变。
/// 没有时效，沉淀就只会单调增长——改完的问题继续挂在面板上，Agent 每轮
/// 还要重新读一遍已经不成立的结论，既误导人又烧 token。
pub mod insight_freshness {
    /// 证据仍在且内容未变，结论继续成立
    pub const CURRENT: &str = "current";
    /// 至少一处证据的内容已变（或部分文件已消失）——需要复核
    pub const STALE: &str = "stale";
    /// 全部证据文件都已不存在——可能已修复、也可能只是搬了家
    pub const ORPHANED: &str = "orphaned";
    /// 结论没有可用证据（没写 refs 或全都解析不出路径），无法判定时效
    pub const UNANCHORED: &str = "unanchored";
    /// 无从比对：该分析当前没有文件快照，或这是没有证据快照的历史数据
    pub const UNKNOWN: &str = "unknown";
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiInsightRow {
    pub id: String,
    pub pack_id: Option<String>,
    pub analysis_id: String,
    pub agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub severity: String,
    pub refs: Vec<String>,
    /// 去重指纹（analysis_id|kind|severity|normalized_title），命中即同一结论
    pub fingerprint: Option<String>,
    /// 同一结论被不同分析轮次确认的次数（去重累加）
    pub seen_count: i64,
    /// 首次记录时间戳
    pub first_seen: i64,
    /// 最近一次确认时间戳
    pub last_seen: i64,
    /// 证据快照（保存时按当次扫描结果解析，列表时用于比对）
    #[serde(default)]
    pub evidence: Vec<InsightEvidence>,
    /// 时效判定，取值见 [`insight_freshness`]；仅在读取时填充，保存时忽略
    #[serde(default)]
    pub freshness: String,
    /// 内容已变的证据路径（结论据此需要复核）
    #[serde(default)]
    pub changed_refs: Vec<String>,
    /// 已不存在的证据路径
    #[serde(default)]
    pub missing_refs: Vec<String>,
    /// 证据**现状**指纹（各证据路径此刻的内容哈希聚合）；仅在读取时填充。
    /// 上层用它判断「这次的证据变化是否已经派过复核单」，见 [`AiInsightRepo::evidence_state_digest`]。
    #[serde(default)]
    pub evidence_digest: String,
    /// 生命周期状态：`open`（仍占用注意力）或 `resolved`（已复核收口）。
    /// 保存时忽略——一条结论只能被显式 resolve 关闭，不允许写入时顺手关掉自己。
    #[serde(default)]
    pub status: String,
    /// 关闭时间戳（秒）；未关闭为 0
    #[serde(default)]
    pub resolved_at: i64,
    /// 关闭理由（必填），例如「重复实现已合并，函数不复存在」
    #[serde(default)]
    pub resolved_reason: Option<String>,
    /// 关闭者：Agent id 或 `user`
    #[serde(default)]
    pub resolved_by: Option<String>,
    /// G4 回扫验证：诊断会话 id（来自 triggerDiagnosis 建的会话），用于重扫后反查本次诊断产出的洞察
    #[serde(default)]
    pub diagnosis_id: String,
    /// G4 回扫验证：这条洞察最初针对的分析点类型（syntax/review/complexity…），verify 据此选判定逻辑
    #[serde(default)]
    pub source_kind: String,
}

/// 洞察生命周期状态。
///
/// 只有两档，刻意不做「处理中 / 已忽略」等中间态：状态越多 Agent 越容易乱填，
/// 而这套沉淀真正要回答的只有一个问题——**这条结论现在还要不要占用注意力**。
pub mod insight_status {
    pub const OPEN: &str = "open";
    pub const RESOLVED: &str = "resolved";
}

/// 某次分析当前的文件快照：路径 → 内容哈希，外加目录集合与唯一 basename 索引。
///
/// 一次查询装载，供该分析下所有洞察共用——洞察可能有几十上百条，
/// 逐条回表查文件会把「读列表」变成 N+1。
#[derive(Debug, Default)]
pub struct AnalysisFileSnapshot {
    /// rel_path → content_hash（无哈希的文件记空串）
    pub hashes: std::collections::HashMap<String, String>,
    pub dirs: std::collections::HashSet<String>,
    /// 项目内唯一的文件名 → 其完整相对路径（模型常只写文件名）
    pub unique_basename: std::collections::HashMap<String, String>,
    /// rel_path → 行数（0 表示扫描没统计出来，此时一律不判越界）
    pub lines: std::collections::HashMap<String, i64>,
    /// 文件名 → 所有同名文件的完整路径（重名时用于给 Agent 列候选）
    pub by_basename: std::collections::HashMap<String, Vec<String>>,
}

impl AnalysisFileSnapshot {
    pub fn is_empty(&self) -> bool {
        self.hashes.is_empty() && self.dirs.is_empty()
    }

    /// 这个文件一共多少行；扫描没统计到（0）时返回 None，调用方据此放弃越界判定。
    pub fn line_count(&self, path: &str) -> Option<i64> {
        self.lines.get(path).copied().filter(|n| *n > 0)
    }

    /// 给一个对不上的引用找最接近的真实路径，最多 `max` 个。
    ///
    /// 这是「拒绝」之外的另一半——只说「你写的路径不存在」，模型下一轮多半原样再编一遍；
    /// 把候选摆出来，它就能自己改对。检索按可信度递减：
    ///   ① 同名文件（重名，所以 unique_basename 没兜住）；
    ///   ② 真实路径以模型写的片段结尾（模型常省略前缀，如写 `ai/tools.rs`）；
    ///   ③ 文件名相同的主干（去扩展名），覆盖 `.ts` 猜成 `.tsx` 这类；
    ///   ④ 目录同名。
    /// 不做编辑距离——模糊匹配一旦放宽，候选就会变成噪音，反而诱导模型挑错的那个。
    pub fn nearest(&self, path: &str, max: usize) -> Vec<String> {
        if path.is_empty() || max == 0 {
            return Vec::new();
        }
        let mut out: Vec<String> = Vec::new();
        let push = |p: &str, out: &mut Vec<String>| {
            if out.len() < max && !out.iter().any(|x| x == p) {
                out.push(p.to_string());
            }
        };

        let base = path.rsplit('/').next().unwrap_or(path).to_string();
        if let Some(list) = self.by_basename.get(&base) {
            for p in list {
                push(p, &mut out);
            }
        }

        let tail = format!("/{}", path.trim_start_matches('/'));
        if out.len() < max {
            let mut hits: Vec<&String> =
                self.hashes.keys().filter(|p| p.ends_with(&tail)).collect();
            hits.sort();
            for p in hits {
                push(p, &mut out);
            }
        }

        if out.len() < max {
            let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(&base);
            if !stem.is_empty() {
                let mut hits: Vec<&String> = self
                    .by_basename
                    .iter()
                    .filter(|(b, _)| b.rsplit_once('.').map(|(s, _)| s).unwrap_or(b) == stem)
                    .flat_map(|(_, list)| list.iter())
                    .collect();
                hits.sort();
                for p in hits {
                    push(p, &mut out);
                }
            }
        }

        if out.len() < max {
            let mut hits: Vec<&String> = self
                .dirs
                .iter()
                .filter(|d| d.rsplit('/').next().unwrap_or(d) == base)
                .collect();
            hits.sort();
            for p in hits {
                push(p, &mut out);
            }
        }

        out
    }

    /// 把模型写的引用对齐到真实路径。
    ///
    /// 顺序：精确文件 → 精确目录 → 唯一文件名回退。
    /// 「唯一」是硬性要求：`index.ts` 这种项目里有几十份的名字，硬猜会把结论
    /// 挂到无辜的文件上，比判成「对不上」危害更大。
    pub fn resolve(&self, path: &str) -> Option<(String, Option<String>)> {
        if path.is_empty() {
            return None;
        }
        if let Some(h) = self.hashes.get(path) {
            return Some((path.to_string(), non_empty(h)));
        }
        if self.dirs.contains(path) {
            return Some((path.to_string(), None));
        }
        let base = path.rsplit('/').next().unwrap_or(path);
        if let Some(full) = self.unique_basename.get(base) {
            let h = self.hashes.get(full).and_then(|h| non_empty(h));
            return Some((full.clone(), h));
        }
        None
    }

    fn exists(&self, path: &str) -> bool {
        self.hashes.contains_key(path) || self.dirs.contains(path)
    }
}

fn non_empty(s: &str) -> Option<String> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// 规范化模型写的引用：剥 `:行号`、统一分隔符、去 `./` 与尾斜杠。
///
/// 与前端 `normalizeRefPath` 保持同一套语义——同一个字符串在前后端解析成
/// 不同路径，会让画布角标与报告标记出现无法解释的分歧。
pub fn normalize_ref_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();

    // 尾部 `:数字` 视为行号（`:12:5` 这种连剥两次）
    for _ in 0..2 {
        if let Some(idx) = s.rfind(':') {
            if idx > 0
                && s[idx + 1..].trim().chars().all(|c| c.is_ascii_digit())
                && idx + 1 < s.len()
            {
                s = s[..idx].to_string();
                continue;
            }
        }
        break;
    }

    s = s.replace('\\', "/");
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    let mut s = s.trim().to_string();
    while s.starts_with("./") {
        s = s[2..].to_string();
    }
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

/// 从模型写的引用里把行号取出来（`src/a.ts:120` → 120，`src/a.ts:120:8` 取 120）。
///
/// 与 `normalize_ref_path` 剥行号的规则严格对称：那边剥掉什么，这边就取出什么，
/// 否则会出现「路径按剥两段算、行号按剥一段取」的错位。
pub fn split_ref_line(raw: &str) -> (String, Option<i64>) {
    let path = normalize_ref_path(raw);
    let mut s = raw.trim().to_string();
    let mut nums: Vec<i64> = Vec::new();
    for _ in 0..2 {
        if let Some(idx) = s.rfind(':') {
            let tail = s[idx + 1..].trim().to_string();
            if idx > 0 && !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(n) = tail.parse::<i64>() {
                    nums.push(n);
                }
                s = s[..idx].to_string();
                continue;
            }
        }
        break;
    }
    // 剥的顺序是从右往左，`:行:列` 时最后剥下的才是行号
    (path, nums.pop().filter(|n| *n > 0))
}

/// 单条引用的核验结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefCheck {
    /// 模型原样写的引用
    pub raw: String,
    /// 核对后应当落库的引用（对齐真实路径、必要时去掉越界行号）；无效时为空
    pub normalized: String,
    /// 核对后的真实路径；无效时为空
    pub path: String,
    /// exact / aligned / line-out-of-range / unverifiable / unknown
    pub status: &'static str,
    /// unknown 时给出的最接近候选（最多 3 个）
    pub candidates: Vec<String>,
    /// 面向 Agent 的一句话说明（为空表示无需解释）
    pub note: String,
}

impl RefCheck {
    pub fn is_accepted(&self) -> bool {
        self.status != ref_check_status::UNKNOWN
    }
}

pub mod ref_check_status {
    /// 路径与扫描结果精确一致
    pub const EXACT: &str = "exact";
    /// 模型只写了文件名（或省略了前缀），已对齐到项目内唯一的真实路径
    pub const ALIGNED: &str = "aligned";
    /// 文件存在但行号超出文件行数，已丢弃行号只保留文件
    pub const LINE_OUT_OF_RANGE: &str = "line-out-of-range";
    /// 项目还没扫过，没有对照物，一律放行
    pub const UNVERIFIABLE: &str = "unverifiable";
    /// 扫描结果里没有这个位置
    pub const UNKNOWN: &str = "unknown";
}

/// 一次保存里全部引用的核验结果。
#[derive(Debug, Clone, Default)]
pub struct RefVerdict {
    pub checks: Vec<RefCheck>,
}

impl RefVerdict {
    /// 应当落库的引用（保持模型给出的顺序，去重）
    pub fn accepted_refs(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for c in self.checks.iter().filter(|c| c.is_accepted()) {
            if !c.normalized.is_empty() && !out.iter().any(|x| *x == c.normalized) {
                out.push(c.normalized.clone());
            }
        }
        out
    }

    pub fn rejected(&self) -> Vec<&RefCheck> {
        self.checks.iter().filter(|c| !c.is_accepted()).collect()
    }

    /// 被修正过的引用（对齐路径 / 丢弃越界行号），需要回话告诉 Agent
    pub fn corrected(&self) -> Vec<&RefCheck> {
        self.checks
            .iter()
            .filter(|c| {
                c.status == ref_check_status::ALIGNED
                    || c.status == ref_check_status::LINE_OUT_OF_RANGE
            })
            .collect()
    }

    pub fn has_any(&self) -> bool {
        !self.checks.is_empty()
    }

    /// 引用全军覆没：给了引用，但没有一条对得上扫描结果
    pub fn all_rejected(&self) -> bool {
        self.has_any() && self.checks.iter().all(|c| !c.is_accepted())
    }
}

pub struct AiInsightRepo;

impl AiInsightRepo {
    /// 逐条核对 refs 是否真的存在于这次扫描的结果里。
    ///
    /// 存在的意义不是「挑刺」，而是**在结论落库之前就把幻觉挡在门外**：
    /// 一条挂着不存在路径的结论，画布标不上、报告标红、用户点了跳不过去，
    /// 但它已经作为「项目的既有结论」沉淀下来，还会在后续轮次里被反复重新确认。
    /// 事后在报告里标 UNVERIFIED 只是止损，此刻拦下并把候选还给 Agent 才是纠偏。
    ///
    /// 三条底线：
    /// · 快照为空（项目没扫过）→ 全部放行，绝不因为「我们没数据」去否定模型；
    /// · 只在文件名项目内唯一时才做对齐，重名一律判 unknown 并列候选；
    /// · 行号越界只丢行号不丢文件——文件本身是对的，没必要连结论一起废掉。
    pub fn verify_refs(snap: &AnalysisFileSnapshot, refs: &[String]) -> RefVerdict {
        let mut verdict = RefVerdict::default();
        for raw in refs {
            let (path, line) = split_ref_line(raw);
            if path.is_empty() {
                continue;
            }
            if snap.is_empty() {
                verdict.checks.push(RefCheck {
                    raw: raw.clone(),
                    normalized: raw.trim().to_string(),
                    path,
                    status: ref_check_status::UNVERIFIABLE,
                    candidates: Vec::new(),
                    note: String::new(),
                });
                continue;
            }

            let hit = snap.resolve(&path);
            let Some((real, _)) = hit else {
                verdict.checks.push(RefCheck {
                    raw: raw.clone(),
                    normalized: String::new(),
                    path: String::new(),
                    status: ref_check_status::UNKNOWN,
                    candidates: snap.nearest(&path, 3),
                    note: String::new(),
                });
                continue;
            };

            let aligned = real != path;
            match (line, snap.line_count(&real)) {
                (Some(n), Some(total)) if n > total => verdict.checks.push(RefCheck {
                    raw: raw.clone(),
                    normalized: real.clone(),
                    path: real.clone(),
                    status: ref_check_status::LINE_OUT_OF_RANGE,
                    candidates: Vec::new(),
                    note: format!("该文件只有 {} 行，已丢弃行号 {}", total, n),
                }),
                _ => {
                    let normalized = match line {
                        Some(n) => format!("{}:{}", real, n),
                        None => real.clone(),
                    };
                    verdict.checks.push(RefCheck {
                        raw: raw.clone(),
                        normalized,
                        path: real.clone(),
                        status: if aligned {
                            ref_check_status::ALIGNED
                        } else {
                            ref_check_status::EXACT
                        },
                        candidates: Vec::new(),
                        note: if aligned {
                            format!("已对齐到真实路径 {}", real)
                        } else {
                            String::new()
                        },
                    });
                }
            }
        }
        verdict
    }

    /// 便捷入口：直接按 analysis_id 装载快照再核验（工具层用）
    pub fn verify_refs_for(
        db: &Arc<Database>,
        analysis_id: &str,
        refs: &[String],
    ) -> Result<RefVerdict, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let snap = Self::load_file_snapshot(&conn, analysis_id);
        Ok(Self::verify_refs(&snap, refs))
    }

    /// 当前 Unix 秒（与表内 strftime('%s','now') 语义一致，便于 UPDATE 复用）
    fn now_ts(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("SELECT CAST(strftime('%s','now') AS INTEGER)", [], |r| {
            r.get(0)
        })
        .unwrap_or(0)
    }

    /// 同一结论的指纹：分析 + 类型 + 规范化标题。
    ///
    /// 设计取舍：
    /// · 去掉 severity —— 同一条结论在不同分析轮次里可能被重新定级（high→medium），
    ///   此时应当「归并到同一行、用最新严重度就地覆盖」，而不是因为严重度不同就新建一行。
    ///   `save_dedup` 的 UPDATE 分支本来就会刷新 severity，所以指纹不含 severity 才自洽。
    /// · 标题做强归一：小写 + 仅保留字母数字与汉字 + 多空白坍缩单空格 + 丢弃标点，
    ///   这样「Extract Duplicated Config Loader!」与「extract duplicated config loader」
    ///   会被判为同一结论，跨轮重分析 / 换模型措辞也不会漏掉归并（既省 token 又不污染沉淀）。
    fn compute_fingerprint(analysis_id: &str, kind: &str, title: &str) -> String {
        let norm = Self::normalize_title(title);
        let norm = if norm.is_empty() {
            title.trim().to_lowercase()
        } else {
            norm
        };
        format!("{}|{}|{}", analysis_id, kind.trim().to_lowercase(), norm)
    }

    /// 标题强归一：小写，仅保留字母 / 数字 / 汉字与空白，多空白坍缩为单空格，其余（标点、符号、emoji）丢弃。
    fn normalize_title(title: &str) -> String {
        let mut out = String::with_capacity(title.len());
        let mut last_space = false;
        for ch in title.trim().chars() {
            let c = ch.to_lowercase().next().unwrap_or(ch);
            if c.is_alphanumeric() {
                out.push(c);
                last_space = false;
            } else if c.is_whitespace() {
                if !last_space && !out.is_empty() {
                    out.push(' ');
                    last_space = true;
                }
            }
            // 其他字符（标点、符号、emoji 等）直接丢弃
        }
        out.trim().to_string()
    }

    /// 装载某次分析当前的文件快照（路径 / 哈希 / 目录 / 唯一文件名）。
    ///
    /// 项目还没扫过（或分析 id 对不上）时返回空快照——调用方据此把时效判成
    /// `unknown` 而不是 `orphaned`：没有对照物时说「文件都不见了」是彻头彻尾的误报。
    pub(crate) fn load_file_snapshot(
        conn: &rusqlite::Connection,
        analysis_id: &str,
    ) -> AnalysisFileSnapshot {
        use std::collections::HashMap;

        let mut snap = AnalysisFileSnapshot::default();
        let mut by_basename: HashMap<String, Vec<String>> = HashMap::new();

        let mut stmt = match conn.prepare(
            "SELECT rel_path, COALESCE(content_hash,''), is_directory, COALESCE(line_count,0) \
             FROM project_files WHERE analysis_id = ?1",
        ) {
            Ok(s) => s,
            Err(_) => return snap,
        };
        let iter = stmt.query_map(params![analysis_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        });
        let Ok(iter) = iter else {
            return snap;
        };

        for item in iter.flatten() {
            let (rel_path, hash, is_dir, line_count) = item;
            let path = normalize_ref_path(&rel_path);
            if path.is_empty() {
                continue;
            }
            if is_dir != 0 {
                snap.dirs.insert(path);
                continue;
            }
            let base = path.rsplit('/').next().unwrap_or(&path).to_string();
            by_basename.entry(base).or_default().push(path.clone());
            if line_count > 0 {
                snap.lines.insert(path.clone(), line_count);
            }
            snap.hashes.insert(path, hash);
        }

        for (base, list) in &by_basename {
            if list.len() == 1 {
                snap.unique_basename.insert(base.clone(), list[0].clone());
            }
        }
        for list in by_basename.values_mut() {
            list.sort();
        }
        snap.by_basename = by_basename;
        snap
    }

    /// 把 refs 冻结成证据快照。解析不到的引用照样留一条（hash=None），
    /// 因为「模型点了一个不存在的位置」本身就是需要被记录的事实，抹掉等于替它掩盖。
    pub(crate) fn build_evidence(
        snap: &AnalysisFileSnapshot,
        refs: &[String],
    ) -> Vec<InsightEvidence> {
        let mut out: Vec<InsightEvidence> = Vec::new();
        for raw in refs {
            let path = normalize_ref_path(raw);
            if path.is_empty() {
                continue;
            }
            let (path, hash) = match snap.resolve(&path) {
                Some(v) => v,
                None => (path, None),
            };
            // 同一条结论重复点名同一文件（不同行号）只冻结一次
            if out.iter().any(|e| e.path == path) {
                continue;
            }
            out.push(InsightEvidence { path, hash });
        }
        out
    }

    /// 拿当前快照比对证据快照，判定这条结论是否还站得住。
    ///
    /// 判定优先级刻意保守：
    ///   · 全部证据消失 → orphaned（很可能已重构掉，但不敢直接判「已解决」）；
    ///   · 有任何一处变了或少了 → stale（宁可多提醒一次复核，也不放过失效结论）；
    ///   · 有证据但完全无从比对（历史数据没快照）→ unknown，绝不冒充 current。
    pub(crate) fn classify_freshness(
        evidence: &[InsightEvidence],
        snap: &AnalysisFileSnapshot,
    ) -> (String, Vec<String>, Vec<String>) {
        use insight_freshness::*;

        if evidence.is_empty() {
            return (UNANCHORED.to_string(), Vec::new(), Vec::new());
        }
        if snap.is_empty() {
            return (UNKNOWN.to_string(), Vec::new(), Vec::new());
        }

        let mut changed: Vec<String> = Vec::new();
        let mut missing: Vec<String> = Vec::new();
        let mut uncomparable = 0usize;

        for e in evidence {
            if !snap.exists(&e.path) {
                // 快照里对不上，但可能是当初就没解析出的幻觉路径 —— 再给一次唯一文件名的机会
                match snap.resolve(&e.path) {
                    Some((_, Some(now_hash))) => match &e.hash {
                        Some(old) if *old != now_hash => changed.push(e.path.clone()),
                        Some(_) => {}
                        None => uncomparable += 1,
                    },
                    Some((_, None)) => uncomparable += 1,
                    None => missing.push(e.path.clone()),
                }
                continue;
            }
            let now_hash = snap.hashes.get(&e.path).and_then(|h| non_empty(h));
            match (&e.hash, now_hash) {
                (Some(old), Some(now)) if *old != now => changed.push(e.path.clone()),
                (Some(_), Some(_)) => {}
                // 目录引用，或任一侧缺哈希：文件确实还在，但内容有没有变无从判断
                _ => uncomparable += 1,
            }
        }

        let status = if missing.len() == evidence.len() {
            ORPHANED
        } else if !changed.is_empty() || !missing.is_empty() {
            STALE
        } else if uncomparable == evidence.len() {
            UNKNOWN
        } else {
            CURRENT
        };
        (status.to_string(), changed, missing)
    }

    /// 证据**现状**指纹：各证据路径在当前扫描里的内容哈希聚合。
    ///
    /// 注意它与 `evidence` 里冻结的哈希是两个东西：那份记的是「结论产出当时代码长什么样」，
    /// 这份记的是「此刻代码长什么样」。freshness 是两者的比较结果，而本指纹是**后者本身**。
    ///
    /// 为什么必须单独给出这一份
    /// ------------------------
    /// 上层要靠它判断「这次的证据变化，是不是已经派过复核单了」。若改用 freshness 判断，
    /// 会掉进一个不收敛的坑：Agent 认真复核后若判定「结论仍然成立、无需改动」，
    /// 它不会写任何东西（工具提示本就在劝阻重复保存稳定结论），于是 freshness 永远停在
    /// stale，这个文件被每一轮重新点名，永不收敛地烧钱 —— 与焦点巡查「派单即销账」
    /// 要躲的是同一个坑。
    ///
    /// 而现状指纹天然收敛：Agent 什么都不写它就不变（已派过单 → 不再点名），
    /// 文件被再次改动它必然变（→ 重新排队）。判据落在**客观代码**上，不落在模型的行为上。
    pub(crate) fn evidence_state_digest(
        evidence: &[InsightEvidence],
        snap: &AnalysisFileSnapshot,
    ) -> String {
        if evidence.is_empty() || snap.is_empty() {
            return String::new();
        }
        // 排序保证同一组证据无论解析顺序如何都得到同一个指纹
        let mut parts: Vec<String> = evidence
            .iter()
            .map(|e| {
                let now = snap
                    .hashes
                    .get(&e.path)
                    .and_then(|h| non_empty(h))
                    .or_else(|| snap.resolve(&e.path).and_then(|(_, h)| h))
                    // 文件已不存在：用固定标记参与指纹。它同样是一种「现状」，
                    // 而且必须与「存在但没算出哈希」区分开，否则删文件不会触发复核。
                    .unwrap_or_else(|| "∅".to_string());
                format!("{}={}", e.path, now)
            })
            .collect();
        parts.sort();
        let mut hasher: u64 = 0xcbf29ce484222325; // FNV-1a 偏移基值
        for b in parts.join("|").as_bytes() {
            hasher ^= *b as u64;
            hasher = hasher.wrapping_mul(0x100000001b3);
        }
        format!("{hasher:016x}")
    }

    /// 去重落库：指纹命中已有行则只累加 seen_count 并刷新 last_seen/body/refs，
    /// 不新建重复行；否则插入新行（seen_count=1）。返回 (id, is_new)。
    /// 这是 Agent 反复分析同一项目时「沉淀而非重复」的关键——既省 token 又让 UI 能看出结论的稳定性。
    pub fn save_dedup(db: &Arc<Database>, r: &AiInsightRow) -> Result<(String, bool), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Self::now_ts(&conn);
        let fp = Self::compute_fingerprint(&r.analysis_id, &r.kind, &r.title);
        let refs_json = serde_json::to_string(&r.refs).unwrap_or_else(|_| "[]".to_string());
        // 证据快照必须在保存这一刻冻结：过后代码一改，就再也无从知道结论当初依据的是哪一版
        let snap = Self::load_file_snapshot(&conn, &r.analysis_id);
        let evidence = Self::build_evidence(&snap, &r.refs);
        let evidence_json = serde_json::to_string(&evidence).unwrap_or_else(|_| "[]".to_string());

        // 指纹命中即同结论（索引 idx_ai_insights_fingerprint 加速）
        let existing: Option<(String, i64)> = {
            let mut stmt = conn
                .prepare("SELECT id, COALESCE(seen_count,1) FROM ai_insights WHERE fingerprint = ?1 LIMIT 1")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt
                .query_map(params![fp], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                })
                .map_err(|e| e.to_string())?;
            match rows.next() {
                Some(Ok(v)) => Some(v),
                Some(Err(e)) => return Err(e.to_string()),
                None => None,
            }
        };

        match existing {
            Some((id, seen)) => {
                // 重新确认即重新取证：Agent 这一轮看到的代码就是新的证据基线，
                // 否则一条被反复确认的结论会永远拿着第一轮的旧哈希，从此永远显示「已过期」。
                //
                // 同时**自动重开**：一条曾被判定已解决的结论如果又被观察到，说明它回来了
                // （改动回退、或当初关早了）。此时坚持保留 resolved 会让真实存在的问题
                // 从面板上消失——那比重复提醒危险得多。
                conn.execute(
                    "UPDATE ai_insights SET seen_count = ?1, last_seen = ?2, body = ?3, severity = ?4, kind = ?5, refs = ?6, evidence_json = ?7, \
                     status = 'open', resolved_at = NULL, resolved_reason = NULL, resolved_by = NULL WHERE id = ?8",
                    params![seen + 1, now, r.body, r.severity, r.kind, refs_json, evidence_json, id],
                )
                .map_err(|e| e.to_string())?;
                Ok((id, false))
            }
            None => {
                let id = r.id.clone();
                conn.execute(
                    "INSERT INTO ai_insights \
                     (id, pack_id, analysis_id, agent_id, kind, title, body, severity, refs, fingerprint, seen_count, first_seen, last_seen, created_at, evidence_json) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11, strftime('%s','now'), ?12)",
                    params![
                        id, r.pack_id, r.analysis_id, r.agent_id, r.kind, r.title, r.body, r.severity,
                        refs_json, fp, now, evidence_json,
                    ],
                )
                .map_err(|e| e.to_string())?;
                Ok((id, true))
            }
        }
    }

    /// 关闭一条结论（复核确认已经不成立/已修复）。
    ///
    /// 这是整套沉淀的**终点**，没有它，时效判定越准反而噪音越大：
    /// 「证据变了」会被反复提示，而「已经改好了」永远无法表达。
    ///
    /// 定位方式按可靠性排序：先按 id 精确命中，再退回「同一分析下的同标题结论」
    /// （Agent 有时会带回 title 而非 id）。理由必填——无理由的关闭等同于掩盖问题。
    /// 返回被关闭行的 id；找不到时返回 Err，绝不静默成功让调用方误以为已收口。
    pub fn resolve(
        db: &Arc<Database>,
        analysis_id: &str,
        locator: &str,
        reason: &str,
        resolved_by: &str,
    ) -> Result<String, String> {
        let reason = reason.trim();
        if reason.is_empty() {
            return Err("关闭结论必须给出理由（复核依据）".to_string());
        }
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Self::now_ts(&conn);

        let mut id: Option<String> = conn
            .query_row(
                "SELECT id FROM ai_insights WHERE id = ?1 AND analysis_id = ?2",
                params![locator, analysis_id],
                |row| row.get::<_, String>(0),
            )
            .ok();

        if id.is_none() {
            // 按标题回退：用与去重同一套归一化，避免「大小写/标点」差异导致关不掉
            let want = Self::normalize_title(locator);
            let mut stmt = conn
                .prepare("SELECT id, title FROM ai_insights WHERE analysis_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut q = stmt
                .query_map(params![analysis_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let hits: Vec<String> = q
                .by_ref()
                .filter_map(|r| r.ok())
                .filter(|(_, title)| Self::normalize_title(title) == want)
                .map(|(id, _)| id)
                .collect();
            // 标题撞车时不猜：关错一条结论比关不掉更糟
            if hits.len() == 1 {
                id = Some(hits[0].clone());
            } else if hits.len() > 1 {
                return Err(format!(
                    "有 {} 条结论标题相同，无法据此定位，请改用 insight_id",
                    hits.len()
                ));
            }
        }

        let Some(id) = id else {
            return Err(format!("未找到可关闭的结论：{locator}"));
        };
        conn.execute(
            "UPDATE ai_insights SET status = 'resolved', resolved_at = ?1, resolved_reason = ?2, resolved_by = ?3 WHERE id = ?4",
            params![now, reason, resolved_by, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }

    /// G4 回扫验证闭环：AI 写回代码触发增量重扫后，判断「本次诊断提出的洞察是否真解决」。
    ///
    /// 只对带 `diagnosis_id`（源自某次 triggerDiagnosis 会话）且 refs 命中本次变更路径的洞察做复核。
    /// 已 `resolved` 的不动（避免重扫反复横跳）。判定按 `source_kind`：
    /// - `syntax`：重扫后该文件 `error_lines` 不再含诊断指向的行 → resolved
    /// - `review`：该文件已无 open 的 review finding（同 ref 行）→ resolved
    /// - 其余（complexity/techDebt/…）：保守保持 open，留后续增强
    /// 返回被自动收口的洞察数。
    pub fn verify_diagnosis_insights(
        db: &Arc<Database>,
        analysis_id: &str,
        paths: &[String],
    ) -> Result<usize, String> {
        // 阶段1：收集待收口 id（持有锁读取，避免与下方 resolve 的锁重入冲突）
        let to_resolve: Vec<String> = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, source_kind, refs, status FROM ai_insights \
                     WHERE analysis_id = ?1 AND diagnosis_id IS NOT NULL AND diagnosis_id != ''",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![analysis_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            let insights: Vec<(String, String, String, String)> =
                rows.filter_map(|r| r.ok()).collect();

            let path_set: std::collections::HashSet<&str> =
                paths.iter().map(|s| s.as_str()).collect();
            let mut out: Vec<String> = Vec::new();
            for (id, source_kind, refs_json, status) in insights {
                if status == insight_status::RESOLVED {
                    continue;
                }
                let refs: Vec<String> = serde_json::from_str(&refs_json).unwrap_or_default();
                // 找第一个命中变更路径的 ref
                let hit = refs.iter().find_map(|r| {
                    let (p, line) = split_ref_line(r);
                    let np = normalize_ref_path(&p);
                    if path_set.contains(np.as_str()) {
                        Some((np, line))
                    } else {
                        None
                    }
                });
                let Some((rel, line)) = hit else { continue };

                let solved = match source_kind.as_str() {
                    "syntax" => match line {
                        Some(ln) => !Self::has_error_line(&conn, analysis_id, &rel, ln),
                        None => false,
                    },
                    "review" => !Self::has_open_review_finding(&conn, analysis_id, &rel),
                    _ => false,
                };
                if solved {
                    out.push(id);
                }
            }
            out
        };

        // 阶段2：逐个收口（resolve 内部重新取锁，故阶段1 的 guard 已在此前释放）
        let mut n = 0usize;
        for id in to_resolve {
            if Self::resolve(db, analysis_id, &id, "auto-verified after rescan", "system").is_ok() {
                n += 1;
            }
        }
        Ok(n)
    }

    /// 该文件当前 error_lines 是否包含指定行（来自 project_file_metrics.metadata JSON 的 errorLines）
    fn has_error_line(
        conn: &rusqlite::Connection,
        analysis_id: &str,
        rel_path: &str,
        line: i64,
    ) -> bool {
        let Ok(meta) = conn.query_row(
            "SELECT metadata FROM project_file_metrics WHERE analysis_id = ?1 AND file_path = ?2 LIMIT 1",
            params![analysis_id, rel_path],
            |row| row.get::<_, String>(0),
        ) else {
            return false;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&meta) else {
            return false;
        };
        let Some(arr) = v
            .get("errorLines")
            .and_then(|x: &serde_json::Value| x.as_array())
        else {
            return false;
        };
        arr.iter().any(|e| e.as_i64() == Some(line))
    }

    /// 该文件当前是否还有 open 的 review finding（target_type=file 时 target_id 即文件 id）
    fn has_open_review_finding(
        conn: &rusqlite::Connection,
        analysis_id: &str,
        rel_path: &str,
    ) -> bool {
        conn.query_row(
            "SELECT 1 FROM review_findings rf \
             JOIN project_files pf ON rf.target_id = pf.id \
             WHERE rf.analysis_id = ?1 AND pf.rel_path = ?2 AND rf.status = 'open' LIMIT 1",
            params![analysis_id, rel_path],
            |_| Ok(true),
        )
        .unwrap_or(false)
    }

    pub fn save(db: &Arc<Database>, r: &AiInsightRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let now = Self::now_ts(&conn);
        let fp = Self::compute_fingerprint(&r.analysis_id, &r.kind, &r.title);
        let snap = Self::load_file_snapshot(&conn, &r.analysis_id);
        let evidence = Self::build_evidence(&snap, &r.refs);
        conn.execute(
            "INSERT OR REPLACE INTO ai_insights \
             (id, pack_id, analysis_id, agent_id, kind, title, body, severity, refs, fingerprint, seen_count, first_seen, last_seen, created_at, evidence_json) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11, strftime('%s','now'), ?12)",
            params![
                r.id, r.pack_id, r.analysis_id, r.agent_id, r.kind, r.title, r.body, r.severity,
                serde_json::to_string(&r.refs).unwrap_or_else(|_| "[]".to_string()),
                fp, now,
                serde_json::to_string(&evidence).unwrap_or_else(|_| "[]".to_string()),
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_by_analysis(
        db: &Arc<Database>,
        analysis_id: &str,
    ) -> Result<Vec<AiInsightRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        // 一次装载全分析的文件快照，供所有洞察共用（洞察可能上百条，逐条回表会变成 N+1）
        let snap = Self::load_file_snapshot(&conn, analysis_id);
        let mut stmt = conn
            .prepare(
                "SELECT id, pack_id, analysis_id, agent_id, kind, title, body, severity, refs, \
                        COALESCE(seen_count,1), COALESCE(first_seen,0), COALESCE(last_seen,0), evidence_json, \
                        COALESCE(status,'open'), COALESCE(resolved_at,0), resolved_reason, resolved_by, \
                        diagnosis_id, source_kind \
                 FROM ai_insights WHERE analysis_id = ?1 ORDER BY seen_count DESC, created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![analysis_id], |row| {
                let refs: String = row.get(8)?;
                let refs: Vec<String> = serde_json::from_str(&refs).unwrap_or_default();
                let evidence_json: Option<String> = row.get(12)?;
                // 历史数据没有证据快照：退化成「只有路径、没有哈希」的证据，
                // 于是文件在不在还能判，内容变没变一律认作无从比对（unknown），不假装 current。
                let evidence: Vec<InsightEvidence> = match evidence_json {
                    Some(j) if !j.trim().is_empty() => serde_json::from_str(&j).unwrap_or_default(),
                    _ => refs
                        .iter()
                        .map(|r| InsightEvidence {
                            path: normalize_ref_path(r),
                            hash: None,
                        })
                        .filter(|e| !e.path.is_empty())
                        .collect(),
                };
                // 时效照常计算（已关闭的结论也可能证据又变了），但**状态优先**：
                // 是否进入复核队列由 status 决定，freshness 只回答「证据还是不是那份」。
                // 两个概念各管一件事，跨层才不会出现「面板说已解决、Agent 说待复核」的分歧。
                let (freshness, changed_refs, missing_refs) =
                    Self::classify_freshness(&evidence, &snap);
                let evidence_digest = Self::evidence_state_digest(&evidence, &snap);
                Ok(AiInsightRow {
                    id: row.get(0)?,
                    pack_id: row.get(1)?,
                    analysis_id: row.get(2)?,
                    agent_id: row.get(3)?,
                    kind: row.get(4)?,
                    title: row.get(5)?,
                    body: row.get(6)?,
                    severity: row.get(7)?,
                    refs,
                    fingerprint: None,
                    seen_count: row.get(9)?,
                    first_seen: row.get(10)?,
                    last_seen: row.get(11)?,
                    evidence,
                    freshness,
                    changed_refs,
                    missing_refs,
                    evidence_digest,
                    status: row.get(13)?,
                    resolved_at: row.get(14)?,
                    resolved_reason: row.get(15)?,
                    resolved_by: row.get(16)?,
                    diagnosis_id: row.get(17).unwrap_or_default(),
                    source_kind: row.get(18).unwrap_or_default(),
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?)
    }
}

// ─── 自动分析编排：规则 + 运行轨迹 ───

/// 一条「上下文更新后自动发起分析」的规则。
///
/// 模块无关：`module_id` 指明监听哪个模块的上下文产出，扫描只是第一个接入方。
/// `agent_id` 永远来自用户在 UI 的选择，仓库层不做任何默认值猜测。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAutoAnalysisRuleRow {
    pub id: String,
    pub enabled: bool,
    pub module_id: String,
    /// None = 该模块下所有作用域通用
    pub scope_id: Option<String>,
    pub agent_id: String,
    pub preset_key: String,
    /// "full-scan"（仅全量扫描后）/ "any-scan"（含 watch 增量重扫）
    pub trigger_on: String,
    /// 冷却窗口：距上次触发不足该分钟数则跳过，防止频繁重扫把 Agent 打爆
    pub cooldown_minutes: i64,
    /// 内容指纹未变化时跳过（同样的数据不重复烧一次 AI）
    pub skip_if_unchanged: bool,
    pub last_run_at: i64,
    pub last_digest: String,
    pub last_conversation_id: Option<String>,
}

pub struct AiAutoAnalysisRuleRepo;

impl AiAutoAnalysisRuleRepo {
    const COLUMNS: &'static str = "id, enabled, module_id, scope_id, agent_id, preset_key, \
         trigger_on, cooldown_minutes, skip_if_unchanged, last_run_at, last_digest, last_conversation_id";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiAutoAnalysisRuleRow> {
        Ok(AiAutoAnalysisRuleRow {
            id: row.get(0)?,
            enabled: row.get::<_, i64>(1)? != 0,
            module_id: row.get(2)?,
            scope_id: row.get(3)?,
            agent_id: row.get(4)?,
            preset_key: row.get(5)?,
            trigger_on: row.get(6)?,
            cooldown_minutes: row.get(7)?,
            skip_if_unchanged: row.get::<_, i64>(8)? != 0,
            last_run_at: row.get(9)?,
            last_digest: row.get(10)?,
            last_conversation_id: row.get(11)?,
        })
    }

    /// 列出规则；传 module_id 则只取该模块的（编排器按模块过滤，避免无关规则参与判定）
    pub fn list(
        db: &Arc<Database>,
        module_id: Option<&str>,
    ) -> Result<Vec<AiAutoAnalysisRuleRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        match module_id {
            Some(m) => {
                let sql = format!(
                    "SELECT {} FROM ai_auto_analysis_rules WHERE module_id = ?1 ORDER BY created_at ASC",
                    Self::COLUMNS
                );
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let q = stmt
                    .query_map(params![m], Self::map_row)
                    .map_err(|e| e.to_string())?;
                q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
            }
            None => {
                let sql = format!(
                    "SELECT {} FROM ai_auto_analysis_rules ORDER BY created_at ASC",
                    Self::COLUMNS
                );
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let q = stmt
                    .query_map([], Self::map_row)
                    .map_err(|e| e.to_string())?;
                q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
            }
        }
    }

    /// 新建或整体更新一条规则。
    /// 注意 last_run_at / last_digest / last_conversation_id 走 `mark_run` 单独更新——
    /// 否则 UI 保存一次配置就会把运行状态覆盖掉，冷却与去重立刻失效。
    pub fn save(db: &Arc<Database>, r: &AiAutoAnalysisRuleRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ai_auto_analysis_rules \
             (id, enabled, module_id, scope_id, agent_id, preset_key, trigger_on, cooldown_minutes, skip_if_unchanged, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9, strftime('%s','now')) \
             ON CONFLICT(id) DO UPDATE SET \
                enabled=excluded.enabled, module_id=excluded.module_id, scope_id=excluded.scope_id, \
                agent_id=excluded.agent_id, preset_key=excluded.preset_key, trigger_on=excluded.trigger_on, \
                cooldown_minutes=excluded.cooldown_minutes, skip_if_unchanged=excluded.skip_if_unchanged, \
                updated_at=strftime('%s','now')",
            params![
                r.id,
                if r.enabled { 1i64 } else { 0i64 },
                r.module_id,
                r.scope_id,
                r.agent_id,
                r.preset_key,
                r.trigger_on,
                r.cooldown_minutes,
                if r.skip_if_unchanged { 1i64 } else { 0i64 },
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 记录一次真实触发：刷新冷却起点与去重指纹。
    pub fn mark_run(
        db: &Arc<Database>,
        rule_id: &str,
        digest: &str,
        conversation_id: Option<&str>,
    ) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_auto_analysis_rules SET last_run_at = CAST(strftime('%s','now') AS INTEGER), \
             last_digest = ?1, last_conversation_id = ?2, updated_at = strftime('%s','now') WHERE id = ?3",
            params![digest, conversation_id, rule_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete(db: &Arc<Database>, id: &str) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_auto_analysis_rules WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_auto_analysis_runs WHERE rule_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// 一次自动编排的审计记录（触发或跳过都记，跳过必须带原因）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAutoAnalysisRunRow {
    pub id: String,
    pub rule_id: String,
    pub module_id: String,
    pub scope_id: String,
    pub agent_id: String,
    pub preset_key: String,
    pub pack_id: Option<String>,
    pub conversation_id: Option<String>,
    pub trigger_kind: String,
    /// "triggered" | "skipped" | "failed"
    pub status: String,
    /// 跳过/失败原因，或触发时的简述
    pub detail: String,
    /// 本次分析所基于的上下文内容指纹。空串 = 未发起（skipped/failed）或历史数据。
    /// 覆盖台账靠它判断「这个维度的结论是否还对得上当前数据」。
    #[serde(default)]
    pub context_digest: String,
    /// 机器可读判定原因：ok / rotate-gap / cooling / busy / unchanged / agent-missing …
    ///
    /// detail 是给人看的中文说明，会随文案调整而变；补跑判定要问的是
    /// 「这次跳过是不是可恢复的」，必须有一个稳定的枚举可依据，不能去匹配自然语言。
    #[serde(default)]
    pub reason: String,
    /// 发起之后的最终归宿：pending / completed / no-output / error。
    /// 空串 = 早于回执特性的历史记录，按「无法判断」处理，不能一上来判成失败。
    #[serde(default)]
    pub outcome: String,
    /// 本轮实际沉淀的洞察条数（回执时回填）
    #[serde(default)]
    pub insight_count: i64,
    /// 回执落点时间（秒）；0 = 尚未回执
    #[serde(default)]
    pub finished_at: i64,
    pub created_at: i64,
}

pub struct AiAutoAnalysisRunRepo;

impl AiAutoAnalysisRunRepo {
    pub fn record(db: &Arc<Database>, r: &AiAutoAnalysisRunRow) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ai_auto_analysis_runs \
             (id, rule_id, module_id, scope_id, agent_id, preset_key, pack_id, conversation_id, trigger_kind, status, detail, context_digest, reason, outcome, insight_count, finished_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                r.id, r.rule_id, r.module_id, r.scope_id, r.agent_id, r.preset_key,
                r.pack_id, r.conversation_id, r.trigger_kind, r.status, r.detail,
                r.context_digest, r.reason, r.outcome, r.insight_count, r.finished_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 回执：把一条已发起的轨迹从 pending 收口到最终状态。
    ///
    /// 为什么必须有这一步：发起分析是「把消息扔给 Agent」，不等它答完（等下去会把扫描
    /// 收尾链路挂住几十秒）。可是不等，就没人知道这一轮到底有没有产出——模型报错、
    /// 网络断开、Agent 兜了一圈一条结论都没保存，轨迹全都停在 triggered。
    /// 覆盖台账据此点绿灯，用户以为这个维度看过了，其实一片空白。
    ///
    /// detail 采用追加而非覆盖：发起时写的是「读了几个分节 / 多少 token」，
    /// 回执时补的是「产出了几条」，两段合起来才是这一轮的完整故事。
    pub fn finish(
        db: &Arc<Database>,
        run_id: &str,
        outcome: &str,
        insight_count: i64,
        detail_suffix: &str,
    ) -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_auto_analysis_runs \
             SET outcome = ?2, \
                 insight_count = ?3, \
                 finished_at = strftime('%s','now'), \
                 detail = CASE WHEN ?4 = '' THEN detail ELSE detail || ' · ' || ?4 END \
             WHERE id = ?1",
            params![run_id, outcome, insight_count.max(0), detail_suffix],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 所有查询共用的列清单与行映射：多一处手写就多一次「列顺序对不上」的隐性错位。
    const RUN_COLS: &'static str = "id, rule_id, module_id, scope_id, agent_id, preset_key, \
         pack_id, conversation_id, trigger_kind, status, detail, context_digest, \
         reason, outcome, insight_count, finished_at, created_at";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiAutoAnalysisRunRow> {
        Ok(AiAutoAnalysisRunRow {
            id: row.get(0)?,
            rule_id: row.get(1)?,
            module_id: row.get(2)?,
            scope_id: row.get(3)?,
            agent_id: row.get(4)?,
            preset_key: row.get(5)?,
            pack_id: row.get(6)?,
            conversation_id: row.get(7)?,
            trigger_kind: row.get(8)?,
            status: row.get(9)?,
            detail: row.get(10)?,
            context_digest: row.get(11)?,
            reason: row.get(12)?,
            outcome: row.get(13)?,
            insight_count: row.get(14)?,
            finished_at: row.get(15)?,
            created_at: row.get(16)?,
        })
    }

    /// 最近的运行记录（UI 展示自动化是否在正常工作）
    pub fn list_recent(
        db: &Arc<Database>,
        limit: i64,
    ) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {} FROM ai_auto_analysis_runs ORDER BY created_at DESC, rowid DESC LIMIT ?1",
            Self::RUN_COLS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let q = stmt
            .query_map(params![limit.max(1)], Self::map_row)
            .map_err(|e| e.to_string())?;
        q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 覆盖台账只认「真的分析过」的轨迹：已发起 且 结局既不是 error 也不是 interrupted。
    ///
    /// interrupted 与 error 同列的理由完全一样：那一轮**一条结论都没有**。
    /// 区别只在死法——一个是对话报错，一个是应用在它答完之前被关掉。
    /// 把中断算作覆盖，台账就会为一次「关窗口」点上永久绿灯。
    ///
    /// outcome 为空串的历史记录必须放行——回执特性上线前的所有记录都是空串，
    /// 一收紧就会把用户过去分析过的全部维度刷成「从未分析」，台账反而更不可信。
    const COVERED_PREDICATE: &'static str =
        "status = 'triggered' AND outcome NOT IN ('error', 'interrupted')";

    /// 每个分析维度（preset_key）**最近一次真正发起**的记录，用于构建覆盖台账。
    ///
    /// 为什么只认 status='triggered'：skipped/failed 说明这一轮压根没跑，
    /// 把它算作「已覆盖」会让台账显示绿灯而实际上从没有人分析过这个维度——
    /// 这是整张台账唯一不能出错的地方，绿灯必须意味着真的分析过。
    ///
    /// 为什么还要排除 outcome='error'：triggered 只说明「消息发出去了」。
    /// 对话中途失败的那一轮同样一条结论都没有，跟没跑过没有区别，
    /// 继续算作覆盖就是换个姿势点假绿灯。排除之后，轮转会自然把它重新排上队。
    /// （no-output 保留为覆盖：Agent 认真看过、确实没发现问题，是合法结论。）
    ///
    /// 为什么按 rowid 兜底排序：同一秒内连发两轮时 created_at 相同，
    /// 只按时间取 MAX 会随机选中其中一条，指纹跟着抖动。
    pub fn latest_per_preset(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
    ) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {cols} FROM ai_auto_analysis_runs r \
             WHERE r.module_id = ?1 AND r.scope_id = ?2 AND r.{pred} \
               AND r.rowid = ( \
                   SELECT r2.rowid FROM ai_auto_analysis_runs r2 \
                   WHERE r2.module_id = r.module_id AND r2.scope_id = r.scope_id \
                     AND r2.preset_key = r.preset_key AND r2.{pred} \
                   ORDER BY r2.created_at DESC, r2.rowid DESC LIMIT 1 \
               ) \
             ORDER BY r.created_at DESC, r.rowid DESC",
            cols = Self::RUN_COLS,
            pred = Self::COVERED_PREDICATE,
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let q = stmt
            .query_map(params![module_id, scope_id], Self::map_row)
            .map_err(|e| e.to_string())?;
        q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 每条规则在该作用域下的**最近一条**轨迹（不论触发还是跳过），用于补跑判定。
    ///
    /// 自动分析此前只被「扫描完成」这一个事件驱动。于是一旦某轮撞上冷却窗口，
    /// 或撞上 Agent 正在回答（busy），这一轮就永久丢失——除非用户恰好再扫一次。
    /// 项目进入稳定期不再频繁扫描时，这等于自动化悄悄停摆，而界面上毫无提示。
    ///
    /// 补跑需要知道的恰恰是「每条规则最后一次的结论是什么」：
    /// 最后一条是可恢复原因的跳过（cooling/busy）或失败的发起，就说明还欠着一轮。
    /// 取最近一条而不是扫描全表，是因为再往前的记录已经被后来的轮次覆盖，
    /// 只会把早已补过的旧账重新翻出来。
    pub fn latest_per_rule(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
    ) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {} FROM ai_auto_analysis_runs r \
             WHERE r.module_id = ?1 AND r.scope_id = ?2 \
               AND r.rowid = ( \
                   SELECT r2.rowid FROM ai_auto_analysis_runs r2 \
                   WHERE r2.module_id = r.module_id AND r2.scope_id = r.scope_id \
                     AND r2.rule_id = r.rule_id \
                   ORDER BY r2.created_at DESC, r2.rowid DESC LIMIT 1 \
               ) \
             ORDER BY r.created_at DESC, r.rowid DESC",
            Self::RUN_COLS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let q = stmt
            .query_map(params![module_id, scope_id], Self::map_row)
            .map_err(|e| e.to_string())?;
        q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 清算中断轮次：把长期停在 pending 的轨迹落定为 interrupted，
    /// 并在**同一个事务里**把那一轮点名的焦点目标一并退回队列。
    ///
    /// 为什么必须有这一步
    /// ------------------
    /// 回执是在 sendMessage 的 then/catch 里补写的 —— 进程还活着才写得成。
    /// 桌面应用被随手关掉时，那一轮既没有 completed 也没有 error，
    /// 永远停在 pending。于是：
    ///   · 覆盖台账看到 status='triggered' 就点绿灯，这个维度显示「已分析」；
    ///   · 派单台账看到 outcome=''（待回执）就当已落实，这批文件从此不再被点名。
    /// 两张表一起说谎，而真相是这一轮**一条结论都没产出**。
    /// 「对话失败会退回队列」上一版已经修好了，但它只覆盖得到进程还在的那半边。
    ///
    /// 为什么两张表必须同一事务
    /// ------------------------
    /// 只标轨迹不退派单，等于把今天这个 bug 换了个更隐蔽的姿势：
    /// 规则会被补跑重排，可焦点台账仍显示「已巡查」，共振榜第一名照样永久沉默。
    ///
    /// now_sec 传 0 表示取 SQL 当前时间；显式传值只在测试里有意义。
    pub fn reap_stale_pending(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
        older_than_sec: i64,
        now_sec: i64,
    ) -> Result<usize, String> {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let ids: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM ai_auto_analysis_runs \
                     WHERE module_id = ?1 AND scope_id = ?2 \
                       AND status = 'triggered' AND outcome = 'pending' \
                       AND created_at < (CASE WHEN ?4 > 0 THEN ?4 \
                                              ELSE CAST(strftime('%s','now') AS INTEGER) END) - ?3",
                )
                .map_err(|e| e.to_string())?;
            let q = stmt
                .query_map(
                    params![module_id, scope_id, older_than_sec.max(0), now_sec],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?;
            q.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if ids.is_empty() {
            return Ok(0);
        }
        for id in &ids {
            tx.execute(
                "UPDATE ai_auto_analysis_runs \
                 SET outcome = 'interrupted', \
                     finished_at = CASE WHEN ?2 > 0 THEN ?2 ELSE CAST(strftime('%s','now') AS INTEGER) END, \
                     detail = detail || ' · 长时间未回执，判定为中断' \
                 WHERE id = ?1",
                params![id, now_sec],
            )
            .map_err(|e| e.to_string())?;
            // 与 settle_by_run 同一条口径：按 run_id 核销。这个文件若已被后一轮
            // 重新点名，run_id 早被覆盖，这里一行也匹配不上——正是我们想要的。
            tx.execute(
                "UPDATE ai_focus_assignments SET outcome = 'interrupted' WHERE run_id = ?1",
                params![id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(ids.len())
    }
}

/// 一条「焦点目标巡查派单」记录：某个文件在哪一轮被点名交给 Agent 看过。
///
/// 与 ai_auto_analysis_runs 的分工：轨迹表记「这一轮跑了什么」，
/// 本表记「这个文件被照顾到了没有」。前者以轮次为单位，回答不了
/// 「共振榜第一名连续五轮无人问津」这种以**文件**为单位的问题。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiFocusAssignmentRow {
    pub module_id: String,
    pub scope_id: String,
    pub file_path: String,
    /// 派单所属的运行轨迹 id，便于从文件跳回那一轮的会话
    pub run_id: String,
    pub preset_key: String,
    /// 派单当时的上下文指纹：数据没变就不必重复派单，变了才重新排队
    pub context_digest: String,
    /// 派单时该文件的共振维度数（观测用：高共振却反复无结论最值得人工介入）
    pub resonance: i64,
    /// 点名理由（哪几维同时报警），原样回显给人看
    pub note: String,
    /// 累计被点名次数
    pub assign_count: i64,
    /// 最近一次派单时间（秒）
    pub assigned_at: i64,
    /// 核销状态：''=已发出待回执，其余同轨迹表（completed / no-output / error）。
    ///
    /// 只有 error 表示这次点名**没有真的发生过**（对话失败），派单作废、重新排队。
    /// 没有这一列，一次网络抖动就足以让共振榜第一名永久沉默：规则确实会被补跑调度
    /// 重新排队，但焦点台账读库时这个文件已经是「已巡查」，此后再也不会被点名。
    pub outcome: String,
    /// 派单时该文件「证据现状」的指纹（见 migration 30c）。
    ///
    /// 与 context_digest 的分工：后者是**整包**指纹，任何文件变动都会让它翻新，
    /// 只能粗粒度地回答「数据变了没有」；本列精确到这一个文件的证据，
    /// 用于判断「上次派的那次复核单，对应的证据变化是不是还是这一次」。
    /// 空串 = 从未记账（历史行或非复核派单），读侧按「还欠一次复核」处理。
    pub evidence_digest: String,
    /// 派单时该文件「本轮变坏了什么」的指纹（见 migration 30d）。
    ///
    /// 与另外两个指纹三分天下，各管一个时间尺度上的问题：
    ///   · context_digest   —— 整包数据变了没有（粗，跨文件）；
    ///   · evidence_digest  —— 这个文件的**已知结论**所依据的代码变了没有；
    ///   · regression_digest—— 这个文件**相对上一次扫描**的劣化，还是不是同一次。
    /// 三者必须分开存：一个文件完全可能同时欠着复核和欠着回归追责，
    /// 共用一列会让两笔账互相冲销，其中一笔从此永远销不掉、或永远销得掉。
    /// 空串 = 从未记账（历史行或非回归派单），读侧按「还欠一次追责」处理。
    pub regression_digest: String,
}

pub struct AiFocusAssignmentRepo;

impl AiFocusAssignmentRepo {
    const COLS: &'static str = "module_id, scope_id, file_path, run_id, preset_key, \
         context_digest, resonance, note, assign_count, assigned_at, outcome, evidence_digest, \
         regression_digest";

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiFocusAssignmentRow> {
        Ok(AiFocusAssignmentRow {
            module_id: row.get(0)?,
            scope_id: row.get(1)?,
            file_path: row.get(2)?,
            run_id: row.get(3)?,
            preset_key: row.get(4)?,
            context_digest: row.get(5)?,
            resonance: row.get(6)?,
            note: row.get(7)?,
            assign_count: row.get(8)?,
            assigned_at: row.get(9)?,
            outcome: row.get(10)?,
            evidence_digest: row.get(11)?,
            regression_digest: row.get(12)?,
        })
    }

    /// 批量登记派单（同一轮点名的若干文件在一个事务里落库）。
    ///
    /// 冲突时**更新为最近一次**并把次数加一，而不是插新行：
    /// 判定「还欠不欠这个文件一次巡查」只需要最近一次的指纹与时间，
    /// 留全量历史会让这张表随轮次线性膨胀，而多出来的行一次都不会被读。
    ///
    /// assigned_at 由调用方传 0 时取当前时间——测试要能注入固定时间，
    /// 否则「数据没变就不重复派单」这类判定根本没法写回归。
    pub fn record_many(db: &Arc<Database>, rows: &[AiFocusAssignmentRow]) -> Result<usize, String> {
        if rows.is_empty() {
            return Ok(0);
        }
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut n = 0usize;
        for r in rows {
            if r.file_path.trim().is_empty() {
                continue;
            }
            tx.execute(
                "INSERT INTO ai_focus_assignments \
                 (module_id, scope_id, file_path, run_id, preset_key, context_digest, resonance, note, assign_count, assigned_at, outcome, evidence_digest, regression_digest) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1, CASE WHEN ?9 > 0 THEN ?9 ELSE strftime('%s','now') END, '', ?10, ?11) \
                 ON CONFLICT(module_id, scope_id, file_path) DO UPDATE SET \
                   run_id = excluded.run_id, \
                   preset_key = excluded.preset_key, \
                   context_digest = excluded.context_digest, \
                   resonance = excluded.resonance, \
                   note = excluded.note, \
                   assign_count = ai_focus_assignments.assign_count + 1, \
                   assigned_at = excluded.assigned_at, \
                   outcome = '', \
                   evidence_digest = excluded.evidence_digest, \
                   regression_digest = excluded.regression_digest",
                params![
                    r.module_id,
                    r.scope_id,
                    r.file_path.trim(),
                    r.run_id,
                    r.preset_key,
                    r.context_digest,
                    r.resonance,
                    r.note,
                    r.assigned_at,
                    r.evidence_digest,
                    r.regression_digest,
                ],
            )
            .map_err(|e| e.to_string())?;
            n += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(n)
    }

    /// 某作用域下全部派单记录（前端据此判断哪些焦点目标还没派过单）。
    ///
    /// 不分页：这张表每个文件只有一行，上限就是项目里被点过名的文件数，
    /// 量级远小于轨迹表；分页反而会让「有没有派过单」这个判断出现假阴性。
    pub fn list_by_scope(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
    ) -> Result<Vec<AiFocusAssignmentRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {} FROM ai_focus_assignments WHERE module_id = ?1 AND scope_id = ?2 \
             ORDER BY assigned_at DESC, file_path ASC",
            Self::COLS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let q = stmt
            .query_map(params![module_id, scope_id], Self::map_row)
            .map_err(|e| e.to_string())?;
        q.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// 核销一轮派单：把这一轮点名的所有文件标上这轮的真实结局。
    ///
    /// 为什么按 run_id 而不是按文件核销
    /// --------------------------------
    /// `WHERE run_id = ?` 天然带上了「这一行还属于那一轮吗」这个条件：若该文件
    /// 在回执到达之前**又被后面一轮重新点名**（record_many 已把 run_id 覆盖成新的），
    /// 这条迟到的回执就一行也匹配不上，自动作废。
    /// 若改成按文件核销，一张迟到的 error 回执会把**新一轮**的派单误判成失败，
    /// 于是这个文件立刻被重新排队——一个只在慢响应下偶发、几乎无法复现的重复烧钱 bug。
    pub fn settle_by_run(db: &Arc<Database>, run_id: &str, outcome: &str) -> Result<usize, String> {
        if run_id.trim().is_empty() {
            return Ok(0);
        }
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE ai_focus_assignments SET outcome = ?2 WHERE run_id = ?1",
            params![run_id.trim(), outcome],
        )
        .map_err(|e| e.to_string())
    }
}

// ─── 指标快照：项目形态随时间的历史基线 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMetricSnapshotRow {
    pub id: String,
    pub module_id: String,
    pub scope_id: String,
    /// 指标集指纹：同一组数值必同指纹，用于「没变就不新增行」
    pub digest: String,
    /// full-scan / incremental —— 增量重扫的指标本来就只覆盖变化面，
    /// 人在看时间轴时需要知道这个点是怎么来的
    pub trigger_kind: String,
    /// 指标数组（模块自定义结构，后端不解析，原样存取）
    pub metrics_json: String,
    /// 本次各维度可用性（哪些维度压根没跑）。
    /// **没有它趋势就是骗人的**：上次跑了 Git、这次没跑，churn 归零不是变好。
    pub coverage_json: String,
    /// 这组指标第一次出现的时间（秒）——时间轴按它排序
    pub first_at: i64,
    /// 最近一次仍观测到这组指标的时间（秒）
    pub last_at: i64,
    /// 连续观测到多少次（「持续保持」的长度，本身就是信息）
    pub seen_count: i64,
}

pub struct AiMetricSnapshotRepo;

impl AiMetricSnapshotRepo {
    const COLS: &'static str = "id, module_id, scope_id, digest, trigger_kind, metrics_json, \
         coverage_json, first_at, last_at, seen_count";

    /// 单个作用域保留的快照上限。
    ///
    /// 超出后删最老的。之所以不做「抽稀保留」（近密远疏）：那需要一套采样策略，
    /// 而策略本身会悄悄改变趋势的形状——宁可诚实地丢掉最老的一段，
    /// 也不要给出一条被算法修饰过的曲线。
    const KEEP: usize = 200;

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiMetricSnapshotRow> {
        Ok(AiMetricSnapshotRow {
            id: row.get(0)?,
            module_id: row.get(1)?,
            scope_id: row.get(2)?,
            digest: row.get(3)?,
            trigger_kind: row.get(4)?,
            metrics_json: row.get(5)?,
            coverage_json: row.get(6)?,
            first_at: row.get(7)?,
            last_at: row.get(8)?,
            seen_count: row.get(9)?,
        })
    }

    /// 记录一次快照。返回 (行 id, 是否新增)。
    ///
    /// 去重只跟**最近一条**比，不跟历史全体比
    /// --------------------------------------
    /// 拿指纹去全表查「以前有没有出现过」看起来更省行数，但那会把 A→B→A 的回归
    /// 合并回最早那条 A：时间轴于是显示「B 之后什么都没发生」，
    /// 而「改坏了又改回来」恰恰是最该被看见的一次反复。
    ///
    /// taken_at 传 0 表示取当前时间；显式传值只在测试里有意义
    /// （「指标没变就不新增行」这类判定不注入时间根本没法写回归）。
    pub fn record(
        db: &Arc<Database>,
        row: &AiMetricSnapshotRow,
        taken_at: i64,
    ) -> Result<(String, bool), String> {
        let now = if taken_at > 0 {
            taken_at
        } else {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        };
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let latest: Option<(String, String)> = conn
            .query_row(
                "SELECT id, digest FROM ai_metric_snapshots \
                 WHERE module_id = ?1 AND scope_id = ?2 \
                 ORDER BY first_at DESC, rowid DESC LIMIT 1",
                params![row.module_id, row.scope_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        if let Some((id, digest)) = latest {
            if digest == row.digest {
                conn.execute(
                    "UPDATE ai_metric_snapshots \
                     SET last_at = ?2, seen_count = seen_count + 1 WHERE id = ?1",
                    params![id, now],
                )
                .map_err(|e| e.to_string())?;
                return Ok((id, false));
            }
        }

        conn.execute(
            "INSERT INTO ai_metric_snapshots \
             (id, module_id, scope_id, digest, trigger_kind, metrics_json, coverage_json, \
              first_at, last_at, seen_count) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)",
            params![
                row.id,
                row.module_id,
                row.scope_id,
                row.digest,
                row.trigger_kind,
                row.metrics_json,
                row.coverage_json,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        // 滚动裁剪：只在真的新增了行之后做，避免每次「持续保持」都扫一遍表
        conn.execute(
            "DELETE FROM ai_metric_snapshots WHERE id IN ( \
                SELECT id FROM ai_metric_snapshots WHERE module_id = ?1 AND scope_id = ?2 \
                ORDER BY first_at DESC, rowid DESC LIMIT -1 OFFSET ?3 )",
            params![row.module_id, row.scope_id, Self::KEEP as i64],
        )
        .map_err(|e| e.to_string())?;

        Ok((row.id.clone(), true))
    }

    /// 时间轴：由新到旧。limit 只截最近若干个，趋势对比通常只需要头几个。
    pub fn list(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
        limit: usize,
    ) -> Result<Vec<AiMetricSnapshotRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {} FROM ai_metric_snapshots WHERE module_id = ?1 AND scope_id = ?2 \
             ORDER BY first_at DESC, rowid DESC LIMIT ?3",
            Self::COLS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![module_id, scope_id, limit as i64], Self::map_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }
}

// ─── 实体快照：哪个文件在变坏 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEntitySnapshotRow {
    pub id: String,
    pub module_id: String,
    pub scope_id: String,
    /// 榜单指纹：同一张榜必同指纹，用于「没变就不新增行」
    pub digest: String,
    pub trigger_kind: String,
    /// 实体类别名，如「文件」
    pub entity_label: String,
    /// 榜单数组（模块自定义结构，后端不解析，原样存取）
    pub entities_json: String,
    /// 本次各维度可用性
    pub coverage_json: String,
    /// 维度字典（key → label/unit/weight），让渲染侧不必回头问模块
    pub dimensions_json: String,
    /// 上一批榜单实体中此刻仍存在的 id —— 区分「文件被删」与「问题修好」的唯一依据
    pub survived_json: String,
    /// 参与打分的实体总数（截断之前）
    pub total: i64,
    /// 榜单门槛：末位实体的分数
    pub cutoff: f64,
    pub first_at: i64,
    pub last_at: i64,
    pub seen_count: i64,
}

pub struct AiEntitySnapshotRepo;

impl AiEntitySnapshotRepo {
    const COLS: &'static str = "id, module_id, scope_id, digest, trigger_kind, entity_label, \
         entities_json, coverage_json, dimensions_json, survived_json, total, cutoff, \
         first_at, last_at, seen_count";

    /// 保留上限，比指标快照小一个量级：每行是一整张榜单，而回归只对照上一个点。
    const KEEP: usize = 60;

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiEntitySnapshotRow> {
        Ok(AiEntitySnapshotRow {
            id: row.get(0)?,
            module_id: row.get(1)?,
            scope_id: row.get(2)?,
            digest: row.get(3)?,
            trigger_kind: row.get(4)?,
            entity_label: row.get(5)?,
            entities_json: row.get(6)?,
            coverage_json: row.get(7)?,
            dimensions_json: row.get(8)?,
            survived_json: row.get(9)?,
            total: row.get(10)?,
            cutoff: row.get(11)?,
            first_at: row.get(12)?,
            last_at: row.get(13)?,
            seen_count: row.get(14)?,
        })
    }

    /// 记录一张榜单。返回 (行 id, 是否新增)。去重口径与指标快照完全一致：
    /// 只跟**最近一条**比，让 A→B→A 的反复留下三个点。
    pub fn record(
        db: &Arc<Database>,
        row: &AiEntitySnapshotRow,
        taken_at: i64,
    ) -> Result<(String, bool), String> {
        let now = if taken_at > 0 {
            taken_at
        } else {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        };
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let latest: Option<(String, String)> = conn
            .query_row(
                "SELECT id, digest FROM ai_entity_snapshots \
                 WHERE module_id = ?1 AND scope_id = ?2 \
                 ORDER BY first_at DESC, rowid DESC LIMIT 1",
                params![row.module_id, row.scope_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();

        if let Some((id, digest)) = latest {
            if digest == row.digest {
                conn.execute(
                    "UPDATE ai_entity_snapshots \
                     SET last_at = ?2, seen_count = seen_count + 1 WHERE id = ?1",
                    params![id, now],
                )
                .map_err(|e| e.to_string())?;
                return Ok((id, false));
            }
        }

        conn.execute(
            "INSERT INTO ai_entity_snapshots \
             (id, module_id, scope_id, digest, trigger_kind, entity_label, entities_json, \
              coverage_json, dimensions_json, survived_json, total, cutoff, \
              first_at, last_at, seen_count) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, 1)",
            params![
                row.id,
                row.module_id,
                row.scope_id,
                row.digest,
                row.trigger_kind,
                row.entity_label,
                row.entities_json,
                row.coverage_json,
                row.dimensions_json,
                row.survived_json,
                row.total,
                row.cutoff,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM ai_entity_snapshots WHERE id IN ( \
                SELECT id FROM ai_entity_snapshots WHERE module_id = ?1 AND scope_id = ?2 \
                ORDER BY first_at DESC, rowid DESC LIMIT -1 OFFSET ?3 )",
            params![row.module_id, row.scope_id, Self::KEEP as i64],
        )
        .map_err(|e| e.to_string())?;

        Ok((row.id.clone(), true))
    }

    /// 由新到旧。回归通常只需要头两个点。
    pub fn list(
        db: &Arc<Database>,
        module_id: &str,
        scope_id: &str,
        limit: usize,
    ) -> Result<Vec<AiEntitySnapshotRow>, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            "SELECT {} FROM ai_entity_snapshots WHERE module_id = ?1 AND scope_id = ?2 \
             ORDER BY first_at DESC, rowid DESC LIMIT ?3",
            Self::COLS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![module_id, scope_id, limit as i64], Self::map_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn mem_db() -> Arc<Database> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::infrastructure::database::migration::init_tables(&conn).unwrap();
        Arc::new(Database(Mutex::new(conn)))
    }

    fn sample_row(analysis_id: &str, kind: &str, severity: &str, title: &str) -> AiInsightRow {
        AiInsightRow {
            id: format!("ins_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
            pack_id: None,
            analysis_id: analysis_id.to_string(),
            agent_id: None,
            kind: kind.to_string(),
            title: title.to_string(),
            body: "recommendation body".to_string(),
            severity: severity.to_string(),
            refs: vec!["src/a.ts:10".to_string()],
            fingerprint: None,
            seen_count: 0,
            first_seen: 0,
            last_seen: 0,
            ..Default::default()
        }
    }

    #[test]
    fn save_dedup_inserts_then_reconfirms_without_duplicate() {
        let db = mem_db();
        let a = sample_row(
            "analysisX",
            "recommendation",
            "high",
            "Extract duplicated config loader",
        );
        // 标题大小写/空格差异应视为同一结论（指纹规范化）
        let b = sample_row(
            "analysisX",
            "recommendation",
            "high",
            "  Extract Duplicated Config Loader  ",
        );
        let (id1, is_new1) = AiInsightRepo::save_dedup(&db, &a).unwrap();
        assert!(is_new1, "first save should be new");
        let (id2, is_new2) = AiInsightRepo::save_dedup(&db, &b).unwrap();
        assert!(
            !is_new2,
            "same-title (case/space-insensitive) save must re-confirm, not duplicate"
        );
        assert_eq!(id1, id2, "re-confirmation keeps the same row id");

        let rows = AiInsightRepo::list_by_analysis(&db, "analysisX").unwrap();
        assert_eq!(rows.len(), 1, "must not create a duplicate row");
        assert_eq!(
            rows[0].seen_count, 2,
            "seen_count should be incremented to 2"
        );
    }

    #[test]
    fn save_dedup_distinguishes_different_conclusions() {
        let db = mem_db();
        let a = sample_row(
            "analysisX",
            "recommendation",
            "high",
            "Extract config loader",
        );
        let c = sample_row(
            "analysisX",
            "risk",
            "critical",
            "Unbounded recursion in parser",
        );
        let (_id1, n1) = AiInsightRepo::save_dedup(&db, &a).unwrap();
        let (_id2, n2) = AiInsightRepo::save_dedup(&db, &c).unwrap();
        assert!(n1 && n2);
        let rows = AiInsightRepo::list_by_analysis(&db, "analysisX").unwrap();
        assert_eq!(
            rows.len(),
            2,
            "different title/severity/kind = distinct insights"
        );
        assert!(rows.iter().all(|r| r.seen_count == 1));
    }

    #[test]
    fn normalize_title_strips_punctuation_and_collapses_whitespace() {
        assert_eq!(
            AiInsightRepo::normalize_title("  Extract Duplicated Config Loader!!  "),
            "extract duplicated config loader"
        );
        // 中文标题：标点丢弃，汉字保留
        assert_eq!(
            AiInsightRepo::normalize_title("认证模块：耦合度过高！"),
            "认证模块耦合度过高"
        );
        // 多空白坍缩为单空格
        assert_eq!(AiInsightRepo::normalize_title("a   b\tc"), "a b c");
    }

    #[test]
    fn save_dedup_merges_reworded_title_with_punctuation() {
        let db = mem_db();
        let a = sample_row(
            "analysisX",
            "finding",
            "high",
            "Extract Duplicated Config Loader!",
        );
        // 换模型措辞 / 加标点 / 改大小写 —— 应判为同一结论，归并而非新建
        let b = sample_row(
            "analysisX",
            "finding",
            "high",
            "  extract duplicated config loader  ",
        );
        let (_id1, n1) = AiInsightRepo::save_dedup(&db, &a).unwrap();
        let (_id2, n2) = AiInsightRepo::save_dedup(&db, &b).unwrap();
        assert!(n1 && !n2, "reworded title must re-confirm, not duplicate");
        let rows = AiInsightRepo::list_by_analysis(&db, "analysisX").unwrap();
        assert_eq!(rows.len(), 1, "must not create a duplicate row");
        assert_eq!(rows[0].seen_count, 2);
    }

    #[test]
    fn save_dedup_merges_regraded_severity_into_same_row() {
        let db = mem_db();
        let a = sample_row("analysisX", "risk", "high", "Unbounded recursion in parser");
        let b = sample_row(
            "analysisX",
            "risk",
            "critical",
            "Unbounded recursion in parser",
        );
        let (id1, n1) = AiInsightRepo::save_dedup(&db, &a).unwrap();
        let (id2, n2) = AiInsightRepo::save_dedup(&db, &b).unwrap();
        assert!(
            n1 && !n2,
            "same title with different severity must merge, not duplicate"
        );
        assert_eq!(id1, id2, "re-grade keeps the same row id");
        let rows = AiInsightRepo::list_by_analysis(&db, "analysisX").unwrap();
        assert_eq!(rows.len(), 1, "severity is not part of the dedup key");
        // 严重度应就地刷新为最新一次评估
        assert_eq!(rows[0].severity, "critical");
        assert_eq!(rows[0].seen_count, 2);
    }

    // ── 分节级增量：只重写变化的分节，其余分节（含 updated_at）必须原封不动 ──

    fn sample_pack(id: &str, keys: &[&str], digest: &str) -> AiContextPackRow {
        AiContextPackRow {
            id: id.to_string(),
            scope_id: "analysisX".to_string(),
            module_id: "project-scan".to_string(),
            scope_label: "demo".to_string(),
            schema_version: 2,
            generated_at: 1_000,
            token_estimate: 500,
            digest: digest.to_string(),
            truncated_sections: vec![],
            section_keys: keys.iter().map(|k| k.to_string()).collect(),
        }
    }

    fn sample_section(
        key: &str,
        content: &str,
        digest: &str,
        updated_at: i64,
    ) -> AiContextSectionInput {
        AiContextSectionInput {
            section_key: key.to_string(),
            title: key.to_string(),
            summary: format!("{} summary", key),
            content: content.to_string(),
            token_estimate: content.len() as i64,
            priority: 0,
            facts_json: "{}".to_string(),
            data_quality_json: "{}".to_string(),
            digest: digest.to_string(),
            updated_at,
        }
    }

    #[test]
    fn partial_save_rewrites_only_given_sections() {
        let db = mem_db();
        let pack = sample_pack(
            "analysisX:project-scan",
            &["overview", "techDebt", "clones"],
            "d0",
        );
        AiContextPackRepo::save_pack(
            &db,
            &pack,
            &[
                sample_section("overview", "body-overview", "h-ov-1", 1_000),
                sample_section("techDebt", "body-debt", "h-td-1", 1_000),
                sample_section("clones", "body-clones", "h-cl-1", 1_000),
            ],
        )
        .unwrap();

        // 第二轮只有 techDebt 变了
        let pack2 = sample_pack(
            "analysisX:project-scan",
            &["overview", "techDebt", "clones"],
            "d1",
        );
        let written = AiContextPackRepo::save_sections_partial(
            &db,
            &pack2,
            &[sample_section("techDebt", "body-debt-v2", "h-td-2", 2_000)],
        )
        .unwrap();
        assert_eq!(
            written, 1,
            "partial save must write exactly the changed sections"
        );

        let secs = AiContextSectionRepo::list_by_pack(&db, "analysisX:project-scan").unwrap();
        assert_eq!(secs.len(), 3, "untouched sections must not be deleted");

        let debt = secs.iter().find(|s| s.section_key == "techDebt").unwrap();
        assert_eq!(debt.content, "body-debt-v2");
        assert_eq!(debt.updated_at, 2_000);

        // 这一条是增量的命门：未变分节的 updated_at 不能被刷新，
        // 否则 Agent 用 since 过滤时会把全部分节都当成「变了」，增量退化为全量。
        for key in ["overview", "clones"] {
            let s = secs.iter().find(|s| s.section_key == key).unwrap();
            assert_eq!(
                s.updated_at, 1_000,
                "unchanged section {} must keep its timestamp",
                key
            );
            assert!(
                s.content.starts_with("body-"),
                "unchanged section {} body must survive",
                key
            );
        }

        // 包元信息仍应被更新（digest / generatedAt 反映最新一次构建）
        let p = AiContextPackRepo::get_pack(&db, "analysisX:project-scan")
            .unwrap()
            .unwrap();
        assert_eq!(p.digest, "d1");
        assert_eq!(
            p.section_keys.len(),
            3,
            "pack must keep the full key set, not just the changed one"
        );
    }

    #[test]
    fn stamps_are_listed_without_bodies() {
        let db = mem_db();
        let pack = sample_pack("analysisX:project-scan", &["overview", "techDebt"], "d0");
        AiContextPackRepo::save_pack(
            &db,
            &pack,
            &[
                sample_section("overview", "body-overview", "h-ov-1", 1_500),
                sample_section("techDebt", "body-debt", "h-td-1", 1_700),
            ],
        )
        .unwrap();

        let stamps = AiContextSectionRepo::list_stamps(&db, "analysisX:project-scan").unwrap();
        assert_eq!(stamps.len(), 2);
        let ov = stamps.iter().find(|s| s.section_key == "overview").unwrap();
        assert_eq!(ov.digest, "h-ov-1");
        assert_eq!(ov.updated_at, 1_500);
        assert_eq!(ov.token_estimate, "body-overview".len() as i64);
    }

    #[test]
    fn full_save_still_replaces_the_whole_section_set() {
        // 分节集合变化时前端会退回整包重写，这里确认旧分节确实被清掉（不留孤儿）
        let db = mem_db();
        let pack = sample_pack("analysisX:project-scan", &["overview", "legacy"], "d0");
        AiContextPackRepo::save_pack(
            &db,
            &pack,
            &[
                sample_section("overview", "a", "h1", 1_000),
                sample_section("legacy", "b", "h2", 1_000),
            ],
        )
        .unwrap();

        let pack2 = sample_pack("analysisX:project-scan", &["overview"], "d1");
        AiContextPackRepo::save_pack(
            &db,
            &pack2,
            &[sample_section("overview", "a2", "h3", 2_000)],
        )
        .unwrap();

        let secs = AiContextSectionRepo::list_by_pack(&db, "analysisX:project-scan").unwrap();
        assert_eq!(
            secs.len(),
            1,
            "retired sections must be removed on a full rewrite"
        );
        assert_eq!(secs[0].section_key, "overview");
    }

    fn sample_rule(id: &str, module_id: &str, scope: Option<&str>) -> AiAutoAnalysisRuleRow {
        AiAutoAnalysisRuleRow {
            id: id.to_string(),
            enabled: true,
            module_id: module_id.to_string(),
            scope_id: scope.map(|s| s.to_string()),
            agent_id: "agent_user_configured".to_string(),
            preset_key: "holistic-optimization".to_string(),
            trigger_on: "full-scan".to_string(),
            cooldown_minutes: 30,
            skip_if_unchanged: true,
            last_run_at: 0,
            last_digest: String::new(),
            last_conversation_id: None,
        }
    }

    #[test]
    fn auto_rule_save_is_upsert_and_filters_by_module() {
        let db = mem_db();
        AiAutoAnalysisRuleRepo::save(&db, &sample_rule("r1", "project-scan", None)).unwrap();
        AiAutoAnalysisRuleRepo::save(&db, &sample_rule("r2", "future-module", Some("s1"))).unwrap();

        // 同 id 再存一次应更新而不是插入第二行
        let mut updated = sample_rule("r1", "project-scan", None);
        updated.cooldown_minutes = 90;
        updated.enabled = false;
        AiAutoAnalysisRuleRepo::save(&db, &updated).unwrap();

        let all = AiAutoAnalysisRuleRepo::list(&db, None).unwrap();
        assert_eq!(all.len(), 2, "upsert must not duplicate rows");

        let scan_only = AiAutoAnalysisRuleRepo::list(&db, Some("project-scan")).unwrap();
        assert_eq!(
            scan_only.len(),
            1,
            "module filter should isolate other modules"
        );
        assert_eq!(scan_only[0].cooldown_minutes, 90);
        assert!(!scan_only[0].enabled);
        assert!(
            scan_only[0].scope_id.is_none(),
            "NULL scope = applies to all scopes"
        );
    }

    #[test]
    fn auto_rule_save_preserves_run_state() {
        // 关键回归：UI 改一次配置不能把冷却起点与去重指纹冲掉，
        // 否则「跳过未变更内容」和冷却窗口都会失效，自动化会疯狂触发。
        let db = mem_db();
        AiAutoAnalysisRuleRepo::save(&db, &sample_rule("r1", "project-scan", None)).unwrap();
        AiAutoAnalysisRuleRepo::mark_run(&db, "r1", "digest-abc", Some("conv_1")).unwrap();

        let mut edited = sample_rule("r1", "project-scan", None);
        edited.preset_key = "architecture-health".to_string();
        AiAutoAnalysisRuleRepo::save(&db, &edited).unwrap();

        let rows = AiAutoAnalysisRuleRepo::list(&db, Some("project-scan")).unwrap();
        assert_eq!(
            rows[0].preset_key, "architecture-health",
            "config change applied"
        );
        assert_eq!(
            rows[0].last_digest, "digest-abc",
            "run digest must survive a config save"
        );
        assert_eq!(rows[0].last_conversation_id.as_deref(), Some("conv_1"));
        assert!(
            rows[0].last_run_at > 0,
            "cooldown anchor must survive a config save"
        );
    }

    #[test]
    fn auto_run_records_are_listed_newest_first_and_cascade_on_delete() {
        let db = mem_db();
        AiAutoAnalysisRuleRepo::save(&db, &sample_rule("r1", "project-scan", None)).unwrap();
        for (i, status) in ["skipped", "triggered"].iter().enumerate() {
            AiAutoAnalysisRunRepo::record(
                &db,
                &AiAutoAnalysisRunRow {
                    id: format!("run_{}", i),
                    rule_id: "r1".to_string(),
                    module_id: "project-scan".to_string(),
                    scope_id: "analysis1".to_string(),
                    agent_id: "agent_user_configured".to_string(),
                    preset_key: "holistic-optimization".to_string(),
                    pack_id: Some("analysis1:project-scan".to_string()),
                    conversation_id: None,
                    trigger_kind: "full-scan".to_string(),
                    status: status.to_string(),
                    detail: "detail".to_string(),
                    context_digest: String::new(),
                    reason: String::new(),
                    outcome: String::new(),
                    insight_count: 0,
                    finished_at: 0,
                    created_at: 0,
                },
            )
            .unwrap();
        }
        let recent = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        assert_eq!(recent.len(), 2);
        // 同秒插入时靠 rowid 兜底保证「最新在前」，否则 UI 顺序会抖
        assert_eq!(recent[0].status, "triggered");

        AiAutoAnalysisRuleRepo::delete(&db, "r1").unwrap();
        assert!(AiAutoAnalysisRuleRepo::list(&db, None).unwrap().is_empty());
        assert!(
            AiAutoAnalysisRunRepo::list_recent(&db, 10)
                .unwrap()
                .is_empty(),
            "deleting a rule must not leave orphan run records"
        );
    }

    // ─── 结论时效：证据快照 + 过期复核 ───

    /// 往 project_files 写一条文件记录（模拟一次扫描的产物）
    fn put_file(db: &Arc<Database>, analysis_id: &str, rel_path: &str, hash: &str) {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO project_files \
             (id, analysis_id, path, rel_path, name, content_hash, is_directory) \
             VALUES (?1,?2,?3,?4,?5,?6,0)",
            params![
                format!("file_{}_{}", analysis_id, rel_path.replace('/', "_")),
                analysis_id,
                format!("/abs/{}", rel_path),
                rel_path,
                rel_path.rsplit('/').next().unwrap_or(rel_path),
                hash,
            ],
        )
        .unwrap();
    }

    fn drop_file(db: &Arc<Database>, analysis_id: &str, rel_path: &str) {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "DELETE FROM project_files WHERE analysis_id = ?1 AND rel_path = ?2",
            params![analysis_id, rel_path],
        )
        .unwrap();
    }

    // ─── 引用核验：把幻觉挡在落库之前 ───

    fn put_file_lines(db: &Arc<Database>, analysis_id: &str, rel_path: &str, lines: i64) {
        put_file(db, analysis_id, rel_path, "h");
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE project_files SET line_count = ?1 WHERE analysis_id = ?2 AND rel_path = ?3",
            params![lines, analysis_id, rel_path],
        )
        .unwrap();
    }

    fn snapshot_of(db: &Arc<Database>, analysis_id: &str) -> AnalysisFileSnapshot {
        let conn = db.0.lock().unwrap();
        AiInsightRepo::load_file_snapshot(&conn, analysis_id)
    }

    #[test]
    fn split_ref_line_extracts_line_and_keeps_path_in_sync() {
        assert_eq!(
            split_ref_line("src/a.ts:120"),
            ("src/a.ts".into(), Some(120))
        );
        // `:行:列` 取行不取列，且路径与 normalize_ref_path 剥出的结果一致
        assert_eq!(
            split_ref_line("src/a.ts:120:8"),
            ("src/a.ts".into(), Some(120))
        );
        assert_eq!(split_ref_line("src/a.ts"), ("src/a.ts".into(), None));
        assert_eq!(split_ref_line("src/a.ts:0"), ("src/a.ts".into(), None));
    }

    #[test]
    fn verify_refs_passes_exact_paths_untouched() {
        let db = mem_db();
        put_file_lines(&db, "vr1", "src/a.ts", 200);
        let snap = snapshot_of(&db, "vr1");
        let v = AiInsightRepo::verify_refs(&snap, &["src/a.ts:120".to_string()]);
        assert_eq!(v.checks[0].status, ref_check_status::EXACT);
        assert_eq!(v.accepted_refs(), vec!["src/a.ts:120".to_string()]);
        assert!(v.rejected().is_empty());
    }

    #[test]
    fn verify_refs_aligns_bare_filename_to_real_path() {
        let db = mem_db();
        put_file_lines(&db, "vr2", "src/deep/nested/only.ts", 90);
        let snap = snapshot_of(&db, "vr2");
        let v = AiInsightRepo::verify_refs(&snap, &["only.ts:12".to_string()]);
        assert_eq!(v.checks[0].status, ref_check_status::ALIGNED);
        // 落库的是真实路径，行号保留 —— 否则画布/报告仍旧点不开
        assert_eq!(
            v.accepted_refs(),
            vec!["src/deep/nested/only.ts:12".to_string()]
        );
        assert!(v.checks[0].note.contains("src/deep/nested/only.ts"));
    }

    #[test]
    fn verify_refs_drops_out_of_range_line_but_keeps_file() {
        let db = mem_db();
        put_file_lines(&db, "vr3", "src/a.ts", 40);
        let snap = snapshot_of(&db, "vr3");
        let v = AiInsightRepo::verify_refs(&snap, &["src/a.ts:900".to_string()]);
        assert_eq!(v.checks[0].status, ref_check_status::LINE_OUT_OF_RANGE);
        assert_eq!(v.accepted_refs(), vec!["src/a.ts".to_string()]);
        assert!(v.checks[0].note.contains("40"));
    }

    #[test]
    fn verify_refs_rejects_hallucinated_path_and_offers_candidates() {
        let db = mem_db();
        put_file_lines(&db, "vr4", "src/ai/tools.rs", 100);
        put_file_lines(&db, "vr4", "src/other/tools.rs", 100);
        let snap = snapshot_of(&db, "vr4");
        // 重名文件不做对齐（猜错比不猜危害大），但要把候选摆出来
        let v = AiInsightRepo::verify_refs(&snap, &["lib/tools.rs:10".to_string()]);
        assert_eq!(v.checks[0].status, ref_check_status::UNKNOWN);
        assert!(v.all_rejected());
        assert_eq!(
            v.checks[0].candidates,
            vec![
                "src/ai/tools.rs".to_string(),
                "src/other/tools.rs".to_string()
            ]
        );
    }

    #[test]
    fn verify_refs_keeps_valid_part_when_only_some_refs_are_wrong() {
        let db = mem_db();
        put_file_lines(&db, "vr5", "src/a.ts", 200);
        let snap = snapshot_of(&db, "vr5");
        let v = AiInsightRepo::verify_refs(
            &snap,
            &["src/a.ts:10".to_string(), "src/ghost.ts:3".to_string()],
        );
        assert!(!v.all_rejected());
        assert_eq!(v.accepted_refs(), vec!["src/a.ts:10".to_string()]);
        assert_eq!(v.rejected().len(), 1);
    }

    #[test]
    fn verify_refs_never_blocks_when_project_has_no_scan_yet() {
        let snap = AnalysisFileSnapshot::default();
        let v = AiInsightRepo::verify_refs(&snap, &["whatever/x.ts:1".to_string()]);
        assert_eq!(v.checks[0].status, ref_check_status::UNVERIFIABLE);
        assert!(!v.all_rejected(), "没有对照物时不能否定模型");
        assert_eq!(v.accepted_refs(), vec!["whatever/x.ts:1".to_string()]);
    }

    #[test]
    fn nearest_matches_path_suffix_and_extension_swap() {
        let db = mem_db();
        put_file_lines(&db, "vr6", "packages/app/src/store/index.ts", 30);
        put_file_lines(&db, "vr6", "src/panel/Widget.tsx", 30);
        let snap = snapshot_of(&db, "vr6");
        // 省略前缀
        assert_eq!(
            snap.nearest("src/store/index.ts", 3),
            vec!["packages/app/src/store/index.ts".to_string()]
        );
        // 扩展名猜错
        assert_eq!(
            snap.nearest("src/panel/Widget.ts", 3),
            vec!["src/panel/Widget.tsx".to_string()]
        );
    }

    #[test]
    fn normalize_ref_path_strips_line_and_column() {
        assert_eq!(normalize_ref_path("src/a.ts:120"), "src/a.ts");
        assert_eq!(normalize_ref_path("src/a.ts:120:8"), "src/a.ts");
        assert_eq!(normalize_ref_path("./src//a.ts"), "src/a.ts");
        assert_eq!(normalize_ref_path("src/ai/"), "src/ai");
        assert_eq!(normalize_ref_path("src\\ai\\b.ts"), "src/ai/b.ts");
        // 冒号后不是纯数字就不是行号，不能误剥
        assert_eq!(normalize_ref_path("src/a.ts:main"), "src/a.ts:main");
    }

    #[test]
    fn freshness_is_current_while_cited_code_is_untouched() {
        let db = mem_db();
        put_file(&db, "a1", "src/auth.ts", "hash_v1");
        let mut row = sample_row("a1", "finding", "high", "Auth coupling");
        row.refs = vec!["src/auth.ts:12".into()];
        AiInsightRepo::save_dedup(&db, &row).unwrap();

        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].freshness, insight_freshness::CURRENT);
        assert!(rows[0].changed_refs.is_empty());
        // 证据快照必须真的冻结了当时的哈希，否则后面根本无从比对
        assert_eq!(rows[0].evidence[0].path, "src/auth.ts");
        assert_eq!(rows[0].evidence[0].hash.as_deref(), Some("hash_v1"));
    }

    #[test]
    fn freshness_turns_stale_when_cited_file_content_changes() {
        let db = mem_db();
        put_file(&db, "a1", "src/auth.ts", "hash_v1");
        let mut row = sample_row("a1", "finding", "high", "Auth coupling");
        row.refs = vec!["src/auth.ts:12".into()];
        AiInsightRepo::save_dedup(&db, &row).unwrap();

        // 下一次扫描：同一文件内容变了
        put_file(&db, "a1", "src/auth.ts", "hash_v2");
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].freshness, insight_freshness::STALE);
        assert_eq!(rows[0].changed_refs, vec!["src/auth.ts".to_string()]);

        // Agent 重新确认这条结论 → 证据基线跟着更新，否则它会永远显示「待复核」
        AiInsightRepo::save_dedup(&db, &row).unwrap();
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows.len(), 1, "reconfirm must not create a second row");
        assert_eq!(rows[0].seen_count, 2);
        assert_eq!(rows[0].freshness, insight_freshness::CURRENT);
    }

    #[test]
    fn freshness_is_orphaned_when_all_cited_files_disappear() {
        let db = mem_db();
        put_file(&db, "a1", "src/legacy.ts", "hash_v1");
        put_file(&db, "a1", "src/keep.ts", "keep_v1");
        let mut row = sample_row("a1", "risk", "medium", "Legacy module still wired in");
        row.refs = vec!["src/legacy.ts:3".into()];
        AiInsightRepo::save_dedup(&db, &row).unwrap();

        drop_file(&db, "a1", "src/legacy.ts");
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].freshness, insight_freshness::ORPHANED);
        assert_eq!(rows[0].missing_refs, vec!["src/legacy.ts".to_string()]);
    }

    #[test]
    fn insight_without_refs_is_unanchored_and_empty_scan_is_unknown() {
        let db = mem_db();
        put_file(&db, "a1", "src/a.ts", "h1");
        let mut row = sample_row("a1", "summary", "info", "Overall architecture is fine");
        row.refs = vec![];
        AiInsightRepo::save_dedup(&db, &row).unwrap();
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].freshness, insight_freshness::UNANCHORED);

        // 另一个分析压根没有文件快照：不能因为「查不到文件」就判成 orphaned，
        // 没有对照物时说「文件都不见了」是彻头彻尾的误报。
        let mut other = sample_row("a2", "finding", "high", "Something");
        other.refs = vec!["src/x.ts:1".into()];
        AiInsightRepo::save_dedup(&db, &other).unwrap();
        let rows = AiInsightRepo::list_by_analysis(&db, "a2").unwrap();
        assert_eq!(rows[0].freshness, insight_freshness::UNKNOWN);
    }

    #[test]
    fn legacy_insight_without_evidence_snapshot_is_unknown_not_current() {
        let db = mem_db();
        put_file(&db, "a1", "src/a.ts", "h1");
        let row = sample_row(
            "a1",
            "finding",
            "low",
            "Old conclusion from before snapshots",
        );
        AiInsightRepo::save_dedup(&db, &row).unwrap();
        // 模拟历史数据：把证据快照抹掉（旧版本写库时还没有这一列）
        {
            let conn = db.0.lock().unwrap();
            conn.execute("UPDATE ai_insights SET evidence_json = NULL", [])
                .unwrap();
        }
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(
            rows[0].freshness,
            insight_freshness::UNKNOWN,
            "no snapshot means we cannot claim the conclusion still holds"
        );
        assert!(rows[0].missing_refs.is_empty());
    }

    #[test]
    fn resolve_closes_conclusion_and_requires_a_reason() {
        let db = mem_db();
        put_file(&db, "a1", "src/dup.ts", "h1");
        let mut row = sample_row("a1", "finding", "medium", "Duplicated config loader");
        row.refs = vec!["src/dup.ts:4".into()];
        AiInsightRepo::save_dedup(&db, &row).unwrap();

        // 新结论默认开放，否则它一出生就不会被任何人看见
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].status, insight_status::OPEN);

        // 空理由必须被拒：无理由的关闭等同于把问题扫到地毯下面
        assert!(AiInsightRepo::resolve(&db, "a1", &rows[0].id, "   ", "agent_x").is_err());
        // 定位不到也必须报错，不能静默成功让调用方误以为已收口
        assert!(AiInsightRepo::resolve(&db, "a1", "no_such_id", "done", "agent_x").is_err());

        AiInsightRepo::resolve(&db, "a1", &rows[0].id, "重复实现已合并", "agent_x").unwrap();
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows[0].status, insight_status::RESOLVED);
        assert_eq!(rows[0].resolved_reason.as_deref(), Some("重复实现已合并"));
        assert_eq!(rows[0].resolved_by.as_deref(), Some("agent_x"));
        assert!(rows[0].resolved_at > 0);
    }

    #[test]
    fn resolve_accepts_title_locator_but_refuses_ambiguous_ones() {
        let db = mem_db();
        let mut a = sample_row("a1", "finding", "high", "Circular dependency in editor");
        a.id = "ins_a".into();
        AiInsightRepo::save_dedup(&db, &a).unwrap();

        // Agent 常常只带回标题：归一化后能唯一命中就允许，标点大小写差异不该挡住收口
        let id = AiInsightRepo::resolve(
            &db,
            "a1",
            "  circular dependency in editor!  ",
            "环已拆除",
            "user",
        )
        .unwrap();
        assert_eq!(id, "ins_a");

        // 同标题不同类别 → 指纹不同、是两条结论；此时按标题定位有歧义，必须拒绝而不是乱关一条
        let mut b = sample_row("a1", "risk", "high", "Circular dependency in editor");
        b.id = "ins_b".into();
        AiInsightRepo::save_dedup(&db, &b).unwrap();
        let err = AiInsightRepo::resolve(&db, "a1", "Circular dependency in editor", "x", "user")
            .unwrap_err();
        assert!(err.contains("insight_id"), "歧义时必须提示改用 id：{err}");
    }

    #[test]
    fn reobserving_a_resolved_conclusion_reopens_it() {
        let db = mem_db();
        put_file(&db, "a1", "src/dup.ts", "h1");
        let mut row = sample_row("a1", "finding", "medium", "Duplicated config loader");
        row.refs = vec!["src/dup.ts:4".into()];
        AiInsightRepo::save_dedup(&db, &row).unwrap();
        AiInsightRepo::resolve(&db, "a1", &row.id, "已合并", "agent_x").unwrap();

        // 后来问题又回来了（改动回退 / 当初关早了）：再次观察到就必须重开，
        // 让真实存在的问题从面板上消失，比重复提醒危险得多。
        AiInsightRepo::save_dedup(&db, &row).unwrap();
        let rows = AiInsightRepo::list_by_analysis(&db, "a1").unwrap();
        assert_eq!(rows.len(), 1, "重开不能变成新建一条");
        assert_eq!(rows[0].status, insight_status::OPEN);
        assert_eq!(rows[0].seen_count, 2);
        assert!(rows[0].resolved_reason.is_none());
    }

    // ── 分析维度覆盖台账：每个维度最近一次「真正跑过」的记录 ──

    fn run_row(preset: &str, status: &str, digest: &str, created_at: i64) -> AiAutoAnalysisRunRow {
        AiAutoAnalysisRunRow {
            id: format!("arun_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
            rule_id: "rule_1".into(),
            module_id: "project-scan".into(),
            scope_id: "a1".into(),
            agent_id: "agent_x".into(),
            preset_key: preset.into(),
            pack_id: Some("a1:project-scan".into()),
            conversation_id: Some("conv_1".into()),
            trigger_kind: "full-scan".into(),
            status: status.into(),
            detail: String::new(),
            context_digest: digest.into(),
            reason: String::new(),
            outcome: String::new(),
            insight_count: 0,
            finished_at: 0,
            created_at,
        }
    }

    /// created_at 有 DEFAULT，record 不写它 —— 测试要控制时间只能事后改。
    fn record_at(db: &Arc<Database>, r: &AiAutoAnalysisRunRow) {
        AiAutoAnalysisRunRepo::record(db, r).unwrap();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "UPDATE ai_auto_analysis_runs SET created_at = ?1 WHERE id = ?2",
            params![r.created_at, r.id],
        )
        .unwrap();
    }

    #[test]
    fn coverage_takes_the_latest_run_of_each_preset() {
        let db = mem_db();
        record_at(&db, &run_row("architecture-health", "triggered", "d1", 100));
        record_at(&db, &run_row("architecture-health", "triggered", "d2", 200));
        record_at(&db, &run_row("tech-debt-cleanup", "triggered", "d1", 150));

        let rows = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 2, "每个维度只应出现一次");
        let arch = rows
            .iter()
            .find(|r| r.preset_key == "architecture-health")
            .unwrap();
        assert_eq!(arch.context_digest, "d2", "必须取最近那一次的指纹");
        assert_eq!(rows[0].preset_key, "architecture-health", "按时间倒序");
    }

    #[test]
    fn coverage_ignores_skipped_and_failed_runs() {
        // 绿灯必须意味着「真的分析过」。把冷却跳过算成已覆盖，
        // 台账就会掩盖一个从没被分析过的维度——这是这张表唯一不能出错的地方。
        let db = mem_db();
        record_at(&db, &run_row("hotspot-deepdive", "skipped", "", 100));
        record_at(&db, &run_row("hotspot-deepdive", "failed", "", 120));
        let rows = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert!(rows.is_empty(), "只跳过/失败过的维度等于从未覆盖");
    }

    #[test]
    fn coverage_is_isolated_per_scope_and_module() {
        // 不同项目（scope）的分析记录混在一起，会让 A 项目的绿灯挂到 B 项目头上
        let db = mem_db();
        record_at(&db, &run_row("refactor-priority", "triggered", "d1", 100));
        let mut other = run_row("refactor-priority", "triggered", "d9", 200);
        other.scope_id = "a2".into();
        record_at(&db, &other);

        let a1 = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert_eq!(a1.len(), 1);
        assert_eq!(a1[0].context_digest, "d1");

        let mut foreign = run_row("refactor-priority", "triggered", "dx", 300);
        foreign.module_id = "project-canvas".into();
        record_at(&db, &foreign);
        let still = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert_eq!(still[0].context_digest, "d1", "别的模块不该污染本模块台账");
    }

    // ── 自动化连续性：发起回执 + 补跑判据 ──

    #[test]
    fn finish_closes_a_pending_run_and_appends_detail() {
        let db = mem_db();
        let mut r = run_row("architecture-health", "triggered", "d1", 100);
        r.outcome = "pending".into();
        r.detail = "已发起分析：建议读 3/11 个分节".into();
        record_at(&db, &r);

        AiAutoAnalysisRunRepo::finish(&db, &r.id, "completed", 4, "产出 4 条结论").unwrap();

        let rows = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        assert_eq!(rows[0].outcome, "completed");
        assert_eq!(rows[0].insight_count, 4);
        assert!(rows[0].finished_at > 0, "回执必须留下落点时间");
        // detail 是追加不是覆盖：发起时写「读了什么」，回执补「产出什么」，
        // 覆盖掉前半段就等于把这一轮的成本信息丢了
        assert!(rows[0].detail.contains("建议读 3/11"));
        assert!(rows[0].detail.contains("产出 4 条结论"));
    }

    #[test]
    fn coverage_excludes_runs_that_ended_in_error() {
        // triggered 只代表「消息发出去了」。对话中途失败那一轮一条结论都没有，
        // 跟没跑过没区别，仍算覆盖就是换个姿势点假绿灯。
        let db = mem_db();
        let mut ok = run_row("architecture-health", "triggered", "d1", 100);
        ok.outcome = "completed".into();
        record_at(&db, &ok);
        let mut bad = run_row("architecture-health", "triggered", "d2", 200);
        bad.outcome = "error".into();
        record_at(&db, &bad);

        let rows = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].context_digest, "d1",
            "出错那轮要跳过，回落到上一次真正成功的记录"
        );
    }

    #[test]
    fn coverage_keeps_legacy_rows_and_no_output_rows() {
        // outcome 空串 = 回执特性上线前的历史数据。一收紧就会把用户过去
        // 分析过的所有维度刷成「从未分析」，台账反而更不可信。
        // no-output 同样算覆盖：认真看过、确实没发现问题是合法结论。
        let db = mem_db();
        record_at(&db, &run_row("legacy-dim", "triggered", "d1", 100));
        let mut empty = run_row("silent-dim", "triggered", "d2", 110);
        empty.outcome = "no-output".into();
        record_at(&db, &empty);

        let rows = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn latest_per_rule_returns_one_row_per_rule_regardless_of_status() {
        // 补跑判定要问的是「这条规则最后一次到底怎么了」，
        // 所以跳过也必须能查到——只查 triggered 就永远看不见欠着的那一轮。
        let db = mem_db();
        let mut a1 = run_row("architecture-health", "triggered", "d1", 100);
        a1.rule_id = "rule_a".into();
        record_at(&db, &a1);
        let mut a2 = run_row("architecture-health", "skipped", "", 200);
        a2.rule_id = "rule_a".into();
        a2.reason = "cooling".into();
        record_at(&db, &a2);
        let mut b1 = run_row("tech-debt-cleanup", "triggered", "d3", 150);
        b1.rule_id = "rule_b".into();
        record_at(&db, &b1);

        let rows = AiAutoAnalysisRunRepo::latest_per_rule(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 2, "每条规则只回一行");
        let a = rows.iter().find(|r| r.rule_id == "rule_a").unwrap();
        assert_eq!(a.status, "skipped");
        assert_eq!(a.reason, "cooling", "机器可读原因必须原样存取");
    }

    // ─── 证据现状指纹：复核派单收敛的唯一判据 ───

    #[test]
    fn evidence_state_digest_tracks_current_content_not_frozen_hash() {
        // 它必须描述「此刻代码长什么样」，而不是「结论产出时代码长什么样」。
        // 两者混淆的后果：文件改了指纹却不变 → 复核单永远派不出去。
        let db = mem_db();
        put_file(&db, "ed1", "src/a.ts", "H_NOW");
        let snap = snapshot_of(&db, "ed1");
        // 证据里冻结的是产出当时的 H_OLD，与当下的 H_NOW 不同
        let ev = vec![InsightEvidence {
            path: "src/a.ts".into(),
            hash: Some("H_OLD".into()),
        }];
        let d1 = AiInsightRepo::evidence_state_digest(&ev, &snap);
        assert!(!d1.is_empty());

        // 冻结哈希换一个值不影响现状指纹——现状只看库里的当前内容
        let ev2 = vec![InsightEvidence {
            path: "src/a.ts".into(),
            hash: Some("H_ANOTHER_OLD".into()),
        }];
        assert_eq!(
            d1,
            AiInsightRepo::evidence_state_digest(&ev2, &snap),
            "现状指纹不能被结论里冻结的旧哈希影响"
        );

        // 文件真的被改了 → 指纹必须变，否则复核单永远派不出去
        put_file(&db, "ed1", "src/a.ts", "H_CHANGED");
        let snap2 = snapshot_of(&db, "ed1");
        assert_ne!(
            d1,
            AiInsightRepo::evidence_state_digest(&ev, &snap2),
            "文件内容变化必须反映到现状指纹"
        );
    }

    #[test]
    fn evidence_state_digest_is_order_independent_and_marks_deletion() {
        let db = mem_db();
        put_file(&db, "ed2", "src/a.ts", "HA");
        put_file(&db, "ed2", "src/b.ts", "HB");
        let snap = snapshot_of(&db, "ed2");
        let mk = |paths: &[&str]| {
            paths
                .iter()
                .map(|p| InsightEvidence {
                    path: (*p).into(),
                    hash: Some("frozen".into()),
                })
                .collect::<Vec<_>>()
        };
        // 证据解析顺序不该改变指纹，否则同一组证据会在不同轮次被判成「又变了」，
        // 于是每一轮都重新派复核单——不收敛。
        assert_eq!(
            AiInsightRepo::evidence_state_digest(&mk(&["src/a.ts", "src/b.ts"]), &snap),
            AiInsightRepo::evidence_state_digest(&mk(&["src/b.ts", "src/a.ts"]), &snap),
        );

        // 「文件被删」与「文件存在」必须是两个指纹，否则删文件不会触发复核，
        // 那条指向空气的结论会永远挂在账上。
        let before = AiInsightRepo::evidence_state_digest(&mk(&["src/a.ts"]), &snap);
        drop_file(&db, "ed2", "src/a.ts");
        let after =
            AiInsightRepo::evidence_state_digest(&mk(&["src/a.ts"]), &snapshot_of(&db, "ed2"));
        assert_ne!(before, after, "证据文件消失必须改变现状指纹");
    }

    #[test]
    fn evidence_state_digest_is_empty_when_nothing_to_observe() {
        // 空证据 / 空快照时给空串而不是某个固定哈希：空串在上层被当作「没记账」，
        // 会宁可多派一次复核；而一个固定哈希会被误认为「已经对过账了」，从此静默。
        let db = mem_db();
        let snap = snapshot_of(&db, "ed3");
        let ev = vec![InsightEvidence {
            path: "src/a.ts".into(),
            hash: Some("h".into()),
        }];
        assert_eq!(AiInsightRepo::evidence_state_digest(&ev, &snap), "");
        put_file(&db, "ed4", "src/a.ts", "h");
        assert_eq!(
            AiInsightRepo::evidence_state_digest(&[], &snapshot_of(&db, "ed4")),
            ""
        );
    }

    // ─── 焦点巡查派单台账 ───

    fn assign_row(path: &str, digest: &str, at: i64) -> AiFocusAssignmentRow {
        AiFocusAssignmentRow {
            module_id: "project-scan".into(),
            scope_id: "a1".into(),
            file_path: path.into(),
            run_id: "arun_x".into(),
            preset_key: "refactor-priority".into(),
            context_digest: digest.into(),
            resonance: 3,
            note: "复杂度 × 变更 × 扇入".into(),
            assign_count: 1,
            assigned_at: at,
            outcome: String::new(),
            evidence_digest: String::new(),
            regression_digest: String::new(),
        }
    }

    #[test]
    fn focus_assignment_upserts_instead_of_appending() {
        // 同一个文件被反复点名时必须更新同一行并累加次数。
        // 追加新行会让这张表随轮次线性膨胀，而判定只用得到最近一次。
        let db = mem_db();
        AiFocusAssignmentRepo::record_many(&db, &[assign_row("src/a.ts", "d1", 100)]).unwrap();
        AiFocusAssignmentRepo::record_many(&db, &[assign_row("src/a.ts", "d2", 200)]).unwrap();

        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 1, "同一文件只保留一行");
        assert_eq!(
            rows[0].assign_count, 2,
            "次数累加，用于发现「点名多次仍无结论」"
        );
        assert_eq!(
            rows[0].context_digest, "d2",
            "指纹更新为最近一次，否则永远判成数据已变"
        );
        assert_eq!(rows[0].assigned_at, 200);
    }

    #[test]
    fn focus_assignment_records_evidence_digest_for_recheck_convergence() {
        // 复核派单的销账凭据：派单时记下证据现状，只有证据**再次**变化才重新排队。
        // 这一列不落库，Agent 复核后判定「结论仍成立」而没写任何东西时，
        // 这个文件会被每一轮重新点名——不收敛地烧 token。
        let db = mem_db();
        let mut first = assign_row("src/a.ts", "d1", 100);
        first.evidence_digest = "EV1".into();
        AiFocusAssignmentRepo::record_many(&db, &[first]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].evidence_digest, "EV1", "证据现状必须原样存取");

        // 同一文件再次派单（证据又变了）→ 覆盖为最新，否则第二次变化永远无法被销账
        let mut second = assign_row("src/a.ts", "d2", 200);
        second.evidence_digest = "EV2".into();
        AiFocusAssignmentRepo::record_many(&db, &[second]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].evidence_digest, "EV2");

        // 非复核派单留空是合法状态：读侧据此当作「没记过账」，宁可多看一次，
        // 也好过让一条过期结论永远挂着误导后续每一轮。
        let mut plain = assign_row("src/b.ts", "d2", 200);
        plain.evidence_digest = String::new();
        AiFocusAssignmentRepo::record_many(&db, &[plain]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        let b = rows.iter().find(|r| r.file_path == "src/b.ts").unwrap();
        assert_eq!(b.evidence_digest, "");
    }

    #[test]
    fn focus_assignment_keeps_three_digests_independent() {
        // 三个指纹必须各存各的。这是最容易出的一种事故：为了省一列而复用，
        // 于是「复核销账」把「回归销账」冲掉——那笔账从此永远销不掉（每轮重复点名烧钱），
        // 或者永远销得掉（真的变坏了也再没人看）。两种都不报错，只是账悄悄错了。
        let db = mem_db();
        let mut row = assign_row("src/a.ts", "CTX1", 100);
        row.evidence_digest = "EV1".into();
        row.regression_digest = "RG1".into();
        AiFocusAssignmentRepo::record_many(&db, &[row]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].context_digest, "CTX1");
        assert_eq!(rows[0].evidence_digest, "EV1");
        assert_eq!(rows[0].regression_digest, "RG1", "回归指纹要能原样存取");

        // 只有回归变了（继续变坏），复核那笔账不该被动到——反之亦然。
        let mut again = assign_row("src/a.ts", "CTX1", 200);
        again.evidence_digest = "EV1".into();
        again.regression_digest = "RG2".into();
        AiFocusAssignmentRepo::record_many(&db, &[again]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].evidence_digest, "EV1", "复核账不受回归派单影响");
        assert_eq!(rows[0].regression_digest, "RG2");
        assert_eq!(rows[0].assign_count, 2);
    }

    #[test]
    fn focus_assignment_isolates_scope_and_skips_blank_paths() {
        // 作用域隔离：切换项目后不能把上一个项目的派单当成本项目已巡查。
        // 空路径直接丢弃：它进不了主键去重，只会变成一行永远匹配不上任何目标的垃圾。
        let db = mem_db();
        let mut other = assign_row("src/a.ts", "d1", 100);
        other.scope_id = "a2".into();
        AiFocusAssignmentRepo::record_many(
            &db,
            &[
                assign_row("src/a.ts", "d1", 100),
                other,
                assign_row("   ", "d1", 100),
            ],
        )
        .unwrap();

        let a1 = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(a1.len(), 1);
        assert_eq!(a1[0].file_path, "src/a.ts");
        let a2 = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a2").unwrap();
        assert_eq!(a2.len(), 1);
    }

    #[test]
    fn focus_assignment_settles_by_run_and_reopens_on_redispatch() {
        // 回执把这一轮点名的结局落到派单行上：error = 这次点名没真的发生过，
        // 读侧据此把它退回队列。重新点名时 outcome 必须清空，
        // 否则它会一直挂着上一轮的 error，被永远当成「待重派」反复点名。
        let db = mem_db();
        AiFocusAssignmentRepo::record_many(&db, &[assign_row("src/a.ts", "d1", 100)]).unwrap();
        let n = AiFocusAssignmentRepo::settle_by_run(&db, "arun_x", "error").unwrap();
        assert_eq!(n, 1);
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].outcome, "error");

        AiFocusAssignmentRepo::record_many(&db, &[assign_row("src/a.ts", "d1", 200)]).unwrap();
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].outcome, "", "重新派单必须重置核销状态");
        assert_eq!(
            rows[0].assign_count, 2,
            "重派累加次数——多次未落实才是人工介入的信号"
        );
    }

    #[test]
    fn focus_assignment_settle_ignores_stale_receipt_from_an_earlier_run() {
        // 迟到的回执不能污染新一轮：文件已被 run2 重新点名后，run1 的 error 回执
        // 必须一行都匹配不上。按文件核销就会犯这个错——把新一轮判成失败，
        // 于是这个文件立刻被重新排队，形成只在慢响应下偶发的重复烧钱。
        let db = mem_db();
        AiFocusAssignmentRepo::record_many(&db, &[assign_row("src/a.ts", "d1", 100)]).unwrap();
        let mut later = assign_row("src/a.ts", "d1", 200);
        later.run_id = "arun_y".into();
        AiFocusAssignmentRepo::record_many(&db, &[later]).unwrap();

        let n = AiFocusAssignmentRepo::settle_by_run(&db, "arun_x", "error").unwrap();
        assert_eq!(n, 0, "迟到回执自动作废");
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(
            rows[0].outcome, "",
            "新一轮仍处于待回执状态，未被误判为失败"
        );
    }

    // ─── 中断轮次清算：回执写在进程里，进程没了就永远写不成 ───

    /// 造一轮「已发起但没等到回执」的轨迹，并把它那一轮点名的文件一并登记。
    fn pending_run_with_target(db: &Arc<Database>, created_at: i64, path: &str) -> String {
        let mut r = run_row("architecture-health", "triggered", "d1", created_at);
        r.outcome = "pending".into();
        r.detail = "已发起分析：建议读 3/11 个分节".into();
        record_at(db, &r);
        let mut a = assign_row(path, "d1", created_at);
        a.run_id = r.id.clone();
        AiFocusAssignmentRepo::record_many(db, &[a]).unwrap();
        r.id
    }

    #[test]
    fn reap_settles_a_stale_pending_run_and_releases_its_focus_targets() {
        // 应用在分析途中被关掉，那一轮既没 completed 也没 error，永远停在 pending。
        // 此时覆盖台账看 status='triggered' 点绿灯、派单台账看 outcome='' 当已落实，
        // 两张表一起说谎，而这一轮实际上一条结论都没产出。
        let db = mem_db();
        let run_id = pending_run_with_target(&db, 100, "src/hot.ts");

        let n =
            AiAutoAnalysisRunRepo::reap_stale_pending(&db, "project-scan", "a1", 1800, 100 + 1801)
                .unwrap();
        assert_eq!(n, 1);

        let runs = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        let r = runs.iter().find(|r| r.id == run_id).unwrap();
        assert_eq!(r.outcome, "interrupted");
        assert!(r.finished_at > 0, "清算也要留下落点时间");
        assert!(
            r.detail.contains("建议读 3/11"),
            "原有 detail 是追加不是覆盖"
        );
        assert!(r.detail.contains("中断"));

        // 两张表必须同一事务落定：只标轨迹不退派单，等于把同一个 bug 换个更隐蔽的姿势
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(
            rows[0].outcome, "interrupted",
            "那一轮点名的文件必须退回队列"
        );

        // 中断与 error 同列：这一轮一条结论都没有，算作覆盖就是为一次「关窗口」点永久绿灯
        let cov = AiAutoAnalysisRunRepo::latest_per_preset(&db, "project-scan", "a1").unwrap();
        assert!(cov.is_empty(), "中断的轮次不算覆盖");
    }

    #[test]
    fn reap_leaves_a_recently_started_pending_run_alone() {
        // 等得太短会把正在认真思考的长任务判成中断并重复发起——比漏判更贵
        let db = mem_db();
        let run_id = pending_run_with_target(&db, 100, "src/hot.ts");
        let n =
            AiAutoAnalysisRunRepo::reap_stale_pending(&db, "project-scan", "a1", 1800, 100 + 60)
                .unwrap();
        assert_eq!(n, 0);
        let runs = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        assert_eq!(
            runs.iter().find(|r| r.id == run_id).unwrap().outcome,
            "pending"
        );
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].outcome, "", "派单同样保持待回执");
    }

    #[test]
    fn reap_does_not_release_a_target_already_redispatched_by_a_later_run() {
        // 与 settle_by_run 同一条口径：文件若已被后一轮重新点名，run_id 早被覆盖，
        // 这条迟到的清算一行也匹配不上。否则新一轮会被误判成中断而立刻重排——
        // 一个只在「上一轮悬空、下一轮已发出」的窗口里偶发的重复烧钱。
        let db = mem_db();
        let run_id = pending_run_with_target(&db, 100, "src/hot.ts");
        let mut later = assign_row("src/hot.ts", "d2", 300);
        later.run_id = "arun_later".into();
        AiFocusAssignmentRepo::record_many(&db, &[later]).unwrap();

        let n =
            AiAutoAnalysisRunRepo::reap_stale_pending(&db, "project-scan", "a1", 1800, 100 + 1801)
                .unwrap();
        assert_eq!(n, 1, "轨迹本身仍要落定");
        let runs = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        assert_eq!(
            runs.iter().find(|r| r.id == run_id).unwrap().outcome,
            "interrupted"
        );
        let rows = AiFocusAssignmentRepo::list_by_scope(&db, "project-scan", "a1").unwrap();
        assert_eq!(rows[0].outcome, "", "新一轮的派单不受迟到清算影响");
    }

    // ── 指标快照：时间轴的诚实性 ──

    fn snap_row(id: &str, digest: &str, metrics: &str) -> AiMetricSnapshotRow {
        AiMetricSnapshotRow {
            id: id.into(),
            module_id: "project-scan".into(),
            scope_id: "a1".into(),
            digest: digest.into(),
            trigger_kind: "full-scan".into(),
            metrics_json: metrics.into(),
            coverage_json: "[]".into(),
            first_at: 0,
            last_at: 0,
            seen_count: 1,
        }
    }

    #[test]
    fn unchanged_metrics_extend_the_same_point_instead_of_adding_a_new_one() {
        // 文件监视触发的增量重扫一天能有几十次。每次插一行，几小时就把
        // 有意义的历史挤出保留窗口，时间轴变成一片噪声。
        let db = mem_db();
        let (_, new1) =
            AiMetricSnapshotRepo::record(&db, &snap_row("s1", "d1", "{}"), 100).unwrap();
        let (id2, new2) =
            AiMetricSnapshotRepo::record(&db, &snap_row("s2", "d1", "{}"), 200).unwrap();
        assert!(new1 && !new2);
        assert_eq!(id2, "s1", "沿用原来那一行，不新建");

        let rows = AiMetricSnapshotRepo::list(&db, "project-scan", "a1", 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].first_at, 100, "起点必须保持在它真正开始的时刻");
        assert_eq!(rows[0].last_at, 200, "但要记下「到这一刻仍然如此」");
        assert_eq!(rows[0].seen_count, 2);
    }

    #[test]
    fn a_regression_back_to_an_earlier_shape_is_a_new_point_not_a_merge() {
        // A→B→A：改坏了又改回来。若按「历史里出现过就合并」，这一段会被并回
        // 最早那条 A，时间轴于是宣称「B 之后什么都没发生」——
        // 而这恰恰是最该被看见的一次反复。
        let db = mem_db();
        AiMetricSnapshotRepo::record(&db, &snap_row("s1", "dA", "{}"), 100).unwrap();
        AiMetricSnapshotRepo::record(&db, &snap_row("s2", "dB", "{}"), 200).unwrap();
        let (_, new3) =
            AiMetricSnapshotRepo::record(&db, &snap_row("s3", "dA", "{}"), 300).unwrap();

        assert!(new3, "回到旧形态也是一次真实变化");
        let rows = AiMetricSnapshotRepo::list(&db, "project-scan", "a1", 10).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].first_at, 300, "最新点排在最前");
    }

    #[test]
    fn snapshots_are_scoped_per_module_and_scope() {
        let db = mem_db();
        AiMetricSnapshotRepo::record(&db, &snap_row("s1", "dA", "{}"), 100).unwrap();
        let mut other = snap_row("s2", "dA", "{}");
        other.scope_id = "a2".into();
        // 同指纹但不同作用域：绝不能被当成「没变化」而合并掉
        let (_, new2) = AiMetricSnapshotRepo::record(&db, &other, 110).unwrap();
        assert!(new2);
        assert_eq!(
            AiMetricSnapshotRepo::list(&db, "project-scan", "a1", 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            AiMetricSnapshotRepo::list(&db, "project-scan", "a2", 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn coverage_travels_with_the_snapshot() {
        // 没有它趋势就是骗人的：上次跑了 Git、这次没跑，churn 归零不是「变好了」。
        let db = mem_db();
        let mut row = snap_row("s1", "dA", r#"[{"key":"churn","value":12}]"#);
        row.coverage_json = r#"[{"key":"git","status":"ok"}]"#.into();
        AiMetricSnapshotRepo::record(&db, &row, 100).unwrap();
        let got = AiMetricSnapshotRepo::list(&db, "project-scan", "a1", 10).unwrap();
        assert!(got[0].coverage_json.contains("\"git\""));
        assert!(got[0].metrics_json.contains("churn"));
    }

    #[test]
    fn oldest_points_roll_off_once_the_window_is_full() {
        let db = mem_db();
        let keep = 200usize;
        for i in 0..(keep + 5) {
            let id = format!("s{}", i);
            let digest = format!("d{}", i);
            AiMetricSnapshotRepo::record(&db, &snap_row(&id, &digest, "{}"), 1000 + i as i64)
                .unwrap();
        }
        let rows = AiMetricSnapshotRepo::list(&db, "project-scan", "a1", 1000).unwrap();
        assert_eq!(rows.len(), keep, "窗口满了之后行数不再增长");
        assert_eq!(rows[0].digest, format!("d{}", keep + 4), "留下的是最近的");
        assert!(rows.iter().all(|r| r.digest != "d0"), "最老的被滚掉");
    }

    #[test]
    fn reap_is_scoped_to_one_module_and_scope() {
        // 心跳按当前作用域走。跨作用域清算别的项目，等于在用户没打开它的时候
        // 悄悄改它的台账；那些轨迹会在对应作用域激活时被自己那一拍处理掉。
        let db = mem_db();
        let mut foreign = run_row("architecture-health", "triggered", "d1", 100);
        foreign.outcome = "pending".into();
        foreign.scope_id = "a2".into();
        record_at(&db, &foreign);

        let n =
            AiAutoAnalysisRunRepo::reap_stale_pending(&db, "project-scan", "a1", 1800, 100 + 1801)
                .unwrap();
        assert_eq!(n, 0);
        let runs = AiAutoAnalysisRunRepo::list_recent(&db, 10).unwrap();
        assert_eq!(runs[0].outcome, "pending", "别的作用域不该被顺手改掉");
    }

    // ── 实体快照：哪个文件在变坏 ──

    fn ent_row(id: &str, digest: &str, entities: &str) -> AiEntitySnapshotRow {
        AiEntitySnapshotRow {
            id: id.into(),
            module_id: "project-scan".into(),
            scope_id: "a1".into(),
            digest: digest.into(),
            trigger_kind: "full-scan".into(),
            entity_label: "文件".into(),
            entities_json: entities.into(),
            coverage_json: "[]".into(),
            dimensions_json: "[]".into(),
            survived_json: "[]".into(),
            total: 0,
            cutoff: 0.0,
            first_at: 0,
            last_at: 0,
            seen_count: 1,
        }
    }

    #[test]
    fn unchanged_board_extends_the_same_point() {
        let db = mem_db();
        let (_, new1) = AiEntitySnapshotRepo::record(&db, &ent_row("e1", "d1", "[]"), 100).unwrap();
        let (id2, new2) =
            AiEntitySnapshotRepo::record(&db, &ent_row("e2", "d1", "[]"), 200).unwrap();
        assert!(new1 && !new2);
        assert_eq!(id2, "e1");
        let rows = AiEntitySnapshotRepo::list(&db, "project-scan", "a1", 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].first_at, 100);
        assert_eq!(rows[0].last_at, 200);
        assert_eq!(rows[0].seen_count, 2);
    }

    #[test]
    fn truncation_boundary_survives_the_round_trip() {
        // total / cutoff / survived 三个字段是「跌出榜单到底是修好了还是被挤下去了」
        // 的唯一判据。它们要是在存取途中丢了，回归引擎只能一律判不可比，这张表就白建了。
        let db = mem_db();
        let mut row = ent_row("e1", "dA", r#"[{"id":"src/a.ts","score":80}]"#);
        row.total = 137;
        row.cutoff = 42.5;
        row.survived_json = r#"["src/a.ts","src/b.ts"]"#.into();
        row.dimensions_json = r#"[{"key":"complexity","label":"复杂度"}]"#.into();
        row.coverage_json = r#"[{"key":"git","available":false}]"#.into();
        AiEntitySnapshotRepo::record(&db, &row, 100).unwrap();

        let got = &AiEntitySnapshotRepo::list(&db, "project-scan", "a1", 10).unwrap()[0];
        assert_eq!(got.total, 137);
        assert!((got.cutoff - 42.5).abs() < 1e-9);
        assert!(got.survived_json.contains("src/b.ts"));
        assert!(got.dimensions_json.contains("复杂度"));
        assert!(got.coverage_json.contains("git"));
        assert_eq!(got.entity_label, "文件");
    }

    #[test]
    fn board_regression_back_to_an_earlier_shape_is_a_new_point() {
        let db = mem_db();
        AiEntitySnapshotRepo::record(&db, &ent_row("e1", "dA", "[]"), 100).unwrap();
        AiEntitySnapshotRepo::record(&db, &ent_row("e2", "dB", "[]"), 200).unwrap();
        let (_, new3) = AiEntitySnapshotRepo::record(&db, &ent_row("e3", "dA", "[]"), 300).unwrap();
        assert!(new3, "改坏了又改回来是两次真实变化，不是没变化");
        assert_eq!(
            AiEntitySnapshotRepo::list(&db, "project-scan", "a1", 10)
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn entity_boards_roll_off_at_a_tighter_window() {
        // 每行是一整张榜单，比指标行大一到两个量级；保留窗口也相应更小。
        let db = mem_db();
        let keep = 60usize;
        for i in 0..(keep + 3) {
            AiEntitySnapshotRepo::record(
                &db,
                &ent_row(&format!("e{}", i), &format!("d{}", i), "[]"),
                1000 + i as i64,
            )
            .unwrap();
        }
        let rows = AiEntitySnapshotRepo::list(&db, "project-scan", "a1", 1000).unwrap();
        assert_eq!(rows.len(), keep);
        assert_eq!(rows[0].digest, format!("d{}", keep + 2));
    }
}
