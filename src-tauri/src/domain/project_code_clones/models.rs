use serde::{Deserialize, Serialize};

/// 代码克隆片段（detect_code_clones 产出）
///
/// 对应需求文档「新需求点发掘」：代码重复率是 SonarQube / PMD-CPD 等前沿
/// 静态分析平台的一级质量指标，此前 sight-folio 完全缺失该维度。
///
/// 一个「克隆组」（group_id 相同）代表一段在项目中出现了 N 次的重复代码，
/// 每条记录是该组的一个「实例」（出现位置）。前端据此：
/// - 左侧实体面板「重复代码」分组（按克隆组聚合，点击定位到具体文件行）
/// - 文件树 / 画布文件实体的重复徽标（重复行数 / 重复率）
/// - 重复代码画像（画布按重复行数密度布局着色，同组实例间连线）
/// - 报告导出的「重复代码」分区
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeClone {
    pub id: String,
    pub analysis_id: String,
    /// 克隆组标识：同一段重复代码的所有实例共享同一个 group_id
    pub group_id: String,
    /// 所属文件（project_files.id）
    pub file_id: String,
    /// 所属文件相对路径（冗余，便于展示与画布匹配）
    pub file_path: String,
    /// 克隆片段起始行号（1 起始，含）
    pub start_line: i64,
    /// 克隆片段结束行号（1 起始，含）
    pub end_line: i64,
    /// 克隆片段有效行数（归一化后参与比对的行数）
    pub line_count: i64,
    /// 该组共有多少个实例（冗余，避免前端二次聚合才能排序）
    pub group_size: i64,
    /// 片段首行原文（截断，用于列表预览）
    pub snippet: String,
    /// 语言（取自 project_files.language）
    pub language: String,
    /// 克隆类型：type1 = 逐字重复（仅注释/空白归一化）；
    /// type2 = 参数化克隆（标识符重命名后结构仍相同，如变量改名后的复制粘贴）
    pub clone_type: String,
    pub created_at: i64,
}

impl Default for CodeClone {
    fn default() -> Self {
        Self {
            id: format!(
                "clone_{}",
                uuid::Uuid::new_v4().to_string().replace('-', "")
            ),
            analysis_id: String::new(),
            group_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            start_line: 0,
            end_line: 0,
            line_count: 0,
            group_size: 0,
            snippet: String::new(),
            language: String::new(),
            clone_type: "type1".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 克隆规模 → 严重度判据基线（仅测试使用，故 cfg(test) 门控）
///
/// 判据同时看「重复长度」和「重复次数」：一段 60 行的两处复制，和一段
/// 8 行的十处复制，都是需要重构的信号。
#[cfg(test)]
pub fn clone_severity(line_count: i64, group_size: i64) -> &'static str {
    if line_count >= 60 || group_size >= 6 {
        "critical"
    } else if line_count >= 25 || group_size >= 3 {
        "warning"
    } else {
        "info"
    }
}
