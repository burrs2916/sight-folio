use serde::{Deserialize, Serialize};

/// 函数级数据流事实（def-use 摘要落库形态）
///
/// 与调用边（`project_call_edges`）的关系：调用边说「A 调了 B」，
/// 数据流事实说「**B 会不会把收到的数据再传出去**」。两者相乘才是
/// 真正的过程间影响传播——只有透传函数才让污染继续向上游扩散。
///
/// 数组类字段以紧凑文本存储（逗号分隔 / JSON），避免为一次分析多建三张表：
/// 这些字段只在前端做集合判定与展示，不参与 SQL 关联查询。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowFact {
    pub id: String,
    pub analysis_id: String,
    pub file_id: String,
    pub file_path: String,
    /// 函数名（与 project_symbols.name 同口径，供前端按 `fileId::name` 关联）
    pub function_name: String,
    /// 函数起始行（1-based）
    pub line_no: i64,
    /// 形参列表，逗号分隔
    pub params: String,
    /// 流向返回值的形参，逗号分隔
    pub param_to_return: String,
    /// 是否透传（输入变化会传导到输出）
    pub propagates: bool,
    /// 返回值是否来自另一个调用的结果
    pub returns_call_result: bool,
    /// 形参 → 下游实参，JSON 数组
    pub call_flows: String,
    /// 写入的外部状态，JSON 数组
    pub sinks: String,
    pub created_at: i64,
}

/// 数据流分析摘要（analyze_data_flow 返回值）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowSummary {
    /// 成功产出摘要的文件数（不支持 AST 的语言不计）
    pub analyzed_files: i64,
    /// 函数摘要总数
    pub functions: i64,
    /// 透传函数数（污染放行）
    pub propagating: i64,
    /// 阻断函数数（污染终止 —— 影响链剪枝的依据）
    pub blocking: i64,
    /// 含副作用汇点的函数数
    pub sink_functions: i64,
    /// 形参 → 下游实参的流边总数
    pub param_flows: i64,
    /// 副作用最重的函数（写外部状态最多）
    pub top_sinks: Vec<DataFlowHotspot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFlowHotspot {
    pub function_name: String,
    pub file_path: String,
    pub line_no: i64,
    pub count: i64,
    /// 摘要文本（前几个汇点名）
    pub detail: String,
}
