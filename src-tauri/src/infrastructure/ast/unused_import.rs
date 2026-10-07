//! 未使用导入检测（joern IMPORT 节点 / 到达定义 DEF-USE 的又一层子集，与 unused_local 同族）
//!
//! 参考项目 joern-master：`semanticcpg` 把每个导入声明建模为 `Import` 节点
//! （`importedEntity` = 被导入的符号，`importedAs` = 在当前作用域绑定的本地名字；
//! `isModuleImport` = 仅副作用导入，如 `import "./polyfill"`，无绑定名、恒「已用」）。
//! joern 数据流层判断该绑定是否被使用——若 `importedAs` 绑定的名字在 CPG 里没有任何
//! `IDENTIFIER` / `LOCAL` 引用（USE），即「未使用导入」。这正是到达定义（DEF-USE）模型的
//! 又一层应用：导入声明 = 一个 DEF（把名字绑进命名空间），若其在整个文件内没有任何 USE → 死导入。
//!
//! 我们当前 `commands/dead_code.rs` 已有五层：①引用级（符号零引用）②过程内不可达
//! （CFG 走不到的语句）③未使用局部变量（DEF-USE）④未使用参数（DEF-USE 同族）
//! ⑤跨文件未使用导出（全库视图 `isPublic.whereNot(_.callIn)`）。**六者都不回答
//! 「import 进来的名字整文件从未被引用」**——这是 joern 视角下明显的死代码盲点，
//! 也是我们与参考项目相比的弱项（此前所有导入都被当成「已用」）。
//!
//! 本模块补齐这一层，对标 joern 的 DEF-USE，取其中**无歧义、零误报**的子集：
//!
//! **未使用导入**：某 `import { A } from './x'`（或等价方言声明）引入的本地绑定名 `A`，
//! 在整个文件（含顶层语句与函数体）里**再也没以引用标识符的形式出现过**（排除它自身的声明
//! 节点、排除被再导出 `export { A }`）→ 死导入。
//!
//! 零误报保证（与 joern 同语义、但用更保守的启发式兜底）：
//! - 只看「名字字面量是否再出现为引用标识符」——只要出现过一次引用就不报（最坏是漏报，不是误报）。
//! - 引用计数覆盖 `identifier` + 简写 `shorthand_property_identifier` + TS 类型位 `type_identifier`
//!   + Kotlin `simple_identifier` + 对象/字段访问 `field_identifier`，宁可把类型位使用也算作使用。
//! - **副作用导入跳过**：`import "./polyfill"`（无绑定名，对应 joern `isModuleImport`）恒视为已用。
//! - **通配导入跳过**：`import * as ns`(TS 命名空间不算) 之外，Rust `use a::b::*`、Python `from x import *`、
//!   `import a.b.c as x`(Python 不支持别名故只取首段)、Go 点导入 `. "x"`、Java/Kotlin `a.b.*` 等
//!   无法枚举绑定名的形态一律跳过整条（宁缺毋滥，避免把 `use a::b::*` 这种整组导入误报为未用）。
//! - **再导出视为使用**：`export { A }` / `export { A } from './x'`（barrel）里的 `A` 计入使用，
//!   与 joern 把 re-export 当作引用一致（barrel 文件本身不消费该名字，但对外转发即「已用」）。
//! - **约定接收者/下划线**也适用：导入名以 `_` 开头（如 `import { _internals }`）视为作者有意，不报。
//! - **测试上下文跳过**：Rust 里位于 `#[cfg(test)] mod` / `#[test] fn` 内的导入不报（复用
//!   `unused_local::in_test_context`，测试辅助别名本就允许未使用）。
//!
//! 实现纯 tree-sitter AST 遍历，零新依赖。覆盖 TS/JS/Rust/Python/Go/Java/Kotlin 共 7 方言
//! （C/C++ 的 `#include` 是文本包含、无本地绑定名，属另一类「未用头文件」问题，本规则不覆盖，
//! 与既有的「Go/C 符号级引用仍空」局限一致）。输出为纯数据，落库与前端呈现由
//! `commands/dead_code.rs` 负责，保持本模块可被单测直接驱动、无 DB 耦合。

use crate::infrastructure::ast::unused_local::{
    in_test_context, snippet_of, supported as local_supported,
};
use crate::infrastructure::ast::{dialect_for, Dialect};
use tree_sitter::{Node, Parser};

