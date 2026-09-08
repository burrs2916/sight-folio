//! 非 TS/JS 语言的**符号级** import 抽取（tree-sitter AST），对标 joern 各 frontend 的
//! `IMPORT` 节点语义（`importedEntity` / `importedAs` / `isWildcard`）。
//!
//! 与同目录 `imports_ast.rs`（依赖级：只要模块路径）的分工：
//!   - `imports_ast`     → 供 `parse_deps`，产出 `DepImport{path,line}`，喂**文件级依赖图**；
//!   - 本模块           → 供 `parse_imports_with_symbols`，产出 `ParsedImport{path,line,symbols}`，
//!                        喂 `project_symbol_refs`（「A 文件第 N 行引用了 B 文件的哪个符号」）。
//!
//! ── 弱项（改造前的实测事实，不是推断）────────────────────────────────────────────
//! 本仓一次真实扫描（analysis `scene_1786512248226_i4gsow`，146 个 `.rs` + 145 个 `.ts/.tsx`）：
//! `project_symbol_refs` 里 **`.rs` 来源 0 条**、`.ts/.tsx` 357 条。即：非 TS/JS 的符号级
//! 引用是**死功能**——表、命令、前端 UI 全在，数据恒空。两处根因：
//!   1. 抽取层：`code_structure::parse_rs_imports` 把 `use a::b::C` 的 `path` 取成**最后一段**
//!      （`rsplit("::").next()`）→ `C`；`use x::*` 整条丢弃；`pub use ...` 因 `strip_prefix("use ")`
//!      失配而**完全消失**；嵌套 `use a::{b::C, d::{E, F}}` 不展开；多行 use 列表丢失；
//!      注释里的 use 变幻影引用。
//!   2. 解析层：消费点 `analyze_symbol_references` 只按 TS 语义做「相对路径 + 扩展名候选 +
//!      `path_to_id` 精确匹配」，Rust `code_structure` / Python `a.b.c` / Java `com.foo.Bar`
//!      这些**模块记号**永远匹配不到 `src/commands/code_structure.rs` 这样的真实相对路径。
//!      （本模块只修 ①；② 由 `code_structure::resolve_module_ref` 修，两者缺一功能仍是死的。）
//!
//! ── joern 取证（参考项目 /Volumes/HPFX900固态盘/TEST_PRO/joern-master）───────────────
//!   - `rust2cpg/src/test/scala/io/joern/rust2cpg/passes/ast/UseTests.scala` —— Rust use tree
//!     的规格表：`use std::io::*` → entity=`std::io` + isWildcard（**不丢弃**）；
//!     `use a::{b::C, d::{E as F, self}}` → **三条** import（`a::b::C` / `a::d::E`(as F) / `a::d`）；
//!     `use std::io::self` → entity=`std::io`；`use m::{self as alias}` → entity=`m`。
//!   - `javasrc2cpg/astcreation/AstCreator.scala:172` —— 静态导入照样建 import 节点。
//!   - `kotlin2cpg/ast/AstForPrimitivesCreator.scala:224` —— 别名走 `importedAs`，实体路径干净。
//!   - `x2cpg/frontendspecific/pysrc2cpg/PythonImportResolverPass.scala:48` ——
//!     `fileToPythonImportNotation`：文件路径 ↔ import 记号双向转换（消费点解析的范式来源）。
//!
//! ── 语义约定（`path` 的用途是「解析到项目文件」，故与 joern `importedEntity` 有意的差异）──
//!   Rust  : `use a::b::C`        → path=`a::b`      symbols=[C]     （模块 + 符号分离）
//!           `use a::b::C as D`   → path=`a::b`      symbols=[C]     （取原名，与 TS `{A as B}` 一致）
//!           `use a::b::*`        → path=`a::b`      symbols=[]      （通配 → 文件级引用）
//!           `use a::b::self`     → path=`a::b`      symbols=[]
//!   Python: `from a.b import C`  → path=`a.b`       symbols=[C]
//!           `from .foo import C` → path=`.foo`      symbols=[C]     （点前缀保留，消费点解析相对包）
//!           `import a.b`         → path=`a.b`       symbols=[]
//!   Java  : `import a.b.C`       → path=`a.b.C`     symbols=[C]     （类路径 = 文件路径约定）
//!           `import static a.b.C.m` → path=`a.b.C`  symbols=[m]     （旧实现整条丢弃）
//!           `import a.b.*`       → path=`a.b`       symbols=[]
//!   Kotlin: `import a.b.C as D`  → path=`a.b.C`     symbols=[C]     （旧实现产出脏值 `C as D`）
//!
//! ── 零回归约定（与 WP5 / `imports_ast` 同一套）────────────────────────────────────
//!   - 返回 `None`（grammar 解析失败）→ 调用方回退旧逐行实现；
//!   - `has_error`（局部语法错）→ 与旧逐行结果按 (path,line) 并集去重，只增不减。

use std::collections::HashSet;

use tree_sitter::{Node, Parser};

use crate::infrastructure::ast::Dialect;
use crate::parser::ParsedImport;

fn text_of(node: Node, src: &[u8]) -> String {
    node.utf8_text(src).unwrap_or("").to_string()
}

fn line_of(node: Node) -> usize {
    node.start_position().row + 1
}

