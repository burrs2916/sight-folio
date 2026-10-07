//! 函数级 def-use 数据流摘要（过程间数据流分析的「函数摘要」层）
//!
//! ## 为什么需要它
//!
//! 项目已有的**调用图**回答的是「谁调用了谁」，影响链（R34）在其之上做多跳传播。
//! 但调用可达 ≠ 数据可达，这会显著高估爆炸半径：
//!
//! ```text
//! parse(raw) ── 调用 ──▶ logDebug(msg)
//! ```
//! 改 `parse` 的返回结构，`logDebug` 的调用方并不会因此出错 —— 因为
//! `logDebug` **不把输入传出去**（无 param→return），污染在它这里就终止了。
//! 而当前影响链会继续往它的所有上游扩散，把无关文件一起点亮。
//!
//! 学术上这叫 **IFDS/IDE 的函数摘要（function summary）**：先在过程内算出
//! 「输入 → 输出」的可达关系，再把摘要接到调用图上做过程间传播。本模块只做
//! 摘要层（过程内 def-use），传播层交给前端影响链引擎，两边都能独立单测。
//!
//! ## 提取的四类事实
//!
//! | 事实 | 含义 | 用途 |
//! |---|---|---|
//! | `param_to_return` | 形参出现在返回表达式里 | **透传函数**：污染会继续往上游流 |
//! | `returns_call_result` | 返回值来自另一个调用的结果 | 间接透传（`return build(x)`） |
//! | `param_to_call` | 形参被当作实参传给了下游（含经局部变量中转） | 污染下沉路径（谁在替我处理数据） |
//! | `sinks` | 形参被写进外部状态（成员/下标赋值） | 副作用汇点：改了会影响共享状态 |
//!
//! ## 局部变量感知（对标 joern `ReachingDefPass`）
//!
//! 早期实现**只认形参**：`note_call` 拿实参里的标识符跟形参求交，于是
//!
//! ```text
//! function handler(req) { const id = req.params.id; db.query(`... ${id}`); }
//! ```
//!
//! 一条流都产不出来 —— `db.query` 的实参里只有局部量 `id`，没有形参。而按注入
//! 漏洞的统计分布，这恰恰是最常见的一类写法，等于把污点分析的主要目标整片漏掉。
//!
//! joern 用**到达定义**（`dataflowengineoss/.../passes/reachingdef/ReachingDefProblem.scala`，
//! gen/kill 位图不动点）解决：先算出「每个程序点上哪些定义可达」，DDG 自然覆盖局部变量。
//! 我们没有 CFG，所以取它的降级子集 —— 只建**局部变量 → 来源形参集合**的映射
//! （`collect_local_decls` + `origins_in`），跑定点迭代处理链式中转，不做分支合并。
//! 展开出的流在 `CallArgFlow::via` 里保留途经的调用名，供污点求解器沿途判净化。
//!
//! ## FlowSemantic 语义表（对标 joern `DefaultSemantics.scala`）
//!
//! 每条 `CallArgFlow` 都带一个 `sem` 字段，记录整条求值链的语义结论
//! （净化 / 透传 / 无记录），见 `flow_semantics` 模块。它取代了前端原先那条
//! 200 字符的净化器正则黑名单，并修掉了 `path.normalize` 被误判成净化器
//! 导致的路径穿越漏报。
//!
//! **刻意不接 `param_to_return` / `propagates`**：joern 的语义剪边是**污点**语义
//! （污染是否传播到返回值），而 `propagates()` 消费方是 `dataFlowPortrait`
//! 的 conduit/blocker 与 `impactChain` 的透明集，那是**变更影响**语义 ——
//! `function f(p) { return md5(p); }` 的返回值在污点意义上不被 `p` 污染，
//! 但改 `p` 的结构**会**改变 `f` 的返回值。把两者混用会让影响链错误剪枝，
//! 所以语义表只作用于污点求解器，不触碰 `propagates`。
//!
//! ## 精度声明（刻意的近似）
//!
//! - 不做别名分析、不做作用域遮蔽判定：函数体内出现同名标识符即视为该形参。
//!   代价是极少数遮蔽场景高估，收益是零类型推导、毫秒级、对五种方言统一处理。
//! - 只在 AST 支持的方言上运行（TS/TSX/JS/Rust/Python），其余语言不产出摘要，
//!   前端遇到没有摘要的函数时**默认按透传处理**（保守，绝不因为分析缺失而漏报）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tree_sitter::{Node, Parser};

use super::{dialect_for, flow_semantics, looks_minified, Dialect, MAX_SOURCE_BYTES};

/// 形参流向某个下游调用的第 index 个实参
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CallArgFlow {
    /// 被调函数名（取最后一段：`repo.save` → `save`）
    pub callee: String,
    /// 实参位置（0-based）
    pub arg_index: i64,
    /// 流入的形参名
    pub param: String,
    pub line: i64,
    /// 接收者表达式根标识符（`obj.method()` → `obj`；`RegExp.exec` → `RegExp`；
    /// `self.exec` → `self`；无接收者的方法调用为空串）。P0 新增：用于区分
    /// `RegExp.exec` / `self.exec` 与 `child_process.exec` 的碰撞（taintFlow 接收者守卫）。
    pub receiver: String,
    /// 形参到达该实参**途中经过的调用名**，按求值顺序排列（内层在前）。
    ///
    /// 对标 joern `ReachingDefPass` 的到达定义：形参不再只认「直接出现在实参里」，
    /// 经由局部变量中转的流也要连上 —— `const id = req.params.id; db.query(id)`
    /// 这类最经典的注入模式，此前因为 `id` 不是形参而**一条流都产不出来**。
    ///
    /// 中间调用名必须保留，否则会把净化调用洗掉：
    /// `const v = escapeHtml(req.body); render(v)` 展开成 `req → render` 后，
    /// 若不看 `via` 里的 `escapeHtml`，就会把已净化的数据报成漏洞。
    ///
    /// 空数组 = 形参直接出现在实参里（历史行为，零回归）。旧 JSON 无此字段时
    /// 由 `#[serde(default)]` 兜底为空，因此**不需要数据库迁移**。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub via: Vec<String>,
    /// 整条求值链（`via ++ [callee]`）的 FlowSemantic 结论编码。
    ///
    /// 对标 joern `EdgeValidator`：语义表查得到且声明不流向返回值的调用阻断污染，
    /// 查不到则**不剪边**（保守放行）。编码见 `flow_semantics::ChainSem::encode`：
    ///
    /// | 取值 | 含义 | 前端行为 |
    /// |---|---|---|
    /// | `"block:<name>"` | 语义表判定 `<name>` 为净化器 | 终止为 `sanitized` |
    /// | `"pass"` | 链上有语义表收录的透传调用 | **明确不净化**（覆盖正则误伤） |
    /// | `""` / 字段缺失 | 语义表无记录 | 回退历史正则判定 |
    ///
    /// 旧数据无此字段 → `#[serde(default)]` 兜底成 `""` → 走历史分支，**零迁移、零回归**。
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sem: String,
}

/// 单个函数的数据流摘要
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionFlow {
    pub name: String,
    pub line: i64,
    pub params: Vec<String>,
    /// 直接出现在返回表达式中的形参
    pub param_to_return: Vec<String>,
    /// 返回值是否为另一个调用的结果
    pub returns_call_result: bool,
    /// 形参 → 下游实参
    pub param_to_call: Vec<CallArgFlow>,
    /// 形参被写入的外部状态（`this.cache`、`state[key]`…）
    pub sinks: Vec<String>,
}

impl FunctionFlow {
    /// 是否为「透传函数」：输入的变化会传导到输出。
    ///
    /// 这是过程间传播的**放行条件**。无形参的函数一律视为透传
    /// （它的返回值可能来自捕获的外部状态，无法证明它安全）。
    pub fn propagates(&self) -> bool {
        self.params.is_empty() || !self.param_to_return.is_empty() || self.returns_call_result
    }
    /// 是否写外部状态（副作用汇点）
    pub fn has_sink(&self) -> bool {
        !self.sinks.is_empty()
    }
}

/// 一个文件的数据流摘要
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileDataFlow {
    pub functions: Vec<FunctionFlow>,
}

/// 单文件函数摘要上限（超大文件保留前 200 个，足够覆盖真实热点）
const MAX_FUNCTIONS: usize = 200;
/// 单函数下游实参流上限（编排层函数可能有上百个调用点，截断防 IPC 膨胀）
const MAX_CALL_FLOWS: usize = 40;
/// 单函数 sink 上限
const MAX_SINKS: usize = 20;
/// 单个表达式允许的来源数量上限（一个实参里塞进半个函数的形参时截断）
const MAX_LOCAL_ORIGINS: usize = 8;
/// 单个来源允许记录的中间调用链长度（`f(g(h(x)))` → 3 层足够，再深无信息量）
const MAX_VIA_LEN: usize = 4;
/// 局部变量来源定点迭代轮数上限（链式声明 `a=f(x); b=g(a)` 通常 2 轮收敛）
const MAX_FIXPOINT_ROUNDS: usize = 4;