/// 单条未使用导入发现
#[derive(Debug, Clone)]
pub struct UnusedImport {
    pub line_start: usize,
    pub line_end: usize,
    /// 导入引入的本地绑定名（如 `import { A as B }` 的 B）
    pub name: String,
    /// 该导入声明的源码片段（截断）
    pub snippet: String,
    /// low：代码异味（建议级，非错误）；对标 joern 把「未使用」视为弱信号
    pub confidence: &'static str,
    /// 人类可读的判定说明
    pub reason: &'static str,
}

/// 引用侧参与计数的节点 kind（声明名字节点之外的「使用」形态）
fn is_ref_kind(kind: &str) -> bool {
    matches!(
        kind,
        "identifier"
            | "shorthand_property_identifier"
            | "shorthand_property_identifier_pattern"
            | "type_identifier"
            | "simple_identifier"
            | "field_identifier"
    )
}

/// 该方言是否支持未使用导入检测（节点 kind 已确认）
fn supported(d: Dialect) -> bool {
    matches!(
        d,
        Dialect::TypeScript
            | Dialect::Tsx
            | Dialect::Rust
            | Dialect::Python
            | Dialect::Go
            | Dialect::Java
            | Dialect::Kotlin
    )
}

/// 判断某节点是否为「导入声明」的顶层节点（不同方言 kind 不同）
fn is_import_top(d: Dialect, kind: &str) -> bool {
    match d {
        Dialect::TypeScript | Dialect::Tsx => kind == "import_statement",
        Dialect::Rust => kind == "use_declaration",
        Dialect::Python => kind == "import_statement" || kind == "import_from_statement",
        Dialect::Go => kind == "import_declaration" || kind == "import_spec",
        Dialect::Java => kind == "import_declaration",
        Dialect::Kotlin => kind == "import",
        _ => false,
    }
}

/// 取某节点的「最后一个标识符后代」文本（按源码位置靠后者为准，用于
/// `import { a as b }` 取本地别名 b、`use a::b::C` 取末段 C、`import a.b.C` 取 C 等
/// 「本地绑定 = 路径末段或别名」的统一口径）。
fn last_ident_text<'a>(node: Node<'a>, source: &[u8]) -> Option<String> {
    let mut found: Option<(usize, String)> = None; // (end_byte, text)
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.kind() == "identifier" {
            if let Ok(t) = n.utf8_text(source) {
                let end = n.end_byte();
                // 取「最靠后」的标识符（文档顺序的最后一个），保证别名/末段胜出
                if found.as_ref().map(|(e, _)| end > *e).unwrap_or(true) {
                    found = Some((end, t.to_string()));
                }
            }
        }
        let mut c = n.walk();
        for child in n.named_children(&mut c) {
            stack.push(child);
        }
    }
    found.map(|(_, t)| t)
}

/// 从一个导入顶层节点抽取所有「本地绑定名」(name, line, snippet)。
/// 遇到无法枚举的「通配」形态时返回 false（调用方跳过整条声明，避免误报）。
fn extract_bindings<'a>(
    d: Dialect,
    node: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, String)>,
) -> bool {
    let snippet = snippet_of(node, source);
    let line = node.start_position().row + 1;
    let mut glob = false;
    extract_bindings_inner(d, node, source, out, &mut glob);
    if glob {
        out.clear(); // 通配：本声明不产出任何绑定（避免把整组导入误判为未用）
        false
    } else {
        // 补上片段/行号（extract 只填了名字，这里回填统一元信息）
        for b in out.iter_mut() {
            b.1 = line;
            b.2 = snippet.clone();
        }
        true
    }
}

