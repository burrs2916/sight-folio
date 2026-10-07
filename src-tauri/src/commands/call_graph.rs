//! 函数调用图：把「文件依赖」下沉到「函数调用」粒度
//!
//! 需求文档要求分析「代码之间的引用」。已有两层：
//! 1. project_dependencies —— A.ts import B.ts（模块耦合）
//! 2. project_symbol_refs —— A.ts 第 12 行 import 了 B.ts 的 Foo（符号耦合）
//!
//! 但这两层都停在 import 语句上，回答不了工程上最常问的两个问题：
//! - **改这个函数会炸到谁？**（反向：找 callee 的所有 caller）
//! - **这个函数到底干了多少事？**（正向：出度，编排层往往出度极高）
//!
//! 本模块用「符号行区间归属 + 标识符调用点扫描 + import 表消歧」构建调用边：
//! 1. 每个文件按 line_start..line_end 建立符号区间，确定某一行属于哪个函数（caller）
//! 2. 逐行扫描 `identifier(` 形式的调用点，跳过关键字与声明行
//! 3. callee 解析优先级：接收者声明类型成员 > 本文件同名符号（internal）> 该文件 import
//!    进来的同名符号（cross-file，用 project_symbol_refs 消歧）> 全局唯一同名符号
//!    > **Naive 兜底层**（同名歧义时按「同目录唯一 / 调用形态种类唯一」消歧，
//!      对标 joern `NaiveCallLinker`）。
//!
//! 这是**基于文本的近似解析**，不做类型推导，因此：
//! - 动态调用、高阶函数传递会漏
//! - 只在「有同名候选且经强过滤后恰好唯一」时才连边，避免凭空造边
//! Naive 层之前的策略是「歧义即丢弃」；回放实测这会丢掉 4428 个调用点（当时可解析量
//! 仅 3917 个），故改为 joern 式的保守兜底——但**不照搬其「全候选全连」**（平均 8.7~14
//! 个候选会撑爆 MAX_EDGES 并稀释精度），降级为「强过滤后恰好唯一才连」。
//! 换来的是零额外依赖、毫秒级增量、对任何语言都能跑。

use crate::domain::project_call_edges::{CallEdge, CallGraphSummary, CallHotspot};
use crate::domain::project_files::ProjectFile;
use crate::domain::project_symbol_refs::SymbolRef;
use crate::domain::project_symbols::ProjectSymbol;
use crate::error::AppResult;
use crate::infrastructure::database::project_call_edge_repository::ProjectCallEdgeRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_symbol_ref_repository::ProjectSymbolRefRepository;
use crate::infrastructure::database::project_symbol_repository::ProjectSymbolRepository;
use crate::infrastructure::database::{
    SqliteProjectCallEdgeRepository, SqliteProjectFileRepository, SqliteProjectSymbolRefRepository,
    SqliteProjectSymbolRepository,
};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tree_sitter::{Node, Parser};
use tree_sitter_rust;

/// 跨语言 AST 调用提取：依方言选 tree-sitter grammar 并解析接收者（对标 joern 各 frontend 的 CALL.receiver）。
use crate::infrastructure::ast::{dialect_for, Dialect};

/// 边数上限：超大仓库全量调用边会拖垮画布与 IPC，截断后仍足够画热点
const MAX_EDGES: usize = 40_000;

/// 控制流 / 声明关键字：`if (` `for (` 这类不是函数调用
const KEYWORDS: [&str; 34] = [
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "match",
    "with",
    "do",
    "else",
    "function",
    "fn",
    "def",
    "class",
    "struct",
    "impl",
    "enum",
    "trait",
    "interface",
    "typeof",
    "instanceof",
    "await",
    "yield",
    "new",
    "super",
    "this",
    "self",
    "in",
    "of",
    "as",
    "and",
    "or",
    "not",
    "lambda",
];

/// 可作为被调方的符号种类
fn is_callable(kind: &str) -> bool {
    matches!(kind, "function" | "method" | "class" | "struct")
}

/// 可作为调用方（有函数体的符号）
fn is_caller_kind(kind: &str) -> bool {
    matches!(kind, "function" | "method" | "class" | "impl")
}

/// 可作为「类型/容器」的符号种类（类、结构体、接口、trait、枚举、模块、命名空间等）。
/// 用于接收者感知解析：`this.foo()` 解析到 caller 所处类型的成员。
fn is_type_kind(kind: &str) -> bool {
    matches!(
        kind,
        "class"
            | "struct"
            | "interface"
            | "trait"
            | "enum"
            | "impl"
            | "object"
            | "module"
            | "namespace"
            | "type_alias"
            | "union"
    )
}

/// 可作为被调方方法的符号种类。
fn is_method_like(kind: &str) -> bool {
    matches!(kind, "method" | "function" | "constructor")
}

/// 取包含符号 `s` 的最内层类型/容器符号（行区间嵌套，取最小范围）。
fn enclosing_type<'a>(
    type_syms: &[&'a ProjectSymbol],
    s: &ProjectSymbol,
) -> Option<&'a ProjectSymbol> {
    let mut best: Option<&ProjectSymbol> = None;
    for t in type_syms {
        if t.id == s.id {
            continue;
        }
        if s.line_start >= t.line_start && s.line_end <= t.line_end {
            match best {
                Some(b) if (b.line_end - b.line_start) <= (t.line_end - t.line_start) => {}
                _ => best = Some(t),
            }
        }
    }
    best
}

/// 接收者感知解析所需的索引集合（对标 joern DynamicCallLinker/StaticCallLinker：
/// 把 CALL 解析到接收者声明类型的成员，而非仅按名匹配）。
struct CallResolutionCtx<'a> {
    /// (file_id, 类型名) -> 类型符号
    type_by_name: HashMap<(String, String), &'a ProjectSymbol>,
    /// 类型符号 id -> 其内嵌套的可调用成员
    methods_by_type_id: HashMap<String, Vec<&'a ProjectSymbol>>,
    /// file_id -> 该文件的类型/容器符号
    type_syms_by_file: HashMap<String, Vec<&'a ProjectSymbol>>,
    /// (file_id, Rust impl 类型名) -> 该 impl 块内的方法符号
    rust_impl_methods: HashMap<(String, String), Vec<&'a ProjectSymbol>>,
    /// (file_id, Rust 方法起始行) -> 该方法的 impl 类型名（用于 self 解析）
    rust_caller_impl: HashMap<(String, i64), String>,
    /// (file_id, Go 接收者类型名) -> 该类型的方法符号。
    /// 对标 joern gosrc2cpg：`func (r Type) Name` 建 `(Type, Name)` 索引，调用按 `(type, name)` 查方法。
    go_method_by_type: HashMap<(String, String), Vec<&'a ProjectSymbol>>,
    /// (file_id, caller 方法起始行) -> (接收者形参名, 接收者声明类型)。
    /// 用于 `r.Method()` 解析：仅当调用接收者名等于 caller 自身接收者名时按类型锁定，对标 joern `receiverTypeFullName`。
    go_caller_receiver: HashMap<(String, i64), (String, String)>,
    /// (file_id, Go 方法起始行) -> 其接收者声明类型名。
    /// Go 方法不嵌套于类型符号（Go 无 class），用于 `callee_receiver_type` 补全影响面板限定名。
    go_method_owner_type: HashMap<(String, i64), String>,
}

/// 接收者感知的被调解析：优先把方法调用解析到接收者声明类型的成员。
///
/// - `this.foo()` / `self.foo()` / `cls.foo()` 等自引用：解析到 caller 所处类型/impl 的成员。
/// - `Type.foo()` / `Type::foo()` / `ns::foo()` 等类型/模块限定：解析到该类型/模块内的成员。
///
/// 仅在能唯一锁定「接收者类型上的同名成员」时返回，否则返回 None 交回名匹配回退。
fn resolve_receiver_target<'a>(
    ctx: &CallResolutionCtx<'a>,
    name: &str,
    receiver: &str,
    caller: &ProjectSymbol,
    file_id: &str,
) -> Option<&'a ProjectSymbol> {
    if receiver.is_empty() {
        return None;
    }
    let is_self = matches!(receiver, "this" | "self" | "me" | "Self" | "THIS" | "cls");
    if is_self {
        // OOP：解析到 caller 所处类型的成员
        let type_syms: &[&ProjectSymbol] = match ctx.type_syms_by_file.get(file_id) {
            Some(v) => v.as_slice(),
            None => &[],
        };
        if let Some(t) = enclosing_type(type_syms, caller) {
            if let Some(ms) = ctx.methods_by_type_id.get(&t.id) {
                if let Some(m) = ms.iter().copied().find(|m| m.name == name) {
                    return Some(m);
                }
            }
        }
        // Rust：`impl Type` 内的 self 方法（symbol 表不产出 impl 符号，单独建索引）
        if let Some(tname) = ctx
            .rust_caller_impl
            .get(&(file_id.to_string(), caller.line_start))
        {
            if let Some(ms) = ctx
                .rust_impl_methods
                .get(&(file_id.to_string(), tname.clone()))
            {
                if let Some(m) = ms.iter().copied().find(|m| m.name == name) {
                    return Some(m);
                }
            }
        }
        return None;
    }
    // 静态分发：接收者是类型/模块名
    if let Some(t) = ctx
        .type_by_name
        .get(&(file_id.to_string(), receiver.to_string()))
    {
        if let Some(ms) = ctx.methods_by_type_id.get(&t.id) {
            if let Some(m) = ms.iter().copied().find(|m| m.name == name) {
                return Some(m);
            }
        }
    }
    // Rust 静态分发 `Type::method()`
    if let Some(ms) = ctx
        .rust_impl_methods
        .get(&(file_id.to_string(), receiver.to_string()))
    {
        if let Some(m) = ms.iter().copied().find(|m| m.name == name) {
            return Some(m);
        }
    }
    // Go 接收者方法调用：`r.Method()` 其中 r 是 caller 自身接收者形参。
    // 对标 joern gosrc2cpg：`receiverTypeFullName = 接收者声明类型`，按 `(type, name)` 查方法。
    // 仅当调用接收者名等于 caller 接收者名时按类型锁定，避免误解析其它同名局部变量。
    if let Some((rname, rtype)) = ctx
        .go_caller_receiver
        .get(&(file_id.to_string(), caller.line_start))
    {
        if rname == receiver {
            if let Some(ms) = ctx
                .go_method_by_type
                .get(&(file_id.to_string(), rtype.clone()))
            {
                if let Some(m) = ms.iter().copied().find(|m| m.name == name) {
                    return Some(m);
                }
            }
        }
    }
    None
}

/// 被调方解析到的「接收者声明类型名」（对标 joern `CALL.methodFullName` 的声明接收者类型）。
///
/// joern 在动态分派下会把单个 `this.foo()` 解析为**全部**候选方法（超近似），其影响面视图
/// 无法区分「`this.foo()` 究竟落在 ClassA 还是 ClassB」。这里在可唯一锁定声明类型时给出精确
/// 类型名，供影响面画像按接收者类型区分同名方法——把 our 的精度优势落到可见特征上。
///
/// 入参 `callee` 是已经解析出的被调符号（无论是接收者感知锁定的、还是名匹配回退的），
/// 只要它是某个类型的成员方法，就返回其 enclosing 类型名；裸函数/游离常量返回空串。
fn callee_receiver_type<'a>(ctx: &CallResolutionCtx<'a>, callee: &ProjectSymbol) -> String {
    // OOP：方法嵌套于类型符号 → enclosing 类型名
    if let Some(ts) = ctx.type_syms_by_file.get(&callee.file_id) {
        if let Some(t) = enclosing_type(ts.as_slice(), callee) {
            return t.name.clone();
        }
    }
    // Go：方法不嵌套于类型符号（Go 无 class），用接收者声明类型补全影响面板限定名。
    if let Some(t) = ctx
        .go_method_owner_type
        .get(&(callee.file_id.clone(), callee.line_start))
    {
        return t.clone();
    }
    String::new()
}

/// 解析 Rust `impl Type { fn method... }` 块，建立「impl 类型名 ↔ 方法符号」双向索引，
/// 用于 Rust 的 `self.method()` 与 `Type::method()` 接收者感知解析（symbol 表不产出 impl 符号，
/// 故方法不嵌套于任何类型符号内，需独立建索引）。
fn collect_rust_impl_associations<'a>(
    content: &str,
    file_id: &str,
    file_syms: &[&'a ProjectSymbol],
) -> (
    HashMap<(String, String), Vec<&'a ProjectSymbol>>,
    HashMap<(String, i64), String>,
) {
    let mut methods: HashMap<(String, String), Vec<&'a ProjectSymbol>> = HashMap::new();
    let mut caller_impl: HashMap<(String, i64), String> = HashMap::new();
    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_rust::LANGUAGE.into())
        .is_err()
    {
        return (methods, caller_impl);
    }
    let Some(tree) = parser.parse(content, None) else {
        return (methods, caller_impl);
    };
    let src = content.as_bytes();
    // 收集所有 impl_item 节点
    let mut impl_nodes = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(node) = stack.pop() {
        if node.kind() == "impl_item" {
            impl_nodes.push(node);
        }
        let mut c = node.child(0);
        while let Some(ch) = c {
            stack.push(ch);
            c = ch.next_sibling();
        }
    }
    for impl_node in impl_nodes {
        let type_node = impl_node.child_by_field_name("type");
        let type_name = type_node
            .map(|n| {
                let t = n.utf8_text(src).unwrap_or("");
                // 取首标识符：`Foo<T>`→Foo、`Box<Foo>`→Box
                t.chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                    .collect::<String>()
            })
            .unwrap_or_default();
        if type_name.is_empty() {
            continue;
        }
        // 收集 impl 块内所有 function_item（方法）
        let mut q = vec![impl_node];
        while let Some(n) = q.pop() {
            if n.kind() == "function_item" {
                if let Some(name_node) = n.child_by_field_name("name") {
                    let mname = name_node.utf8_text(src).unwrap_or("").to_string();
                    let line = n.start_position().row + 1;
                    for sym in file_syms {
                        let s = *sym;
                        if s.name == mname && s.line_start == line as i64 && is_method_like(&s.kind)
                        {
                            methods
                                .entry((file_id.to_string(), type_name.clone()))
                                .or_default()
                                .push(s);
                            caller_impl
                                .insert((file_id.to_string(), line as i64), type_name.clone());
                            break;
                        }
                    }
                }
            }
            let mut c = n.child(0);
            while let Some(ch) = c {
                q.push(ch);
                c = ch.next_sibling();
            }
        }
    }
    (methods, caller_impl)
}

/// 解析 Go `func (r Type) Name(` / `func (r *Type) Name(` 接收者声明，建立接收者感知索引
/// （对标 joern gosrc2cpg：`func (r Type) Name` → CALL 的 `receiverTypeFullName = Type`，按 `(Type, Name)` 查方法）。
///
/// 返回：
/// - `go_method_by_type`: (file_id, 接收者类型名) -> 该类型的方法符号（指针接收者 `*Type` 去 `*`）。
/// - `go_caller_receiver`: (file_id, caller 方法起始行) -> (接收者形参名, 接收者类型名)。
/// - `go_method_owner_type`: (file_id, 方法起始行) -> 其接收者类型名（供影响面板限定名展示）。
///
/// 仅覆盖 caller 自身接收者（`r.Method()` 这类主导 Go 惯用法）；任意局部变量 `var→type`
/// （如 `other.Method()`）属 var→type 全量解析，明确 deferred（待续「远期」）。
fn collect_go_receiver_associations<'a>(
    content: &str,
    file_id: &str,
    file_syms: &[&'a ProjectSymbol],
) -> (
    HashMap<(String, String), Vec<&'a ProjectSymbol>>,
    HashMap<(String, i64), (String, String)>,
    HashMap<(String, i64), String>,
) {
    let mut method_by_type: HashMap<(String, String), Vec<&'a ProjectSymbol>> = HashMap::new();
    let mut caller_receiver: HashMap<(String, i64), (String, String)> = HashMap::new();
    let mut owner_type: HashMap<(String, i64), String> = HashMap::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        // `func (r *Type) Name(` 或 `func (r Type) Name(`
        let rest = match line.strip_prefix("func") {
            Some(r) => r.trim_start(),
            None => continue,
        };
        if !rest.starts_with('(') {
            continue; // 自由函数无接收者
        }
        let close = match rest.find(')') {
            Some(c) => c,
            None => continue,
        };
        let recv = rest[1..close].trim();
        if recv.is_empty() {
            continue;
        }
        // 接收者形如 `r *Store` / `r Store` / `r *pkg.Store`
        let mut it = recv.split_whitespace();
        let recv_name = it.next().unwrap_or("");
        let recv_type_full = it.next().unwrap_or("");
        if recv_name.is_empty() || recv_type_full.is_empty() {
            continue;
        }
        // 去指针前缀（joern `.stripPrefix("*")` 同口径）
        let recv_type = recv_type_full.trim_start_matches('*');
        if recv_type.is_empty() {
            continue;
        }
        // 接收者括号后的方法名：`Get(` / `Get[T any](`
        let after = &rest[close + 1..];
        let method_name = after
            .trim_start()
            .split(|c| matches!(c, '(' | '<' | ' ' | '\t'))
            .next()
            .unwrap_or("")
            .trim();
        if method_name.is_empty()
            || !method_name
                .chars()
                .next()
                .map(|c| c.is_ascii_alphabetic() || c == '_')
                .unwrap_or(false)
        {
            continue;
        }
        let line_no = (i + 1) as i64;
        for s in file_syms {
            if s.name == method_name && s.line_start == line_no && s.kind == "method" {
                method_by_type
                    .entry((file_id.to_string(), recv_type.to_string()))
                    .or_default()
                    .push(*s);
                caller_receiver.insert(
                    (file_id.to_string(), line_no),
                    (recv_name.to_string(), recv_type.to_string()),
                );
                owner_type.insert((file_id.to_string(), line_no), recv_type.to_string());
                break;
            }
        }
    }
    (method_by_type, caller_receiver, owner_type)
}