/// AST 级抽取符号级 import。
///
/// `None` = grammar 不支持 / 解析失败（调用方回退逐行）；
/// `Some((imports, has_error))`，`has_error=true` 表示语法有错，调用方应与逐行并集。
pub fn extract_symbol_imports_ast(d: Dialect, content: &str) -> Option<(Vec<ParsedImport>, bool)> {
    if !matches!(
        d,
        Dialect::Rust | Dialect::Python | Dialect::Java | Dialect::Kotlin
    ) {
        return None;
    }
    let mut parser = Parser::new();
    if parser.set_language(&d.language()).is_err() {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let mut out: Vec<ParsedImport> = Vec::new();
    walk(tree.root_node(), src, &mut out, d);
    Some((out, tree.root_node().has_error()))
}

/// Go 符号级导入抽取（tree-sitter-go）。
///
/// # 为什么不能照搬「模块 + 符号分离」的通用约定
/// Go 的 `import` **不点名符号**——导入的是整个包，符号经 `pkg.Ident` 限定使用。
/// 若产出 `symbols=[]`，落库行的 `to_symbol_id` 恒为 NULL；而死代码判定
/// （`list_unused_exports` / `rule_dead_symbol`）、前端引用计数、画布引用边
/// **全部只认 `to_symbol_id`**——等于没修。
///
/// 故改为**用量驱动**：扫全文件的 `selector_expression`，凡 `operand` 是某个导入包名者，
/// 其 `field` 即该文件真实用到的符号。
///   - 零幻影：只登记源码里字面出现过的 `pkg.X`，绝不臆测包内有什么；
///   - 零漂移：别名 / 点导入 / 空白导入按 Go 语义分别处理。
///
/// # 对标 joern
/// `gosrc2cpg` ImportTests：`import "math/rand"` 的 `importedEntity` 是完整路径
/// `"math/rand"`，`importedAs` 取**末段** `"rand"` 作为包名——末段即默认包名，与此处一致。
pub fn extract_go_symbol_imports(content: &str) -> Option<(Vec<ParsedImport>, bool)> {
    let mut parser = Parser::new();
    if parser.set_language(&tree_sitter_go::LANGUAGE.into()).is_err() {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let root = tree.root_node();

    // ── 第一遍：收集导入声明 → (包名, 导入路径, 行号) ──────────────────────────
    let mut specs: Vec<(String, String, usize)> = Vec::new();
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        if n.kind() == "import_spec" {
            let path = n
                .child_by_field_name("path")
                .map(|p| text_of(p, src).trim_matches('"').to_string())
                .unwrap_or_default();
            if !path.is_empty() {
                // 别名：identifier 用其名；`.` 点导入与 `_` 空白导入无法按名归属符号，跳过
                let alias = n.child_by_field_name("name").and_then(|a| match a.kind() {
                    "dot" | "blank_identifier" => None,
                    _ => Some(text_of(a, src)),
                });
                let pkg = alias.unwrap_or_else(|| {
                    path.rsplit('/').next().unwrap_or(path.as_str()).to_string()
                });
                specs.push((pkg, path, line_of(n)));
            }
            continue;
        }
        let mut cur = n.walk();
        // 逆序入栈 → 出栈即文档序（否则同一 import 块内的多条会**倒序**产出，
        // UI 的 ref_line 排序与预期相反，且让同一输入的两次结果看起来不稳定）
        for c in n.children(&mut cur).collect::<Vec<_>>().into_iter().rev() {
            stack.push(c);
        }
    }
    if specs.is_empty() {
        return Some((Vec::new(), root.has_error()));
    }

    // ── 第二遍：按包名归集实际用到的符号（`pkg.Ident`）─────────────────────────
    let mut used: Vec<HashSet<String>> = vec![HashSet::new(); specs.len()];
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        // 两种限定引用形态（均经 AST dump 实测，非推断）：
        //   selector_expression: `identifier`      + `field_identifier`（值/调用位置，store.NewClient）
        //   qualified_type:      `package_identifier` + `type_identifier`（**类型位置**，
        //                        如 `var c store.Client`）——漏了它类型引用会整片消失。
        // 初版按 `field.kind() == "identifier"` 过滤 → 全部命中都被跳过，符号恒为空。
        if matches!(n.kind(), "selector_expression" | "qualified_type") {
            let kids: Vec<Node> = {
                let mut cur = n.walk();
                n.named_children(&mut cur).collect()
            };
            if kids.len() >= 2 {
                let (op, f) = (kids[0], kids[kids.len() - 1]);
                if (op.kind() == "identifier" || op.kind() == "package_identifier")
                    && (f.kind() == "field_identifier"
                        || f.kind() == "type_identifier"
                        || f.kind() == "identifier")
                {
                    let op_text = text_of(op, src);
                    let f_text = text_of(f, src);
                    for (i, (pkg, _, _)) in specs.iter().enumerate() {
                        if pkg == &op_text {
                            used[i].insert(f_text.clone());
                        }
                    }
                }
            }
        }
        let mut cur = n.walk();
        // 逆序入栈 → 出栈即文档序（否则同一 import 块内的多条会**倒序**产出，
        // UI 的 ref_line 排序与预期相反，且让同一输入的两次结果看起来不稳定）
        for c in n.children(&mut cur).collect::<Vec<_>>().into_iter().rev() {
            stack.push(c);
        }
    }

    let mut out: Vec<ParsedImport> = Vec::new();
    for (i, (_pkg, path, line)) in specs.into_iter().enumerate() {
        let mut symbols: Vec<String> = used[i].iter().cloned().collect();
        symbols.sort(); // 确定性：Hashset 迭代序不稳定，会让同一文件两次扫描产出不同结果
        out.push(ParsedImport { path, line, symbols });
    }
    Some((out, root.has_error()))
}