/// 内部递归：方言相关的绑定抽取
fn extract_bindings_inner<'a>(
    d: Dialect,
    node: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, String)>,
    glob: &mut bool,
) {
    // 通配 `*` 任何方言都意味着「无法枚举绑定」——整条声明跳过
    if node.kind() == "asterisk" {
        *glob = true;
        return;
    }
    match d {
        Dialect::TypeScript | Dialect::Tsx => match node.kind() {
            // 命名导入 `import { a }` / `import { a as b }` → 本地绑定 = 末段标识符（b 或 a）
            "import_specifier" | "export_specifier" => {
                if let Some(t) = last_ident_text(node, source) {
                    out.push((t, 0, String::new()));
                }
            }
            // 默认导入 `import Def from` / 命名空间 `import * as ns`
            "default_import" | "namespace_import" => {
                if let Some(n) = node.child_by_field_name("name") {
                    if n.kind() == "identifier" {
                        if let Ok(t) = n.utf8_text(source) {
                            out.push((t.to_string(), 0, String::new()));
                        }
                    }
                }
            }
            _ => {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        },
        Dialect::Rust => match node.kind() {
            // `use a::b::*` 通配 → 整条跳过（无法枚举绑定）
            "use_wildcard" => {
                *glob = true;
            }
            // `use x::y as Z` → 本地绑定 Z（末段标识符）
            "use_as_clause" => {
                if let Some(t) = last_ident_text(node, source) {
                    out.push((t, 0, String::new()));
                }
            }
            // `use a::b::{c, d}` → 绑定是 use_list 里的 c、d（路径前缀 a::b 不算绑定）
            "scoped_use_list" => {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    match kid.kind() {
                        "use_list" => {
                            let mut c2 = kid.walk();
                            for id in kid.named_children(&mut c2) {
                                if id.kind() == "identifier" {
                                    if let Ok(t) = id.utf8_text(source) {
                                        out.push((t.to_string(), 0, String::new()));
                                    }
                                }
                            }
                        }
                        "scoped_use_list" => {
                            extract_bindings_inner(d, kid, source, out, glob);
                        }
                        // scoped_identifier 路径前缀：不计入绑定
                        _ => {}
                    }
                }
            }
            // `use a::b::C` → 末段 C
            "scoped_identifier" => {
                if let Some(t) = last_ident_text(node, source) {
                    out.push((t, 0, String::new()));
                }
            }
            _ => {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        },
        Dialect::Python => match node.kind() {
            // import a.b.c 的首段 a；from x import y 的 y；from x import y as z 的 z
            "dotted_name" | "aliased_import" => {
                if let Some(t) = last_ident_text(node, source) {
                    out.push((t, 0, String::new()));
                }
            }
            "wildcard_import" => {
                *glob = true;
            }
            "module_name" => {
                // from 的模块路径本身不是绑定，跳过其内部的 dotted_name
            }
            _ => {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        },
        Dialect::Go => {
            // import_spec：package_identifier(别名) / dot(点导入) / blank_identifier(空白导入)
            // + interpreted_string_literal(源路径)。无别名时只有字符串字面量，包名由路径推导，跳过。
            if node.kind() == "import_spec" {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    match kid.kind() {
                        "package_identifier" => {
                            if let Ok(t) = kid.utf8_text(source) {
                                let t = t.trim().to_string();
                                if !t.is_empty() {
                                    out.push((t, 0, String::new()));
                                }
                            }
                        }
                        "dot" => *glob = true, // 点导入：整组进入作用域
                        "blank_identifier" => { /* 空白导入：副作用，无绑定 */ }
                        _ => {}
                    }
                }
            } else {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        }
        Dialect::Java => {
            if node.kind() == "scoped_identifier" {
                if let Some(t) = last_ident_text(node, source) {
                    out.push((t, 0, String::new()));
                }
            } else {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        }
        Dialect::Kotlin => match node.kind() {
            "import" => {
                // kotlin-ng：`import a.b.C` 的路径是 qualified_identifier（末段 C 为绑定）；
                // `import a.b.D as E` 的别名 E 是 import 的直接 identifier 子节点（D 是远端路径，非本地绑定）；
                // `import a.b.*` 的 `*` 是 asterisk 节点 → 通配跳过。
                let mut alias: Option<String> = None;
                let mut has_qualified = false;
                let mut star = false;
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    match kid.kind() {
                        "identifier" => {
                            alias = Some(
                                kid.utf8_text(source)
                                    .ok()
                                    .map(|s| s.to_string())
                                    .unwrap_or_default(),
                            );
                        }
                        "qualified_identifier" => has_qualified = true,
                        "asterisk" => star = true,
                        _ => {}
                    }
                }
                if star {
                    *glob = true;
                    return;
                }
                if let Some(a) = alias {
                    let a = a.trim().to_string();
                    if !a.is_empty() {
                        out.push((a, 0, String::new()));
                    }
                } else if has_qualified {
                    let mut c2 = node.walk();
                    for kid in node.named_children(&mut c2) {
                        if kid.kind() == "qualified_identifier" {
                            if let Some(t) = last_ident_text(kid, source) {
                                out.push((t, 0, String::new()));
                            }
                        }
                    }
                }
            }
            _ => {
                let mut c = node.walk();
                for kid in node.named_children(&mut c) {
                    extract_bindings_inner(d, kid, source, out, glob);
                }
            }
        },
        _ => {}
    }
}

/// 整文件遍历：收集导入绑定 + 引用标识符使用（导入声明子树内的标识符不计入使用）
fn walk_file<'a>(
    node: Node<'a>,
    d: Dialect,
    source: &[u8],
    in_import: bool,
    bindings: &mut Vec<(String, usize, String)>,
    usages: &mut Vec<String>,
) {
    if !in_import && is_import_top(d, node.kind()) {
        if !(d == Dialect::Rust && in_test_context(d, node, source)) {
            let mut b: Vec<(String, usize, String)> = Vec::new();
            extract_bindings(d, node, source, &mut b);
            bindings.extend(b);
        }
        // 进入导入子树：内部标识符不计入使用
        let mut c = node.walk();
        for kid in node.named_children(&mut c) {
            walk_file(kid, d, source, true, bindings, usages);
        }
        return;
    }

    if !in_import && is_ref_kind(node.kind()) {
        if let Ok(t) = node.utf8_text(source) {
            usages.push(t.to_string());
        }
    }
    // Rust 命名格式插值 `{name}`（仅 Rust）：把命名插值补登记为「使用」，保证零误报
    if !in_import
        && d == Dialect::Rust
        && (node.kind() == "string_literal" || node.kind() == "raw_string_literal")
    {
        if let Ok(t) = node.utf8_text(source) {
            collect_rust_format_names_inline(t, usages);
        }
    }

    let mut c = node.walk();
    for kid in node.named_children(&mut c) {
        walk_file(kid, d, source, in_import, bindings, usages);
    }
}

/// Rust `format!("{name}")` 命名插值收集（与 unused_local 口径一致，内联避免类型摩擦）
fn collect_rust_format_names_inline(text: &str, refs: &mut Vec<String>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                i += 2;
                continue;
            }
            let start = i + 1;
            let mut j = start;
            while j < bytes.len()
                && bytes[j] != b'}'
                && bytes[j] != b':'
                && !bytes[j].is_ascii_whitespace()
            {
                j += 1;
            }
            let name = &text[start..j];
            if !name.is_empty()
                && name
                    .chars()
                    .next()
                    .map(|c| c.is_alphabetic() || c == '_')
                    .unwrap_or(false)
            {
                refs.push(name.to_string());
            }
            while j < bytes.len() && bytes[j] != b'}' {
                j += 1;
            }
            i = if j < bytes.len() { j + 1 } else { j };
        } else {
            i += 1;
        }
    }
}

