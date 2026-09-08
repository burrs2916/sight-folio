use serde::{Deserialize, Serialize};

/// 函数调用边：谁在第几行调用了哪个函数
///
/// 对应需求「代码之间的引用」的过程间维度。文件级依赖回答 "A 引用了 B"，
/// 符号级引用回答 "A 第 12 行 import 了 B 的 Foo"，调用边回答的是
/// **"A 的 handleScan 调用了 B 的 detectDependencies"** —— 这是变更影响
/// 分析（Impact Analysis）的数据基础：
/// - 反向查 callee → 得到「改这个函数会影响谁」
/// - 正向查 caller → 得到「这个函数依赖哪些下游」
///
/// kind：internal（同文件内调用）| cross-file（跨文件，经 import 符号解析）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallEdge {
    pub id: String,
    pub analysis_id: String,
    /// 调用方符号（project_symbols.id）
    pub caller_symbol_id: String,
    pub caller_name: String,
    pub caller_file_id: String,
    pub caller_file_path: String,
    /// 被调方符号（project_symbols.id；仅按名匹配未定位到唯一定义时为空串）
    pub callee_symbol_id: String,
    pub callee_name: String,
    pub callee_file_id: String,
    pub callee_file_path: String,
    /// 调用点行号（1-based）
    pub line_no: i64,
    /// internal | cross-file
    pub kind: String,
    /// 被调方接收者根标识符（如 `obj.method()` → "obj"；裸调用为空串）。
    /// 用于区分同名 sink（如 `RegExp.exec` vs `child_process.exec`），根治 taint 假阳性。
    pub callee_receiver: String,
    /// 被调方解析到的「接收者声明类型名」（如 `ClassA.foo()` → "ClassA"；裸函数/未锁定为空串）。
    /// 对标 joern `CALL.methodFullName` 的声明接收者类型：joern 在动态分派下会把单个
    /// `this.foo()` 解析为全部候选方法（超近似、丢失接收者类型），这里在可唯一锁定时给出精确类型名，
    /// 供影响面画像按接收者类型区分同名方法（renderable≠useful 式补全：数据已算却无画像消费）。
    pub receiver_target: String,
    pub created_at: i64,
}

impl Default for CallEdge {
    fn default() -> Self {
        Self {
            id: format!("call_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
            analysis_id: String::new(),
            caller_symbol_id: String::new(),
            caller_name: String::new(),
            caller_file_id: String::new(),
            caller_file_path: String::new(),
            callee_symbol_id: String::new(),
            callee_name: String::new(),
            callee_file_id: String::new(),
            callee_file_path: String::new(),
            line_no: 0,
            kind: "internal".to_string(),
            callee_receiver: String::new(),
            receiver_target: String::new(),
            created_at: chrono::Utc::now().timestamp(),
        }
    }
}

/// 调用图摘要（analyze_call_graph 返回值）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallGraphSummary {
    /// 调用边总数
    pub total_edges: i64,
    /// 跨文件调用边数
    pub cross_file_edges: i64,
    /// 参与调用图的函数数
    pub functions: i64,
    /// 出度最高的函数（调用别人最多，往往是编排层）
    pub top_callers: Vec<CallHotspot>,
    /// 入度最高的函数（被调用最多，往往是基础设施）
    pub top_callees: Vec<CallHotspot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallHotspot {
    pub symbol_id: String,
    pub name: String,
    pub file_path: String,
    pub count: i64,
}