/// 「调用即赋值」的变异方法名。
///
/// `self.blocks.push(v)` 和 `self.blocks = v` 在数据流上是同一件事：形参逃逸到了
/// 外部状态。只看赋值语句会漏掉容器类的一整类写入 —— 真实仓库探针里
/// `BlockTable::add_block` 就是这么被误判成阻断点的。
/// 三种方言的方法名合并成一张表（按名字匹配，不区分语言）。
const MUTATOR_METHODS: &[&str] = &[
    // JS / TS
    "push",
    "unshift",
    "splice",
    "set",
    "add",
    "fill",
    "setItem",
    "delete",
    // Rust
    "insert",
    "push_str",
    "extend",
    "append",
    "replace",
    "remove",
    "push_back",
    "push_front",
    // Python
    "update",
    "setdefault",
];

/// 解析源码并抽取函数级数据流摘要。语言不支持 / 文件不适合解析时返回 `None`。
pub fn analyze_dataflow(language: &str, rel_path: &str, source: &str) -> Option<FileDataFlow> {
    let dialect = dialect_for(language, rel_path)?;
    // 只有 TS/JS/Rust/Python 做函数级数据流，其余方言优雅降级（与 metrics 模块口径一致）：
    // 返回 None 表示「该语言无数据流支持」，下游据此跳过数据流相关画像；
    // 若改成返回 Some(空结构)，会被误认为「分析过但没发现」，语义完全不同。
    if !dialect.has_dataflow() {
        return None;
    }
    if source.len() > MAX_SOURCE_BYTES || looks_minified(source) {
        return None;
    }
    let mut parser = Parser::new();
    parser.set_language(&dialect.language()).ok()?;
    let tree = parser.parse(source, None)?;
    let bytes = source.as_bytes();

    let mut out: Vec<FunctionFlow> = Vec::new();
    collect_functions(dialect, tree.root_node(), bytes, &mut out);
    out.truncate(MAX_FUNCTIONS);
    Some(FileDataFlow { functions: out })
}

fn collect_functions(dialect: Dialect, node: Node, src: &[u8], out: &mut Vec<FunctionFlow>) {
    if out.len() >= MAX_FUNCTIONS {
        return;
    }
    if is_flow_function(dialect, node.kind()) {
        if let Some(f) = summarize_function(dialect, node, src) {
            out.push(f);
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_functions(dialect, child, src, out);
    }
}

fn is_flow_function(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => matches!(
            kind,
            "function_declaration"
                | "function_expression"
                | "generator_function_declaration"
                | "arrow_function"
                | "method_definition"
        ),
        Dialect::Rust => kind == "function_item",
        Dialect::Python => kind == "function_definition",
        // 新增 Go/Java/C#/C++ 方言：暂不做函数级数据流（优雅降级，仅 AST 度量），
        // 避免逐语言实现参数/返回值追踪的复杂结构差异。后续可在此接入。
        Dialect::Go
        | Dialect::Java
        | Dialect::CSharp
        | Dialect::Cpp
        | Dialect::C
        | Dialect::Ruby
        | Dialect::Php
        | Dialect::Kotlin
        | Dialect::Swift => false,
    }
}

fn text_of(node: Node, src: &[u8]) -> String {
    node.utf8_text(src).unwrap_or("").to_string()
}

/// 抽取形参名。各方言的参数节点结构不同，统一归一到「标识符列表」。
fn param_names(dialect: Dialect, func: Node, src: &[u8]) -> Vec<String> {
    // 箭头函数的单参数无括号：`x => x + 1`
    if let Some(p) = func.child_by_field_name("parameter") {
        return vec![text_of(p, src)];
    }
    let Some(params) = func.child_by_field_name("parameters") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut cursor = params.walk();
    for child in params.named_children(&mut cursor) {
        if child.kind() == "comment" || child.kind() == "self_parameter" {
            continue;
        }
        match dialect {
            Dialect::TypeScript | Dialect::Tsx => {
                // required_parameter / optional_parameter → pattern 字段
                let target = child.child_by_field_name("pattern").unwrap_or(child);
                push_pattern_idents(target, src, &mut out);
            }
            Dialect::Rust => {
                let target = child.child_by_field_name("pattern").unwrap_or(child);
                push_pattern_idents(target, src, &mut out);
            }
            Dialect::Python => match child.kind() {
                "identifier" => out.push(text_of(child, src)),
                "typed_parameter" | "default_parameter" | "typed_default_parameter" => {
                    if let Some(n) = child.child_by_field_name("name") {
                        out.push(text_of(n, src));
                    } else if let Some(n) = child.named_child(0) {
                        out.push(text_of(n, src));
                    }
                }
                _ => {}
            },
            Dialect::Go
            | Dialect::Java
            | Dialect::CSharp
            | Dialect::Cpp
            | Dialect::C
            | Dialect::Ruby
            | Dialect::Php
            | Dialect::Kotlin
            | Dialect::Swift => {}
        }
    }
    out.retain(|s| !s.is_empty() && s != "self" && s != "this");
    out.sort();
    out.dedup();
    out
}

/// 解构模式里的所有标识符：`{ a, b }` / `[x, y]` 都要展开成独立形参
fn push_pattern_idents(node: Node, src: &[u8], out: &mut Vec<String>) {
    match node.kind() {
        "identifier" | "shorthand_property_identifier_pattern" => out.push(text_of(node, src)),
        _ => {
            let mut cursor = node.walk();
            let children: Vec<Node> = node.named_children(&mut cursor).collect();
            if children.is_empty() {
                let t = text_of(node, src);
                if !t.is_empty()
                    && t.chars()
                        .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
                {
                    out.push(t);
                }
                return;
            }
            for c in children {
                if c.kind() == "type_annotation" || c.kind() == "type_identifier" {
                    continue;
                }
                push_pattern_idents(c, src, out);
            }
        }
    }
}

fn is_return_node(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx | Dialect::Python => kind == "return_statement",
        Dialect::Rust => kind == "return_expression",
        Dialect::Go
        | Dialect::Java
        | Dialect::CSharp
        | Dialect::Cpp
        | Dialect::C
        | Dialect::Ruby
        | Dialect::Php
        | Dialect::Kotlin
        | Dialect::Swift => false,
    }
}

fn is_call_node(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => kind == "call_expression",
        Dialect::Rust => kind == "call_expression" || kind == "macro_invocation",
        Dialect::Python => kind == "call",
        Dialect::Go
        | Dialect::Java
        | Dialect::CSharp
        | Dialect::Cpp
        | Dialect::C
        | Dialect::Ruby
        | Dialect::Php
        | Dialect::Kotlin
        | Dialect::Swift => false,
    }
}

/// 取被调名的最后一段：`repo.save` → `save`，`crate::db::open` → `open`
fn short_callee(raw: &str) -> String {
    let s = raw.trim();
    let s = s.rsplit("::").next().unwrap_or(s);
    let s = s.rsplit('.').next().unwrap_or(s);
    s.trim().trim_end_matches('!').to_string()
}

/// 收集子树里出现的所有标识符（用于与形参求交）
fn idents_in(node: Node, src: &[u8], out: &mut Vec<String>) {
    if node.kind() == "identifier" || node.kind() == "shorthand_property_identifier" {
        out.push(text_of(node, src));
        return;
    }
    let mut cursor = node.walk();
    for c in node.children(&mut cursor) {
        idents_in(c, src, out);
    }
}

/// 一个局部变量的数据来源：来自哪个形参，途中经过了哪些调用。
///
/// 对标 joern `ReachingDefProblem` 的到达定义（gen/kill 不动点）。这里只取它的
/// 降级子集：变量来源集合，而非「到达程序点的定义集合」——没有 CFG 就不谈程序点。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct LocalOrigin {
    param: String,
    via: Vec<String>,
}

