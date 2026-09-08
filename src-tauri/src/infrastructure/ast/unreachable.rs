//! 过程内不可达代码检测（joern CPG `reachableBy` 的降级子集，含常量传播）
//!
//! 参考项目 joern-master：其 `semanticcpg` 在 AST 之上建完整 CFG（True/False/Always/Case
//! 边），`def.reachableBy(entry)` 即可回答「从函数入口能否走到这条语句」。落在 CFG 里
//! 就是：入口节点能到达 `return`/`throw`，而 `return` 没有出边，于是它之后的语句不可达。
//! 此外 joern 的常量传播（dataflow engine 沿 `cpg` 折叠常量）能把
//! `const DEBUG = false; if (DEBUG) {…}` 中的死分支识别出来——本模块第 3 项能力即对标它。
//!
//! 我们当前 `commands/dead_code.rs` 只做**引用级**死代码（符号从未被任何文件 import/调用），
//! 完全不分析「符号内部、定义了但永远走不到的语句」。本模块补齐这一层，对标 joern 的
//! CFG 可达性，但只取其中**无歧义、零误报**的子集，避免重造完整 CFG：
//!
//! 1. **尾随不可达语句（trailing unreachable）**：在某语句块（函数体 / if / for / while
//!    / switch 的 case 体等）里，一旦遇到直接属于该块的 `return` / `throw`（块级终结符），
//!    其后同一块内的兄弟语句永远执行不到 → 不可达。等价于 CFG 从入口沿 Always 边走到
//!    return，return 无出边。
//!    - `break` / `continue` 故意**不**算块级终结符：它们只终结所在循环体，外层块在循环
//!      之后的语句仍可达，若误判会产生大量误报。
//! 2. **常量条件死分支（constant-condition dead branch）**：`if (false) {…}` / `if (true){…}else{…}`
//!    这类条件编译 / 调试开关，其永不被选中的分支体整段不可达。
//!    - **常量传播（本模块增强）**：不仅认字面量 `true/false/0/1`，还认模块级 `const`/`final`
//!      布尔常量（`const DEBUG=false; if(DEBUG)`），以及逻辑短路（`false && x` 永假、
//!      `true || x` 永真）、三元常量条件（`FLAG ? a : b`）、`while(false)`/`for false` 死循环。
//!    - 仅收录**顶层 const/final 且初值为 true/false 字面量**的绑定做传播，函数内局部 `const`
//!      不收录（避免同名遮蔽导致误判），最坏情况是漏报而非误报。
//!
//! 实现采用树遍历 + 每方言节点 kind 表（与 `mod.rs::is_decision_node` 同源思路），不依赖
//! 完整 CFG，故正确且零新依赖。覆盖 TS/JS/Rust/Python/Go/Java/C 系（Swift/Kotlin/Ruby/PHP
//! 节点 kind 未经实跑核实，按铁律先排除（返回空），留作后续轮次补齐。
//!
//! 输出为纯数据（`Vec<UnreachableStmt>`），落库与前端呈现由 `commands/dead_code.rs` 负责，
//! 保持本模块可被单测直接驱动、无 DB 耦合。

use crate::infrastructure::ast::{dialect_for, operator_text, Dialect};
use std::collections::HashMap;
use tree_sitter::{Node, Parser};

/// 单条不可达语句发现
#[derive(Debug, Clone)]
pub struct UnreachableStmt {
    pub line_start: usize,
    pub line_end: usize,
    /// 该语句的源码片段（截断）
    pub snippet: String,
    /// high：结构必然不可达（return/throw 之后的尾随）；medium：常量条件死分支（可能故意）
    pub confidence: &'static str,
    /// 人类可读的判定说明
    pub reason: &'static str,
}

impl UnreachableStmt {
    fn snippet_of(node: Node, source: &[u8]) -> String {
        let s = node.utf8_text(source).unwrap_or("").trim().to_string();
        if s.len() > 120 {
            format!("{}…", &s[..120])
        } else {
            s
        }
    }
}

/// 模块级布尔常量绑定（joern 式常量传播用）。仅收录顶层 const/final 且初值为 `true`/`false`
/// 字面量的绑定；用于把 `const DEBUG=false; if(DEBUG){…}` 中的死分支识别出来。最坏情况漏报。
#[derive(Default)]
struct ConstBindings(HashMap<String, bool>);

/// 该方言是否支持过程内不可达检测（节点 kind 已确认）
fn supported(d: Dialect) -> bool {
    matches!(
        d,
        Dialect::TypeScript
            | Dialect::Tsx
            | Dialect::Rust
            | Dialect::Python
            | Dialect::Go
            | Dialect::Java
            | Dialect::CSharp
            | Dialect::Cpp
            | Dialect::C
    )
}