/// C / C++ 符号级导入抽取（tree-sitter-c / cpp）。
///
/// # 语义：为什么是文件级（`symbols` 为空）
/// `#include "foo.h"` 是**文本包含**——把整个头文件的作用域搬进来，不像 Go/Python 那样
/// 点名符号。此处若臆造符号列表，只会产出 `to_symbol_id` 为 NULL 的噪声行。
/// 故按 C 的真实语义产出文件级引用（解析层仍会给出准确的 `to_file_id`）。
///
/// # 对标 joern
/// `c2cpg/AstCreatorHelper.scala:184-192`：每个 include 建 IMPORT + DEPENDENCY 节点，
/// 解析不到也**不静默丢弃**，与此处「只跳过系统头、本地头必出一行」一致。
pub fn extract_c_symbol_imports(d: Dialect, content: &str) -> Option<(Vec<ParsedImport>, bool)> {
    if !matches!(d, Dialect::C | Dialect::Cpp) {
        return None;
    }
    let lang: tree_sitter::Language = match d {
        Dialect::C => tree_sitter_c::LANGUAGE.into(),
        _ => tree_sitter_cpp::LANGUAGE.into(),
    };
    let mut parser = Parser::new();
    if parser.set_language(&lang).is_err() {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let mut out: Vec<ParsedImport> = Vec::new();
    let mut stack = vec![tree.root_node()];
    while let Some(n) = stack.pop() {
        if n.kind() == "preproc_include" {
            // `#include "x.h"` 本地头；`#include <x.h>` 系统头不是项目内依赖，跳过
            let local = n
                .child_by_field_name("path")
                .map(|p| text_of(p, src))
                .map(|t| t.trim_start().starts_with('"'))
                .unwrap_or(false);
            if local {
                if let Some(p) = n.child_by_field_name("path") {
                    let path = text_of(p, src)
                        .trim()
                        .trim_matches('"')
                        .trim_matches('<')
                        .trim_matches('>')
                        .to_string();
                    if !path.is_empty() {
                        push_import(&mut out, path, line_of(n), Vec::new());
                    }
                }
            }
            continue;
        }
        let mut cur = n.walk();
        // 逆序入栈 → 出栈即文档序（否则同一 import 块内的多条会**倒序**产出，
        // UI 的 ref_line 排序与预期相反，且让同一输入的两次结果看起来不稳定）
        for c in n.children(&mut cur).collect::<Vec<_>>().into_iter().rev() {
            stack.push(c);
        }
    }
    Some((out, tree.root_node().has_error()))
}

/// 优先 AST；解析失败回退 `line_based`；`has_error` 时与 `line_based` 并集去重（只增不减）。
pub fn extract_symbol_imports_with_fallback(
    d: Dialect,
    content: &str,
    line_based: Vec<ParsedImport>,
) -> Vec<ParsedImport> {
    let Some((ast, has_error)) = extract_symbol_imports_ast(d, content) else {
        return line_based;
    };
    if !has_error {
        return ast;
    }
    let mut out = ast;
    let seen: HashSet<(String, usize)> = out.iter().map(|x| (x.path.clone(), x.line)).collect();
    for x in line_based {
        if !seen.contains(&(x.path.clone(), x.line)) {
            out.push(x);
        }
    }
    out
}

fn push_import(out: &mut Vec<ParsedImport>, path: String, line: usize, symbols: Vec<String>) {
    if path.is_empty() {
        return;
    }
    // 同一行同一模块合并符号（Python `from a import b, c` 走单条记录，与旧逐行一致）
    if let Some(existing) = out.iter_mut().find(|x| x.line == line && x.path == path) {
        for s in symbols {
            if !existing.symbols.contains(&s) {
                existing.symbols.push(s);
            }
        }
        return;
    }
    out.push(ParsedImport { path, line, symbols });
}

fn walk(node: Node, src: &[u8], out: &mut Vec<ParsedImport>, d: Dialect) {
    match d {
        Dialect::Rust => {
            if node.kind() == "use_declaration" {
                // `pub use` / `pub(crate) use` 同样是 use_declaration（多一个 visibility_modifier），
                // 旧逐行 `strip_prefix("use ")` 对它直接失配 → 再导出引用全丢。
                if let Some(arg) = node.child_by_field_name("argument") {
                    let mut leaves: Vec<RustLeaf> = Vec::new();
                    walk_rust_use_tree(arg, src, &[], &mut leaves);
                    for leaf in leaves {
                        push_import(out, leaf.module, line_of(node), leaf.symbols);
                    }
                }
                return; // 已完整展开，无需再下钻（避免嵌套 use_list 重复计数）
            }
        }
        Dialect::Python => match node.kind() {
            // `from a.b import C, D` / `from . import x` / `from x import *`
            "import_from_statement" => {
                let Some(m) = node.child_by_field_name("module_name") else {
                    return;
                };
                let module = python_module_text(m, src);
                let mut symbols: Vec<String> = Vec::new();
                let mut cur = node.walk();
                for child in node.children_by_field_name("name", &mut cur) {
                    if let Some(n) = python_imported_name(child, src) {
                        symbols.push(n);
                    }
                }
                push_import(out, module, line_of(node), symbols);
                return;
            }
            // `import a.b` / `import a.b as ab` / `import a, b`（模块级，无符号）
            "import_statement" => {
                let mut cur = node.walk();
                for child in node.children_by_field_name("name", &mut cur) {
                    let module = match child.kind() {
                        "aliased_import" => child
                            .child_by_field_name("name")
                            .map(|n| text_of(n, src))
                            .unwrap_or_default(),
                        _ => text_of(child, src),
                    };
                    push_import(out, module, line_of(node), Vec::new());
                }
                return;
            }
            _ => {}
        },
        Dialect::Java => {
            if node.kind() == "import_declaration" {
                let mut wildcard = false;
                let mut is_static = false;
                let mut entity = String::new();
                let mut cur = node.walk();
                for child in node.children(&mut cur) {
                    match child.kind() {
                        "static" => is_static = true,
                        "asterisk" => wildcard = true,
                        k if child.is_named() && (k == "scoped_identifier" || k == "identifier") => {
                            if entity.is_empty() {
                                entity = text_of(child, src);
                            }
                        }
                        _ => {}
                    }
                }
                if entity.is_empty() {
                    return;
                }
                let (path, symbols) = if wildcard {
                    // `import a.b.*` / `import static a.b.C.*` → 模块（或类）级，无点名符号
                    (entity, Vec::new())
                } else if is_static {
                    // `import static a.b.C.m` → 类路径 + 成员名（joern：静态导入照样是 import 节点）
                    match entity.rsplit_once('.') {
                        Some((cls, member)) => (cls.to_string(), vec![member.to_string()]),
                        None => (entity, Vec::new()),
                    }
                } else {
                    // `import a.b.C` → 类路径本身即目标（类名 = 文件名约定），符号 = 类名
                    let cls = entity.rsplit('.').next().unwrap_or("").to_string();
                    let symbols = if cls.is_empty() { Vec::new() } else { vec![cls] };
                    (entity, symbols)
                };
                push_import(out, path, line_of(node), symbols);
                return;
            }
        }
        Dialect::Kotlin => {
            // 命名节点 kind 就叫 `import`（与同名匿名关键字节点靠 is_named 区分，已实测）
            if node.kind() == "import" && node.is_named() {
                let mut path = String::new();
                let mut wildcard = false;
                let mut cur = node.walk();
                for child in node.children(&mut cur) {
                    match child.kind() {
                        "qualified_identifier" | "identifier" if path.is_empty() && child.is_named() => {
                            path = text_of(child, src);
                        }
                        "*" => wildcard = true,
                        _ => {}
                    }
                }
                if path.is_empty() {
                    return;
                }
                let symbols = if wildcard {
                    Vec::new()
                } else {
                    // 别名 `as Baz` 走独立 identifier 节点，不进 path → 符号取实体原名（joern importedEntity）
                    let last = path.rsplit('.').next().unwrap_or("").to_string();
                    if last.is_empty() { Vec::new() } else { vec![last] }
                };
                push_import(out, path, line_of(node), symbols);
                return;
            }
        }
        _ => {}
    }
    let mut cur = node.walk();
    for child in node.named_children(&mut cur) {
        walk(child, src, out, d);
    }
}

// ═══════════════════════════════ Rust use tree ═══════════════════════════════

struct RustLeaf {
    module: String,
    symbols: Vec<String>,
}

fn join_rust(prefix: &[String], tail: &str) -> String {
    let mut segs: Vec<&str> = prefix.iter().map(|s| s.as_str()).collect();
    if !tail.is_empty() {
        segs.push(tail);
    }
    segs.join("::")
}

/// 递归展开 use tree（形态经探针实测，对标 joern `rust2cpg` UseTests 的语义）：
///   `scoped_identifier{path,name}` / `use_as_clause{path,alias}` / `use_wildcard(inner)` /
///   `scoped_use_list{path,list}` / `use_list(..)` / `identifier` / `self` / `crate` / `super`
fn walk_rust_use_tree(node: Node, src: &[u8], prefix: &[String], out: &mut Vec<RustLeaf>) {
    match node.kind() {
        "scoped_use_list" => {
            let mut next = prefix.to_vec();
            if let Some(p) = node.child_by_field_name("path") {
                next.extend(rust_path_segments(p, src));
            }
            if let Some(list) = node.child_by_field_name("list") {
                let mut cur = list.walk();
                for child in list.named_children(&mut cur) {
                    walk_rust_use_tree(child, src, &next, out);
                }
            }
        }
        "use_list" => {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                walk_rust_use_tree(child, src, prefix, out);
            }
        }
        "use_as_clause" => {
            // `a::b::C as D` → 符号取原名 C（与 TS `{A as B}` 取 A 同口径）；`self as alias` → 模块级
            if let Some(p) = node.child_by_field_name("path") {
                walk_rust_use_tree(p, src, prefix, out);
            }
        }
        "use_wildcard" => {
            // `a::b::*` → 模块 a::b，无点名符号（旧逐行整条丢弃）
            let mut segs = prefix.to_vec();
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                segs.extend(rust_path_segments(child, src));
            }
            out.push(RustLeaf { module: segs.join("::"), symbols: Vec::new() });
        }
        "scoped_identifier" => {
            let mut segs = prefix.to_vec();
            if let Some(p) = node.child_by_field_name("path") {
                segs.extend(rust_path_segments(p, src));
            }
            let name = node
                .child_by_field_name("name")
                .map(|n| text_of(n, src))
                .unwrap_or_default();
            // `use std::io::self` 的 self 走 name 位（实测），语义 = 模块引用
            if name.is_empty() || name == "self" {
                out.push(RustLeaf { module: segs.join("::"), symbols: Vec::new() });
            } else {
                out.push(RustLeaf { module: segs.join("::"), symbols: vec![name] });
            }
        }
        // 单段：`use serde;` / `use {a, b::C}` 里的 `a` / `use m::{self}` 里的 self
        "self" | "crate" | "super" => {
            out.push(RustLeaf { module: prefix.join("::"), symbols: Vec::new() });
        }
        "identifier" => {
            let name = text_of(node, src);
            if prefix.is_empty() {
                // 顶层单段 → 当模块引用（无法区分 crate 名与符号名，按模块更保守）
                out.push(RustLeaf { module: name, symbols: Vec::new() });
            } else {
                out.push(RustLeaf { module: prefix.join("::"), symbols: vec![name] });
            }
        }
        _ => {
            // 其他包装节点（如 `use_bounded_identifiers` 等未知形态）→ 保守取整段文本当模块
            let t = text_of(node, src);
            if !t.is_empty() && !t.contains('{') {
                out.push(RustLeaf { module: join_rust(prefix, &t), symbols: Vec::new() });
            }
        }
    }
}

