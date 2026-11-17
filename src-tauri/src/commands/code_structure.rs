// [SEALED] allow dead_code: 封存域/预留公共 API，保留签名
#![allow(dead_code)]
//! 代码结构分析命令：符号索引 + 设计模式检测
//!
//! 对应需求文档「扫描项目需要分析：文件目录、代码结构、代码之间的引用、索引、依赖关系、设计模式」。
//! 本模块提供：
//! - `analyze_code_structure`：对源码文件做正则级结构解析，提取符号（类/函数/接口/结构体/枚举/特征），
//!   并检测常见设计模式（Singleton/Factory/Observer/Strategy/Repository/Service），写入 project_symbols 表。
//! - `list_project_symbols` / `count_symbols_by_kind`：查询符号索引。
//! - `list_design_patterns`：查询设计模式命中。
//!
//! 符号是「代码结构」的最小单元，前端左侧实体面板据此渲染 class/function/interface 等实体实例，
//! 并与画布、审查结果联动。

use crate::domain::project_files::ProjectFile;
use crate::domain::project_symbol_refs::SymbolRef;
use crate::domain::project_symbols::{PatternHit, ProjectSymbol, StructureSummary};
use crate::error::{AppError, AppResult};
use crate::infrastructure::ast::Dialect;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_symbol_ref_repository::ProjectSymbolRefRepository;
use crate::infrastructure::database::project_symbol_repository::ProjectSymbolRepository;
use crate::infrastructure::database::{
    SqliteProjectFileRepository, SqliteProjectSymbolRefRepository, SqliteProjectSymbolRepository,
};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tree_sitter::{Node, Parser};

/// 单行提取出的符号候选（在文件级收集后统一生成 ProjectSymbol）
pub struct SymbolCandidate {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub signature: String,
    pub modifiers: String,
}

/// 提取一个文件中所有符号（按语言分发）
///
/// R45（解析器插件化）：分发交给 `parser::extract_symbols`（ParserRegistry 驱动）。
/// 本函数保留为兼容入口，内部转发到注册表；具体语言的提取实现仍在下方
/// （由各 `parser::*` 插件薄封装调用，避免重复实现）。
pub fn extract_symbols(lang: &str, content: &str) -> Vec<SymbolCandidate> {
    crate::parser::extract_symbols(lang, content)
}

// ─── TypeScript / JavaScript ───

/// TS/JS 类方法签名行 → 方法名（非方法返回 None）。
///
/// 特征（v2.3 方法级符号提取）：行尾 `{`（方法体大括号同行，绝大多数格式化
/// 代码如此）且括号前是单一标识符，允许 #private / async / get / set / static
/// / 可见性修饰前缀。防御：
/// - `foo = () => {` 属性箭头函数 → 括号前 "foo =" 含 '=' → 排除
/// - `this.foo()` 方法体内调用 → 括号前 "this.foo" 含 '.' → 排除
/// - `if/for/while/switch/function` 行 → 排除
/// - interface 方法签名 `foo(): void;` 行尾 ';' 无 '{' → 天然排除
fn ts_method_name(line: &str) -> Option<String> {
    let mut t = line.trim();
    // 方法体大括号同行：`foo() {`（有体）或 `foo() {}`（空体，行尾 '}'）
    if !t.ends_with('{') && !t.ends_with('}') {
        return None;
    }
    t = t.trim_end_matches(['{', '}']).trim_end();
    if t.is_empty() {
        return None;
    }
    // 循环剥修饰前缀（static async get set public private protected readonly abstract）
    loop {
        let mut stripped = false;
        for kw in [
            "static ",
            "async ",
            "get ",
            "set ",
            "public ",
            "private ",
            "protected ",
            "readonly ",
            "abstract ",
        ] {
            if let Some(rest) = t.strip_prefix(kw) {
                t = rest.trim_start();
                stripped = true;
            }
        }
        if !stripped {
            break;
        }
    }
    // #private 方法
    if let Some(rest) = t.strip_prefix('#') {
        t = rest.trim_start();
    }
    if t == "constructor" || t.starts_with("constructor(") {
        return Some("constructor".to_string());
    }
    let open = t.find('(')?;
    let before = t[..open].trim();
    if before.is_empty()
        || before.contains('.')
        || before.contains('=')
        || before.contains(' ')
        || before.starts_with("function")
        || before.starts_with("if")
        || before.starts_with("for")
        || before.starts_with("while")
        || before.starts_with("switch")
        || before.starts_with("return")
    {
        return None;
    }
    if !before
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
    {
        return None;
    }
    Some(before.to_string())
}

/// Java 方法签名行 → 方法名（非方法返回 None）。
/// 特征：行尾 `{` + 括号前最后一个词为标识符（返回类型/修饰在前）。
/// 防御：class/interface/if/for/while/switch/catch/new（匿名类）行排除。
fn java_method_name(line: &str) -> Option<String> {
    let t = line.trim();
    if !t.ends_with('{') {
        return None;
    }
    let t = t.trim_end_matches('{').trim_end();
    let open = t.find('(')?;
    let before = t[..open].trim();
    if before.is_empty() || before.starts_with("new ") {
        return None;
    }
    if before.starts_with("class ")
        || before.starts_with("interface ")
        || before.starts_with("enum ")
        || before.starts_with("if ")
        || before.starts_with("for ")
        || before.starts_with("while ")
        || before.starts_with("switch ")
        || before.starts_with("catch ")
        || before.starts_with("synchronized ")
    {
        return None;
    }
    let name = before.split_whitespace().last()?;
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '$')
    {
        return None;
    }
    Some(name.to_string())
}

/// TS/JS 符号提取（tree-sitter 节点遍历版，对标 joern 统一 CPG）。
///
/// 覆盖：函数声明 / 类 / 接口 / 枚举 / 类型别名 / 方法（class 方法、对象方法简写、
/// getter/setter、async/static 修饰）/ 箭头函数赋值（含柯里化 `const useX = create<T>()(...)`）/
/// class 字段箭头 / 对象字面量 `key: () => {}`。比逐行正则多覆盖「箭头/对象方法/跨行签名」。
///
/// `.vue` SFC 无 tree-sitter grammar，回退正则（保持既有行为）；tree-sitter 解析失败同样
/// 回退正则 —— 零回归底线。
pub fn extract_ts_symbols(content: &str) -> Vec<SymbolCandidate> {
    if looks_like_vue(content) {
        return extract_ts_symbols_regex(content);
    }
    let mut parser = Parser::new();
    if parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
        .is_err()
    {
        return extract_ts_symbols_regex(content);
    }
    let tree = match parser.parse(content, None) {
        Some(t) => t,
        None => return extract_ts_symbols_regex(content),
    };
    let src = content.as_bytes();
    // joern 的 CPG 把**所有**声明都建成节点，export 是边/属性而非建节点门禁。
    // 故分列式 `export { X }` 不能靠祖先判定——先收集被再导出的本地符号名集合，
    // 让 `const X = ...; export { X }` 这种间接导出也能被符号化（此前整批漏抓，
    // 跨文件 `import { X }` 时 to_symbol_id 恒 None → 引用计数死功能）。
    // 只收集无 `from` 的本地再导出（`export { X } from './y'` 再导出的是导入符号，非本地声明）。
    let mut reexported = HashSet::new();
    collect_ts_reexport_names(tree.root_node(), src, &mut reexported);
    let mut out = Vec::new();
    collect_ts_symbols(tree.root_node(), src, &mut out, &reexported);
    out
}

fn looks_like_vue(content: &str) -> bool {
    // 仅在确实像 Vue SFC 时才走正则回退：`.vue` 文件必有 `<template>` 块，
    // 或含成对的 `<script>…</script>`（脚本型 SFC）。
    // 旧实现用裸 `<style` / 裸 `<script`（无闭合标签）判定，会误命中普通 .ts 文件里
    // 注释 / 字符串中的 `<style>` 字样（如 editor/renderers/canvasTheme.ts 第 12 行注释），
    // 导致整文件被当成 SFC 走正则回退、const 符号全丢失（renderable≠useful 死功能）。
    content.contains("<template") || (content.contains("<script") && content.contains("</script"))
}

fn collect_ts_symbols(
    node: Node,
    src: &[u8],
    out: &mut Vec<SymbolCandidate>,
    reexported: &HashSet<String>,
) {
    match node.kind() {
        "function_declaration" | "generator_function_declaration" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "function", node, src);
            }
        }
        "class_declaration" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "class", node, src);
            }
        }
        "interface_declaration" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "interface", node, src);
            }
        }
        "enum_declaration" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "enum", node, src);
            }
        }
        "type_alias_declaration" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "type_alias", node, src);
            }
        }
        "method_definition" => {
            if let Some(n) = node.child_by_field_name("name") {
                push_ts_sym(out, text_of(n, src), "method", node, src);
            }
        }
        "variable_declarator" => {
            if let (Some(nn), Some(vn)) = (
                node.child_by_field_name("name"),
                node.child_by_field_name("value"),
            ) {
                if nn.kind() == "identifier" {
                    let name_str = text_of(nn, src);
                    // 导出判定：① 行内 `export const X`（祖先是 export_statement）；
                    // ② 分列式 `export { X }` 间接导出（X 在再导出名集合里）。
                    // 二者任一成立即符号化为数据常量，避免跨文件 import 时 to_symbol_id 恒 None。
                    // 对标 joern jssrc2cpg：声明节点永远建立、export 是边而非建节点门禁。
                    let exported = is_exported(node) || reexported.contains(&name_str);
                    if is_callable_value(vn) {
                        // 已是 callable（如 const fn = () => {}）→ 按函数符号化
                        push_ts_sym(out, name_str, "function", node, src);
                    } else if exported {
                        // 导出数据常量（number/string/array/object/Record 等）。
                        // joern 的 CPG 把**所有**声明都建成节点；此前只符号化 callable 的
                        // const，导致跨文件 `import { CONST } from './x'` 时 to_symbol_id
                        // 恒为 None → UI 引用计数恒 0 的死功能（renderable≠useful）。
                        // 仅符号化**导出**常量，避免把函数体内的局部变量也塞进符号表。
                        push_ts_sym(out, name_str, "const", node, src);
                    }
                }
            }
        }
        _ => {}
    }
    let mut child = node.child(0);
    while let Some(c) = child {
        collect_ts_symbols(c, src, out, reexported);
        child = c.next_sibling();
    }
}

fn is_callable_value(v: Node) -> bool {
    matches!(
        v.kind(),
        "arrow_function"
            | "function_expression"
            | "generator_function"
            | "call_expression"
            | "new_expression"
    )
}

/// 判断一个声明节点是否处于 `export_statement` 之下（含任意层祖先）。
/// 用于仅符号化**导出**数据常量，避免把函数体内的局部 `const` 也塞进符号表。
fn is_exported(node: Node) -> bool {
    let mut p = node.parent();
    while let Some(parent) = p {
        if parent.kind() == "export_statement" {
            return true;
        }
        p = parent.parent();
    }
    false
}

/// 收集被「分列式再导出」`export { A, B }` 点名的**本地**符号名集合。
///
/// 仅收集无 `from` 的本地再导出（`export { A }`）；带 `from` 的
/// `export { A } from './y'` 再导出的是导入符号而非本地声明，跳过。
/// `export { A as B }` 的本地符号名是 `A`（别名 `B` 是外部名），取 `name` 字段。
/// `export * from` / `export { default }` 无本地名，跳过。
///
/// 对标 joern jssrc2cpg：`ExportNamedDeclaration` 的声明节点永远建立、export 是边而非建节点门禁；
/// 我们这里让 `const X = ...; export { X }` 这种**间接导出**的数据常量也能进入符号表
/// （此前整批漏抓，跨文件 `import { X }` 时 `to_symbol_id` 恒 None → 引用计数死功能）。
fn collect_ts_reexport_names(node: Node, src: &[u8], out: &mut HashSet<String>) {
    if node.kind() == "export_statement" {
        // 带 source（from './x'）的再导出跳过：再导出的是导入符号，本地无对应声明。
        if node.child_by_field_name("source").is_none() {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                if child.kind() == "export_clause" {
                    let mut icur = child.walk();
                    for spec in child.named_children(&mut icur) {
                        if spec.kind() == "export_specifier" {
                            if let Some(n) = spec.child_by_field_name("name") {
                                let name = text_of(n, src);
                                if !name.is_empty() && name != "*" && name != "default" {
                                    out.insert(name);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let mut cur = node.walk();
    for child in node.named_children(&mut cur) {
        collect_ts_reexport_names(child, src, out);
    }
}

fn text_of(node: Node, src: &[u8]) -> String {
    node.utf8_text(src).unwrap_or("").to_string()
}

fn push_ts_sym(
    out: &mut Vec<SymbolCandidate>,
    mut name: String,
    kind: &str,
    node: Node,
    src: &[u8],
) {
    if name.is_empty() {
        return;
    }
    // TS 私有成员以 `#` 前缀命名（tree-sitter 的 private_property_identifier 含 `#`）；
    // 与旧正则提取的规范名一致，去掉前缀只保留标识名。
    if name.starts_with('#') {
        name = name[1..].to_string();
    }
    let text = node.utf8_text(src).unwrap_or("").to_string();
    let sig = text.lines().next().unwrap_or("").trim().to_string();
    out.push(SymbolCandidate {
        name,
        kind: kind.to_string(),
        line: node.start_position().row + 1,
        signature: sig,
        modifiers: extract_modifiers(&text),
    });
}

fn extract_ts_symbols_regex(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    // v2.3 方法级符号：class/interface/enum body 内的方法提取上下文。
    // 结束判定：顶层（无缩进）`}` 行 —— 类体是顶层块，方法体 `}` 有缩进，天然区分。
    let mut in_body = false;
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let top_level_close =
            line.starts_with('}') && !raw_line.starts_with(' ') && !raw_line.starts_with('\t');
        if line.is_empty()
            || line.starts_with("//")
            || line.starts_with("/*")
            || line.starts_with('*')
        {
            continue;
        }
        // 类体结束
        if in_body && top_level_close {
            in_body = false;
            continue;
        }
        let m = strip_export(line);
        // class / interface / enum 声明 → 进入 body 上下文（方法提取）
        if let Some(rest) = strip_keyword(m, "class") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "class".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            in_body = true;
            continue;
        }
        if let Some(rest) = strip_keyword(m, "interface") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "interface".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            in_body = true;
            continue;
        }
        // 类方法（v2.3）：在类体内、行尾 `{` 的方法签名
        if in_body {
            if let Some(method_name) = ts_method_name(line) {
                out.push(SymbolCandidate {
                    name: method_name,
                    kind: "method".to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: extract_modifiers(line),
                });
                continue;
            }
        }
        // enum
        if let Some(rest) = strip_keyword(m, "enum") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "enum".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            continue;
        }
        // type X =
        if let Some(rest) = strip_keyword(m, "type") {
            let name = first_word(rest).trim_end_matches('=').trim().to_string();
            if !name.is_empty() && !name.contains(' ') {
                out.push(SymbolCandidate {
                    name,
                    kind: "type_alias".to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: extract_modifiers(line),
                });
                continue;
            }
        }
        // function name(
        if let Some(rest) = strip_keyword(m, "function") {
            let name = first_word(rest).trim_end_matches('(').trim().to_string();
            out.push(SymbolCandidate {
                name,
                kind: "function".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            continue;
        }
        // const/let/var X = (...) =>   (箭头函数)
        if m.starts_with("const ") || m.starts_with("let ") || m.starts_with("var ") {
            let rest = m;
            if let Some(eq_pos) = rest.find('=') {
                let name = rest[..eq_pos]
                    .replace("const", "")
                    .replace("let", "")
                    .replace("var", "")
                    .trim()
                    .to_string();
                if !name.is_empty()
                    && !name.contains(' ')
                    && !name.contains('(')
                    && !name.contains(')')
                {
                    let after_eq = rest[eq_pos + 1..].trim();
                    // v2.27 补全：现代 TS/React 项目大量采用「柯里化调用」写法，箭头在下一行，
                    // 例如 Zustand 的 `const useX = create<T>()((set) => ({...}))`、HOC 的
                    // `const withY = (C) => (props) => <C {...props}/>`。单行启发式只认同行的
                    // `=>/async/function`，会把这些函数式模式整体漏掉 —— 而设计模式画像靠符号表
                    // 驱动，符号一丢，store/hook/hoc/工厂全都不显示，正是「设计模式画像不能用」的根因。
                    // 这里补认「右值以 `(标识符` 开头的多行调用表达式」（排除 `(字符串`/`(数字`/`({对象` 等纯值）。
                    // 右值是「调用表达式」：① 以标识符开头且本行含 `(`（如柯里化 `create<T>()(`、
                    // `someFunc(`），或 ② 以 `(` 开头且其后紧跟标识符（分组调用 `(create<T>()(`）。
                    // 排除 `(字符串`/`(数字`/`({对象` 等纯值。箭头在后续行也不影响——只要被识别为
                    // 函数式符号，detect 就能在重检测时拿到完整源码体判定模式。
                    let looks_like_call = after_eq
                        .chars()
                        .next()
                        .map_or(false, |c| c.is_alphabetic() || c == '_')
                        && after_eq.contains('(');
                    let looks_like_grouped_call = after_eq.starts_with('(')
                        && after_eq
                            .chars()
                            .nth(1)
                            .map_or(false, |c| c.is_alphabetic() || c == '_');
                    let multiline_call = looks_like_call || looks_like_grouped_call;
                    if after_eq.starts_with("async")
                        || after_eq.contains("=>")
                        || after_eq.starts_with("function")
                        || multiline_call
                    {
                        out.push(SymbolCandidate {
                            name,
                            kind: "function".to_string(),
                            line: i + 1,
                            signature: raw_line.trim().to_string(),
                            modifiers: extract_modifiers(line),
                        });
                    }
                }
            }
        }
    }
    out
}

/// 去掉行首的 export / export default / export const 前缀，返回剩余部分
fn strip_export(line: &str) -> &str {
    let mut rest = line;
    loop {
        let t = rest.trim_start();
        if t.starts_with("export ") {
            rest = &t["export ".len()..];
        } else if t.starts_with("default ") {
            rest = &t["default ".len()..];
        } else {
            return t;
        }
    }
}

/// 去掉行首的关键字（class/function/interface 等），返回后面的部分
fn strip_keyword<'a>(line: &'a str, kw: &str) -> Option<&'a str> {
    let t = line.trim_start();
    let prefix = format!("{} ", kw);
    if t.starts_with(&prefix) {
        return Some(&t[prefix.len()..]);
    }
    if t == kw {
        return Some("");
    }
    None
}

fn first_word(s: &str) -> &str {
    // 含 `;`：防御某些声明行尾残留分号（如 `struct Foo;` / 旧解析器遗留），避免符号名变成 `Foo;` 污染画像与跳转 key。
    s.trim()
        .split(|c: char| {
            c.is_whitespace()
                || c == '{'
                || c == '('
                || c == '<'
                || c == ':'
                || c == '='
                || c == ';'
        })
        .next()
        .unwrap_or("")
}

fn extract_modifiers(line: &str) -> String {
    let mut mods: Vec<&str> = Vec::new();
    for m in [
        "export",
        "default",
        "abstract",
        "async",
        "pub",
        "private",
        "public",
        "protected",
        "static",
        "readonly",
    ] {
        if line.contains(m) && !mods.contains(&m) {
            mods.push(m);
        }
    }
    mods.join(" ")
}

// ─── Python ───

pub fn extract_python_symbols(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    // v2.3 方法级符号：class 声明行的缩进 → 该缩进级别之内的 def 记为方法。
    let mut class_indent: Option<usize> = None;
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let indent = raw_line.chars().take_while(|c| *c == ' ').count();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // class 上下文结束：遇到缩进 <= class 缩进的非 class/def 顶层语句
        if let Some(ci) = class_indent {
            if indent <= ci && !line.starts_with("class") && !line.starts_with("def") {
                class_indent = None;
            }
        }
        // class X:
        if let Some(rest) = strip_keyword(line, "class") {
            let name = rest
                .split(['(', ':', '{'])
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            out.push(SymbolCandidate {
                name,
                kind: "class".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: String::new(),
            });
            class_indent = Some(indent);
            continue;
        }
        // def x( —— 类体内（缩进 > class 缩进）记方法
        if let Some(rest) = strip_keyword(line, "def") {
            let name = first_word(rest).to_string();
            let is_method = class_indent.map(|ci| indent > ci).unwrap_or(false);
            out.push(SymbolCandidate {
                name,
                kind: if is_method {
                    "method".to_string()
                } else {
                    "function".to_string()
                },
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: String::new(),
            });
            continue;
        }
        // async def x(
        if let Some(rest) = strip_keyword(line, "async") {
            if let Some(r2) = strip_keyword(rest, "def") {
                let name = first_word(r2).to_string();
                out.push(SymbolCandidate {
                    name,
                    kind: "function".to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: "async".to_string(),
                });
            }
        }
    }
    out
}

// ─── Rust ───

pub fn extract_rust_symbols(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    // v2.3 方法级符号：impl 块内的 fn 记为 method（impl 块是顶层块，
    // 结束判定 = 顶层 `}` 行；方法体 `}` 有缩进，不会误关）。
    let mut in_impl = false;
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let top_level_close =
            line == "}" && !raw_line.starts_with(' ') && !raw_line.starts_with('\t');
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        if in_impl && top_level_close {
            in_impl = false;
            continue;
        }
        // 先剥掉可见性前缀：pub / pub(crate) / pub(super) / pub(in path)
        //
        // 为什么不能只靠 `strip_keyword(rest, "pub")`（本轮实测修掉的真 bug）：
        // `strip_keyword` 只认 `"pub "`（带空格）或整行恰为 `"pub"`，而 `pub(crate) fn foo()`
        // 紧跟的字符是 `(` —— 两个分支都失配返回 None，`rest` 原样留着 `pub(crate) fn ...`，
        // 后面的关键字循环再拿 `fn` 去 strip 又必然失配，于是**整条声明被静默丢弃**；
        // 原先 `if after.starts_with('(')` 的分支因此永远进不去（死代码）。
        //
        // 规模（实测，非估算）：tokio-1.53.1 全仓 6821 条顶层声明中 1449 条（21.2%）是
        // `pub(...)` 受限可见（fn 992 / struct 236 / mod 115 / const 40 / enum 35 / trait 15 …），
        // 全部不进符号表 ⇒ 符号画像、引用计数徽标、双击跳转、AI 符号上下文一并看不见。
        // 对标 joern：`RubyAstCreator` / `JavaScriptAstCreator` 等 frontend 建 METHOD/TYPE_DECL
        // 节点时可见性只是节点属性（modifier），从不作为「是否建节点」的门禁 —— 受限可见
        // 依然是一等符号。我们此前等价于「非完全公开就不存在」，语义上是错的。
        let mut mods = String::new();
        let mut rest = line;
        if let Some(after) = rest.strip_prefix("pub(") {
            mods.push_str("pub ");
            match after.find(')') {
                // 括号内可能是 crate / super / in a::b，对符号名无影响，整段跳过即可
                Some(close) => rest = after[close + 1..].trim_start(),
                // 可见性括号跨行（极少见）：本行拿不到声明名，跳过而不是产出错名
                None => continue,
            }
        } else if let Some(after) = strip_keyword(rest, "pub") {
            mods.push_str("pub ");
            rest = after;
        }
        // 再剥掉 item 关键字**之前**的修饰符：async / unsafe / extern "C" / default / const fn。
        //
        // 不剥的后果（本轮实测的第二个整批丢弃）：`pub async fn run()` 剥掉 `pub` 后
        // rest = `async fn run()`，关键字循环拿 `fn` 去 `strip_keyword` 必然失配
        // （rest 以 `async` 开头）⇒ 整条声明丢弃。tokio-1.53.1 实测 8029 条声明里
        // **1208 条（15.0%）** 被修饰符前缀挡住，其中 1205 条是 `fn`
        // （`async fn` / `unsafe fn` / `extern "C" fn`）—— 对 async 为主的现代 Rust
        // 代码库，等于函数级符号大面积不存在。
        //
        // 顺带修好 `unsafe impl` / `default impl`：以前这类 impl 块进不了 `in_impl`，
        // 块内方法会被误记为顶层 `function` 而不是 `method`。
        loop {
            let mut advanced = false;
            for m in ["default", "async", "unsafe"] {
                if let Some(after) = strip_keyword(rest, m) {
                    mods.push_str(m);
                    mods.push(' ');
                    rest = after.trim_start();
                    advanced = true;
                }
            }
            if let Some(after) = strip_keyword(rest, "extern") {
                // `extern "C" fn` / `extern fn`（`extern crate x;` 剥完没有 item 关键字，自然不产符号）
                let a = after.trim_start();
                let a = match a
                    .strip_prefix('"')
                    .and_then(|q| q.find('"').map(|e| &q[e + 1..]))
                {
                    Some(tail) => tail.trim_start(),
                    None => a,
                };
                mods.push_str("extern ");
                rest = a;
                advanced = true;
            }
            // `const` 有二义：`const fn` 里是修饰符，`const NAME: T = ..` 里是 item 关键字。
            // 只有确认后面接得上 fn（或 unsafe/extern 再接 fn）才剥，否则会把常量符号弄丢。
            if let Some(after) = strip_keyword(rest, "const") {
                let a = after.trim_start();
                if strip_keyword(a, "fn").is_some()
                    || strip_keyword(a, "unsafe").is_some()
                    || strip_keyword(a, "extern").is_some()
                {
                    mods.push_str("const ");
                    rest = a;
                    advanced = true;
                }
            }
            if !advanced {
                break;
            }
        }
        // impl 块开始（impl Foo { / impl Trait for Foo { / impl<T> Foo<T> {，
        // 换行大括号的 `impl Foo` 行也进入；结束由顶层 `}` 行统一处理）
        if strip_keyword(rest, "impl").is_some() {
            in_impl = true;
        }
        for (kw, kind) in [
            ("struct", "struct"),
            ("enum", "enum"),
            ("trait", "trait"),
            ("fn", "function"),
            ("mod", "module"),
            ("type", "type_alias"),
            ("const", "const"),
            ("static", "const"),
            ("union", "struct"),
        ] {
            if let Some(after) = strip_keyword(rest, kw) {
                let name = first_word(after).to_string();
                // impl 块内的 fn → 方法（方法级符号 v2.3）
                let final_kind = if kw == "fn" && in_impl {
                    "method"
                } else {
                    kind
                };
                out.push(SymbolCandidate {
                    name,
                    kind: final_kind.to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: mods.trim().to_string(),
                });
                break;
            }
        }
    }
    out
}

// ─── Go ───

pub fn extract_go_symbols(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        // func (r *Receiver) Name( ... 或 func Name(
        if let Some(rest) = strip_keyword(line, "func") {
            let rest = rest.trim();
            let name = if rest.starts_with('(') {
                // 方法：跳过接收者
                if let Some(close) = rest.find(')') {
                    first_word(&rest[close + 1..])
                } else {
                    ""
                }
            } else {
                first_word(rest)
            };
            if !name.is_empty() {
                // v2.3 方法级符号：带接收者 = 方法
                let kind = if rest.starts_with('(') {
                    "method"
                } else {
                    "function"
                };
                out.push(SymbolCandidate {
                    name: name.to_string(),
                    kind: kind.to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: String::new(),
                });
            }
            continue;
        }
        // type X struct / interface
        if let Some(rest) = strip_keyword(line, "type") {
            let name = first_word(rest).to_string();
            let kind = if rest.contains("interface") {
                "interface"
            } else {
                "struct"
            };
            out.push(SymbolCandidate {
                name,
                kind: kind.to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: String::new(),
            });
        }
    }
    out
}

