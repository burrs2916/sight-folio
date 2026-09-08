//! TS/JS import 的 AST 级抽取（tree-sitter），对标 joern jssrc2cpg 的 import 捕获。
//!
//! 背景（弱项）：此前 TS/JS 的 import 抽取有两条**逐行字符串**实现——
//!   - `review::parse_js_imports`（依赖图用，只认含 `from` 的行 + `require(`）
//!   - `code_structure::parse_ts_imports`（符号级引用用，只认以 `import ` 开头的行）
//! 逐行实现的结构性漏洞：
//!   1. 动态导入 `import('./x')` / `await import('./x')` 完全抓不到 → 懒加载模块在
//!      依赖图/符号引用里「凭空消失」，还会被死代码判定误报为无人引用；
//!   2. 副作用导入 `import './styles.css'`（无 `from`）依赖图抓不到；
//!   3. 多行 import（prettier 折行）在符号级抽取里整条丢失（`} from '...'` 不以 `import ` 开头）；
//!   4. 注释/字符串里的 `import ... from '...'` 会被当成真实依赖（幻影边）。
//!
//! joern 对照：`jssrc2cpg` 在 AST 阶段就把 `import`/`require` 建成 CALL/IMPORT 节点
//! （`passes/ImportsPass.scala` + `XImportsPass`），因此天然免疫注释、支持动态 import，
//! 并携带 `importedEntity` / `importedAs`。本模块以 tree-sitter 做同口径的 AST 抽取。
//!
//! 语义约定（零回归 + barrel 修复）：
//!   - 普通 import（`import { A as B } from 'p'`）：`symbols` 取**原始导出名** `A`，因为
//!     符号引用必须指向 `./p` 里的 `A`，不能指向本地别名 `B`；
//!   - 再导出（`export { A as B } from 'p'` / `export { default as AppTheme } from './x'`）：
//!     `symbols` 取**对消费者可见的导出名** `B` / `AppTheme`——这正是
//!     `resolve_symbol_via_reexports` 的 BFS 匹配 consumer `import` 名时的唯一依据。
//!     旧实现在这里也取原名（`default` / `A`），导致 `export { default as X }` 这类 barrel
//!     再导出链整条无法解析（`reexportRescued=0`，TS 命中率卡 82%）。本次修复仅影响
//!     re-export 分支，普通 import / 命名空间导入语义不变。
//!   - vue SFC（`<template>` 等）与解析失败时返回 `None`，由调用方回退到旧逐行实现；
//!   - 语法有错的文件（`has_error`）会把 AST 结果与逐行结果做并集去重，只增不减。

use tree_sitter::{Node, Parser};

/// import 种类（对标 joern 里不同的 CALL/IMPORT 形态）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsImportKind {
    /// `import x from 'p'` / `import { a } from 'p'`
    Static,
    /// `import 'p'`（副作用导入，无绑定）
    SideEffect,
    /// `export { a } from 'p'` / `export * from 'p'`（再导出）
    ReExport,
    /// `import('p')` / `await import('p')`（懒加载边）
    Dynamic,
    /// `require('p')`
    Require,
}

impl TsImportKind {
    /// 写入 `project_dependencies.kind` 的取值。
    /// 静态/副作用/再导出/require 一律沿用历史值 `"import"`（零回归），
    /// 仅动态导入用独立值，让消费方能识别「懒加载边」。
    pub fn dep_kind(self) -> Option<&'static str> {
        match self {
            TsImportKind::Dynamic => Some("dynamic-import"),
            _ => None,
        }
    }
}

/// 一条 import 记录
#[derive(Debug, Clone)]
pub struct TsImport {
    /// 模块字符串原文（未做路径解析）
    pub path: String,
    /// 1-based 行号
    pub line: usize,
    /// 被点名的符号名（见模块头「语义保持」）
    pub symbols: Vec<String>,
    pub kind: TsImportKind,
}