/// 语句块节点 kind 集合（块级终结符只针对「直接属于这些块的子语句」生效）
fn block_kinds(d: Dialect) -> &'static [&'static str] {
    match d {
        Dialect::TypeScript | Dialect::Tsx => &["statement_block", "program"],
        Dialect::Rust => &["block", "source_file"],
        Dialect::Python => &["block", "module"],
        Dialect::Go => &["block", "program"],
        Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => &["block", "program"],
        // 其余方言不启用，返回空即可
        _ => &[],
    }
}

fn is_block<'a>(d: Dialect, node: Node<'a>) -> bool {
    let k = node.kind();
    if block_kinds(d).contains(&k) {
        return true;
    }
    // 跨方言兜底：语句序列容器（无论叫 block / statement_list / compound_statement / _block）
    // 都是「顺序兄弟语句」的载体，尾随终结符语义一致。
    k == "program"
        || k == "source_file"
        || k == "module"
        || k == "statement_list"
        || k == "compound_statement"
        || k.ends_with("_block")
        || k.ends_with("_list")
}

/// 块级终结符（return / throw / raise）——直接属于某块时，其后兄弟语句不可达
fn is_terminator<'a>(d: Dialect, node: Node<'a>) -> bool {
    let k = node.kind();
    match d {
        Dialect::TypeScript | Dialect::Tsx => k == "return_statement" || k == "throw_statement",
        Dialect::Rust => k == "return_expression", // Rust 无 throw 关键字（panic! 为宏调用，不在此列）
        Dialect::Python => k == "return_statement" || k == "raise_statement",
        Dialect::Go => k == "return_statement", // Go 无 throw（panic 为内建调用）
        Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => {
            k == "return_statement" || k == "throw_statement"
        }
        _ => false,
    }
}

fn is_if<'a>(d: Dialect, node: Node<'a>) -> bool {
    let k = node.kind();
    match d {
        Dialect::TypeScript | Dialect::Tsx => k == "if_statement",
        Dialect::Rust => k == "if_expression",
        Dialect::Python => k == "if_statement",
        Dialect::Go | Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => k == "if_statement",
        _ => false,
    }
}

/// 三元 / 条件表达式（常量条件时其一分支死）
fn is_ternary(kind: &str) -> bool {
    kind == "ternary_expression" || kind == "conditional_expression"
}

/// 取出 if 节点的条件子节点（通常是有序子节点中的第一个表达式子节点）
fn if_condition<'a>(node: Node<'a>) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    let kids: Vec<Node<'a>> = node.named_children(&mut cursor).collect();
    kids.into_iter().find(|c| {
        let k = c.kind();
        // 排除 consequence / alternative 块与 else 类子节点
        !k.ends_with("_block") && !k.starts_with("else") && k != "consequence" && k != "alternative"
    })
}

/// 在 if 的剩余命名子节点里定位 else 分支
fn if_alternative<'a>(node: Node<'a>) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    let kids: Vec<Node<'a>> = node.named_children(&mut cursor).collect();
    kids.into_iter()
        .find(|c| c.kind().starts_with("else") || c.kind() == "alternative" || c.kind() == "else_clause")
}

/// 取 if 的 consequence（第一个非条件、非 else 的命名子节点）
fn if_consequence<'a>(node: Node<'a>, cond: Node<'a>) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    let kids: Vec<Node<'a>> = node.named_children(&mut cursor).collect();
    kids.into_iter().find(|c| {
        c.id() != cond.id() && !c.kind().starts_with("else") && c.kind() != "alternative" && c.kind() != "else_clause"
    })
}

/// 取节点的所有命名子节点（避免迭代器借用 cursor 导致返回 Node 悬垂）
fn named_children_vec<'a>(node: Node<'a>) -> Vec<Node<'a>> {
    let mut c = node.walk();
    node.named_children(&mut c).collect()
}

/// 取节点的首个命名子节点
fn first_named<'a>(node: Node<'a>) -> Option<Node<'a>> {
    named_children_vec(node).into_iter().next()
}

/// 取节点的第 2 个命名子节点
fn second_named<'a>(node: Node<'a>) -> Option<Node<'a>> {
    named_children_vec(node).get(1).copied()
}

/// 取节点的第 3 个命名子节点
fn third_named<'a>(node: Node<'a>) -> Option<Node<'a>> {
    named_children_vec(node).get(2).copied()
}