// ─── Java / Kotlin ───

pub fn extract_java_symbols(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    // v2.3 方法级符号：class/interface 声明后进入 body 上下文（顶层 } 行结束）。
    let mut in_body = false;
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let top_level_close =
            line.starts_with('}') && !raw_line.starts_with(' ') && !raw_line.starts_with('\t');
        if line.is_empty()
            || line.starts_with("//")
            || line.starts_with("/*")
            || line.starts_with('*')
        {
            continue;
        }
        if in_body && top_level_close {
            in_body = false;
            continue;
        }
        // Java 声明带可见性/修饰前缀（public class X / private final class X），
        // 先剥掉再 strip_keyword —— 否则 `public class` 永远匹配不上（既有缺陷）。
        let mut decl = line;
        loop {
            let mut stripped = false;
            for kw in [
                "public ",
                "private ",
                "protected ",
                "abstract ",
                "final ",
                "static ",
                "synchronized ",
                "strictfp ",
            ] {
                if let Some(rest) = decl.strip_prefix(kw) {
                    decl = rest.trim_start();
                    stripped = true;
                }
            }
            if !stripped {
                break;
            }
        }
        let mut matched = false;
        for (kw, kind) in [
            ("class", "class"),
            ("interface", "interface"),
            ("enum", "enum"),
        ] {
            // 避免匹配到 "classpath" 等
            if let Some(rest) = strip_keyword(decl, kw) {
                if rest.starts_with('=') || rest.starts_with('(') {
                    continue;
                }
                let name = first_word(rest).to_string();
                out.push(SymbolCandidate {
                    name,
                    kind: kind.to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: extract_modifiers(line),
                });
                if kw != "enum" {
                    in_body = true;
                }
                matched = true;
                break;
            }
        }
        // 类方法（v2.3）：类体内行尾 `{` 的方法签名（声明行已 matched，跳过）
        if !matched && in_body {
            if let Some(method_name) = java_method_name(line) {
                out.push(SymbolCandidate {
                    name: method_name,
                    kind: "method".to_string(),
                    line: i + 1,
                    signature: raw_line.trim().to_string(),
                    modifiers: extract_modifiers(line),
                });
            }
        }
    }
    out
}

// ─── C / C++ / C# / PHP ───

/// 逐行正则版（class / struct / interface），服务 C#・PHP（无 AST 符号抽取）。
///
/// **不要**把它当成 C/C++ 的实现：它不认函数，而函数恰恰是 C 项目的主体
/// （实测 libredwg/src 291 个文件只抽出 34 个符号，全是 struct/typedef）。
/// C/C++ 走下方的 [`extract_c_like_symbols_ast`]；本函数仅作为 AST 解析失败时的兜底补集。
pub fn extract_c_like_symbols(content: &str) -> Vec<SymbolCandidate> {
    let mut out = Vec::new();
    for (i, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with("//")
            || line.starts_with("/*")
            || line.starts_with('*')
            || line.starts_with('#')
        {
            continue;
        }
        if let Some(rest) = strip_keyword(line, "class") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "class".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            continue;
        }
        if let Some(rest) = strip_keyword(line, "struct") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "struct".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            continue;
        }
        if let Some(rest) = strip_keyword(line, "interface") {
            let name = first_word(rest).to_string();
            out.push(SymbolCandidate {
                name,
                kind: "interface".to_string(),
                line: i + 1,
                signature: raw_line.trim().to_string(),
                modifiers: extract_modifiers(line),
            });
            continue;
        }
    }
    out
}

// ─── C / C++：tree-sitter AST 符号抽取 ─────────────────────────────────────
//
// # 为什么必须换掉逐行正则
//
// 旧实现（`extract_c_like_symbols`）只认行首 `class` / `struct` / `interface`，
// **完全不认函数**。而函数的量级在 C 里是压倒性的——实测 libredwg/src（291 文件、
// 27 个 .c）旧实现总共只抽出 **34 个符号**，代码结构树、调用图、死代码、符号级引用
// 四张图在 C 项目上因此接近空白。
//
// # 对标 joern
//
// - `c2cpg/astcreation/AstForFunctionsCreator.scala` + `passes/FunctionDeclNodePass.scala`：
//   每个函数**定义**建 METHOD 节点，每个 struct/union/enum/class 建 TYPE_DECL 节点；
//   `MethodInfo.signature` = `参数类型列表`，`fullName` = `name:signature`。
// - `passes/TypeDeclNodePass.scala`：`typedef struct {..} Foo;` 的匿名结构体以
//   **别名 `Foo`** 建 TYPE_DECL —— 这是 C 声明结构体的主流写法，不处理就整片丢失。
//
// # 刻意不做（有据可查的取舍，不是漏）
//
// - **不产出原型（无函数体的 `declaration`）**。joern 由 CDT 做绑定解析，调用点直接
//   绑到头文件里的声明，所以它的 `FunctionDeclNodePass.stubMethods` 必须建桩。我们
//   没有绑定解析，靠**全局名**做跨文件消歧：一个函数在 `.h` 与 `.c` 各产一个符号
//   ⇒ 同名候选 2 个 ⇒ 解析层按「歧义即丢弃」直接把这条调用边扔掉。等于为了补齐
//   .h 的符号表，把 `.c` 的调用边赔进去，净收益为负。故只收定义。
// - **不收宏**（`preproc_function_def`）。宏由 joern `MacroHandler` 展开处理，我们无
//   预处理阶段，收进来只会产出跳转不到的假符号。
//
// 以上两条换来的是：每个函数定义有且仅有一个符号，跨文件按名消歧不会被自己拆台。

/// 记录型声明（`struct` / `class` / `union` / `enum`）→ 符号种类。
fn c_record_kind(node_kind: &str) -> Option<&'static str> {
    match node_kind {
        "struct_specifier" => Some("struct"),
        "class_specifier" => Some("class"),
        "union_specifier" => Some("union"),
        "enum_specifier" => Some("enum"),
        _ => None,
    }
}

/// 从声明符中剥出名字。
///
/// C 的声明符是层层包装的：`*(*fn)(int)` = pointer_declarator → parenthesized_
/// declarator → pointer_declarator → identifier。返回 `(名字, 是否带作用域限定)`；
/// 带限定（`Foo::bar` / `~Foo` / `operator+`）一律视为**成员**。
fn c_decl_name(node: Node, src: &[u8]) -> Option<(String, bool)> {
    match node.kind() {
        // 属性说明符不是名字，跳过（C 的 attributed_declarator 无具名字段，
        // 只能靠子节点遍历，不挡住它会把 `__attribute__` 当成符号名）
        "attribute_specifier" | "attribute_declaration" | "attribute" => None,
        "identifier" | "field_identifier" | "type_identifier" => {
            let t = node.utf8_text(src).ok()?.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some((t, false))
            }
        }
        // 构造/析构/运算符重载：整体作名，保证唯一且可跳转
        "destructor_name" | "operator_name" | "operator_cast" => {
            let t = node.utf8_text(src).ok()?.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some((t, true))
            }
        }
        // `Foo::bar` → 取 `name` 字段（末段），并标记成员
        "qualified_identifier" => {
            let seg = node.child_by_field_name("name").or_else(|| {
                let mut cur = node.walk();
                node.named_children(&mut cur).last()
            })?;
            c_decl_name(seg, src).map(|(n, _)| (n, true))
        }
        _ => {
            // 先走具名字段（pointer/array/reference/function_declarator 都有）
            if let Some(d) = node.child_by_field_name("declarator") {
                return c_decl_name(d, src);
            }
            // parenthesized_declarator / attributed_declarator 无具名字段：取首个具名子节点
            let mut cur = node.walk();
            for c in node.children(&mut cur) {
                if c.is_named() {
                    if let Some(r) = c_decl_name(c, src) {
                        return Some(r);
                    }
                }
            }
            None
        }
    }
}

/// 取声明的签名文本：从节点起点到**函数体/结构体体的左括号**为止，折叠空白。
///
/// 为什么要折叠：C 的返回类型与函数名常跨行（`static int\nfoo(void)`），
/// 只取首行会得到 `static int` 这种毫无信息量的签名。
fn c_signature(node: Node, src: &[u8]) -> String {
    let start = node.start_byte();
    let mut end = node.end_byte();
    if let Some(body) = node.child_by_field_name("body") {
        end = end.min(body.start_byte());
    } else {
        // 无 body（如 typedef）：截到第一个 `{`
        let text = node.utf8_text(src).unwrap_or("");
        if let Some(i) = text.find('{') {
            end = end.min(start + i);
        }
    }
    if end <= start {
        end = node.end_byte();
    }
    let raw = String::from_utf8_lossy(&src[start..end]);
    let collapsed: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let collapsed = collapsed.trim_end_matches(';').trim().to_string();
    if collapsed.chars().count() > 200 {
        collapsed.chars().take(197).collect::<String>() + "..."
    } else {
        collapsed
    }
}

/// C/C++ 修饰符：从签名文本里认。
///
/// 与 TS/Java 共用 [`extract_modifiers`] 会漏掉 `inline` / `extern` / `virtual` /
/// `constexpr`，且它的 `pub` / `export` 判定对 C 无意义，故单独实现。
///
/// **「非 static 自由函数带 export」是有意的设计**：C 里不带 `static` 的函数默认
/// **外部链接**，语义上等同于其它语言的「导出」。死代码判定 `dead_code::is_exported`
/// 认 `export`，于是公共 API 函数落 medium（「若非对外 API 可考虑收敛」）而不是
/// high（「孤立代码，可删」）——C 库大量函数由项目外消费者调用，判 high 是系统性误报。
fn c_modifiers(signature: &str, is_static: bool) -> String {
    let mut mods: Vec<&str> = Vec::new();
    let low = signature.to_ascii_lowercase();
    for m in [
        "static",
        "inline",
        "extern",
        "virtual",
        "constexpr",
        "public",
        "private",
        "protected",
    ] {
        // 整词匹配：`externally` 不该命中 `extern`
        let hit = low
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .any(|w| w == m);
        if hit {
            mods.push(m);
        }
    }
    if !is_static && !mods.contains(&"export") {
        mods.push("export");
    }
    mods.join(" ")
}

