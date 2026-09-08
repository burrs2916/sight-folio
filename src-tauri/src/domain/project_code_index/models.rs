use serde::{Deserialize, Serialize};

/// 代码全文索引条目（index_code_content 产出）
///
/// 对应需求文档「索引」：把每个源码文件的**代码行**（非空、非纯注释）按行写入
/// 索引表，支持按内容片段全文检索（search_code_content）。前端据此：
/// - 全局搜索接入"代码内容"结果，点击跳转到文件 + 行号
/// - 报告导出可包含"代码检索"维度
///
/// 说明：SQLite LIKE 检索在桌面端单分析（数千文件 × 数十万行）规模下
/// 性能足够；按 analysis_id 分片存储，避免跨分析污染。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeIndexEntry {
    pub id: String,
    pub analysis_id: String,
    /// 所属文件（project_files.id）
    pub file_id: String,
    /// 所属文件相对路径（冗余，便于展示与跳转）
    pub file_path: String,
    /// 行号（1 起始）
    pub line_no: i64,
    /// 该行代码原文（截断到 200 字符）
    pub content: String,
    pub created_at: i64,
}

impl Default for CodeIndexEntry {
    fn default() -> Self {
        Self {
            id: format!(
                "idx_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            line_no: 0,
            content: String::new(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 索引行最大长度（防止超长行撑爆索引）
pub const MAX_INDEX_LINE_LEN: usize = 200;
