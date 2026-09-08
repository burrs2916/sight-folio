use serde::{Deserialize, Serialize};

/// 架构分层（表现层/业务层/数据层 等）
///
/// sort_order 控制画布上的垂直顺序（0=顶层）。rule_pattern 是可选的 glob，
/// 用于扫描阶段自动把匹配的文件归入该层（例如 src/components/** → 表现层）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLayer {
    pub id: String,
    pub analysis_id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub y_position: f64,
    pub description: Option<String>,
    pub rule_pattern: Option<String>,
    pub metadata: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for ProjectLayer {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: format!(
                "layer_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            name: "未命名层".to_string(),
            color: "#94A3B8".to_string(),
            sort_order: 0,
            y_position: 0.0,
            description: None,
            rule_pattern: None,
            metadata: "{}".to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}