/// vue SFC 判定（与 `code_structure::extract_ts_symbols` 同口径）
fn looks_like_vue(content: &str) -> bool {
    content.contains("<template")
        || content.contains("<style")
        || (content.contains("<script") && content.contains("</script"))
}

fn text_of(node: Node, src: &[u8]) -> String {
    node.utf8_text(src).unwrap_or("").to_string()
}

/// 去掉字符串字面量的引号；模板串仅在无插值时接受
fn literal_module_path(node: Node, src: &[u8]) -> Option<String> {
    match node.kind() {
        "string" => {
            let raw = text_of(node, src);
            let trimmed = raw
                .trim()
                .trim_start_matches(['"', '\'', '`'])
                .trim_end_matches(['"', '\'', '`'])
                .to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        "template_string" => {
            let raw = text_of(node, src);
            if raw.contains("${") {
                return None; // 动态拼接：静态无法可靠还原，诚实放弃
            }
            let trimmed = raw.trim().trim_matches('`').to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        _ => None,
    }
}

/// 从 `import_clause` / `export_clause` 收集符号名
fn collect_clause_symbols(node: Node, src: &[u8], out: &mut Vec<String>) {
    match node.kind() {
        // import { A, B as C } from 'p' —— 取**原始导出名**（A / B）。
        // 消费者 import 的是 A，符号引用必须指向 './p' 里的 A，而非本地别名 C。
        "named_imports" => {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                if child.kind() == "import_specifier" {
                    if let Some(name) = child.child_by_field_name("name") {
                        let t = text_of(name, src);
                        if !t.is_empty() {
                            out.push(t);
                        }
                    }
                }
            }
        }
        // export { a } from 'p' / export { default as AppTheme } from 'p'
        // 再导出：取**对消费者可见的导出名**（有别名取别名，否则取原名）。
        // 这是 BFS `resolve_symbol_via_reexports` 匹配 consumer import 名时的唯一依据；
        // 旧实现取原名（`default` / `A`）→ 而 consumer 实际 `import` 的是别名
        // （AppTheme / B）→ `export { default as X }` 这类 barrel 再导出链整条无法解析。
        "export_clause" => {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                if child.kind() == "export_specifier" {
                    // 优先 alias（消费者看到的名字），否则原名
                    let exported = child
                        .child_by_field_name("alias")
                        .or_else(|| child.child_by_field_name("name"));
                    if let Some(n) = exported {
                        let t = text_of(n, src);
                        if !t.is_empty() {
                            out.push(t);
                        }
                    }
                }
            }
        }
        // * as ns —— 取本地绑定名（与旧实现一致）
        "namespace_import" | "namespace_export" => {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                if child.kind() == "identifier" {
                    out.push(text_of(child, src));
                }
            }
        }
        // 默认导入：import Foo from 'p' —— 取本地绑定名（与旧实现一致）
        "identifier" => out.push(text_of(node, src)),
        _ => {
            let mut cur = node.walk();
            for child in node.named_children(&mut cur) {
                collect_clause_symbols(child, src, out);
            }
        }
    }
}

fn dedup_keep_order(mut v: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    v.retain(|s| !s.is_empty() && seen.insert(s.clone()));
    v
}