/// 取路径节点的段序列（`std::io` → ["std","io"]；单 identifier → [ident]）
fn rust_path_segments(node: Node, src: &[u8]) -> Vec<String> {
    match node.kind() {
        "scoped_identifier" => {
            let mut segs = node
                .child_by_field_name("path")
                .map(|p| rust_path_segments(p, src))
                .unwrap_or_default();
            if let Some(n) = node.child_by_field_name("name") {
                segs.push(text_of(n, src));
            }
            segs
        }
        _ => {
            let t = text_of(node, src);
            if t.is_empty() { Vec::new() } else { vec![t] }
        }
    }
}

// ═══════════════════════════════ Python helpers ═══════════════════════════════

/// `module_name` 文本：`dotted_name` 原样；`relative_import` 保留点前缀（`.` / `..pkg.mod`）
fn python_module_text(node: Node, src: &[u8]) -> String {
    text_of(node, src).trim().to_string()
}

/// `name` 字段 → 导入的符号名（`aliased_import` 取原名；`wildcard_import` 不产符号）
fn python_imported_name(node: Node, src: &[u8]) -> Option<String> {
    match node.kind() {
        "aliased_import" => node
            .child_by_field_name("name")
            .map(|n| text_of(n, src))
            .filter(|s| !s.is_empty()),
        "dotted_name" | "identifier" => {
            let t = text_of(node, src);
            if t.is_empty() || t == "*" { None } else { Some(t) }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn collect(d: Dialect, src: &str) -> Vec<(String, Vec<String>)> {
        extract_symbol_imports_ast(d, src)
            .map(|(v, _)| v.into_iter().map(|x| (x.path, x.symbols)).collect())
            .unwrap_or_default()
    }

    fn paths(d: Dialect, src: &str) -> Vec<String> {
        collect(d, src).into_iter().map(|(p, _)| p).collect()
    }

    // ───────── Go：用量驱动符号抽取（此前 Go 符号级引用恒为 0）─────────────

    fn go_collect(src: &str) -> Vec<(String, Vec<String>)> {
        extract_go_symbol_imports(src)
            .map(|(v, _)| v.into_iter().map(|x| (x.path, x.symbols)).collect())
            .unwrap_or_default()
    }

    #[test]
    fn go_import_collects_package_qualified_usages() {
        // `store.NewClient` / `store.Client` 是该文件真实用到的符号；`c.Get` 的接收者
        // 是局部变量 c，不是包 → 不得计入。
        let src = r#"package api
import "demo/internal/store"
func Handle() string {
	c := store.NewClient("x")
	var t store.Client
	_ = t
	return c.Get("k")
}
"#;
        assert_eq!(
            go_collect(src),
            vec![(
                "demo/internal/store".to_string(),
                vec!["Client".to_string(), "NewClient".to_string()] // 排序后确定性
            )]
        );
    }

    #[test]
    fn go_type_position_reference_is_captured() {
        // `var t store.Client` 在 AST 里是 **qualified_type**（package_identifier +
        // type_identifier），不是 selector_expression —— 漏掉它类型引用会整片消失。
        let src = r#"package main
import "demo/store"
func f() { var t store.Client; _ = t }
"#;
        assert_eq!(
            go_collect(src),
            vec![("demo/store".to_string(), vec!["Client".to_string()])]
        );
    }

    #[test]
    fn go_alias_import_tracks_alias_not_path_tail() {
        let src = r#"package main
import st "demo/internal/store"
func main() { _ = st.NewClient("x") }
"#;
        assert_eq!(
            go_collect(src),
            vec![(
                "demo/internal/store".to_string(),
                vec!["NewClient".to_string()]
            )]
        );
    }

    #[test]
    fn go_dot_and_blank_imports_yield_no_phantom_symbols() {
        // 点导入/空白导入无法按名归属符号 → 只留路径，不臆造符号（防幻影引用）
        let src = r#"package main
import (
	. "demo/a"
	_ "demo/b"
)
func main() { Foo() }
"#;
        assert_eq!(
            go_collect(src),
            vec![
                ("demo/a".to_string(), vec![]),
                ("demo/b".to_string(), vec![]),
            ]
        );
    }

    #[test]
    fn go_grouped_import_and_stale_selector_are_separated() {
        // 未被引用的包（fmt）符号列表为空，不得把别的包的用法算到它头上
        let src = r#"package main
import (
	"fmt"
	"demo/pkg"
)
func main() { fmt.Println(pkg.Slug("a")) }
"#;
        let got = go_collect(src);
        assert_eq!(got.len(), 2, "实际={:?}", got);
        let fmt = got.iter().find(|(p, _)| p == "fmt").unwrap();
        let pkg = got.iter().find(|(p, _)| p == "demo/pkg").unwrap();
        assert_eq!(fmt.1, vec!["Println".to_string()]);
        assert_eq!(pkg.1, vec!["Slug".to_string()]);
    }

    // ───────── C / C++：#include 文本包含语义（文件级）─────────────

    #[test]
    fn c_local_include_yields_file_level_row() {
        // `#include "x.h"` 是文本包含：搬进整个头文件作用域，不点名符号 → 文件级引用
        let (v, _) = extract_c_symbol_imports(Dialect::C, "#include \"foo/bar.h\"").unwrap();
        assert_eq!(v.len(), 1, "实际={:?}", v);
        assert_eq!(v[0].path, "foo/bar.h");
        assert!(v[0].symbols.is_empty(), "不得臆造符号，实际={:?}", v[0].symbols);
    }

    #[test]
    fn c_system_include_is_not_a_project_reference() {
        let (v, _) = extract_c_symbol_imports(Dialect::C, "#include <stdio.h>").unwrap();
        assert!(v.is_empty(), "系统头不是项目内依赖，实际={:?}", v);
    }

    #[test]
    fn c_multiple_includes_preserve_lines() {
        let src = "#include \"a.h\"\n#include <stdio.h>\n#include \"inc/b.h\"\n";
        let (v, _) = extract_c_symbol_imports(Dialect::Cpp, src).unwrap();
        let got: Vec<(String, usize)> = v.iter().map(|x| (x.path.clone(), x.line)).collect();
        assert_eq!(
            got,
            vec![("a.h".to_string(), 1usize), ("inc/b.h".to_string(), 3usize)]
        );
    }

    // ───────── Rust：对标 joern rust2cpg UseTests.scala 的规格表 ─────────
    #[test]
    fn rust_use_simple_splits_module_and_symbol() {
        assert_eq!(
            collect(Dialect::Rust, "use std::collections::HashMap;"),
            vec![("std::collections".to_string(), vec!["HashMap".to_string()])]
        );
    }

    #[test]
    fn rust_use_alias_keeps_original_symbol() {
        // joern: importedEntity=std::collections::HashMap, importedAs=Map
        assert_eq!(
            collect(Dialect::Rust, "use std::collections::HashMap as Map;"),
            vec![("std::collections".to_string(), vec!["HashMap".to_string()])]
        );
    }

    #[test]
    fn rust_wildcard_is_no_longer_dropped() {
        // 旧 parse_rs_imports 对 `::*` 整条 continue → 再导出引用全丢
        assert_eq!(
            collect(Dialect::Rust, "use std::io::*;"),
            vec![("std::io".to_string(), Vec::<String>::new())]
        );
        let old = crate::commands::code_structure::parse_rs_imports("use std::io::*;");
        assert!(old.is_empty(), "旧逐行确实整条丢弃通配 use");
    }

    #[test]
    fn rust_nested_wildcard() {
        assert_eq!(
            collect(Dialect::Rust, "use a::{b::*};"),
            vec![("a::b".to_string(), Vec::<String>::new())]
        );
    }

    #[test]
    fn rust_use_list_without_prefix() {
        assert_eq!(
            collect(Dialect::Rust, "use {a, b::C};"),
            vec![
                ("a".to_string(), Vec::<String>::new()),
                ("b".to_string(), vec!["C".to_string()]),
            ]
        );
    }

    #[test]
    fn rust_nested_use_tree_expands_to_three_imports() {
        // joern UseTests「nested use tree」：a::b::C / a::d::E(as F) / a::d(self)
        assert_eq!(
            collect(Dialect::Rust, "use a::{b::C, d::{E as F, self}};"),
            vec![
                ("a::b".to_string(), vec!["C".to_string()]),
                ("a::d".to_string(), vec!["E".to_string()]),
            ]
        );
        // 旧逐行只产 1 条且 path 是最后一段
        let old = crate::commands::code_structure::parse_rs_imports("use a::{b::C, d::{E as F, self}};");
        assert_eq!(old.len(), 1);
        assert_eq!(old[0].path, "a");
    }

    #[test]
    fn rust_trailing_self_is_module_level() {
        assert_eq!(
            collect(Dialect::Rust, "use std::io::self;"),
            vec![("std::io".to_string(), Vec::<String>::new())]
        );
        assert_eq!(
            collect(Dialect::Rust, "use m::{self as alias};"),
            vec![("m".to_string(), Vec::<String>::new())]
        );
    }

    #[test]
    fn rust_pub_use_is_captured_but_line_based_misses_it() {
        let src = "pub use crate::commands::code_structure::ParsedImport;";
        assert_eq!(
            collect(Dialect::Rust, src),
            vec![(
                "crate::commands::code_structure".to_string(),
                vec!["ParsedImport".to_string()]
            )]
        );
        // 旧逐行 strip_prefix("use ") 对 `pub use` 失配 → 完全消失
        assert!(
            crate::commands::code_structure::parse_rs_imports(src).is_empty(),
            "旧逐行确实漏掉 pub use（再导出）"
        );
    }

    #[test]
    fn rust_multiline_and_comment_immunity() {
        let src = "// use fake::Ghost;\nuse a::{\n  B,\n  C,\n};\n";
        assert_eq!(
            collect(Dialect::Rust, src),
            vec![("a".to_string(), vec!["B".to_string(), "C".to_string()])]
        );
    }

    #[test]
    fn rust_line_numbers_are_source_lines() {
        let src = "use a::B;\n\nuse c::D;\n";
        let v = extract_symbol_imports_ast(Dialect::Rust, src).unwrap().0;
        assert_eq!(v.iter().map(|x| x.line).collect::<Vec<_>>(), vec![1, 3]);
    }

    // ───────── Python ─────────
    #[test]
    fn py_from_import_symbols() {
        assert_eq!(
            collect(Dialect::Python, "from a.b import C, D"),
            vec![("a.b".to_string(), vec!["C".to_string(), "D".to_string()])]
        );
    }

    #[test]
    fn py_aliased_import_keeps_original_symbol() {
        assert_eq!(
            collect(Dialect::Python, "from a.b import C as X"),
            vec![("a.b".to_string(), vec!["C".to_string()])]
        );
    }

    #[test]
    fn py_relative_import_is_no_longer_dropped() {
        // 旧逐行：module == "." → continue（整条丢）
        assert_eq!(
            collect(Dialect::Python, "from . import x"),
            vec![(".".to_string(), vec!["x".to_string()])]
        );
        assert!(crate::commands::code_structure::parse_py_imports("from . import x").is_empty());
        assert_eq!(
            collect(Dialect::Python, "from .foo import Bar"),
            vec![(".foo".to_string(), vec!["Bar".to_string()])]
        );
    }

    #[test]
    fn py_wildcard_and_multiline() {
        assert_eq!(
            collect(Dialect::Python, "from x import *"),
            vec![("x".to_string(), Vec::<String>::new())]
        );
        let src = "from pkg import (\n  A,\n  B as C,\n)\n";
        assert_eq!(
            collect(Dialect::Python, src),
            vec![("pkg".to_string(), vec!["A".to_string(), "B".to_string()])]
        );
    }

    #[test]
    fn py_plain_import_has_no_symbols_and_ignores_comments() {
        let src = "# from ghost import Phantom\nimport a.b as ab\n";
        assert_eq!(
            collect(Dialect::Python, src),
            vec![("a.b".to_string(), Vec::<String>::new())]
        );
    }

    // ───────── Java ─────────
    #[test]
    fn java_static_import_yields_member_symbol() {
        // 旧逐行 `!rest.starts_with("static ")` 整条丢弃
        assert_eq!(
            collect(Dialect::Java, "import static org.junit.Assert.assertEquals;"),
            vec![(
                "org.junit.Assert".to_string(),
                vec!["assertEquals".to_string()]
            )]
        );
        assert!(
            crate::commands::code_structure::parse_java_imports(
                "import static org.junit.Assert.assertEquals;"
            )
            .is_empty(),
            "旧逐行确实丢弃静态导入"
        );
    }

    #[test]
    fn java_wildcard_strips_asterisk_from_path() {
        assert_eq!(
            collect(Dialect::Java, "import java.util.*;"),
            vec![("java.util".to_string(), Vec::<String>::new())]
        );
        // 旧实现 path 带 `.*`（永远匹配不到文件）
        let old = crate::commands::code_structure::parse_java_imports("import java.util.*;");
        assert_eq!(old[0].path, "java.util.*");
    }

    #[test]
    fn java_plain_import_class_symbol() {
        assert_eq!(
            collect(Dialect::Java, "import java.util.List;"),
            vec![("java.util.List".to_string(), vec!["List".to_string()])]
        );
    }

    #[test]
    fn java_block_comment_import_is_ignored() {
        let src = "/*\nimport ghost.Phantom;\n*/\nimport java.util.Map;\n";
        assert_eq!(paths(Dialect::Java, src), vec!["java.util.Map"]);
    }

    // ───────── Kotlin ─────────
    #[test]
    fn kotlin_alias_import_no_longer_dirty() {
        assert_eq!(
            collect(Dialect::Kotlin, "import com.foo.Bar as Baz"),
            vec![("com.foo.Bar".to_string(), vec!["Bar".to_string()])]
        );
        // 旧逐行：path/symbol 都被 ` as Baz` 污染 → 永远匹配不到目标符号
        let old = crate::commands::code_structure::parse_java_imports("import com.foo.Bar as Baz");
        assert_eq!(old[0].path, "com.foo.Bar as Baz");
        assert_eq!(old[0].symbols, vec!["Bar as Baz".to_string()]);
    }

    #[test]
    fn kotlin_wildcard_is_module_level() {
        assert_eq!(
            collect(Dialect::Kotlin, "import kotlin.math.*"),
            vec![("kotlin.math".to_string(), Vec::<String>::new())]
        );
    }

    // ───────── 其他方言不接管（回退逐行） ─────────
    #[test]
    fn unsupported_dialects_return_none() {
        assert!(extract_symbol_imports_ast(Dialect::Go, "import \"fmt\"").is_none());
        assert!(extract_symbol_imports_ast(Dialect::C, "#include \"a.h\"").is_none());
    }

    // ═══════════════════════ 真实数据端到端回放（诚实度量）═══════════════════════

    fn norm(p: &str) -> String {
        let mut out = std::path::PathBuf::new();
        for comp in std::path::Path::new(p).components() {
            match comp {
                std::path::Component::ParentDir => {
                    out.pop();
                }
                std::path::Component::CurDir => {}
                other => out.push(other),
            }
        }
        out.to_string_lossy().replace('\\', "/")
    }

    /// 复刻消费点 `analyze_symbol_references` **改造前**的候选生成（TS 语义）。
    fn ts_style_candidates(from_rel: &str, path: &str) -> Vec<String> {
        let resolved = if path.starts_with("./") || path.starts_with("../") {
            match std::path::Path::new(from_rel).parent() {
                Some(parent) => norm(&parent.join(path).to_string_lossy()),
                None => path.to_string(),
            }
        } else if path.starts_with('/') {
            norm(path.trim_start_matches('/'))
        } else {
            path.to_string()
        };
        let mut c = vec![resolved.clone()];
        if !resolved.contains('.') {
            for ext in ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp"] {
                c.push(format!("{}.{}", resolved, ext));
                c.push(format!("{}/index.{}", resolved, ext));
                c.push(format!("{}/mod.{}", resolved, ext));
            }
        }
        c
    }

    /// 端到端真实回放（默认跳过）：
    /// `REPLAY_SYMBOL_REF_DIR=<目录> cargo test replay_symbol_refs -- --nocapture`
    ///
    /// 量的是**真正能落进 `project_symbol_refs` 的行数**（抽取层 + 解析层串起来后），
    /// 而不是「抽了多少条 import」——后者与功能可用性无关（上一轮的教训：基线被
    /// AST 入口污染 → 量出假「持平」；这里两条链路各自独立，且 old 链路强制走
    /// 旧逐行抽取 + 旧 TS 候选逻辑）。
    #[test]
    fn replay_symbol_refs() {
        let Ok(dir) = std::env::var("REPLAY_SYMBOL_REF_DIR") else {
            return;
        };
        let root = std::path::Path::new(&dir);
        fn walk_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                        matches!(n, "node_modules" | "target" | ".git" | "vendor" | "dist")
                    }) {
                        continue;
                    }
                    walk_files(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk_files(root, &mut files);
        // 已知相对路径集合（等价 path_to_id 的 key 集）
        let known: HashSet<String> = files
            .iter()
            .filter_map(|f| f.strip_prefix(root).ok())
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .collect();

        let hit = |cands: Vec<String>| -> bool { cands.iter().any(|c| known.contains(c)) };

        let (mut new_rows, mut old_rows, mut new_files_hit, mut old_files_hit) = (0, 0, 0, 0);
        let mut samples: Vec<String> = Vec::new();
        for f in &files {
            let Some(ext) = f.extension().and_then(|s| s.to_str()) else {
                continue;
            };
            let lang = match ext {
                "rs" => "rust",
                "py" | "pyi" => "python",
                "java" => "java",
                "kt" | "kts" => "kotlin",
                _ => continue,
            };
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            let rel = f
                .strip_prefix(root)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();

            // ── 新链路：AST 抽取 + TS 候选 + 模块记号兜底 ──
            let new_imports = crate::parser::parse_imports_with_symbols(lang, &content);
            let mut nf = 0usize;
            for imp in &new_imports {
                let resolved = hit(ts_style_candidates(&rel, &imp.path))
                    || hit(crate::commands::code_structure::module_ref_candidates(
                        lang, &rel, &imp.path,
                    ));
                if resolved {
                    nf += 1;
                    new_rows += imp.symbols.len().max(1);
                }
            }
            new_files_hit += nf;

            // ── 旧链路：逐行抽取 + 仅 TS 候选（改造前的真实行为）──
            let old_imports = match lang {
                "rust" => crate::commands::code_structure::parse_rs_imports(&content),
                "python" => crate::commands::code_structure::parse_py_imports(&content),
                _ => crate::commands::code_structure::parse_java_imports(&content),
            };
            let mut of = 0usize;
            for imp in &old_imports {
                if hit(ts_style_candidates(&rel, &imp.path)) {
                    of += 1;
                    old_rows += imp.symbols.len().max(1);
                }
            }
            old_files_hit += of;

            if nf > of && samples.len() < 8 {
                let ex: Vec<String> = new_imports
                    .iter()
                    .filter(|i| {
                        hit(ts_style_candidates(&rel, &i.path))
                            || hit(crate::commands::code_structure::module_ref_candidates(
                                lang, &rel, &i.path,
                            ))
                    })
                    .take(3)
                    .map(|i| format!("{}→{:?}", i.path, i.symbols))
                    .collect();
                samples.push(format!("{rel}: new={nf} old={of} e.g. {ex:?}"));
            }
        }
        println!(
            "REPLAY_SYMBOL_REFS files={} | resolvedImports new={} old={} | refRows new={} old={}",
            known.len(),
            new_files_hit,
            old_files_hit,
            new_rows,
            old_rows
        );
        for s in &samples {
            println!("  sample {s}");
        }
    }

    // ═══════════════ 「UI 可见性」回放：to_symbol_id 命中率（本轮核心度量）═══════════════

    /// 语言 → tree-sitter 侧 lang 记号；返回 None 表示本探针不覆盖。
    fn lang_of(ext: &str) -> Option<&'static str> {
        match ext {
            "rs" => Some("rust"),
            "py" | "pyi" => Some("python"),
            "java" => Some("java"),
            "kt" | "kts" => Some("kotlin"),
            // TS/JS 一并纳入：作为「命中率是否为非 TS 独有问题」的参照系
            "ts" | "tsx" => Some("typescript"),
            "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
            // Go / C 此前**连探针都不覆盖** —— 这正是「Go/C 符号级引用恒为 0」能潜伏多轮的
            // 原因：量都量不到，自然不会有人去修。补齐后才能真正即修即验。
            "go" => Some("go"),
            "c" | "h" => Some("c"),
            "cpp" | "cc" | "cxx" | "hpp" | "hh" => Some("cpp"),
            _ => None,
        }
    }

    /// 解析 import 记号到**具体命中的目标文件相对路径**（先 TS 候选，后模块记号兜底），
    /// 与消费点 `analyze_symbol_references` 的两段式解析同序。
    fn resolve_to_rel(
        lang: &str,
        from_rel: &str,
        path: &str,
        known: &HashSet<String>,
    ) -> Option<String> {
        ts_style_candidates(from_rel, path)
            .into_iter()
            .find(|c| known.contains(c))
            .or_else(|| {
                let cands =
                    crate::commands::code_structure::module_ref_candidates(lang, from_rel, path);
                if let Some(hit) = cands.iter().find(|c| known.contains(*c)) {
                    return Some(hit.clone());
                }
                // Go 包目录回退（与生产 `resolve_go_pkg_dir` 同口径）：包体是目录，
                // 包内文件不必与包同名（`internal/api/handler.go`、`pkg/util.go`）。
                // 生产侧会优先选「定义了被引用符号」的文件，此处只需判定目录能否命中，
                // 故取目录内字典序首个已知文件即可。
                if lang == "go" {
                    for c in &cands {
                        if c.ends_with(".go") || c.is_empty() {
                            continue;
                        }
                        let prefix = format!("{}/", c);
                        let mut hits: Vec<&String> =
                            known.iter().filter(|p| p.starts_with(&prefix)).collect();
                        if !hits.is_empty() {
                            hits.sort();
                            return Some(hits[0].clone());
                        }
                    }
                }
                None
            })
    }

    /// 端到端「UI 可见性」回放（默认跳过）：
    /// `REPLAY_SYMBOL_HIT_DIR=<目录> cargo test replay_symbol_ref_hits -- --nocapture`
    ///
    /// **为什么必须单独量这个**：引用落进 `project_symbol_refs` ≠ 前端能看见。前端 5 个
    /// 消费点全部以 `toSymbolId` 非空为闸门 —— `to_symbol_id = None` 的行在符号级视图里
    /// 被整条丢弃：
    ///   - `src/editor/utils/symbolRefs.ts:14`     groupRefsBySymbol（引用点列表）
    ///   - `src/editor/utils/symbolLayout.ts:394`  引用计数徽标
    ///   - `src/editor/utils/symbolLayout.ts:272`  画布符号引用边
    ///   - `src/utils/reportGenerator.ts:43`       导出报告 refCount
    ///   - `src/ai/acp/tools.ts:262`               AI 工具按符号查引用
    ///
    /// 所以「符号 id 命中率」才是「renderable ≠ useful」标尺下的真实验收指标：
    /// 命中 = 用户在 UI 上真看得见的引用；未命中 = 只在库里、UI 永远为 0。
    #[test]
    fn replay_symbol_ref_hits() {
        let Ok(dir) = std::env::var("REPLAY_SYMBOL_HIT_DIR") else {
            return;
        };
        let root = std::path::Path::new(&dir);
        fn walk_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                        matches!(n, "node_modules" | "target" | ".git" | "vendor" | "dist" | "build")
                    }) {
                        continue;
                    }
                    walk_files(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk_files(root, &mut files);
        let rel_of = |f: &std::path::Path| -> String {
            f.strip_prefix(root)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default()
        };
        let known: HashSet<String> = files.iter().map(|f| rel_of(f)).collect();

        // ── 第一遍：真实符号抽取，建「目标文件 → 符号名集」（等价后端 symbols_by_file）
        //    同时缓存每个文件的 import 列表，供再导出链解析复用 ──
        let mut symbols_by_rel: HashMap<String, HashSet<String>> = HashMap::new();
        let mut imports_by_rel: HashMap<String, Vec<ParsedImport>> = HashMap::new();
        // 符号表规模计数：[全部符号, 其中 Rust 受限可见 `pub(...)`]。
        // 后者是「受限可见符号被整批丢弃」修复所恢复的经验值（改前这一列恒为 0）。
        let mut sym_total = 0usize;
        let mut sym_restricted = 0usize;
        for f in &files {
            let Some(lang) = f.extension().and_then(|s| s.to_str()).and_then(lang_of) else {
                continue;
            };
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            let extracted = crate::parser::extract_symbols(lang, &content);
            sym_total += extracted.len();
            sym_restricted += extracted
                .iter()
                .filter(|s| s.signature.trim_start().starts_with("pub("))
                .count();
            let names: HashSet<String> = extracted.into_iter().map(|s| s.name).collect();
            let rel = rel_of(f);
            symbols_by_rel.insert(rel.clone(), names);
            // 与消费点同一供给函数（AST ∪ 行级 pub use 兜底），否则探针量的不是 UI 真相
            imports_by_rel.insert(
                rel,
                crate::commands::code_structure::reexport_imports_for(lang, &content),
            );
        }

        // ── 第二遍：引用解析 + 符号 id 命中判定 ──
        // 每语言：[symbolLevelRows, symbolIdHit, fileLevelRows, unresolvedImports, reexportRescued]
        let mut stat: HashMap<&'static str, [usize; 5]> = HashMap::new();
        let mut miss_samples: Vec<String> = Vec::new();
        let mut rescued_samples: Vec<String> = Vec::new();
        for f in &files {
            let Some(lang) = f.extension().and_then(|s| s.to_str()).and_then(lang_of) else {
                continue;
            };
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            let rel = rel_of(f);
            let entry = stat.entry(lang).or_insert([0; 5]);
            for imp in crate::parser::parse_imports_with_symbols(lang, &content) {
                let Some(to_rel) = resolve_to_rel(lang, &rel, &imp.path, &known) else {
                    entry[3] += 1; // 未解析到仓库内文件（外部依赖为主）
                    continue;
                };
                if imp.symbols.is_empty() {
                    entry[2] += 1; // 文件级引用：to_symbol_id 必为 None
                    continue;
                }
                let target = symbols_by_rel.get(&to_rel);
                for name in &imp.symbols {
                    entry[0] += 1;
                    if target.is_some_and(|s| s.contains(name)) {
                        entry[1] += 1;
                        continue;
                    }
                    // 再导出链兜底（与消费点 `analyze_symbol_references` 同一入口、同参数）
                    let rescued = crate::commands::code_structure::resolve_symbol_via_reexports(
                        lang,
                        &rel,
                        &imp.path,
                        &to_rel,
                        name,
                        |r| symbols_by_rel.get(r).is_some_and(|s| s.contains(name)),
                        |r| imports_by_rel.get(r).cloned().unwrap_or_default(),
                        |from_rel, path| {
                            // 与真实消费点 analyze_symbol_references 同口径：TS/JS 走
                            // ts_module_candidates，其余语言走 module_ref_candidates。
                            if matches!(lang, "typescript" | "javascript") {
                                crate::commands::code_structure::ts_module_candidates(from_rel, path)
                            } else {
                                crate::commands::code_structure::module_ref_candidates(lang, from_rel, path)
                            }
                            .into_iter()
                            .find(|c| known.contains(c))
                        },
                    );
                    match rescued {
                        Some(def_rel) => {
                            entry[1] += 1;
                            entry[4] += 1;
                            if rescued_samples.len() < 6 {
                                rescued_samples.push(format!(
                                    "{lang} {rel}:{} `{}`→{to_rel} ⇒ 定义在 {def_rel} (`{name}`)",
                                    imp.line, imp.path
                                ));
                            }
                        }
                        None if miss_samples.len() < 12 => miss_samples.push(format!(
                            "{lang} {rel}:{} `{}`→{to_rel} 符号 `{name}` 未命中",
                            imp.line, imp.path
                        )),
                        None => {}
                    }
                }
            }
        }

        println!("REPLAY_SYMBOL_HITS root={dir} files={}", known.len());
        println!(
            "  symbolTable total={sym_total} restrictedVisibility={sym_restricted}  ← 后者改前恒为 0（`pub(...)` 整批丢弃）"
        );
        let mut langs: Vec<&&str> = stat.keys().collect();
        langs.sort();
        let (mut t_sym, mut t_hit, mut t_file, mut t_unres, mut t_resc) = (0, 0, 0, 0, 0);
        for l in langs {
            let s = stat[*l];
            let rate = if s[0] == 0 { 0.0 } else { s[1] as f64 * 100.0 / s[0] as f64 };
            let base = if s[0] == 0 { 0.0 } else { (s[1] - s[4]) as f64 * 100.0 / s[0] as f64 };
            println!(
                "  {l:<10} symbolLevelRows={:<5} toSymbolIdHit={:<5} ({rate:.1}%, 改前 {base:.1}%)  reexportRescued={:<5} fileLevelRows={:<5} unresolved={}",
                s[0], s[1], s[4], s[2], s[3]
            );
            t_sym += s[0];
            t_hit += s[1];
            t_file += s[2];
            t_unres += s[3];
            t_resc += s[4];
        }
        let rate = if t_sym == 0 { 0.0 } else { t_hit as f64 * 100.0 / t_sym as f64 };
        let base = if t_sym == 0 { 0.0 } else { (t_hit - t_resc) as f64 * 100.0 / t_sym as f64 };
        println!(
            "  TOTAL      symbolLevelRows={t_sym} toSymbolIdHit={t_hit} ({rate:.1}%, 改前 {base:.1}%)  reexportRescued={t_resc} fileLevelRows={t_file} unresolved={t_unres}"
        );
        println!("  ↑ toSymbolIdHit = 前端 5 个消费点真正能看见的引用行数");
        for s in &rescued_samples {
            println!("  rescued {s}");
        }
        for s in &miss_samples {
            println!("  miss    {s}");
        }
    }
}
