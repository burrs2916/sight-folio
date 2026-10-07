use serde::{Deserialize, Serialize};

/// Git 变更热点（churn）：单个文件在版本历史中的变动强度
///
/// 对应需求「演进分析：静态快照 → 时间维度」。静态扫描只能回答
/// "代码现在长什么样"，churn 回答的是 "哪里在快速变坏"：
/// - commit_count 高 = 每次迭代都要动它（架构耦合点或职责过载）
/// - added/deleted 高 = 大规模重写，稳定性存疑
/// - author_count 高 = 多人协作热点，冲突与理解成本高
///
/// churn_score = commit_count * 3 + (added + deleted) / 50 + author_count * 2
/// 该分值仅用于排序与热力分级，不代表绝对质量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChurn {
    pub id: String,
    pub analysis_id: String,
    /// 关联 project_files.id（未匹配到已扫描文件时为空串）
    pub file_id: String,
    /// 仓库内相对路径（git log 输出的路径）
    pub file_path: String,
    /// 提交次数
    pub commit_count: i64,
    pub added_lines: i64,
    pub deleted_lines: i64,
    /// 参与修改的作者数
    pub author_count: i64,
    /// 最近一次提交时间（unix 秒）
    pub last_commit_at: i64,
    /// 最早一次提交时间（unix 秒）
    pub first_commit_at: i64,
    /// 变更热度分值（用于排序）
    pub churn_score: i64,
    /// 热度等级：low | medium | high | extreme
    pub hotspot_level: String,
    pub created_at: i64,
}

/// 按分值划分热度等级（与复杂度等级同一套配色语义）
pub fn hotspot_level_of(score: i64) -> &'static str {
    if score <= 10 {
        "low"
    } else if score <= 30 {
        "medium"
    } else if score <= 80 {
        "high"
    } else {
        "extreme"
    }
}

/// 变更热点分值：提交频次为主，改动量与作者数为辅
pub fn churn_score_of(commit_count: i64, added: i64, deleted: i64, authors: i64) -> i64 {
    commit_count * 3 + (added + deleted) / 50 + authors * 2
}

impl Default for GitChurn {
    fn default() -> Self {
        Self {
            id: format!(
                "churn_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            commit_count: 0,
            added_lines: 0,
            deleted_lines: 0,
            author_count: 0,
            last_commit_at: 0,
            first_commit_at: 0,
            churn_score: 0,
            hotspot_level: "low".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}