/// 收集函数体内的局部变量声明（不进入嵌套具名函数 —— 那些有自己的摘要）。
///
/// 这是到达定义的**降级子集**：只认「声明即赋值」的直线数据流，不做分支合并、
/// 也不追 `let x; x = ...` 的后续赋值。选它是因为真实污点链绝大多数形如
/// `const id = req.params.id; query(id)`，一次声明即可覆盖；而完整的 gen/kill
/// 不动点会把复杂度推到 CFG 量级，收益不成比例（joern 为此专门建了 CFG 层）。
fn collect_local_decls<'a>(
    dialect: Dialect,
    node: Node<'a>,
    owner: Node,
    src: &[u8],
    out: &mut Vec<(String, Node<'a>)>,
) {
    let kind = node.kind();
    let mut value_node: Option<Node> = None;
    let declared = match dialect {
        Dialect::TypeScript | Dialect::Tsx if kind == "variable_declarator" => {
            match (
                node.child_by_field_name("name"),
                node.child_by_field_name("value"),
            ) {
                (Some(name), Some(value)) if name.kind() == "identifier" => {
                    out.push((text_of(name, src), value));
                    value_node = Some(value);
                    true
                }
                _ => false,
            }
        }
        Dialect::Rust if kind == "let_declaration" => {
            match (
                node.child_by_field_name("pattern"),
                node.child_by_field_name("value"),
            ) {
                (Some(pat), Some(value)) if pat.kind() == "identifier" => {
                    out.push((text_of(pat, src), value));
                    value_node = Some(value);
                    true
                }
                _ => false,
            }
        }
        Dialect::Python if kind == "assignment" => {
            match (
                node.child_by_field_name("left"),
                node.child_by_field_name("right"),
            ) {
                (Some(left), Some(right)) if left.kind() == "identifier" => {
                    out.push((text_of(left, src), right));
                    value_node = Some(right);
                    true
                }
                _ => false,
            }
        }
        _ => false,
    };
    if declared {
        // 闭包不独立成摘要（与 walk 同口径），其局部量仍属外层函数，必须继续下钻。
        // 否则 `const cb = () => { const t = p.trim(); run(t); }` 里的 `t` 会被吞掉。
        let is_closure = value_node
            .map(|v| {
                matches!(
                    v.kind(),
                    "arrow_function" | "function_expression" | "closure_expression" | "lambda"
                )
            })
            .unwrap_or(false);
        if !is_closure {
            return;
        }
    }
    // 与 walk 同口径：具名嵌套函数独立成摘要，跳过其子树；箭头/闭包留在外层
    if node.id() != owner.id()
        && is_flow_function(dialect, kind)
        && !matches!(
            kind,
            "arrow_function" | "function_expression" | "closure_expression"
        )
    {
        return;
    }
    let mut cursor = node.walk();
    for c in node.children(&mut cursor) {
        collect_local_decls(dialect, c, owner, src, out);
    }
}

/// 收集子树里出现的所有标识符，**并记录每个标识符到子树根之间途经的调用名**。
///
/// `f(g(x))` 里 `x` 的途经调用是 `[g, f]`（求值顺序，内层在前）。净化函数就藏在这
/// 条链上，所以展开局部变量时必须把它带上 —— 否则 `const v = escapeHtml(req.body)`
/// 展开成 `req → render` 之后，净化痕迹被抹掉，已净化的数据会被报成漏洞。
///
/// 调用的函数名子树（`g(...)` 里的 `g`）刻意跳过：它是被调方而非传入的值，
/// 与 `hit_params` 只扫 arguments 的历史口径一致，避免 `cb(x)` 里的 `cb`
/// 被误记成「流过自身」。但**成员调用的接收者必须保留** —— 对标 joern 语义表
/// 的 `0 -> -1`（接收者流向返回值）：`const t = req.body.name.trim()` 的数据
/// 来源就是 `req`，跳过接收者会把 `.trim()/.toLowerCase()` 这一整类写法漏掉。
/// 属性名本身（`a.b` 的 `b`）是名字而非值引用，一律不收集。
fn idents_with_call_path(
    dialect: Dialect,
    node: Node,
    src: &[u8],
    calls: &mut Vec<String>,
    out: &mut Vec<(String, Vec<String>)>,
) {
    if node.kind() == "identifier" || node.kind() == "shorthand_property_identifier" {
        let mut via = calls.clone();
        via.reverse(); // 收集顺序是外层→内层，翻转成求值顺序
        via.truncate(MAX_VIA_LEN);
        out.push((text_of(node, src), via));
        return;
    }

    let mut pushed = false;
    let mut skip_id: Option<usize> = None;
    let mut receiver: Option<Node> = None;
    if is_call_node(dialect, node.kind()) {
        if let Some(f) = node
            .child_by_field_name("function")
            .or_else(|| node.child_by_field_name("macro"))
        {
            let name = short_callee(&text_of(f, src));
            if !name.is_empty() {
                calls.push(name);
                pushed = true;
            }
            match f.kind() {
                "identifier" => skip_id = Some(f.id()),
                // 成员调用：只取接收者链，不要方法名本身
                "member_expression" | "field_expression" | "attribute" => {
                    receiver = f
                        .child_by_field_name("object")
                        .or_else(|| f.child_by_field_name("value"));
                    skip_id = Some(f.id());
                }
                _ => {}
            }
        }
    }
    if let Some(obj) = receiver {
        idents_with_call_path(dialect, obj, src, calls, out);
    }

    // 属性名（TS 的 property / Rust 的 field / Python 的 attribute）不构成数据流
    let prop_id = matches!(
        node.kind(),
        "member_expression" | "field_expression" | "attribute"
    )
    .then(|| {
        node.child_by_field_name("property")
            .or_else(|| node.child_by_field_name("field"))
            .or_else(|| node.child_by_field_name("attribute"))
            .map(|p| p.id())
    })
    .flatten();

    let mut cursor = node.walk();
    for c in node.children(&mut cursor) {
        if Some(c.id()) == skip_id || Some(c.id()) == prop_id {
            continue;
        }
        idents_with_call_path(dialect, c, src, calls, out);
    }
    if pushed {
        calls.pop();
    }
}

