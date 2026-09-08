use serde::{Deserialize, Serialize};

/// 文件级度量指标（analyze_file_metrics 产出）
///
/// 对应需求文档「复杂度热力图」视角与「扫描项目需要分析哪些功能」中的复杂度维度。
/// 每个源码文件计算：总行数 / 代码行数 / 注释行数 / 空行数 / 圈复杂度（控制流关键字近似）。
/// 前端据此：
/// - 画布文件实体按复杂度等级热力着色（复杂度热力图视图）
/// - 左侧文件树/统计条展示复杂度
/// - 报告导出包含复杂度分布
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetric {
    pub id: String,
    pub analysis_id: String,
    /// 所属文件（project_files.id）
    pub file_id: String,
    /// 所属文件相对路径（冗余，便于展示与画布匹配）
    pub file_path: String,
    /// 总行数（含空行与注释）
    pub total_lines: i64,
    /// 代码行数（非空、非注释）
    pub code_lines: i64,
    /// 注释行数（含块注释内的行）
    pub comment_lines: i64,
    /// 空行数
    pub blank_lines: i64,
    /// 圈复杂度（AST 精确计数；不支持的语言退化为控制流关键字近似）
    pub cyclomatic_complexity: i64,
    /// 复杂度等级：low | medium | high | extreme（供前端热力着色）
    pub complexity_level: String,
    /// 度量引擎：`ast`（tree-sitter 精确）| `heuristic`（行级关键字估算）
    ///
    /// 同一份热力图上混着两种精度的数据是会误导人的，所以精度必须随数据一起带到前端，
    /// 由 UI 明确标注「AST 精确 / 估算」。
    pub engine: String,
    /// 全文件最大控制流嵌套深度（AST 独有；heuristic 时为 0）
    pub max_nesting: i64,
    /// 函数/方法数量（AST 独有）
    pub function_count: i64,
    /// 单函数最高圈复杂度（AST 独有）——文件总 CC 高可能只是文件长，
    /// 单函数 CC 高才是真正难维护的地方
    pub max_function_cc: i64,
    /// 最复杂函数名（AST 独有，供前端直接展示热点）
    pub hot_function: String,
    /// 阈值型魔法数字个数（AST 独有）
    pub magic_number_count: i64,
    /// JSON：`{language, engine, hasError, functions:[...], magicNumbers:[...]}`
    pub metadata: String,
    pub created_at: i64,
}

impl Default for FileMetric {
    fn default() -> Self {
        Self {
            id: format!(
                "mtr_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            total_lines: 0,
            code_lines: 0,
            comment_lines: 0,
            blank_lines: 0,
            cyclomatic_complexity: 1,
            complexity_level: "low".to_string(),
            engine: "heuristic".to_string(),
            max_nesting: 0,
            function_count: 0,
            max_function_cc: 0,
            hot_function: String::new(),
            magic_number_count: 0,
            metadata: "{}".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 复杂度等级映射（前端热力图统一使用）
pub fn complexity_level_of(cc: i64) -> &'static str {
    match cc {
        0..=5 => "low",
        6..=10 => "medium",
        11..=20 => "high",
        _ => "extreme",
    }
}
