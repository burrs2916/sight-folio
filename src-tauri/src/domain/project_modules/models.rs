use serde::{Deserialize, Serialize};

/// 语义模块：聚合相关文件，附依赖统计和画布坐标
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectModule {
    pub id: String,
    pub analysis_id: String,
    pub name: String,
    pub description: Option<String>,
    pub layer_id: Option<String>,
    pub file_count: i64,
    pub dep_count: i64,
    pub be_dep_count: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
    pub metadata: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for ProjectModule {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: format!(
                "module_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            name: String::new(),
            description: None,
            layer_id: None,
            file_count: 0,
            dep_count: 0,
            be_dep_count: 0,
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 80.0,
            color: "#4F46E5".to_string(),
            metadata: "{}".to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}