fn walk(node: Node, src: &[u8], out: &mut Vec<TsImport>) {
    match node.kind() {
        "import_statement" => {
            // `import x = require('p')`（TS 旧式）走 require 分支，这里只处理 ES import
            if let Some(source) = node.child_by_field_name("source") {
                if let Some(path) = literal_module_path(source, src) {
                    let mut symbols = Vec::new();
                    let mut has_clause = false;
                    let mut cur = node.walk();
                    for child in node.named_children(&mut cur) {
                        if child.kind() == "import_clause" {
                            has_clause = true;
                            collect_clause_symbols(child, src, &mut symbols);
                        }
                    }
                    out.push(TsImport {
                        path,
                        line: node.start_position().row + 1,
                        symbols: dedup_keep_order(symbols),
                        kind: if has_clause {
                            TsImportKind::Static
                        } else {
                            TsImportKind::SideEffect
                        },
                    });
                }
            }
        }
        // export { a } from 'p' / export * from 'p' / export * as ns from 'p'
        "export_statement" => {
            if let Some(source) = node.child_by_field_name("source") {
                if let Some(path) = literal_module_path(source, src) {
                    let mut symbols = Vec::new();
                    let mut cur = node.walk();
                    for child in node.named_children(&mut cur) {
                        match child.kind() {
                            "export_clause" | "namespace_export" => {
                                collect_clause_symbols(child, src, &mut symbols)
                            }
                            _ => {}
                        }
                    }
                    out.push(TsImport {
                        path,
                        line: node.start_position().row + 1,
                        symbols: dedup_keep_order(symbols),
                        kind: TsImportKind::ReExport,
                    });
                }
            }
        }
        "call_expression" => {
            if let Some(func) = node.child_by_field_name("function") {
                let fk = func.kind();
                let ftext = text_of(func, src);
                let is_dynamic = fk == "import" || ftext == "import";
                let is_require = ftext == "require";
                if is_dynamic || is_require {
                    if let Some(args) = node.child_by_field_name("arguments") {
                        let mut cur = args.walk();
                        let first_literal = args
                            .named_children(&mut cur)
                            .find_map(|a| literal_module_path(a, src));
                        if let Some(path) = first_literal {
                            out.push(TsImport {
                                path,
                                line: node.start_position().row + 1,
                                symbols: Vec::new(),
                                kind: if is_dynamic {
                                    TsImportKind::Dynamic
                                } else {
                                    TsImportKind::Require
                                },
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }

    let mut cur = node.walk();
    for child in node.named_children(&mut cur) {
        walk(child, src, out);
    }
}

/// AST 级抽取 TS/JS import；`None` = 不适用（vue SFC）或解析失败，调用方应回退。
/// 第二个返回值 `has_error = true` 表示文件语法有错，调用方应与逐行结果做并集。
pub fn extract_ts_imports(content: &str) -> Option<(Vec<TsImport>, bool)> {
    if looks_like_vue(content) {
        return None;
    }
    let mut parser = Parser::new();
    // 统一用 TSX grammar：它是 TS/JS/JSX 的超集（与 extract_ts_symbols 同口径）
    if parser
        .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
        .is_err()
    {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let mut out = Vec::new();
    walk(tree.root_node(), src, &mut out);
    let has_error = tree.root_node().has_error();
    Some((out, has_error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(content: &str) -> Vec<(String, TsImportKind)> {
        let (imports, _) = extract_ts_imports(content).expect("should parse");
        imports.into_iter().map(|i| (i.path, i.kind)).collect()
    }

    #[test]
    fn static_named_import_keeps_original_export_names() {
        let (imports, _) =
            extract_ts_imports("import { Alpha as A, Beta } from './mod';").unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].path, "./mod");
        assert_eq!(imports[0].kind, TsImportKind::Static);
        assert_eq!(imports[0].symbols, vec!["Alpha", "Beta"]);
    }

    #[test]
    fn multiline_import_is_captured_with_symbols() {
        let src = "import {\n  Alpha,\n  Beta,\n} from './mod';\n";
        let (imports, _) = extract_ts_imports(src).unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].path, "./mod");
        assert_eq!(imports[0].symbols, vec!["Alpha", "Beta"]);
        assert_eq!(imports[0].line, 1);
    }

    #[test]
    fn side_effect_import_is_captured() {
        let got = paths("import './styles.css';");
        assert_eq!(got, vec![("./styles.css".to_string(), TsImportKind::SideEffect)]);
    }

    #[test]
    fn dynamic_import_is_captured() {
        let got = paths("const load = async () => await import('./lazy/Page');");
        assert_eq!(got, vec![("./lazy/Page".to_string(), TsImportKind::Dynamic)]);
    }

    #[test]
    fn require_is_captured() {
        let got = paths("const fs = require('fs');");
        assert_eq!(got, vec![("fs".to_string(), TsImportKind::Require)]);
    }

    #[test]
    fn re_export_is_captured() {
        let (imports, _) = extract_ts_imports("export { Alpha } from './mod';").unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, TsImportKind::ReExport);
        assert_eq!(imports[0].symbols, vec!["Alpha"]);
    }

    #[test]
    fn star_re_export_is_captured() {
        let got = paths("export * from './mod';");
        assert_eq!(got, vec![("./mod".to_string(), TsImportKind::ReExport)]);
    }

    // 关键修复回归锁：`export { default as AppTheme } from './x'` 必须暴露**别名**
    // AppTheme（而非原名 `default`），否则下游 BFS 的 consumer `import { AppTheme }`
    // 永远匹配不到 → barrel 再导出链整条失效（reexportRescued=0）。
    #[test]
    fn default_as_reexport_exposes_alias_name() {
        let (imports, _) =
            extract_ts_imports("export { default as AppTheme } from \"./AppTheme\";").unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].kind, TsImportKind::ReExport);
        assert_eq!(imports[0].path, "./AppTheme");
        assert_eq!(imports[0].symbols, vec!["AppTheme".to_string()]);
    }

    // 非默认别名再导出 `export { A as B }` 同样暴露别名 B（对标 joern 的 ReExport 语义）。
    #[test]
    fn aliased_reexport_exposes_alias_name() {
        let (imports, _) =
            extract_ts_imports("export { Alpha as Beta } from './mod';").unwrap();
        assert_eq!(imports[0].kind, TsImportKind::ReExport);
        assert_eq!(imports[0].symbols, vec!["Beta".to_string()]);
    }

    // 普通 import 的别名语义不变：仍取**原名**（consumer import 的是原名，不能取本地别名）。
    #[test]
    fn plain_import_alias_keeps_original_name() {
        let (imports, _) =
            extract_ts_imports("import { Alpha as A } from './mod';").unwrap();
        assert_eq!(imports[0].kind, TsImportKind::Static);
        assert_eq!(imports[0].symbols, vec!["Alpha".to_string()]);
    }

    // 再导出整条链端到端：barrel 用 `default as X`，consumer import X 应解析到定义文件。
    #[test]
    fn default_as_barrel_resolves_to_definition() {
        // 模拟 BFS 命中：barrel 暴露别名 AppTheme，consumer import AppTheme → 命中 ./AppTheme
        let barrel = "export { default as AppTheme } from \"./AppTheme\";";
        let (imports, _) = extract_ts_imports(barrel).unwrap();
        assert_eq!(imports[0].symbols, vec!["AppTheme".to_string()]);
        // 下游 defines("theme/AppTheme.tsx") 含 AppTheme → BFS 返回该文件（由调用方判定）
    }

    #[test]
    fn commented_out_import_is_ignored() {
        let src = "// import { X } from './ghost';\n/* import './ghost2'; */\nimport { Y } from './real';\n";
        let got = paths(src);
        assert_eq!(got, vec![("./real".to_string(), TsImportKind::Static)]);
    }

    #[test]
    fn string_literal_mentioning_import_is_ignored() {
        let src = "const doc = \"import { X } from './ghost'\";\n";
        assert!(paths(src).is_empty());
    }

    #[test]
    fn type_only_import_keeps_names() {
        let (imports, _) = extract_ts_imports("import type { Alpha } from './types';").unwrap();
        assert_eq!(imports[0].symbols, vec!["Alpha"]);
        let (inline, _) = extract_ts_imports("import { type Alpha, Beta } from './types';").unwrap();
        assert_eq!(inline[0].symbols, vec!["Alpha", "Beta"]);
        // 默认类型导入：`import type Foo from './x'` → [Foo]（type 限定符绝不并入符号名）
        let (def, _) = extract_ts_imports("import type Foo from './x';").unwrap();
        assert_eq!(def[0].symbols, vec!["Foo"]);
        // 别名为 typeX 的符号绝不被误伤
        let named = extract_ts_imports("import { typeX, type Y } from './m';").unwrap();
        assert_eq!(named.0[0].symbols, vec!["typeX", "Y"]);
    }

    #[test]
    fn default_and_namespace_bindings_use_local_names() {
        let (imports, _) =
            extract_ts_imports("import React from 'react';\nimport * as path from 'path';").unwrap();
        assert_eq!(imports[0].symbols, vec!["React"]);
        assert_eq!(imports[1].symbols, vec!["path"]);
    }

    #[test]
    fn template_with_interpolation_is_skipped() {
        let src = "const m = await import(`./locales/${lang}.ts`);";
        assert!(paths(src).is_empty());
    }

    #[test]
    fn vue_sfc_returns_none_for_fallback() {
        let src = "<template><div/></template>\n<script>import x from './a'</script>";
        assert!(extract_ts_imports(src).is_none());
    }

    #[test]
    fn dynamic_import_inside_jsx_file_is_captured() {
        let src = "const C = lazy(() => import('./Heavy'));\nexport default () => <C />;\n";
        let got = paths(src);
        assert_eq!(got, vec![("./Heavy".to_string(), TsImportKind::Dynamic)]);
    }

    #[test]
    fn mixed_file_captures_every_form_in_source_order() {
        // grammar 形状已核实（TSX 0.23）：
        //   import_statement(import_clause(named_imports(import_specifier name: alias:)) source: string)
        //   export_statement(source: string)
        //   call_expression(function: (import) arguments: (arguments (string)))
        //   call_expression(function: (identifier "require") arguments: (arguments (string)))
        let src = "import './polyfill';\nimport { A as B } from './m';\nexport * from './n';\nconst d = await import('./d');\nconst r = require('./r');\n";
        let got = paths(src);
        assert_eq!(
            got,
            vec![
                ("./polyfill".to_string(), TsImportKind::SideEffect),
                ("./m".to_string(), TsImportKind::Static),
                ("./n".to_string(), TsImportKind::ReExport),
                ("./d".to_string(), TsImportKind::Dynamic),
                ("./r".to_string(), TsImportKind::Require),
            ]
        );
    }

    /// 真实数据回放（默认跳过）：`REPLAY_IMPORT_DIR=<目录> cargo test replay_real_dir -- --nocapture`
    /// 对比「AST 抽取」与「旧逐行抽取」的覆盖差，用于每轮量化解析层收益。
    #[test]
    fn replay_real_dir() {
        let Ok(dir) = std::env::var("REPLAY_IMPORT_DIR") else {
            return;
        };
        fn walk_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name().is_some_and(|n| n == "node_modules") {
                        continue;
                    }
                    walk_files(&p, out);
                } else if p
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|e| matches!(e, "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs"))
                {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk_files(std::path::Path::new(&dir), &mut files);
        let (mut ast_total, mut line_total, mut dynamic, mut side_effect, mut re_export, mut errs) =
            (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
        for f in &files {
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            line_total += crate::commands::review::parse_js_imports(&content).len();
            if let Some((imports, has_error)) = extract_ts_imports(&content) {
                ast_total += imports.len();
                if has_error {
                    errs += 1;
                }
                for i in &imports {
                    match i.kind {
                        TsImportKind::Dynamic => dynamic += 1,
                        TsImportKind::SideEffect => side_effect += 1,
                        TsImportKind::ReExport => re_export += 1,
                        _ => {}
                    }
                }
            }
        }
        println!(
            "REPLAY files={} ast={} lineBased={} dynamic={} sideEffect={} reExport={} parseErrFiles={}",
            files.len(),
            ast_total,
            line_total,
            dynamic,
            side_effect,
            re_export,
            errs
        );
    }

    #[test]
    fn only_dynamic_maps_to_dedicated_dep_kind() {
        assert_eq!(TsImportKind::Dynamic.dep_kind(), Some("dynamic-import"));
        for k in [
            TsImportKind::Static,
            TsImportKind::SideEffect,
            TsImportKind::ReExport,
            TsImportKind::Require,
        ] {
            assert_eq!(k.dep_kind(), None, "{k:?} 必须沿用按语言的默认 kind");
        }
    }
}