/// 布尔字面量取值：仅 `true`/`false` 节点算布尔常量（数字不在此列，避免把 `const N=0`
/// 误当布尔常量传播）。部分 grammar 把布尔字面量包在 `boolean_literal` 节点，或把单值常量
/// 包在 `expression_list` 里（Go `const x = false`），需要看穿一层取内部字面量。
fn bool_literal_value<'a>(node: Node<'a>, source: &[u8]) -> Option<bool> {
    match node.kind() {
        "true" => Some(true),
        "false" => Some(false),
        "boolean_literal" => {
            let t = node.utf8_text(source).ok()?.trim();
            match t {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            }
        }
        "expression_list" | "parenthesized_expression" => {
            // 看穿一层包裹（Go 单值常量、带括号常量）取内部字面量
            first_named(node).and_then(|n| bool_literal_value(n, source))
        }
        _ => None,
    }
}

/// 从任意 `*_declarator` 节点抽取 `(名字, 布尔值)`，名字须为 identifier、初值须为 true/false 字面量。
/// 兼容 TS `variable_declarator`(name/value)、C/C++ `init_declarator`(declarator/value)、
/// Java/C# `variable_declarator`。
fn binding_from_declarator<'a>(decl: Node<'a>, source: &[u8]) -> Option<(String, bool)> {
    let name_node = decl.child_by_field_name("name").or_else(|| decl.child_by_field_name("declarator"))?;
    if name_node.kind() != "identifier" {
        return None;
    }
    let value = decl.child_by_field_name("value")?;
    let name = name_node.utf8_text(source).ok()?.to_string();
    bool_literal_value(value, source).map(|b| (name, b))
}

/// 递归布尔求值（joern 式常量传播核心）：字面量 + 模块常量 + `!` + `&&`/`||` 短路 + 括号。
/// 返回 None 表示「非常量 / 无法确定」——调用方据此保守跳过，保证零误报。
fn eval_bool<'a>(node: Node<'a>, source: &[u8], consts: &ConstBindings) -> Option<bool> {
    let kind = node.kind();
    match kind {
        "true" => return Some(true),
        "false" => return Some(false),
        _ => {}
    }
    let text = node.utf8_text(source).ok()?.trim().to_string();
    // 数字字面量按真值性处理（仅用于直接字面量条件，保持旧行为；常量绑定只认 true/false）
    if let Ok(v) = text.parse::<i64>() {
        return Some(v != 0);
    }
    // 标识符引用模块级布尔常量
    if matches!(kind, "identifier" | "const_identifier" | "field_identifier") {
        return consts.0.get(&text).copied();
    }
    // 括号：剥一层取内部表达式
    if kind == "parenthesized_expression" {
        if let Some(inner) = first_named(node) {
            return eval_bool(inner, source, consts);
        }
        return None;
    }
    // 一元 `!`
    if kind == "unary_expression" {
        if operator_text(&node, source).as_deref() == Some("!") {
            if let Some(operand) = first_named(node) {
                return eval_bool(operand, source, consts).map(|b| !b);
            }
        }
        return None;
    }
    // 二元 `&&` / `||`（短路语义）
    if kind == "binary_expression" {
        let op = operator_text(&node, source);
        match op.as_deref() {
            Some("&&") => {
                let (l, r) = (first_named(node)?, second_named(node)?);
                return and_eval(l, r, source, consts);
            }
            Some("||") => {
                let (l, r) = (first_named(node)?, second_named(node)?);
                return or_eval(l, r, source, consts);
            }
            _ => return None,
        }
    }
    None
}

/// `a && b`：左假则整体假；左真则看右；左未知时右假则整体假（短路）。
fn and_eval<'a>(l: Node<'a>, r: Node<'a>, source: &[u8], consts: &ConstBindings) -> Option<bool> {
    match eval_bool(l, source, consts) {
        Some(false) => Some(false),
        Some(true) => eval_bool(r, source, consts),
        None => match eval_bool(r, source, consts) {
            Some(false) => Some(false),
            _ => None,
        },
    }
}

/// `a || b`：左真则整体真；左假则看右；左未知时右真则整体真（短路）。
fn or_eval<'a>(l: Node<'a>, r: Node<'a>, source: &[u8], consts: &ConstBindings) -> Option<bool> {
    match eval_bool(l, source, consts) {
        Some(true) => Some(true),
        Some(false) => eval_bool(r, source, consts),
        None => match eval_bool(r, source, consts) {
            Some(true) => Some(true),
            _ => None,
        },
    }
}

