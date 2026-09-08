use serde::{Deserialize, Serialize};

/// 项目扫描得到的单个文件节点
///
/// 路径用绝对路径 + 相对路径双存：绝对路径用于文件系统定位，相对路径用于画布显示。
/// 父级 ID 用 parent_id 实现树形结构（不用嵌套 JSON，方便 SQLite 查询和画布拖拽）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub id: String,
    pub analysis_id: String,
    pub path: String,
    pub rel_path: String,
    pub name: String,
    pub extension: Option<String>,
    pub language: Option<String>,
    pub size: i64,
    pub line_count: i64,
    pub content_hash: Option<String>,
    pub parent_id: Option<String>,
    pub is_directory: bool,
    pub layer_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub metadata: String,
    pub scanned_at: i64,
}

impl Default for ProjectFile {
    fn default() -> Self {
        Self {
            id: format!(
                "file_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            path: String::new(),
            rel_path: String::new(),
            name: String::new(),
            extension: None,
            language: None,
            size: 0,
            line_count: 0,
            content_hash: None,
            parent_id: None,
            is_directory: false,
            layer_id: None,
            x: 0.0,
            y: 0.0,
            width: 160.0,
            height: 48.0,
            metadata: "{}".to_string(),
            scanned_at: chrono::Utc::now().timestamp(),
        }
    }
}