/// 求表达式里每个形参来源：直接出现的形参，加上经由局部变量中转的形参。
///
/// 这是本模块从「只认形参」升级到「局部变量感知」的核心。此前
/// `const id = req.params.id; db.query(id)` 一条流都产不出来 —— `db.query`
/// 的实参里没有形参，只有局部量 `id`。展开后得到 `req → query`，
/// 经典的 SQL 注入链才第一次可见。
fn origins_in(
    dialect: Dialect,
    src: &[u8],
    params: &[String],
    locals: &HashMap<String, Vec<LocalOrigin>>,
    node: Node,
) -> Vec<LocalOrigin> {
    if params.is_empty() && locals.is_empty() {
        return Vec::new();
    }
    let mut idents = Vec::new();
    let mut path = Vec::new();
    idents_with_call_path(dialect, node, src, &mut path, &mut idents);
    let mut out: Vec<LocalOrigin> = Vec::new();
    for (ident, via) in idents {
        if params.iter().any(|p| *p == ident) {
            if out.len() < MAX_LOCAL_ORIGINS {
                out.push(LocalOrigin { param: ident, via });
            }
        } else if let Some(origins) = locals.get(&ident) {
            for o in origins {
                if out.len() >= MAX_LOCAL_ORIGINS {
                    break;
                }
                let mut v = o.via.clone();
                v.extend(via.iter().cloned());
                v.truncate(MAX_VIA_LEN);
                out.push(LocalOrigin {
                    param: o.param.clone(),
                    via: v,
                });
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// 取访问链的根标识符：`self.blocks` → `self`，`a.b[0].c` → `a`，`xs` → `xs`
fn root_ident(node: Node, src: &[u8]) -> String {
    let mut cur = node;
    loop {
        let next = cur
            .child_by_field_name("object")
            .or_else(|| cur.child_by_field_name("value"))
            .or_else(|| {
                // Rust 的 index_expression 没有具名字段，取第一个子表达式
                if cur.kind() == "index_expression" {
                    cur.named_child(0)
                } else {
                    None
                }
            });
        match next {
            Some(n) if n.id() != cur.id() => cur = n,
            _ => return text_of(cur, src),
        }
    }
}

/// 取调用接收者的根标识符（`obj.method()` → `obj`；`a.b.method()` → `a`；
/// `RegExp.exec` → `RegExp`；`self.exec` → `self`）。无接收者的普通调用返回空串。
/// P0 新增，供 taintFlow 的接收者守卫区分 `RegExp.exec`/`self.exec` 与 `child_process.exec`。
fn receiver_of(node: Node, src: &[u8]) -> String {
    if let Some(obj) = node
        .child_by_field_name("object")
        .or_else(|| node.child_by_field_name("value"))
    {
        return root_ident(obj, src);
    }
    String::new()
}

fn subtree_has_call(dialect: Dialect, node: Node) -> bool {
    if is_call_node(dialect, node.kind()) {
        return true;
    }
    let mut cursor = node.walk();
    let hit = node
        .children(&mut cursor)
        .any(|c| subtree_has_call(dialect, c));
    hit
}

/// Rust 的函数体尾表达式（无 `return` 关键字的隐式返回）
///
/// 有两个坑，都由真实仓库探针暴露：
///
/// 1. **块尾表达式被包成语句**。tree-sitter-rust 的文法里
///    `expression_statement: choice(seq($._expression, ';'), prec(1, $._expression_ending_with_block))`,
///    那个 `prec(1)` 会让 `match` / `if` / `loop` / `unsafe` / 裸块这类
///    「以块收尾的表达式」优先归约成 `expression_statement`，哪怕它其实是尾表达式。
///    早期实现按 `_statement` 后缀一刀切，把 `fn f(x) -> T { match x { .. } }`
///    整类隐式返回全漏掉了 —— 而 `match` 返回在 Rust 里恰恰是最常见的写法。
///    判据：`expression_statement` 末尾**没有分号**才是尾表达式。
///
/// 2. **unit 函数没有返回值可承载形参**。`fn f(flag: bool) { if flag { log(); } }`
///    的块尾 `if` 只是控制流。用 `return_type` 字段兜一层，避免解开坑 1 之后
///    把这类函数误判成透传（会白白吃掉剪枝收益）。
fn rust_tail_expr<'a>(func: Node<'a>) -> Option<Node<'a>> {
    // 无返回类型 = 返回 unit，不存在隐式返回值
    func.child_by_field_name("return_type")?;
    let body = func.child_by_field_name("body")?;
    let mut cursor = body.walk();
    let last = body.named_children(&mut cursor).last()?;
    if matches!(last.kind(), "line_comment" | "block_comment") {
        return None;
    }
    if last.kind() == "expression_statement" {
        // 带分号 = 真语句；不带分号 = 被文法多包了一层的块尾表达式
        return if ends_with_semicolon(last) {
            None
        } else {
            last.named_child(0)
        };
    }
    // 其余语句节点不是尾表达式（`let x = 1;` 结尾的函数返回 unit）
    if last.kind().ends_with("_statement") {
        return None;
    }
    Some(last)
}

fn ends_with_semicolon(node: Node) -> bool {
    let n = node.child_count();
    n > 0 && node.child(n - 1).map(|c| c.kind() == ";").unwrap_or(false)
}

fn summarize_function(dialect: Dialect, func: Node, src: &[u8]) -> Option<FunctionFlow> {
    let params = param_names(dialect, func, src);
    let name = flow_function_name(func, src);
    let line = func.start_position().row as i64 + 1;

    let body = func.child_by_field_name("body").unwrap_or(func);

    // 局部变量来源：到达定义的降级子集（见 collect_local_decls 注释）。
    // 定点迭代到稳定，覆盖 `const a = f(x); const b = g(a);` 这类链式中转。
    let mut decls: Vec<(String, Node)> = Vec::new();
    collect_local_decls(dialect, body, func, src, &mut decls);
    let mut locals: HashMap<String, Vec<LocalOrigin>> = HashMap::new();
    for _ in 0..MAX_FIXPOINT_ROUNDS {
        let mut changed = false;
        for (name, value) in &decls {
            let next = origins_in(dialect, src, &params, &locals, *value);
            if locals.get(name) != Some(&next) {
                locals.insert(name.clone(), next);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    let mut ctx = FlowCtx {
        dialect,
        src,
        params: &params,
        param_to_return: Vec::new(),
        returns_call_result: false,
        param_to_call: Vec::new(),
        sinks: Vec::new(),
        locals,
    };

    ctx.walk(body, func);

    // Rust 隐式尾返回
    if dialect == Dialect::Rust {
        if let Some(tail) = rust_tail_expr(func) {
            ctx.note_return(tail);
        }
    }
    // 箭头函数表达式体：`(a) => a + 1` 的 body 本身就是返回值
    if matches!(dialect, Dialect::TypeScript | Dialect::Tsx)
        && func.kind() == "arrow_function"
        && body.kind() != "statement_block"
    {
        ctx.note_return(body);
    }

    ctx.param_to_return.sort();
    ctx.param_to_return.dedup();
    ctx.sinks.sort();
    ctx.sinks.dedup();
    ctx.param_to_call.truncate(MAX_CALL_FLOWS);
    let FlowCtx {
        param_to_return,
        returns_call_result,
        param_to_call,
        sinks,
        ..
    } = ctx;

    Some(FunctionFlow {
        name,
        line,
        params,
        param_to_return,
        returns_call_result,
        param_to_call,
        sinks,
    })
}

/// 函数名解析（与度量模块口径一致：箭头函数回溯到被赋值的变量名）
fn flow_function_name(func: Node, src: &[u8]) -> String {
    if let Some(n) = func.child_by_field_name("name") {
        return text_of(n, src);
    }
    let mut cur = func.parent();
    for _ in 0..3 {
        let Some(p) = cur else { break };
        match p.kind() {
            "variable_declarator"
            | "pair"
            | "public_field_definition"
            | "assignment_expression" => {
                let field = if p.kind() == "pair" { "key" } else { "name" };
                if let Some(n) = p
                    .child_by_field_name(field)
                    .or_else(|| p.child_by_field_name("left"))
                {
                    return text_of(n, src);
                }
            }
            _ => {}
        }
        cur = p.parent();
    }
    "(anonymous)".to_string()
}

struct FlowCtx<'a> {
    dialect: Dialect,
    src: &'a [u8],
    params: &'a [String],
    param_to_return: Vec<String>,
    returns_call_result: bool,
    param_to_call: Vec<CallArgFlow>,
    sinks: Vec<String>,
    /// 局部变量 → 来源集合（定点迭代结果，见 `origins_in`）
    locals: HashMap<String, Vec<LocalOrigin>>,
}

impl<'a> FlowCtx<'a> {
    fn hit_params(&self, node: Node) -> Vec<String> {
        if self.params.is_empty() {
            return Vec::new();
        }
        let mut ids = Vec::new();
        idents_in(node, self.src, &mut ids);
        let mut hit: Vec<String> = ids
            .into_iter()
            .filter(|i| self.params.iter().any(|p| p == i))
            .collect();
        hit.sort();
        hit.dedup();
        hit
    }

    fn note_return(&mut self, expr: Node) {
        for p in self.hit_params(expr) {
            self.param_to_return.push(p);
        }
        if subtree_has_call(self.dialect, expr) {
            self.returns_call_result = true;
        }
    }

    /// 遍历函数体。遇到嵌套函数**不下钻**（它有自己的摘要，由外层 collect 单独产出），
    /// 但闭包除外：闭包捕获外层形参，其数据流属于外层函数的行为。
    fn walk(&mut self, node: Node<'a>, owner: Node<'a>) {
        let kind = node.kind();

        if is_return_node(self.dialect, kind) {
            let target = node.named_child(0).unwrap_or(node);
            self.note_return(target);
        }

        if is_call_node(self.dialect, kind) {
            self.note_call(node);
            self.note_mutation_sink(node);
        }

        if self.is_sink_assignment(node) {
            self.note_sink(node);
        }

        // 具名嵌套函数独立成摘要，跳过其子树；箭头/闭包留在外层
        if node.id() != owner.id()
            && is_flow_function(self.dialect, kind)
            && !matches!(
                kind,
                "arrow_function" | "function_expression" | "closure_expression"
            )
        {
            return;
        }

        let mut cursor = node.walk();
        for c in node.children(&mut cursor) {
            self.walk(c, owner);
        }
    }

    fn note_call(&mut self, call: Node) {
        if self.param_to_call.len() >= MAX_CALL_FLOWS {
            return;
        }
        let Some(fnode) = call
            .child_by_field_name("function")
            .or_else(|| call.child_by_field_name("macro"))
        else {
            return;
        };
        let callee = short_callee(&text_of(fnode, self.src));
        if callee.is_empty() {
            return;
        }
        // P0：捕获接收者根标识符（member/field 表达式的 object/value）
        let receiver = receiver_of(fnode, self.src);
        let Some(args) = call.child_by_field_name("arguments") else {
            return;
        };
        let line = call.start_position().row as i64 + 1;
        let mut cursor = args.walk();
        for (idx, arg) in args.named_children(&mut cursor).enumerate() {
            if arg.kind() == "comment" {
                continue;
            }
            // 用 origins_in 取代 hit_params：形参直接出现（via 为空，历史行为）
            // 与经由局部变量中转（via 记录中间调用）两种情况一并覆盖。
            let origins = origins_in(self.dialect, self.src, self.params, &self.locals, arg);
            for o in origins {
                if self.param_to_call.len() >= MAX_CALL_FLOWS {
                    return;
                }
                // 整链语义：`via ++ [callee]`（求值顺序，内层在前）。
                // via 必须一起判 —— 展开局部变量后净化痕迹只存在于 via 中；
                // 同时语义表里的 PassThrough 条目会**覆盖**掉历史正则名单的误伤
                // （最典型的是 `path.normalize` 被当成净化器，导致路径穿越漏报）。
                let sem = flow_semantics::chain_semantics(
                    o.via
                        .iter()
                        .map(|s| s.as_str())
                        .chain(std::iter::once(callee.as_str())),
                )
                .encode();
                self.param_to_call.push(CallArgFlow {
                    callee: callee.clone(),
                    arg_index: idx as i64,
                    param: o.param,
                    line,
                    receiver: receiver.clone(),
                    via: o.via,
                    sem,
                });
            }
        }
    }

    /// 写外部状态：左值是成员访问或下标（`this.x = p` / `cache[k] = p`）
    fn is_sink_assignment(&self, node: Node) -> bool {
        let left_kind = |n: Node| n.child_by_field_name("left").map(|l| l.kind().to_string());
        match self.dialect {
            Dialect::TypeScript | Dialect::Tsx => {
                node.kind() == "assignment_expression"
                    && matches!(
                        left_kind(node).as_deref(),
                        Some("member_expression") | Some("subscript_expression")
                    )
            }
            Dialect::Rust => {
                node.kind() == "assignment_expression"
                    && matches!(
                        left_kind(node).as_deref(),
                        Some("field_expression") | Some("index_expression")
                    )
            }
            Dialect::Python => {
                node.kind() == "assignment"
                    && matches!(
                        left_kind(node).as_deref(),
                        Some("attribute") | Some("subscript")
                    )
            }
            Dialect::Go
            | Dialect::Java
            | Dialect::CSharp
            | Dialect::Cpp
            | Dialect::C
            | Dialect::Ruby
            | Dialect::Php
            | Dialect::Kotlin
            | Dialect::Swift => false,
        }
    }

    fn note_sink(&mut self, node: Node) {
        let (Some(left), Some(right)) = (
            node.child_by_field_name("left"),
            node.child_by_field_name("right"),
        ) else {
            return;
        };
        // 与 note_call 同口径：经局部变量中转后写入外部状态同样算逃逸
        // （`const v = norm(p); this.cache[k] = v;` 此前因 v 非形参而漏记）
        let origins = origins_in(self.dialect, self.src, self.params, &self.locals, right);
        if origins.is_empty() {
            return;
        }
        let t = text_of(left, self.src);
        if !t.is_empty() && self.sinks.len() < MAX_SINKS {
            self.sinks.push(t.chars().take(80).collect());
        }
    }

    /// 变异方法调用视同赋值：`self.blocks.push(v)` / `this.cache.set(k, v)` / `xs.push(x)`。
    ///
    /// 数据逃出函数有三条通道，返回值只是其中一条。这里补另外两条：
    ///
    /// - **对象状态**：接收者是字段/成员/下标访问，或就是 `self` / `this`。
    ///   要求实参里真的带上形参，否则只是与输入无关的内部变更。
    /// - **出参**：接收者的根标识符就是形参（Rust 的 `&mut Vec<T>`、
    ///   JS 里传进来的数组）。此时形参本身就是通道，**写什么都算** ——
    ///   `fn collect(e: &E, xs: &mut Vec<f64>)` 往 `xs` 里塞的是局部值，
    ///   但调用方看得见，改了它调用方就受影响。
    ///
    /// 唯一排除的是局部累加器：`let mut out = Vec::new(); out.push(v); out`。
    /// 它的影响已经由返回值体现，再记一笔会让几乎所有 map/filter 风格的函数
    /// 变成 sink，剪枝收益直接归零。
    fn note_mutation_sink(&mut self, call: Node) {
        if self.sinks.len() >= MAX_SINKS {
            return;
        }
        let Some(fnode) = call.child_by_field_name("function") else {
            return;
        };
        if !matches!(
            fnode.kind(),
            "member_expression" | "field_expression" | "attribute"
        ) {
            return;
        }
        let method = short_callee(&text_of(fnode, self.src));
        if !MUTATOR_METHODS.contains(&method.as_str()) {
            return;
        }
        let Some(recv) = fnode
            .child_by_field_name("object")
            .or_else(|| fnode.child_by_field_name("value"))
        else {
            return;
        };
        let recv_txt = text_of(recv, self.src);
        let root = root_ident(recv, self.src);
        let is_out_param = self.params.iter().any(|p| *p == root);

        if !is_out_param {
            let external = matches!(
                recv.kind(),
                "member_expression"
                    | "field_expression"
                    | "attribute"
                    | "subscript_expression"
                    | "index_expression"
                    | "subscript"
            ) || recv_txt == "self"
                || recv_txt == "this";
            if !external {
                return;
            }
            let Some(args) = call.child_by_field_name("arguments") else {
                return;
            };
            if self.hit_params(args).is_empty() {
                return;
            }
        }

        let label = format!("{}.{}()", recv_txt, method);
        self.sinks.push(label.chars().take(80).collect());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(lang: &str, path: &str, src: &str, name: &str) -> FunctionFlow {
        let f = analyze_dataflow(lang, path, src).expect("应能解析");
        f.functions
            .into_iter()
            .find(|x| x.name == name)
            .unwrap_or_else(|| panic!("没找到函数 {name}"))
    }

    /// 取出 (callee, param, via) 三元组，避免测试里重复字段访问
    fn flows(f: &FunctionFlow) -> Vec<(String, String, Vec<String>)> {
        f.param_to_call
            .iter()
            .map(|c| (c.callee.clone(), c.param.clone(), c.via.clone()))
            .collect()
    }

    // ───────── 局部变量感知（对标 joern ReachingDefPass 到达定义） ─────────

    #[test]
    fn ts_local_var_carries_param_into_call() {
        // 最经典的注入写法：此前 `id` 不是形参，整条链一条流都产不出来
        let src = "function handler(req: any) {\n  const id = req.params.id;\n  db.query(\"SELECT * FROM t WHERE id = \" + id);\n}\n";
        let f = one("typescript", "a.ts", src, "handler");
        assert!(
            flows(&f).contains(&("query".into(), "req".into(), vec![])),
            "经局部变量中转的形参必须连上下游调用，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_sanitizing_call_is_recorded_in_via() {
        // 净化痕迹只存在于 via 里 —— 展开成直达边后若不记录，会让前端误报漏洞
        let src =
            "function handler(req: any) {\n  const v = escapeHtml(req.body);\n  render(v);\n}\n";
        let f = one("typescript", "a.ts", src, "handler");
        assert!(
            flows(&f).contains(&(
                "render".into(),
                "req".into(),
                vec!["escapeHtml".to_string()]
            )),
            "净化调用必须留在 via 中供污点求解器判定，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_chained_locals_reach_fixed_point() {
        // 链式中转需要定点迭代才能收敛
        let src = "function handler(req: any) {\n  const a = norm(req.x);\n  const b = wrap(a);\n  sink(b);\n}\n";
        let f = one("typescript", "a.ts", src, "handler");
        assert!(
            flows(&f).contains(&(
                "sink".into(),
                "req".into(),
                vec!["norm".to_string(), "wrap".to_string()]
            )),
            "中间调用链应按求值顺序完整保留，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_receiver_is_a_data_source() {
        // 对标 joern 语义 `0 -> -1`：接收者流向返回值。
        // `.trim()/.toLowerCase()` 这类写法在真实输入清洗代码里极其常见，
        // 丢掉接收者等于把整类链判死。
        let src = "function handler(req: any) {\n  const name = req.body.name.trim();\n  sink(name);\n}\n";
        let f = one("typescript", "a.ts", src, "handler");
        assert!(
            flows(&f).contains(&("sink".into(), "req".into(), vec!["trim".to_string()])),
            "成员调用的接收者必须算数据来源，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_property_name_is_not_a_data_source() {
        // 属性名是名字而非值引用：形参恰好叫 `name` 时不该凭空造流
        let src = "function f(name: any) {\n  const v = obj.name;\n  sink(v);\n}\n";
        let f = one("typescript", "a.ts", src, "f");
        assert!(
            f.param_to_call.is_empty(),
            "`obj.name` 里的 name 不是形参引用，不该产生流，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_direct_param_flow_keeps_empty_via() {
        // 零回归：形参直接出现在实参里时，via 必须为空（历史行为）
        let src = "function f(x: any) {\n  g(x);\n}\n";
        let f = one("typescript", "a.ts", src, "f");
        assert_eq!(flows(&f), vec![("g".into(), "x".into(), vec![])]);
    }

    #[test]
    fn ts_local_without_param_origin_yields_no_flow() {
        // 零误报：局部量不含任何形参来源时不该凭空造流
        let src = "function f(x: any) {\n  const lit = \"SAFE\";\n  db.query(lit);\n}\n";
        let f = one("typescript", "a.ts", src, "f");
        assert!(
            f.param_to_call.is_empty(),
            "与形参无关的局部量不该产生流，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn rust_let_binding_carries_param_into_call() {
        let src =
            "fn handler(req: &Request) {\n    let id = req.params.id;\n    db.query(id);\n}\n";
        let f = one("rust", "a.rs", src, "handler");
        assert!(
            flows(&f).contains(&("query".into(), "req".into(), vec![])),
            "Rust let 绑定同样要连上，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn python_assignment_carries_param_into_call() {
        let src = "def handler(req):\n    q = req.GET['id']\n    cursor.execute(q)\n";
        let f = one("python", "a.py", src, "handler");
        assert!(
            flows(&f).contains(&("execute".into(), "req".into(), vec![])),
            "Python 赋值同样要连上，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_local_mutation_sink_is_recorded() {
        // 经局部变量写入外部状态也算逃逸，与 note_call 同口径
        let src = "function f(p: any) {\n  const v = norm(p);\n  this.cache[k] = v;\n}\n";
        let f = one("typescript", "a.ts", src, "f");
        assert!(
            f.sinks.iter().any(|s| s.contains("this.cache")),
            "经局部量写入外部状态必须记为 sink，实际：{:?}",
            f.sinks
        );
    }

    #[test]
    fn ts_arrow_closure_locals_stay_in_owner() {
        // 闭包不独立成摘要，其局部量仍属外层函数
        let src = "function outer(p: any) {\n  const cb = () => { const t = p.trim(); run(t); };\n  cb();\n}\n";
        let f = one("typescript", "a.ts", src, "outer");
        assert!(
            flows(&f).contains(&("run".into(), "p".into(), vec!["trim".to_string()])),
            "闭包内的流属于外层函数，实际：{:?}",
            flows(&f)
        );
    }

    #[test]
    fn ts_param_flows_to_return_marks_pass_through() {
        let src = "function norm(raw: string) {\n  const t = raw.trim();\n  return t.length > 0 ? raw : \"\";\n}\n";
        let f = one("typescript", "a.ts", src, "norm");
        assert_eq!(f.params, vec!["raw"]);
        assert_eq!(f.param_to_return, vec!["raw"]);
        assert!(f.propagates(), "形参出现在返回值里 → 透传");
    }

    #[test]
    fn ts_logging_sink_does_not_propagate() {
        // 这是本模块存在的核心理由：logDebug 吃进数据但不吐出去，污染到此为止
        let src = "function logDebug(msg: string) {\n  console.log(msg);\n}\n";
        let f = one("typescript", "a.ts", src, "logDebug");
        assert!(f.param_to_return.is_empty());
        assert!(!f.returns_call_result);
        assert!(!f.propagates(), "不把输入传出去的函数必须判为非透传");
    }

    #[test]
    fn ts_return_call_result_is_indirect_pass_through() {
        let src = "function make(a: number) {\n  return build();\n}\n";
        let f = one("typescript", "a.ts", src, "make");
        assert!(f.returns_call_result);
        assert!(f.propagates());
    }

    #[test]
    fn ts_param_to_call_arg_is_recorded_with_index() {
        let src = "function run(cfg: C, id: string) {\n  save(id, cfg);\n}\n";
        let f = one("typescript", "a.ts", src, "run");
        let hit: Vec<(&str, i64, &str)> = f
            .param_to_call
            .iter()
            .map(|c| (c.callee.as_str(), c.arg_index, c.param.as_str()))
            .collect();
        assert!(hit.contains(&("save", 0, "id")));
        assert!(hit.contains(&("save", 1, "cfg")));
    }

    #[test]
    fn ts_member_write_is_a_sink() {
        let src =
            "function put(k: string, v: number) {\n  this.cache[k] = v;\n  store.last = v;\n}\n";
        let f = one("typescript", "a.ts", src, "put");
        assert!(f.has_sink());
        assert!(f.sinks.iter().any(|s| s.contains("store.last")));
    }

    #[test]
    fn ts_arrow_expression_body_counts_as_return() {
        let src = "const double = (n: number) => n * 2;\n";
        let f = one("typescript", "a.ts", src, "double");
        assert_eq!(f.param_to_return, vec!["n"]);
    }

    #[test]
    fn ts_destructured_params_are_expanded() {
        let src = "function pick({ id, name }: any) {\n  return id;\n}\n";
        let f = one("typescript", "a.ts", src, "pick");
        assert!(f.params.contains(&"id".to_string()));
        assert!(f.params.contains(&"name".to_string()));
        assert_eq!(f.param_to_return, vec!["id"]);
    }

    #[test]
    fn zero_param_function_is_conservatively_transparent() {
        // 无形参的函数可能读取捕获的外部状态，无法证明它安全 → 保守放行
        let src = "function now() {\n  return Date.now();\n}\n";
        let f = one("typescript", "a.ts", src, "now");
        assert!(f.params.is_empty());
        assert!(f.propagates());
    }

    #[test]
    fn rust_tail_expression_is_a_return() {
        let src = "fn wrap(v: i32) -> i32 {\n    let x = v + 1;\n    x + v\n}\n";
        let f = one("rust", "a.rs", src, "wrap");
        assert_eq!(f.param_to_return, vec!["v"]);
        assert!(f.propagates());
    }

    #[test]
    fn rust_unit_function_does_not_propagate() {
        let src = "fn log_it(msg: &str) {\n    println!(\"{}\", msg);\n}\n";
        let f = one("rust", "a.rs", src, "log_it");
        assert!(!f.propagates(), "只打日志的 Rust 函数不该被判为透传");
    }

    // ---- 块尾表达式作为隐式返回（真实仓库探针暴露的漏判）----

    #[test]
    fn rust_tail_match_is_a_return() {
        // tree-sitter-rust 把块尾的 `match` 归约成 expression_statement，
        // 早期实现按 `_statement` 后缀一刀切，导致整类 match 返回被判成阻断。
        let src = "fn name_of(et: &EntityType) -> &'static str {\n    match et {\n        EntityType::Line(_) => \"Line\",\n        _ => \"Other\",\n    }\n}\n";
        let f = one("rust", "a.rs", src, "name_of");
        assert_eq!(
            f.param_to_return,
            vec!["et"],
            "match 尾表达式里的形参要流向返回值"
        );
        assert!(f.propagates());
    }

    #[test]
    fn rust_tail_if_else_is_a_return() {
        let src = "fn median_sorted(sorted: &[f64]) -> f64 {\n    if sorted.is_empty() {\n        return 0.0;\n    }\n    let n = sorted.len();\n    if n % 2 == 0 {\n        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0\n    } else {\n        sorted[n / 2]\n    }\n}\n";
        let f = one("rust", "a.rs", src, "median_sorted");
        assert_eq!(
            f.param_to_return,
            vec!["sorted"],
            "if/else 尾表达式里的索引读取要算返回流"
        );
        assert!(f.propagates());
    }

    #[test]
    fn rust_tail_block_expression_is_a_return() {
        let src = "fn pick(v: i32) -> i32 {\n    {\n        v * 2\n    }\n}\n";
        let f = one("rust", "a.rs", src, "pick");
        assert_eq!(f.param_to_return, vec!["v"]);
    }

    #[test]
    fn rust_trailing_if_in_unit_function_is_not_a_return() {
        // 无返回类型 = 返回 unit，块尾的 `if` 只是控制流，不能算「形参流向返回值」
        let src = "fn maybe_log(flag: bool, msg: &str) {\n    if flag {\n        println!(\"{}\", msg);\n    }\n}\n";
        let f = one("rust", "a.rs", src, "maybe_log");
        assert!(
            f.param_to_return.is_empty(),
            "unit 函数没有返回值可承载形参"
        );
        assert!(!f.propagates(), "只在条件里打日志的函数仍应判为阻断");
    }

    #[test]
    fn rust_semicolon_terminated_tail_is_not_a_return() {
        // 带分号的块尾表达式是语句，不是返回值
        let src = "fn drain(items: Vec<i32>) {\n    consume(items);\n}\n";
        let f = one("rust", "a.rs", src, "drain");
        assert!(f.param_to_return.is_empty());
        assert!(!f.propagates());
    }

    // ---- 变异方法调用视同赋值 ----

    #[test]
    fn rust_collection_push_on_field_is_a_sink() {
        // 探针实例：BlockTable::add_block 不回传数据，但形参进了 self.blocks
        let src = "fn add_block(&mut self, name_idx: u32) {\n    self.blocks.push(BlockDef { name_idx });\n}\n";
        let f = one("rust", "a.rs", src, "add_block");
        assert!(f.has_sink(), "push 到字段上的容器等于写外部状态");
        assert!(f.sinks.iter().any(|s| s.contains("self.blocks")));
    }

    #[test]
    fn ts_map_set_on_member_is_a_sink() {
        let src = "function remember(key: string, val: string) {\n  this.cache.set(key, val);\n}\n";
        let f = one("typescript", "a.ts", src, "remember");
        assert!(f.has_sink());
        assert!(f.sinks.iter().any(|s| s.contains("this.cache")));
    }

    #[test]
    fn python_append_on_attribute_is_a_sink() {
        let src = "def keep(self, item):\n    self.items.append(item)\n";
        let f = one("python", "a.py", src, "keep");
        assert!(f.has_sink());
    }

    #[test]
    fn push_to_local_variable_is_not_a_sink() {
        // 局部累加器的写入已经由返回值体现，不该再记一笔外部写入，
        // 否则几乎所有 map/filter 风格的函数都会被算成 sink，剪枝直接归零
        let src = "fn double(items: Vec<i32>) -> Vec<i32> {\n    let mut out = Vec::new();\n    for i in items {\n        out.push(i * 2);\n    }\n    out\n}\n";
        let f = one("rust", "a.rs", src, "double");
        assert!(!f.has_sink(), "局部变量不是外部状态");
    }

    #[test]
    fn mutation_without_param_arg_is_not_a_sink() {
        let src =
            "fn touch(&mut self, flag: bool) {\n    self.log.push(String::from(\"hit\"));\n}\n";
        let f = one("rust", "a.rs", src, "touch");
        assert!(!f.has_sink(), "实参与形参无关，只是内部变更");
    }

    #[test]
    fn rust_out_param_push_is_a_sink() {
        // 探针实例：collect_coord 往 &mut Vec 出参里塞值，写入的是局部量，
        // 但调用方看得见 —— 形参本身就是通道
        let src = "fn collect(entity: &E, xs: &mut Vec<f64>) {\n    let x = entity.start.x;\n    xs.push(x);\n}\n";
        let f = one("rust", "a.rs", src, "collect");
        assert!(f.has_sink(), "出参写入是调用方可见的副作用");
        assert!(f.sinks.iter().any(|s| s.starts_with("xs.")));
    }

    #[test]
    fn ts_out_param_array_push_is_a_sink() {
        let src = "function fill(out: number[]) {\n  out.push(1);\n}\n";
        let f = one("typescript", "a.ts", src, "fill");
        assert!(f.has_sink());
    }

    #[test]
    fn non_mutating_method_call_is_not_a_sink() {
        let src = "fn check(&self, key: &str) -> bool {\n    self.map.contains_key(key)\n}\n";
        let f = one("rust", "a.rs", src, "check");
        assert!(!f.has_sink(), "只读方法不是写入点");
    }

    #[test]
    fn rust_field_write_is_a_sink() {
        let src = "fn set(&mut self, v: i32) {\n    self.value = v;\n}\n";
        let f = one("rust", "a.rs", src, "set");
        assert!(f.has_sink());
    }

    #[test]
    fn python_return_and_attribute_sink() {
        let src = "def norm(raw):\n    self.last = raw\n    return raw.strip()\n";
        let f = one("python", "a.py", src, "norm");
        assert_eq!(f.param_to_return, vec!["raw"]);
        assert!(f.has_sink());
    }

    #[test]
    fn python_side_effect_only_does_not_propagate() {
        let src = "def emit(evt):\n    bus.send(evt)\n";
        let f = one("python", "a.py", src, "emit");
        assert!(!f.propagates());
        assert!(f
            .param_to_call
            .iter()
            .any(|c| c.callee == "send" && c.param == "evt"));
    }

    #[test]
    fn nested_named_function_gets_its_own_summary() {
        let src = "function outer(a: number) {\n  function inner(b: number) { return b; }\n  return 1;\n}\n";
        let all = analyze_dataflow("typescript", "a.ts", src).unwrap();
        let names: Vec<&str> = all.functions.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"outer") && names.contains(&"inner"));
        let outer = all.functions.iter().find(|f| f.name == "outer").unwrap();
        assert!(
            outer.param_to_return.is_empty(),
            "内层函数的 return b 不该算到外层头上"
        );
    }

    #[test]
    fn unsupported_language_returns_none() {
        assert!(analyze_dataflow("go", "a.go", "func main() {}").is_none());
    }

    // ───────── FlowSemantic 语义表接线（对标 joern DefaultSemantics） ─────────

    #[test]
    fn sanitizer_call_is_encoded_as_block() {
        // `escapeHtml` 在语义表里是 Block → 整链判定为「已净化」，携带决定性调用名
        let src = "function render(req) {\n  res.write(escapeHtml(req.body));\n}\n";
        let f = one("typescript", "a.ts", src, "render");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "write")
            .unwrap();
        assert_eq!(flow.sem, "block:escapeHtml", "净化调用必须落在 sem 上");
        assert_eq!(flow.via, vec!["escapeHtml"]);
    }

    #[test]
    fn pure_transform_is_encoded_as_pass() {
        // `trim` 是 PassThrough → 明确「不净化」，历史正则本来就判不中它，
        // 语义表把它钉死，避免将来有人往黑名单里塞 trim 之类的纯变换
        let src = "function render(req) {\n  res.write(req.body.trim());\n}\n";
        let f = one("typescript", "a.ts", src, "render");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "write")
            .unwrap();
        assert_eq!(flow.sem, "pass");
    }

    #[test]
    fn normalize_is_not_a_sanitizer() {
        // 本轮核心修正：历史正则把 normalize 当净化器，
        // `const p = path.normalize(req.params.p); fs.readFileSync(p)` 整条漏报。
        let src = "function read(req) {\n  const p = path.normalize(req.params.p);\n  fs.readFileSync(p);\n}\n";
        let f = one("typescript", "a.ts", src, "read");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "readFileSync")
            .unwrap();
        assert_eq!(flow.via, vec!["normalize"]);
        assert_eq!(flow.sem, "pass", "path.normalize 必须不再被当成净化器");
    }

    #[test]
    fn unknown_chain_stays_empty_for_zero_regression() {
        // 语义表查不到 → sem 为空 → 前端回退历史正则，行为与改动前完全一致
        let src = "function save(req) {\n  repo.persist(req.payload);\n}\n";
        let f = one("typescript", "a.ts", src, "save");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "persist")
            .unwrap();
        assert_eq!(flow.sem, "");
    }

    #[test]
    fn sanitizer_anywhere_in_via_vetoes_the_chain() {
        // const v = escapeHtml(req.body); const t = v.trim(); res.write(t);
        // 求值链 = [escapeHtml, trim]，任一环净化即整链净化
        let src = "function render(req) {\n  const v = escapeHtml(req.body);\n  const t = v.trim();\n  res.write(t);\n}\n";
        let f = one("typescript", "a.ts", src, "render");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "write")
            .unwrap();
        assert_eq!(flow.sem, "block:escapeHtml");
    }

    #[test]
    fn rust_to_string_is_pass_through() {
        // 真实仓库探针里 to_string 是 Rust 侧频次最高的中间调用。
        // （用普通方法调用而非 println! —— 宏的实参在 token_tree 而非 arguments 字段上）
        let src = "fn log(name: &str, logger: &Logger) {\n    let s = name.to_string();\n    logger.write(&s);\n}\n";
        let f = one("rust", "a.rs", src, "log");
        let flow = f
            .param_to_call
            .iter()
            .find(|c| c.callee == "write")
            .unwrap();
        assert_eq!(flow.via, vec!["to_string"]);
        assert_eq!(flow.sem, "pass");
    }

    #[test]
    fn json_stringify_is_pass_through() {
        // 序列化不改变污染性质（joern 的 PassThroughMapping 语义）
        let src = "function send(payload) {\n  http.post(JSON.stringify(payload));\n}\n";
        let f = one("typescript", "a.ts", src, "send");
        let flow = f.param_to_call.iter().find(|c| c.callee == "post").unwrap();
        assert_eq!(flow.sem, "pass");
    }

    #[test]
    fn syntax_error_still_yields_partial_summary() {
        let src = "function f(a: number) { if (a { return a; }\n";
        let r = analyze_dataflow("typescript", "a.ts", src);
        assert!(r.is_some(), "带语法错误也要给出部分结果");
    }

    /// 真实仓库探针（默认不跑，需显式 --ignored）
    ///
    /// 上面的单测证明的是「语法结构能不能识别」，这个探针证明的是
    /// 「在真实代码上结论合不合理」。R36 剪枝的全部价值押在一个经验假设上：
    /// 真实项目里「吃进去不吐出来」的函数占比足够高。假设不验证，剪枝就是拍脑袋。
    ///
    ///   cargo test --lib dataflow::tests::probe -- --ignored --nocapture
    #[test]
    #[ignore = "真实仓库探针，按需手动运行"]
    fn probe_real_repository() {
        use std::collections::HashMap;
        use std::path::{Path, PathBuf};

        fn lang_of(p: &Path) -> Option<&'static str> {
            match p.extension().and_then(|e| e.to_str())? {
                "ts" | "tsx" => Some("typescript"),
                "js" | "jsx" | "mjs" => Some("javascript"),
                "rs" => Some("rust"),
                "py" => Some("python"),
                _ => None,
            }
        }
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else {
                return;
            };
            for e in rd.flatten() {
                let p = e.path();
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with('.') || n == "node_modules" || n == "target" || n == "dist" {
                    continue;
                }
                if p.is_dir() {
                    walk(&p, out);
                } else if lang_of(&p).is_some() {
                    out.push(p);
                }
            }
        }

        // src-tauri/ 是 CARGO_MANIFEST_DIR，前端源码在其上一级的 src/
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut files = Vec::new();
        walk(&root.join("src"), &mut files);
        if let Some(parent) = root.parent() {
            walk(&parent.join("src"), &mut files);
        }

        let (mut parsed, mut fns, mut prop, mut blk, mut sinked) =
            (0usize, 0usize, 0usize, 0usize, 0usize);
        let mut gated = 0usize;
        let mut targets: HashMap<String, usize> = HashMap::new();
        let mut by_lang: HashMap<&str, (usize, usize)> = HashMap::new();
        let mut samples: Vec<String> = Vec::new();

        for f in &files {
            let lang = lang_of(f).unwrap();
            let Ok(src) = std::fs::read_to_string(f) else {
                continue;
            };
            let rel = f
                .strip_prefix(&root)
                .unwrap_or(f)
                .to_string_lossy()
                .to_string();
            let Some(flow) = analyze_dataflow(lang, &rel, &src) else {
                continue;
            };
            parsed += 1;
            for func in &flow.functions {
                fns += 1;
                let e = by_lang.entry(lang).or_insert((0, 0));
                e.0 += 1;
                if func.propagates() {
                    prop += 1;
                } else {
                    blk += 1;
                    e.1 += 1;
                    // 前端闸门只剪「既不回传、也不写外部状态」的函数：
                    // setter 走堆这条出口，剪掉会漏报（见 impactChain.buildFlowGate）
                    if !func.has_sink() {
                        gated += 1;
                        if samples.len() < 10 && !func.params.is_empty() {
                            samples.push(format!(
                                "  {}:{} {}({})",
                                rel,
                                func.line,
                                func.name,
                                func.params.join(", ")
                            ));
                        }
                    }
                }
                if func.has_sink() {
                    sinked += 1;
                    for s in &func.sinks {
                        *targets.entry(s.clone()).or_insert(0usize) += 1;
                    }
                }
            }
        }

        assert!(parsed > 0, "探针至少要解析出一个文件");
        let pct = |n: usize| n as f64 / fns.max(1) as f64 * 100.0;
        println!("\n── 数据流摘要探针 ──────────────────────────");
        println!(
            "候选文件 {} · 成功解析 {} · 函数 {}",
            files.len(),
            parsed,
            fns
        );
        println!("  透传 conduit {:>6} ({:.1}%)", prop, pct(prop));
        println!("  阻断 blocker {:>6} ({:.1}%)", blk, pct(blk));
        println!("  含 sink      {:>6} ({:.1}%)", sinked, pct(sinked));
        println!(
            "  实际可剪     {:>6} ({:.1}%)  ← 剪枝收益来源（阻断且不写外部状态）",
            gated,
            pct(gated)
        );

        let mut langs: Vec<_> = by_lang.into_iter().collect();
        langs.sort_by_key(|(_, v)| std::cmp::Reverse(v.0));
        println!("\n分语言阻断占比:");
        for (l, (t, b)) in langs {
            println!(
                "  {:<12} {:>6} 个函数, 阻断 {:>5} ({:.1}%)",
                l,
                t,
                b,
                b as f64 / t.max(1) as f64 * 100.0
            );
        }

        let mut ts: Vec<_> = targets.into_iter().collect();
        ts.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        println!("\n写得最多的外部状态 Top 10:");
        for (t, c) in ts.iter().take(10) {
            println!("  {:<44} {}", t, c);
        }
        println!("\n阻断函数样例（其调用方在影响链里会被剪掉）:");
        for s in &samples {
            println!("{}", s);
        }
        let ratio = pct(gated);
        println!(
            "\n结论：实际可剪占比 {:.1}% —— {}\n",
            ratio,
            if ratio >= 30.0 {
                "剪枝收益显著，R36 经验假设成立"
            } else if ratio >= 15.0 {
                "剪枝有效但收益中等"
            } else {
                "剪枝收益有限，需复核摘要判定是否过于保守"
            }
        );
    }

    /// 局部变量展开回放探针（默认不跑，需显式 --ignored）
    ///
    /// 单测证明的是「语法结构能不能识别」，这个探针证明的是「在真实代码上
    /// 收益有多大、有没有过近似」。关心两件事：
    ///
    /// ① 经局部量/接收者展开出来的流占多少 —— 太少说明能力没落地，
    ///    这一整片此前是完全不可见的；
    /// ② via 里频次最高的中间调用是什么 —— 若混入大量 `String` / `Number`
    ///    之类无害包装，说明过近似，需要收紧名单。
    ///
    ///   cargo test --lib dataflow::tests::probe_local_var_expansion -- --ignored --nocapture
    #[test]
    #[ignore = "真实仓库探针，按需手动运行"]
    fn probe_local_var_expansion() {
        use std::path::{Path, PathBuf};

        fn lang_of(p: &Path) -> Option<&'static str> {
            match p.extension().and_then(|e| e.to_str())? {
                "ts" | "tsx" => Some("typescript"),
                "js" | "jsx" | "mjs" => Some("javascript"),
                "rs" => Some("rust"),
                "py" => Some("python"),
                _ => None,
            }
        }
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else {
                return;
            };
            for e in rd.flatten() {
                let p = e.path();
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with('.') || n == "node_modules" || n == "target" || n == "dist" {
                    continue;
                }
                if p.is_dir() {
                    walk(&p, out);
                } else if lang_of(&p).is_some() {
                    out.push(p);
                }
            }
        }

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut files = Vec::new();
        walk(&root.join("src"), &mut files);
        if let Some(parent) = root.parent() {
            walk(&parent.join("src"), &mut files);
        }

        let (mut fns, mut total_flows, mut via_flows) = (0usize, 0usize, 0usize);
        let mut via_counter: HashMap<String, usize> = HashMap::new();
        let mut longest: Vec<(usize, String, String, i64, Vec<String>)> = Vec::new();

        for f in &files {
            let lang = lang_of(f).unwrap();
            let Ok(src) = std::fs::read_to_string(f) else {
                continue;
            };
            let rel = f
                .strip_prefix(&root)
                .unwrap_or(f)
                .to_string_lossy()
                .to_string();
            let Some(flow) = analyze_dataflow(lang, &rel, &src) else {
                continue;
            };
            for func in &flow.functions {
                fns += 1;
                for c in &func.param_to_call {
                    total_flows += 1;
                    if c.via.is_empty() {
                        continue;
                    }
                    via_flows += 1;
                    for v in &c.via {
                        *via_counter.entry(v.clone()).or_insert(0usize) += 1;
                    }
                    longest.push((
                        c.via.len(),
                        rel.clone(),
                        func.name.clone(),
                        c.line,
                        c.via.clone(),
                    ));
                }
            }
        }

        assert!(fns > 0, "探针至少要解析出一个函数");
        let pct = |n: usize| n as f64 / total_flows.max(1) as f64 * 100.0;
        println!("\n── 局部变量展开探针（对标 joern 到达定义） ──────────");
        println!("函数 {} · 流边总数 {}", fns, total_flows);
        println!(
            "  经局部量/接收者展开的流 {:>6} ({:.1}%)  ← 此前这一整片完全不可见",
            via_flows,
            pct(via_flows)
        );

        let mut top: Vec<_> = via_counter.into_iter().collect();
        top.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        println!("\n中间调用 Top 20（过近似信号：混入大量无害包装说明要收紧）:");
        for (v, c) in top.iter().take(20) {
            println!("  {:<36} {}", v, c);
        }

        longest.sort_by_key(|x| std::cmp::Reverse(x.0));
        println!("\n最长展开链样例 Top 10:");
        for (n, rel, name, line, via) in longest.iter().take(10) {
            println!("  链长 {} · {}:{} {} · via={:?}", n, rel, line, name, via);
        }
        println!();
    }
}