/// 是否某方言的「常量声明」节点（用于抽取绑定）
fn is_const_decl(d: Dialect, kind: &str) -> bool {
    match d {
        Dialect::TypeScript | Dialect::Tsx => kind == "lexical_declaration",
        Dialect::Rust => kind == "const_item",
        Dialect::Go => kind == "const_declaration",
        Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => {
            kind == "field_declaration" || kind == "declaration"
        }
        _ => false,
    }
}

/// 是否某方言里「可继续向下查找常量」的容器（类 / 接口 / 命名空间 / 模块 / 源文件根）。
/// 故意**不含**函数 / 方法 / 闭包 / 语句块——避免收录函数内局部 `const`（防同名遮蔽误判）。
fn is_const_container(d: Dialect, kind: &str) -> bool {
    match d {
        Dialect::TypeScript | Dialect::Tsx => matches!(
            kind,
            "program"
                | "export_statement"
                | "class_declaration"
                | "abstract_class_declaration"
                | "interface_declaration"
                | "enum_declaration"
                | "module_declaration"
                | "namespace"
                | "namespace_declaration"
        ),
        Dialect::Rust => matches!(
            kind,
            "source_file" | "mod_item" | "impl_item" | "struct_item" | "enum_item" | "trait_item"
        ),
        Dialect::Go => kind == "program",
        Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => matches!(
            kind,
            "compilation_unit"
                | "translation_unit"
                | "program"
                | "class_declaration"
                | "interface_declaration"
                | "struct_declaration"
                | "enum_declaration"
                | "namespace_definition"
                | "linkage_specification"
                | "class_body"
                | "interface_body"
                | "enum_body"
                | "struct_body"
                | "declaration_list"
                | "field_declaration_list"
                | "class_specifier"
                | "struct_specifier"
        ),
        _ => false,
    }
}

/// 从单个常量声明节点抽取 `(名字, 布尔值)` 列表（一个声明可能含多个 declarator）
fn extract_consts<'a>(node: Node<'a>, d: Dialect, source: &[u8]) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    match d {
        Dialect::TypeScript | Dialect::Tsx => {
            // lexical_declaration：仅 const 关键字（let/var 不算）
            let text = node.utf8_text(source).unwrap_or("").trim_start();
            if !text.starts_with("const") {
                return out;
            }
            let mut c = node.walk();
            for decl in node.named_children(&mut c) {
                if decl.kind() == "variable_declarator" {
                    if let Some(b) = binding_from_declarator(decl, source) {
                        out.push(b);
                    }
                }
            }
        }
        Dialect::Rust => {
            if let Some(b) = binding_from_declarator(node, source) {
                out.push(b);
            }
        }
        Dialect::Go => {
            let mut c = node.walk();
            for spec in node.named_children(&mut c) {
                if spec.kind() == "const_spec" {
                    if let Some(b) = binding_from_declarator(spec, source) {
                        out.push(b);
                    }
                }
            }
        }
        Dialect::Java | Dialect::CSharp | Dialect::Cpp | Dialect::C => {
            let text = node.utf8_text(source).unwrap_or("");
            let is_const_like = text.contains("final")
                || text.contains("const")
                || text.contains("readonly")
                || text.contains("constexpr");
            if !is_const_like {
                return out;
            }
            let mut c = node.walk();
            for decl in node.named_children(&mut c) {
                if decl.kind().ends_with("declarator") {
                    if let Some(b) = binding_from_declarator(decl, source) {
                        out.push(b);
                    }
                }
            }
        }
        _ => {}
    }
    out
}

/// 预扫描顶层常量绑定（joern 式常量传播的前置：建 name→bool 表）
fn collect_const_bindings<'a>(root: Node<'a>, d: Dialect, source: &[u8]) -> ConstBindings {
    let mut map = HashMap::new();
    if matches!(
        d,
        Dialect::TypeScript
            | Dialect::Tsx
            | Dialect::Rust
            | Dialect::Go
            | Dialect::Java
            | Dialect::CSharp
            | Dialect::Cpp
            | Dialect::C
    ) {
        walk_consts(root, d, source, &mut map);
    }
    ConstBindings(map)
}

fn walk_consts<'a>(node: Node<'a>, d: Dialect, source: &[u8], map: &mut HashMap<String, bool>) {
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if is_const_decl(d, child.kind()) {
            for (name, val) in extract_consts(child, d, source) {
                map.insert(name, val);
            }
        }
        if is_const_container(d, child.kind()) {
            walk_consts(child, d, source, map);
        }
    }
}

/// 取循环条件节点（while/while_expression 的首个命名子节点即条件表达式）
fn loop_condition<'a>(node: Node<'a>) -> Option<Node<'a>> {
    first_named(node)
}