/// C / C++ 符号抽取（tree-sitter AST 版）。
///
/// 返回 `None` = 方言非 C/C++ 或 parser 初始化失败；`bool` = 根节点 `has_error`。
pub fn extract_c_like_symbols_ast(
    dialect: Dialect,
    content: &str,
) -> Option<(Vec<SymbolCandidate>, bool)> {
    if !matches!(dialect, Dialect::C | Dialect::Cpp) {
        return None;
    }
    let mut parser = Parser::new();
    if parser.set_language(&dialect.language()).is_err() {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let mut out: Vec<SymbolCandidate> = Vec::new();
    // (节点, 是否处于 class/struct/union 体内) —— 体内函数定义 = method
    let mut stack: Vec<(Node, bool)> = vec![(tree.root_node(), false)];

    let push_sym = |out: &mut Vec<SymbolCandidate>,
                    name: String,
                    kind: &str,
                    line: usize,
                    signature: String,
                    modifiers: String| {
        if name.is_empty() {
            return;
        }
        out.push(SymbolCandidate {
            name,
            kind: kind.to_string(),
            line,
            signature,
            modifiers,
        });
    };

    while let Some((n, in_class)) = stack.pop() {
        match n.kind() {
            // 函数定义：C 项目的主体符号。不下钻函数体（局部类/嵌套定义不建模）。
            "function_definition" => {
                if let Some(decl) = n.child_by_field_name("declarator") {
                    if let Some((name, qualified)) = c_decl_name(decl, src) {
                        let sig = c_signature(n, src);
                        let kind = if qualified || in_class {
                            "method"
                        } else {
                            "function"
                        };
                        let is_static = sig
                            .split(|c: char| !c.is_alphanumeric() && c != '_')
                            .any(|w| w == "static");
                        let mods = c_modifiers(&sig, is_static);
                        push_sym(&mut out, name, kind, n.start_position().row + 1, sig, mods);
                    }
                }
            }
            // 记录型声明：必须有 body 才收，跳过前向声明（`struct Foo;`）
            k @ ("struct_specifier" | "class_specifier" | "union_specifier" | "enum_specifier") => {
                if let Some(kind) = c_record_kind(k) {
                    if n.child_by_field_name("body").is_some() {
                        if let Some(name_node) = n.child_by_field_name("name") {
                            let name = name_node.utf8_text(src).unwrap_or("").trim().to_string();
                            let line = n.start_position().row + 1;
                            let sig = c_signature(n, src);
                            push_sym(&mut out, name, kind, line, sig, String::new());
                        }
                    }
                    // 体内可能有内联成员函数 / 嵌套记录
                    if let Some(body) = n.child_by_field_name("body") {
                        stack.push((body, true));
                    }
                }
            }
            "namespace_definition" => {
                if let Some(name_node) = n.child_by_field_name("name") {
                    let name = name_node.utf8_text(src).unwrap_or("").trim().to_string();
                    let line = n.start_position().row + 1;
                    let sig = c_signature(n, src);
                    push_sym(&mut out, name, "namespace", line, sig, String::new());
                }
                if let Some(body) = n.child_by_field_name("body") {
                    stack.push((body, false));
                }
            }
            // `typedef struct {..} Foo;` —— C 声明结构体的主流写法，不处理就整片丢失
            "type_definition" => {
                let spec = n.child_by_field_name("type");
                let alias = n
                    .child_by_field_name("declarator")
                    .and_then(|d| c_decl_name(d, src))
                    .map(|(nm, _)| nm)
                    .filter(|s| !s.is_empty());
                let spec_kind = spec.and_then(|s| c_record_kind(s.kind()));
                let spec_named = spec
                    .and_then(|s| s.child_by_field_name("name"))
                    .and_then(|nm| nm.utf8_text(src).ok())
                    .map(|t| t.trim().to_string())
                    .filter(|s| !s.is_empty());
                let line = n.start_position().row + 1;
                let sig = c_signature(n, src);
                // 匿名记录 + 别名：`typedef struct {..} Foo;` → **记录名就是别名**
                if spec_kind.is_some() && spec_named.is_none() {
                    if let Some(a) = alias {
                        push_sym(
                            &mut out,
                            a,
                            spec_kind.unwrap_or("struct"),
                            line,
                            sig,
                            String::new(),
                        );
                    }
                    // 匿名体内仍可能嵌套具名记录，下钻（但不再收匿名体本身）
                    if let Some(body) = spec.and_then(|s| s.child_by_field_name("body")) {
                        stack.push((body, true));
                    }
                } else {
                    // 具名记录：交给上面的记录分支正常处理（会收 `_dwg_object`）
                    if let Some(s) = spec {
                        if spec_kind.is_some() && s.child_by_field_name("body").is_some() {
                            stack.push((s, in_class));
                        }
                    }
                    // 别名：`typedef struct _dwg_object Dwg_Object;` / `typedef int Foo;`
                    if let Some(a) = alias {
                        push_sym(&mut out, a, "type_alias", line, sig, String::new());
                    }
                }
            }
            // 其余节点（translation_unit / declaration / template_declaration /
            // linkage_specification / preproc_* 等）原样下钻
            _ => {
                let mut cur = n.walk();
                let children: Vec<Node> = n.children(&mut cur).collect();
                for c in children.into_iter().rev() {
                    stack.push((c, in_class));
                }
            }
        }
    }

    // 消费方按「下一个符号行 - 1」算 line_end（`symbol_end_line`），**必须按行有序**；
    // AST 遍历是深度优先，typedef 的别名可能先于记录体产出，故末尾统一排序。
    out.sort_by(|a, b| a.line.cmp(&b.line).then(a.name.cmp(&b.name)));
    out.dedup_by(|a, b| a.line == b.line && a.name == b.name && a.kind == b.kind);
    Some((out, tree.root_node().has_error()))
}

/// C/C++ 符号抽取：优先 AST；解析有错时与逐行正则取**并集**（只增不减）。
///
/// 与 `parser::symbol_imports_ast::extract_symbol_imports_with_fallback` 同一形态：
/// tree-sitter 遇到预处理密集的 C 代码常报 error，此时正则补集能救回一部分
/// 大括号换行风格不一致的声明。
pub fn extract_c_like_symbols_with_fallback(
    dialect: Dialect,
    content: &str,
) -> Vec<SymbolCandidate> {
    let Some((ast, has_error)) = extract_c_like_symbols_ast(dialect, content) else {
        return extract_c_like_symbols(content);
    };
    if !has_error {
        return ast;
    }
    let mut out = ast;
    let seen: HashSet<(String, usize, String)> = out
        .iter()
        .map(|s| (s.name.clone(), s.line, s.kind.clone()))
        .collect();
    for s in extract_c_like_symbols(content) {
        if !seen.contains(&(s.name.clone(), s.line, s.kind.clone())) {
            out.push(s);
        }
    }
    out.sort_by(|a, b| a.line.cmp(&b.line).then(a.name.cmp(&b.name)));
    out
}

// ─── 设计模式检测 ───
//
// 检测逻辑已整体迁移到 `commands::design_patterns`（证据加权打分引擎）。
// 迁移原因见该模块头注释：旧的裸子串匹配在本项目上实测「建造者模式 100% 误报」
// （50 个文件含 `return this`，含 `return this;` 的是 0 个），
// 且类体取的是定长 400 行窗口会越过类边界。这里只保留薄封装。

use crate::commands::design_patterns::{self, DetectedPattern};

/// 对一个符号检测设计模式，返回带置信度的命中列表
///
/// `lines` 为整个文件按行切分的结果，`decl_idx` 为符号声明行下标（0-based）。
/// 类体由 [`design_patterns::extract_body`] 按语言语法真实切出，不再使用定长窗口。
fn detect_patterns(
    lang: &str,
    symbol: &SymbolCandidate,
    lines: &[&str],
    decl_idx: usize,
) -> Vec<DetectedPattern> {
    let body = design_patterns::extract_body(lang, lines, decl_idx, 600);
    design_patterns::detect(lang, &symbol.name, &symbol.kind, &body)
}

/// 计算符号的结束行（下一个符号前 / 文件尾）
fn symbol_end_line(symbols: &[SymbolCandidate], idx: usize, file_lines: usize) -> usize {
    if idx + 1 < symbols.len() {
        symbols[idx + 1].line.saturating_sub(1)
    } else {
        file_lines
    }
}

/// 抓取符号声明上方紧贴的文档注释，写入 `ProjectSymbol.doc`。
///
/// 支持：
/// - TS/JS：JSDoc 块 `/** ... */`（可多行，必须紧贴声明上方，遇空行/非注释即止）
/// - Rust：`///` 连续行 或 `/** ... */` 块
///
/// 返回去 `*` 前缀、合并多行后的纯文本（上限 2000 字符）；无文档注释返回 None。
/// 这是 docsCoverage 画像「是否文档化」判定的数据来源——此前 `doc` 恒为 None，
/// 导致画像伪造 100% 未文档化；填充后该画像恢复真实分析。
fn extract_doc_comment(lang: &str, lines: &[&str], decl_idx: usize) -> Option<String> {
    let lower = lang.to_ascii_lowercase();
    let is_ts_js = matches!(
        lower.as_str(),
        "ts" | "tsx" | "js" | "jsx" | "javascript" | "typescript"
    );
    let is_rust = lower == "rust" || lower == "rs";
    let is_python = matches!(lower.as_str(), "py" | "python");
    if !is_ts_js && !is_rust && !is_python {
        return None;
    }
    // TS/JS/Rust 文档注释位于声明上方，首行声明不可能有上方注释；
    // Python docstring 位于声明下方，故首行声明仍可能有文档字符串。
    if decl_idx == 0 && !is_python {
        return None;
    }

    // ---- Rust：`///` 行（可能多行）或 `/** */` 块 ----
    if is_rust {
        let mut collected: Vec<String> = Vec::new();
        let mut i = decl_idx;
        while i > 0 {
            let prev = lines[i - 1].trim();
            if prev.is_empty() {
                if collected.is_empty() {
                    break;
                }
                i -= 1;
                continue;
            }
            if let Some(rest) = prev.strip_prefix("///") {
                if rest.starts_with('/') {
                    break; // `////` 及以上是普通注释，非文档
                }
                collected.push(rest.trim().to_string());
                i -= 1;
                continue;
            }
            if prev.starts_with("/**") && prev.ends_with("*/") {
                let inner = prev
                    .strip_prefix("/**")
                    .unwrap_or(prev)
                    .strip_suffix("*/")
                    .unwrap_or(prev)
                    .trim()
                    .to_string();
                if !inner.is_empty() {
                    collected.push(inner);
                }
                break;
            }
            break;
        }
        if !collected.is_empty() {
            collected.reverse();
            let text = collected.join("\n").trim().to_string();
            if !text.is_empty() {
                return Some(text.chars().take(2000).collect());
            }
        }
        return None;
    }

    // ---- Python：紧贴声明下方的 docstring（`"""..."""` / `'''...'''`）----
    // Python 文档字符串是 def/class 体内首条语句，位于声明行正下方（decl_idx+1）。
    if is_python {
        if decl_idx + 1 >= lines.len() {
            return None;
        }
        let first = lines[decl_idx + 1].trim();
        let quote = if first.starts_with("\"\"\"") {
            "\"\"\""
        } else if first.starts_with("'''") {
            "'''"
        } else {
            return None;
        };
        // 单行：同一语句内闭合
        if let Some(inner) = first
            .strip_prefix(quote)
            .and_then(|s| s.strip_suffix(quote))
        {
            let text = inner.trim().to_string();
            if !text.is_empty() {
                return Some(text.chars().take(2000).collect());
            }
            return None;
        }
        // 多行：收集后续行直到闭合引号
        let mut collected: Vec<String> = Vec::new();
        if let Some(rest) = first.strip_prefix(quote) {
            if !rest.trim().is_empty() {
                collected.push(rest.trim().to_string());
            }
        }
        let mut k = decl_idx + 2;
        while k < lines.len() {
            let bl = lines[k].trim();
            if let Some(content) = bl.strip_suffix(quote) {
                let c = content.trim().to_string();
                if !c.is_empty() {
                    collected.push(c);
                }
                break;
            }
            collected.push(bl.to_string());
            k += 1;
        }
        if !collected.is_empty() {
            let text = collected.join("\n").trim().to_string();
            if !text.is_empty() {
                return Some(text.chars().take(2000).collect());
            }
        }
        return None;
    }

    // ---- TS/JS：JSDoc 块 `/** ... */` ----
    // 从声明行上方向上收集，直到遇到起始的 `/**`
    let mut block: Vec<String> = Vec::new();
    let mut closed = false;
    let mut j = decl_idx;
    while j > 0 {
        let bl = lines[j - 1].trim();
        if bl.starts_with("/**") {
            let start = bl
                .strip_prefix("/**")
                .unwrap_or(bl)
                .strip_suffix("*/")
                .unwrap_or(bl)
                .trim()
                .to_string();
            if !start.is_empty() {
                block.push(start);
            }
            closed = true;
            break;
        } else if bl.starts_with("*") {
            let s = bl
                .strip_prefix('*')
                .unwrap_or(bl)
                .strip_suffix("*/")
                .unwrap_or(bl)
                .trim()
                .to_string();
            if !s.is_empty() {
                block.push(s);
            }
        } else if bl.starts_with("/*") {
            // 普通块注释，非文档
            break;
        } else {
            // 空行或非注释：JSDoc 必须紧贴声明，遇非注释即止
            break;
        }
        j -= 1;
    }
    if closed {
        block.reverse();
        let text = block.join("\n").trim().to_string();
        if !text.is_empty() {
            return Some(text.chars().take(2000).collect());
        }
    }
    None
}

/// 单文件结构分析（符号提取 + 设计模式检测），供 `analyze_code_structure` 并行调用。
///
/// 纯计算、无 DB 依赖：读文件 → 提取符号 → 检测模式，返回
/// `(符号列表, 模式命中, 是否包含符号)`。并行区内每个任务独立拥有一份结果，
/// 由调用方在并行区外串行合并后批量写入。
fn analyze_file_structure(
    analysis_id: &str,
    file: &ProjectFile,
    cache: &crate::commands::project_scan::ScanContentCache,
) -> (Vec<ProjectSymbol>, Vec<PatternHit>, bool) {
    let lang = match file.language.as_deref() {
        Some(l) => l,
        None => return (Vec::new(), Vec::new(), false),
    };
    let Some(content) = cache.read(file) else {
        return (Vec::new(), Vec::new(), false);
    };
    let candidates = extract_symbols(lang, &content);
    if candidates.is_empty() {
        return (Vec::new(), Vec::new(), false);
    }
    let file_lines = content.lines().count();
    let lines: Vec<&str> = content.lines().collect();
    let now = chrono::Utc::now().timestamp();

    let mut syms = Vec::new();
    let mut hits = Vec::new();
    // 同名符号在文件内可能重复（重载/同名 const 与 function），用出现序号消歧，
    // 保证 symbol id 在同一文件、同一扫描内唯一且跨重扫稳定。
    let mut name_ordinal: HashMap<String, usize> = HashMap::new();
    for (idx, cand) in candidates.iter().enumerate() {
        let end_line = symbol_end_line(&candidates, idx, file_lines);
        let decl_idx = cand.line.saturating_sub(1);
        let doc = extract_doc_comment(lang, &lines, decl_idx);
        let detected = detect_patterns(lang, cand, &lines, decl_idx);

        // 生成设计模式命中记录（evidence 直接用引擎给出的证据清单，不再是空话）
        for p in &detected {
            hits.push(PatternHit {
                pattern: p.id.clone(),
                name: design_patterns::pattern_label(&p.id),
                symbol_name: cand.name.clone(),
                file_path: file.rel_path.clone(),
                line: cand.line as i64,
                evidence: if p.signals.is_empty() {
                    format!("{} 在 {}:{}", cand.name, file.rel_path, cand.line)
                } else {
                    p.signals.join("；")
                },
                confidence: p.confidence,
                signals: p.signals.clone(),
                category: p.category.as_str().to_string(),
            });
        }

        // patterns 列保持「id 字符串数组」格式不变（前端 reportGenerator / ComponentCenterPanel 已依赖），
        // 置信度等新字段放进 metadata，避免破坏既有解析。
        let pattern_ids: Vec<String> = detected.iter().map(|p| p.id.clone()).collect();
        let pattern_detail = serde_json::json!(detected
            .iter()
            .map(|p| serde_json::json!({
                "id": p.id,
                "confidence": (p.confidence * 100.0).round() / 100.0,
                "category": p.category.as_str(),
                "signals": p.signals,
            }))
            .collect::<Vec<_>>());

        // 确定性 symbol id：sym_{analysis_id}_{rel_path}_{name}_{ordinal}
        // 跨重扫稳定（同一文件、同一符号名→同一 id），是符号耦合阶段做增量、
        // 安全携带引用/调用边的必要前提。rel_path 用原值（SQLite 可存任意字符串）。
        let ordinal = name_ordinal.get(&cand.name).copied().unwrap_or(0);
        name_ordinal.insert(cand.name.clone(), ordinal + 1);
        let sym_id = format!(
            "sym_{}_{}_{}_{}",
            analysis_id, file.rel_path, cand.name, ordinal
        );

        syms.push(ProjectSymbol {
            id: sym_id,
            analysis_id: analysis_id.to_string(),
            file_id: file.id.clone(),
            file_path: file.rel_path.clone(),
            name: cand.name.clone(),
            kind: cand.kind.clone(),
            line_start: cand.line as i64,
            line_end: end_line as i64,
            signature: cand.signature.clone(),
            doc,
            modifiers: cand.modifiers.clone(),
            patterns: serde_json::to_string(&pattern_ids).unwrap_or_else(|_| "[]".to_string()),
            metadata: serde_json::json!({
                "language": lang,
                "patternDetail": pattern_detail,
            })
            .to_string(),
            created_at: now,
        });
    }
    (syms, hits, true)
}

/// 主命令：分析代码结构，写入 project_symbols，返回摘要
#[tauri::command(async)]
pub fn analyze_code_structure(
    analysis_id: String,
    app: AppHandle,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
    cancel: State<'_, crate::commands::project_scan::AnalysisCancelState>,
    changed_rel_paths: Option<Vec<String>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<StructureSummary> {
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let incremental = changed_rel_paths.is_some();
    // 增量仅重算变更/新增文件的符号，携带未变文件的旧符号（见下方 file_id 重映射）。
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
    let process_files: Vec<&ProjectFile> = files
        .iter()
        .filter(|f| !f.is_directory && (!incremental || changed.contains(f.rel_path.as_str())))
        .collect();
    let total = process_files.len() as i64;
    let cancel_state = cancel.inner().clone();

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Structure,
        0,
        0,
        total,
        if incremental {
            "增量分析代码结构…"
        } else {
            "分析代码结构（并行）…"
        },
    );

    // 上一轮符号，用于增量携带。确定性 symbol id（sym_{analysis_id}_{rel_path}_{name}_{ordinal}）
    // 跨重扫稳定，是安全携带的前提；file_id 每次扫描随机，故携带时按 rel_path 重映射到当前 file_id。
    let existing: Vec<ProjectSymbol> = if incremental {
        symbol_repo
            .list_by_analysis(&analysis_id)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let per_file: Vec<(Vec<ProjectSymbol>, Vec<PatternHit>, bool)> = process_files
        .par_iter()
        .filter(|_| !crate::commands::project_scan::analysis_cancelled(&cancel_state, &analysis_id))
        .map(|file| analyze_file_structure(&analysis_id, file, &*cache))
        .collect();
    let mut new_symbols: Vec<ProjectSymbol> = Vec::new();
    for (syms, _hits, _has) in per_file {
        new_symbols.extend(syms);
    }

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Structure,
        100,
        total,
        total,
        "结构分析完成",
    );

    // 合并「携带未变文件符号」+「本轮新解析符号」为全量集合，并清掉变更/删除文件的悬挂符号。
    // rel_path → 当前扫描 file_id 映射：把携带符号的随机 file_id 对齐到本次 files 表，
    // 避免下游 symbol_references / call_graph 按 file_id 分组时新旧 id 错位（跨文件边误连/孤儿）。
    let rel_to_id: HashMap<&str, &str> = files
        .iter()
        .filter(|f| !f.is_directory)
        .map(|f| (f.rel_path.as_str(), f.id.as_str()))
        .collect();
    let all_symbols: Vec<ProjectSymbol> = if incremental {
        let mut carried: Vec<ProjectSymbol> = Vec::new();
        let mut stale: Vec<String> = changed.iter().map(|s| s.to_string()).collect();
        for mut s in existing {
            if !current_rel.contains(s.file_path.as_str()) {
                // 源文件已删除 → 符号整体丢弃，并加入 stale 清理库
                if !stale.contains(&s.file_path) {
                    stale.push(s.file_path.clone());
                }
                continue;
            }
            if changed.contains(s.file_path.as_str()) {
                continue; // 变更/新增文件 → 由 new_symbols 覆盖
            }
            if let Some(&fid) = rel_to_id.get(s.file_path.as_str()) {
                s.file_id = fid.to_string();
            }
            carried.push(s);
        }
        symbol_repo.delete_by_analysis_and_files(&analysis_id, &stale)?;
        if !new_symbols.is_empty() {
            symbol_repo.save_batch(&new_symbols)?;
        }
        let mut all = carried;
        all.extend(new_symbols);
        all
    } else {
        symbol_repo.delete_by_analysis(&analysis_id)?;
        if !new_symbols.is_empty() {
            symbol_repo.save_batch(&new_symbols)?;
        }
        new_symbols
    };

    // 汇总
    let mut by_kind: HashMap<String, i64> = HashMap::new();
    let mut file_id_set: HashSet<&str> = HashSet::new();
    for s in &all_symbols {
        *by_kind.entry(s.kind.clone()).or_insert(0) += 1;
        file_id_set.insert(s.file_id.as_str());
    }
    let patterns = pattern_hits_from_symbols(&all_symbols);

    Ok(StructureSummary {
        total_symbols: all_symbols.len() as i64,
        files_with_symbols: file_id_set.len() as i64,
        by_kind,
        patterns,
    })
}

// pattern_label 已统一到 `design_patterns::pattern_label`（新增了适配器/装饰器/门面/命令/
// 访问者/模板方法等模式的标签），此处不再重复定义，避免两份表各自漂移。

/// 列出分析的所有符号（前端实体面板/画像用）
#[tauri::command(async)]
pub fn list_project_symbols(
    analysis_id: String,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<Vec<ProjectSymbol>> {
    symbol_repo.list_by_analysis(&analysis_id)
}

/// 按类型统计符号数量
#[tauri::command]
pub fn count_symbols_by_kind(
    analysis_id: String,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<std::collections::HashMap<String, i64>> {
    symbol_repo.count_by_kind(&analysis_id)
}

/// 从符号集合统一提取设计模式命中（解析 `patterns` 数组 + `metadata.patternDetail` 详情）。
///
/// 全量与增量路径共用同一逻辑：全量从重新解析的符号提取，增量从「携带符号 + 新解析符号」
/// 提取，保证 `StructureSummary.patterns` 与 `list_design_patterns` 结果一致。
fn pattern_hits_from_symbols(symbols: &[ProjectSymbol]) -> Vec<PatternHit> {
    let mut hits: Vec<PatternHit> = Vec::new();
    for s in symbols {
        if s.patterns.trim().is_empty() || s.patterns == "[]" {
            continue;
        }
        let patterns: Vec<String> = serde_json::from_str(&s.patterns).unwrap_or_default();
        // 先解出 metadata 里的详情，按 id 建索引
        let detail: HashMap<String, serde_json::Value> =
            serde_json::from_str::<serde_json::Value>(&s.metadata)
                .ok()
                .and_then(|v| v.get("patternDetail").cloned())
                .and_then(|v| v.as_array().cloned())
                .map(|arr| {
                    arr.into_iter()
                        .filter_map(|item| {
                            item.get("id")
                                .and_then(|i| i.as_str())
                                .map(|i| (i.to_string(), item.clone()))
                        })
                        .collect()
                })
                .unwrap_or_default();

        for p in patterns {
            let d = detail.get(&p);
            let confidence = d
                .and_then(|v| v.get("confidence"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.5);
            let signals: Vec<String> = d
                .and_then(|v| v.get("signals"))
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let category = d
                .and_then(|v| v.get("category"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let evidence = if signals.is_empty() {
                format!(
                    "{} 于 {}:{}（旧扫描数据，重新扫描可获得判定依据）",
                    s.name, s.file_path, s.line_start
                )
            } else {
                signals.join("；")
            };
            hits.push(PatternHit {
                pattern: p.clone(),
                name: design_patterns::pattern_label(&p),
                symbol_name: s.name.clone(),
                file_path: s.file_path.clone(),
                line: s.line_start,
                evidence,
                confidence,
                signals,
                category,
            });
        }
    }
    // 置信度降序：前端画像/面板默认按可信程度排列
    hits.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits
}

/// 列出设计模式命中（从符号表中读取 patterns 非空者聚合）
///
/// 置信度/证据存在 `metadata.patternDetail` 里（见 `analyze_code_structure`）。
/// 旧数据没有该字段，此时降级为 confidence=0.5 并给出提示 —— 重新扫描即可获得精确分数。
#[tauri::command(async)]
pub fn list_design_patterns(
    analysis_id: String,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<Vec<PatternHit>> {
    let symbols = symbol_repo.list_by_analysis(&analysis_id)?;
    Ok(pattern_hits_from_symbols(&symbols))
}

/// 从符号 `metadata` 取出语言（扫描链写入 `{"language": ...}`）。
fn metadata_language(metadata: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(metadata)
        .ok()
        .and_then(|v| v.get("language").cloned())
        .and_then(|l| l.as_str().map(|s| s.to_string()))
}

/// 把新的 `patternDetail` 合并回既有 metadata（保留 language 等其它字段）。
fn merge_pattern_detail(metadata: &str, detail: &[serde_json::Value]) -> String {
    let mut obj = serde_json::from_str::<serde_json::Value>(metadata)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    obj.insert(
        "patternDetail".to_string(),
        serde_json::Value::Array(detail.to_vec()),
    );
    serde_json::to_string(&obj).unwrap_or_else(|_| "{}".to_string())
}

/// 设计模式「重检测」核心逻辑（与 `analyze_code_structure` 共用同一检测引擎）。
///
/// 旧分析在保守引擎下几乎零命中 → 画像永远「无数据」。全量 `analyze_code_structure`
/// 会重写整张符号表（含稳定 id、引用边），风险高；本函数只读取既有符号 + 源文件，
/// 调用 `design_patterns::detect` 重算，且仅回写 `patterns` / `metadata` 两列，
/// 是「让设计模式画像可用」的最小代价路径——无需整库重扫。
///
/// 源码路径多候选解析：让「重检测」在常见路径错位下也能读到源码。
///
/// 候选顺序：
/// 1. `projectRoot + file_path`（正常扫描链：file_path 相对 projectRoot）
/// 2. `file_path` 本身（部分扫描链直接存绝对路径）
/// 3. `projectRoot` 的父目录 + `file_path`（项目被整体移动、file_path 多/少一层根目录名时）
fn candidate_source_paths(root: &Path, rel_path: &str) -> Vec<PathBuf> {
    let mut v = Vec::with_capacity(3);
    v.push(root.join(rel_path));
    let p = Path::new(rel_path);
    if p.is_absolute() {
        v.push(p.to_path_buf());
    }
    if let Some(parent) = root.parent() {
        v.push(parent.join(rel_path));
    }
    v
}

/// 失败语义：单个文件缺失 / 语言未知 → 跳过该符号，不中断整体。
pub fn redetect_design_patterns_impl(
    symbol_repo: &dyn ProjectSymbolRepository,
    analysis_id: &str,
    project_root: &str,
) -> AppResult<Vec<PatternHit>> {
    let symbols = symbol_repo.list_by_analysis(analysis_id)?;
    if symbols.is_empty() {
        return Ok(Vec::new());
    }

    // 按文件分组：逐文件只读一次源码，同文件多符号共享
    let mut by_file: HashMap<String, Vec<&ProjectSymbol>> = HashMap::new();
    for s in &symbols {
        by_file.entry(s.file_path.clone()).or_default().push(s);
    }

    let root = Path::new(project_root);
    let mut file_cache: HashMap<String, Option<String>> = HashMap::new();
    let mut hits: Vec<PatternHit> = Vec::new();

    let mut read_count: usize = 0;
    for (rel_path, syms) in by_file {
        let content = file_cache.entry(rel_path.clone()).or_insert_with(|| {
            // 多候选路径解析：projectRoot 拼接（正常）、绝对路径（部分扫描链直存绝对路径）、
            // projectRoot 的父目录（项目被整体移动、rel_path 多/少一层根目录名时）。
            // 任一命中即读取，避免「项目搬家后画像永远无数据」。
            for cand in candidate_source_paths(root, &rel_path) {
                if let Ok(c) = std::fs::read_to_string(&cand) {
                    return Some(c);
                }
            }
            None
        });
        let Some(content) = content else { continue };
        read_count += 1;
        let lines: Vec<&str> = content.lines().collect();

        for s in syms {
            let lang = metadata_language(&s.metadata)
                .or_else(|| crate::commands::project_scan::detect_language(Path::new(&rel_path)))
                .unwrap_or_default();
            if lang.is_empty() {
                continue;
            }
            let decl_idx = (s.line_start.max(1) - 1) as usize;
            let body = design_patterns::extract_body(&lang, &lines, decl_idx, 600);
            let detected = design_patterns::detect(&lang, &s.name, &s.kind, &body);

            if detected.is_empty() {
                // 无命中也要清掉陈旧 patterns，避免旧引擎残留误判
                if s.patterns != "[]" {
                    symbol_repo.update_patterns(
                        &s.id,
                        "[]",
                        &merge_pattern_detail(&s.metadata, &[]),
                    )?;
                }
                continue;
            }

            // 与扫描链（analyze_file_structure）完全一致的落库形态
            let pattern_ids: Vec<String> = detected.iter().map(|p| p.id.clone()).collect();
            let pattern_detail = serde_json::json!(detected
                .iter()
                .map(|p| serde_json::json!({
                    "id": p.id,
                    "confidence": (p.confidence * 100.0).round() / 100.0,
                    "category": p.category.as_str(),
                    "signals": p.signals,
                }))
                .collect::<Vec<_>>());
            let patterns_json =
                serde_json::to_string(&pattern_ids).unwrap_or_else(|_| "[]".to_string());
            let metadata_json =
                merge_pattern_detail(&s.metadata, pattern_detail.as_array().unwrap());
            symbol_repo.update_patterns(&s.id, &patterns_json, &metadata_json)?;

            for p in &detected {
                hits.push(PatternHit {
                    pattern: p.id.clone(),
                    name: design_patterns::pattern_label(&p.id),
                    symbol_name: s.name.clone(),
                    file_path: s.file_path.clone(),
                    line: s.line_start,
                    evidence: if p.signals.is_empty() {
                        format!("{} 在 {}:{}", s.name, s.file_path, s.line_start)
                    } else {
                        p.signals.join("；")
                    },
                    confidence: p.confidence,
                    signals: p.signals.clone(),
                    category: p.category.as_str().to_string(),
                });
            }
        }
    }

    // 一个文件都没读到源码：多半是 projectRoot 不对 / 项目被移动 / 源码不在原路径。
    // 与其静默「无数据」让用户误以为功能失效，不如明确报错，引导其校正项目根目录。
    if read_count == 0 {
        return Err(AppError::Domain(format!(
            "在「{}」下未匹配到任何源码文件，无法重新检测设计模式。请确认项目根目录是否正确、源码是否仍在原路径（项目是否被移动）。",
            project_root
        )));
    }

    hits.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(hits)
}

/// 设计模式重检测命令：对既有分析重新跑检测引擎并把结果写回符号表，
/// 让「更多画像 → 设计模式」无需整库重扫即可出数据（见 [`redetect_design_patterns_impl`]）。
#[tauri::command(async)]
pub fn redetect_design_patterns(
    analysis_id: String,
    project_root: String,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<Vec<PatternHit>> {
    redetect_design_patterns_impl(symbol_repo.inner().as_ref(), &analysis_id, &project_root)
}

// ═══════════════════════════════════════════════════════════════════
// 符号级引用分析（代码之间的引用）
// ═══════════════════════════════════════════════════════════════════
//
// 文件级依赖（detect_dependencies）只回答「A 文件 import 了 B 文件」，
// 这里进一步回答「A 文件第 N 行 import 了 B 文件的哪个符号」。
// 产出 project_symbol_refs 表，前端据此：
// - 符号行显示被引用计数 → 架构核心（hub）一目了然
// - 点击符号展开引用点列表 → 定位引用方文件
// - 全局搜索索引符号名 → 快速跳转

/// 一次 import 语句解析结果：模块路径 + 行号 + 导入的具体符号名列表
#[derive(Debug, Clone)]
pub struct ParsedImport {
    pub path: String,
    /// 1-based 行号（pub：解析器插件在模块外构造/读取，如 `parser::ts` 的 AST 抽取）
    pub line: usize,
    pub symbols: Vec<String>,
}

/// 按语言解析 import 语句，返回模块路径、行号与导入符号名
/// 解析 import 符号级引用（按语言分发，R45 起由 ParserRegistry 驱动）
pub fn parse_imports_with_symbols(lang: &str, content: &str) -> Vec<ParsedImport> {
    crate::parser::parse_imports_with_symbols(lang, content)
}

fn extract_quoted(s: &str) -> Option<String> {
    let s = s.trim();
    if s.starts_with('\'') || s.starts_with('"') {
        let quote = s.chars().next()?;
        let rest = &s[1..];
        let end = rest.find(quote)?;
        Some(rest[..end].to_string())
    } else {
        None
    }
}

/// 去掉 TS 内联 `type` 限定符：`type Foo` / `import { type Bar }` 里的 `type` 是**类型导入
/// 修饰符**，不是绑定名的一部分（对标 joern：`import type` 仍是真实 import 边，`type` 只
/// 是限定符，绝不并入符号名）。仅剥「type 」(type + 空白) 前缀，避免误伤名为 `typeX` 的符号。
/// 整条就是 `type` 时原样返回（由调用方判空/判 `type` 丢弃）。
fn strip_type_qualifier(name: &str) -> &str {
    let t = name.trim();
    match t.strip_prefix("type ") {
        Some(rest) => rest.trim(),
        None => t,
    }
}

pub fn parse_ts_imports(content: &str) -> Vec<ParsedImport> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        // require('path')：仅文件级，无符号名
        if line.starts_with("const ") && line.contains("require(") {
            if let Some(path) = line.split("require(").nth(1).and_then(extract_quoted) {
                out.push(ParsedImport {
                    path,
                    line: i + 1,
                    symbols: Vec::new(),
                });
            }
            continue;
        }
        if line.starts_with("import ") {
            let body = line.trim_start_matches("import ").trim();
            // 提取 from 后面的模块路径
            let path = if let Some(from_idx) = body.find(" from ") {
                extract_quoted(&body[from_idx + 6..]).unwrap_or_default()
            } else {
                // import 'path'（副作用导入）
                extract_quoted(body).unwrap_or_default()
            };
            if path.is_empty() {
                continue;
            }
            // 提取符号名：花括号 {A, B as C}、默认导入、命名空间导入
            let mut symbols = Vec::new();
            if let Some(brace_start) = body.find('{') {
                let brace_end = body[brace_start + 1..]
                    .find('}')
                    .map(|e| brace_start + 1 + e)
                    .unwrap_or(body.len());
                let inner = &body[brace_start + 1..brace_end];
                for part in inner.split(',') {
                    // 先剥 ` as ` 别名取原名，再剥内联 `type` 限定符
                    let raw = part.split(" as ").next().unwrap_or(part).trim();
                    let name = strip_type_qualifier(raw);
                    if !name.is_empty() && name != "type" {
                        symbols.push(name.to_string());
                    }
                }
            }
            // 默认导入 / 命名空间导入（在 { 之前）
            let head = if let Some(b) = body.find('{') {
                &body[..b]
            } else {
                body
            };
            let head = head.split(" from ").next().unwrap_or(head).trim();
            for part in head.split(',') {
                let part = part.trim();
                if part.is_empty() || part == "type" {
                    continue;
                }
                let name = if let Some(after) = part.strip_prefix("* as ") {
                    strip_type_qualifier(after).to_string()
                } else {
                    strip_type_qualifier(part).to_string()
                };
                let name = name.trim();
                if !name.is_empty() && name != "type" {
                    symbols.push(name.to_string());
                }
            }
            symbols.dedup();
            out.push(ParsedImport {
                path,
                line: i + 1,
                symbols,
            });
        }
    }
    out
}

pub fn parse_py_imports(content: &str) -> Vec<ParsedImport> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if let Some(rest) = line.strip_prefix("from ") {
            // from x import A, B
            let rest = rest.trim();
            let module = rest.split_whitespace().next().unwrap_or("");
            if module.is_empty() || module == "import" || module == "." {
                continue;
            }
            let mut symbols = Vec::new();
            if let Some(imp_pos) = rest.find(" import ") {
                let names = rest[imp_pos + 8..].trim();
                for part in names.split(',') {
                    let name = part.split(" as ").next().unwrap_or(part).trim();
                    if !name.is_empty() && name != "*" {
                        symbols.push(name.to_string());
                    }
                }
            }
            out.push(ParsedImport {
                path: module.to_string(),
                line: i + 1,
                symbols,
            });
        } else if let Some(rest) = line.strip_prefix("import ") {
            let module = rest.split_whitespace().next().unwrap_or("");
            if !module.is_empty() && module != "." {
                out.push(ParsedImport {
                    path: module.to_string(),
                    line: i + 1,
                    symbols: Vec::new(),
                });
            }
        }
    }
    out
}

pub fn parse_rs_imports(content: &str) -> Vec<ParsedImport> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if let Some(rest) = line.strip_prefix("use ") {
            let rest = rest.trim_end_matches(';').trim();
            if rest.is_empty() || rest.ends_with("::*") {
                continue;
            }
            // use x::{A, B} | use x::y::A | use x::y as z
            let mut symbols = Vec::new();
            let path_part = if let Some(brace_idx) = rest.find('{') {
                let brace_end = rest[brace_idx + 1..]
                    .find('}')
                    .map(|e| brace_idx + 1 + e)
                    .unwrap_or(rest.len());
                for part in rest[brace_idx + 1..brace_end].split(',') {
                    let name = part.split(" as ").next().unwrap_or(part).trim();
                    if !name.is_empty() && name != "self" && name != "super" && name != "crate" {
                        symbols.push(name.to_string());
                    }
                }
                &rest[..brace_idx]
            } else {
                rest
            };
            let path_part = path_part.trim_end_matches("::").trim();
            let path = if let Some(after) = path_part.rsplit("::").next() {
                after.to_string()
            } else {
                path_part.to_string()
            };
            if !path.is_empty() && symbols.is_empty() {
                // use x::y::A → 符号名 A（路径最后一段）；use crate::x → 模块级
                let last = path_part.split("::").last().unwrap_or("").trim();
                if !last.is_empty() && !matches!(last, "crate" | "self" | "super") {
                    symbols.push(last.to_string());
                }
            }
            out.push(ParsedImport {
                path,
                line: i + 1,
                symbols,
            });
        }
    }
    out
}

pub fn parse_java_imports(content: &str) -> Vec<ParsedImport> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if let Some(rest) = line.strip_prefix("import ") {
            let rest = rest.trim_end_matches(';').trim();
            if rest.is_empty() || rest.starts_with("static ") {
                continue;
            }
            let class_name = rest.split('.').last().unwrap_or("").to_string();
            let mut symbols = Vec::new();
            if !class_name.is_empty() && class_name != "*" {
                symbols.push(class_name);
            }
            out.push(ParsedImport {
                path: rest.to_string(),
                line: i + 1,
                symbols,
            });
        }
    }
    out
}

