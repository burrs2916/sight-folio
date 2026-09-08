use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisStatus {
    Draft,
    Published,
    Archived,
}

impl Default for AnalysisStatus {
    fn default() -> Self {
        Self::Draft
    }
}

impl From<String> for AnalysisStatus {
    fn from(s: String) -> Self {
        match s.to_lowercase().as_str() {
            "published" => Self::Published,
            "archived" => Self::Archived,
            _ => Self::Draft,
        }
    }
}

impl From<AnalysisStatus> for String {
    fn from(s: AnalysisStatus) -> Self {
        match s {
            AnalysisStatus::Draft => "draft".to_string(),
            AnalysisStatus::Published => "published".to_string(),
            AnalysisStatus::Archived => "archived".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCategory {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: i32,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for AnalysisCategory {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: format!("cat_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            name: String::new(),
            icon: None,
            color: None,
            sort_order: 0,
            parent_id: None,
            description: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub id: String,
    pub name: String,
    pub description: Option<String>,

    /// 项目扫描根路径（用户选定要分析的项目目录）
    pub project_root: String,

    pub editor_components: Option<String>,
    pub editor_layers: Option<String>,
    pub canvas_config: Option<String>,

    pub global_components: Option<String>,
    pub views: Option<String>,
    pub active_view_id: Option<String>,
    pub viewport_sync_rules: Option<String>,

    pub category_id: Option<String>,
    pub tags: String,

    pub status: AnalysisStatus,

    pub metadata: String,

    /// 扫描状态：pending / scanning / ready / failed
    pub scan_status: String,
    /// 扫描进度 0-100
    pub scan_progress: i64,
    /// 上次扫描完成时间
    pub last_scanned_at: Option<i64>,

    /// 缓存的文件总数（避免每次查询都 COUNT）
    pub total_files: i64,
    /// 缓存的代码总行数
    pub total_lines: i64,
    /// 主要编程语言
    pub primary_language: Option<String>,

    pub created_at: i64,
    pub updated_at: i64,
}

impl Default for Analysis {
    fn default() -> Self {
        let now = chrono::Utc::now().timestamp();
        Self {
            id: format!(
                "analysis_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            name: String::new(),
            description: None,
            project_root: String::new(),
            editor_components: None,
            editor_layers: None,
            canvas_config: None,
            global_components: None,
            views: None,
            active_view_id: None,
            viewport_sync_rules: None,
            category_id: None,
            tags: "[]".to_string(),
            status: AnalysisStatus::Draft,
            metadata: "{}".to_string(),
            scan_status: "pending".to_string(),
            scan_progress: 0,
            last_scanned_at: None,
            total_files: 0,
            total_lines: 0,
            primary_language: None,
            created_at: now,
            updated_at: now,
        }
    }
}