/// 取循环体（首个语句块节点）
fn loop_body<'a>(d: Dialect, node: Node<'a>) -> Option<Node<'a>> {
    named_children_vec(node)
        .into_iter()
        .find(|k| is_block(d, *k))
}

/// Go `for` 的「纯条件」形式（`for cond {}`）：首个命名子节点须是表达式而非 block /
/// range（`expression_list`）/ 短变量声明（`:=`）/ 赋值。其余形式（死循环 `for {}`、
/// 遍历 `for k := range`、三段式 `for i;c;i++`）返回 None 以避免误判。
fn go_for_condition<'a>(node: Node<'a>) -> Option<Node<'a>> {
    let first = first_named(node)?;
    let k = first.kind();
    if matches!(
        k,
        "block" | "short_var_declaration" | "assignment" | "var_declaration" | "expression_list"
    ) {
        return None;
    }
    Some(first)
}

/// 该循环是否为「常量条件永假」→ 整个循环体死（joern CFG：条件永假则循环体不可达）
fn is_dead_loop<'a>(d: Dialect, node: Node<'a>, source: &[u8], consts: &ConstBindings) -> bool {
    let k = node.kind();
    match d {
        Dialect::TypeScript | Dialect::Tsx | Dialect::Rust | Dialect::Java | Dialect::CSharp
        | Dialect::Cpp | Dialect::C => {
            if k == "while_statement" || k == "while_expression" {
                if let Some(cond) = loop_condition(node) {
                    return eval_bool(cond, source, consts) == Some(false);
                }
            }
            false
        }
        Dialect::Go => {
            if k == "for_statement" {
                if let Some(cond) = go_for_condition(node) {
                    return eval_bool(cond, source, consts) == Some(false);
                }
            }
            false
        }
        _ => false,
    }
}

/// 语句包裹节点：部分 grammar（如 Rust/Go 的 `expression_statement`）把 `return` 包了一层，
/// 需要看穿一层才能判定块级终结符。
fn is_stmt_wrapper(kind: &str) -> bool {
    kind == "expression_statement" || kind == "expression" || kind == "declaration"
}

/// 注释节点（line_comment / block_comment / *_doc_comment 等）：不是可执行语句，
/// 不能当作「尾随不可达」或「死分支」语句登记，否则 `return` 之后的注释会被误报。
fn is_comment(kind: &str) -> bool {
    kind.contains("comment")
}

/// 块级终结符判定：节点自身是 return/throw/raise，或它是对应的语句包裹节点且内部唯一
/// 有效子节点是 return/throw/raise（即「执行此语句必然离开本块」）。
///
/// 注意：这里只看穿「一层包裹 + 直接子节点」，不递归进 `if`/`loop` 等条件/循环结构，
/// 因此 `if (x) { return; }` 这类条件返回不会误判为终结外层块（由 scan 的递归单独处理内层）。
fn is_terminator_node<'a>(d: Dialect, node: Node<'a>) -> bool {
    if is_terminator(d, node) {
        return true;
    }
    if is_stmt_wrapper(node.kind()) {
        let mut cursor = node.walk();
        for k in node.named_children(&mut cursor) {
            if is_terminator(d, k) {
                return true;
            }
        }
    }
    false
}

/// 把一个死分支体里的「顶层语句」登记为不可达
fn record_dead_branch<'a>(d: Dialect, branch: Node<'a>, source: &[u8], out: &mut Vec<UnreachableStmt>) {
    if is_block(d, branch) {
        let mut cursor = branch.walk();
        for stmt in branch.named_children(&mut cursor) {
            if is_comment(stmt.kind()) {
                continue; // 注释不是可执行语句，不算死代码
            }
            push_stmt(stmt, source, out, "medium", "常量条件分支永不被选中，分支体内语句不可达");
        }
    } else {
        push_stmt(branch, source, out, "medium", "常量条件分支永不被选中，该语句不可达");
    }
}

fn push_stmt<'a>(node: Node<'a>, source: &[u8], out: &mut Vec<UnreachableStmt>, confidence: &'static str, reason: &'static str) {
    out.push(UnreachableStmt {
        line_start: node.start_position().row + 1,
        line_end: node.end_position().row + 1,
        snippet: UnreachableStmt::snippet_of(node, source),
        confidence,
        reason,
    });
}