/// 通配（整模块）导入索引：把 `use crate::foo::*;` 这类**未点名**的导入，
/// 展开成「该文件可见的符号名 → 符号」，供调用图 `imported` 层之后兜底查询。
///
/// # 对标 joern
///
/// `JavaScriptImportResolverPass.scala:49`：
/// `val isImportingModule = !entity.contains(pathSep)`，命中时 `:71-76` 原文
/// *"If we are importing the whole module, we need to load all entities"* ——
/// 整模块/通配导入要**枚举目标模块的全部导出实体**，而非只解析点名的那几个名字。
///
/// # 我们的弱项（实测）
///
/// `use crate::foo::*;` / `use super::*;`（`#[cfg(test)] mod tests` 的标配写法）在
/// `project_symbol_refs` 里产出的是 `symbol_name` 为空的行 → `to_symbol_id` 恒 None
/// → `imported` 层**一个名字都查不到** → 这些调用全部退化到全局同名匹配，
/// 遇到同名歧义即丢边。本仓 55 处 `use ...::*;`，webcraft-server 实测 39 条空名行。
///
/// # 刻意保守（与 Naive 兜底同口径，宁可不连也不连错）
///
/// - **只登记全局恰好唯一的名字**：BFS 收养到的同名候选若不止一个，整名丢弃；
/// - BFS 深度上限 `GLOB_MAX_DEPTH` 且带访问集防环（`mod.rs` 互相 `pub use`）；
/// - 纯内存索引，不写库、不改 schema、不动前端。
///
/// # 收养三路（实测决定的，见下）
///
/// 只沿「通配再导出」下钻在本仓实测收益为 **0**——因为 `mod.rs` 用的是**点名**再导出
/// （`pub use cache::pool::RedisPool;`），mod.rs 自身一个符号都不定义。故按 joern
/// 「load **all** entities」的原意，三路全收：
///   1. 模块文件**自身定义**的符号；
///   2. 模块文件**点名 re-export 且已解析**的符号（直接复用 `project_symbol_refs` 里
///      `resolve_symbol_via_reexports` 的既有成果，不重复实现路径解析）；
///   3. 模块文件**通配 re-export** 指向的模块（递归下钻）。
fn build_glob_import_index<'a>(
    refs: &[SymbolRef],
    by_file: &HashMap<String, Vec<&'a ProjectSymbol>>,
    by_id: &HashMap<&str, &'a ProjectSymbol>,
    file_id_by_rel: &HashMap<&str, &str>,
    file_by_rel: &HashMap<String, &ProjectFile>,
    cache: &crate::commands::project_scan::ScanContentCache,
) -> HashMap<(String, String), &'a ProjectSymbol> {
    const GLOB_MAX_DEPTH: usize = 3;
    let mut out: HashMap<(String, String), &'a ProjectSymbol> = HashMap::new();

    // refs 预分桶：(from_file_id, name) → symbol_id，以及 from_file_id → 通配目标模块
    let mut named_refs: HashMap<(String, String), String> = HashMap::new();
    let mut glob_refs: HashMap<String, Vec<String>> = HashMap::new();
    for r in refs {
        if r.kind != "import" {
            continue;
        }
        if r.symbol_name.is_empty() {
            if !r.to_file_path.is_empty() {
                glob_refs
                    .entry(r.from_file_id.clone())
                    .or_default()
                    .push(r.to_file_path.clone());
            }
        } else if let Some(sid) = &r.to_symbol_id {
            named_refs.insert((r.from_file_id.clone(), r.symbol_name.clone()), sid.clone());
        }
    }
    // 入口 = 消费方自己的通配导入（`use crate::foo::*;`）
    let mut glob_targets: HashMap<String, Vec<String>> = HashMap::new();
    for r in refs {
        if r.kind == "import" && r.symbol_name.is_empty() && !r.to_file_path.is_empty() {
            glob_targets
                .entry(r.from_file_id.clone())
                .or_default()
                .push(r.to_file_path.clone());
        }
    }
    if glob_targets.is_empty() {
        return out;
    }

    let mut name_candidates: HashMap<String, Vec<&'a ProjectSymbol>> = HashMap::new();
    for (consumer_id, modules) in glob_targets {
        name_candidates.clear();
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: Vec<(String, usize)> = modules.iter().map(|m| (m.clone(), 0usize)).collect();
        while let Some((rel, depth)) = queue.pop() {
            if depth >= GLOB_MAX_DEPTH || !visited.insert(rel.clone()) {
                continue;
            }
            let Some(fid) = file_id_by_rel.get(rel.as_str()) else {
                continue;
            };
            // ① 模块自身定义的符号
            if let Some(syms) = by_file.get(*fid) {
                for s in syms {
                    if is_callable(&s.kind) {
                        name_candidates.entry(s.name.clone()).or_default().push(s);
                    }
                }
            }
            // ② 模块点名 re-export 且已解析的符号（复用既有 re-export 链成果，
            //    不重复实现模块路径解析 —— 单一真相源）
            for ((owner_fid, name), sid) in named_refs.iter() {
                if owner_fid != fid {
                    continue;
                }
                if let Some(sym) = by_id.get(sid.as_str()) {
                    if is_callable(&sym.kind) && sym.name == *name {
                        name_candidates.entry(name.clone()).or_default().push(sym);
                    }
                }
            }
            // ③ 沿模块的通配 re-export 下钻
            for next in glob_refs.get(*fid).cloned().unwrap_or_default() {
                if file_id_by_rel.contains_key(next.as_str()) {
                    queue.push((next, depth + 1));
                }
            }
            // 兜底：refs 里没有通配记录时（如增量未重算该文件），直接扫源码
            if !glob_refs.contains_key(*fid) {
                if let (Some(f), Some(lang)) = (
                    file_by_rel.get(&rel),
                    file_by_rel
                        .get(&rel)
                        .and_then(|f| f.language.as_deref())
                        .map(|l| l.to_string()),
                ) {
                    if let Some(content) = cache.read(f) {
                        for imp in
                            crate::commands::code_structure::reexport_imports_for(&lang, &content)
                        {
                            if !imp.symbols.is_empty() {
                                continue;
                            }
                            let cands = if lang == "typescript" || lang == "javascript" {
                                crate::commands::code_structure::ts_module_candidates(
                                    &rel, &imp.path,
                                )
                            } else {
                                crate::commands::code_structure::module_ref_candidates(
                                    &lang, &rel, &imp.path,
                                )
                            };
                            for c in cands {
                                if file_id_by_rel.contains_key(c.as_str()) {
                                    queue.push((c, depth + 1));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
        // 只登记「恰好唯一」的名字（同名候选不止一个 → 整名丢弃）
        for (name, syms) in name_candidates.drain() {
            let mut uniq: Option<&'a ProjectSymbol> = None;
            let mut ambiguous = false;
            for s in syms {
                match uniq {
                    None => uniq = Some(s),
                    Some(u) if u.id == s.id => {}
                    _ => {
                        ambiguous = true;
                        break;
                    }
                }
            }
            if !ambiguous {
                if let Some(s) = uniq {
                    out.insert((consumer_id.clone(), name), s);
                }
            }
        }
    }
    out
}

/// Go **包名/别名限定调用**索引：`(文件 id, 包名/别名, 成员名) → 包内唯一同名可调用符号`。
///
/// # joern 对标（本函数的全部依据）
/// - `gosrc2cpg/astcreation/CommonCacheBuilder.scala:100-115`：逐条 import 登记
///   `aliasToNameSpaceMapping`——有别名用别名，无别名取导入路径**末段**
///   （`importedEntity.split("/").last`）。注释原话「As these alias could be different
///   for each file. Hence we maintain the cache at file level」→ 该映射是**文件级**的。
/// - `gosrc2cpg/astcreation/AstForMethodCallExpressionCreator.scala:122-147`：`pkg.Func()`
///   且 pkg 不是局部变量时（无 `Obj` 字段）走 `resolveAliasToFullName(alias)`，
///   再拼 `s"$fullNamespace.$methodName"`——**按包名限定**查成员，而非裸名全局匹配。
///
/// # 我们此前的缺陷（回放实证，非推断）
/// 调用解析链把 `pkg.Func()` 与裸调用同等对待：`imported` 层按**裸名**查
/// `import_map: (from_file_id, symbol_name) -> symbol`，且构造时无条件 `insert`
/// （后写覆盖先写）。同一文件导入的多个包若导出同名符号，**全部调用点 collapse 到最后一个包**：
///   - `golang.org/x/tools`：`static.CallGraph()` 与 `cha.CallGraph()` 双双连到
///     `go/callgraph/vta/vta.go:74`；`gatefs.New()` 与 `mapfs.New()` 双双连到
///     `godoc/vfs/zipfs/zipfs.go:246`；`checker.Run()` 连到 `unitchecker.go` 而非
///     `internal/checker/checker.go`。
///   - `golang.org/x/net`：`ipv4.NewPacketConn()` 连到 `ipv6/endpoint.go`。
/// 这是**跨包错连**——比漏连更糟：漏连用户看得到空缺，错连给出确定但错误的答案，
/// 影响面画像会据此画出一条指向错误包的影响链。
///
/// # 保守性（与 Naive 兜底层同口径）
/// 1. 只登记**该文件字面用到的** `pkg.Ident`（用量驱动，与 `extract_go_symbol_imports`
///    同口径），不按包名把整包符号铺开；
/// 2. 只登记**包内同名可调用符号恰好唯一**的条目（歧义即丢弃）；
/// 3. 目录候选复用 `go_module_candidates`（与抽取层**单一真相源**），但按**精确目录**
///    取文件（不用前缀匹配，避免把子包的符号算进来）。
/// 故本索引是**加法式**的：命中则优先，未命中完全退回既有链路，零召回损失。
fn build_go_pkg_call_index<'a>(
    files: &[ProjectFile],
    by_file: &HashMap<String, Vec<&'a ProjectSymbol>>,
    cache: &crate::commands::project_scan::ScanContentCache,
) -> HashMap<(String, String, String), &'a ProjectSymbol> {
    let mut out: HashMap<(String, String, String), &'a ProjectSymbol> = HashMap::new();

    // 目录 → 该目录下的文件 id（精确目录，非前缀）
    let mut dir_files: HashMap<&str, Vec<&str>> = HashMap::new();
    for f in files {
        if f.is_directory {
            continue;
        }
        dir_files
            .entry(dir_of(&f.rel_path))
            .or_default()
            .push(f.id.as_str());
    }
    if dir_files.is_empty() {
        return out;
    }

    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_go::LANGUAGE.into())
        .is_err()
    {
        return out;
    }

    for f in files {
        if f.is_directory {
            continue;
        }
        let is_go = f.language.as_deref() == Some("go") || f.rel_path.ends_with(".go");
        if !is_go {
            continue;
        }
        let Some(content) = cache.read(f) else {
            continue;
        };
        let Some(tree) = parser.parse(content.as_ref(), None) else {
            continue;
        };
        let src = content.as_bytes();
        let root = tree.root_node();

        // ── 第一遍（Go 包名限定索引）：import 规格 → (包名/别名, 导入路径) ──
        let mut specs: Vec<(String, String)> = Vec::new();
        // ── 第二遍：用量归集 → (包名/别名 → 被用到的成员名集合) ──
        let mut used: HashMap<String, HashSet<String>> = HashMap::new();
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "import_spec" {
                let path = n
                    .child_by_field_name("path")
                    .and_then(|p| p.utf8_text(src).ok())
                    .map(|s| s.trim_matches('"').to_string())
                    .unwrap_or_default();
                if !path.is_empty() {
                    // 别名优先；`.` 点导入与 `_` 空白导入无法按名归属，跳过
                    let alias = n.child_by_field_name("name").and_then(|a| match a.kind() {
                        "dot" | "blank_identifier" => None,
                        _ => a.utf8_text(src).ok().map(|s| s.to_string()),
                    });
                    let pkg = alias.unwrap_or_else(|| {
                        path.rsplit('/').next().unwrap_or(path.as_str()).to_string()
                    });
                    specs.push((pkg, path));
                }
                // import_spec 内不可能再嵌 import_spec，无需下钻
                continue;
            }
            if matches!(n.kind(), "selector_expression" | "qualified_type") {
                let mut cur = n.walk();
                let kids: Vec<Node> = n.named_children(&mut cur).collect();
                if kids.len() >= 2 {
                    let (op, fld) = (kids[0], kids[kids.len() - 1]);
                    if (op.kind() == "identifier" || op.kind() == "package_identifier")
                        && matches!(
                            fld.kind(),
                            "field_identifier" | "type_identifier" | "identifier"
                        )
                    {
                        if let (Ok(o), Ok(m)) = (op.utf8_text(src), fld.utf8_text(src)) {
                            if specs.iter().any(|(p, _)| p == o) {
                                used.entry(o.to_string()).or_default().insert(m.to_string());
                            }
                        }
                    }
                }
            }
            let mut cur = n.walk();
            // 逆序入栈 → 出栈即文档序（与 `extract_go_symbol_imports` 同口径）
            for c in n.children(&mut cur).collect::<Vec<_>>().into_iter().rev() {
                stack.push(c);
            }
        }
        if specs.is_empty() || used.is_empty() {
            continue;
        }

        // ── 逐包名：导入路径 → 包目录 → 包内唯一同名符号 ──
        for (pkg, path) in &specs {
            let members = match used.get(pkg) {
                Some(m) => m,
                None => continue,
            };
            // 目录候选复用抽取层的单一真相源 `go_module_candidates`。
            //
            // **候选优先级（必须先具体后宽泛、且先到先得）**：该函数按「剥离段数 0 递增」
            // 产出，注释明言「先试完整路径再逐级退化，避免浅层同名包抢先命中造成假目标」。
            // 若不加约束地遍历并 `insert`，**最宽泛（剥离最多段）的候选会最后写入并覆盖**
            // 最具体的那个——正好与该函数的排序意图相反。故已解析的成员不再被后续
            // （更宽泛）候选覆盖；包内歧义时同样**不**继续退化到更浅的目录
            // （浅层目录更不可能是真目标，宁可不连）。
            let cands = crate::commands::code_structure::go_module_candidates(&f.rel_path, path);
            let mut resolved: HashSet<String> = HashSet::new();
            let mut given_up: HashSet<String> = HashSet::new();
            for c in cands {
                if resolved.len() + given_up.len() >= members.len() {
                    break;
                }
                if c.is_empty() || c.ends_with(".go") {
                    continue;
                }
                let Some(ids) = dir_files.get(c.as_str()) else {
                    continue;
                };
                for member in members {
                    if resolved.contains(member) || given_up.contains(member) {
                        continue;
                    }
                    let mut hit: Option<&'a ProjectSymbol> = None;
                    let mut ambiguous = false;
                    for fid in ids {
                        for s in by_file.get(*fid).map(|v| v.as_slice()).unwrap_or(&[]) {
                            if !is_callable(&s.kind) || s.name != *member {
                                continue;
                            }
                            match hit {
                                None => hit = Some(s),
                                Some(h) if h.id == s.id => {}
                                Some(_) => {
                                    ambiguous = true;
                                    break;
                                }
                            }
                        }
                        if ambiguous {
                            break;
                        }
                    }
                    if ambiguous {
                        given_up.insert(member.clone());
                    } else if let Some(s) = hit {
                        out.insert((f.id.clone(), pkg.clone(), member.clone()), s);
                        resolved.insert(member.clone());
                    }
                }
            }
        }
    }
    out
}

/// 相对路径的目录部分（`a/b/c.rs` → `a/b`，顶层文件 → `""`）。
fn dir_of(rel: &str) -> &str {
    let rel = rel.trim_start_matches("./");
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

/// Naive 兜底解析层（对标 joern `NaiveCallLinker`）。
///
/// joern 的调用链接是三级级联：Static（methodFullName 精确）→ Dynamic（继承层级全部候选）
/// → **Naive（只处理仍未链接的调用，按裸名链接；唯一匹配时提升可信度）**。
/// 其设计哲学是**宁可松链接也绝不留下断链**——`cpg.call.filter(_.outE(CALL).isEmpty)`
/// 之后按名字兜底，而非丢弃。
///
/// 我们此前缺失 Naive 层：`local → imported → global(全局唯一名)` 三步全不中即 `continue`
/// 丢弃整条边，导致同名函数（如 insert/run/get 这类高频名）在跨文件场景下**一条边都连不上**。
/// 回放实测（web-craft，22423 调用点）：同名歧义丢弃 4428 个，而当前可解析量仅 3917 个。
///
/// 与 joern 的**刻意差异**：joern 会把一条调用连到**全部**同名候选（超近似，靠下游路径枚举消歧）。
/// 我们下游没有等价的路径级消歧，盲连会把平均 8.7~14 个候选全铺开（实测将产 5 万条边，
/// 撑爆 MAX_EDGES 且严重稀释精度）。故降级为**「强过滤后恰好唯一才连」**的两级策略：
///
/// - **L1 模块局部性**：候选与调用方**同目录**且同目录内恰好一个 → 连。
///   同目录是工程上最强的廉价信号（本地 helper / 同模块工具函数）。
/// - **L2 种类消歧**：自由调用（`foo()`，无接收者）只可能命中 `function`；
///   成员调用（`x.foo()`，有接收者）只可能命中 `method`。按调用形态过滤后
///   候选中恰好一个 → 连。这是**语义级**消歧，不依赖目录布局。
///
/// 两者都要求「过滤后恰好一个」，不唯一即放弃（保守，可证伪）。
fn resolve_naive_tier<'a>(
    by_name: &HashMap<&str, Vec<&'a ProjectSymbol>>,
    name: &str,
    caller_dir: &str,
    receiver: &str,
) -> Option<&'a ProjectSymbol> {
    let cands = by_name.get(name)?;
    // 0/1 个候选由上游的 global 层处理（0 会丢弃，1 即全局唯一），这里只兜底歧义情形。
    if cands.len() < 2 {
        return None;
    }
    // L1 同目录唯一
    let same_dir: Vec<&'a ProjectSymbol> = cands
        .iter()
        .copied()
        .filter(|c| dir_of(&c.file_path) == caller_dir)
        .collect();
    if same_dir.len() == 1 {
        return Some(same_dir[0]);
    }
    // L2 种类消歧：调用形态决定候选种类
    let want = if receiver.is_empty() {
        "function"
    } else {
        "method"
    };
    let by_kind: Vec<&'a ProjectSymbol> =
        cands.iter().copied().filter(|c| c.kind == want).collect();
    if by_kind.len() == 1 {
        return Some(by_kind[0]);
    }
    None
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// 提取一行中所有 `ident(` 形式的调用点（返回被调名）
///
/// 过滤策略：
/// - 注释行（//、#、*、--）整行跳过
/// - 关键字跳过
/// - 声明处跳过（前一个 token 是 function/fn/def/class 等）
/// 跳过字符串/模板字符串字面量（含转义），返回闭括号后的下标
fn skip_string_literal(chars: &[char], start: usize) -> usize {
    let quote = chars[start];
    let mut i = start + 1;
    while i < chars.len() {
        if chars[i] == '\\' {
            i += 2;
            continue;
        }
        if chars[i] == quote {
            return i + 1;
        }
        i += 1;
    }
    chars.len()
}

/// 提取一行中所有调用点（被调名）。v2.3 token 级扫描：
///
/// 覆盖的调用形态：
/// - 普通调用 `foo(...)`（过滤控制流/声明关键字）
/// - 成员调用 `obj.method(...)` → method
/// - 可选链调用 `foo?.()` → foo
/// - 构造调用 `new Foo(...)` → Foo
/// - 方括号索引调用 `obj["name"]()` → name
///
/// 防误报：字符串/模板字符串/行注释内的 `ident(` 不提取；
/// 声明处（prev token 是 function/fn/def/class 等）不提取。
fn extract_calls(line: &str) -> Vec<String> {
    let t = line.trim_start();
    if t.starts_with("//")
        || t.starts_with('#')
        || t.starts_with('*')
        || t.starts_with("/*")
        || t.starts_with("--")
    {
        return Vec::new();
    }

    let chars: Vec<char> = line.chars().collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;
    let mut prev_token = String::new();

    while i < chars.len() {
        let c = chars[i];
        // 字符串字面量整体跳过（' " `；模板字符串含 ${} 插值会漏调用，正则级可接受）
        if c == '\'' || c == '"' || c == '`' {
            i = skip_string_literal(&chars, i);
            prev_token = String::new();
            continue;
        }
        // 行注释直接结束
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            break;
        }
        if !is_ident_start(c) {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && is_ident_char(chars[i]) {
            i += 1;
        }
        let ident: String = chars[start..i].iter().collect();

        // 跳过空白
        let mut j = i;
        while j < chars.len() && (chars[j] == ' ' || chars[j] == '\t') {
            j += 1;
        }

        // 可选链调用 foo?.(
        if j + 1 < chars.len() && chars[j] == '?' && chars[j + 1] == '.' {
            let mut k = j + 2;
            while k < chars.len() && (chars[k] == ' ' || chars[k] == '\t') {
                k += 1;
            }
            if k < chars.len() && chars[k] == '(' && ident.len() > 1 {
                out.push(ident.clone());
            }
            prev_token = ident;
            i = k.max(j + 2);
            continue;
        }

        // 方括号索引调用 obj["name"](
        if j < chars.len() && chars[j] == '[' {
            let mut close = j + 1;
            while close < chars.len() && chars[close] != ']' {
                close += 1;
            }
            if close < chars.len() {
                let inner = &chars[j + 1..close];
                // ["name"] 或 ['name']
                if inner.len() >= 2
                    && (inner[0] == '"' || inner[0] == '\'')
                    && inner[inner.len() - 1] == inner[0]
                {
                    let name: String = inner[1..inner.len() - 1].iter().collect();
                    let mut k = close + 1;
                    while k < chars.len() && (chars[k] == ' ' || chars[k] == '\t') {
                        k += 1;
                    }
                    if k < chars.len() && chars[k] == '(' && !name.is_empty() {
                        out.push(name);
                    }
                }
            }
            prev_token = ident;
            i = if close < chars.len() {
                close + 1
            } else {
                chars.len()
            };
            continue;
        }

        // 直接调用 foo( / obj.method(
        if j < chars.len() && chars[j] == '(' {
            let is_new = prev_token == "new";
            if is_new {
                // 构造调用 new Foo( → Foo
                if ident.len() > 1 {
                    out.push(ident.clone());
                }
            } else if !KEYWORDS.contains(&ident.as_str())
                && !KEYWORDS.contains(&prev_token.as_str())
                && ident.len() > 1
            {
                out.push(ident.clone());
            }
            prev_token = ident;
            i = j + 1;
            continue;
        }

        prev_token = ident;
        i = if j < chars.len() { j } else { chars.len() };
    }
    out
}

/// tree-sitter 调用点（TS/JS）：被调名 + 接收者根标识符 + 行号。
///
/// 与逐行正则版相比：捕获 `obj.method()` 的接收者（`obj`），从根上消除
/// `RegExp.exec` / `child_process.exec` 同名的 taint RCE 假阳性；且不提取
/// 字符串/模板字面量里的 `ident(`（减少误报）。
#[derive(Debug)]
pub struct CallSite {
    pub callee: String,
    pub receiver: String,
    pub line: usize,
}

/// TS/JS 调用提取（tree-sitter 节点遍历版，对标 joern 调用解析到 methodFullName + 接收者类型）。
pub fn extract_calls_ts(content: &str) -> Vec<CallSite> {
    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
        .is_err()
    {
        return Vec::new();
    }
    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let src = content.as_bytes();
    let mut out = Vec::new();
    collect_call_sites(tree.root_node(), src, &mut out);
    out
}

fn collect_call_sites(node: Node, src: &[u8], out: &mut Vec<CallSite>) {
    match node.kind() {
        "call_expression" => {
            if let Some(func) = node.child_by_field_name("function") {
                let (callee, receiver) = call_callee_receiver(func, src);
                if !callee.is_empty() {
                    out.push(CallSite {
                        callee,
                        receiver,
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        "new_expression" => {
            if let Some(ctor) = node.child_by_field_name("constructor") {
                let (callee, receiver) = call_callee_receiver(ctor, src);
                if !callee.is_empty() {
                    out.push(CallSite {
                        callee,
                        receiver,
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        _ => {}
    }
    let mut child = node.child(0);
    while let Some(c) = child {
        collect_call_sites(c, src, out);
        child = c.next_sibling();
    }
}

/// 从调用表达式的 `function`/`constructor` 节点解析被调名与接收者根标识符。
fn call_callee_receiver(func: Node, src: &[u8]) -> (String, String) {
    match func.kind() {
        "identifier" => (func.utf8_text(src).unwrap_or("").to_string(), String::new()),
        "member_expression" | "field_expression" | "field_access" | "member_access_expression" => {
            let obj = func
                .child_by_field_name("object")
                .or_else(|| func.child_by_field_name("value"))
                .or_else(|| func.child_by_field_name("argument"))
                .or_else(|| func.child_by_field_name("expression")); // C# member_access_expression
                                                                     // TS/JS `property`；Rust/C/C++/Java `field`；C# `name`
            let prop = func
                .child_by_field_name("property")
                .or_else(|| func.child_by_field_name("field"))
                .or_else(|| func.child_by_field_name("name"));
            let callee = prop
                .map(|p| p.utf8_text(src).unwrap_or("").to_string())
                .unwrap_or_default();
            let receiver = match obj {
                Some(o)
                    if o.kind() == "call_expression" || o.kind() == "parenthesized_expression" =>
                {
                    String::new()
                }
                Some(o) => root_ident(o, src),
                None => String::new(),
            };
            (callee, receiver)
        }
        "subscript_expression" => {
            // 仅字面子脚本 `obj["name"]()` 视为调用（与逐行正则一致）；计算下标 `arr[i]()` 跳过。
            let idx = func.child_by_field_name("index");
            let callee = match idx {
                Some(i) if i.kind() == "string" => i
                    .utf8_text(src)
                    .unwrap_or("")
                    .trim_matches(|c| c == '"' || c == '\'' || c == '`')
                    .to_string(),
                _ => return (String::new(), String::new()),
            };
            let receiver = func
                .child_by_field_name("object")
                .map(|o| root_ident(o, src))
                .unwrap_or_default();
            (callee, receiver)
        }
        "attribute" => {
            // Python `object.attribute()`（tree-sitter-python 字段名为 object/attribute）
            let value = func.child_by_field_name("object");
            let attr = func.child_by_field_name("attribute");
            let callee = attr
                .map(|p| p.utf8_text(src).unwrap_or("").to_string())
                .unwrap_or_default();
            let receiver = value.map(|v| root_ident(v, src)).unwrap_or_default();
            (callee, receiver)
        }
        "selector_expression" => {
            // Go `operand.field()`
            let operand = func.child_by_field_name("operand");
            let field = func.child_by_field_name("field");
            let callee = field
                .map(|p| p.utf8_text(src).unwrap_or("").to_string())
                .unwrap_or_default();
            let receiver = operand.map(|o| root_ident(o, src)).unwrap_or_default();
            (callee, receiver)
        }
        "scoped_identifier" | "qualified_identifier" => {
            // 命名空间/路径限定的静态调用（Rust `a::b`、C++ `ns::f`）：无实例接收者，
            // callee 取末段函数名，receiver 置空（对标 joern STATIC_DISPATCH）。
            let name = func
                .child_by_field_name("name")
                .or_else(|| func.child_by_field_name("field"))
                .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                .unwrap_or_else(|| last_segment(func.utf8_text(src).unwrap_or("")));
            (name, String::new())
        }

        _ => (String::new(), String::new()),
    }
}

/// 取成员表达式的最左根标识符（如 `a.b.c()` → "a"）；链式/动态调用返回空串。
///
/// 覆盖多语言成员访问节点：TS/JS `member_expression`、Rust/C/C++ `field_expression`、
/// Java `field_access`、Python `attribute`、Go `selector_expression`，以及命名空间路径
/// `a::b::c`（`scoped_identifier`/`qualified_identifier`）。对标 joern CALL.receiver 根对象。
fn root_ident(node: Node, src: &[u8]) -> String {
    let mut cur = node;
    loop {
        match cur.kind() {
            "identifier" => return cur.utf8_text(src).unwrap_or("").to_string(),
            "member_expression"
            | "field_expression"
            | "field_access"
            | "member_access_expression" => {
                match cur
                    .child_by_field_name("object")
                    .or_else(|| cur.child_by_field_name("value"))
                    .or_else(|| cur.child_by_field_name("argument"))
                    .or_else(|| cur.child_by_field_name("expression"))
                {
                    Some(o) => cur = o,
                    None => return String::new(),
                }
            }
            "attribute" => match cur
                .child_by_field_name("value")
                .or_else(|| cur.child_by_field_name("object"))
            {
                Some(v) => cur = v,
                None => return String::new(),
            },
            "selector_expression" => match cur.child_by_field_name("operand") {
                Some(v) => cur = v,
                None => return String::new(),
            },
            "scoped_identifier" | "qualified_identifier" => {
                // 命名空间路径取最左段（a::b::c → a）；无路径则退回首标识符。
                match cur
                    .child_by_field_name("path")
                    .or_else(|| cur.child_by_field_name("scope"))
                {
                    Some(p) => cur = p,
                    None => return first_ident(cur.utf8_text(src).unwrap_or("")),
                }
            }
            "call_expression" | "call" | "parenthesized_expression" => return String::new(),
            _ => return cur.utf8_text(src).unwrap_or("").to_string(),
        }
    }
}

/// 取 `a::b::c` / `ns::f` 的末段（函数名）。
fn last_segment(s: &str) -> String {
    s.rsplit(|c| c == ':' || c == '.')
        .next()
        .unwrap_or("")
        .to_string()
}

/// 取标识符串的首段（用于命名空间路径无 scope 时的兜底）。
fn first_ident(s: &str) -> String {
    s.chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect()
}

/// Ruby `call` 节点的接收者根标识符：递归下钻链式 `obj.foo.bar` 的 receiver（本身也是 `call`），
/// 直至 `identifier`/`constant`；对标 joern rubysrc2cpg 的 receiver 根对象。
fn ruby_receiver_root(node: Node, src: &[u8]) -> String {
    match node.kind() {
        "identifier" | "constant" | "program" => node.utf8_text(src).unwrap_or("").to_string(),
        "call" => node
            .child_by_field_name("receiver")
            .map(|r| ruby_receiver_root(r, src))
            .unwrap_or_default(),
        _ => root_ident(node, src),
    }
}

/// TS/JS 族文件（tree-sitter 调用提取带接收者）；其余语言保持逐行正则（无接收者）。
fn is_ts_js_path(p: &str) -> bool {
    let ext = p.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    matches!(ext.as_str(), "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs")
}

/// 跨语言 tree-sitter 调用提取（对标 joern 各 frontend：CALL 节点带 receiver/base + name）。
///
/// 与 TS/JS 专用 `extract_calls_ts` 共享 `call_callee_receiver`/`root_ident` 的接收者解析逻辑，
/// 仅按方言差异选择调用节点形态（`call` / `call_expression` / `method_invocation` 等）与构造调用。
/// 覆盖 Python / Rust / Go / Java / C / C++ / C# / PHP / Ruby / Swift / Kotlin，全部带接收者解析
/// （对标 joern 各 frontend 的 receiver/base 抽取）；未接入的少数方言回退逐行正则（receiver 为空）。
pub fn extract_calls_ast(d: Dialect, content: &str) -> Vec<CallSite> {
    let mut parser = Parser::new();
    if parser.set_language(&d.language()).is_err() {
        return Vec::new();
    }
    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let src = content.as_bytes();
    let mut out = Vec::new();
    collect_calls_ast(tree.root_node(), src, &mut out, d);
    out
}

fn collect_calls_ast(node: Node, src: &[u8], out: &mut Vec<CallSite>, d: Dialect) {
    let push = |func: Node, node: Node, out: &mut Vec<CallSite>| {
        let (callee, receiver) = call_callee_receiver(func, src);
        if !callee.is_empty() {
            out.push(CallSite {
                callee,
                receiver,
                line: node.start_position().row + 1,
            });
        }
    };
    match d {
        Dialect::Python => {
            if node.kind() == "call" {
                if let Some(func) = node.child_by_field_name("function") {
                    push(func, node, out);
                }
            }
        }
        Dialect::Java => {
            if node.kind() == "method_invocation" {
                // `obj.method()`：name 为方法名，object 为接收者根（可为空=静态/无接收者）。
                let name = node.child_by_field_name("name");
                let obj = node.child_by_field_name("object");
                let callee = name
                    .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                    .unwrap_or_default();
                let receiver = obj.map(|o| root_ident(o, src)).unwrap_or_default();
                if !callee.is_empty() {
                    out.push(CallSite {
                        callee,
                        receiver,
                        line: node.start_position().row + 1,
                    });
                }
            } else if node.kind() == "object_creation_expression" {
                // `new Foo()`：构造调用，无实例接收者，callee 取类型名。
                if let Some(ty) = node.child_by_field_name("type") {
                    let callee = ty.utf8_text(src).unwrap_or("").to_string();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver: String::new(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
            }
        }
        Dialect::Rust | Dialect::Go | Dialect::C | Dialect::Cpp => {
            if node.kind() == "call_expression" {
                if let Some(func) = node.child_by_field_name("function") {
                    push(func, node, out);
                }
            } else if node.kind() == "new_expression" {
                // C/C++ `new Foo()`：构造调用，callee 取类型名，无实例接收者。
                if let Some(ty) = node.child_by_field_name("type") {
                    let callee = ty.utf8_text(src).unwrap_or("").to_string();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver: String::new(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
            }
        }
        Dialect::CSharp => {
            // 对标 joern csharpsrc2cpg：invocation_expression → CALL(function + receiver)；
            // member_access_expression(expression=对象, name=方法) 携带接收者；new Foo() 为构造调用。
            if node.kind() == "invocation_expression" {
                if let Some(func) = node.child_by_field_name("function") {
                    push(func, node, out);
                }
            } else if node.kind() == "object_creation_expression" {
                if let Some(ty) = node.child_by_field_name("type") {
                    let callee = ty.utf8_text(src).unwrap_or("").to_string();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver: String::new(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
            }
        }
        Dialect::Php => {
            // 对标 joern php2cpg：member_call($obj->method, 带 receiver) / scoped_call(Class::method, 静态) /
            // function_call(free_fn) / new Foo() 构造调用。
            match node.kind() {
                "member_call_expression" => {
                    let name = node.child_by_field_name("name");
                    let obj = node.child_by_field_name("object");
                    let callee = name
                        .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                        .unwrap_or_default();
                    let receiver = obj
                        .map(|o| root_ident(o, src).trim_start_matches('$').to_string())
                        .unwrap_or_default();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver,
                            line: node.start_position().row + 1,
                        });
                    }
                }
                "scoped_call_expression" => {
                    // Class::method()：静态分发，无实例接收者（对标 joern STATIC_DISPATCH）。
                    let name = node.child_by_field_name("name");
                    let callee = name
                        .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                        .unwrap_or_default();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver: String::new(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
                "function_call_expression" => {
                    // `function` 字段节点 kind 为 `name`（非 identifier），直接取其文本。
                    if let Some(f) = node.child_by_field_name("function") {
                        let callee = f.utf8_text(src).unwrap_or("").to_string();
                        if !callee.is_empty() {
                            out.push(CallSite {
                                callee,
                                receiver: String::new(),
                                line: node.start_position().row + 1,
                            });
                        }
                    }
                }
                "object_creation_expression" => {
                    let ty = node
                        .child_by_field_name("name")
                        .or_else(|| node.named_child(0));
                    let callee = ty
                        .map(|t| t.utf8_text(src).unwrap_or("").to_string())
                        .unwrap_or_default();
                    if !callee.is_empty() {
                        out.push(CallSite {
                            callee,
                            receiver: String::new(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
                _ => {}
            }
        }
        Dialect::Ruby => {
            // 对标 joern rubysrc2cpg：call(receiver + method)；链式 obj.foo.bar 的 receiver 本身是 call，递归取根。
            if node.kind() == "call" {
                let method = node.child_by_field_name("method");
                let receiver = node.child_by_field_name("receiver");
                let callee = method
                    .map(|m| m.utf8_text(src).unwrap_or("").to_string())
                    .unwrap_or_default();
                let receiver = receiver
                    .map(|r| ruby_receiver_root(r, src))
                    .unwrap_or_default();
                if !callee.is_empty() {
                    out.push(CallSite {
                        callee,
                        receiver,
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        Dialect::Swift => {
            // 对标 joern swiftsrc2cpg：call_expression；首命名子为 navigation_expression(obj.method) 或 simple_identifier(plain/构造)。
            if node.kind() == "call_expression" {
                if let Some(first) = node.named_child(0) {
                    if first.kind() == "navigation_expression" {
                        let target = first.child_by_field_name("target");
                        let name = first
                            .child_by_field_name("suffix")
                            .and_then(|s| s.child_by_field_name("suffix"));
                        let callee = name
                            .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                            .unwrap_or_default();
                        let receiver = target.map(|t| root_ident(t, src)).unwrap_or_default();
                        if !callee.is_empty() {
                            out.push(CallSite {
                                callee,
                                receiver,
                                line: node.start_position().row + 1,
                            });
                        }
                    } else {
                        let callee = first.utf8_text(src).unwrap_or("").to_string();
                        if !callee.is_empty() {
                            out.push(CallSite {
                                callee,
                                receiver: String::new(),
                                line: node.start_position().row + 1,
                            });
                        }
                    }
                }
            }
        }
        Dialect::Kotlin => {
            // 对标 joern kotlin2cpg：call_expression；首命名子为 navigation_expression(两个 identifier：receiver, name) 或 identifier(plain/构造)。
            if node.kind() == "call_expression" {
                if let Some(first) = node.named_child(0) {
                    if first.kind() == "navigation_expression" {
                        let recv = first.named_child(0);
                        let name = first.named_child(1);
                        let callee = name
                            .map(|n| n.utf8_text(src).unwrap_or("").to_string())
                            .unwrap_or_default();
                        let receiver = recv.map(|r| root_ident(r, src)).unwrap_or_default();
                        if !callee.is_empty() {
                            out.push(CallSite {
                                callee,
                                receiver,
                                line: node.start_position().row + 1,
                            });
                        }
                    } else {
                        let callee = first.utf8_text(src).unwrap_or("").to_string();
                        if !callee.is_empty() {
                            out.push(CallSite {
                                callee,
                                receiver: String::new(),
                                line: node.start_position().row + 1,
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }
    let mut child = node.child(0);
    while let Some(c) = child {
        collect_calls_ast(c, src, out, d);
        child = c.next_sibling();
    }
}

/// 二分定位某一行属于哪个符号（区间已按 line_start 排序且不重叠优先取最内层）
fn owner_of<'a>(sorted: &'a [&'a ProjectSymbol], line: i64) -> Option<&'a ProjectSymbol> {
    let mut hit: Option<&ProjectSymbol> = None;
    for s in sorted {
        if s.line_start > line {
            break;
        }
        if line <= s.line_end {
            // 取范围最小的那个（方法优先于所在 class）
            match hit {
                Some(prev) if (prev.line_end - prev.line_start) <= (s.line_end - s.line_start) => {}
                _ => hit = Some(s),
            }
        }
    }
    hit
}

/// 主命令：构建调用图并落库，返回摘要
#[tauri::command(async)]
pub fn analyze_call_graph(
    analysis_id: String,
    app: AppHandle,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
    ref_repo: State<'_, Arc<SqliteProjectSymbolRefRepository>>,
    edge_repo: State<'_, Arc<SqliteProjectCallEdgeRepository>>,
    changed_rel_paths: Option<Vec<String>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<CallGraphSummary> {
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let symbols = symbol_repo.list_by_analysis(&analysis_id)?;
    let refs = ref_repo.list_by_analysis(&analysis_id)?;
    let incremental = changed_rel_paths.is_some();
    // 增量仅重算变更/新增调用方文件的边，携带未变调用方的旧边。
    let changed: HashSet<&str> = changed_rel_paths
        .iter()
        .flatten()
        .map(|s| s.as_str())
        .collect();
    let current_rel: HashSet<&str> = files
        .iter()
        .filter(|f| !f.is_directory)
        .map(|f| f.rel_path.as_str())
        .collect();
    let valid_sym_ids: HashSet<&str> = symbols.iter().map(|s| s.id.as_str()).collect();
    let process_files: Vec<&ProjectFile> = files
        .iter()
        .filter(|f| !f.is_directory && (!incremental || changed.contains(f.rel_path.as_str())))
        .collect();
    // 上一轮调用边，用于增量携带
    let existing: Vec<CallEdge> = if incremental {
        edge_repo.list_by_analysis(&analysis_id).unwrap_or_default()
    } else {
        Vec::new()
    };
    let total = process_files.len() as i64;
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::CallGraph,
        0,
        0,
        total,
        if incremental {
            "增量构建调用图…"
        } else {
            "构建函数调用图…"
        },
    );

    // 文件内符号（按行排序）
    let mut by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
    // 全局名索引（仅可调用种类）
    let mut by_name: HashMap<&str, Vec<&ProjectSymbol>> = HashMap::new();
    let mut by_id: HashMap<&str, &ProjectSymbol> = HashMap::new();
    for s in &symbols {
        by_file.entry(s.file_id.clone()).or_default().push(s);
        by_id.insert(s.id.as_str(), s);
        if is_callable(&s.kind) {
            by_name.entry(s.name.as_str()).or_default().push(s);
        }
    }
    for list in by_file.values_mut() {
        list.sort_by_key(|s| s.line_start);
    }

    // 接收者感知解析索引（joern CALL.receiver → 声明类型成员）：
    // 把「类型/容器符号」与其内嵌套的可调用成员建索引，供方法调用解析到正确目标。
    let mut type_syms_by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
    let mut type_by_name: HashMap<(String, String), &ProjectSymbol> = HashMap::new();
    let mut methods_by_type_id: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
    for s in &symbols {
        if is_type_kind(&s.kind) {
            type_syms_by_file
                .entry(s.file_id.clone())
                .or_default()
                .push(s);
            type_by_name.insert((s.file_id.clone(), s.name.clone()), s);
        }
    }
    for s in &symbols {
        if is_method_like(&s.kind) {
            let type_syms: Vec<&ProjectSymbol> = type_syms_by_file
                .get(&s.file_id)
                .cloned()
                .unwrap_or_default();
            if let Some(t) = enclosing_type(type_syms.as_slice(), s) {
                methods_by_type_id.entry(t.id.clone()).or_default().push(s);
            }
        }
    }
    // Rust impl 块索引（symbol 表不产出 impl 符号，单独建）
    let mut rust_impl_methods: HashMap<(String, String), Vec<&ProjectSymbol>> = HashMap::new();
    let mut rust_caller_impl: HashMap<(String, i64), String> = HashMap::new();
    for f in &files {
        if f.is_directory {
            continue;
        }
        let is_rust = f.language.as_deref() == Some("rust") || f.rel_path.ends_with(".rs");
        if !is_rust {
            continue;
        }
        let Some(content) = cache.read(f) else {
            continue;
        };
        let fsyms: &[&ProjectSymbol] = match by_file.get(&f.id) {
            Some(v) => v.as_slice(),
            None => &[],
        };
        let (m, ci) = collect_rust_impl_associations(&content, &f.id, fsyms);
        for (k, v) in m {
            rust_impl_methods.entry(k).or_default().extend(v);
        }
        for (k, v) in ci {
            rust_caller_impl.insert(k, v);
        }
    }
    // Go 接收者索引（对标 joern gosrc2cpg：`func (r Type) Name` → (Type, Name) 查方法）
    let mut go_method_by_type: HashMap<(String, String), Vec<&ProjectSymbol>> = HashMap::new();
    let mut go_caller_receiver: HashMap<(String, i64), (String, String)> = HashMap::new();
    let mut go_method_owner_type: HashMap<(String, i64), String> = HashMap::new();
    for f in &files {
        if f.is_directory {
            continue;
        }
        let is_go = f.language.as_deref() == Some("go") || f.rel_path.ends_with(".go");
        if !is_go {
            continue;
        }
        let Some(content) = cache.read(f) else {
            continue;
        };
        let fsyms: &[&ProjectSymbol] = match by_file.get(&f.id) {
            Some(v) => v.as_slice(),
            None => &[],
        };
        let (mbt, cr, mot) = collect_go_receiver_associations(&content, &f.id, fsyms);
        for (k, v) in mbt {
            go_method_by_type.entry(k).or_default().extend(v);
        }
        for (k, v) in cr {
            go_caller_receiver.insert(k, v);
        }
        for (k, v) in mot {
            go_method_owner_type.insert(k, v);
        }
    }
    let ctx = CallResolutionCtx {
        type_by_name,
        methods_by_type_id,
        type_syms_by_file,
        rust_impl_methods,
        rust_caller_impl,
        go_method_by_type,
        go_caller_receiver,
        go_method_owner_type,
    };

    // (引用方文件, 符号名) → 被引用符号 id，用于跨文件消歧
    let mut import_map: HashMap<(String, String), String> = HashMap::new();
    for r in &refs {
        if let Some(sid) = &r.to_symbol_id {
            import_map.insert((r.from_file_id.clone(), r.symbol_name.clone()), sid.clone());
        }
    }
    // 通配（整模块）导入索引（对标 joern `isImportingModule` 全实体加载）
    let mut file_id_by_rel: HashMap<&str, &str> = HashMap::new();
    let mut file_by_rel: HashMap<String, &ProjectFile> = HashMap::new();
    for f in &files {
        if f.is_directory {
            continue;
        }
        file_id_by_rel.insert(f.rel_path.as_str(), f.id.as_str());
        file_by_rel.insert(f.rel_path.clone(), f);
    }
    let glob_map = build_glob_import_index(
        &refs,
        &by_file,
        &by_id,
        &file_id_by_rel,
        &file_by_rel,
        &cache,
    );
    // Go 包名/别名限定调用索引（joern `aliasToNameSpaceMapping` → `resolveAliasToFullName`）
    let go_pkg_map = build_go_pkg_call_index(&files, &by_file, &cache);

    let now = chrono::Utc::now().timestamp();
    let done = AtomicI64::new(0);
    // 并行下无法 `break 'outer`：改用原子边数预算 + 末尾截断。
    // 语义等价于串行版——一旦触顶，后续文件直接跳过，不再做无用功。
    let budget = AtomicUsize::new(0);

    // 逐文件并行：caller 符号天然只属于单个文件，
    // 所以「文件内 (caller,callee) 去重」与原串行版的全局去重完全等价。
    let mut edges: Vec<CallEdge> = files
        .par_iter()
        .filter(|f| !f.is_directory && (!incremental || changed.contains(f.rel_path.as_str())))
        .flat_map_iter(|file| {
            let seq = done.fetch_add(1, AtomicOrdering::Relaxed) + 1;
            if seq % 200 == 0 {
                crate::commands::project_scan::emit_stage_progress(
                    &app,
                    crate::commands::project_scan::ScanStage::CallGraph,
                    ((seq as f64 / total.max(1) as f64) * 100.0) as i64,
                    seq,
                    total,
                    "构建函数调用图…",
                );
            }

            let build = || -> Vec<CallEdge> {
                if budget.load(AtomicOrdering::Relaxed) >= MAX_EDGES {
                    return Vec::new();
                }
                let file_syms = match by_file.get(&file.id) {
                    Some(v) if !v.is_empty() => v,
                    _ => return Vec::new(),
                };
                let callers: Vec<&ProjectSymbol> = file_syms
                    .iter()
                    .copied()
                    .filter(|s| is_caller_kind(&s.kind))
                    .collect();
                if callers.is_empty() {
                    return Vec::new();
                }
                let Some(content) = cache.read(file) else {
                    return Vec::new();
                };
                // 调用方所在目录（Naive 兜底层的模块局部性信号）
                let caller_dir = dir_of(&file.rel_path);

                let mut out: Vec<CallEdge> = Vec::new();
                // 去重：同一 caller→callee 只保留首次出现的调用点
                let mut seen: std::collections::HashSet<(&str, &str)> =
                    std::collections::HashSet::new();

                // TS/JS 走 tree-sitter 调用提取（带接收者）；其余语言优先走 AST 提取
                // （Python/Rust/Go/Java/C/C++/C#/PHP/Ruby/Swift/Kotlin 已支持接收者感知，对标 joern CALL.receiver），
                // 无对应 grammar 的方言回退逐行正则（receiver 为空，与历史行为一致）。
                let calls: Vec<(String, String, usize)> = if is_ts_js_path(&file.rel_path) {
                    extract_calls_ts(&content)
                        .into_iter()
                        .map(|c| (c.callee, c.receiver, c.line))
                        .collect()
                } else if let Some(d) = file
                    .language
                    .as_deref()
                    .and_then(|l| dialect_for(l, &file.rel_path))
                {
                    extract_calls_ast(d, &content)
                        .into_iter()
                        .map(|c| (c.callee, c.receiver, c.line))
                        .collect()
                } else {
                    content
                        .lines()
                        .enumerate()
                        .flat_map(|(i, raw)| {
                            extract_calls(raw)
                                .into_iter()
                                .map(move |n| (n, String::new(), i + 1))
                        })
                        .collect()
                };

                for (name, receiver, line_no) in calls {
                    let line_no = line_no as i64;
                    let caller = match owner_of(&callers, line_no) {
                        Some(c) => c,
                        None => continue,
                    };
                    // 声明行本身不算调用
                    if caller.line_start == line_no {
                        continue;
                    }
                    if name == caller.name {
                        continue; // 递归调用对画像没有信息量
                    }
                    // 接收者感知解析（joern DynamicCallLinker/StaticCallLinker 语义）：
                    // 优先把方法调用解析到接收者声明类型的成员，否则回退名匹配。
                    let receiver_target =
                        resolve_receiver_target(&ctx, &name, &receiver, caller, &file.id);
                    // 是否由「Go 包名限定」层命中：命中时影响面板要显示 `static.CallGraph`
                    // 而非裸名 `CallGraph`——分辨同名方法正是本层的全部价值，必须可见。
                    let mut go_pkg_hit = false;
                    let callee = match receiver_target {
                        Some(c) => c,
                        None => {
                            // 1) 同文件优先
                            let local = file_syms
                                .iter()
                                .copied()
                                .find(|s| is_callable(&s.kind) && s.name == name);
                            // 1b) Go 包名/别名限定调用 `pkg.Func()`
                            //     （joern `resolveAliasToFullName(alias) + "." + methodName`）：
                            //     裸名 `imported` 层会让同名的 `static.CallGraph()` 与
                            //     `cha.CallGraph()` 双双连到同一个包，故包名能限定时限定的优先。
                            let go_pkg = if receiver.is_empty() {
                                None
                            } else {
                                go_pkg_map
                                    .get(&(file.id.clone(), receiver.clone(), name.clone()))
                                    .copied()
                            };
                            // 2) 该文件 import 进来的同名符号
                            let imported = import_map
                                .get(&(file.id.clone(), name.clone()))
                                .and_then(|sid| by_id.get(sid.as_str()).copied());
                            // 2b) 通配导入（`use a::*;`）展开出的唯一同名符号
                            let globbed = glob_map.get(&(file.id.clone(), name.clone())).copied();
                            // 3) 全局唯一同名符号
                            let global = by_name.get(name.as_str()).and_then(|v| {
                                if v.len() == 1 {
                                    Some(v[0])
                                } else {
                                    None
                                }
                            });
                            // 4) Naive 兜底层（对标 joern NaiveCallLinker）：同名歧义时，
                            //    按「同目录唯一 / 调用形态对应的种类唯一」保守消歧后才连边。
                            let naive = resolve_naive_tier(&by_name, &name, caller_dir, &receiver);
                            match local
                                .or(go_pkg)
                                .or(imported)
                                .or(globbed)
                                .or(global)
                                .or(naive)
                            {
                                Some(c) => {
                                    go_pkg_hit = go_pkg.map(|g| g.id == c.id).unwrap_or(false);
                                    c
                                }
                                None => continue,
                            }
                        }
                    };
                    if callee.id == caller.id {
                        continue;
                    }
                    if !seen.insert((caller.id.as_str(), callee.id.as_str())) {
                        continue;
                    }
                    // 被调方解析到的接收者声明类型名（joern 动态分派超近似所丢失的信息）。
                    // Go 包名限定命中时取包名本身（`static.CallGraph`），让影响面板可区分
                    // 跨包同名方法——否则本层的修正只存在于图里，用户看不见。
                    let receiver_target = if go_pkg_hit {
                        receiver.clone()
                    } else {
                        callee_receiver_type(&ctx, &callee)
                    };
                    let kind = if callee.file_id == file.id {
                        "internal"
                    } else {
                        "cross-file"
                    };
                    out.push(CallEdge {
                        id: format!("call_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                        analysis_id: analysis_id.clone(),
                        caller_symbol_id: caller.id.clone(),
                        caller_name: caller.name.clone(),
                        caller_file_id: file.id.clone(),
                        caller_file_path: file.rel_path.clone(),
                        callee_symbol_id: callee.id.clone(),
                        callee_name: callee.name.clone(),
                        callee_file_id: callee.file_id.clone(),
                        callee_file_path: callee.file_path.clone(),
                        line_no,
                        kind: kind.to_string(),
                        callee_receiver: receiver,
                        receiver_target,
                        created_at: now,
                    });
                    if out.len() >= MAX_EDGES {
                        break;
                    }
                }
                out
            };

            let local = build();
            if !local.is_empty() {
                budget.fetch_add(local.len(), AtomicOrdering::Relaxed);
            }
            local.into_iter()
        })
        .collect();
    edges.truncate(MAX_EDGES);

    // 增量携带：合并未变调用方的旧边 + 本轮新边，并清理悬挂边（指向已消失/重命名符号）。
    let all: Vec<CallEdge> = if incremental {
        let mut kept: Vec<CallEdge> = Vec::new();
        let mut stale: Vec<String> = changed.iter().map(|s| s.to_string()).collect();
        for e in existing {
            let caller = e.caller_file_path.as_str();
            if !current_rel.contains(caller) {
                if !stale.contains(&e.caller_file_path) {
                    stale.push(e.caller_file_path.clone());
                }
                continue;
            }
            if changed.contains(caller) {
                continue;
            }
            if !valid_sym_ids.contains(e.caller_symbol_id.as_str())
                || !valid_sym_ids.contains(e.callee_symbol_id.as_str())
            {
                continue; // 调用方/被调方符号已消失 → 悬挂边，丢弃
            }
            if !current_rel.contains(e.callee_file_path.as_str()) {
                continue; // 被调方文件已删除 → 丢弃
            }
            kept.push(e);
        }
        edge_repo.delete_by_analysis_and_files(&analysis_id, &stale)?;
        if !edges.is_empty() {
            edge_repo.save_batch(&edges)?;
        }
        let mut v = kept;
        v.extend(edges);
        v
    } else {
        edge_repo.delete_by_analysis(&analysis_id)?;
        if !edges.is_empty() {
            edge_repo.save_batch(&edges)?;
        }
        edges
    };

    // 摘要：出度 / 入度 TOP10
    let mut out_deg: HashMap<&str, i64> = HashMap::new();
    let mut in_deg: HashMap<&str, i64> = HashMap::new();
    for e in &all {
        *out_deg.entry(e.caller_symbol_id.as_str()).or_insert(0) += 1;
        *in_deg.entry(e.callee_symbol_id.as_str()).or_insert(0) += 1;
    }
    let to_hotspots = |m: &HashMap<&str, i64>| -> Vec<CallHotspot> {
        let mut v: Vec<(&str, i64)> = m.iter().map(|(k, c)| (*k, *c)).collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        v.into_iter()
            .take(10)
            .filter_map(|(sid, count)| {
                by_id.get(sid).map(|s| CallHotspot {
                    symbol_id: s.id.clone(),
                    name: s.name.clone(),
                    file_path: s.file_path.clone(),
                    count,
                })
            })
            .collect()
    };
    let summary = CallGraphSummary {
        total_edges: all.len() as i64,
        cross_file_edges: all.iter().filter(|e| e.kind == "cross-file").count() as i64,
        functions: {
            let mut set: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for e in &all {
                set.insert(e.caller_symbol_id.as_str());
                set.insert(e.callee_symbol_id.as_str());
            }
            set.len() as i64
        },
        top_callers: to_hotspots(&out_deg),
        top_callees: to_hotspots(&in_deg),
    };

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::CallGraph,
        100,
        total,
        total,
        "调用图构建完成",
    );
    Ok(summary)
}

/// 列出调用边（画布调用链画像用）
#[tauri::command(async)]
pub fn list_call_edges(
    analysis_id: String,
    edge_repo: State<'_, Arc<SqliteProjectCallEdgeRepository>>,
) -> AppResult<Vec<CallEdge>> {
    edge_repo.list_by_analysis(&analysis_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// joern 风格调用图可达性（reachableBy 的轻量移植）
//
// joern 的核心能力之一是 `sink.reachableBy(source)`：在代码属性图(CPG)上做
// 有向可达性遍历，回答「改 X 会炸到谁 / X 又依赖谁」。我们此前只在调用边表上
// 做单层（1 跳）入边查询（见 ImpactAssessTool），没有传递闭包、也没有下游方向。
// 这里把「有界双向 BFS 可达性」做成首个可复用原语，前端 impact 画像与 AI
// impact_assess 工具共用，等价于把 joern 的 reachableBy 下沉成稳定后端查询。
// 纯只读，不改任何表。
// ─────────────────────────────────────────────────────────────────────────────

/// 可达性节点：被遍历到的某个函数符号（不含根自身）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReachabilityNode {
    pub symbol_id: String,
    pub name: String,
    pub file_id: String,
    pub file_path: String,
    /// 距根符号的跳数（1 = 直接相邻）
    pub depth: i64,
    /// root | upstream | downstream
    pub role: String,
}

/// 可达性边：沿遍历方向还原的真实调用边
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReachabilityEdge {
    pub from_symbol_id: String,
    pub to_symbol_id: String,
    pub from_file_id: String,
    pub to_file_id: String,
    pub caller_name: String,
    pub callee_name: String,
    pub line_no: i64,
    /// upstream = 沿「谁依赖我」方向；downstream = 沿「我依赖谁」方向
    pub direction: String,
}

/// 调用图可达性结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallReachabilityResult {
    pub root_symbol_id: String,
    pub root_file_id: String,
    pub direction: String,
    pub max_depth: i64,
    pub nodes: Vec<ReachabilityNode>,
    pub edges: Vec<ReachabilityEdge>,
    pub upstream_count: i64,
    pub downstream_count: i64,
    pub upstream_files: i64,
    pub downstream_files: i64,
}

/// 在调用边集合上做有界 BFS 可达性（joern `sink.reachableBy(source)` 的等价物）。
///
/// - direction="upstream"：从根沿「被调者→调用者」遍历（谁依赖根 → 改根的爆炸半径）。
/// - direction="downstream"：从根沿「调用者→被调者」遍历（根依赖谁 → 根的下游闭包）。
/// - direction="both"：两者都做。
///
/// `roots` 为根符号 id（可多个；文件级影响面会传入文件内全部符号）。
/// 返回中不含根自身；环通过 visited(取最小深度) 自然消解，不会无限递归。
pub fn compute_call_reachability(
    edges: &[CallEdge],
    roots: &[String],
    direction: &str,
    max_depth: usize,
) -> CallReachabilityResult {
    let do_up = direction == "upstream" || direction == "both";
    let do_down = direction == "downstream" || direction == "both";

    // 邻接表：caller -> [callee]（正向/下游）；callee -> [caller]（反向/上游）
    let mut adj_down: HashMap<String, Vec<(String, &CallEdge)>> = HashMap::new();
    let mut adj_up: HashMap<String, Vec<(String, &CallEdge)>> = HashMap::new();
    for e in edges {
        if e.caller_symbol_id.is_empty() || e.callee_symbol_id.is_empty() {
            continue;
        }
        adj_down
            .entry(e.caller_symbol_id.clone())
            .or_default()
            .push((e.callee_symbol_id.clone(), e));
        adj_up
            .entry(e.callee_symbol_id.clone())
            .or_default()
            .push((e.caller_symbol_id.clone(), e));
    }

    let (mut nodes, mut edges_out) = (Vec::new(), Vec::new());
    let mut up_files: HashSet<String> = HashSet::new();
    let mut down_files: HashSet<String> = HashSet::new();

    if do_up {
        let (n, e) = bfs_dir(&adj_up, roots, max_depth, "upstream");
        for x in &n {
            if !x.file_id.is_empty() {
                up_files.insert(x.file_id.clone());
            }
        }
        nodes.extend(n);
        edges_out.extend(e);
    }
    if do_down {
        let (n, e) = bfs_dir(&adj_down, roots, max_depth, "downstream");
        for x in &n {
            if !x.file_id.is_empty() {
                down_files.insert(x.file_id.clone());
            }
        }
        nodes.extend(n);
        edges_out.extend(e);
    }

    let upstream_count = nodes.iter().filter(|n| n.role == "upstream").count() as i64;
    let downstream_count = nodes.iter().filter(|n| n.role == "downstream").count() as i64;

    CallReachabilityResult {
        root_symbol_id: roots.first().cloned().unwrap_or_default(),
        root_file_id: String::new(),
        direction: direction.to_string(),
        max_depth: max_depth as i64,
        nodes,
        edges: edges_out,
        upstream_count,
        downstream_count,
        upstream_files: up_files.len() as i64,
        downstream_files: down_files.len() as i64,
    }
}

/// 单方向有界 BFS。`role` 决定节点取调用边 caller 还是 callee 一侧的标识。
fn bfs_dir(
    adj: &HashMap<String, Vec<(String, &CallEdge)>>,
    roots: &[String],
    max_depth: usize,
    role: &str,
) -> (Vec<ReachabilityNode>, Vec<ReachabilityEdge>) {
    let mut visited: HashMap<String, i64> = HashMap::new();
    let mut queue: Vec<(String, i64)> = Vec::new();
    for r in roots {
        if !visited.contains_key(r) {
            visited.insert(r.clone(), 0);
            queue.push((r.clone(), 0));
        }
    }
    let mut nodes = Vec::new();
    let mut edges_out = Vec::new();
    let mut head = 0;
    while head < queue.len() {
        let (cur, depth) = queue[head].clone();
        head += 1;
        if depth >= max_depth as i64 {
            continue;
        }
        if let Some(neighbors) = adj.get(&cur) {
            for (nxt, e) in neighbors {
                let nd = depth + 1;
                let is_new = match visited.get(nxt) {
                    Some(&d) => nd < d,
                    None => true,
                };
                if is_new {
                    visited.insert(nxt.clone(), nd);
                    queue.push((nxt.clone(), nd));
                    let (name, file_id, file_path) = if role == "upstream" {
                        (
                            e.caller_name.clone(),
                            e.caller_file_id.clone(),
                            e.caller_file_path.clone(),
                        )
                    } else {
                        (
                            e.callee_name.clone(),
                            e.callee_file_id.clone(),
                            e.callee_file_path.clone(),
                        )
                    };
                    nodes.push(ReachabilityNode {
                        symbol_id: nxt.clone(),
                        name,
                        file_id,
                        file_path,
                        depth: nd,
                        role: role.to_string(),
                    });
                    edges_out.push(ReachabilityEdge {
                        from_symbol_id: e.caller_symbol_id.clone(),
                        to_symbol_id: e.callee_symbol_id.clone(),
                        from_file_id: e.caller_file_id.clone(),
                        to_file_id: e.callee_file_id.clone(),
                        caller_name: e.caller_name.clone(),
                        callee_name: e.callee_name.clone(),
                        line_no: e.line_no,
                        direction: role.to_string(),
                    });
                }
            }
        }
    }
    (nodes, edges_out)
}

/// joern 风格调用图可达性查询：给定根符号/根文件，返回有界可达子图（双向、深度受限、防环）。
/// 纯只读，不改任何表；前端 impact 画像与 AI impact_assess 工具共用此原语。
#[tauri::command(async)]
pub fn query_call_reachability(
    analysis_id: String,
    root_symbol_id: Option<String>,
    root_file_id: Option<String>,
    direction: Option<String>,
    max_depth: Option<usize>,
    edge_repo: State<'_, Arc<SqliteProjectCallEdgeRepository>>,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<CallReachabilityResult> {
    let edges = edge_repo.list_by_analysis(&analysis_id).unwrap_or_default();
    let dir = direction.unwrap_or_else(|| "both".to_string());
    let depth = max_depth.unwrap_or(6).clamp(1, 12);

    // 解析根符号：符号级 = 单根；文件级 = 该文件全部参与调用图的符号
    let mut roots: Vec<String> = Vec::new();
    if let Some(sid) = &root_symbol_id {
        if !sid.is_empty() {
            roots.push(sid.clone());
        }
    }
    if let Some(fid) = &root_file_id {
        if !fid.is_empty() {
            let syms = symbol_repo
                .list_by_analysis(&analysis_id)
                .unwrap_or_default();
            for s in syms {
                if s.file_id == *fid {
                    roots.push(s.id);
                }
            }
        }
    }

    if roots.is_empty() {
        return Ok(CallReachabilityResult {
            root_symbol_id: root_symbol_id.unwrap_or_default(),
            root_file_id: root_file_id.unwrap_or_default(),
            direction: dir,
            max_depth: depth as i64,
            nodes: vec![],
            edges: vec![],
            upstream_count: 0,
            downstream_count: 0,
            upstream_files: 0,
            downstream_files: 0,
        });
    }

    let mut res = compute_call_reachability(&edges, &roots, &dir, depth);
    res.root_symbol_id = root_symbol_id.unwrap_or_default();
    res.root_file_id = root_file_id.unwrap_or_default();
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 回放探针共用工具（env-gated 探针之间共享一份实现，避免漂移）─────────
    // 起源：`replay_receiver_vartype_gain` 内首次为还原符号真实 line_end 而写，
    // 现提升为模块级，供所有需要行区间还原的探针复用。
    /// 把注释与字符串内容替换为空格（保留换行），得到可安全做括号配准的掩码文本。
    /// 探针专用：Rust 的 `'a` 生命周期不按字符字面量处理（否则整行偏移）。
    fn probe_mask_code(src: &str, lang: &str) -> String {
        let b = src.as_bytes();
        let mut out = String::with_capacity(src.len());
        let mut i = 0usize;
        while i < b.len() {
            let c = b[i] as char;
            match c {
                '/' if i + 1 < b.len() && b[i + 1] == b'/' => {
                    while i < b.len() && b[i] != b'\n' {
                        out.push(' ');
                        i += 1;
                    }
                }
                '/' if i + 1 < b.len() && b[i + 1] == b'*' => {
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    while i < b.len() {
                        if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'/' {
                            out.push(' ');
                            out.push(' ');
                            i += 2;
                            break;
                        }
                        if b[i] == b'\n' {
                            out.push('\n');
                        } else {
                            out.push(' ');
                        }
                        i += 1;
                    }
                }
                '"' => {
                    out.push('"');
                    i += 1;
                    while i < b.len() && b[i] != b'"' {
                        if b[i] == b'\\' {
                            out.push(' ');
                            out.push(' ');
                            i += 2;
                            continue;
                        }
                        if b[i] == b'\n' {
                            out.push('\n');
                        } else {
                            out.push(' ');
                        }
                        i += 1;
                    }
                    if i < b.len() {
                        out.push('"');
                        i += 1;
                    }
                }
                '`' if lang != "rust" => {
                    out.push('`');
                    i += 1;
                    while i < b.len() && b[i] != b'`' {
                        if b[i] == b'\\' {
                            out.push(' ');
                            out.push(' ');
                            i += 2;
                            continue;
                        }
                        if b[i] == b'\n' {
                            out.push('\n');
                        } else {
                            out.push(' ');
                        }
                        i += 1;
                    }
                    if i < b.len() {
                        out.push('`');
                        i += 1;
                    }
                }
                '\'' if lang != "rust" => {
                    out.push('\'');
                    i += 1;
                    while i < b.len() && b[i] != b'\'' {
                        if b[i] == b'\\' {
                            out.push(' ');
                            out.push(' ');
                            i += 2;
                            continue;
                        }
                        if b[i] == b'\n' {
                            out.push('\n');
                        } else {
                            out.push(' ');
                        }
                        i += 1;
                    }
                    if i < b.len() {
                        out.push('\'');
                        i += 1;
                    }
                }
                _ => {
                    out.push(c);
                    i += 1;
                }
            }
        }
        out
    }

    /// 括号配准：(声明行) → 该行首个 `{` 的配对 `}` 所在行。1-based。
    /// 探针专用，用于还原符号真实的 `line_end`（`SymbolCandidate` 不产出该字段，
    /// 「下一符号行-1」的近似会让类成员不再被类包含，导致类型索引恒空）。
    fn probe_block_ends(masked: &str) -> std::collections::HashMap<usize, usize> {
        // open 行的第一个 `{` 在栈中的下标 → 其闭合行
        let mut stack: Vec<usize> = Vec::new();
        let mut line = 1usize;
        let mut out: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for c in masked.chars() {
            match c {
                '\n' => line += 1,
                '{' => stack.push(line),
                '}' => {
                    if let Some(o) = stack.pop() {
                        // 同一行多个块时，保留最外层（最后一个闭合）不影响，取首个即可
                        out.entry(o).or_insert(line);
                    }
                }
                _ => {}
            }
        }
        out
    }

    #[test]
    fn extracts_plain_calls() {
        let calls = extract_calls("  const r = doWork(a, b);");
        assert_eq!(calls, vec!["doWork"]);
    }

    #[test]
    fn skips_control_flow_keywords() {
        assert!(extract_calls("if (ready) {").is_empty());
        assert!(extract_calls("for (let i = 0; i < n; i++) {").is_empty());
        assert!(extract_calls("} catch (e) {").is_empty());
    }

    #[test]
    fn skips_declarations() {
        assert!(extract_calls("function handleScan(id) {").is_empty());
        assert!(extract_calls("pub fn analyze_call_graph(x: i32) {").is_empty());
    }

    #[test]
    fn skips_comments() {
        assert!(extract_calls("// doWork(a)").is_empty());
        assert!(extract_calls(" * doWork(a)").is_empty());
    }

    #[test]
    fn captures_member_calls() {
        let calls = extract_calls("repo.saveBatch(items);");
        assert!(calls.contains(&"saveBatch".to_string()));
    }

    #[test]
    fn v23_new_and_optional_chain_calls() {
        let calls = extract_calls("const svc = new UserService(new Api(), cfg);");
        assert!(
            calls.contains(&"UserService".to_string()),
            "new 构造调用漏掉: {calls:?}"
        );
        assert!(
            calls.contains(&"Api".to_string()),
            "new 嵌套构造调用漏掉: {calls:?}"
        );
        let calls2 = extract_calls("await api?.refresh?.();");
        assert!(
            calls2.contains(&"refresh".to_string()),
            "可选链调用漏掉: {calls2:?}"
        );
    }

    #[test]
    fn v23_bracket_index_calls() {
        let calls = extract_calls("handlers[\"save\"](payload);");
        assert!(
            calls.contains(&"save".to_string()),
            "方括号索引调用漏掉: {calls:?}"
        );
        let calls2 = extract_calls("handlers['load']();");
        assert!(
            calls2.contains(&"load".to_string()),
            "单引号索引调用漏掉: {calls2:?}"
        );
    }

    #[test]
    fn v23_skips_string_literal_calls() {
        // 字符串里的 ident( 不提取
        let calls = extract_calls("const msg = \"doWork(a)\";");
        assert!(
            !calls.contains(&"doWork".to_string()),
            "字符串内误报: {calls:?}"
        );
        let calls2 = extract_calls("console.log(`call doThing() now`);");
        assert!(
            !calls2.contains(&"doThing".to_string()),
            "模板字符串内误报: {calls2:?}"
        );
        assert!(
            calls2.contains(&"log".to_string()),
            "真实调用漏掉: {calls2:?}"
        );
    }

    #[test]
    fn v23_inline_comment_calls_skipped() {
        let calls = extract_calls("doWork(); // really calls doOther()");
        assert!(calls.contains(&"doWork".to_string()));
        assert!(
            !calls.contains(&"doOther".to_string()),
            "行注释内误报: {calls:?}"
        );
    }

    // ---- extract_calls_ts：接收者感知（对标 joern 调用解析到 methodFullName + 接收者）----

    #[test]
    fn ts_plain_call_captures_no_receiver() {
        let sites = extract_calls_ts("const r = doWork(a, b);");
        assert_eq!(sites.len(), 1, "期望 1 个调用, 实际 {sites:?}");
        assert_eq!(sites[0].callee, "doWork");
        assert_eq!(sites[0].receiver, "");
    }

    #[test]
    fn ts_member_call_captures_receiver_root() {
        let sites = extract_calls_ts("child_process.exec(cmd);");
        let hit = sites
            .iter()
            .find(|s| s.callee == "exec")
            .expect("exec 调用未捕获");
        assert_eq!(
            hit.receiver, "child_process",
            "接收者根标识符应为 child_process"
        );
    }

    #[test]
    fn ts_receiver_root_is_leftmost_chain() {
        let sites = extract_calls_ts("a.b.c.method();");
        let hit = sites
            .iter()
            .find(|s| s.callee == "method")
            .expect("method 调用未捕获");
        assert_eq!(hit.receiver, "a", "链式最左根标识符应为 a");
    }

    #[test]
    fn ts_receiver_reports_reg_exp_exec_not_plain() {
        // 关键回归锁：taintFlow 的 RCE 假阳性根因——同名 exec 必须带接收者区分。
        // 正则对象方法调用 `re.exec` 接收者应为变量 `re`（非空），与裸 `exec()` / `child_process.exec` 区分。
        let sites = extract_calls_ts("const re = /x/; re.exec(input);");
        let hit = sites
            .iter()
            .find(|s| s.callee == "exec")
            .expect("exec 未捕获");
        assert_eq!(
            hit.receiver, "re",
            "正则对象接收者应为 re（非空，区别于裸 exec）"
        );
    }

    #[test]
    fn ts_new_expression_captures_receiver() {
        let sites = extract_calls_ts("const svc = new UserService(new Api(), cfg);");
        let new_svc = sites
            .iter()
            .find(|s| s.callee == "UserService")
            .expect("UserService 构造未捕获");
        assert_eq!(new_svc.receiver, "", "new 构造无接收者");
        let new_api = sites
            .iter()
            .find(|s| s.callee == "Api")
            .expect("Api 嵌套构造未捕获");
        assert_eq!(new_api.receiver, "");
    }

    #[test]
    fn ts_subscript_string_call_captures_receiver() {
        let sites = extract_calls_ts("handlers[\"save\"](payload);");
        let hit = sites
            .iter()
            .find(|s| s.callee == "save")
            .expect("方括号字符串调用未捕获");
        assert_eq!(hit.receiver, "handlers");
    }

    // 真实数据回放（按需运行，不进 CI 常驻断言）：
    // REPLAY_TS_FILE=/abs/path.ts cargo test ts_replay_real_file -- --nocapture
    #[test]
    fn ts_replay_real_file() {
        let path = match std::env::var("REPLAY_TS_FILE") {
            Ok(p) => p,
            Err(_) => return,
        };
        let content = std::fs::read_to_string(&path).expect("read replay file");
        let sites = extract_calls_ts(&content);
        let with_recv = sites.iter().filter(|s| !s.receiver.is_empty()).count();
        eprintln!(
            "[replay] file={} total_calls={} with_receiver={}",
            path,
            sites.len(),
            with_recv
        );
        for s in sites.iter().filter(|s| !s.receiver.is_empty()).take(25) {
            eprintln!("[replay]   {}.{} @{}", s.receiver, s.callee, s.line);
        }
        assert!(!sites.is_empty(), "真实文件应至少含一处调用");
    }

    fn sym(id: &str, name: &str, kind: &str, s: i64, e: i64) -> ProjectSymbol {
        ProjectSymbol {
            id: id.into(),
            analysis_id: "a".into(),
            file_id: "f".into(),
            file_path: "src/a.ts".into(),
            name: name.into(),
            kind: kind.into(),
            line_start: s,
            line_end: e,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: String::new(),
            metadata: "{}".into(),
            created_at: 0,
        }
    }

    #[test]
    fn owner_picks_innermost_symbol() {
        let a = sym("c1", "Widget", "class", 1, 100);
        let b = sym("m1", "render", "method", 10, 20);
        let list = vec![&a, &b];
        assert_eq!(owner_of(&list, 15).unwrap().id, "m1");
        assert_eq!(owner_of(&list, 50).unwrap().id, "c1");
        assert!(owner_of(&list, 200).is_none());
    }

    // ---- extract_calls_ast：跨语言接收者感知（对标 joern CALL.receiver）----

    #[test]
    fn ast_python_captures_member_and_free_calls() {
        let src = "obj.method()\nfree_fn()\na.b.c()\nget_obj().method()\n";
        let sites = extract_calls_ast(Dialect::Python, src);
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        assert_eq!(sites[1].callee, "free_fn");
        assert_eq!(sites[1].receiver, "");
        assert_eq!(sites[2].callee, "c");
        assert_eq!(sites[2].receiver, "a");
        // 链式调用 get_obj().method()：接收者为调用结果，根不稳定 → 置空
        assert_eq!(sites[3].callee, "method");
        assert_eq!(sites[3].receiver, "");
    }

    #[test]
    fn ast_rust_captures_member_and_path_calls() {
        let src = "obj.method();\nmodule::func();\nFoo::new();\n";
        let sites = extract_calls_ast(Dialect::Rust, src);
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // 命名空间路径 module::func()：静态分发，无实例接收者
        assert_eq!(sites[1].callee, "func");
        assert_eq!(sites[1].receiver, "");
        // Foo::new() 构造调用
        assert_eq!(sites[2].callee, "new");
        assert_eq!(sites[2].receiver, "");
    }

    #[test]
    fn ast_go_captures_selector_calls() {
        let src = "pkg.Func()\nobj.Method()\na.b.Method()\n";
        let sites = extract_calls_ast(Dialect::Go, src);
        assert_eq!(sites[0].callee, "Func");
        assert_eq!(sites[0].receiver, "pkg");
        assert_eq!(sites[1].callee, "Method");
        assert_eq!(sites[1].receiver, "obj");
        assert_eq!(sites[2].callee, "Method");
        assert_eq!(sites[2].receiver, "a");
    }

    #[test]
    fn ast_java_captures_method_invocations() {
        let src = "obj.method();\nClass.staticMethod();\nplain();\nnew Foo();\n";
        let sites = extract_calls_ast(Dialect::Java, src);
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        assert_eq!(sites[1].callee, "staticMethod");
        assert_eq!(sites[1].receiver, "Class");
        assert_eq!(sites[2].callee, "plain");
        assert_eq!(sites[2].receiver, "");
        // new Foo() 构造调用
        assert_eq!(sites[3].callee, "Foo");
        assert_eq!(sites[3].receiver, "");
    }

    #[test]
    fn ast_c_captures_member_and_namespace_calls() {
        let src = "obj.method();\nns::func();\n";
        let sites = extract_calls_ast(Dialect::C, src);
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // 命名空间路径 ns::func()：静态分发，无实例接收者
        assert_eq!(sites[1].callee, "func");
        assert_eq!(sites[1].receiver, "");
    }

    // ---- 其余 5 方言：调用提取 + 接收者感知（对标 joern CALL.receiver，纯 AST）----

    #[test]
    fn ast_csharp_captures_invocation_receiver() {
        let src = "var x = obj.Method();\nFoo.Bar();\nvar y = new Foo();\nStatic.Helper();\n";
        let sites = extract_calls_ast(Dialect::CSharp, src);
        // obj.Method() → 实例方法，接收者 obj
        assert_eq!(sites[0].callee, "Method");
        assert_eq!(sites[0].receiver, "obj");
        // Foo.Bar() → 命名空间限定的成员访问，接收者 Foo
        assert_eq!(sites[1].callee, "Bar");
        assert_eq!(sites[1].receiver, "Foo");
        // new Foo() → 构造调用，无实例接收者
        assert_eq!(sites[2].callee, "Foo");
        assert_eq!(sites[2].receiver, "");
        // Static.Helper() → 接收者 Static
        assert_eq!(sites[3].callee, "Helper");
        assert_eq!(sites[3].receiver, "Static");
    }

    #[test]
    fn ast_php_captures_member_static_and_ctor() {
        let src =
            "<?php\n$x = $obj->method();\nFoo::staticMethod();\nfree_fn();\n$inst = new Foo();\n";
        let sites = extract_calls_ast(Dialect::Php, src);
        // $obj->method() → 实例方法，接收者 obj（去 $ 前缀）
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // Foo::staticMethod() → 静态调用，无实例接收者
        assert_eq!(sites[1].callee, "staticMethod");
        assert_eq!(sites[1].receiver, "");
        // free_fn() → 自由函数（function_call_expression）
        assert_eq!(sites[2].callee, "free_fn");
        assert_eq!(sites[2].receiver, "");
        // new Foo() → 构造调用
        assert_eq!(sites[3].callee, "Foo");
        assert_eq!(sites[3].receiver, "");
    }

    #[test]
    fn ast_ruby_captures_call_receiver_and_chained() {
        // 注意：Ruby 裸标识符 `free_fn`（无 ()/接收者）不是 call 节点，tree-sitter 仅捕获显式调用语法。
        let src = "obj.method\nobj.foo.bar\nFoo.new\n";
        let sites = extract_calls_ast(Dialect::Ruby, src);
        // obj.method → 实例方法，接收者 obj
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // obj.foo.bar → 链式调用：外层 bar（接收者根为 obj）+ 内层 foo（接收者 obj）
        assert_eq!(sites[1].callee, "bar");
        assert_eq!(sites[1].receiver, "obj");
        assert_eq!(sites[2].callee, "foo");
        assert_eq!(sites[2].receiver, "obj");
        // Foo.new → 常量接收者 Foo
        assert_eq!(sites[3].callee, "new");
        assert_eq!(sites[3].receiver, "Foo");
    }

    #[test]
    fn ast_swift_captures_navigation_receiver() {
        let src = "let x = obj.method()\nFoo.bar()\nplain()\nlet y = MyClass()\n";
        let sites = extract_calls_ast(Dialect::Swift, src);
        // obj.method() → 导航表达式，接收者 obj
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // Foo.bar() → 接收者 Foo
        assert_eq!(sites[1].callee, "bar");
        assert_eq!(sites[1].receiver, "Foo");
        // plain() → 自由函数
        assert_eq!(sites[2].callee, "plain");
        assert_eq!(sites[2].receiver, "");
        // MyClass() → 构造调用
        assert_eq!(sites[3].callee, "MyClass");
        assert_eq!(sites[3].receiver, "");
    }

    #[test]
    fn ast_kotlin_captures_navigation_receiver() {
        let src = "val x = obj.method()\nFoo.bar()\nplain()\nval y = MyClass()\n";
        let sites = extract_calls_ast(Dialect::Kotlin, src);
        // obj.method() → navigation_expression，接收者 obj
        assert_eq!(sites[0].callee, "method");
        assert_eq!(sites[0].receiver, "obj");
        // Foo.bar() → 接收者 Foo
        assert_eq!(sites[1].callee, "bar");
        assert_eq!(sites[1].receiver, "Foo");
        // plain() → 自由函数
        assert_eq!(sites[2].callee, "plain");
        assert_eq!(sites[2].receiver, "");
        // MyClass() → 构造调用
        assert_eq!(sites[3].callee, "MyClass");
        assert_eq!(sites[3].receiver, "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 接收者感知解析（joern DynamicCallLinker/StaticCallLinker 语义）单测
    // ─────────────────────────────────────────────────────────────────────────

    fn mk_sym(id: &str, name: &str, kind: &str, ls: i64, le: i64) -> ProjectSymbol {
        let mut s = ProjectSymbol::default();
        s.id = id.to_string();
        s.file_id = "f".to_string();
        s.file_path = "f".to_string();
        s.name = name.to_string();
        s.kind = kind.to_string();
        s.line_start = ls;
        s.line_end = le;
        s
    }

    #[test]
    fn enclosing_type_returns_innermost() {
        let c = mk_sym("C", "C", "class", 1, 50);
        let i = mk_sym("I", "I", "class", 10, 20);
        let m = mk_sym("m", "m", "method", 12, 18);
        let syms = vec![&c, &i];
        let got = enclosing_type(syms.as_slice(), &m);
        assert_eq!(got.unwrap().id, "I");
    }

    #[test]
    fn callee_receiver_type_is_enclosing_class() {
        // 对标 joern 动态分派超近似：我们给出精确接收者类型名。
        let c = mk_sym("C", "C", "class", 1, 50);
        let foo = mk_sym("C.foo", "foo", "method", 5, 10);
        let mut type_syms_by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        type_syms_by_file.insert("f".to_string(), vec![&c]);
        let ctx = CallResolutionCtx {
            type_by_name: HashMap::new(),
            methods_by_type_id: HashMap::new(),
            type_syms_by_file,
            rust_impl_methods: HashMap::new(),
            rust_caller_impl: HashMap::new(),
            go_method_by_type: HashMap::new(),
            go_caller_receiver: HashMap::new(),
            go_method_owner_type: HashMap::new(),
        };
        assert_eq!(callee_receiver_type(&ctx, &foo), "C");
        // 游离函数无 enclosing 类型 → 空串（区别于 joern 超近似把所有候选都算上）
        let free = mk_sym("free", "free", "function", 60, 65);
        assert_eq!(callee_receiver_type(&ctx, &free), "");
    }

    #[test]
    fn ts_this_resolves_to_class_method_not_free_function() {
        // class C { foo(){} caller(){ this.foo() } }  +  游离 function foo()
        let c = mk_sym("C", "C", "class", 1, 30);
        let foo_method = mk_sym("C.foo", "foo", "method", 2, 6);
        let free_foo = mk_sym("free.foo", "foo", "function", 40, 45);
        let caller = mk_sym("C.caller", "caller", "method", 10, 25);
        let mut type_syms_by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        type_syms_by_file.insert("f".to_string(), vec![&c]);
        let mut type_by_name: HashMap<(String, String), &ProjectSymbol> = HashMap::new();
        type_by_name.insert(("f".to_string(), "C".to_string()), &c);
        let mut methods_by_type_id: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        methods_by_type_id.insert(c.id.clone(), vec![&foo_method, &caller]);
        let ctx = CallResolutionCtx {
            type_by_name,
            methods_by_type_id,
            type_syms_by_file,
            rust_impl_methods: HashMap::new(),
            rust_caller_impl: HashMap::new(),
            go_method_by_type: HashMap::new(),
            go_caller_receiver: HashMap::new(),
            go_method_owner_type: HashMap::new(),
        };
        // this.foo() 应解析到类方法 C.foo，而非游离 free.foo
        let got = resolve_receiver_target(&ctx, "foo", "this", &caller, "f");
        assert_eq!(got.unwrap().id, "C.foo");
        // 类上无此方法的 this 调用应回退（返回 None）
        let none = resolve_receiver_target(&ctx, "nope", "this", &caller, "f");
        assert!(none.is_none());
    }

    #[test]
    fn ts_static_dispatch_resolves_to_type_method() {
        // Type.method() 静态分发：接收者是类型名
        let c = mk_sym("C", "C", "class", 1, 30);
        let foo_method = mk_sym("C.foo", "foo", "method", 2, 6);
        let mut type_syms_by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        type_syms_by_file.insert("f".to_string(), vec![&c]);
        let mut type_by_name: HashMap<(String, String), &ProjectSymbol> = HashMap::new();
        type_by_name.insert(("f".to_string(), "C".to_string()), &c);
        let mut methods_by_type_id: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        methods_by_type_id.insert(c.id.clone(), vec![&foo_method]);
        let ctx = CallResolutionCtx {
            type_by_name,
            methods_by_type_id,
            type_syms_by_file,
            rust_impl_methods: HashMap::new(),
            rust_caller_impl: HashMap::new(),
            go_method_by_type: HashMap::new(),
            go_caller_receiver: HashMap::new(),
            go_method_owner_type: HashMap::new(),
        };
        let got = resolve_receiver_target(&ctx, "foo", "C", &foo_method, "f");
        assert_eq!(got.unwrap().id, "C.foo");
    }

    #[test]
    fn rust_self_and_static_dispatch_via_impl_index() {
        let content = "struct Foo;\nimpl Foo {\n    fn bar(&self) {}\n    fn run(&self) {\n        self.bar();\n    }\n}\n";
        // 与 symbol 抽取一致：fn bar 在第 3 行、fn run 在第 4 行
        let bar = mk_sym("Foo.bar", "bar", "method", 3, 3);
        let run = mk_sym("Foo.run", "run", "method", 4, 6);
        let fsyms = vec![&bar, &run];
        let (rust_impl_methods, rust_caller_impl) =
            collect_rust_impl_associations(content, "f", fsyms.as_slice());
        // impl Foo 索引应含 bar、run，且 run 的 self 归属 Foo
        assert!(
            rust_impl_methods
                .get(&("f".to_string(), "Foo".to_string()))
                .map(|v| v.len())
                .unwrap_or(0)
                == 2
        );
        assert_eq!(
            rust_caller_impl.get(&("f".to_string(), 4i64)).unwrap(),
            "Foo"
        );
        let ctx = CallResolutionCtx {
            type_by_name: HashMap::new(),
            methods_by_type_id: HashMap::new(),
            type_syms_by_file: HashMap::new(),
            rust_impl_methods,
            rust_caller_impl,
            go_method_by_type: HashMap::new(),
            go_caller_receiver: HashMap::new(),
            go_method_owner_type: HashMap::new(),
        };
        // self.bar() 解析到 Foo.bar
        let got_self = resolve_receiver_target(&ctx, "bar", "self", &run, "f");
        assert_eq!(got_self.unwrap().id, "Foo.bar");
        // Foo::bar() 静态分发解析到 Foo.bar
        let got_static = resolve_receiver_target(&ctx, "bar", "Foo", &run, "f");
        assert_eq!(got_static.unwrap().id, "Foo.bar");
    }

    #[test]
    fn go_receiver_dispatch_resolves_to_correct_type() {
        // 对标 joern gosrc2cpg：func (s *Store) Helper 内 s.validate()
        // → Store.validate（而非同名 Other.validate；name-match 在两个 validate 时无法唯一锁定）。
        let helper = mk_sym("Store.helper", "helper", "method", 3, 8);
        let s_validate = mk_sym("Store.validate", "validate", "method", 4, 6);
        let o_validate = mk_sym("Other.validate", "validate", "method", 10, 12);
        let mut go_method_by_type: HashMap<(String, String), Vec<&ProjectSymbol>> = HashMap::new();
        go_method_by_type.insert(("f".to_string(), "Store".to_string()), vec![&s_validate]);
        go_method_by_type.insert(("f".to_string(), "Other".to_string()), vec![&o_validate]);
        let mut go_caller_receiver: HashMap<(String, i64), (String, String)> = HashMap::new();
        go_caller_receiver.insert(
            ("f".to_string(), 3i64),
            ("s".to_string(), "Store".to_string()),
        );
        let mut go_method_owner_type: HashMap<(String, i64), String> = HashMap::new();
        go_method_owner_type.insert(("f".to_string(), 4i64), "Store".to_string());
        let ctx = CallResolutionCtx {
            type_by_name: HashMap::new(),
            methods_by_type_id: HashMap::new(),
            type_syms_by_file: HashMap::new(),
            rust_impl_methods: HashMap::new(),
            rust_caller_impl: HashMap::new(),
            go_method_by_type,
            go_caller_receiver,
            go_method_owner_type,
        };
        let got = resolve_receiver_target(&ctx, "validate", "s", &helper, "f");
        assert_eq!(got.map(|m| m.id.as_str()), Some("Store.validate"));
        // 影响面板限定名应为接收者声明类型（joern 动态分派超近似所丢失的信息）
        assert_eq!(callee_receiver_type(&ctx, &s_validate), "Store");
    }

    #[test]
    fn go_receiver_name_mismatch_falls_back_to_none() {
        // `other.validate()` 中 other != caller 接收者名 s → 不应误解析为 Store.validate
        let helper = mk_sym("Store.helper", "helper", "method", 3, 8);
        let s_validate = mk_sym("Store.validate", "validate", "method", 4, 6);
        let mut go_method_by_type: HashMap<(String, String), Vec<&ProjectSymbol>> = HashMap::new();
        go_method_by_type.insert(("f".to_string(), "Store".to_string()), vec![&s_validate]);
        let mut go_caller_receiver: HashMap<(String, i64), (String, String)> = HashMap::new();
        go_caller_receiver.insert(
            ("f".to_string(), 3i64),
            ("s".to_string(), "Store".to_string()),
        );
        let ctx = CallResolutionCtx {
            type_by_name: HashMap::new(),
            methods_by_type_id: HashMap::new(),
            type_syms_by_file: HashMap::new(),
            rust_impl_methods: HashMap::new(),
            rust_caller_impl: HashMap::new(),
            go_method_by_type,
            go_caller_receiver,
            go_method_owner_type: HashMap::new(),
        };
        // 接收者 "other" 不等于 caller 接收者名 "s" → Go 分支不命中，回退 None（由名匹配兜底）
        let got = resolve_receiver_target(&ctx, "validate", "other", &helper, "f");
        assert!(got.is_none());
    }

    #[test]
    fn collect_go_receiver_associations_parses_pointer_and_value() {
        let content = "\
type Store struct{ db Db }
func (s *Store) Get(id int) Item { return s.db.get(id) }
func (r Store) Put(item Item) { r.db.put(item) }
func NewStore() *Store { return &Store{} }
";
        let get = mk_sym("Store.Get", "Get", "method", 2, 2);
        let put = mk_sym("Store.Put", "Put", "method", 3, 3);
        let fsyms = vec![&get, &put];
        let (mbt, cr, mot) = collect_go_receiver_associations(content, "f", fsyms.as_slice());
        // 指针接收者 *Store 去 * → Store；值接收者 Store 同键
        assert!(
            mbt.get(&("f".to_string(), "Store".to_string()))
                .map(|v| v.len())
                .unwrap_or(0)
                == 2
        );
        // caller 接收者名/类型
        assert_eq!(
            cr.get(&("f".to_string(), 2i64)),
            Some(&("s".to_string(), "Store".to_string()))
        );
        assert_eq!(
            cr.get(&("f".to_string(), 3i64)),
            Some(&("r".to_string(), "Store".to_string()))
        );
        // 影响面板 owner 类型
        assert_eq!(
            mot.get(&("f".to_string(), 2i64)),
            Some(&"Store".to_string())
        );
    }

    // ── Naive 兜底层（对标 joern NaiveCallLinker）────────────────────────
    fn nsym(id: &str, name: &str, kind: &str, path: &str) -> ProjectSymbol {
        let mut s = ProjectSymbol::default();
        s.id = id.to_string();
        s.name = name.to_string();
        s.kind = kind.to_string();
        s.file_path = path.to_string();
        s
    }

    /// 就地构造名索引（避免 unsafe 的生命周期延长）
    macro_rules! name_idx {
        ($($k:expr => [$($v:expr),+ $(,)?]),+ $(,)?) => {{
            let mut m: HashMap<&str, Vec<&ProjectSymbol>> = HashMap::new();
            $( m.insert($k, vec![$($v),+]); )+
            m
        }};
    }

    #[test]
    fn dir_of_strips_last_segment() {
        assert_eq!(dir_of("a/b/c.rs"), "a/b");
        assert_eq!(dir_of("c.rs"), "");
        assert_eq!(dir_of("./a/b/c.rs"), "a/b");
    }

    #[test]
    fn naive_tier_l1_same_dir_unique_resolves() {
        let a = nsym("a", "helper", "function", "src/mod/a.rs");
        let b = nsym("b", "helper", "function", "src/other/b.rs");
        let c = nsym("c", "helper", "function", "src/third/c.rs");
        let by = name_idx! { "helper" => [&a, &b, &c] };
        let got = resolve_naive_tier(&by, "helper", "src/other", "");
        assert_eq!(got.map(|s| s.id.as_str()), Some("b"));
    }

    #[test]
    fn naive_tier_l1_same_dir_ambiguous_gives_up() {
        // 同目录两个同名候选 → L1 不唯一；L2 三个都是 function 也不唯一 → 保守放弃
        let a = nsym("a", "helper", "function", "src/other/a.rs");
        let b = nsym("b", "helper", "function", "src/other/b.rs");
        let c = nsym("c", "helper", "function", "src/third/c.rs");
        let by = name_idx! { "helper" => [&a, &b, &c] };
        assert!(resolve_naive_tier(&by, "helper", "src/other", "").is_none());
    }

    #[test]
    fn naive_tier_l2_free_call_picks_unique_function() {
        // 自由调用 insert() 不可能是 method：多个 method 里挑出唯一那个 function
        let m1 = nsym("m1", "insert", "method", "src/x/a.rs");
        let m2 = nsym("m2", "insert", "method", "src/y/b.rs");
        let f1 = nsym("f1", "insert", "function", "src/z/c.rs");
        let by = name_idx! { "insert" => [&m1, &m2, &f1] };
        let got = resolve_naive_tier(&by, "insert", "src/w", "");
        assert_eq!(got.map(|s| s.id.as_str()), Some("f1"));
    }

    #[test]
    fn naive_tier_l2_member_call_picks_unique_method() {
        // 成员调用 obj.parse() 不可能是自由 function：多个 function 里挑出唯一那个 method
        let m1 = nsym("m1", "parse", "method", "src/x/a.rs");
        let f1 = nsym("f1", "parse", "function", "src/q/b.rs");
        let f2 = nsym("f2", "parse", "function", "src/r/c.rs");
        let by = name_idx! { "parse" => [&m1, &f1, &f2] };
        let got = resolve_naive_tier(&by, "parse", "src/w", "obj");
        assert_eq!(got.map(|s| s.id.as_str()), Some("m1"));
    }

    #[test]
    fn naive_tier_l2_kind_ambiguous_gives_up() {
        let f1 = nsym("f1", "run", "function", "src/q/a.rs");
        let f2 = nsym("f2", "run", "function", "src/r/b.rs");
        let by = name_idx! { "run" => [&f1, &f2] };
        assert!(resolve_naive_tier(&by, "run", "src/w", "").is_none());
    }

    #[test]
    fn naive_tier_no_candidate_gives_up() {
        let by: HashMap<&str, Vec<&ProjectSymbol>> = HashMap::new();
        assert!(resolve_naive_tier(&by, "nope", "src/w", "").is_none());
    }

    #[test]
    fn naive_tier_single_candidate_left_to_global_layer() {
        // 恰好 1 个候选是「全局唯一」层的职责，Naive 层不重复介入
        let f1 = nsym("f1", "only_one", "function", "src/q/a.rs");
        let by = name_idx! { "only_one" => [&f1] };
        assert!(resolve_naive_tier(&by, "only_one", "src/q", "").is_none());
    }

    // ── 通配（整模块）导入索引：build_glob_import_index ──────────────────
    // 对标 joern `JavaScriptImportResolverPass.isImportingModule` 分支：
    // 「If we are importing the whole module, we need to load all entities」。

    fn mk_file(id: &str, rel: &str) -> ProjectFile {
        let mut f = ProjectFile::default();
        f.id = id.to_string();
        f.rel_path = rel.to_string();
        f.path = format!("/proj/{rel}");
        f.is_directory = false;
        f
    }

    fn mk_ref(from: &str, name: &str, to_path: &str, to_sym: Option<&str>) -> SymbolRef {
        SymbolRef {
            id: format!("ref_{from}_{name}"),
            analysis_id: "a".into(),
            from_file_id: from.into(),
            from_file_path: String::new(),
            to_symbol_id: to_sym.map(|s| s.to_string()),
            to_file_id: String::new(),
            to_file_path: to_path.into(),
            symbol_name: name.into(),
            ref_line: 1,
            ref_text: String::new(),
            kind: "import".into(),
            created_at: 0,
        }
    }

    /// 带 file_id 的符号构造：`nsym` 只设 `file_path`，而通配索引按 `file_id` 分桶
    fn nsym_in(id: &str, name: &str, kind: &str, file_id: &str) -> ProjectSymbol {
        let mut s = nsym(id, name, kind, "");
        s.file_id = file_id.to_string();
        s
    }

    /// 组装索引所需的四个入参（file_id_by_rel / file_by_rel 借用 files）
    #[allow(clippy::type_complexity)]
    fn glob_fixture<'a>(
        syms: &'a [ProjectSymbol],
        files: &'a [ProjectFile],
    ) -> (
        HashMap<String, Vec<&'a ProjectSymbol>>,
        HashMap<&'a str, &'a ProjectSymbol>,
        HashMap<&'a str, &'a str>,
        HashMap<String, &'a ProjectFile>,
    ) {
        let mut by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        let mut by_id: HashMap<&str, &ProjectSymbol> = HashMap::new();
        for s in syms {
            by_file.entry(s.file_id.clone()).or_default().push(s);
            by_id.insert(s.id.as_str(), s);
        }
        let mut fid: HashMap<&str, &str> = HashMap::new();
        let mut fbr: HashMap<String, &ProjectFile> = HashMap::new();
        for f in files {
            fid.insert(f.rel_path.as_str(), f.id.as_str());
            fbr.insert(f.rel_path.clone(), f);
        }
        (by_file, by_id, fid, fbr)
    }

    #[test]
    fn glob_index_empty_when_no_wildcard_import() {
        // 没有通配导入 → 索引为空，零开销
        let s1 = nsym("s1", "foo", "function", "src/a.rs");
        let files = vec![mk_file("f1", "src/a.rs")];
        let syms = [s1.clone()];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        let refs = vec![mk_ref("f1", "foo", "src/a.rs", Some("s1"))];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert!(g.is_empty());
    }

    #[test]
    fn glob_index_adopts_module_own_symbols() {
        // `use crate::util::*;` → util.rs 里定义的 helper 对消费方可见
        let cons = mk_file("fc", "src/main.rs");
        let module = mk_file("fm", "src/util.rs");
        let helper = nsym_in("sh", "helper", "function", "fm");
        let files = vec![cons, module];
        let syms = [helper.clone()];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        // 通配导入行：symbol_name 为空、to_file_path 指向模块
        let refs = vec![mk_ref("fc", "", "src/util.rs", None)];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert_eq!(
            g.get(&("fc".to_string(), "helper".to_string()))
                .copied()
                .map(|s| s.id.as_str()),
            Some("sh")
        );
    }

    #[test]
    fn glob_index_adopts_named_reexports_of_module() {
        // mod.rs 自身零符号，靠点名再导出（`pub use pool::RedisPool;`）转发
        // —— 本仓实测形态，只沿通配下钻会收益为 0，故必须收养点名再导出。
        let cons = mk_file("fc", "src/h.rs");
        let module = mk_file("fm", "src/db/mod.rs");
        let pool = nsym("sp", "RedisPool", "struct", "src/db/pool.rs");
        let files = vec![cons, module];
        let syms = [pool.clone()];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        let refs = vec![
            mk_ref("fc", "", "src/db/mod.rs", None), // 消费方通配导入
            mk_ref("fm", "RedisPool", "src/db/pool.rs", Some("sp")), // mod.rs 点名再导出
        ];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert_eq!(
            g.get(&("fc".to_string(), "RedisPool".to_string()))
                .copied()
                .map(|s| s.id.as_str()),
            Some("sp")
        );
    }

    #[test]
    fn glob_index_drops_ambiguous_names() {
        // 收养到的两个候选不是同一个符号 → 整名丢弃（宁可不连也不连错）
        let cons = mk_file("fc", "src/main.rs");
        let m1 = mk_file("f1", "src/a.rs");
        let m2 = mk_file("f2", "src/b.rs");
        let dup1 = nsym_in("d1", "dup", "function", "f1");
        let dup2 = nsym_in("d2", "dup", "function", "f2");
        let files = vec![cons, m1, m2];
        let syms = [dup1, dup2];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        let refs = vec![
            mk_ref("fc", "", "src/a.rs", None),
            mk_ref("fc", "", "src/b.rs", None),
        ];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert!(g.get(&("fc".to_string(), "dup".to_string())).is_none());
    }

    #[test]
    fn glob_index_same_symbol_from_two_paths_is_not_ambiguous() {
        // 同一符号经两条路径收养（模块自身定义 + 点名再导出）→ 不算歧义
        let cons = mk_file("fc", "src/main.rs");
        let module = mk_file("fm", "src/util.rs");
        let helper = nsym_in("sh", "helper", "function", "fm");
        let files = vec![cons, module];
        let syms = [helper];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        let refs = vec![
            mk_ref("fc", "", "src/util.rs", None),
            mk_ref("fm", "helper", "src/util.rs", Some("sh")),
        ];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert!(g.get(&("fc".to_string(), "helper".to_string())).is_some());
    }

    #[test]
    fn glob_index_is_scoped_per_consumer() {
        // 索引按消费方隔离：A 的通配导入不该让 B 也看见
        let ca = mk_file("fa", "src/a.rs");
        let cb = mk_file("fb", "src/b.rs");
        let module = mk_file("fm", "src/util.rs");
        let helper = nsym_in("sh", "helper", "function", "fm");
        let files = vec![ca, cb, module];
        let syms = [helper];
        let (by_file, by_id, fid, fbr) = glob_fixture(&syms, &files);
        let refs = vec![mk_ref("fa", "", "src/util.rs", None)];
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_glob_import_index(&refs, &by_file, &by_id, &fid, &fbr, &cache);
        assert!(g.get(&("fa".to_string(), "helper".to_string())).is_some());
        assert!(g.get(&("fb".to_string(), "helper".to_string())).is_none());
    }

    // ── Go 包名/别名限定调用索引：build_go_pkg_call_index ─────────────────
    // 全部用真实临时文件（索引 `cache.read` 走磁盘），用完即删，仓库零污染。

    /// 在临时目录里铺一组 Go 源文件，返回 (临时目录, ProjectFile 列表)。
    /// `content_by_rel` 以仓库相对路径为键。
    fn go_fixture(
        tag: &str,
        content_by_rel: &[(&str, &str)],
    ) -> (std::path::PathBuf, Vec<ProjectFile>) {
        let base = std::env::temp_dir().join(format!("ps_go_pkg_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let mut files = Vec::new();
        for (i, (rel, content)) in content_by_rel.iter().enumerate() {
            let abs = base.join(rel);
            std::fs::create_dir_all(abs.parent().unwrap()).expect("mk dir");
            std::fs::write(&abs, content).expect("write file");
            let mut f = ProjectFile::default();
            f.id = format!("gf{i}");
            f.rel_path = rel.to_string();
            f.path = abs.to_string_lossy().to_string();
            f.language = Some("go".to_string());
            f.is_directory = false;
            files.push(f);
        }
        (base, files)
    }

    #[test]
    fn go_pkg_index_separates_same_named_funcs_across_packages() {
        // 核心缺陷回归：`static.CallGraph()` 与 `cha.CallGraph()` 此前因裸名
        // `imported` 层后写覆盖先写，双双 collapse 到同一个包。
        let (base, files) = go_fixture(
            "split",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport (\n\t\"myproj/go/callgraph/cha\"\n\t\"myproj/go/callgraph/static\"\n)\n\nfunc main() {\n\t_ = static.CallGraph(nil)\n\t_ = cha.CallGraph(nil)\n}\n",
                ),
                ("go/callgraph/static/static.go", "package static\n\nfunc CallGraph(x int) int { return x }\n"),
                ("go/callgraph/cha/cha.go", "package cha\n\nfunc CallGraph(x int) int { return x }\n"),
            ],
        );
        let s_static = nsym_in("s1", "CallGraph", "function", "gf1");
        let s_cha = nsym_in("s2", "CallGraph", "function", "gf2");
        let syms = [s_static, s_cha];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        let got_static = g.get(&(
            "gf0".to_string(),
            "static".to_string(),
            "CallGraph".to_string(),
        ));
        let got_cha = g.get(&(
            "gf0".to_string(),
            "cha".to_string(),
            "CallGraph".to_string(),
        ));
        assert_eq!(
            got_static.map(|s| s.id.as_str()),
            Some("s1"),
            "static.CallGraph 须连到 static 包"
        );
        assert_eq!(
            got_cha.map(|s| s.id.as_str()),
            Some("s2"),
            "cha.CallGraph 须连到 cha 包"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_honors_explicit_alias() {
        // joern CommonCacheBuilder.scala:106-110：有别名用别名（而非路径末段）
        let (base, files) = go_fixture(
            "alias",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport st \"myproj/internal/store\"\n\nfunc main() {\n\t_ = st.Open()\n}\n",
                ),
                ("internal/store/store.go", "package store\n\nfunc Open() int { return 1 }\n"),
            ],
        );
        let s_open = nsym_in("s1", "Open", "function", "gf1");
        let syms = [s_open];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(
            g.get(&("gf0".to_string(), "st".to_string(), "Open".to_string()))
                .is_some(),
            "别名 st 必须可查"
        );
        assert!(
            g.get(&("gf0".to_string(), "store".to_string(), "Open".to_string()))
                .is_none(),
            "别名生效时不应再按路径末段登记"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_indexes_qualified_type_position() {
        // 类型位置 `var c store.Client` 的 AST 节点是 qualified_type（非 selector_expression），
        // 漏掉它类型引用会整片消失（此前已踩过一次坑，此处锁死）。
        let (base, files) = go_fixture(
            "qtype",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport \"myproj/internal/store\"\n\nfunc main() {\n\tvar c store.Client\n\t_ = c\n}\n",
                ),
                ("internal/store/store.go", "package store\n\ntype Client struct{}\n\nfunc New() *Client { return nil }\n"),
            ],
        );
        let s_client = nsym_in("s1", "Client", "struct", "gf1");
        let syms = [s_client];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(
            g.get(&("gf0".to_string(), "store".to_string(), "Client".to_string()))
                .is_some(),
            "类型位置的 store.Client 必须登记"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_drops_ambiguous_member_within_package() {
        // 同一包内（多个文件）有两个同名可调用符号 → 整名丢弃，宁可不连也不连错
        let (base, files) = go_fixture(
            "ambig",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport \"myproj/pkg/util\"\n\nfunc main() {\n\tutil.Run()\n}\n",
                ),
                ("pkg/util/a.go", "package util\n\nfunc Run() {}\n"),
                ("pkg/util/b.go", "package util\n\nfunc Run() {}\n"),
            ],
        );
        let r1 = nsym_in("s1", "Run", "function", "gf1");
        let r2 = nsym_in("s2", "Run", "function", "gf2");
        let syms = [r1, r2];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(
            g.get(&("gf0".to_string(), "util".to_string(), "Run".to_string()))
                .is_none(),
            "包内歧义必须丢弃"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_only_indexes_members_actually_used() {
        // 用量驱动：包里定义了 Foo/Bar，但文件只用到 Foo → 只登记 Foo
        let (base, files) = go_fixture(
            "usage",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport \"myproj/pkg/util\"\n\nfunc main() {\n\tutil.Foo()\n}\n",
                ),
                (
                    "pkg/util/util.go",
                    "package util\n\nfunc Foo() {}\n\nfunc Bar() {}\n",
                ),
            ],
        );
        let s_foo = nsym_in("s1", "Foo", "function", "gf1");
        let s_bar = nsym_in("s2", "Bar", "function", "gf1");
        let syms = [s_foo, s_bar];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(g
            .get(&("gf0".to_string(), "util".to_string(), "Foo".to_string()))
            .is_some());
        assert!(g
            .get(&("gf0".to_string(), "util".to_string(), "Bar".to_string()))
            .is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_is_file_scoped() {
        // 与 joern 一致：别名映射是**文件级**的（同一包在别的文件里用不同别名不受影响）
        let (base, files) = go_fixture(
            "scope",
            &[
                (
                    "cmd/a.go",
                    "package main\n\nimport \"myproj/pkg/util\"\n\nfunc A() { util.Foo() }\n",
                ),
                ("cmd/b.go", "package main\n\nfunc B() {}\n"),
                ("pkg/util/util.go", "package util\n\nfunc Foo() {}\n"),
            ],
        );
        let s_foo = nsym_in("s1", "Foo", "function", "gf2");
        let syms = [s_foo];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(g
            .get(&("gf0".to_string(), "util".to_string(), "Foo".to_string()))
            .is_some());
        assert!(g
            .get(&("gf1".to_string(), "util".to_string(), "Foo".to_string()))
            .is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_prefers_most_specific_candidate_dir() {
        // `go_module_candidates` 按「剥离段数递增」产出（最具体优先）。若遍历时无脑
        // `insert`，最宽泛的浅层候选会**最后**写入并覆盖最具体的那个——与其排序意图相反。
        // 本用例：深层 `go/callgraph/static` 与浅层 `static` 同名包同时存在，
        // 必须以深层（更具体）为准。
        let (base, files) = go_fixture(
            "specific",
            &[
                (
                    "cmd/main.go",
                    "package main\n\nimport \"myproj/go/callgraph/static\"\n\nfunc main() {\n\tstatic.Run()\n}\n",
                ),
                ("go/callgraph/static/static.go", "package static\n\nfunc Run() {}\n"),
                ("static/shallow.go", "package static\n\nfunc Run() {}\n"),
            ],
        );
        let deep = nsym_in("s_deep", "Run", "function", "gf1");
        let shallow = nsym_in("s_shallow", "Run", "function", "gf2");
        let syms = [deep, shallow];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert_eq!(
            g.get(&("gf0".to_string(), "static".to_string(), "Run".to_string()))
                .map(|s| s.id.as_str()),
            Some("s_deep"),
            "必须以最具体的目录候选为准，浅层同名包不得覆盖"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn go_pkg_index_empty_for_non_go_files() {
        // 无 Go 文件时索引为空、零开销（不对其它语言产生任何影响）
        let (base, files) = go_fixture(
            "nongo",
            &[("src/main.rs", "fn main() { helper(); }\nfn helper() {}\n")],
        );
        let s = nsym_in("s1", "helper", "function", "gf0");
        let syms = [s];
        let (by_file, _by_id, _fid, _fbr) = glob_fixture(&syms, &files);
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);
        assert!(g.is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }

    // ── 回放探针：调用解析「丢边」分布（env-gated，默认不跑）──────────────
    // 用法：REPLAY_CG_DIR=/abs/path cargo test replay_call_resolution_loss -- --ignored --nocapture
    // 目的：对标 joern NaiveCallLinker(未链接调用按裸名兜底) —— 量化我们
    //      「同名歧义即整条丢弃」策略究竟丢了多少边、哪些能被兜底层救回。
    #[test]
    #[ignore]
    fn replay_call_resolution_loss() {
        use crate::commands::code_structure::extract_symbols;
        use std::collections::BTreeMap;

        let dir = match std::env::var("REPLAY_CG_DIR") {
            Ok(v) if !v.is_empty() => v,
            _ => return,
        };

        fn lang_of(p: &str) -> Option<&'static str> {
            let p = p.to_lowercase();
            for (ext, l) in [
                (".rs", "rust"),
                (".ts", "typescript"),
                (".tsx", "typescript"),
                (".js", "javascript"),
                (".jsx", "javascript"),
                (".py", "python"),
                (".go", "go"),
                (".java", "java"),
                (".c", "c"),
                (".h", "c"),
                (".cpp", "cpp"),
                (".hpp", "cpp"),
                (".cc", "cpp"),
                (".cs", "csharp"),
                (".php", "php"),
                (".rb", "ruby"),
                (".swift", "swift"),
                (".kt", "kotlin"),
            ] {
                if p.ends_with(ext) {
                    return Some(l);
                }
            }
            None
        }

        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if matches!(
                        n,
                        "node_modules"
                            | "target"
                            | "dist"
                            | ".git"
                            | "build"
                            | "vendor"
                            | ".next"
                            | "out"
                    ) {
                        continue;
                    }
                    walk(&p, out);
                } else if p.is_file() && p.to_str().is_some() {
                    out.push(p.to_str().unwrap().to_string());
                }
            }
        }

        struct FileInfo {
            dir: String,
            /// (name, kind, line_start, line_end)
            syms: Vec<(String, String, i64, i64)>,
            /// (callee_name, receiver, line)
            calls: Vec<(String, String, i64)>,
        }

        let mut paths: Vec<String> = Vec::new();
        walk(std::path::Path::new(&dir), &mut paths);

        let mut files: Vec<FileInfo> = Vec::new();
        let mut n_files = 0usize;
        for p in &paths {
            let Some(lang) = lang_of(p) else { continue };
            let Ok(content) = std::fs::read_to_string(p) else {
                continue;
            };
            if content.len() > 2_000_000 {
                continue;
            }
            let total_lines = content.lines().count() as i64;
            let mut sc: Vec<(String, String, i64)> = extract_symbols(lang, &content)
                .into_iter()
                .map(|s| (s.name, s.kind, s.line as i64))
                .collect();
            sc.sort_by_key(|x| x.2);
            let syms: Vec<(String, String, i64, i64)> = sc
                .iter()
                .enumerate()
                .map(|(i, (n, k, l))| {
                    let end = sc.get(i + 1).map(|x| x.2 - 1).unwrap_or(total_lines);
                    (n.clone(), k.clone(), *l, end.max(*l))
                })
                .collect();
            let calls: Vec<(String, String, i64)> = if p.ends_with(".ts")
                || p.ends_with(".tsx")
                || p.ends_with(".js")
                || p.ends_with(".jsx")
            {
                extract_calls_ts(&content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect()
            } else if let Some(d) = dialect_for(lang, p) {
                extract_calls_ast(d, &content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect()
            } else {
                Vec::new()
            };
            let rel = p.strip_prefix(&dir).unwrap_or(p.as_str()).to_string();
            let d = std::path::Path::new(&rel)
                .parent()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_default();
            files.push(FileInfo {
                dir: d,
                syms,
                calls,
            });
            n_files += 1;
        }

        // 全局名索引（仅可调用种类）存 (file_idx, sym_idx)，避免借用冲突
        let mut by_name: BTreeMap<&str, Vec<(usize, usize)>> = BTreeMap::new();
        for (fi, f) in files.iter().enumerate() {
            for (si, s) in f.syms.iter().enumerate() {
                if is_callable(&s.1) {
                    by_name.entry(s.0.as_str()).or_default().push((fi, si));
                }
            }
        }

        #[derive(Default)]
        struct Stat {
            n_local: usize,
            n_global: usize,
            n_none: usize,
            n_amb: usize,
            amb_dir_hit: usize,
            amb_dir_unique: usize,
            amb_subtree_unique: usize,
            amb_top_unique: usize,
            amb_sibling_unique: usize,
            amb_cand_total: usize,
            amb_names: Vec<String>,
            /// 歧义中「恰好一个候选是 method（非 function）」——成员调用的强信号
            amb_method_unique: usize,
            /// 歧义中「恰好一个候选是 function」——自由调用的强信号
            amb_fn_unique: usize,
            /// 无同名符号的名字采样
            none_names: Vec<String>,
            /// Naive 兜底层（L1 同目录唯一 → L2 调用形态种类唯一）能救回的数量
            naive_gain: usize,
        }
        let mut sfree = Stat::default();
        let mut smem = Stat::default();
        let classify = |st: &mut Stat, name: &str, receiver: &str, f: &FileInfo| {
            // 1) 同文件同名可调用符号
            if f.syms.iter().any(|s| is_callable(&s.1) && s.0 == name) {
                st.n_local += 1;
                return;
            }
            // 2) 全局唯一同名 / 否则丢弃
            match by_name.get(name) {
                None => {
                    st.n_none += 1;
                    if st.none_names.len() < 15 {
                        st.none_names.push(name.to_string());
                    }
                }
                Some(v) if v.len() == 1 => st.n_global += 1,
                Some(v) => {
                    st.n_amb += 1;
                    // ── Naive 兜底层（与 resolve_naive_tier 同逻辑）──
                    if v.len() >= 2 {
                        let sd: Vec<&(usize, usize)> =
                            v.iter().filter(|(cf, _)| files[*cf].dir == f.dir).collect();
                        if sd.len() == 1 {
                            st.naive_gain += 1;
                        } else {
                            let want = if receiver.is_empty() {
                                "function"
                            } else {
                                "method"
                            };
                            let bk: Vec<&(usize, usize)> = v
                                .iter()
                                .filter(|(cf, si)| files[*cf].syms[*si].1 == want)
                                .collect();
                            if bk.len() == 1 {
                                st.naive_gain += 1;
                            }
                        }
                    }
                    let same_dir: Vec<&(usize, usize)> =
                        v.iter().filter(|(cf, _)| files[*cf].dir == f.dir).collect();
                    if !same_dir.is_empty() {
                        st.amb_dir_hit += 1;
                    }
                    if same_dir.len() == 1 {
                        st.amb_dir_unique += 1;
                    }
                    let in_subtree: Vec<&(usize, usize)> = v
                        .iter()
                        .filter(|(cf, _)| {
                            let cd = &files[*cf].dir;
                            (!f.dir.is_empty() && cd.starts_with(&f.dir))
                                || (!cd.is_empty() && f.dir.starts_with(cd.as_str()))
                        })
                        .collect();
                    if in_subtree.len() == 1 {
                        st.amb_subtree_unique += 1;
                    }
                    fn top(s: &str) -> &str {
                        s.split('/').next().unwrap_or("")
                    }
                    let in_top: Vec<&(usize, usize)> = v
                        .iter()
                        .filter(|(cf, _)| top(&files[*cf].dir) == top(&f.dir))
                        .collect();
                    if in_top.len() == 1 {
                        st.amb_top_unique += 1;
                    }
                    fn parent_of(s: &str) -> &str {
                        match s.rfind('/') {
                            Some(i) => &s[..i],
                            None => "",
                        }
                    }
                    let in_sibling: Vec<&(usize, usize)> = v
                        .iter()
                        .filter(|(cf, _)| parent_of(&files[*cf].dir) == parent_of(&f.dir))
                        .collect();
                    if in_sibling.len() == 1 {
                        st.amb_sibling_unique += 1;
                    }
                    // 种类消歧：候选中恰好一个是 method / 恰好一个是 function
                    let ms: Vec<&(usize, usize)> = v
                        .iter()
                        .filter(|(cf, si)| files[*cf].syms[*si].1 == "method")
                        .collect();
                    if ms.len() == 1 {
                        st.amb_method_unique += 1;
                    }
                    let fs: Vec<&(usize, usize)> = v
                        .iter()
                        .filter(|(cf, si)| files[*cf].syms[*si].1 == "function")
                        .collect();
                    if fs.len() == 1 {
                        st.amb_fn_unique += 1;
                    }
                    st.amb_cand_total += v.len();
                    if st.amb_names.len() < 12 {
                        st.amb_names.push(format!("{}#{}", name, v.len()));
                    }
                }
            }
        };
        for (_fi, f) in files.iter().enumerate() {
            let callers: Vec<&(String, String, i64, i64)> =
                f.syms.iter().filter(|s| is_caller_kind(&s.1)).collect();
            if callers.is_empty() {
                continue;
            }
            for (name, receiver, line) in &f.calls {
                let mut caller: Option<&(String, String, i64, i64)> = None;
                for s in &callers {
                    if s.2 > *line {
                        break;
                    }
                    if *line <= s.3 {
                        caller = Some(s);
                    }
                }
                let Some(c) = caller else { continue };
                if c.2 == *line || c.0 == *name {
                    continue;
                }
                let st = if receiver.is_empty() {
                    &mut sfree
                } else {
                    &mut smem
                };
                classify(st, name, receiver, f);
            }
        }

        let pct = |a: usize, b: usize| -> f64 {
            if b == 0 {
                0.0
            } else {
                a as f64 * 100.0 / b as f64
            }
        };
        let pct = |a: usize, b: usize| -> f64 {
            if b == 0 {
                0.0
            } else {
                a as f64 * 100.0 / b as f64
            }
        };
        let dump = |tag: &str, st: &Stat| {
            let total = st.n_local + st.n_global + st.n_none + st.n_amb;
            let base = st.n_local + st.n_global;
            println!("\n---- {} · 调用点 {} ----", tag, total);
            println!(
                "  同文件命中    {:>6} ({:.1}%)",
                st.n_local,
                pct(st.n_local, total)
            );
            println!(
                "  全局唯一命中  {:>6} ({:.1}%)",
                st.n_global,
                pct(st.n_global, total)
            );
            println!(
                "  无同名符号    {:>6} ({:.1}%)  <- 外部/标准库",
                st.n_none,
                pct(st.n_none, total)
            );
            println!(
                "  同名歧义丢弃  {:>6} ({:.1}%)  <- 靶子",
                st.n_amb,
                pct(st.n_amb, total)
            );
            println!(
                "  |- 同目录唯一 {} · 同子树唯一 {} · 邻居目录唯一 {}",
                st.amb_dir_unique, st.amb_subtree_unique, st.amb_sibling_unique
            );
            println!(
                "  |- 唯一method候选 {} · 唯一function候选 {}",
                st.amb_method_unique, st.amb_fn_unique
            );
            println!(
                "  |- 平均候选数 {:.1} · 全连将产 {} 条边",
                if st.n_amb == 0 {
                    0.0
                } else {
                    st.amb_cand_total as f64 / st.n_amb as f64
                },
                st.amb_cand_total
            );
            println!("  |- 歧义名样例 {:?}", st.amb_names);
            println!("  |- 无符号名样例 {:?}", st.none_names);
            println!("  当前成功率 {:.1}% ({})", pct(base, total), base);
            println!(
                "  +同目录唯一 → {:.1}% (+{})",
                pct(base + st.amb_dir_unique, total),
                st.amb_dir_unique
            );
            println!(
                "  **Naive 兜底层合计 → {:.1}% (+{} 条边, 相对基线 {:+.1}%)**",
                pct(base + st.naive_gain, total),
                st.naive_gain,
                pct(base + st.naive_gain, total) - pct(base, total)
            );
            println!(
                "  +种类消歧   → {:.1}% (+{})",
                pct(base + st.amb_method_unique.max(st.amb_fn_unique), total),
                st.amb_method_unique.max(st.amb_fn_unique)
            );
        };
        println!(
            "\n===== 调用解析丢边分布回放 dir={} · 源文件 {} =====",
            dir, n_files
        );
        dump("自由调用(无接收者)", &sfree);
        dump("成员调用(有接收者)", &smem);
    }

    // ── 回放探针：继承链（超类）方法解析机会面（env-gated，默认不跑）──────
    // 用法：REPLAY_INH_DIR=/abs/path cargo test replay_inheritance_gain -- --ignored --nocapture
    //
    // 对标 joern `DynamicCallLinker.resolveCallInSuperClasses`（:146-171）：
    // 当 `call.methodFullName` 在被调类型的**自身** TYPE_DECL 下查不到时，joern 会沿
    // `allSuperClasses(typeDeclFullName)` 爬超类链，把继承来的方法补成 CALL 边——
    // 原话场景：子类调用了父类实现的方法。
    //
    // 我们 `resolve_receiver_target` 只在 `methods_by_type_id[接收者类型]` 里查**自身**成员，
    // 查不到即返回 None → 退回名匹配 → 同名歧义则整条边丢弃。
    // 本探针回答：真实项目里「接收者类型已锁定、但方法定义在祖先类」的调用点有多少？
    #[test]
    #[ignore]
    fn replay_inheritance_gain() {
        use crate::commands::code_structure::{extract_symbols, parse_inheritance};
        use std::collections::{BTreeMap, HashSet, VecDeque};

        let dir = match std::env::var("REPLAY_INH_DIR") {
            Ok(v) if !v.is_empty() => v,
            _ => return,
        };

        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if matches!(
                        n,
                        "node_modules"
                            | "target"
                            | "dist"
                            | ".git"
                            | "build"
                            | "vendor"
                            | ".next"
                            | "out"
                    ) {
                        continue;
                    }
                    walk(&p, out);
                } else if p.is_file() && p.to_str().is_some() {
                    out.push(p.to_str().unwrap().to_string());
                }
            }
        }

        /// 类型符号（class / interface），带行区间与父类型名
        struct TypeInfo {
            name: String,
            line_start: i64,
            line_end: i64,
            parents: Vec<String>,
        }
        /// 成员符号
        struct MemInfo {
            name: String,
            line_start: i64,
            line_end: i64,
        }
        struct FileInfo {
            types: Vec<TypeInfo>,
            mems: Vec<MemInfo>,
            callers: Vec<(String, i64, i64)>,
            /// (callee, receiver, line)
            calls: Vec<(String, String, i64)>,
        }

        let mut paths: Vec<String> = Vec::new();
        walk(std::path::Path::new(&dir), &mut paths);

        let mut files: Vec<FileInfo> = Vec::new();
        let mut n_files = 0usize;
        for p in &paths {
            // 继承语法目前仅 TS/JS/Java 解析（与 `parse_inheritance` 契约一致）
            let lang = if p.ends_with(".ts")
                || p.ends_with(".tsx")
                || p.ends_with(".js")
                || p.ends_with(".jsx")
            {
                "typescript"
            } else if p.ends_with(".java") {
                "java"
            } else {
                continue;
            };
            let Ok(content) = std::fs::read_to_string(p) else {
                continue;
            };
            if content.len() > 2_000_000 {
                continue;
            }
            let total_lines = content.lines().count() as i64;
            // 真实行区间还原：SymbolCandidate 不产出 line_end，「下一符号行 - 1」的近似
            // 会让类的 line_end 早于其第一个成员 → 成员不再被类包含 → 类型索引恒空。
            // （`replay_receiver_vartype_gain` 踩过同一个坑，故复用同一份工具函数。）
            let ends = probe_block_ends(&probe_mask_code(&content, lang));
            let mut sc = extract_symbols(lang, &content);
            sc.sort_by_key(|s| s.line);
            let ranges: Vec<(String, String, i64, i64, String)> = sc
                .iter()
                .map(|s| {
                    // 签名可能跨行，在 L..L+5 内找首个块（与 vartype 探针同口径）
                    let mut end = total_lines;
                    for cand in s.line..(s.line + 6) {
                        if let Some(e) = ends.get(&cand).copied() {
                            end = e as i64;
                            break;
                        }
                    }
                    (
                        s.name.clone(),
                        s.kind.clone(),
                        s.line as i64,
                        end.max(s.line as i64),
                        s.signature.clone(),
                    )
                })
                .collect();

            let types: Vec<TypeInfo> = ranges
                .iter()
                .filter(|(_, k, _, _, _)| k == "class" || k == "interface")
                .map(|(n, _, ls, le, sig)| TypeInfo {
                    name: n.clone(),
                    line_start: *ls,
                    line_end: *le,
                    parents: parse_inheritance(sig).into_iter().map(|(p, _)| p).collect(),
                })
                .collect();
            let mems: Vec<MemInfo> = ranges
                .iter()
                .filter(|(_, k, _, _, _)| is_callable(k))
                .map(|(n, _, ls, le, _)| MemInfo {
                    name: n.clone(),
                    line_start: *ls,
                    line_end: *le,
                })
                .collect();
            let callers: Vec<(String, i64, i64)> = ranges
                .iter()
                .filter(|(_, k, _, _, _)| is_caller_kind(k))
                .map(|(n, _, ls, le, _)| (n.clone(), *ls, *le))
                .collect();
            let calls: Vec<(String, String, i64)> = if p.ends_with(".java") {
                match dialect_for("java", p) {
                    Some(d) => extract_calls_ast(d, &content)
                        .into_iter()
                        .map(|c| (c.callee, c.receiver, c.line as i64))
                        .collect(),
                    None => Vec::new(),
                }
            } else {
                extract_calls_ts(&content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect()
            };
            n_files += 1;
            files.push(FileInfo {
                types,
                mems,
                callers,
                calls,
            });
        }

        // 类型名 → (file_idx, type_idx)：跨文件同名取首个（与生产 type_by_name 同口径）
        let mut type_by_name: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for (fi, f) in files.iter().enumerate() {
            for (ti, t) in f.types.iter().enumerate() {
                type_by_name.entry(t.name.as_str()).or_insert((fi, ti));
            }
        }

        let enclosing = |f: &FileInfo, line: i64| -> Option<usize> {
            let mut best: Option<(usize, i64)> = None;
            for (ti, t) in f.types.iter().enumerate() {
                if line >= t.line_start && line <= t.line_end {
                    let span = t.line_end - t.line_start;
                    if best.map(|(_, b)| span <= b).unwrap_or(false) {
                        continue;
                    }
                    best = Some((ti, span));
                }
            }
            best.map(|(ti, _)| ti)
        };
        let own_member = |f: &FileInfo, ti: usize, name: &str| -> bool {
            let t = &f.types[ti];
            f.mems
                .iter()
                .any(|m| m.name == name && m.line_start >= t.line_start && m.line_end <= t.line_end)
        };

        #[derive(Default)]
        struct Stat {
            /// 接收者类型未锁定（this 无外层类 / 接收者名不是已知类型）
            no_type: usize,
            /// 类型自身就有该成员 —— 当前已能解析
            own: usize,
            /// 自身没有，但超类链上有 —— 本探针的目标增益
            inherited: usize,
            /// 自身和超类链都没有（多半来自外部基类/标准库）
            missing: usize,
            /// missing 中「接收者类型确有可解析父类型」的数量（区分
            /// 「本库不存在继承调用」与「链遍历实现有 bug」）
            missing_with_parent: usize,
            /// missing 中实际走过 ≥1 层父类型的数量
            missing_walked: usize,
            missing_samples: Vec<String>,
            /// 超类链深度分布
            depth_sum: usize,
            samples: Vec<String>,
            /// 自证诊断：类型符号总数 / this 接收者数 / 具名类型接收者数
            n_this: usize,
            n_named: usize,
        }
        let mut st = Stat::default();
        let mut n_member_calls = 0usize;

        for (_fi, f) in files.iter().enumerate() {
            for (name, receiver, line) in &f.calls {
                if receiver.is_empty() {
                    continue;
                }
                n_member_calls += 1;
                // caller 定位（用于 this/self 求外层类型）
                let mut caller_line: Option<i64> = None;
                for (_, ls, le) in &f.callers {
                    if *ls > *line {
                        break;
                    }
                    if *line <= *le {
                        caller_line = Some(*ls);
                    }
                }
                let is_self = matches!(
                    receiver.as_str(),
                    "this" | "self" | "me" | "Self" | "THIS" | "cls"
                );
                // 接收者类型：(file, type_idx)
                let recv: Option<(usize, usize)> = if is_self {
                    st.n_this += 1;
                    caller_line
                        .and_then(|cl| enclosing(f, cl))
                        .map(|ti| (_fi, ti))
                } else {
                    st.n_named += 1;
                    type_by_name.get(receiver.as_str()).copied()
                };
                let Some((rf, rt)) = recv else {
                    st.no_type += 1;
                    continue;
                };
                if own_member(&files[rf], rt, name) {
                    st.own += 1;
                    continue;
                }
                // ── 沿超类链上爬（对标 joern allSuperClasses）──
                let mut q: VecDeque<(usize, usize, usize)> = VecDeque::new();
                let mut seen: HashSet<(usize, usize)> = HashSet::new();
                seen.insert((rf, rt));
                for pn in &files[rf].types[rt].parents {
                    if let Some(&(pf, pt)) = type_by_name.get(pn.as_str()) {
                        if seen.insert((pf, pt)) {
                            q.push_back((pf, pt, 1));
                        }
                    }
                }
                let mut found_depth = 0usize;
                let mut walk_steps = 0usize;
                while let Some((cf, ct, depth)) = q.pop_front() {
                    walk_steps += 1;
                    if own_member(&files[cf], ct, name) {
                        found_depth = depth;
                        break;
                    }
                    if depth >= 5 {
                        continue;
                    }
                    for pn in &files[cf].types[ct].parents {
                        if let Some(&(pf, pt)) = type_by_name.get(pn.as_str()) {
                            if seen.insert((pf, pt)) {
                                q.push_back((pf, pt, depth + 1));
                            }
                        }
                    }
                }
                if found_depth > 0 {
                    st.inherited += 1;
                    st.depth_sum += found_depth;
                    if st.samples.len() < 15 {
                        st.samples
                            .push(format!("{}.{} (depth {})", receiver, name, found_depth));
                    }
                } else {
                    st.missing += 1;
                    if !files[rf].types[rt].parents.is_empty() {
                        st.missing_with_parent += 1;
                    }
                    if walk_steps > 0 {
                        st.missing_walked += 1;
                    }
                    if st.missing_samples.len() < 15 {
                        st.missing_samples.push(format!("{}.{}", receiver, name));
                    }
                }
            }
        }

        let pct = |a: usize, b: usize| -> f64 {
            if b == 0 {
                0.0
            } else {
                a as f64 * 100.0 / b as f64
            }
        };
        let n_types: usize = files.iter().map(|f| f.types.len()).sum();
        let n_with_parent: usize = files
            .iter()
            .map(|f| f.types.iter().filter(|t| !t.parents.is_empty()).count())
            .sum();
        let mut n_parent_refs = 0usize;
        let mut n_parent_resolved = 0usize;
        let mut unresolved_parents: std::collections::BTreeMap<String, usize> =
            std::collections::BTreeMap::new();
        for f in &files {
            for t in &f.types {
                for pn in &t.parents {
                    n_parent_refs += 1;
                    if type_by_name.contains_key(pn.as_str()) {
                        n_parent_resolved += 1;
                    } else {
                        *unresolved_parents.entry(pn.clone()).or_insert(0) += 1;
                    }
                }
            }
        }
        let top_unresolved: Vec<String> = {
            let mut v: Vec<(String, usize)> = unresolved_parents.into_iter().collect();
            v.sort_by(|a, b| b.1.cmp(&a.1));
            v.into_iter()
                .take(12)
                .map(|(n, c)| format!("{}#{}", n, c))
                .collect()
        };
        println!(
            "\n===== 继承链方法解析机会面 dir={} · 源文件 {} =====",
            dir, n_files
        );
        println!(
            "[自证] 类型符号 class/interface {} · 其中有父类 {} · this接收者 {} · 具名接收者 {}",
            n_types, n_with_parent, st.n_this, st.n_named
        );
        println!(
            "[自证] 父类型引用 {} · 可解析到本库类型符号 {} ({:.1}%) · 未解析 Top {:?}",
            n_parent_refs,
            n_parent_resolved,
            pct(n_parent_resolved, n_parent_refs),
            top_unresolved
        );
        println!("成员调用点合计   {:>6}", n_member_calls);
        println!(
            "  接收者类型未锁定 {:>6} ({:.1}%)  <- 非本轮范畴",
            st.no_type,
            pct(st.no_type, n_member_calls)
        );
        let typed = st.own + st.inherited + st.missing;
        println!(
            "  已锁定接收者类型 {:>6} ({:.1}%)",
            typed,
            pct(typed, n_member_calls)
        );
        println!(
            "  |- 类型自身已有成员   {:>6} ({:.1}% / 占已锁定 {:.1}%)  <- 当前已能解析",
            st.own,
            pct(st.own, n_member_calls),
            pct(st.own, typed)
        );
        println!(
            "  |- **继承自超类**     {:>6} ({:.1}% / 占已锁定 {:.1}%)  <- 本轮靶子",
            st.inherited,
            pct(st.inherited, n_member_calls),
            pct(st.inherited, typed)
        );
        println!(
            "  |- 整链都没有         {:>6} ({:.1}% / 占已锁定 {:.1}%)  <- 外部基类/标准库",
            st.missing,
            pct(st.missing, n_member_calls),
            pct(st.missing, typed)
        );
        println!(
            "     |- 其中接收者类型有可解析父类型 {} · 实际走过父类型层 {} · 样例 {:?}",
            st.missing_with_parent, st.missing_walked, st.missing_samples
        );
        if st.inherited > 0 {
            println!(
                "  |- 平均继承深度 {:.2}",
                st.depth_sum as f64 / st.inherited as f64
            );
            println!("  |- 样例 {:?}", st.samples);
        }
    }

    // ── 回放探针：接收者「局部变量 → 声明类型」机会面（env-gated，默认不跑）──────
    // 用法：REPLAY_VARTYPE_DIR=/abs/path cargo test replay_receiver_vartype_gain -- --ignored --nocapture
    //
    // 对标 joern `XTypeRecovery`：其流程第 3~5 步明确写「Visit assignments 以推断变量类型存入
    // 局部符号表 → 找出这些变量被使用的地方 → **若该变量是某调用的接收者，则据此设定调用类型**」。
    // 我们 `resolve_receiver_target` 只覆盖 this/self、`Type.foo()` 静态分发、Rust `Type::method`、
    // Go caller 自身接收者，**缺 `let x = Foo::new(); x.bar()` 这条最主流的 var→type 推断**。
    //
    // 本探针回答三个问题：
    //   ① 当前丢弃/歧义的成员调用里，有多少接收者是「可推断类型的局部变量」？
    //   ② 其中有多少能靠 (推断类型, 方法名) 唯一定位到真实方法？
    //   ③ 反向风险：当前靠**名匹配**连上的成员调用里，有多少实际连错了类型（精度隐患）？
    #[test]
    #[ignore]
    fn replay_receiver_vartype_gain() {
        use crate::commands::code_structure::extract_symbols;
        use std::collections::BTreeMap;

        let dir = match std::env::var("REPLAY_VARTYPE_DIR") {
            Ok(v) if !v.is_empty() => v,
            _ => return,
        };

        fn lang_of(p: &str) -> Option<&'static str> {
            let p = p.to_lowercase();
            for (ext, l) in [
                (".rs", "rust"),
                (".ts", "typescript"),
                (".tsx", "typescript"),
                (".js", "javascript"),
                (".jsx", "javascript"),
                (".py", "python"),
                (".go", "go"),
                (".java", "java"),
                (".c", "c"),
                (".h", "c"),
                (".cpp", "cpp"),
                (".hpp", "cpp"),
                (".cc", "cpp"),
                (".cs", "csharp"),
                (".php", "php"),
                (".rb", "ruby"),
                (".swift", "swift"),
                (".kt", "kotlin"),
            ] {
                if p.ends_with(ext) {
                    return Some(l);
                }
            }
            None
        }

        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if matches!(
                        n,
                        "node_modules"
                            | "target"
                            | "dist"
                            | ".git"
                            | "build"
                            | "vendor"
                            | ".next"
                            | "out"
                    ) {
                        continue;
                    }
                    walk(&p, out);
                } else if p.is_file() && p.to_str().is_some() {
                    out.push(p.to_str().unwrap().to_string());
                }
            }
        }

        /// 取类型名的「首段标识符」：`Foo<T>`→Foo、`pkg::Foo`→Foo（跨包同名的降级，探针只求上界）
        fn base_type(t: &str) -> String {
            let t = t.trim().trim_start_matches(['&', '*']).trim();
            // 取连续 alnum/_/: 段，再取最后一段（处理 `pkg::Foo` → Foo；`Foo<T>` → Foo）
            let head: String = t
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':')
                .collect();
            head.rsplit("::").next().unwrap_or("").to_string()
        }

        /// 声明式类型推断：从一行代码里抽 (变量名, 推断类型名)。
        /// 刻意只认**高置信**形态（显式类型标注 / new / 构造函数 / 结构体字面量），
        /// 不认 `let x = foo()`（返回类型未知，joern 也只在该方法返回类型已知时才推导）。
        fn infer_decl(line: &str, lang: &str) -> Option<(String, String)> {
            let s = line.trim();
            if s.starts_with("//") || s.starts_with("/*") || s.starts_with('*') {
                return None;
            }
            match lang {
                // `let [mut] x: Foo = ...` / `let [mut] x = Foo::new(..)` / `let x = Foo { .. }` / `let x = Foo(..)`
                "rust" => {
                    let rest = s.strip_prefix("let")?.trim_start();
                    let rest = rest.strip_prefix("mut").unwrap_or(rest).trim_start();
                    // 变量名：取首个标识符
                    let var: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect();
                    if var.is_empty() {
                        return None;
                    }
                    let after = &rest[var.len()..];
                    let after = after.trim_start();
                    if let Some(r) = after.strip_prefix(':') {
                        // 显式标注 `x: Foo = ` / `x: &Foo = `
                        let t: String = r
                            .trim_start()
                            .chars()
                            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':')
                            .collect();
                        let t = base_type(&t);
                        if t.is_empty() {
                            return None;
                        }
                        return Some((var, t));
                    }
                    let rhs = after.strip_prefix('=')?.trim_start();
                    // `Foo::new(` / `Foo::default(` / `Foo {` / `Foo(` / `Foo::from(`
                    let head: String = rhs
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect();
                    if head.is_empty() || !head.chars().next().unwrap().is_ascii_uppercase() {
                        return None;
                    }
                    let tail = rhs[head.len()..].chars().next().unwrap_or(' ');
                    if matches!(tail, ':' | '{' | '(') {
                        Some((var, base_type(&head)))
                    } else {
                        None
                    }
                }
                // `const|let|var x: Foo = ` / `const x = new Foo(` / `const x = Foo(`（大写工厂/构造）
                "typescript" | "javascript" => {
                    let kw = ["const ", "let ", "var "];
                    let mut rest: Option<&str> = None;
                    for k in kw {
                        if let Some(r) = s.strip_prefix(k) {
                            rest = Some(r);
                            break;
                        }
                    }
                    let rest = rest?;
                    let var: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
                        .collect();
                    if var.is_empty() {
                        return None;
                    }
                    let after = rest[var.len()..].trim_start();
                    if let Some(r) = after.strip_prefix(':') {
                        let t: String = r
                            .trim_start()
                            .chars()
                            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.')
                            .collect();
                        let t = base_type(&t.rsplit('.').next().unwrap_or(""));
                        if t.is_empty() {
                            return None;
                        }
                        return Some((var, t));
                    }
                    let rhs = after.strip_prefix('=')?.trim_start();
                    let rhs = rhs.strip_prefix("await ").unwrap_or(rhs).trim_start();
                    let rhs = rhs.strip_prefix("new ").unwrap_or(rhs);
                    let head: String = rhs
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect();
                    if head.is_empty() || !head.chars().next().unwrap().is_ascii_uppercase() {
                        return None;
                    }
                    Some((var, base_type(&head)))
                }
                // `x := &Foo{}` / `x := Foo{}` / `var x Foo` / `var x *Foo` / `x := NewFoo(`
                "go" => {
                    if let Some(r) = s.strip_prefix("var ").or_else(|| s.strip_prefix("var\t")) {
                        let mut it = r.split_whitespace();
                        let var = it.next()?;
                        let ty = it.next()?;
                        let t = base_type(ty);
                        if t.is_empty()
                            || !var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        {
                            return None;
                        }
                        return Some((var.to_string(), t));
                    }
                    if let Some(pos) = s.find(":=") {
                        let var = s[..pos].trim();
                        if var.is_empty()
                            || !var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        {
                            return None;
                        }
                        let rhs = s[pos + 2..].trim_start();
                        let rhs = rhs.trim_start_matches('&');
                        let head: String = rhs
                            .chars()
                            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '.')
                            .collect();
                        if head.is_empty() {
                            return None;
                        }
                        let tail = rhs[head.len()..].chars().next().unwrap_or(' ');
                        // `Foo{` / `Foo(` / `pkg.Foo{`
                        let ty = head.rsplit('.').next().unwrap_or("").to_string();
                        let ty = match ty.strip_prefix("New") {
                            Some(x) if !x.is_empty() => x.to_string(),
                            _ => ty,
                        };
                        if ty.is_empty() || !matches!(tail, '{' | '(') {
                            return None;
                        }
                        return Some((var.to_string(), base_type(&ty)));
                    }
                    None
                }
                // `Foo x = new Foo2(` / `var x = new Foo2(` / `final Foo x = `
                "java" | "csharp" | "kotlin" | "cpp" | "c" => {
                    let toks: Vec<&str> = s.split_whitespace().collect();
                    if toks.len() < 2 {
                        return None;
                    }
                    let mut i = 0usize;
                    while i < toks.len()
                        && matches!(
                            toks[i],
                            "public"
                                | "private"
                                | "protected"
                                | "final"
                                | "static"
                                | "readonly"
                                | "internal"
                                | "const"
                                | "auto"
                                | "let"
                                | "var"
                                | "val"
                                | "mut"
                        )
                    {
                        i += 1;
                    }
                    if i + 1 >= toks.len() {
                        return None;
                    }
                    // `Foo x = ` 形态：toks[i] 是类型
                    let cand_ty = toks[i].trim_end_matches([';', ',']);
                    let cand_var = toks[i + 1];
                    let var_clean: String = cand_var
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                        .collect();
                    if !var_clean.is_empty()
                        && cand_var.len() >= var_clean.len()
                        && cand_ty
                            .chars()
                            .next()
                            .map(|c| c.is_ascii_uppercase())
                            .unwrap_or(false)
                    {
                        let t = base_type(cand_ty);
                        if !t.is_empty() && t != var_clean {
                            return Some((var_clean, t));
                        }
                    }
                    // `x = new Foo(` 形态
                    if let Some(pos) = s.find('=') {
                        let var = s[..pos].trim();
                        let rhs = s[pos + 1..].trim_start();
                        if let Some(r2) = rhs.strip_prefix("new ") {
                            let head: String = r2
                                .chars()
                                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                                .collect();
                            if !head.is_empty()
                                && var.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                            {
                                return Some((var.to_string(), base_type(&head)));
                            }
                        }
                    }
                    None
                }
                _ => None,
            }
        }

        struct FileInfo {
            lang: &'static str,
            path: String,
            /// (name, kind, line_start, line_end)
            syms: Vec<(String, String, i64, i64)>,
            /// (callee_name, receiver, line)
            calls: Vec<(String, String, i64)>,
            lines: Vec<String>,
        }

        let mut paths: Vec<String> = Vec::new();
        walk(std::path::Path::new(&dir), &mut paths);

        let mut files: Vec<FileInfo> = Vec::new();
        for p in &paths {
            let Some(lang) = lang_of(p) else { continue };
            let Ok(content) = std::fs::read_to_string(p) else {
                continue;
            };
            if content.len() > 2_000_000 {
                continue;
            }
            let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
            let total_lines = lines.len() as i64;
            let ends = if lang == "python" {
                std::collections::HashMap::new()
            } else {
                probe_block_ends(&probe_mask_code(&content, lang))
            };
            let mut sc: Vec<(String, String, i64)> = extract_symbols(lang, &content)
                .into_iter()
                .map(|s| (s.name, s.kind, s.line as i64))
                .collect();
            sc.sort_by_key(|x| x.2);
            let syms: Vec<(String, String, i64, i64)> = sc
                .iter()
                .map(|(n, k, l)| {
                    // 签名可能跨行（`fn foo(\n a: u32,\n) -> X {`），在 L..L+5 内找首个块
                    let mut end = 0i64;
                    for cand in *l..(*l + 6) {
                        if let Some(e) = ends.get(&(cand as usize)).copied() {
                            if (e as i64) >= *l {
                                end = e as i64;
                                break;
                            }
                        }
                    }
                    let end = if end >= *l { end } else { total_lines };
                    (n.clone(), k.clone(), *l, end.max(*l))
                })
                .collect();
            let calls: Vec<(String, String, i64)> = if lang == "typescript" || lang == "javascript"
            {
                extract_calls_ts(&content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect()
            } else if let Some(d) = dialect_for(lang, p) {
                extract_calls_ast(d, &content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect()
            } else {
                Vec::new()
            };
            files.push(FileInfo {
                lang,
                path: p.clone(),
                syms,
                calls,
                lines,
            });
        }

        // 全局 (类型名, 方法名) → 候选数：类型名取 enclosing type 的名字
        let mut by_type_method: BTreeMap<(String, String), usize> = BTreeMap::new();
        for f in &files {
            let type_syms: Vec<&(String, String, i64, i64)> =
                f.syms.iter().filter(|s| is_type_kind(&s.1)).collect();
            for s in &f.syms {
                if !is_method_like(&s.1) {
                    continue;
                }
                // 找最内层包含它的类型
                let mut best: Option<&(String, String, i64, i64)> = None;
                for t in &type_syms {
                    if t.0 == s.0 && t.2 == s.2 {
                        continue;
                    }
                    if s.2 >= t.2 && s.3 <= t.3 {
                        match best {
                            Some(b) if (b.3 - b.2) <= (t.3 - t.2) => {}
                            _ => best = Some(t),
                        }
                    }
                }
                if let Some(t) = best {
                    *by_type_method
                        .entry((t.0.clone(), s.0.clone()))
                        .or_default() += 1;
                }
            }
        }

        // 全局同名可调用符号索引
        let mut by_name: BTreeMap<&str, usize> = BTreeMap::new();
        for f in &files {
            for s in &f.syms {
                if is_callable(&s.1) {
                    *by_name.entry(s.0.as_str()).or_default() += 1;
                }
            }
        }

        #[derive(Default)]
        struct St {
            /// 成员调用总数（非 self/this 接收者）
            total: usize,
            /// 当前已解析（同文件命中 或 全局唯一名）
            base_resolved: usize,
            /// 当前未解析（无同名符号 / 同名歧义）
            unresolved: usize,
            /// 未解析中：接收者可推断出类型
            inferable: usize,
            /// 未解析 + 可推断 + (类型,方法名) 恰好 1 个候选 → **纯增益**
            gain_unique: usize,
            /// 未解析 + 可推断 + 候选 ≥2 → 仍歧义（无增益）
            gain_multi: usize,
            /// 未解析 + 可推断 + 候选 0 → 方法不在该项目（外部/继承）
            gain_zero: usize,
            /// 已解析中：接收者可推断出类型，但名匹配命中的符号**不在**推断类型上 → 精度隐患
            mismatch: usize,
            /// 已解析中：接收者可推断出类型，且 (类型,方法名) 恰好 1 个候选 → 可加固为确定边
            reinforce: usize,
            /// 未解析中：无同名符号 / 同名歧义 的拆分（判断靶子究竟在哪一侧）
            unres_none: usize,
            unres_amb: usize,
            /// 可推断类型但零候选 → 推断出的类型名分布（判断是外部库还是索引缺失）
            zero_types: BTreeMap<String, usize>,
            samples_gain: Vec<String>,
            samples_mismatch: Vec<String>,
        }
        let mut st = St::default();

        let self_like = |r: &str| matches!(r, "this" | "self" | "me" | "Self" | "THIS" | "cls");

        for f in &files {
            // 预先算好每个 caller 作用域的 var→type（行区间扫描，flow-insensitive，
            // 与 joern XTypeRecovery「非 SSA、流不敏感」同口径）
            let callers: Vec<&(String, String, i64, i64)> =
                f.syms.iter().filter(|s| is_caller_kind(&s.1)).collect();
            if callers.is_empty() {
                continue;
            }
            let mut scopes: Vec<(i64, i64, std::collections::HashMap<String, String>)> = Vec::new();
            for c in &callers {
                let mut m = std::collections::HashMap::new();
                let lo = (c.2 as usize).saturating_sub(1);
                let hi = (c.3 as usize).min(f.lines.len());
                for l in &f.lines[lo..hi] {
                    if let Some((v, t)) = infer_decl(l, f.lang) {
                        m.entry(v).or_insert(t);
                    }
                }
                scopes.push((c.2, c.3, m));
            }

            for (name, receiver, line) in &f.calls {
                if receiver.is_empty() || self_like(receiver) {
                    continue;
                }
                // 定位 caller 作用域
                let mut cur: Option<usize> = None;
                for (i, s) in scopes.iter().enumerate() {
                    if *line >= s.0 && *line <= s.1 {
                        cur = Some(i);
                    }
                }
                let Some(ci) = cur else { continue };
                // 当前基线解析状态
                let local_hit = f.syms.iter().any(|s| is_callable(&s.1) && s.0 == *name);
                let g = by_name.get(name.as_str()).copied().unwrap_or(0);
                let resolved = local_hit || g == 1;
                // 接收者类型推断
                let ty = scopes[ci].2.get(receiver).cloned();

                st.total += 1;
                if resolved {
                    st.base_resolved += 1;
                } else if g == 0 {
                    st.unresolved += 1;
                    st.unres_none += 1;
                } else {
                    st.unresolved += 1;
                    st.unres_amb += 1;
                }

                let Some(t) = ty else { continue };
                let cands = by_type_method
                    .get(&(t.clone(), name.clone()))
                    .copied()
                    .unwrap_or(0);

                if resolved {
                    // 精度审计：名匹配命中的符号，其 enclosing type 是否就是推断类型？
                    let hit_same_type = f.syms.iter().any(|s| {
                        is_callable(&s.1)
                            && s.0 == *name
                            && enclosing_type_of(&f.syms, s).as_deref() == Some(t.as_str())
                    });
                    if !hit_same_type && cands > 0 {
                        st.mismatch += 1;
                        if st.samples_mismatch.len() < 12 {
                            st.samples_mismatch.push(format!(
                                "{}:{} {}.{}",
                                short_path(&f.path),
                                line,
                                t,
                                name
                            ));
                        }
                    }
                    if cands == 1 {
                        st.reinforce += 1;
                    }
                } else {
                    st.inferable += 1;
                    if cands == 1 {
                        st.gain_unique += 1;
                        if st.samples_gain.len() < 12 {
                            st.samples_gain.push(format!(
                                "{}:{} {}.{}",
                                short_path(&f.path),
                                line,
                                t,
                                name
                            ));
                        }
                    } else if cands == 0 {
                        st.gain_zero += 1;
                        *st.zero_types.entry(t.clone()).or_default() += 1;
                    } else {
                        st.gain_multi += 1;
                    }
                }
            }
        }

        fn short_path(p: &str) -> String {
            match p.rfind('/') {
                Some(i) => p[i + 1..].to_string(),
                None => p.to_string(),
            }
        }
        fn enclosing_type_of(
            syms: &[(String, String, i64, i64)],
            s: &(String, String, i64, i64),
        ) -> Option<String> {
            let type_syms: Vec<&(String, String, i64, i64)> =
                syms.iter().filter(|x| is_type_kind(&x.1)).collect();
            let mut best: Option<&(String, String, i64, i64)> = None;
            for t in &type_syms {
                if t.0 == s.0 && t.2 == s.2 {
                    continue;
                }
                if s.2 >= t.2 && s.3 <= t.3 {
                    match best {
                        Some(b) if (b.3 - b.2) <= (t.3 - t.2) => {}
                        _ => best = Some(t),
                    }
                }
            }
            best.map(|b| b.0.clone())
        }

        let pct = |a: usize, b: usize| -> f64 {
            if b == 0 {
                0.0
            } else {
                a as f64 * 100.0 / b as f64
            }
        };

        println!(
            "\n===== 接收者 var→type 机会面回放 dir={} · 源文件 {} =====",
            dir,
            files.len()
        );
        println!("(类型,方法) 索引条目数 {}", by_type_method.len());
        println!("成员调用（非 self/this）  {}", st.total);
        println!(
            "  当前已解析    {:>6} ({:.1}%)",
            st.base_resolved,
            pct(st.base_resolved, st.total)
        );
        println!(
            "  当前未解析    {:>6} ({:.1}%)",
            st.unresolved,
            pct(st.unresolved, st.total)
        );
        println!("  ── 未解析中的 var→type 机会 ──");
        println!(
            "  |- 接收者可推断类型        {:>6} ({:.1}% of 未解析)",
            st.inferable,
            pct(st.inferable, st.unresolved)
        );
        println!(
            "  |- **可唯一定位（纯增益）**{:>6} ({:.1}% of 未解析, 相对全量 {:+.1}%)",
            st.gain_unique,
            pct(st.gain_unique, st.unresolved),
            pct(st.gain_unique, st.total)
        );
        println!("  |- 候选≥2 仍歧义           {:>6}", st.gain_multi);
        println!("  |- 候选 0（外部/继承）     {:>6}", st.gain_zero);
        let mut zt: Vec<(String, usize)> =
            st.zero_types.iter().map(|(k, v)| (k.clone(), *v)).collect();
        zt.sort_by(|a, b| b.1.cmp(&a.1));
        println!("  |- 零候选类型 Top20 {:?}", &zt[..zt.len().min(20)]);
        println!(
            "  未解析构成：无同名符号 {} / 同名歧义 {}（后者才是可救的靶子）",
            st.unres_none, st.unres_amb
        );
        println!("  增益样例 {:?}", st.samples_gain);
        println!("  ── 已解析中的精度隐患 ──");
        println!(
            "  |- 名匹配连到别的类型      {:>6} ({:.1}% of 已解析)",
            st.mismatch,
            pct(st.mismatch, st.base_resolved)
        );
        println!("  |- 可加固为 (类型,名) 唯一 {:>6}", st.reinforce);
        println!("  隐患样例 {:?}", st.samples_mismatch);
        println!(
            "  **净结论：成员调用成功率 {:.1}% → {:.1}%**",
            pct(st.base_resolved, st.total),
            pct(st.base_resolved + st.gain_unique, st.total)
        );
    }

    // 用法：REPLAY_GOPKG_DIR=/abs/path cargo test replay_go_pkg_call_gain -- --ignored --nocapture
    //
    // 目的：对标 joern gosrc2cpg 的**包名/别名 → 命名空间 → 成员**解析链
    //   - CommonCacheBuilder.scala:100-115 —— 每条 import 登记 `aliasToNameSpaceMapping`：
    //     有别名用别名，无别名取导入路径**末段**（`importedEntity.split("/").last`），
    //     且注释原话「As these alias could be different for each file. Hence we maintain
    //     the cache at file level」→ **文件级**映射。
    //   - AstForMethodCallExpressionCreator.scala:122-147 —— `pkg.Func()` 且 pkg 不是变量
    //     时走 `resolveAliasToFullName(alias)` → `s"$fullNamespace.$methodName"`，
    //     即**按包名限定**查成员，而非按裸名全局匹配。
    //
    // 我们当前链路是 `local → imported(裸名) → glob → global(全局唯一名) → naive`，
    // `imported` 层按**裸名**查，完全不看接收者。故本探针量化三件事：
    //   ① Go 限定调用（`pkg.F()`）里有多少当前解析不到（召回损失）；
    //   ② 有多少解析到了**别的**符号（精度损失——裸名撞车，imported 层 last-write-wins）；
    //   ③ 加上包名限定层后净增益。
    #[test]
    #[ignore]
    fn replay_go_pkg_call_gain() {
        let dir = match std::env::var("REPLAY_GOPKG_DIR") {
            Ok(v) if !v.is_empty() => v,
            _ => return,
        };

        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if matches!(
                        n,
                        "node_modules"
                            | "target"
                            | "dist"
                            | ".git"
                            | "build"
                            | "vendor"
                            | "testdata"
                            | "out"
                    ) {
                        continue;
                    }
                    walk(&p, out);
                } else if p.is_file() && p.to_str().is_some() {
                    out.push(p.to_str().unwrap().to_string());
                }
            }
        }

        /// 探针内的轻量符号（避免依赖 DB 实体）
        #[derive(Clone, Copy)]
        struct PS<'a> {
            fi: usize,
            file: &'a str,
            dir: &'a str,
            name: &'a str,
            kind: &'a str,
            line: i64,
        }

        struct FInfo {
            rel: String,
            dir: String,
            pkg: String,
            /// (callee, receiver, line)
            calls: Vec<(String, String, i64)>,
            /// (包名/别名, 导入路径)
            imports: Vec<(String, String)>,
            /// (包名/别名, 被用到的成员名)——用量驱动，对标 `extract_go_symbol_imports`
            used: Vec<(String, String)>,
        }

        let mut paths: Vec<String> = Vec::new();
        walk(std::path::Path::new(&dir), &mut paths);
        paths.retain(|p| p.ends_with(".go") && !p.ends_with("_test.go"));
        paths.sort();

        let mut infos: Vec<FInfo> = Vec::new();
        let mut syms: Vec<PS<'_>> = Vec::new();
        // 先读全部内容并驻留，后续按索引借用
        let mut contents: Vec<String> = Vec::new();
        let mut rels: Vec<String> = Vec::new();
        let mut dirs: Vec<String> = Vec::new();
        for p in &paths {
            let Ok(content) = std::fs::read_to_string(p) else {
                continue;
            };
            if content.len() > 2_000_000 {
                continue;
            }
            let rel = p
                .strip_prefix(&dir)
                .unwrap_or(p.as_str())
                .trim_start_matches('/')
                .to_string();
            let d = std::path::Path::new(&rel)
                .parent()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_default();
            rels.push(rel);
            dirs.push(d);
            contents.push(content);
        }
        for i in 0..contents.len() {
            let content = &contents[i];
            let mut pkg = String::new();
            for line in content.lines() {
                let t = line.trim();
                if let Some(rest) = t.strip_prefix("package ") {
                    pkg = rest.split_whitespace().next().unwrap_or("").to_string();
                    break;
                }
                if !t.is_empty() && !t.starts_with("//") {
                    break;
                }
            }
            let calls: Vec<(String, String, i64)> = match super::dialect_for("go", &rels[i]) {
                Some(d) => super::extract_calls_ast(d, content)
                    .into_iter()
                    .map(|c| (c.callee, c.receiver, c.line as i64))
                    .collect(),
                None => Vec::new(),
            };
            // import 规格 + 用量归集（与 `extract_go_symbol_imports` 同口径）
            let (imports, used) = go_probe_imports(content);
            let sym_base = syms.len();
            for s in crate::commands::code_structure::extract_symbols("go", content) {
                syms.push(PS {
                    fi: i,
                    file: rels[i].as_str(),
                    dir: dirs[i].as_str(),
                    name: String::leak(s.name.clone()),
                    kind: String::leak(s.kind.clone()),
                    line: s.line as i64,
                });
            }
            let _ = sym_base;
            infos.push(FInfo {
                rel: rels[i].clone(),
                dir: dirs[i].clone(),
                pkg,
                calls,
                imports,
                used,
            });
        }

        // dir -> 该目录下文件索引
        let mut dir_files: std::collections::HashMap<&str, Vec<usize>> =
            std::collections::HashMap::new();
        for (i, d) in dirs.iter().enumerate() {
            dir_files.entry(d.as_str()).or_default().push(i);
        }
        // dir -> 声明的包名
        let mut dir_pkg: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
        for (i, d) in dirs.iter().enumerate() {
            dir_pkg.entry(d.as_str()).or_insert(infos[i].pkg.as_str());
        }

        /// 导入路径 → 仓库内目录：渐进剥离模块前缀（对标 `go_module_candidates`，≤5 段）
        fn resolve_pkg_dir(
            path: &str,
            dir_files: &std::collections::HashMap<&str, Vec<usize>>,
        ) -> Option<String> {
            let segs: Vec<&str> = path.split('/').collect();
            for k in 0..segs.len().min(5) {
                let cand = segs[k..].join("/");
                if dir_files.contains_key(cand.as_str()) {
                    return Some(cand);
                }
            }
            None
        }

        // by_name / by_file
        let mut by_name: std::collections::HashMap<&str, Vec<PS<'_>>> =
            std::collections::HashMap::new();
        let mut by_file: std::collections::HashMap<&str, Vec<PS<'_>>> =
            std::collections::HashMap::new();
        for s in syms.iter() {
            if !super::is_callable(s.kind) {
                continue;
            }
            by_name.entry(s.name).or_default().push(*s);
            by_file.entry(s.file).or_default().push(*s);
        }

        // ── 基线 imported 层：裸名 → 符号（**last-write-wins**，与生产循环一致）──
        let mut import_map: std::collections::HashMap<(usize, String), PS<'_>> =
            std::collections::HashMap::new();
        // ── 新层：(文件, 包名, 成员名) → 符号（包名限定，跨包内多文件全收后取唯一）──
        let mut cand_stat: std::collections::HashMap<(usize, String, String), usize> =
            std::collections::HashMap::new();
        let mut pkg_map: std::collections::HashMap<(usize, String, String), PS<'_>> =
            std::collections::HashMap::new();
        let mut pkg_dir_ok = 0usize;
        let mut pkg_dir_miss = 0usize;
        for (fi, info) in infos.iter().enumerate() {
            for (pkg, path) in &info.imports {
                let Some(d) = resolve_pkg_dir(path, &dir_files) else {
                    pkg_dir_miss += 1;
                    continue;
                };
                pkg_dir_ok += 1;
                let files_in_dir = dir_files.get(d.as_str()).cloned().unwrap_or_default();
                // 新层：包目录内**全部**文件中同名可调用符号（跨多文件全收，仅唯一才登记）
                let want_pkg = path.rsplit('/').next().unwrap_or(path.as_str());
                for (_up, ident) in info.used.iter().filter(|(p, _)| p == pkg) {
                    let mut cands: Vec<PS<'_>> = Vec::new();
                    for &fidx in &files_in_dir {
                        // 同包约束：目录内文件声明的包名须与导入末段（或别名）一致
                        let fp = dir_pkg.get(dirs[fidx].as_str()).copied().unwrap_or("");
                        if fp != want_pkg && fp != infos[fidx].pkg {
                            // 包名不一致目录（罕见），仍允许：Go 允许目录内包名为 X 而导入末段不同
                        }
                        for s in by_file
                            .get(rels[fidx].as_str())
                            .map(|v| v.as_slice())
                            .unwrap_or(&[])
                        {
                            if s.name == ident.as_str() {
                                cands.push(*s);
                            }
                        }
                    }
                    // 去重（同一符号可能被多次计入）
                    let mut uniq: Vec<PS<'_>> = Vec::new();
                    for c in cands {
                        if !uniq
                            .iter()
                            .any(|u| u.fi == c.fi && u.line == c.line && u.name == c.name)
                        {
                            uniq.push(c);
                        }
                    }
                    if uniq.len() == 1 {
                        pkg_map.insert((fi, pkg.clone(), ident.clone()), uniq[0]);
                    }
                    // 基线：模拟 `resolve_go_pkg_dir` 的「优先选定义了该符号的文件」（取首个命中）
                    if let Some(first) = uniq.first() {
                        import_map.insert((fi, ident.clone()), *first);
                    }
                    // 自证计数：包名层为何未解析（0 候选 / 歧义）
                    cand_stat.insert((fi, pkg.clone(), ident.clone()), uniq.len());
                }
            }
        }

        // 探针内 Naive 层（与 `resolve_naive_tier` 同口径：同目录唯一 → 种类唯一）
        fn naive<'a>(
            by_name: &std::collections::HashMap<&str, Vec<PS<'a>>>,
            name: &str,
            caller_dir: &str,
            receiver: &str,
        ) -> Option<PS<'a>> {
            let cands = by_name.get(name)?;
            if cands.len() < 2 {
                return None;
            }
            let same_dir: Vec<PS<'a>> = cands
                .iter()
                .copied()
                .filter(|c| c.dir == caller_dir)
                .collect();
            if same_dir.len() == 1 {
                return Some(same_dir[0]);
            }
            let want = if receiver.is_empty() {
                "function"
            } else {
                "method"
            };
            let by_kind: Vec<PS<'a>> = cands.iter().copied().filter(|c| c.kind == want).collect();
            if by_kind.len() == 1 {
                Some(by_kind[0])
            } else {
                None
            }
        }

        // ── 逐调用点评测 ──
        let mut total_calls = 0usize;
        let mut qualified = 0usize;
        let mut base_resolved = 0usize;
        let mut new_resolved = 0usize;
        let mut new_only = 0usize;
        let mut differ = 0usize;
        let mut ambig_qualified = 0usize;
        let mut pkg_dir_unresolved_qualified = 0usize;
        let mut samples_recall: Vec<String> = Vec::new();
        let mut samples_diff: Vec<String> = Vec::new();
        // ── 自证拆解：限定调用里「导入目标在仓内」的那部分才可能被包名层救 ──
        let mut qual_in_tree = 0usize;
        let mut qual_external = 0usize;
        let mut intree_pkg_hit = 0usize;
        let mut intree_pkg_zero = 0usize;
        let mut intree_pkg_amb = 0usize;
        let mut intree_base_resolved = 0usize;
        let mut intree_new_only = 0usize;
        let mut intree_differ = 0usize;
        let mut intree_wrong_pkg = 0usize; // 基线解析到**别的包**的符号（最严重的错连）
                                           // 「包名层未命中即不回退裸名」变体
        let mut pkg_aliases: std::collections::HashSet<(usize, String)> =
            std::collections::HashSet::new();
        let mut strict_resolved = 0usize;
        let mut strict_lost = 0usize;
        let mut strict_wrong_pkg = 0usize;

        // 先登记「该文件用了哪些包别名」，供 strict 变体判断
        for (fi, info) in infos.iter().enumerate() {
            for (pkg, _path) in &info.imports {
                pkg_aliases.insert((fi, pkg.clone()));
            }
        }
        for (fi, info) in infos.iter().enumerate() {
            for (name, receiver, _line) in &info.calls {
                total_calls += 1;
                if receiver.is_empty() {
                    continue;
                }
                // 接收者是否为该文件导入的包名/别名
                let is_pkg = info.imports.iter().any(|(p, _)| p == receiver);
                if !is_pkg {
                    continue;
                }
                qualified += 1;
                // 该包名对应的导入路径是否落在被扫描的仓内
                let in_tree = info
                    .imports
                    .iter()
                    .filter(|(p, _)| p == receiver)
                    .any(|(_, path)| resolve_pkg_dir(path, &dir_files).is_some());
                if in_tree {
                    qual_in_tree += 1;
                } else {
                    qual_external += 1;
                }
                let local = by_file
                    .get(info.rel.as_str())
                    .and_then(|v| v.iter().copied().find(|s| s.name == name.as_str()));
                let imported = import_map.get(&(fi, name.clone())).copied();
                let global = by_name.get(name.as_str()).and_then(|v| {
                    if v.len() == 1 {
                        Some(v[0])
                    } else {
                        None
                    }
                });
                let nv = naive(&by_name, name, &info.dir, receiver);
                let base = local.or(imported).or(global).or(nv);

                let pkgd = pkg_map.get(&(fi, receiver.clone(), name.clone())).copied();
                let new = local.or(pkgd).or(imported).or(global).or(nv);
                // 变体：接收者是包别名但包名层未命中时，**不**回退裸名 imported
                // （裸名在此情形下多半来自别的包，属跨包错连）。
                let pkg_known = pkg_aliases.contains(&(fi, receiver.clone()));
                let strict = if pkg_known {
                    local.or(pkgd).or(global).or(nv)
                } else {
                    new
                };

                if by_name
                    .get(name.as_str())
                    .map(|v| v.len() > 1)
                    .unwrap_or(false)
                {
                    ambig_qualified += 1;
                }
                if pkgd.is_none() {
                    pkg_dir_unresolved_qualified += 1;
                }
                if in_tree {
                    match cand_stat
                        .get(&(fi, receiver.clone(), name.clone()))
                        .copied()
                    {
                        Some(1) => intree_pkg_hit += 1,
                        Some(0) | None => intree_pkg_zero += 1,
                        Some(_) => intree_pkg_amb += 1,
                    }
                    if base.is_some() {
                        intree_base_resolved += 1;
                    }
                }
                if strict.is_some() {
                    strict_resolved += 1;
                } else if new.is_some() {
                    strict_lost += 1;
                }
                if pkg_known {
                    // 严格模式下仍会连到别的目录 = 残留跨包错连
                    if let (Some(a), Some(b)) = (base, strict) {
                        if a.dir != b.dir {
                            strict_wrong_pkg += 1;
                        }
                    }
                }
                if base.is_some() {
                    base_resolved += 1;
                }
                if new.is_some() {
                    new_resolved += 1;
                }
                match (base, new) {
                    (None, Some(_)) => {
                        new_only += 1;
                        if in_tree {
                            intree_new_only += 1;
                        }
                        if samples_recall.len() < 12 {
                            samples_recall.push(format!("{}::{}.{}()", info.rel, receiver, name));
                        }
                    }
                    (Some(a), Some(b)) if a.fi != b.fi || a.line != b.line => {
                        differ += 1;
                        // 是否连到了**别的目录**（跨包错连，最严重的一类）
                        let cross_pkg = a.dir != b.dir;
                        if cross_pkg && in_tree {
                            intree_wrong_pkg += 1;
                        }
                        if in_tree {
                            intree_differ += 1;
                        }
                        if samples_diff.len() < 12 {
                            samples_diff.push(format!(
                                "{}::{}.{}() 旧→{}:{}  新→{}:{}",
                                info.rel, receiver, name, a.file, a.line, b.file, b.line
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }

        let pct = |a: usize, b: usize| {
            if b == 0 {
                0.0
            } else {
                (a as f64 / b as f64) * 100.0
            }
        };
        println!("\n===== replay_go_pkg_call_gain @ {} =====", dir);
        println!(
            "  Go 文件 {} · 可调用符号 {}",
            infos.len(),
            syms.iter().filter(|s| super::is_callable(s.kind)).count()
        );
        println!(
            "  导入路径解析：命中目录 {} / 未命中 {}（未命中多为模块外依赖）",
            pkg_dir_ok, pkg_dir_miss
        );
        println!("  ── 调用点 ──");
        println!("  |- 总调用点                 {:>6}", total_calls);
        println!(
            "  |- 包名限定调用 pkg.F()     {:>6} ({:.1}% of 总)",
            qualified,
            pct(qualified, total_calls)
        );
        println!(
            "  |- 其中裸名全局歧义         {:>6} ({:.1}%)",
            ambig_qualified,
            pct(ambig_qualified, qualified.max(1))
        );
        println!(
            "  |- 包名层未解析             {:>6} ({:.1}%)",
            pkg_dir_unresolved_qualified,
            pct(pkg_dir_unresolved_qualified, qualified.max(1))
        );
        println!("  ── 解析率 ──");
        println!(
            "  |- 当前（裸名链）已解析     {:>6} ({:.1}% of 限定调用)",
            base_resolved,
            pct(base_resolved, qualified.max(1))
        );
        println!(
            "  |- 加包名限定层后           {:>6} ({:.1}%)",
            new_resolved,
            pct(new_resolved, qualified.max(1))
        );
        println!("  ── 净增益 ──");
        println!("  |- 召回（旧丢新连）         {:>6}", new_only);
        println!("  |- 精度（旧连错，新纠正）   {:>6}", differ);
        println!("  召回样例 {:?}", samples_recall);
        println!("  纠正样例 {:?}", samples_diff);
        println!("  ── 自证拆解（限定调用按「导入目标是否在仓内」分）──");
        println!(
            "  |- 仓内（可救）             {:>6} ({:.1}% of 限定调用)",
            qual_in_tree,
            pct(qual_in_tree, qualified.max(1))
        );
        println!(
            "  |- 仓外（标准库/三方，不可救）{:>6} ({:.1}%)",
            qual_external,
            pct(qual_external, qualified.max(1))
        );
        println!("  |- 仓内·包名层唯一命中      {:>6}", intree_pkg_hit);
        println!("  |- 仓内·包名层 0 候选       {:>6}", intree_pkg_zero);
        println!("  |- 仓内·包名层歧义(≥2)      {:>6}", intree_pkg_amb);
        println!(
            "  |- 仓内·当前已解析          {:>6} ({:.1}% of 仓内)",
            intree_base_resolved,
            pct(intree_base_resolved, qual_in_tree.max(1))
        );
        println!("  |- 仓内·净新增(旧丢新连)    {:>6}", intree_new_only);
        println!("  |- 仓内·纠正(旧连错)        {:>6}", intree_differ);
        println!(
            "  |- 仓内·**跨包错连**(最严重){:>6} ({:.1}% of 仓内)",
            intree_wrong_pkg,
            pct(intree_wrong_pkg, qual_in_tree.max(1))
        );
        println!("  ── 变体：包名已知但包名层未命中时，不回退裸名 imported ──");
        println!("  |- strict 仍解析           {:>6}", strict_resolved);
        println!("  |- strict 丢掉（回归风险） {:>6}", strict_lost);
        println!("  |- strict 残留跨包错连     {:>6}", strict_wrong_pkg);
        println!(
            "  **净结论：限定调用解析率 {:.1}% → {:.1}%**",
            pct(base_resolved, qualified.max(1)),
            pct(new_resolved, qualified.max(1))
        );
    }

    // 用法：REPLAY_GOPKG_DIR=/abs/path cargo test replay_go_pkg_index_verify -- --ignored --nocapture
    //
    // 目的：**用生产函数本身**在真实 Go 工程上复核，而不是复核探针里的复刻实现。
    //       `replay_go_pkg_call_gain` 为量化「值不值得做」自建了一份等价逻辑；
    //       本探针直接调 `build_go_pkg_call_index`，确认落地后的真实行为与量化一致，
    //       并逐条核对量化阶段抓到的错连样例是否已纠正到正确的包。
    #[test]
    #[ignore]
    fn replay_go_pkg_index_verify() {
        let dir = match std::env::var("REPLAY_GOPKG_DIR") {
            Ok(v) if !v.is_empty() => v,
            _ => return,
        };

        fn walk(d: &std::path::Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(d) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
                    if matches!(
                        n,
                        "node_modules"
                            | "target"
                            | "dist"
                            | ".git"
                            | "build"
                            | "vendor"
                            | "testdata"
                            | "out"
                    ) {
                        continue;
                    }
                    walk(&p, out);
                } else if p.is_file() && p.to_str().is_some() {
                    out.push(p.to_str().unwrap().to_string());
                }
            }
        }

        let mut paths: Vec<String> = Vec::new();
        walk(std::path::Path::new(&dir), &mut paths);
        paths.retain(|p| p.ends_with(".go") && !p.ends_with("_test.go"));
        paths.sort();

        let mut files: Vec<ProjectFile> = Vec::new();
        let mut syms: Vec<ProjectSymbol> = Vec::new();
        for (i, p) in paths.iter().enumerate() {
            let Ok(content) = std::fs::read_to_string(p) else {
                continue;
            };
            if content.len() > 2_000_000 {
                continue;
            }
            let rel = p
                .strip_prefix(&dir)
                .unwrap_or(p.as_str())
                .trim_start_matches('/')
                .to_string();
            let fid = format!("F{i}");
            for s in crate::commands::code_structure::extract_symbols("go", &content) {
                let mut ps = nsym(&format!("{fid}_{}", syms.len()), &s.name, &s.kind, &rel);
                ps.file_id = fid.clone();
                syms.push(ps);
            }
            let mut f = ProjectFile::default();
            f.id = fid;
            f.rel_path = rel;
            f.path = p.clone();
            f.language = Some("go".to_string());
            f.is_directory = false;
            files.push(f);
        }

        let mut by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
        for s in &syms {
            by_file.entry(s.file_id.clone()).or_default().push(s);
        }
        let cache = crate::commands::project_scan::ScanContentCache::new();
        let g = build_go_pkg_call_index(&files, &by_file, &cache);

        // 逐条核对量化阶段抓到的跨包错连样例：现在应指向**正确**的包
        let checks: &[(&str, &str, &str, &str)] = &[
            (
                "cmd/callgraph/main.go",
                "static",
                "CallGraph",
                "go/callgraph/static/",
            ),
            (
                "cmd/callgraph/main.go",
                "cha",
                "CallGraph",
                "go/callgraph/cha/",
            ),
            ("cmd/godoc/main.go", "gatefs", "New", "godoc/vfs/gatefs/"),
            ("cmd/godoc/main.go", "mapfs", "New", "godoc/vfs/mapfs/"),
            (
                "go/analysis/multichecker/multichecker.go",
                "checker",
                "Run",
                "go/analysis/internal/checker/",
            ),
        ];
        let by_rel: HashMap<&str, &str> = files
            .iter()
            .map(|f| (f.rel_path.as_str(), f.id.as_str()))
            .collect();
        println!("\n===== replay_go_pkg_index_verify @ {} =====", dir);
        println!(
            "  Go 文件 {} · 符号 {} · 索引条目 {}",
            files.len(),
            syms.len(),
            g.len()
        );
        let mut ok = 0usize;
        let mut miss = 0usize;
        for (rel, pkg, member, expect_dir) in checks {
            let Some(fid) = by_rel.get(rel) else {
                println!("  [skip] {rel} 不在样本内");
                continue;
            };
            match g.get(&(fid.to_string(), pkg.to_string(), member.to_string())) {
                Some(s) if s.file_path.starts_with(expect_dir) => {
                    ok += 1;
                    println!("  [OK]   {rel}::{pkg}.{member}() → {}", s.file_path);
                }
                Some(s) => {
                    miss += 1;
                    println!(
                        "  [MISS] {rel}::{pkg}.{member}() → {}（期望 {expect_dir}）",
                        s.file_path
                    );
                }
                None => {
                    miss += 1;
                    println!("  [MISS] {rel}::{pkg}.{member}() → 未索引（期望 {expect_dir}）");
                }
            }
        }
        // 反向不变量：同一个 (文件, 成员名) 在不同包别名下不得 collapse 到同一符号
        let mut per_file_member: HashMap<(String, String), std::collections::HashSet<String>> =
            HashMap::new();
        for ((fid, _pkg, member), s) in &g {
            per_file_member
                .entry((fid.clone(), member.clone()))
                .or_default()
                .insert(s.id.clone());
        }
        let distinguished = per_file_member.values().filter(|v| v.len() > 1).count();
        println!("  ── 不变量 ──");
        println!(
            "  |- 同文件同名成员被区分到不同符号的条目 {:>4}（此前会 collapse 成 1 个）",
            distinguished
        );
        println!("  |- 抽查样例：纠正 {} / 未纠正 {}", ok, miss);
    }

    /// 探针用的 Go import 规格 + 用量归集（与 `extract_go_symbol_imports` 同口径，
    /// 复用 production 的 tree-sitter 抽取，避免探针自造解析导致口径漂移）。
    fn go_probe_imports(content: &str) -> (Vec<(String, String)>, Vec<(String, String)>) {
        // 走 ParserRegistry 公开入口（`symbol_imports_ast` 是 parser 私有模块），
        // 与生产 `GoParser::parse_imports_with_symbols` 完全同一实现，零口径漂移。
        let mut imports: Vec<(String, String)> = Vec::new();
        let mut used: Vec<(String, String)> = Vec::new();
        let parsed: Vec<crate::commands::code_structure::ParsedImport> =
            crate::commands::code_structure::parse_imports_with_symbols("go", content);
        // `ParsedImport` 只带导入路径与符号名，包名（别名/末段）需自行推导
        let mut parser = tree_sitter::Parser::new();
        if parser
            .set_language(&tree_sitter_go::LANGUAGE.into())
            .is_err()
        {
            return (imports, used);
        }
        let Some(tree) = parser.parse(content, None) else {
            return (imports, used);
        };
        let src = content.as_bytes();
        let root = tree.root_node();
        // 导入规格：(包名, 路径)
        let mut specs: Vec<(String, String)> = Vec::new();
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == "import_spec" {
                let path = n
                    .child_by_field_name("path")
                    .map(|p| p.utf8_text(src).unwrap_or("").trim_matches('"').to_string())
                    .unwrap_or_default();
                if !path.is_empty() {
                    let alias = n.child_by_field_name("name").and_then(|a| match a.kind() {
                        "dot" | "blank_identifier" => None,
                        _ => Some(a.utf8_text(src).unwrap_or("").to_string()),
                    });
                    let pkg = alias.unwrap_or_else(|| {
                        path.rsplit('/').next().unwrap_or(path.as_str()).to_string()
                    });
                    specs.push((pkg, path));
                }
                continue;
            }
            let mut cur = n.walk();
            for c in n.children(&mut cur).collect::<Vec<_>>().into_iter().rev() {
                stack.push(c);
            }
        }
        // 用量：把 parsed 的符号名挂到其所属包名下（production 的 ParsedImport 带 ref_line）
        let mut rest = parsed;
        rest.sort_by_key(|p| p.line);
        for pi in &rest {
            // 按导入路径末段/别名匹配包名
            let pkg = specs
                .iter()
                .find(|(_, path)| *path == pi.path)
                .map(|(p, _)| p.clone());
            if let Some(p) = pkg {
                for s in &pi.symbols {
                    used.push((p.clone(), s.clone()));
                }
            }
        }
        for (p, path) in specs {
            imports.push((p, path));
        }
        (imports, used)
    }
}
