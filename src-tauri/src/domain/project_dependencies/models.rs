use serde::{Deserialize, Serialize};

/// 依赖关系
///
/// from_id/to_id 既可以是 file_id 也可以是 module_id，由 from_type/to_type 区分。
/// kind 表示依赖类型：import / require / call / reference。
/// is_circular 由后端 scan 阶段或 review 阶段标出。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDependency {
    pub id: String,
    pub analysis_id: String,
    pub from_id: String,
    pub from_type: String,
    pub to_id: String,
    pub to_type: String,
    pub kind: String,
    pub line_no: Option<i64>,
    pub is_circular: bool,
    pub weight: i64,
    pub metadata: String,
    pub detected_at: i64,
}

impl Default for ProjectDependency {
    fn default() -> Self {
        Self {
            id: format!(
                "dep_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            from_id: String::new(),
            from_type: "file".to_string(),
            to_id: String::new(),
            to_type: "file".to_string(),
            kind: "import".to_string(),
            line_no: None,
            is_circular: false,
            weight: 1,
            metadata: "{}".to_string(),
            detected_at: chrono::Utc::now().timestamp(),
        }
    }
}