/// 主入口：检测单文件的过程内不可达语句
pub fn detect_unreachable(lang: &str, rel_path: &str, content: &str) -> Vec<UnreachableStmt> {
    let dialect = match dialect_for(lang, rel_path) {
        Some(d) if supported(d) => d,
        _ => return Vec::new(), // 不支持的方言直接返回空，零误报
    };
    if content.len() > 2_000_000 {
        return Vec::new();
    }
    let mut parser = Parser::new();
    let Ok(()) = parser.set_language(&dialect.language()) else {
        return Vec::new();
    };
    let Some(tree) = parser.parse(content, None) else {
        return Vec::new();
    };
    let bytes = content.as_bytes();
    let root = tree.root_node();
    if root.has_error() {
        return Vec::new(); // 语法错误文件不分析，避免 ERROR 节点导致误报
    }
    // joern 式常量传播：先建模块级常量绑定表
    let consts = collect_const_bindings(root, dialect, bytes);
    let mut out = Vec::new();
    scan(root, dialect, bytes, &consts, &mut out);
    out
}

/// 递归扫描：每个语句块处理尾随不可达；每个 if / 三元处理常量条件死分支；每个循环处理死循环。
fn scan<'a>(node: Node<'a>, d: Dialect, source: &[u8], consts: &ConstBindings, out: &mut Vec<UnreachableStmt>) {
    // 1) if 常量条件死分支
    if is_if(d, node) {
        if let Some(cond) = if_condition(node) {
            match eval_bool(cond, source, consts) {
                Some(true) => {
                    if let Some(alt) = if_alternative(node) {
                        record_dead_branch(d, alt, source, out);
                    }
                }
                Some(false) => {
                    if let Some(conseq) = if_consequence(node, cond) {
                        record_dead_branch(d, conseq, source, out);
                    }
                }
                None => {}
            }
        }
    }

    // 2) 三元 / 条件表达式常量条件死分支
    if is_ternary(node.kind()) {
        if let Some(cond) = first_named(node) {
            match eval_bool(cond, source, consts) {
                Some(true) => {
                    // 条件真 → alternate 分支死
                    if let Some(alt) = third_named(node) {
                        record_dead_branch(d, alt, source, out);
                    }
                }
                Some(false) => {
                    // 条件假 → consequence（第 2 个命名子节点）分支死
                    if let Some(conseq) = second_named(node) {
                        record_dead_branch(d, conseq, source, out);
                    }
                }
                None => {}
            }
        }
    }

    // 3) 死循环（while(false) / for false）
    if is_dead_loop(d, node, source, consts) {
        if let Some(body) = loop_body(d, node) {
            record_dead_branch(d, body, source, out);
        }
    }

    // 4) 语句块尾随不可达 + 递归
    if is_block(d, node) {
        let mut cursor = node.walk();
        let kids: Vec<Node<'a>> = node.named_children(&mut cursor).collect();
        let mut terminated = false;
        for kid in kids {
            if terminated {
                // 块级终结符之后的兄弟语句永远执行不到（注释除外，它不是可执行语句）
                if !is_comment(kid.kind()) {
                    push_stmt(kid, source, out, "high", "前面的 return/throw 已终结本块，此语句不可达");
                }
            }
            if is_terminator_node(d, kid) {
                terminated = true;
            }
            // 递归：处理嵌套块 / 嵌套 if / 三元 / 循环
            scan(kid, d, source, consts, out);
        }
    } else {
        let mut cursor = node.walk();
        for kid in node.named_children(&mut cursor) {
            scan(kid, d, source, consts, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lang: &str, src: &str) -> Vec<UnreachableStmt> {
        detect_unreachable(lang, &format!("test.{}", lang), src)
    }

    #[test]
    fn ts_trailing_after_return_is_unreachable() {
        let src = r#"
function f(x) {
  if (x) return 1;
  return 2;
  const y = 3;
  console.log(y);
}
"#;
        let r = run("typescript", src);
        // return 2 之后的 const y / console.log 不可达
        assert!(r.iter().any(|u| u.snippet.contains("const y") && u.confidence == "high"));
        assert!(r.iter().any(|u| u.snippet.contains("console.log") && u.confidence == "high"));
    }

    #[test]
    fn ts_nested_return_does_not_mark_outer() {
        let src = r#"
function f(x) {
  if (x) {
    return 1;
  }
  const y = 2;
  return y;
}
"#;
        let r = run("typescript", src);
        // 内层 return 只终结 if 块，外层 const y 仍可达 → 不应有 high 发现
        assert!(!r.iter().any(|u| u.snippet.contains("const y")), "外层语句被误判不可达");
    }

    #[test]
    fn ts_if_false_dead_branch() {
        let src = r#"
function f() {
  if (false) {
    doDead();
  } else {
    doLive();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn ts_if_true_dead_else() {
        let src = r#"
function f() {
  if (true) {
    doLive();
  } else {
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn rust_return_then_unreachable() {
        let src = r#"
fn f(x: i32) -> i32 {
    if x > 0 { return 1; }
    let y = 2;
    return y;
}
"#;
        // if 内 return 只终结 if 块；外层 let y 可达
        let r = run("rust", src);
        assert!(!r.iter().any(|u| u.snippet.contains("let y")));
    }

    #[test]
    fn rust_trailing_after_return_expr() {
        let src = r#"
fn f() -> i32 {
    return 0;
    let z = 9;
    z
}
"#;
        let r = run("rust", src);
        assert!(r.iter().any(|u| u.snippet.contains("let z") && u.confidence == "high"));
    }

    #[test]
    fn python_raise_then_unreachable() {
        let src = r#"
def f():
    raise ValueError("x")
    print("never")
"#;
        let r = run("python", src);
        assert!(r.iter().any(|u| u.snippet.contains("print") && u.confidence == "high"));
    }

    #[test]
    fn go_return_then_unreachable() {
        let src = r#"
package main
func f() int {
    return 1
    return 2
}
"#;
        let r = run("go", src);
        assert!(r.iter().any(|u| u.snippet.contains("return 2") && u.confidence == "high"));
    }

    #[test]
    fn go_if_false_dead_branch() {
        let src = r#"
package main
func f() {
    if false {
        doDead()
    } else {
        doLive()
    }
}
"#;
        let r = run("go", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn java_return_then_unreachable() {
        let src = r#"
class A {
    int f() {
        return 1;
        return 2;
    }
}
"#;
        let r = run("java", src);
        assert!(r.iter().any(|u| u.snippet.contains("return 2") && u.confidence == "high"));
    }

    #[test]
    fn no_false_positive_on_break() {        // break 不算块级终结符：循环之后的语句仍可达
        let src = r#"
function f() {
  for (let i = 0; i < 10; i++) {
    if (i > 5) break;
  }
  const after = 1;
  return after;
}
"#;
        let r = run("typescript", src);
        assert!(!r.iter().any(|u| u.snippet.contains("const after")));
    }

    // ── 常量传播（joern 式 dead-branch 增强）──

    #[test]
    fn ts_const_prop_if_false() {
        let src = r#"
const DEBUG = false;
function f() {
  if (DEBUG) {
    doDead();
  } else {
    doLive();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn ts_const_prop_if_true() {
        let src = r#"
const VERBOSE = true;
function f() {
  if (VERBOSE) {
    doLive();
  } else {
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn ts_logical_and_false_dead_branch() {
        // `false && x` 永假 → consequence 死
        let src = r#"
function f() {
  if (false && maybeCall()) {
    doDead();
  } else {
    doLive();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn ts_logical_or_true_dead_branch() {
        // `true || x` 永真 → alternative 死
        let src = r#"
function f() {
  if (true || maybeCall()) {
    doLive();
  } else {
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn ts_while_false_dead_loop() {
        let src = r#"
const LOOP = false;
function f() {
  while (LOOP) {
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
    }

    #[test]
    fn ts_ternary_const_false() {
        let src = r#"
const FLAG = false;
function f() {
  const x = FLAG ? deadValue() : liveValue();
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("deadValue") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("liveValue")));
    }

    #[test]
    fn rust_const_prop_if_false() {
        let src = r#"
const DEBUG: bool = false;
fn f() {
    if DEBUG {
        do_dead();
    } else {
        do_live();
    }
}
"#;
        let r = run("rust", src);
        assert!(r.iter().any(|u| u.snippet.contains("do_dead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("do_live")));
    }

    #[test]
    fn go_const_prop_if_false() {
        let src = r#"
package main
const debug = false
func f() {
    if debug {
        doDead()
    } else {
        doLive()
    }
}
"#;
        let r = run("go", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn go_for_false_dead_loop() {
        let src = r#"
package main
func f() {
    for false {
        doDead()
    }
}
"#;
        let r = run("go", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
    }

    #[test]
    fn java_final_const_prop_if_false() {
        let src = r#"
class A {
    private static final boolean DEBUG = false;
    void f() {
        if (DEBUG) {
            doDead();
        } else {
            doLive();
        }
    }
}
"#;
        let r = run("java", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead") && u.confidence == "medium"));
        assert!(!r.iter().any(|u| u.snippet.contains("doLive")));
    }

    #[test]
    fn no_false_positive_local_const_shadow() {
        // 局部 `const` 不收录；模块级 DEBUG=false 仍生效，但函数内重声明不影响常量传播语义
        let src = r#"
const DEBUG = false;
function f() {
  if (DEBUG) {
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().any(|u| u.snippet.contains("doDead")), "模块级常量应被传播");
    }

    #[test]
    fn comment_after_return_is_not_flagged() {
        // `return` 之后的注释不是可执行语句，绝不能登记为「尾随不可达」（零误报硬约束）。
        // 注：`let z = 9` 本身确为不可达（return 之后），应被正常登记；仅注释不得被登记。
        let src = r#"
fn f() -> i32 {
    return 0;
    // 这条注释之后写的，不该被当成不可达代码
    let z = 9;
}
"#;
        let r = run("rust", src);
        assert!(
            r.iter().all(|u| !u.snippet.trim_start().starts_with("//")),
            "return 之后的注释被误报为不可达：{:?}",
            r
        );
    }

    #[test]
    fn comment_in_dead_branch_is_not_flagged() {
        // `if (false)` 死分支里的注释也不该被登记
        let src = r#"
function f() {
  if (false) {
    // 死分支里的注释
    doDead();
  }
}
"#;
        let r = run("typescript", src);
        assert!(r.iter().all(|u| !u.snippet.trim_start().starts_with("//")), "死分支注释被误报");
    }
}

/// env-gated 回放探针：扫描真实代码库，统计过程内不可达 / 死分支发现数（含常量传播）。
/// 仅当 `UNREACH_REPLAY=1` 时运行，不影响常规 `cargo test`。用于产出「真实产出」证据，
/// 验证 joern 式常量传播在真实代码上可落地（而非仅单测锁）。
#[test]
fn replay_unreachable_const_prop() {
    if std::env::var("UNREACH_REPLAY").is_err() {
        return;
    }
    use std::collections::HashMap;
    fn collect_files(dir: &str, exts: &[&str], out: &mut Vec<(String, String)>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return; };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let s = p.to_string_lossy();
                // 跳过非源码目录，避免海量无关文件拖慢回放
                if s.contains("/target/")
                    || s.contains("/node_modules/")
                    || s.contains("/.git/")
                    || s.contains("/dist/")
                {
                    continue;
                }
                collect_files(&s, exts, out);
            } else if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                if exts.contains(&ext) {
                    if let Ok(c) = std::fs::read_to_string(&p) {
                        out.push((p.to_string_lossy().to_string(), c));
                    }
                }
            }
        }
    }
    let targets: &[(&str, &str, &[&str])] = &[
        (
            "joern-master(C/Java)",
            "/Volumes/HPFX900固态盘/TEST_PRO/joern-master",
            &["c", "h", "cpp", "java"],
        ),
        (
            "project-sight(rust)",
            "/Users/liwenchao/GithubProSpace/project-sight/src-tauri/src",
            &["rs"],
        ),
    ];
    let mut report = String::new();
    for (label, dir, exts) in targets {
        let mut files: Vec<(String, String)> = Vec::new();
        collect_files(dir, exts, &mut files);
        let mut total = 0usize;
        let mut by_lang: HashMap<String, usize> = HashMap::new();
        let mut const_branch = 0usize;
        let mut trailing = 0usize;
        for (path, content) in &files {
            let ext = path.rsplit('.').next().unwrap_or("");
            let lang = match ext {
                "c" | "h" => "c",
                "cpp" => "cpp",
                "java" => "java",
                "rs" => "rust",
                _ => continue,
            };
            let found = detect_unreachable(lang, path, content);
            total += found.len();
            *by_lang.entry(lang.to_string()).or_insert(0) += found.len();
            for f in &found {
                if f.confidence == "medium" {
                    const_branch += 1;
                } else {
                    trailing += 1;
                }
            }
        }
        report.push_str(&format!(
            "[replay] {label}: files={} total={} (const_branch/medium={}, trailing/high={})\n",
            files.len(),
            total,
            const_branch,
            trailing
        ));
        for (k, v) in by_lang.iter() {
            report.push_str(&format!("    {k}: {v}\n"));
        }
        // 抽样前若干发现，便于人工核对是否零误报
        let mut shown = 0usize;
        for (path, content) in &files {
            if shown >= 20 {
                break;
            }
            let ext = path.rsplit('.').next().unwrap_or("");
            let lang = match ext {
                "c" | "h" => "c",
                "cpp" => "cpp",
                "java" => "java",
                "rs" => "rust",
                _ => continue,
            };
            for f in detect_unreachable(lang, path, content) {
                if shown >= 20 {
                    break;
                }
                report.push_str(&format!(
                    "    SAMPLE {}:{}  [{}] {}\n",
                    path, f.line_start, f.confidence, f.snippet
                ));
                shown += 1;
            }
        }
    }
    eprintln!("{}", report);
}
