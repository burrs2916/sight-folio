use serde::{Deserialize, Serialize};

/// 符号级引用索引：谁在哪个文件哪一行引用了哪个符号
///
/// 对应需求「代码之间的引用」：文件级依赖（project_dependencies）只回答
/// "A 文件 import 了 B 文件"，而符号级引用回答 "A 文件第 12 行 import 了
/// B 文件的 Foo 类"。前端据此实现：
/// - 左侧实体面板：符号行显示被引用计数，点击展开引用点列表并定位
/// - 画布画像：被引用数越高的符号/文件越是架构核心（hub）
///
/// from_file → 引用方文件；to_symbol → 被引用符号（project_symbols.id）。
/// 当 import 未匹配到目标符号时 to_symbol_id 为 None（退化为文件级引用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRef {
    pub id: String,
    pub analysis_id: String,
    /// 引用方文件（project_files.id）
    pub from_file_id: String,
    pub from_file_path: String,
    /// 被引用符号（project_symbols.id，未命中为 None = 文件级引用）
    pub to_symbol_id: Option<String>,
    /// 被引用方文件（project_files.id）
    pub to_file_id: String,
    pub to_file_path: String,
    /// 被引用的符号名（import { Foo } 中的 Foo）
    pub symbol_name: String,
    /// 引用行号（1-based）
    pub ref_line: i64,
    /// 引用行原文（截断展示）
    pub ref_text: String,
    /// 引用类型：import | call | reference
    pub kind: String,
    pub created_at: i64,
}

impl Default for SymbolRef {
    fn default() -> Self {
        Self {
            id: format!("ref_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            analysis_id: String::new(),
            from_file_id: String::new(),
            from_file_path: String::new(),
            to_symbol_id: None,
            to_file_id: String::new(),
            to_file_path: String::new(),
            symbol_name: String::new(),
            ref_line: 0,
            ref_text: String::new(),
            kind: "import".to_string(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}