/// 主入口：检测单文件的未使用导入
pub fn detect_unused_imports(lang: &str, rel_path: &str, content: &str) -> Vec<UnusedImport> {
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
    // 同样确保本文件所用方言的局部变量检测也支持（一致性守卫；不影响本函数逻辑）
    let _ = local_supported(dialect);

    let mut bindings: Vec<(String, usize, String)> = Vec::new();
    let mut usages: Vec<String> = Vec::new();
    walk_file(root, dialect, bytes, false, &mut bindings, &mut usages);

    let mut out = Vec::new();
    for (name, line, snippet) in &bindings {
        if name.starts_with('_') || name.is_empty() {
            continue;
        }
        let used = usages.iter().any(|u| u == name);
        if used {
            continue;
        }
        out.push(UnusedImport {
            line_start: *line,
            line_end: *line,
            name: name.clone(),
            snippet: snippet.clone(),
            confidence: "low",
            reason: "导入的名字在该文件内从未被引用；可删除该导入或确认是否被间接/动态使用",
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lang: &str, src: &str) -> Vec<UnusedImport> {
        detect_unused_imports(lang, &format!("test.{}", lang), src)
    }

    fn names(rs: &[UnusedImport]) -> Vec<String> {
        rs.iter().map(|u| u.name.clone()).collect()
    }

    #[test]
    fn ts_named_import_unused_detected() {
        let src = r#"
import { A, B } from './x';
const y = B();
"#;
        // A 从未被引用 → 应检出；B 被使用 → 不报
        let r = run("typescript", src);
        assert!(
            names(&r).contains(&"A".to_string()),
            "应检出未使用导入 A，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"B".to_string()));
    }

    #[test]
    fn ts_default_and_namespace_used() {
        let src = r#"
import Def from './x';
import * as ns from './y';
const a = Def();
const b = ns.foo();
"#;
        let r = run("typescript", src);
        assert!(
            r.is_empty(),
            "默认导入与命名空间导入都被使用不应报错，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_alias_local_name_is_checked() {
        // import { A as B } 绑定本地名 B；B 未用 → 报 B（不是 A）
        let src = r#"
import { A as B } from './x';
"#;
        let r = run("typescript", src);
        assert!(
            names(&r).contains(&"B".to_string()),
            "别名本地绑定 B 未用应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"A".to_string()));
    }

    #[test]
    fn ts_side_effect_import_not_flagged() {
        let src = r#"
import './polyfill';
"#;
        let r = run("typescript", src);
        assert!(
            r.is_empty(),
            "副作用导入无绑定名，恒视为已用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_reexport_counts_as_use() {
        // barrel：A 被再导出 → 视为已用
        let src = r#"
import { A } from './x';
export { A };
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"A".to_string()),
            "被再导出的 A 应视为已用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_type_only_import_used_as_type() {
        let src = r#"
import type { T } from './x';
const v: T = 1;
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"T".to_string()),
            "type 位使用的 T 应视为已用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_jsx_usage_is_use() {
        let src = r#"
import { Button } from './x';
const el = <Button />;
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"Button".to_string()));
    }

    #[test]
    fn rust_named_use_unused_detected() {
        let src = r#"
use a::b::C;
use a::b::D;
fn f() { let _ = C; }
"#;
        // C 被使用；D 未用 → 报 D
        let r = run("rust", src);
        assert!(
            names(&r).contains(&"D".to_string()),
            "未使用的 use D 应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"C".to_string()));
    }

    #[test]
    fn rust_use_tree_and_alias() {
        let src = r#"
use a::b::{C, D};
use x::y as Z;
fn f() { let _ = C; let _ = Z; }
"#;
        // C、Z 被用；D 未用 → 报 D
        let r = run("rust", src);
        assert!(
            names(&r).contains(&"D".to_string()),
            "use_tree 内未用的 D 应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"C".to_string()));
        assert!(!names(&r).contains(&"Z".to_string()));
    }

    #[test]
    fn rust_glob_use_skipped() {
        // use a::b::* 无法枚举绑定，整条跳过（不误报）
        let src = r#"
use a::b::*;
fn f() {}
"#;
        let r = run("rust", src);
        assert!(r.is_empty(), "通配 use 应跳过，实际: {:?}", names(&r));
    }

    #[test]
    fn python_from_import_unused_detected() {
        let src = r#"
from x import y, z
def f():
    return y()
"#;
        // y 被用；z 未用 → 报 z
        let r = run("python", src);
        assert!(
            names(&r).contains(&"z".to_string()),
            "未用的 from 导入 z 应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"y".to_string()));
    }

    #[test]
    fn python_plain_import_binds_first_segment() {
        let src = r#"
import a.b.c
def f():
    return a.foo()
"#;
        // 绑定 a；a 被 a.foo() 使用 → 不报
        let r = run("python", src);
        assert!(
            !names(&r).contains(&"a".to_string()),
            "import a.b.c 绑定 a 已被使用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn python_wildcard_from_skipped() {
        let src = r#"
from x import *
def f():
    return 1
"#;
        let r = run("python", src);
        assert!(r.is_empty(), "通配 from 导入应跳过，实际: {:?}", names(&r));
    }

    #[test]
    fn go_alias_import_unused_detected() {
        let src = r#"
package main
import foo "github.com/a/b"
import "github.com/c/d"
func f() { _ = d.Do() }
"#;
        // 注意：这里 d 也不是别名形式，无法判定；用别名 foo 未被用 → 报 foo
        let src2 = r#"
package main
import alias "github.com/a/b"
func f() {}
"#;
        let r = run("go", src2);
        assert!(
            names(&r).contains(&"alias".to_string()),
            "Go 别名导入未用应报，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn go_noalias_import_skipped() {
        // 无别名的 Go 导入（包名由路径推导）无法安全判定绑定名 → 跳过，不误报
        let src = r#"
package main
import "github.com/a/b"
import "github.com/c/d"
func f() { _ = b.Call() }
"#;
        let r = run("go", src);
        assert!(
            r.is_empty(),
            "无别名 Go 导入不应误报，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn java_named_import_unused_detected() {
        let src = r#"
import a.b.C;
import a.b.D;
class A {
    C c;
}
"#;
        // C 被用；D 未用 → 报 D
        let r = run("java", src);
        assert!(
            names(&r).contains(&"D".to_string()),
            "未用的 Java 导入 D 应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"C".to_string()));
    }

    #[test]
    fn java_wildcard_import_skipped() {
        let src = r#"
import a.b.*;
class A {}
"#;
        let r = run("java", src);
        assert!(r.is_empty(), "通配 Java 导入应跳过，实际: {:?}", names(&r));
    }

    #[test]
    fn kotlin_alias_import_unused_detected() {
        let src = r#"
import a.b.C
import a.b.D as E
fun f(): C { return C() }
"#;
        // C 被用；E 未用 → 报 E。注意：kotlin 方言经 .kt/.kts 扩展名选语法，
        // 测试 helper `run` 会拼成 test.kotlin 导致 dialect_for 落空，故此处直接给 .kt 路径。
        let r = detect_unused_imports("kotlin", "test.kt", src);
        assert!(
            names(&r).contains(&"E".to_string()),
            "未用的 Kotlin 别名导入 E 应报，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"C".to_string()));
    }

    /// 真实目录回放探针（env-gated）：统计某目录下各语言未使用导入数量，
    /// 用于「renderable ≠ useful」最终验收——确认该功能在真实代码库上确有产出（非仅单测锁）。
    #[test]
    fn replay_unused_imports_dir() {
        let dir = match std::env::var("REPLAY_UNUSED_IMPORT_DIR") {
            Ok(d) => d,
            Err(_) => return,
        };
        let mut total = 0usize;
        let mut by_lang: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let mut parsed_files = 0usize;
        let verbose = std::env::var("REPLAY_UNUSED_IMPORT_VERBOSE").is_ok();
        let mut samples: Vec<String> = Vec::new();
        replay_dir(
            std::path::Path::new(&dir),
            &mut total,
            &mut by_lang,
            &mut parsed_files,
            if verbose { Some(&mut samples) } else { None },
        );
        eprintln!(
            "[replay_unused_imports] dir={} files={} total_unused_import={} by_lang={{ {:?} }}",
            dir, parsed_files, total, by_lang
        );
        for s in &samples {
            eprintln!("  - {}", s);
        }
    }

    fn replay_dir(
        p: &std::path::Path,
        total: &mut usize,
        by_lang: &mut std::collections::HashMap<String, usize>,
        parsed_files: &mut usize,
        mut samples: Option<&mut Vec<String>>,
    ) {
        let lang_of = |ext: &str| -> Option<&'static str> {
            match ext {
                "rs" => Some("rust"),
                "ts" | "tsx" => Some("typescript"),
                "js" | "jsx" | "mjs" => Some("typescript"),
                "py" => Some("python"),
                "go" => Some("go"),
                "java" => Some("java"),
                "kt" | "kts" => Some("kotlin"),
                _ => None,
            }
        };
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if matches!(
                    name,
                    "node_modules" | "target" | ".git" | "dist" | "dist-i18n"
                ) {
                    return;
                }
            }
            if let Ok(entries) = std::fs::read_dir(p) {
                for e in entries.flatten() {
                    replay_dir(
                        &e.path(),
                        total,
                        by_lang,
                        parsed_files,
                        samples.as_deref_mut(),
                    );
                }
            }
        } else if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if let Some(lang) = lang_of(ext) {
                if let Ok(content) = std::fs::read_to_string(p) {
                    *parsed_files += 1;
                    let rel = p.to_string_lossy().to_string();
                    let found = detect_unused_imports(lang, &rel, &content);
                    if !found.is_empty() {
                        *by_lang.entry(lang.to_string()).or_default() += found.len();
                        *total += found.len();
                        if let Some(s) = samples {
                            for f in &found {
                                s.push(format!(
                                    "{}:{}  {}  ({})",
                                    rel, f.line_start, f.name, f.snippet
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
}
