use serde::{Deserialize, Serialize};

/// 代码结构索引：从源码中提取的符号（类/函数/接口/结构体/枚举/特征等）
///
/// 符号是「代码结构分析」的最小单元，前端可据此展示：
/// - 左侧实体面板的符号实例（class/function/interface 等实体类型）
/// - 代码引用跳转（点击符号 → 定位到源文件）
/// - 设计模式检测结果（patterns 字段）
///
/// 通过 file_id 关联 project_files，通过 line_start/line_end 关联具体代码行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSymbol {
    pub id: String,
    pub analysis_id: String,
    /// 所属文件（project_files.id）
    pub file_id: String,
    /// 所属文件相对路径（冗余，便于展示与画布匹配）
    pub file_path: String,
    pub name: String,
    /// 符号类型：class | function | interface | struct | enum | trait | const | type_alias | method
    pub kind: String,
    pub line_start: i64,
    pub line_end: i64,
    /// 签名（如 `export default function App()`）
    pub signature: String,
    pub doc: Option<String>,
    /// 修饰符（export/pub/private/async/abstract 等）
    pub modifiers: String,
    /// 检测到的设计模式 JSON 数组（如 ["singleton","factory"]）
    pub patterns: String,
    pub metadata: String,
    pub created_at: i64,
}

impl Default for ProjectSymbol {
    fn default() -> Self {
        Self {
            id: format!(
                "sym_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: String::new(),
            file_id: String::new(),
            file_path: String::new(),
            name: String::new(),
            kind: String::new(),
            line_start: 0,
            line_end: 0,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: "[]".to_string(),
            metadata: "{}".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 设计模式命中结果（analyze_code_structure 返回值的一部分）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternHit {
    /// 模式 id（singleton / factory / observer / strategy / repository / service）
    pub pattern: String,
    pub name: String,
    /// 命中的符号名（类名/接口名）
    pub symbol_name: String,
    /// 所属文件相对路径
    pub file_path: String,
    pub line: i64,
    /// 命中依据（人类可读）
    pub evidence: String,
    /// 置信度 0..1
    ///
    /// 旧引擎是布尔命中，把「猜测」当「事实」输出。新引擎按证据加权打分，
    /// 把分数一路带到前端，让用户能自己区分「类名叫 XxxFactory」和「真的按分支造了多种类型」。
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    /// 命中的证据清单（前端悬浮展示判定依据）
    #[serde(default)]
    pub signals: Vec<String>,
    /// 模式分类：creational / structural / behavioral / architectural
    #[serde(default)]
    pub category: String,
}

fn default_confidence() -> f64 {
    0.5
}

/// 结构分析摘要（analyze_code_structure 返回值）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSummary {
    /// 提取到的符号总数
    pub total_symbols: i64,
    /// 含符号的文件数
    pub files_with_symbols: i64,
    /// 按类型统计 {class: 12, function: 87, ...}
    pub by_kind: std::collections::HashMap<String, i64>,
    /// 设计模式命中列表
    pub patterns: Vec<PatternHit>,
}