/// 路径规范化（去 ./ ../）
fn normalize_rel_path(path: &str) -> String {
    let mut out = std::path::PathBuf::new();
    for comp in std::path::Path::new(path).components() {
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

/// TS/JS 模块记号 → 候选相对路径（import 主循环与再导出链 `resolve_path` 共用，保证口径一致）。
///
/// 仅 TS/JS 走此逻辑：`./` `../` 相对路径拼到文件目录、裸路径尝试补扩展名 + `index`/`mod`
/// 变体；包名导入（无 `./`）保留原名（外部依赖由文件级依赖检测覆盖）。返回的是**候选列表**，
/// 调用方再与已知文件表求交决定真实命中文件。零 TS/JS 之外的语言不应调用本函数
/// （非 TS/JS 的模块记号解析走 `module_ref_candidates`）。
pub(crate) fn ts_module_candidates(from_rel: &str, path: &str) -> Vec<String> {
    let resolved_rel = if path.starts_with("./") || path.starts_with("../") {
        if let Some(parent) = std::path::Path::new(from_rel).parent() {
            normalize_rel_path(&parent.join(path).to_string_lossy())
        } else {
            path.to_string()
        }
    } else if path.starts_with('/') {
        normalize_rel_path(path.trim_start_matches('/'))
    } else {
        // 包名导入：尝试匹配（如 import utils from "utils" 命中了文件 utils.ts）
        path.to_string()
    };
    let mut candidates = vec![resolved_rel.clone()];
    if !resolved_rel.contains('.') {
        for ext in [
            "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp",
        ] {
            candidates.push(format!("{}.{}", resolved_rel, ext));
            candidates.push(format!("{}/index.{}", resolved_rel, ext));
            candidates.push(format!("{}/mod.{}", resolved_rel, ext));
        }
    }
    candidates
}

/// **模块记号 → 项目内相对路径候选**（非 TS/JS 语言符号级引用的解析层）。
///
/// ── 为什么需要它（实测事实，不是推断）──────────────────────────────────────────
/// `analyze_symbol_references` 的候选生成完全按 TS 语义写的：只认 `./`、`../`、`/` 前缀
/// 与「无点则补扩展名」。而 Rust 的 `crate::commands::code_structure`、Python 的 `a.b.c`、
/// Java 的 `com.foo.Bar` 都是**模块记号**而非路径：
///   - Rust 记号含 `::` 不含 `.` → 补出来的候选是 `crate::commands::code_structure.rs`，永不命中；
///   - Python / Java 记号含 `.` → `!resolved_rel.contains('.')` 判定为假，**连扩展名候选都不生成**。
/// 结果：本仓一次真实扫描（146 个 `.rs` + 1972 个 Rust 符号）`project_symbol_refs` 里
/// `.rs` 来源 **0 条**——非 TS/JS 的符号级引用是死功能。
///
/// ── joern 取证（/Volumes/HPFX900固态盘/TEST_PRO/joern-master）──────────────────
///   - `x2cpg/frontendspecific/pysrc2cpg/PythonImportResolverPass.scala:48`
///     `fileToPythonImportNotation`：把文件路径与 import 记号做**双向**转换（`/`↔`.`，去后缀，
///     `__init__` 视作包本体）——本函数是它的逆向（记号 → 路径候选）。
///   - `javasrc2cpg/util/PackageRootFinder.scala:25`
///     `packageName.replaceAll(raw"\.", "/")` 后自文件目录**向上回溯**找包根 —— 本函数不猜源码根
///     （`src/main/java`、`src-tauri/src` 等各语言差异极大），改为「逐个祖先目录当基准试一遍，
///     命中真实文件才算」，等价地绕过了包根推断。
///
/// 约定：只对 rust / python / java / kotlin 返回候选，其余语言（含 TS/JS）返回空 → 调用点
/// 仅在原 TS 语义匹配**未命中**时兜底，对既有 TS/JS 行为零影响。
/// 拼接相对路径：空基准时不产生前导 `/`。
///
/// 必须走本函数而非裸 `format!("{}/{}", base, tail)`——基准为仓库根时 `base` 是空串，
/// 裸拼会得到 `/internal/store/store.go`，而库里的 `rel_path` 没有前导斜杠，
/// 匹配必然落空（Go/C 候选生成初版实测踩到，前导斜杠的候选一条都命中不了）。
fn join_rel(base: &str, tail: &str) -> String {
    if base.is_empty() {
        tail.to_string()
    } else if tail.is_empty() {
        base.to_string()
    } else {
        format!("{}/{}", base, tail)
    }
}

/// 自 `file_dir` 向上回溯至仓库根的目录列表（含 `file_dir` 自身与根 `""`），上限 12 层。
/// `module_ref_candidates` 的通用分支与 Go/C 专用分支共用，保证「祖先回溯」口径一致。
fn ancestor_dirs(file_dir: &str) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    let mut cur = Some(file_dir.to_string());
    while let Some(d) = cur {
        v.push(d.clone());
        if d.is_empty() {
            break;
        }
        cur = Some(
            std::path::Path::new(&d)
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default(),
        );
        if v.len() >= 12 {
            break;
        }
    }
    if !v.iter().any(|d| d.is_empty()) {
        v.push(String::new());
    }
    v
}

pub fn module_ref_candidates(lang: &str, from_rel: &str, module_path: &str) -> Vec<String> {
    // Go：导入路径以**模块根**为基准且包对应**目录**，与「拼 .ext」的通用分支语义冲突。
    if lang == "go" {
        return go_module_candidates(from_rel, module_path);
    }
    // C/C++：include 路径**自带扩展名**（`foo/bar.h`），通用分支会拼成 `foo/bar.h.go`。
    if matches!(lang, "c" | "cpp") {
        return c_include_candidates(from_rel, module_path);
    }
    // (分隔符, 文件扩展名, 目录索引文件名)
    let (sep, exts, index_names): (char, &[&str], &[&str]) = match lang {
        "rust" => (':', &["rs"], &["mod.rs"]),
        "python" => ('.', &["py", "pyi"], &["__init__.py"]),
        "java" => ('.', &["java"], &[]),
        "kotlin" => ('.', &["kt", "kts"], &[]),
        _ => return Vec::new(),
    };
    let module_path = module_path.trim();
    if module_path.is_empty() {
        return Vec::new();
    }

    let file_dir = std::path::Path::new(from_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    // ── Python 相对导入：`.` / `.foo` / `..bar.baz` ──────────────────────────
    // 点数 n：1 = 当前包，2 = 上一级……（PEP 328）。基准目录唯一，不做祖先扫描。
    let mut relative_base: Option<String> = None;
    let mut rest = module_path.to_string();
    if lang == "python" && module_path.starts_with('.') {
        let dots = module_path.chars().take_while(|c| *c == '.').count();
        rest = module_path[dots..].to_string();
        let mut base = file_dir.clone();
        for _ in 1..dots {
            base = std::path::Path::new(&base)
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
        }
        relative_base = Some(base);
    }

    // 段拆分：Rust 用 `::`（按 ':' 拆后滤空），Python/Java/Kotlin 用 `.`
    let mut segs: Vec<String> = rest
        .split(sep)
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string())
        .collect();
    // Rust 路径限定符：`crate` / `self` / `super` 不是目录名，剥掉（祖先扫描已覆盖其语义）
    if lang == "rust" {
        while matches!(
            segs.first().map(|s| s.as_str()),
            Some("crate" | "self" | "super")
        ) {
            segs.remove(0);
        }
    }

    let mut out: Vec<String> = Vec::new();
    let mut push = |p: String| {
        let n = normalize_rel_path(&p);
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
    };

    let join = join_rel;

    // 基准目录列表：相对导入 → 唯一基准；否则自文件所在目录**向上回溯**至仓库根
    // （对标 PackageRootFinder 的向上找包根，但不预判源码根名）
    let bases: Vec<String> = if let Some(b) = relative_base {
        vec![b]
    } else {
        ancestor_dirs(&file_dir)
    };

    let seg_path = segs.join("/");
    for base in &bases {
        if seg_path.is_empty() {
            // `from . import x` → 当前包本体（`__init__.py`）
            for idx in index_names {
                push(join(base, idx));
            }
            // Rust 2018 平铺布局：模块 `util::rand` 的文件可能是 `util/rand.rs`
            // 而**不是** `util/rand/mod.rs`，二者等价（edition 2018 起两种写法都合法）。
            //
            // 不补这一条的后果（tokio-1.53.1 实测）：`src/util/rand/rt.rs` 里的
            // `use super::{FastRand, RngSeed}` 本该指向 `src/util/rand.rs`，但因为
            // `src/util/rand/mod.rs` 不存在，祖先回溯继续上爬一层，命中了
            // `src/util/mod.rs` —— **目标文件解析多上溯了一级**（false target），
            // 符号自然找不到，且跳转会把用户带到错文件。必须在同一层就把
            // `<dir>.rs` 试完，再允许上溯。
            if lang == "rust" && !base.is_empty() {
                for ext in exts {
                    push(format!("{}.{}", base, ext));
                }
            }
            continue;
        }
        for ext in exts {
            push(join(base, &format!("{}.{}", seg_path, ext)));
        }
        for idx in index_names {
            push(join(base, &format!("{}/{}", seg_path, idx)));
        }
        // Java/Kotlin 嵌套类 `a.b.Outer.Inner` → 文件是 `a/b/Outer.java`
        if matches!(lang, "java" | "kotlin") && segs.len() >= 2 {
            let parent = segs[..segs.len() - 1].join("/");
            for ext in exts {
                push(join(base, &format!("{}.{}", parent, ext)));
            }
        }
    }
    out
}

/// Go 导入路径 → 候选文件相对路径。
///
/// # 对标 joern
/// `gosrc2cpg` 的 `ImportTests` 钉死语义：`import "math/rand"` 的 `importedEntity` 是
/// **完整路径** `"math/rand"`，而 `importedAs` 取**末段** `"rand"` 作为包名。
/// 我们据此把末段当作包名，也当作该包主文件的惯用名。
///
/// # 关键差异与实测根因：必须渐进剥离模块前缀
/// Go 的导入路径以**模块根**为基准（`github.com/u/repo/internal/store`），而扫描库里的
/// `rel_path` 以仓库根为基准，真实文件在 `internal/store/` 下。按完整路径直接找必然落空
/// ——这正是 Go 符号级引用长期恒为 0 的根因。逐段剥离前缀即可对齐，无需读 `go.mod`。
///
/// # 候选顺序（最具体优先）
/// 剥离段数由 0 递增，先试完整路径再逐级退化，避免浅层同名包抢先命中造成假目标。
pub(crate) fn go_module_candidates(from_rel: &str, module_path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: String| {
        let n = normalize_rel_path(&p);
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
    };
    let path = module_path.trim();
    if path.is_empty() {
        return out;
    }
    let segs: Vec<&str> = path.split('/').filter(|s| !s.trim().is_empty()).collect();
    if segs.is_empty() {
        return out;
    }
    let file_dir = std::path::Path::new(from_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let bases = ancestor_dirs(&file_dir);
    // 模块前缀剥到只剩 1 段为止，但最多剥 5 段（github.com/user/repo 已占 3 段），
    // 防止超长路径产生 O(bases × segs) 组合爆炸。
    let max_strip = segs.len().saturating_sub(1).min(5);
    for strip in 0..=max_strip {
        let suffix = &segs[strip..];
        let dir = suffix.join("/");
        let pkg = suffix[suffix.len() - 1];
        for base in &bases {
            // 惯例一：包目录内的主文件与包名同名（`internal/store/store.go`）——Go 主流写法
            push(join_rel(base, &format!("{}/{}.go", dir, pkg)));
            // 惯例二：扁平布局（`internal/store.go`）
            push(join_rel(base, &format!("{}.go", dir)));
            // 惯例三：**包目录本身**。Go 的导入单元是目录，包内文件不必与包同名
            // （`internal/api/handler.go`、`pkg/util.go`），前两条必然落空。
            // 目录候选不会被文件表命中，仅供消费侧 `resolve_go_pkg_dir` 按目录回退。
            push(join_rel(base, &dir));
        }
    }
    out
}

/// Go 包目录 → 包内文件回退。
///
/// # 为什么必须有（实测根因）
/// Go 的导入单元是**目录**，包内文件不必与包同名：`import ".../internal/api"` 的包体是
/// `internal/api/handler.go`，`import ".../pkg"` 的包体是 `pkg/util.go`。
/// 「目录名 + .go」的候选对这两者**全部落空**（/tmp 构造的 Go 工程实测 4 条导入只命中 1 条）。
///
/// # 选文件策略（确定性优先）
/// 1. 优先选目录内**定义了被引用符号**的文件——该符号在包内唯一时选择是确定的；
/// 2. 否则取目录内字典序首个文件——`to_file_id` 依赖边本身依然正确。
///
/// 只处理不带 `.go` 后缀的候选（即 `go_module_candidates` 产出的目录候选）。
pub(crate) fn resolve_go_pkg_dir(
    candidates: &[String],
    symbols: &[String],
    files: &[ProjectFile],
    symbols_by_file: &HashMap<String, HashMap<String, String>>,
) -> Option<String> {
    for c in candidates {
        if c.ends_with(".go") || c.is_empty() {
            continue;
        }
        let prefix = format!("{}/", c);
        let in_dir: Vec<&ProjectFile> = files
            .iter()
            .filter(|f| !f.is_directory && f.rel_path.starts_with(&prefix))
            .collect();
        if in_dir.is_empty() {
            continue;
        }
        // 1) 定义了被引用符号的文件优先（按 symbols 顺序，保证确定性）
        for name in symbols {
            if let Some(f) = in_dir.iter().find(|f| {
                symbols_by_file
                    .get(&f.id)
                    .is_some_and(|m| m.contains_key(name))
            }) {
                return Some(f.id.clone());
            }
        }
        // 2) 回退：目录内字典序首个文件（依赖边仍正确）
        let mut sorted: Vec<&ProjectFile> = in_dir;
        sorted.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
        return Some(sorted[0].id.clone());
    }
    None
}

/// C / C++ `#include` 路径 → 候选文件相对路径。
///
/// # 为什么不走通用分支
/// include 路径**自带扩展名**（`foo/bar.h`），通用分支会拼成 `foo/bar.h.go`，必然落空。
///
/// # 对标 joern
/// `c2cpg/AstCreatorHelper.scala:184-192`：每个 include 都建 IMPORT **和** DEPENDENCY
/// 节点，解析不到也**不静默丢弃**；真实文件定位交给 `IncludeAutoDiscovery`（探测 gcc
/// 系统包含目录）+ 用户配置 `includePaths`。我们没有编译数据库，降级为
/// 「祖先目录回溯（替代 include 搜索路径）+ 头文件→实现文件配对」。
///
/// # 头/实现配对为何重要
/// C 的常态是声明在 `.h`、实现在 `.c`。只连头文件会让调用图与跳转在 C 项目里半残——
/// 被调用的函数体在 `.c` 里，符号也在 `.c` 里。
const C_HEADER_EXTS: [&str; 4] = ["h", "hpp", "hh", "hxx"];
const C_IMPL_EXTS: [&str; 4] = ["c", "cpp", "cc", "cxx"];

fn c_include_candidates(from_rel: &str, module_path: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: String| {
        let n = normalize_rel_path(&p);
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
    };
    let path = module_path.trim().trim_matches('"').trim();
    if path.is_empty() {
        return out;
    }
    let file_dir = std::path::Path::new(from_rel)
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let bases = ancestor_dirs(&file_dir);

    let (dir_part, file_name) = match path.rsplit_once('/') {
        Some((d, f)) => (d.to_string(), f),
        None => (String::new(), path),
    };
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) => (s, e.to_ascii_lowercase()),
        None => (file_name, String::new()),
    };

    for base in &bases {
        // 1) 头文件本体（精确匹配优先，最安全）
        push(join_rel(base, path));
        // 2) 头 → 实现配对：声明与实现分离是 C 的常态，缺这条调用图在 C 项目中半残
        if C_HEADER_EXTS.contains(&ext.as_str()) {
            for ie in C_IMPL_EXTS {
                if dir_part.is_empty() {
                    push(join_rel(base, &format!("{}.{}", stem, ie)));
                } else {
                    push(join_rel(base, &format!("{}/{}.{}", dir_part, stem, ie)));
                }
            }
        }
    }
    out
}

