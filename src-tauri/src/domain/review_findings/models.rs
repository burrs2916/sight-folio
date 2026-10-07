use serde::{Deserialize, Serialize};

/// 审查结果（一条 finding）
///
/// status: open / fixed / ignored / wontfix
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFinding {
    pub id: String,
    pub analysis_id: String,
    pub rule_id: Option<String>,
    pub target_id: String,
    pub target_type: String,
    pub severity: String,
    pub message: String,
    pub suggestion: Option<String>,
    pub status: String,
    pub found_at: i64,
    pub fixed_at: Option<i64>,
    pub metadata: String,
}

impl Default for ReviewFinding {
    fn default() -> Self {
        Self {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            rule_id: None,
            target_id: String::new(),
            target_type: "file".to_string(),
            severity: "warning".to_string(),
            message: String::new(),
            suggestion: None,
            status: "open".to_string(),
            found_at: chrono::Utc::now().timestamp(),
            fixed_at: None,
            metadata: "{}".to_string(),
        }
    }
}
