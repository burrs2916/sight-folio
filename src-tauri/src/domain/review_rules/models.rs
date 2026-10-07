use serde::{Deserialize, Serialize};

/// 审查规则定义
///
/// rule_type:
///   - pattern: 简单正则/glob 模式匹配
///   - metric:  基于指标阈值（行数/复杂度等）
///   - graph:   基于图算法（循环依赖/死代码）
///   - ai:      AI 推理（最重，预留）
///   - ast:     基于 AST 分析（预留）
///
/// target_type: file / module / dep / layer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRule {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub rule_type: String,
    pub target_type: String,
    pub rule_body: String,
    pub severity: String,
    pub enabled: bool,
    pub scope: String,
    pub builtin: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for ReviewRule {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: format!("rule_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            name: String::new(),
            description: None,
            rule_type: "pattern".to_string(),
            target_type: "file".to_string(),
            rule_body: "{}".to_string(),
            severity: "warning".to_string(),
            enabled: true,
            scope: "all".to_string(),
            builtin: false,
            created_at: now,
            updated_at: now,
        }
    }
}