/// 再导出链的最大跳数（`mod.rs` → `database/mod.rs` → `connection.rs` 实测需 2 跳）。
const REEXPORT_MAX_DEPTH: usize = 3;
/// 再导出链最多访问的文件数（防 wildcard 扩散/环）。
///
/// 为什么是 64 而不是 16（实测定的，不是拍的）：枢纽 `mod.rs` 的 `pub use` 条数就能
/// 单层超过旧预算 —— 本仓 `src-tauri/src/commands/mod.rs` 有 **33 条** `pub use`，
/// `pub use file_watcher::*`（第 17 条）、`pub use terminal::*`（第 33 条）在 16 的预算下
/// 直接被截断，于是 `FileWatcherState` / `TerminalManager` 明明有完整再导出链却仍判 MISS。
/// 单层就得容纳枢纽的全部出边，否则「能否解析」取决于符号在 mod.rs 里的书写顺序——
/// 这种顺序依赖的正确性是不可接受的。代价：imports 已 memo 化，多访问的每个文件只是
/// 一次 HashMap 查表。
const REEXPORT_MAX_FILES: usize = 64;

/// 行级 `pub use` 再导出扫描（**仅供再导出链 BFS 兜底**，不进依赖图/文件级引用）。
///
/// # 为什么必须有（实测根因）
///
/// 真实 Rust 库把再导出包在**宏调用体**里，而 tree-sitter 把宏体解析成 `token_tree`
/// 而非 `use_declaration`，AST 抽取必然一条都拿不到。tokio-1.53.1 实测：
///
/// ```text
/// src/io/mod.rs:230  cfg_net_or_uring! {
/// src/io/mod.rs:231      pub use interest::Interest;   ← 宏体内，AST 看不见
/// src/io/mod.rs:232      pub use ready::Ready;
/// src/io/mod.rs:240      pub(crate) use poll_evented::PollEvented;
/// ```
///
/// 于是 `use crate::io::Interest` 解析到 `src/io/mod.rs` 后再也走不下去，
/// `to_symbol_id = None`，前端符号级视图整条丢弃。`cfg_if!` 系宏在 tokio/hyper/mio
/// 里是主流写法，不兜底等于对这类库整体失效。
///
/// # 对标 joern
///
/// `XImportResolverPass` 的 `EvaluatedImport` 是 sealed trait，解析不出来也照样打
/// `UNKNOWN_*` tag **绝不丢弃**（`importresolver/package.scala`）。这里取同一态度：
/// 宁可多给 BFS 几个候选（错的候选只是一次 `defines()` 查表失败），也不让链断掉。
///
/// # 有意的保守取舍（宁缺毋滥，避免假阳性跳转）
///
/// - 只认**单行闭合**的 use 树；跨行 `pub use x::{` 直接跳过（拿不到完整名单）
/// - 带 ` as ` 的重命名再导出跳过（导出名与定义名不同，匹配会指错文件）
/// - 单段 `pub use foo;`（只把模块名带进作用域，并不转发符号）跳过
pub fn rust_reexport_lines(content: &str) -> Vec<ParsedImport> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if !line.starts_with("pub") || line.starts_with("//") {
            continue;
        }
        // 可见性：`pub use ...` 或 `pub(crate)/pub(super)/pub(in ..) use ...`
        let after_vis = if let Some(rest) = line.strip_prefix("pub(") {
            match rest.find(')') {
                Some(close) => rest[close + 1..].trim_start(),
                None => continue,
            }
        } else {
            &line["pub".len()..]
        };
        let Some(tree) = after_vis.trim_start().strip_prefix("use ") else {
            continue;
        };
        let tree = tree.trim().trim_end_matches(';').trim();
        if tree.is_empty() || tree.contains(" as ") {
            continue;
        }
        let (path, symbols) = if let Some(prefix) = tree.strip_suffix("::*") {
            // wildcard 转发：整个目标文件都是候选
            (prefix.to_string(), Vec::new())
        } else if let Some(brace) = tree.find("::{") {
            let Some(close) = tree.rfind('}') else {
                continue;
            };
            if close < brace {
                continue;
            }
            let names: Vec<String> = tree[brace + 3..close]
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty() && *s != "self" && !s.contains("::"))
                .map(|s| s.to_string())
                .collect();
            if names.is_empty() {
                continue;
            }
            (tree[..brace].to_string(), names)
        } else {
            // 点名：`a::b::Name` → path `a::b` + 符号 `Name`
            let Some(sep) = tree.rfind("::") else {
                continue;
            };
            (tree[..sep].to_string(), vec![tree[sep + 2..].to_string()])
        };
        if path.is_empty() {
            continue;
        }
        out.push(ParsedImport {
            path,
            line: i + 1,
            symbols,
        });
    }
    out
}

/// 再导出链 BFS 的 import 供给：AST 抽取 ∪ 行级 `pub use` 兜底（Rust）。
///
/// 独立成函数是为了让**消费点与回放探针用同一份语义**——否则探针量出来的命中率
/// 和用户在 UI 上看到的不是同一件事，度量就失去意义。
pub fn reexport_imports_for(lang: &str, content: &str) -> Vec<ParsedImport> {
    let mut out = parse_imports_with_symbols(lang, content);
    if lang == "rust" {
        // AST 已抽到的（path, symbols）不重复入列，避免 BFS 重复展开同一目标
        let seen: HashSet<(String, Vec<String>)> = out
            .iter()
            .map(|i| (i.path.clone(), i.symbols.clone()))
            .collect();
        for imp in rust_reexport_lines(content) {
            if !seen.contains(&(imp.path.clone(), imp.symbols.clone())) {
                out.push(imp);
            }
        }
    }
    out
}

/// 顺着**再导出（re-export）链**查符号的真实定义文件。
///
/// # 为什么需要它（实测根因）
///
/// 消费点 `analyze_symbol_references` 原本只在「import 记号解析出的目标文件」内精确
/// 匹配符号名。但 Rust 的 `mod.rs` 与 Python 的 `__init__.py` 是**转发枢纽**——符号
/// 名根本不在那个文件里定义。本仓实测链条：
///
/// ```text
/// src/plugins/ai_agent/tools.rs:16  use crate::infrastructure::Database;
///   → src/infrastructure/mod.rs:4             pub use database::*;           (wildcard)
///     → src/infrastructure/database/mod.rs:29 pub use connection::Database;  (点名)
///       → src/infrastructure/database/connection.rs:5  pub struct Database    ← 真定义
/// ```
///
/// 匹配失败 ⇒ `to_symbol_id = None` ⇒ **前端 5 个消费点全部把该行丢弃**
/// （`symbolRefs.ts:14` / `symbolLayout.ts:394`、`:272` / `reportGenerator.ts:43` /
/// `acp/tools.ts:262` 都以 `toSymbolId` 非空为闸门）。所以「库里有数据」但
/// 「UI 上被引用计数恒为 0」——这正是「renderable ≠ useful」的典型死功能。
/// 回放实测：本仓 Rust 符号级引用命中率仅 50.1%（289/577），未命中的绝对主因就是这个。
///
/// # 对标 joern
///
/// `pysrc2cpg/PythonImportResolverPass.scala:27-46` 建的是**全局「模块记号 → 符号」索引**
/// （`moduleCache`，键形如 `a.b.funcName`），并在 `:53` 显式
/// `stripSuffix(".__init__")`——把包目录与 `__init__.py` 视作同一记号空间，因此转发天然可解。
/// 本函数取等效语义但用**按需 BFS**（不预建全量索引，省内存与扫描时间），
/// 且读的是源码里真实写的 `pub use` / `from .x import Y` 声明，**不是同名符号猜测**。
///
/// # 语言范围
///
/// `rust` / `python` / `typescript` / `javascript`：这些语言有再导出（re-export）语义且
/// 抽取层已能抽出对应声明。具体：
///   - Rust：`pub use` / `__init__.py` 转发（见 `rust_reexport_lines`）；
///   - TS/JS：抽取层 `extract_ts_imports` 已把 `export * from "./x"`（wildcard，symbols 为空）
///     与 `export { a } from "./y"`（named）作为 `ReExport` 边产出（见 `parser/ts_imports.rs`），
///     故再导出链数据与 Rust 同构，本函数直接复用同一套 BFS。
/// 其余语言一律返回 `None` → 行为零改变。
/// TS 命中率曾实测 82.0%，缺口正是 barrel 再导出无法顺着链解析真实定义文件；本函数
/// 打开 TS/JS 后该缺口闭合（注意：抽取层此前已就绪，仅解析层从未消费，故属纯解锁）。
///
/// # 参数
///
/// - `importer_rel`：发起 import 的源文件（内联 `mod` 的 `super` 语义需要它）
/// - `import_path`：import 记号原文（如 `crate::infrastructure` / `super`）
/// - `start_rel`：记号解析出的目标文件（BFS 起点）
/// - `defines(rel)`：该相对路径的文件是否**定义**了目标符号名
/// - `imports_of(rel)`：该文件的 import/`pub use` 列表（调用方负责惰性读取 + memo）
/// - `resolve_path(from_rel, import_path)`：import 记号 → 命中的仓库内相对路径
///
/// # 返回
///
/// 真实定义该符号的文件相对路径；查不到返回 `None`（调用方保持原状，不猜）。
pub fn resolve_symbol_via_reexports<D, I, R>(
    lang: &str,
    importer_rel: &str,
    import_path: &str,
    start_rel: &str,
    name: &str,
    mut defines: D,
    mut imports_of: I,
    mut resolve_path: R,
) -> Option<String>
where
    D: FnMut(&str) -> bool,
    I: FnMut(&str) -> Vec<ParsedImport>,
    R: FnMut(&str, &str) -> Option<String>,
{
    if !matches!(lang, "rust" | "python" | "typescript" | "javascript") || name.is_empty() {
        return None;
    }
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(start_rel.to_string());
    let mut queue: std::collections::VecDeque<(String, usize)> = std::collections::VecDeque::new();
    queue.push_back((start_rel.to_string(), 0));

    while let Some((rel, depth)) = queue.pop_front() {
        // depth == 0 是起点：调用方已在目标文件内查过，不重复判定
        if depth > 0 && defines(&rel) {
            return Some(rel);
        }
        if depth >= REEXPORT_MAX_DEPTH || visited.len() >= REEXPORT_MAX_FILES {
            continue;
        }
        // 点名再导出（`pub use x::Name`）精确性高 → 优先于 wildcard（`pub use x::*`）入队
        let (mut named, mut wildcard) = (Vec::new(), Vec::new());
        for imp in imports_of(&rel) {
            let Some(target) = resolve_path(&rel, &imp.path) else {
                continue;
            };
            if imp.symbols.iter().any(|s| s == name) {
                named.push(target);
            } else if imp.symbols.is_empty() {
                wildcard.push(target);
            }
        }
        for target in named.into_iter().chain(wildcard) {
            if visited.len() >= REEXPORT_MAX_FILES {
                break;
            }
            if visited.insert(target.clone()) {
                queue.push_back((target, depth + 1));
            }
        }
    }

    // ── 最后兜底：Rust **内联 `mod` 块内**的裸 `super` ──────────────────────────
    //
    // Rust 语义里 `super` 是「上一级**模块**」，不是「上一级**文件**」。写在内联
    // `mod` 块里时，上一级模块就是**当前文件自己**：
    //
    // ```text
    // src/net/tcp/listener.rs
    //   pub struct TcpListener { .. }          ← 真定义就在本文件
    //   #[cfg(unix)] mod sys {
    //       use super::TcpListener;            ← super = crate::net::tcp::listener（本文件）
    //   }
    // ```
    //
    // 我们的记号解析是纯路径式的，只会算到**文件级**父模块 `src/net/tcp/mod.rs`，
    // 那里没有 `TcpListener` ⇒ 目标文件本身就是错的（false target）。这比单纯 miss
    // 更有害：跳转会把用户带到一个根本没有该符号的文件。
    // `#[cfg(test)] mod tests { use super::*; }` 是 Rust 最主流的写法，本仓
    // `commands/review.rs:1221` 就是同一形态。
    //
    // 放在 BFS **之后**执行：真有 `mod.rs` 再导出链时以链为准；只有链也走不通才
    // 退回「符号就在发起文件里」。判据是 `defines()` 实证，不是猜。
    // 只认裸 `super`（多段 `super::a::b` 语义会变，宁可不救）。
    if lang == "rust"
        && import_path == "super"
        && importer_rel != start_rel
        && defines(importer_rel)
    {
        return Some(importer_rel.to_string());
    }
    None
}

