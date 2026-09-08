use serde::{Deserialize, Serialize};

/// 异步扫描任务状态追踪
///
/// status: pending / running / done / failed / cancelled
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanJob {
    pub id: String,
    pub analysis_id: String,
    pub status: String,
    pub progress: i64,
    pub files_scanned: i64,
    pub total_files: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    pub config: String,
    pub created_at: i64,
}

impl Default for ScanJob {
    fn default() -> Self {
        Self {
            id: format!(
                "job_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            status: "pending".to_string(),
            progress: 0,
            files_scanned: 0,
            total_files: 0,
            started_at: None,
            finished_at: None,
            error: None,
            config: "{}".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}