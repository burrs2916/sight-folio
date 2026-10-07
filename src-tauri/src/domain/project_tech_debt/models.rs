use serde::{Deserialize, Serialize};

/// 技术债标记项（scan_tech_debt 产出）
///
/// 对应需求文档「新需求点发掘」：扫描源码中的 TODO / FIXME / HACK / XXX /
/// OPTIMIZE / DEPRECATED 等标记，定位到文件 + 行号 + 原文片段，形成
/// "技术债画像" —— 前端据此：
/// - 左侧实体面板「技术债」分组（按标记类型聚合，点击定位文件）
/// - 文件树 / 画布文件实体的技术债徽标
/// - 技术债画像（画布按技术债密度布局着色）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TechDebtItem {
    pub id: String,
    pub analysis_id: String,
    /// 所属文件（project_files.id）
    pub file_id: String,
    /// 所属文件相对路径（冗余，便于展示与画布匹配）
    pub file_path: String,
    /// 标记所在行号（1 起始）
    pub line_no: i64,
    /// 标记类型：TODO | FIXME | HACK | XXX | OPTIMIZE | DEPRECATED
    pub marker: String,
    /// 严重度：info（TODO/XXX）| warning（OPTIMIZE/DEPRECATED）| critical（FIXME/HACK）
    pub severity: String,
    /// 该行原文（截断）
    pub snippet: String,
    pub created_at: i64,
}

impl Default for TechDebtItem {
    fn default() -> Self {
        Self {
            id: format!("debt_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            analysis_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            line_no: 0,
            marker: "TODO".to_string(),
            severity: "info".to_string(),
            snippet: String::new(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 标记 → 严重度映射
pub fn severity_of(marker: &str) -> &'static str {
    match marker {
        "FIXME" | "HACK" => "critical",
        "OPTIMIZE" | "DEPRECATED" => "warning",
        _ => "info",
    }
}