/// 取字符串开头的标识符（跳过泛型 <...>、逗号、空白、括号）。
/// `class A extends B<T> implements C` → extends 后取到 "B"，implements 后取到 "C"。
fn first_identifier(s: &str) -> Option<String> {
    let mut name = String::new();
    for c in s.trim_start().chars() {
        if c.is_alphanumeric() || c == '_' || c == '$' {
            name.push(c);
        } else {
            break; // < , { ( 空白 等一律截断
        }
    }
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 查找独立关键字（前后都不是标识符字符），避免命中成员名里的子串。
/// 返回关键字起始下标。
fn find_keyword_index(haystack: &str, keyword: &str, from: usize) -> Option<usize> {
    let kw_chars: Vec<char> = keyword.chars().collect();
    let chars: Vec<char> = haystack.chars().collect();
    let kw_len = kw_chars.len();
    let mut i = from;
    while i + kw_len <= chars.len() {
        if chars[i..i + kw_len] == kw_chars[..] {
            let prev_ok = i == 0
                || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_' || chars[i - 1] == '$');
            let next = i + kw_len;
            let next_ok = next >= chars.len()
                || !(chars[next].is_alphanumeric() || chars[next] == '_' || chars[next] == '$');
            if prev_ok && next_ok {
                return Some(i);
            }
            i += kw_len;
        } else {
            i += 1;
        }
    }
    None
}

/// 从类/接口声明行解析继承关系（extends / implements 关键字）。
/// 仅覆盖单行类声明语法（TS/JS/Java 均为单行声明）：
///   class A extends B<T> implements C, D  → [(B, extends), (C, implements), (D, implements)]
/// Rust（impl 多行）/ Python（无 extends 关键字）等不在此解析，避免误报。
/// 可见性说明：原为模块私有，调用图（`call_graph.rs`）为对标 joern
/// `DynamicCallLinker.resolveCallInSuperClasses` 需要复用同一份继承解析，故提升为 crate 内可见。
pub(crate) fn parse_inheritance(signature: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(pos) = find_keyword_index(signature, "extends", 0) {
        if let Some(name) = first_identifier(&signature[pos + "extends".len()..]) {
            out.push((name, "extends".to_string()));
        }
    }
    if let Some(pos) = find_keyword_index(signature, "implements", 0) {
        let after = &signature[pos + "implements".len()..];
        for part in after.split(',') {
            if let Some(name) = first_identifier(part) {
                out.push((name, "implements".to_string()));
            }
        }
    }
    out
}

/// 主命令：分析符号级引用（import 语句 → 目标符号匹配），写入 project_symbol_refs
#[tauri::command(async)]
pub fn analyze_symbol_references(
    analysis_id: String,
    app: AppHandle,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
    ref_repo: State<'_, Arc<SqliteProjectSymbolRefRepository>>,
    cancel: State<'_, crate::commands::project_scan::AnalysisCancelState>,
    changed_rel_paths: Option<Vec<String>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<SymbolRef>> {
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let symbols = symbol_repo.list_by_analysis(&analysis_id)?;
    let incremental = changed_rel_paths.is_some();
    // 增量仅重算变更/新增文件（changed 含新增），携带未变文件的旧引用。
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
    // 上一轮引用，用于增量携带
    let existing: Vec<SymbolRef> = if incremental {
        ref_repo.list_by_analysis(&analysis_id).unwrap_or_default()
    } else {
        Vec::new()
    };

    // path → file_id 映射（相对路径 + 绝对路径）
    let mut path_to_id: HashMap<String, String> = HashMap::new();
    for f in &files {
        if !f.is_directory {
            path_to_id.insert(f.rel_path.clone(), f.id.clone());
            path_to_id.insert(f.path.clone(), f.id.clone());
        }
    }
    // rel_path → 文件（再导出链解析时按需读取任意目标文件，含未变更文件）
    let file_by_rel: HashMap<&str, &ProjectFile> = files
        .iter()
        .filter(|f| !f.is_directory)
        .map(|f| (f.rel_path.as_str(), f))
        .collect();
    // 再导出链解析的 import memo（同一转发枢纽会被大量文件反复问到，避免重复解析）
    let mut reexport_imports_memo: HashMap<String, Vec<ParsedImport>> = HashMap::new();

    // file_id → 该文件的符号（名字 → 符号 id）
    let mut symbols_by_file: HashMap<String, HashMap<String, String>> = HashMap::new();
    // 符号名 → (file_id, symbol_id, file_path)：继承解析时按父类型名跨文件匹配目标符号
    let mut symbols_by_name: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    for s in &symbols {
        symbols_by_file
            .entry(s.file_id.clone())
            .or_default()
            .entry(s.name.clone())
            .or_insert_with(|| s.id.clone());
        symbols_by_name.entry(s.name.clone()).or_default().push((
            s.file_id.clone(),
            s.id.clone(),
            s.file_path.clone(),
        ));
    }

    // 读文件内容（供 import 解析）：增量只读取变更文件
    let total = process_files.len() as i64;
    let mut done = 0i64;
    let mut content_by_id: HashMap<String, Arc<str>> = HashMap::new();
    for f in &process_files {
        if f.is_directory {
            continue;
        }
        done += 1;
        if crate::commands::project_scan::analysis_cancelled(&cancel, &analysis_id) {
            break;
        }
        if done % 200 == 0 {
            crate::commands::project_scan::emit_stage_progress(
                &app,
                crate::commands::project_scan::ScanStage::SymbolRefs,
                ((done as f64 / total.max(1) as f64) * 100.0) as i64,
                done,
                total,
                "分析符号引用…",
            );
        }
        if let Some(c) = cache.read(f) {
            content_by_id.insert(f.id.clone(), c);
        }
    }

    let mut new_refs: Vec<SymbolRef> = Vec::new();
    let now = chrono::Utc::now().timestamp();

    for file in &process_files {
        if file.is_directory {
            continue;
        }
        if crate::commands::project_scan::analysis_cancelled(&cancel, &analysis_id) {
            break;
        }
        let lang = match file.language.as_deref() {
            Some(l) => l,
            None => continue,
        };
        let content = match content_by_id.get(&file.id) {
            Some(c) => c,
            None => continue,
        };
        let imports = parse_imports_with_symbols(lang, content);

        // v2.2 继承引用：类/接口声明行的 extends/implements → project_symbol_refs
        // （kind=inherits/implements）。与 import 引用同表、同增量携带/清理逻辑，
        // 故在 analyze_symbol_references 内一并生成，避免被本命令的删除循环冲掉。
        // 仅对单行类声明语言（TS/JS/Java）解析；Rust/Python 跳过。
        if matches!(lang, "typescript" | "javascript" | "java") {
            for s in symbols
                .iter()
                .filter(|s| s.file_id == file.id && (s.kind == "class" || s.kind == "interface"))
            {
                for (parent, rel_kind) in parse_inheritance(&s.signature) {
                    let to = symbols_by_name
                        .get(&parent)
                        .and_then(|v| v.first())
                        .cloned();
                    new_refs.push(SymbolRef {
                        id: format!("ref_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                        analysis_id: analysis_id.clone(),
                        from_file_id: file.id.clone(),
                        from_file_path: file.rel_path.clone(),
                        to_symbol_id: to.as_ref().map(|(_, sid, _)| sid.clone()),
                        to_file_id: to
                            .as_ref()
                            .map(|(fid, _, _)| fid.clone())
                            .unwrap_or_else(|| file.id.clone()),
                        to_file_path: to
                            .as_ref()
                            .map(|(_, _, fp)| fp.clone())
                            .unwrap_or_else(|| file.rel_path.clone()),
                        symbol_name: parent,
                        ref_line: s.line_start,
                        ref_text: s.signature.chars().take(90).collect(),
                        kind: rel_kind,
                        created_at: now,
                    });
                }
            }
        }

        let lines: Vec<&str> = content.lines().collect();

        for imp in imports {
            // 1) 解析相对路径 → 目标文件候选（TS/JS 模块记号解析，与再导出链 resolve_path 共用）
            let candidates = ts_module_candidates(&file.rel_path, &imp.path);

            let mut to_file_id = candidates.iter().find_map(|c| path_to_id.get(c)).cloned();

            // 兜底：非 TS/JS 的**模块记号**解析（Rust `crate::a::b` / Python `a.b` / `.foo` /
            // Java・Kotlin `com.foo.Bar`）。上面的候选生成是按 TS 语义写的，对这些记号必然空手
            // 而归（见 `module_ref_candidates` 文档头的实测数据：`.rs` 来源引用曾恒为 0 条）。
            // 只在**未命中**时才走，且该函数对 TS/JS 返回空 → 既有行为零改变。
            if to_file_id.is_none() {
                let cands = module_ref_candidates(lang, &file.rel_path, &imp.path);
                if let Some(id) = cands.iter().find_map(|c| path_to_id.get(c)).cloned() {
                    to_file_id = Some(id);
                } else if lang == "go" {
                    // Go 包目录回退：包体是目录且文件不必与包同名
                    // （`internal/api/handler.go`），按目录找包内文件。
                    to_file_id = resolve_go_pkg_dir(&cands, &imp.symbols, &files, &symbols_by_file);
                }
            }

            let to_file = to_file_id
                .as_ref()
                .and_then(|id| files.iter().find(|f| &f.id == id));

            let ref_text = lines
                .get(imp.line.saturating_sub(1))
                .unwrap_or(&"")
                .trim()
                .to_string();
            let ref_text = if ref_text.chars().count() > 90 {
                let s: String = ref_text.chars().take(87).collect();
                format!("{}...", s)
            } else {
                ref_text
            };

            // 2) 无目标文件：跳过（外部依赖由文件级依赖检测覆盖）
            let (to_file_id, to_file_path) = match (&to_file_id, to_file) {
                (Some(id), Some(f)) => (id.clone(), f.rel_path.clone()),
                _ => continue,
            };

            // 3) 符号名匹配：目标文件符号表内精确匹配
            let target_symbols = symbols_by_file
                .get(&to_file_id)
                .cloned()
                .unwrap_or_default();

            if imp.symbols.is_empty() {
                // 文件级引用（未点名符号）：to_symbol_id = None
                new_refs.push(SymbolRef {
                    id: format!("ref_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                    analysis_id: analysis_id.clone(),
                    from_file_id: file.id.clone(),
                    from_file_path: file.rel_path.clone(),
                    to_symbol_id: None,
                    to_file_id: to_file_id.clone(),
                    to_file_path: to_file_path.clone(),
                    symbol_name: String::new(),
                    ref_line: imp.line as i64,
                    ref_text: ref_text.clone(),
                    kind: "import".to_string(),
                    created_at: now,
                });
            } else {
                for name in &imp.symbols {
                    let mut sym_id = target_symbols.get(name).cloned();
                    let mut ref_file_id = to_file_id.clone();
                    let mut ref_file_path = to_file_path.clone();
                    // 目标文件内查不到该符号 → 顺**再导出链**找真实定义文件
                    // （Rust `mod.rs` 的 `pub use` / Python `__init__.py` 的转发）。
                    // 不做则 to_symbol_id 恒为 None，前端 5 个符号级消费点会整条丢弃该引用
                    // ——「库里有数据、UI 计数恒 0」的死功能根因（详见函数文档与回放实测）。
                    if sym_id.is_none() {
                        let def_rel = resolve_symbol_via_reexports(
                            lang,
                            &file.rel_path,
                            &imp.path,
                            &to_file_path,
                            name,
                            |rel| {
                                path_to_id
                                    .get(rel)
                                    .and_then(|id| symbols_by_file.get(id))
                                    .is_some_and(|m| m.contains_key(name))
                            },
                            |rel| {
                                if let Some(v) = reexport_imports_memo.get(rel) {
                                    return v.clone();
                                }
                                let parsed = file_by_rel
                                    .get(rel)
                                    .and_then(|f| {
                                        let l = f.language.as_deref()?;
                                        let c = cache.read(f)?;
                                        Some(reexport_imports_for(l, &c))
                                    })
                                    .unwrap_or_default();
                                reexport_imports_memo.insert(rel.to_string(), parsed.clone());
                                parsed
                            },
                            |from_rel, path| {
                                if matches!(lang, "typescript" | "javascript") {
                                    ts_module_candidates(from_rel, path)
                                        .into_iter()
                                        .find(|c| path_to_id.contains_key(c))
                                } else {
                                    module_ref_candidates(lang, from_rel, path)
                                        .into_iter()
                                        .find(|c| path_to_id.contains_key(c))
                                }
                            },
                        );
                        // 命中：to_symbol_id 与 to_file_* 一并指向定义处（二者必须自洽，
                        // 否则「点符号跳过去看不到符号」）。未命中则保持原状，绝不猜。
                        if let Some(def_rel) = def_rel {
                            if let Some(def_id) = path_to_id.get(&def_rel) {
                                if let Some(id) =
                                    symbols_by_file.get(def_id).and_then(|m| m.get(name))
                                {
                                    sym_id = Some(id.clone());
                                    ref_file_id = def_id.clone();
                                    ref_file_path = def_rel;
                                }
                            }
                        }
                    }
                    new_refs.push(SymbolRef {
                        id: format!("ref_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                        analysis_id: analysis_id.clone(),
                        from_file_id: file.id.clone(),
                        from_file_path: file.rel_path.clone(),
                        to_symbol_id: sym_id,
                        to_file_id: ref_file_id,
                        to_file_path: ref_file_path,
                        symbol_name: name.clone(),
                        ref_line: imp.line as i64,
                        ref_text: ref_text.clone(),
                        kind: "import".to_string(),
                        created_at: now,
                    });
                }
            }
        }
    }

    // 写库：增量仅删除变更/删除文件的引用并写入新引用，保留未变文件的旧引用。
    let result: Vec<SymbolRef> = if incremental {
        let mut kept: Vec<SymbolRef> = Vec::new();
        // 需清理的文件（from_file_path）：变更文件 + 已删除文件
        let mut stale: Vec<String> = changed.iter().map(|s| s.to_string()).collect();
        for r in existing {
            let from = r.from_file_path.as_str();
            if !current_rel.contains(from) {
                // 源文件已删除 → 引用整体丢弃，并加入 stale 清理库
                if !stale.contains(&r.from_file_path) {
                    stale.push(r.from_file_path.clone());
                }
                continue;
            }
            if changed.contains(from) {
                continue; // 变更文件 → 由 new_refs 覆盖
            }
            // 指向已消失/重命名符号的引用 → 丢弃，避免悬挂引用误导死代码判定
            if let Some(tid) = &r.to_symbol_id {
                if !valid_sym_ids.contains(tid.as_str()) {
                    continue;
                }
            }
            // 指向已删除目标文件的引用 → 丢弃
            if !current_rel.contains(r.to_file_path.as_str()) {
                continue;
            }
            kept.push(r);
        }
        ref_repo.delete_by_analysis_and_files(&analysis_id, &stale)?;
        if !new_refs.is_empty() {
            ref_repo.save_batch(&new_refs)?;
        }
        let mut all = kept;
        all.extend(new_refs);
        all
    } else {
        ref_repo.delete_by_analysis(&analysis_id)?;
        if !new_refs.is_empty() {
            ref_repo.save_batch(&new_refs)?;
        }
        new_refs
    };

    Ok(result)
}

/// 列出分析的符号级引用
#[tauri::command(async)]
pub fn list_symbol_refs(
    analysis_id: String,
    ref_repo: State<'_, Arc<SqliteProjectSymbolRefRepository>>,
) -> AppResult<Vec<SymbolRef>> {
    ref_repo.list_by_analysis(&analysis_id)
}

/// 符号索引搜索（对应需求「索引」：按名称/路径模糊检索符号，支持跳转）
#[tauri::command(async)]
pub fn search_project_symbols(
    analysis_id: String,
    query: String,
    limit: Option<usize>,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<Vec<ProjectSymbol>> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let like = format!("%{}%", query.trim());
    symbol_repo.search(&analysis_id, &like, limit as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds_of(syms: &[SymbolCandidate]) -> Vec<String> {
        syms.iter()
            .map(|s| format!("{}:{}", s.kind, s.name))
            .collect()
    }

    // ══════════════ 模块记号解析（非 TS/JS 符号级引用的解析层）══════════════

    #[test]
    fn rust_crate_notation_resolves_to_real_file() {
        // 本仓真实场景：src/commands/tools.rs 里 `use crate::commands::code_structure::ParsedImport`
        let c = module_ref_candidates(
            "rust",
            "src-tauri/src/commands/tools.rs",
            "crate::commands::code_structure",
        );
        assert!(
            c.contains(&"src-tauri/src/commands/code_structure.rs".to_string()),
            "候选里必须有真实文件路径，实际={:?}",
            c
        );
        // mod.rs 形态同样要覆盖（`use crate::parser` → parser/mod.rs）
        let c2 = module_ref_candidates("rust", "src-tauri/src/commands/tools.rs", "crate::parser");
        assert!(c2.contains(&"src-tauri/src/parser/mod.rs".to_string()));
        assert!(c2.contains(&"src-tauri/src/parser.rs".to_string()));
    }

    #[test]
    fn rust_self_and_super_qualifiers_are_stripped() {
        let c = module_ref_candidates("rust", "src/parser/rust.rs", "super::imports_ast");
        assert!(c.contains(&"src/parser/imports_ast.rs".to_string()));
        let c2 = module_ref_candidates("rust", "src/parser/mod.rs", "self::ts_imports");
        assert!(c2.contains(&"src/parser/ts_imports.rs".to_string()));
    }

    // ── Go：模块根路径需渐进剥离前缀（此前 Go 符号级引用恒为 0 的根因）──

    #[test]
    fn go_module_path_strips_module_prefix() {
        // `import "github.com/u/repo/internal/store"`：真实文件在 internal/store/ 下，
        // 完整路径在仓库里根本不存在 → 必须剥掉 github.com/u/repo 三段前缀。
        let c = module_ref_candidates(
            "go",
            "cmd/server/main.go",
            "github.com/u/repo/internal/store",
        );
        assert!(
            c.contains(&"internal/store/store.go".to_string()),
            "必须剥到 internal/store，实际={:?}",
            c
        );
        assert!(c.contains(&"internal/store.go".to_string()));
    }

    #[test]
    fn go_stdlib_like_path_still_yields_candidates() {
        // 末段即包名（对标 joern `importedAs` 取末段）
        let c = module_ref_candidates("go", "main.go", "fmt");
        assert!(c.contains(&"fmt/fmt.go".to_string()), "实际={:?}", c);
        assert!(c.contains(&"fmt.go".to_string()));
    }

    #[test]
    fn go_nested_package_resolves_relative_to_file_dir_too() {
        // 祖先回溯：同仓库内的相对布局也要覆盖
        let c = module_ref_candidates("go", "internal/api/handler.go", "internal/store");
        assert!(
            c.contains(&"internal/store/store.go".to_string()),
            "实际={:?}",
            c
        );
    }

    #[test]
    fn go_candidates_are_most_specific_first() {
        // 最具体的（剥离最少）必须排在前面，否则浅层同名包会抢先命中成假目标
        let c = module_ref_candidates("go", "main.go", "github.com/u/repo/internal/store");
        let full = c
            .iter()
            .position(|p| p == "github.com/u/repo/internal/store/store.go");
        let stripped = c.iter().position(|p| p == "internal/store/store.go");
        let shallow = c.iter().position(|p| p == "store/store.go");
        assert!(full.is_some() && stripped.is_some(), "实际={:?}", c);
        assert!(
            full.unwrap() < stripped.unwrap(),
            "完整路径必须优先于剥离路径"
        );
        if let Some(s) = shallow {
            assert!(stripped.unwrap() < s, "深层路径必须优先于浅层");
        }
    }

    // ── C/C++：include 自带扩展名，且需头→实现配对 ──

    #[test]
    fn c_include_keeps_own_extension() {
        // 通用分支会拼成 `foo/bar.h.go`；C 必须原样保留
        let c = module_ref_candidates("c", "src/main.c", "foo/bar.h");
        assert_eq!(
            c.first().map(|s| s.as_str()),
            Some("src/foo/bar.h"),
            "实际={:?}",
            c
        );
        assert!(
            !c.iter().any(|p| p.ends_with(".h.go")),
            "不得拼出 .h.go，实际={:?}",
            c
        );
    }

    #[test]
    fn c_header_yields_implementation_pair() {
        // 声明在 .h、实现在 .c：缺这条配对，C 项目的调用图与跳转是半残的
        let c = module_ref_candidates("c", "src/main.c", "foo/bar.h");
        assert!(c.contains(&"src/foo/bar.c".to_string()), "实际={:?}", c);
        assert!(c.contains(&"src/foo/bar.cpp".to_string()), "实际={:?}", c);
    }

    #[test]
    fn c_impl_include_does_not_fabricate_headers() {
        // `#include "bar.c"` 是合法但罕见的写法：不应反向臆造 bar.h/bar.hpp
        let c = module_ref_candidates("c", "src/main.c", "bar.c");
        assert!(c.contains(&"src/bar.c".to_string()), "实际={:?}", c);
        assert!(
            !c.iter().any(|p| p.ends_with("bar.h")),
            "不得反向臆造头文件，实际={:?}",
            c
        );
    }

    #[test]
    fn c_ancestor_walk_covers_include_search_dirs() {
        // 没有编译数据库，用祖先回溯替代 include 搜索路径
        let c = module_ref_candidates("c", "src/core/net/sock.c", "inc/config.h");
        assert!(
            c.contains(&"src/core/net/inc/config.h".to_string()),
            "实际={:?}",
            c
        );
        assert!(c.contains(&"inc/config.h".to_string()), "实际={:?}", c);
    }

    #[test]
    fn unsupported_language_still_returns_empty() {
        assert!(module_ref_candidates("ruby", "a.rb", "foo").is_empty());
        assert!(module_ref_candidates("go", "a.go", "").is_empty());
        assert!(module_ref_candidates("c", "a.c", "").is_empty());
    }

    #[test]
    fn python_dotted_module_resolves_with_package_init() {
        let c = module_ref_candidates("python", "src/app/api/views.py", "app.models.user");
        assert!(
            c.contains(&"src/app/models/user.py".to_string()),
            "实际={:?}",
            c
        );
        assert!(c.contains(&"src/app/models/user/__init__.py".to_string()));
    }

    #[test]
    fn python_relative_import_resolves_against_own_package() {
        // `from .helpers import x`
        let c = module_ref_candidates("python", "pkg/sub/mod.py", ".helpers");
        assert!(
            c.contains(&"pkg/sub/helpers.py".to_string()),
            "实际={:?}",
            c
        );
        // `from ..core import y` → 上一级包
        let c2 = module_ref_candidates("python", "pkg/sub/mod.py", "..core");
        assert!(c2.contains(&"pkg/core.py".to_string()), "实际={:?}", c2);
        // `from . import x` → 当前包本体
        let c3 = module_ref_candidates("python", "pkg/sub/mod.py", ".");
        assert!(
            c3.contains(&"pkg/sub/__init__.py".to_string()),
            "实际={:?}",
            c3
        );
    }

    #[test]
    fn java_package_notation_resolves_under_source_root() {
        // 典型 maven 布局：包根 src/main/java 不需要预先知道（逐祖先试）
        let c = module_ref_candidates(
            "java",
            "src/main/java/com/acme/web/UserController.java",
            "com.acme.service.UserService",
        );
        assert!(
            c.contains(&"src/main/java/com/acme/service/UserService.java".to_string()),
            "实际={:?}",
            c
        );
    }

    #[test]
    fn java_nested_class_falls_back_to_outer_file() {
        let c = module_ref_candidates("java", "src/A.java", "com.acme.Outer.Inner");
        assert!(
            c.contains(&"com/acme/Outer.java".to_string()),
            "实际={:?}",
            c
        );
    }

    #[test]
    fn kotlin_uses_kt_extension() {
        let c = module_ref_candidates("kotlin", "src/main/kotlin/a/B.kt", "a.c.D");
        assert!(
            c.contains(&"src/main/kotlin/a/c/D.kt".to_string()),
            "实际={:?}",
            c
        );
    }

    /// 端到端链路证明「不再是死功能」：抽取层给出模块 + 符号，解析层把模块记号落到真实文件。
    /// 两层缺一，`project_symbol_refs` 就仍然写不进任何非 TS/JS 的引用。
    #[test]
    fn end_to_end_rust_import_yields_resolvable_module_and_symbol() {
        let imports = crate::parser::parse_imports_with_symbols(
            "rust",
            "use crate::commands::code_structure::ParsedImport;\n",
        );
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].symbols, vec!["ParsedImport".to_string()]);
        let cands =
            module_ref_candidates("rust", "src-tauri/src/commands/tools.rs", &imports[0].path);
        assert!(
            cands.contains(&"src-tauri/src/commands/code_structure.rs".to_string()),
            "抽取+解析链路必须能落到真实文件，候选={:?}",
            cands
        );
    }

    /// 同链路的 Java 版：`import static` 曾整条丢弃 → 现在既有目标文件也有成员符号。
    #[test]
    fn end_to_end_java_static_import_yields_resolvable_class_and_member() {
        let imports = crate::parser::parse_imports_with_symbols(
            "java",
            "import static com.acme.util.Assertions.check;\n",
        );
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].path, "com.acme.util.Assertions");
        assert_eq!(imports[0].symbols, vec!["check".to_string()]);
        let cands = module_ref_candidates(
            "java",
            "src/main/java/com/acme/web/Ctrl.java",
            &imports[0].path,
        );
        assert!(
            cands.contains(&"src/main/java/com/acme/util/Assertions.java".to_string()),
            "候选={:?}",
            cands
        );
    }

    #[test]
    fn ts_and_unknown_languages_get_no_module_candidates() {
        // 零回归护栏：TS/JS 走原有相对路径逻辑，本函数必须不插手
        assert!(module_ref_candidates("typescript", "src/a.ts", "./b").is_empty());
        assert!(module_ref_candidates("javascript", "src/a.js", "lodash").is_empty());
        assert!(module_ref_candidates("rust", "a.rs", "").is_empty());
        // 注：本用例原先也断言 `go` 返回空——那是在**记录**「Go 符号级引用恒为 0」这个缺陷，
        // 而非期望行为。Go 候选生成落地后该断言已失效，Go 的正向断言见
        // `go_module_path_strips_module_prefix` 等用例；`unsupported_language_still_returns_empty`
        // 继续守「未支持语言仍返回空」。
        assert!(module_ref_candidates("ruby", "a.rb", "foo").is_empty());
    }

    #[test]
    fn ts_module_candidates_resolves_relative_and_extension() {
        // 与主循环 import 解析口径一致：相对路径拼目录 + 补扩展名 / index / mod 变体
        let c = ts_module_candidates("src/app/consumer.ts", "./barrel");
        assert!(c.contains(&"src/app/barrel.ts".to_string()));
        assert!(c.contains(&"src/app/barrel.tsx".to_string()));
        assert!(c.contains(&"src/app/barrel/index.ts".to_string()));
        assert!(c.contains(&"src/app/barrel/mod.ts".to_string()));
        // 包名导入（无 ./）：保留原名并补扩展名 / index / mod 变体候选（与旧主循环口径一致）
        let c2 = ts_module_candidates("src/app/consumer.ts", "lodash");
        assert_eq!(c2.first(), Some(&"lodash".to_string()));
        assert!(c2.contains(&"lodash.ts".to_string()));
        assert!(c2.contains(&"lodash/index.ts".to_string()));
    }

    // ══════════════ TS 逐行回退 import 抽取：内联 `type` 限定符剥离（对标 joern import type）══════════════
    // 仅当 tree-sitter 主路径（extract_ts_imports）因 vue/SFC 或语法错整文件回退时走本函数；
    // 内联 `type` 是类型导入修饰符，绝不能并入符号名（否则产生 `type Foo` 幻影引用，永不命中）。
    #[test]
    fn ts_fallback_strips_inline_type_qualifier() {
        // `import { type Alpha, Beta }` → 必须是 [Alpha, Beta]，而非 [type Alpha, Beta]
        let imp = parse_ts_imports("import { type Alpha, Beta } from './mod';");
        assert_eq!(imp.len(), 1);
        assert_eq!(
            imp[0].symbols,
            vec!["Alpha".to_string(), "Beta".to_string()]
        );

        // `import type { Gamma }` 整条类型导入 → [Gamma]
        let whole = parse_ts_imports("import type { Gamma } from './t';");
        assert_eq!(whole[0].symbols, vec!["Gamma".to_string()]);

        // `import { type A, B as C }` 别名 + 内联 type 混合 → [A, B]
        let mixed = parse_ts_imports("import { type A, B as C } from './m';");
        assert_eq!(mixed[0].symbols, vec!["A".to_string(), "B".to_string()]);

        // `import type Foo from './x'`（默认类型导入）→ [Foo]
        let def = parse_ts_imports("import type Foo from './x';");
        assert_eq!(def[0].symbols, vec!["Foo".to_string()]);

        // 名为 `typeX` 的符号绝不被误伤
        let named_typex = parse_ts_imports("import { typeX, type Y } from './m';");
        assert_eq!(
            named_typex[0].symbols,
            vec!["typeX".to_string(), "Y".to_string()]
        );
    }

    // ══════════════ TS/JS barrel（再导出）链解析（对标 joern ReExport 语义）══════════════

    #[test]
    fn ts_wildcard_barrel_resolves_to_original_definition() {
        // consumer.ts:  `import { Foo } from "./barrel"`
        // barrel.ts:    `export * from "./foo"`   (wildcard 再导出，symbols 为空)
        // foo.ts:       `export class Foo {}`      (真定义)
        let name = "Foo";
        let path_to_id: HashMap<String, String> =
            [("src/app/foo.ts".to_string(), "foo_id".to_string())].into();
        // defines 模拟「foo.ts 仅定义 Foo」：与生产线闭包同构（捕获 name，按真实符号表判定）
        let res = resolve_symbol_via_reexports(
            "typescript",
            "src/app/consumer.ts",
            "./barrel",
            "src/app/barrel.ts",
            name,
            |rel| rel == "src/app/foo.ts" && name == "Foo",
            |rel| {
                if rel == "src/app/barrel.ts" {
                    vec![ParsedImport {
                        path: "./foo".to_string(),
                        line: 1,
                        symbols: vec![],
                    }]
                } else {
                    vec![]
                }
            },
            |from_rel, path| {
                ts_module_candidates(from_rel, path)
                    .into_iter()
                    .find(|c| path_to_id.contains_key(c))
            },
        );
        assert_eq!(res, Some("src/app/foo.ts".to_string()));
    }

    #[test]
    fn ts_named_reexport_resolves_to_original_definition() {
        // barrel.ts: `export { Foo } from "./foo"` → 点名再导出，优先级高于 wildcard
        let name = "Foo";
        let path_to_id: HashMap<String, String> =
            [("src/app/foo.ts".to_string(), "foo_id".to_string())].into();
        let res = resolve_symbol_via_reexports(
            "typescript",
            "src/app/consumer.ts",
            "./barrel",
            "src/app/barrel.ts",
            name,
            |rel| rel == "src/app/foo.ts" && name == "Foo",
            |rel| {
                if rel == "src/app/barrel.ts" {
                    vec![ParsedImport {
                        path: "./foo".to_string(),
                        line: 1,
                        symbols: vec!["Foo".to_string()],
                    }]
                } else {
                    vec![]
                }
            },
            |from_rel, path| {
                ts_module_candidates(from_rel, path)
                    .into_iter()
                    .find(|c| path_to_id.contains_key(c))
            },
        );
        assert_eq!(res, Some("src/app/foo.ts".to_string()));
    }

    #[test]
    fn ts_barrel_does_not_resolve_when_symbol_not_reexported() {
        // barrel `export * from "./foo"`，但 foo 只定义 Foo、不定义 Bar → 不猜（宁缺毋滥）
        let name = "Bar";
        let path_to_id: HashMap<String, String> =
            [("src/app/foo.ts".to_string(), "foo_id".to_string())].into();
        let res = resolve_symbol_via_reexports(
            "typescript",
            "src/app/consumer.ts",
            "./barrel",
            "src/app/barrel.ts",
            name,
            |rel| rel == "src/app/foo.ts" && name == "Foo",
            |rel| {
                if rel == "src/app/barrel.ts" {
                    vec![ParsedImport {
                        path: "./foo".to_string(),
                        line: 1,
                        symbols: vec![],
                    }]
                } else {
                    vec![]
                }
            },
            |from_rel, path| {
                ts_module_candidates(from_rel, path)
                    .into_iter()
                    .find(|c| path_to_id.contains_key(c))
            },
        );
        assert_eq!(res, None);
    }

    #[test]
    fn js_barrel_resolves_like_ts() {
        let name = "Foo";
        let path_to_id: HashMap<String, String> =
            [("src/app/foo.js".to_string(), "foo_id".to_string())].into();
        let res = resolve_symbol_via_reexports(
            "javascript",
            "src/app/consumer.js",
            "./barrel",
            "src/app/barrel.js",
            name,
            |rel| rel == "src/app/foo.js" && name == "Foo",
            |rel| {
                if rel == "src/app/barrel.js" {
                    vec![ParsedImport {
                        path: "./foo".to_string(),
                        line: 1,
                        symbols: vec![],
                    }]
                } else {
                    vec![]
                }
            },
            |from_rel, path| {
                ts_module_candidates(from_rel, path)
                    .into_iter()
                    .find(|c| path_to_id.contains_key(c))
            },
        );
        assert_eq!(res, Some("src/app/foo.js".to_string()));
    }

    #[test]
    fn ts_methods_are_extracted() {
        let src = "\
export class UserService {
  private cache = new Map();

  constructor(private api: Api) {}

  async fetchUser(id: string): Promise<User> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const u = await this.api.get(`/users/${id}`);
    this.cache.set(id, u);
    return u;
  }

  static create(): UserService {
    return new UserService(new Api());
  }

  get displayName(): string {
    return this.name ?? 'anon';
  }

  #secret(): void {
    this.secret = true;
  }
}
";
        let syms = extract_ts_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"class:UserService".to_string()),
            "class missing: {k:?}"
        );
        assert!(
            k.contains(&"method:constructor".to_string()),
            "constructor missing: {k:?}"
        );
        assert!(
            k.contains(&"method:fetchUser".to_string()),
            "fetchUser missing: {k:?}"
        );
        assert!(
            k.contains(&"method:create".to_string()),
            "static create missing: {k:?}"
        );
        assert!(
            k.contains(&"method:displayName".to_string()),
            "getter missing: {k:?}"
        );
        assert!(
            k.contains(&"method:secret".to_string()),
            "private missing: {k:?}"
        );
        // 方法体内的调用/属性不误报为方法
        assert!(
            !k.contains(&"method:get".to_string()),
            "this.get() 误报: {k:?}"
        );
        assert!(
            !k.contains(&"method:set".to_string()),
            "this.set() 误报: {k:?}"
        );
    }

    #[test]
    fn exported_data_const_is_symbolized() {
        // 此前只符号化 callable const，导致跨文件 import 数据常量时 to_symbol_id 恒为 None。
        let src = "\
export const API_URL = 'https://x';
export const LIMIT = 42;
export const CONFIG = { a: 1 };
export const ITEMS = [1, 2, 3];
export const ENABLED: boolean = true;
";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"API_URL"), "string const 漏: {names:?}");
        assert!(names.contains(&"LIMIT"), "numeric const 漏: {names:?}");
        assert!(names.contains(&"CONFIG"), "object const 漏: {names:?}");
        assert!(names.contains(&"ITEMS"), "array const 漏: {names:?}");
        assert!(names.contains(&"ENABLED"), "typed const 漏: {names:?}");
    }

    #[test]
    fn ts_file_with_style_comment_not_treated_as_vue() {
        // 回归：普通 .ts 文件注释/字符串里出现 `<style>` 字样不得被 looks_like_vue 误判为
        // Vue SFC 而走正则回退（正则不抽取 const，导致跨文件 import 的 to_symbol_id 恒 None）。
        // 复现 editor/renderers/canvasTheme.ts 第 12 行注释触发的历史死功能。
        let src = "// 注意把主题样式注入 <style> 标签\n
export const CV = { a: 1 } as const;
export const THEME = 'dark';
";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(
            names.contains(&"CV"),
            "含 <style> 注释的 .ts 被误当 SFC 回退, 数据常量漏: {names:?}"
        );
        assert!(
            names.contains(&"THEME"),
            "含 <style> 注释的 .ts 被误当 SFC 回退, 数据常量漏: {names:?}"
        );
    }

    #[test]
    fn split_export_const_is_symbolized() {
        // joern 全声明对标残留（待续②）：`const X = ...; export { X }` 分列式间接导出。
        // 旧实现只认行内 `export const X`（祖先判定），分列式再导出整批漏抓 →
        // 跨文件 `import { X }` 时 to_symbol_id 恒 None 的死功能。
        let src = "\
const API_URL = 'https://x';
const LIMIT = 42;
const CONFIG = { a: 1 };
export { API_URL, LIMIT, CONFIG };
";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"API_URL"), "分列式导出 const 漏: {names:?}");
        assert!(names.contains(&"LIMIT"), "分列式导出 const 漏: {names:?}");
        assert!(names.contains(&"CONFIG"), "分列式导出 const 漏: {names:?}");
    }

    #[test]
    fn split_export_with_alias_uses_local_name() {
        // `export { A as B }` 的本地符号是 A，别名 B 是外部名 → 符号名应为 A 而非 B。
        let src = "\
const FOO = 1;
export { FOO as BAR };
";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"FOO"), "分列式别名导出本地名漏: {names:?}");
        assert!(!names.contains(&"BAR"), "误把别名当本地符号: {names:?}");
    }

    #[test]
    fn export_from_specifier_does_not_create_phantom_local() {
        // `export { X } from './y'` 再导出的是导入符号，本地无声明 → 不得产生 X 符号。
        let src = "export { Something } from './other';";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(
            !names.contains(&"Something"),
            "外部再导出误建本地符号: {names:?}"
        );
    }

    #[test]
    fn mixed_inline_and_split_export_const_symbolized() {
        // 行内导出与分列式导出混用，全部应被符号化。
        let src = "\
export const INLINE = 1;
const SPLIT = 2;
export { SPLIT };
";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"INLINE"), "行内导出 const 漏: {names:?}");
        assert!(names.contains(&"SPLIT"), "分列式导出 const 漏: {names:?}");
    }

    /// 端到端真实回放（默认跳过）：
    /// `REPLAY_SPLIT_EXPORT_DIR=<目录> cargo test replay_split_export_consts -- --nocapture`
    ///
    /// 诚实度量 `export { X }` 分列式再导出修复的收益：对目录下每个 .ts/.tsx/.js/.jsx 文件，
    /// 分别用「完整 extract_ts_symbols」与「剥掉 `export {…}` 子句后的 extract_ts_symbols」
    /// （模拟修复前——仅行内 `export const` 才符号化）跑 A/B，二者 const 之差即本修复新符号化的常量数。
    /// 剥子句用字符级括号匹配，保留 `export const/function/class` 等行内导出（那是修复前已有的行为）。
    #[test]
    fn replay_split_export_consts() {
        let Ok(dir) = std::env::var("REPLAY_SPLIT_EXPORT_DIR") else {
            return;
        };

        fn strip_export_clauses(content: &str) -> String {
            let chars: Vec<char> = content.chars().collect();
            let n = chars.len();
            let mut out = String::with_capacity(content.len());
            let mut i = 0;
            while i < n {
                let is_export = i + 6 <= n
                    && chars[i] == 'e'
                    && chars[i + 1] == 'x'
                    && chars[i + 2] == 'p'
                    && chars[i + 3] == 'o'
                    && chars[i + 4] == 'r'
                    && chars[i + 5] == 't';
                let prev_ok = i == 0 || !(chars[i - 1].is_alphanumeric() || chars[i - 1] == '_');
                if is_export && prev_ok {
                    let mut j = i + 6;
                    while j < n && (chars[j] == ' ' || chars[j] == '\t' || chars[j] == '\n') {
                        j += 1;
                    }
                    if j < n && chars[j] == '{' {
                        let mut depth = 0usize;
                        let mut k = j;
                        let mut closed = false;
                        while k < n {
                            if chars[k] == '{' {
                                depth += 1;
                            } else if chars[k] == '}' {
                                depth -= 1;
                                if depth == 0 {
                                    closed = true;
                                    break;
                                }
                            }
                            k += 1;
                        }
                        if closed {
                            let mut k2 = k + 1;
                            while k2 < n && (chars[k2] == ' ' || chars[k2] == '\t') {
                                k2 += 1;
                            }
                            if k2 < n && chars[k2] == ';' {
                                k2 += 1;
                            }
                            i = k2;
                            continue;
                        }
                    }
                }
                out.push(chars[i]);
                i += 1;
            }
            out
        }

        let root = std::path::Path::new(&dir);
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else {
                return;
            };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
                        matches!(n, "node_modules" | "target" | ".git" | "dist" | "__bench__")
                    }) {
                        continue;
                    }
                    walk(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk(root, &mut files);
        let mut total_new = 0usize;
        let mut total_old = 0usize;
        let mut files_with_new = 0usize;
        let mut samples: Vec<String> = Vec::new();
        for f in &files {
            let Some(ext) = f.extension().and_then(|s| s.to_str()) else {
                continue;
            };
            if !matches!(ext, "ts" | "tsx" | "js" | "jsx") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            let new_const = extract_ts_symbols(&content)
                .into_iter()
                .filter(|s| s.kind == "const")
                .count();
            let old_const = extract_ts_symbols(&strip_export_clauses(&content))
                .into_iter()
                .filter(|s| s.kind == "const")
                .count();
            if new_const > old_const {
                files_with_new += 1;
                total_new += new_const;
                total_old += old_const;
                if samples.len() < 15 {
                    let rel = f
                        .strip_prefix(root)
                        .map(|r| r.to_string_lossy().to_string())
                        .unwrap_or_default();
                    samples.push(format!(
                        "{}: +{} const ({}→{})",
                        rel,
                        new_const - old_const,
                        old_const,
                        new_const
                    ));
                }
            }
        }
        eprintln!(
            "[split-export] files_with_new_split_const={} total_const_new={} total_const_old={}",
            files_with_new, total_new, total_old
        );
        for s in &samples {
            eprintln!("[split-export]   {}", s);
        }
    }

    #[test]
    fn exported_callable_const_not_double_counted_as_const() {
        // const fn = () => {} 已是 function 符号，不应再被当成 const 重复计入。
        let src = "export const make = () => 1;";
        let syms = extract_ts_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"function:make".to_string()),
            "callable const 应为 function: {k:?}"
        );
        assert!(
            !k.contains(&"const:make".to_string()),
            "callable const 不应是 const: {k:?}"
        );
    }

    #[test]
    fn local_non_exported_const_is_not_symbolized() {
        // 仅符号化导出常量：函数体内的局部 const 不得进入符号表（避免符号表爆炸）。
        let src = "function f() { const local = 42; const arr = [1]; return local; }";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(!names.contains(&"local"), "局部 const 误符号化: {names:?}");
        assert!(!names.contains(&"arr"), "局部 const 误符号化: {names:?}");
        assert!(names.contains(&"f"), "函数本身应存在: {names:?}");
    }

    #[test]
    fn destructuring_export_const_is_not_symbolized() {
        // export const { a, b } = obj 的名称是 object_pattern，非标识符，跳过。
        let src = "const src1 = { x: 1 }; export const { x } = src1;";
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(!names.contains(&"x"), "解构绑定误符号化: {names:?}");
    }

    #[test]
    fn ts_arrow_props_and_statements_not_methods() {
        let src = "\
class Panel {
  onClick = () => { this.fire('click'); };
  render() {
    if (this.state) { return null; }
    for (const x of items) { console.log(x); }
  }
}
";
        let syms = extract_ts_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"method:render".to_string()),
            "render missing: {k:?}"
        );
        assert!(
            !k.contains(&"method:onClick".to_string()),
            "箭头属性误报: {k:?}"
        );
        assert!(!k.contains(&"method:state".to_string()), "if 误报: {k:?}");
    }

    #[test]
    fn ts_tree_sitter_captures_decl_kinds() {
        // 验证 tree-sitter 版补全正则会漏掉的类型级符号（对标 joern 符号级节点遍历）。
        let src = "\
interface UserRepo {
  find(id: string): Promise<User>;
}
enum Status { Active, Inactive }
type Id = string | number;
const makeClient = (cfg: Cfg) => new Client(cfg);
export function bootstrap() {}
";
        let syms = extract_ts_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"interface:UserRepo".to_string()),
            "interface 漏抓: {k:?}"
        );
        assert!(k.contains(&"enum:Status".to_string()), "enum 漏抓: {k:?}");
        assert!(
            k.contains(&"type_alias:Id".to_string()),
            "type alias 漏抓: {k:?}"
        );
        assert!(
            k.contains(&"function:makeClient".to_string()),
            "箭头 const 应为 function: {k:?}"
        );
        assert!(
            k.contains(&"function:bootstrap".to_string()),
            "顶层 fn 漏抓: {k:?}"
        );
    }

    #[test]
    fn rust_impl_methods_are_methods() {
        let src = "\
pub struct Repository { conn: Db }

impl Repository {
    pub fn new() -> Self { Self { conn: Db::open() } }
    pub fn save(&self, item: &Item) -> Result<()> { self.conn.write(item) }
}

fn helper() {}
";
        let syms = extract_rust_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"struct:Repository".to_string()),
            "struct missing: {k:?}"
        );
        assert!(
            k.contains(&"method:new".to_string()),
            "impl new 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:save".to_string()),
            "impl save 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"function:helper".to_string()),
            "顶层 fn 应为 function: {k:?}"
        );
        assert!(
            !k.contains(&"function:save".to_string()),
            "save 不应是 function: {k:?}"
        );
    }

    /// 受限可见（`pub(crate)` / `pub(super)` / `pub(in path)`）必须与 `pub` 同等入表。
    ///
    /// 回归背景：`strip_keyword` 只认 `"pub "`，`pub(crate) fn` 紧跟 `(` 直接失配，
    /// 导致整条声明被静默丢弃。实测规模 tokio-1.53.1 = 1449/6821（21.2%）声明消失。
    #[test]
    fn rust_restricted_visibility_symbols_are_extracted() {
        let src = "\
pub(crate) fn looks_minified(source: &str) -> bool { false }
pub(crate) const DEP_KIND: &str = \"dynamic-import\";
pub(super) struct Inner { a: u8 }
pub(in crate::infrastructure) enum Mode { A, B }
pub(crate) trait Sink { fn emit(&self); }
pub(crate) mod helpers {}
pub(crate) type Alias = u32;
pub fn plain_public() {}
fn private_fn() {}
";
        let syms = extract_rust_symbols(src);
        let k = kinds_of(&syms);
        for want in [
            "function:looks_minified",
            "const:DEP_KIND",
            "struct:Inner",
            "enum:Mode",
            "trait:Sink",
            "module:helpers",
            "type_alias:Alias",
            "function:plain_public",
            "function:private_fn",
        ] {
            assert!(
                k.contains(&want.to_string()),
                "受限可见符号漏抓 {want}: {k:?}"
            );
        }
        // 可见性只是修饰符，不能污染符号名（`pub(crate)` 不得残留在 name 里）
        let mini = syms
            .iter()
            .find(|s| s.name == "looks_minified")
            .expect("looks_minified");
        assert_eq!(mini.kind, "function");
        assert!(
            mini.modifiers.contains("pub"),
            "pub(crate) 应记为 pub 修饰: {:?}",
            mini.modifiers
        );
    }

    /// item 关键字前的修饰符（async / unsafe / extern "C" / const fn / default）不得挡住符号。
    ///
    /// 回归背景：`pub async fn` 剥掉 `pub` 后 rest 以 `async` 开头，item 关键字循环全失配 ⇒
    /// 整条声明丢弃。实测规模 tokio-1.53.1 = 1208/8029（15.0%），其中 1205 条是 fn。
    #[test]
    fn rust_modifier_prefixed_symbols_are_extracted() {
        let src = "\
pub async fn spawn_task() {}
pub(crate) async fn inner_task() {}
pub unsafe fn raw_ptr() {}
pub(crate) unsafe trait Link { fn as_raw(&self); }
pub const fn zeroed() -> u8 { 0 }
pub unsafe extern \"C\" fn callback() {}
pub extern \"C\" fn abi_entry() {}
pub const MAX_RETRY: usize = 3;
pub(crate) const DEP_KIND: &str = \"x\";
pub static GLOBAL: u8 = 0;

unsafe impl Send for Link {}
impl Link {
    pub async fn connect(&self) {}
    pub unsafe fn detach(&self) {}
}
";
        let syms = extract_rust_symbols(src);
        let k = kinds_of(&syms);
        for want in [
            "function:spawn_task",
            "function:inner_task",
            "function:raw_ptr",
            "trait:Link",
            "function:zeroed",
            "function:callback",
            "function:abi_entry",
            // `const NAME: T` 的 const 是 item 关键字，绝不能被当修饰符剥掉
            "const:MAX_RETRY",
            "const:DEP_KIND",
            "const:GLOBAL",
        ] {
            assert!(
                k.contains(&want.to_string()),
                "修饰符前缀符号漏抓 {want}: {k:?}"
            );
        }
        // `unsafe impl` / `impl` 块内的方法必须是 method 而不是顶层 function
        assert!(
            k.contains(&"method:connect".to_string()),
            "impl 内 async fn 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:detach".to_string()),
            "impl 内 unsafe fn 应为 method: {k:?}"
        );
        assert!(
            !k.contains(&"function:connect".to_string()),
            "connect 不应是顶层 function: {k:?}"
        );
        let spawn = syms
            .iter()
            .find(|s| s.name == "spawn_task")
            .expect("spawn_task");
        assert!(
            spawn.modifiers.contains("async"),
            "async 应记入修饰符: {:?}",
            spawn.modifiers
        );
    }

    #[test]
    fn python_methods_follow_class_indent() {
        let src = "\
def module_fn():
    pass

class Service:
    def __init__(self, api):
        self.api = api

    def run(self):
        self.api.call()

def another():
    pass
";
        let syms = extract_python_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"class:Service".to_string()),
            "class missing: {k:?}"
        );
        assert!(
            k.contains(&"method:__init__".to_string()),
            "__init__ 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:run".to_string()),
            "run 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"function:module_fn".to_string()),
            "顶层 def 应为 function: {k:?}"
        );
        assert!(
            k.contains(&"function:another".to_string()),
            "class 后顶层 def 应为 function: {k:?}"
        );
    }

    #[test]
    fn go_methods_have_receiver() {
        let src = "\
type Store struct{ db Db }

func (s *Store) Get(id int) Item { return s.db.get(id) }
func (s *Store) Put(item Item) { s.db.put(item) }
func NewStore() *Store { return &Store{} }
";
        let syms = extract_go_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"method:Get".to_string()),
            "接收者方法应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:Put".to_string()),
            "接收者方法应为 method: {k:?}"
        );
        assert!(
            k.contains(&"function:NewStore".to_string()),
            "自由函数应为 function: {k:?}"
        );
    }

    #[test]
    fn java_methods_are_extracted() {
        let src = "\
public class AccountService {
    private final Ledger ledger;

    public AccountService(Ledger ledger) {
        this.ledger = ledger;
    }

    public Account get(long id) {
        if (id < 0) { return null; }
        return ledger.find(id);
    }

    public static AccountService create() {
        return new AccountService(new Ledger());
    }
}
";
        let syms = extract_java_symbols(src);
        let k = kinds_of(&syms);
        assert!(
            k.contains(&"class:AccountService".to_string()),
            "class missing: {k:?}"
        );
        assert!(
            k.contains(&"method:AccountService".to_string()),
            "构造器应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:get".to_string()),
            "get 应为 method: {k:?}"
        );
        assert!(
            k.contains(&"method:create".to_string()),
            "static create 应为 method: {k:?}"
        );
        assert!(
            !k.contains(&"method:find".to_string()),
            "ledger.find() 调用误报: {k:?}"
        );
        // 防误报验证：if 行不产生方法
        assert!(
            !k.iter().any(|s| s.contains("method:") && s.contains("id")),
            "if 误报: {k:?}"
        );
    }

    // ─── 文档注释提取（docsCoverage 真·数据来源）───

    #[test]
    fn ts_js_jsdoc_block_captured() {
        let src = "\
/**
 * 获取用户
 * @param id 用户 id
 */
export function fetchUser(id: string) {}
";
        let lines: Vec<&str> = src.lines().collect();
        // 声明行 fetchUser 在 0-based 下标 4
        let doc = extract_doc_comment("ts", &lines, 4);
        assert!(doc.is_some(), "JSDoc 未被捕获");
        let d = doc.unwrap();
        assert!(d.contains("获取用户"), "摘要缺失: {d}");
        assert!(d.contains("@param id"), "参数行缺失: {d}");
    }

    #[test]
    fn ts_js_no_doc_when_absent() {
        let src = "export function foo() {}\n";
        let lines: Vec<&str> = src.lines().collect();
        let doc = extract_doc_comment("ts", &lines, 0);
        assert!(doc.is_none(), "无文档注释时应返回 None");
    }

    #[test]
    fn rust_triple_slash_captured() {
        let src = "\
/// 计算总额
/// 含税
pub fn total(items: &[u32]) -> u32 { 0 }
";
        let lines: Vec<&str> = src.lines().collect();
        // pub fn total 在 0-based 下标 2
        let doc = extract_doc_comment("rust", &lines, 2);
        assert!(doc.is_some(), "/// 文档未被捕获");
        let d = doc.unwrap();
        assert!(d.contains("计算总额"), "首行缺失: {d}");
        assert!(d.contains("含税"), "次行缺失: {d}");
    }

    #[test]
    fn rust_four_slash_is_not_doc() {
        let src = "\
//// 内部备注
pub fn helper() {}
";
        let lines: Vec<&str> = src.lines().collect();
        let doc = extract_doc_comment("rust", &lines, 1);
        assert!(doc.is_none(), "`////` 不应被视为文档注释");
    }

    #[test]
    fn unsupported_lang_returns_none() {
        // 用真正未支持的语言（go）验证守卫
        let src = "func f() {}\n";
        let lines: Vec<&str> = src.lines().collect();
        let doc = extract_doc_comment("go", &lines, 0);
        assert!(doc.is_none(), "未支持语言应返回 None");
    }

    #[test]
    fn python_single_line_docstring_captured() {
        let src = "\
def fetch_user(id: int):
    \"\"\"获取用户\"\"\"
    return id
";
        let lines: Vec<&str> = src.lines().collect();
        // def fetch_user 在 0-based 下标 0，docstring 位于其下方
        let doc = extract_doc_comment("py", &lines, 0);
        assert!(doc.is_some(), "Python 单行 docstring 未被捕获");
        assert!(doc.unwrap().contains("获取用户"), "内容缺失");
    }

    #[test]
    fn python_multiline_docstring_captured() {
        let src = "\
def total(items):
    \"\"\"计算总额
    含税\"\"\"
    return 0
";
        let lines: Vec<&str> = src.lines().collect();
        // def total 在 0-based 下标 0
        let doc = extract_doc_comment("python", &lines, 0);
        assert!(doc.is_some(), "Python 多行 docstring 未被捕获");
        let d = doc.unwrap();
        assert!(d.contains("计算总额"), "首行缺失: {d}");
        assert!(d.contains("含税"), "次行缺失: {d}");
    }

    #[test]
    fn python_no_docstring_returns_none() {
        let src = "def foo():\n    return 1\n";
        let lines: Vec<&str> = src.lines().collect();
        let doc = extract_doc_comment("py", &lines, 0);
        assert!(doc.is_none(), "无 docstring 时应返回 None");
    }

    // ─── 设计模式重检测（redetect_design_patterns_impl）───
    fn redetect_repo() -> SqliteProjectSymbolRepository {
        use crate::infrastructure::database::Database;
        use rusqlite::Connection;
        use std::sync::{Arc, Mutex};

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE project_symbols (
                id TEXT, analysis_id TEXT, file_id TEXT, file_path TEXT,
                name TEXT, kind TEXT, line_start INTEGER, line_end INTEGER,
                signature TEXT, doc TEXT, modifiers TEXT, patterns TEXT,
                metadata TEXT, created_at INTEGER
            );",
        )
        .unwrap();
        SqliteProjectSymbolRepository::new(Arc::new(Database(Mutex::new(conn))))
    }

    /// 在临时目录写一个受控源码文件，返回 (root, rel_path)
    fn write_tmp_src(name: &str, content: &str) -> (String, String) {
        let dir = std::env::temp_dir().join(format!("ps_redetect_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        (dir.to_string_lossy().to_string(), name.to_string())
    }

    #[test]
    fn redetect_populates_patterns_from_source() {
        let repo = redetect_repo();
        // 命名即模式：类名以 Service 结尾，命中 service（与扫描链同款引擎）
        let (root, rel) = write_tmp_src(
            "a.ts",
            "export class ProjectStoreService {\n  constructor(private api: Api) {}\n}\n",
        );
        let sym = ProjectSymbol {
            id: "sym_redetect_1".into(),
            analysis_id: "a".into(),
            file_id: "f1".into(),
            file_path: rel,
            name: "ProjectStoreService".into(),
            kind: "class".into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: "[]".into(),
            metadata: r#"{"language":"typescript"}"#.into(),
            created_at: 0,
        };
        repo.save_batch(&[sym]).unwrap();

        let hits = redetect_design_patterns_impl(&repo, "a", &root).unwrap();
        assert!(!hits.is_empty(), "对源码重检测应能识别 service 模式");
        assert_eq!(hits[0].pattern, "service");

        let updated = repo.list_by_analysis("a").unwrap();
        assert!(
            updated[0].patterns.contains("service"),
            "patterns 列应被回写：{}",
            updated[0].patterns
        );
        assert!(
            updated[0].metadata.contains("patternDetail"),
            "metadata 应写入 patternDetail：{}",
            updated[0].metadata
        );
    }

    #[test]
    fn redetect_clears_stale_patterns_when_none_detected() {
        let repo = redetect_repo();
        // 旧引擎误判为 factory（裸子串），重检测应清掉
        let (root, rel) = write_tmp_src(
            "b.ts",
            "export function formatLabel(x: number): string {\n  return String(x);\n}\n",
        );
        let sym = ProjectSymbol {
            id: "sym_redetect_2".into(),
            analysis_id: "a".into(),
            file_id: "f2".into(),
            file_path: rel,
            name: "formatLabel".into(),
            kind: "function".into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: "[\"factory\"]".into(),
            metadata: r#"{"language":"typescript","patternDetail":[{"id":"factory"}]}"#.into(),
            created_at: 0,
        };
        repo.save_batch(&[sym]).unwrap();

        let hits = redetect_design_patterns_impl(&repo, "a", &root).unwrap();
        assert!(hits.is_empty(), "formatLabel 不应被识别为任何模式");
        let updated = repo.list_by_analysis("a").unwrap();
        assert_eq!(updated[0].patterns, "[]", "陈旧 patterns 应被清空");
    }

    #[test]
    fn redetect_reports_error_when_no_source_files() {
        let repo = redetect_repo();
        // 符号存在、路径相对 project_root，但磁盘上该源码文件不存在（项目被移动/根目录不对）。
        // 此前会静默「无数据」让用户误以为功能失效；现在应明确报错引导校正根目录。
        let sym = ProjectSymbol {
            id: "sym_redetect_3".into(),
            analysis_id: "a".into(),
            file_id: "f3".into(),
            file_path: "src/missing/Service.ts".into(),
            name: "ProjectStoreService".into(),
            kind: "class".into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: String::new(),
            patterns: "[]".into(),
            metadata: r#"{"language":"typescript"}"#.into(),
            created_at: 0,
        };
        repo.save_batch(&[sym]).unwrap();

        // 用一个不存在源码的根目录：所有候选路径都读不到
        let missing_root = std::env::temp_dir()
            .join(format!("ps_redetect_missing_{}", std::process::id()))
            .to_string_lossy()
            .to_string();
        let result = redetect_design_patterns_impl(&repo, "a", &missing_root);
        assert!(
            result.is_err(),
            "源码全部缺失时应返回明确错误而非静默空结果"
        );
        let msg = result.err().unwrap().to_string();
        assert!(
            msg.contains("未匹配到任何源码文件"),
            "错误信息应明确指向源码缺失：{msg}"
        );
    }

    /// 真实用户场景：存量扫描是旧保守引擎产物，`patterns` 列为空；用户点开
    /// 「更多画像 → 设计模式」，前端对源码重检测（redetect）。本测试验证重检测
    /// 路径能正确识别现代 TS/React 代码库里以「函数 / 箭头常量」形态表达的设计模式
    /// （Zustand store / 自定义 Hook / HOC / 函数式工厂 / Provider），即 v2.24 修复目标。
    #[test]
    fn redetect_functional_patterns_from_source() {
        let repo = redetect_repo();
        let (root, rel) = write_tmp_src(
            "app.tsx",
            r#"
import { create } from "zustand";
import { useState, useEffect } from "react";

// 状态容器（Zustand）：命名即模式，箭头常量
export const useAppStore = create<{ count: number }>()((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

// 自定义 Hook：useXxx 且内部调用其它 Hook
export function useToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {}, [on]);
  return [on, () => setOn(!on)] as const;
}

// 高阶组件：withXxx，返回增强后的组件
export const withLogger = (Component) => (props) => <Component {...props} />;

// 函数式工厂：createXxx 命名，返回新对象
export function createApiClient(baseUrl: string) {
  return { get: (p: string) => fetch(baseUrl + p) };
}

// 提供方：XxxProvider，接收 children
export function ThemeProvider({ children }: { children: any }) {
  const [theme, setTheme] = useState("dark");
  return <Context.Provider value={{ theme, setTheme }}>{children}</Context.Provider>;
}
"#,
        );

        // 符号 kind 与扫描链一致：const 声明 → "const"，function 声明 → "function"
        let mut ordinal = 0usize;
        let mut syms: Vec<ProjectSymbol> = Vec::new();
        let lines = [
            ("useAppStore", "const", 7i64),
            ("useToggle", "function", 12),
            ("withLogger", "const", 18),
            ("createApiClient", "function", 22),
            ("ThemeProvider", "function", 27),
        ];
        for (name, kind, line) in lines.iter() {
            syms.push(ProjectSymbol {
                id: format!("sym_fn_{}_{}", name, ordinal),
                analysis_id: "a".into(),
                file_id: "f1".into(),
                file_path: rel.clone(),
                name: name.to_string(),
                kind: kind.to_string(),
                line_start: *line,
                line_end: *line + 1,
                signature: String::new(),
                doc: None,
                modifiers: String::new(),
                patterns: "[]".into(),
                metadata: r#"{"language":"typescript"}"#.into(),
                created_at: 0,
            });
            ordinal += 1;
        }
        repo.save_batch(&syms).unwrap();

        let hits = redetect_design_patterns_impl(&repo, "a", &root).unwrap();
        let found: std::collections::HashSet<String> =
            hits.iter().map(|h| h.pattern.clone()).collect();
        assert!(
            found.contains("store"),
            "Zustand 箭头常量应被识别为 store，实际命中：{:?}",
            found
        );
        assert!(
            found.contains("hook"),
            "useToggle 应被识别为自定义 Hook，实际命中：{:?}",
            found
        );
        assert!(
            found.contains("hoc"),
            "withLogger 应被识别为高阶组件，实际命中：{:?}",
            found
        );
        assert!(
            found.contains("factory_fn"),
            "createApiClient 应被识别为函数式工厂，实际命中：{:?}",
            found
        );
        assert!(
            found.contains("provider"),
            "ThemeProvider 应被识别为提供方，实际命中：{:?}",
            found
        );

        // 回写校验：patterns 列应非空且包含上述种类
        let updated = repo.list_by_analysis("a").unwrap();
        for s in &updated {
            assert_ne!(
                s.patterns, "[]",
                "符号 {} 重检测后 patterns 不应仍为空",
                s.name
            );
            assert!(
                s.metadata.contains("patternDetail"),
                "符号 {} metadata 应写入 patternDetail",
                s.name
            );
        }
    }

    /// v2.27 回归：现代 TS/React 柯里化写法（箭头在下一行）必须被符号化，
    /// 否则设计模式画像永远拿不到 store/hoc 等函数式模式的符号 —— 即「不能用」的真根因之一。
    #[test]
    fn extract_ts_symbols_catches_multiline_curried_const() {
        let src = r#"
import { create } from "zustand";

export const useAppStore = create<{ count: number }>()(
  (set) => ({
    count: 0,
    inc: () => set((s) => ({ count: s.count + 1 })),
  })
);

export const withLogger = (Component: any) => (props: any) => (
  <Component {...props} />
);
"#;
        let syms = extract_ts_symbols(src);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(
            names.contains(&"useAppStore"),
            "柯里化 Zustand store 应被提取，实际：{:?}",
            names
        );
        assert!(
            names.contains(&"withLogger"),
            "柯里化 HOC 应被提取，实际：{:?}",
            names
        );
        // 提取到的符号 kind 必须为 function，才能通过 detect 的 functional_kind 门禁
        let store = syms.iter().find(|s| s.name == "useAppStore").unwrap();
        assert_eq!(store.kind, "function", "柯里化 const 应归类为 function");
    }
}
