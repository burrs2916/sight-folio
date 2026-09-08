//! 非 TS/JS 语言的 import / 依赖级抽取（tree-sitter AST），对标 joern 各 frontend 的 import 捕获。
//!
//! 背景（弱项，续 WP5 的 TS/JS AST import）：
//!   此前 Python/Rust/Go/C-C++/Java 的依赖级 import 仍走**逐行正则**
//!   （`review::parse_*_imports`），结构性漏洞与 WP5 描述的 TS/JS 旧实现同型：
//!     1. 多行 import 整条丢失：`from x import (\n  a,\n  b,\n)` / `import (\n "a"\n "b"\n)` /
//!        `use std::fs::{\n  File,\n  Path,\n}`；
//!     2. 注释 / 字符串里的 `import` / `#include` / `use` 被当真实依赖（幻影边）；
//!     3. 分组 `import (...)` / `use {..}` 块只能靠行首匹配，折行即漏；
//!     4. `has_error` 文件（语法局部出错）逐行实现整文件不可靠。
//!
//! joern 对照：pysrc2cpg `ImportsPass`、gosrc2cpg `DependencySrcProcessor`、c2cpg 的
//! `#include` 解析、javasrc2cpg 的 import 节点——都在 AST 阶段建成依赖边，天然免疫注释、
//! 支持多行与分组块。本模块以 tree-sitter 做同口径抽取。
//!
//! 语义保持（零回归约定，对标 WP5 `ts.rs::parse_deps`）：
//!   - 每个 parser 的 `parse_deps` 优先调用本模块；`None`（grammar 未就绪 / 解析失败）回退旧逐行；
//!   - 语法有错（`has_error`）时，与旧逐行结果做并集去重，只增不减；
//!   - 不设置 `kind`（保持 `None`），消费方 `detect_dependencies` 仍按语言给
//!     `use` / `include` / `import` 默认种类，与历史行为完全一致；
//!   - 仅抽取「依赖图的模块路径」维度；符号级引用（`parse_imports_with_symbols`）保持既有实现。

use std::collections::HashSet;

use tree_sitter::{Node, Parser};

use crate::infrastructure::ast::Dialect;
use crate::parser::DepImport;

fn text_of(node: Node, src: &[u8]) -> String {
    node.utf8_text(src).unwrap_or("").to_string()
}

/// 去掉字符串字面量两端的引号（Go `interpreted_string_literal` / C `string_literal` 都带引号）
fn strip_quotes(s: &str) -> String {
    let t = s.trim();
    let n = t.len();
    if n >= 2 && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
    {
        return t[1..n - 1].to_string();
    }
    t.to_string()
}

/// 构造一条依赖级 import（kind 默认 None，沿用语言默认种类）
fn dep(path: String, node: Node) -> DepImport {
    DepImport {
        path,
        line: node.start_position().row + 1,
        kind: None,
    }
}

/// Rust `use a::b::{c, d}` / `use a::b as c` 取模块前缀（与旧 `parse_rust_imports` 口径一致）
fn rust_module_path(arg: Node, src: &[u8]) -> String {
    let mut t = text_of(arg, src);
    // 去花括号部分：`use std::fs::{File, Path}` → `std::fs`
    if let Some(idx) = t.find('{') {
        t = t[..idx].to_string();
    }
    // 去尾随 `::`
    t = t.trim_end_matches("::").to_string();
    // 去 ` as alias`：`use a::b as c` → `a::b`（旧实现会把 ` as c` 当成路径末尾，这里顺手修掉）
    if let Some(idx) = t.rfind(" as ") {
        t = t[..idx].to_string();
    }
    t.trim().to_string()
}

/// AST 级抽取 import（依赖图维度）。
///
/// 返回 `None` = grammar 解析失败，调用方应回退旧逐行实现；
/// 返回 `Some((imports, has_error))`，`has_error=true` 表示文件语法有错，调用方应与逐行结果并集。
pub fn extract_imports_ast(d: Dialect, content: &str) -> Option<(Vec<DepImport>, bool)> {
    let mut parser = Parser::new();
    if parser.set_language(&d.language()).is_err() {
        return None;
    }
    let tree = parser.parse(content, None)?;
    let src = content.as_bytes();
    let mut out = Vec::new();
    walk_imports(tree.root_node(), src, &mut out, d);
    let has_error = tree.root_node().has_error();
    Some((out, has_error))
}

/// 优先 AST；`None`（解析失败）回退 `line_based`；`has_error` 时与 `line_based` 并集去重（只增不减）。
pub fn extract_imports_with_fallback(d: Dialect, content: &str, line_based: Vec<DepImport>) -> Vec<DepImport> {
    let Some((ast, has_error)) = extract_imports_ast(d, content) else {
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

fn walk_imports(node: Node, src: &[u8], out: &mut Vec<DepImport>, d: Dialect) {
    match d {
        Dialect::Python => match node.kind() {
            // `import a.b, c.d`（多个 dotted_name 子节点，无 field name）
            "import_statement" => {
                let mut cur = node.walk();
                for child in node.named_children(&mut cur) {
                    if child.kind() == "dotted_name" {
                        let t = text_of(child, src);
                        if !t.is_empty() {
                            out.push(dep(t, node));
                        }
                    }
                }
            }
            // `from a.b import c, d` —— 模块路径在 `module_name` 字段
            "import_from_statement" => {
                if let Some(m) = node.child_by_field_name("module_name") {
                    let t = text_of(m, src);
                    if !t.is_empty() {
                        out.push(dep(t, node));
                    }
                }
            }
            _ => {}
        },
        Dialect::Rust => {
            // `use std::fs::File;` / `use std::fs::{File, Path};` / `use a::b as c;`
            if node.kind() == "use_declaration" {
                if let Some(arg) = node.child_by_field_name("argument") {
                    let t = rust_module_path(arg, src);
                    if !t.is_empty() {
                        out.push(dep(t, node));
                    }
                }
            }
        }
        Dialect::Go => {
            // `import "fmt"` / `import (\n "a"\n "b"\n)` —— 路径在 import_spec 的 string literal
            if node.kind() == "import_spec" {
                let mut cur = node.walk();
                for child in node.named_children(&mut cur) {
                    if child.kind() == "interpreted_string_literal" {
                        let t = strip_quotes(&text_of(child, src));
                        if !t.is_empty() {
                            out.push(dep(t, node));
                        }
                    }
                }
            }
        }
        Dialect::C | Dialect::Cpp => {
            // `#include "foo.h"` —— 仅本地头文件（string_literal），系统头文件（`<...>`）跳过
            if node.kind() == "preproc_include" {
                let mut cur = node.walk();
                for child in node.named_children(&mut cur) {
                    if child.kind() == "string_literal" {
                        let t = strip_quotes(&text_of(child, src));
                        if !t.is_empty() {
                            out.push(dep(t, node));
                        }
                    }
                }
            }
        }
        Dialect::Java => {
            // `import java.util.List;` / `import static java.lang.Math.*;`
            // 直接取整条 import_declaration 文本并剥 `import`/`static`/`;`（与旧逐行口径一致，
            // 自然保留 `.*` 通配），避免 `scoped_identifier` 节点不含 `.*` 的丢尾问题。
            //
            // 与 joern `javasrc2cpg/astcreation/AstCreator.scala:172 addImportsToScope` 对齐的关键点：
            // **静态导入同样是真实 import 节点**（joern 只用 `isStatic` 决定要不要注册顶层类型，
            // 不影响 import 节点存在）。而旧逐行实现 `review::parse_java_imports:1104` 以
            // `!rest.starts_with("static ")` 把静态导入**整条丢弃** → `import static
            // org.junit.Assert.*;` 这类高频依赖在依赖图上凭空消失。本分支剥掉 `static `
            // 前缀后照常产出，补齐该缺口。
            if node.kind() == "import_declaration" {
                let mut t = text_of(node, src);
                if let Some(rest) = t.strip_prefix("import") {
                    t = rest.to_string();
                }
                t = t
                    .trim()
                    .trim_start_matches("static ")
                    .trim()
                    .trim_end_matches(';')
                    .trim()
                    .to_string();
                if !t.is_empty() {
                    out.push(dep(t, node));
                }
            }
        }
        Dialect::Kotlin => {
            // tree-sitter-kotlin-ng 形态（已实测探针确认，不是猜测）：
            //   `import java.util.List`      → 命名节点 `import` 下挂 qualified_identifier="java.util.List"
            //   `import kotlin.math.*`       → qualified_identifier="kotlin.math" + 匿名 `.` + 匿名 `*`
            //   `import com.foo.Bar as Baz`  → qualified_identifier="com.foo.Bar" + 匿名 `as` + identifier="Baz"
            // 注意：命名节点 kind 就叫 `import`，与同名**匿名关键字**节点靠 `is_named()` 区分。
            //
            // 与 joern `kotlin2cpg/ast/AstForPrimitivesCreator.scala:224 astForImportDirective` 对齐：
            // importedEntity 取 `ImportPath.pathStr`（通配时**含 `.*` 后缀**），别名走 importedAs
            // 不污染实体路径。故这里：通配补回 `.*`（同时与旧逐行、与 Java 分支口径一致），
            // 别名 `as X` 丢弃 —— 修掉旧逐行把 ` as Baz` 当成路径尾巴的脏值。
            if node.kind() == "import" && node.is_named() {
                let mut path = String::new();
                let mut wildcard = false;
                let mut cur = node.walk();
                for child in node.children(&mut cur) {
                    match child.kind() {
                        // 首个命名路径节点即模块路径；别名 identifier 出现在其后，不会覆盖
                        "qualified_identifier" | "identifier" if path.is_empty() && child.is_named() => {
                            path = text_of(child, src);
                        }
                        "*" => wildcard = true,
                        _ => {}
                    }
                }
                if !path.is_empty() {
                    let full = if wildcard { format!("{path}.*") } else { path };
                    out.push(dep(full, node));
                }
            }
        }
        _ => {}
    }
    // 递归下钻（import_spec_list / use_tree / 多语句等容器节点都靠这层遍历命中）
    let mut cur = node.walk();
    for child in node.named_children(&mut cur) {
        walk_imports(child, src, out, d);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(d: Dialect, src: &str) -> Vec<String> {
        extract_imports_ast(d, src)
            .map(|(v, _)| v.into_iter().map(|x| x.path).collect())
            .unwrap_or_default()
    }

    // ───────────── Python ─────────────
    #[test]
    fn py_static_import() {
        assert_eq!(collect(Dialect::Python, "import os"), vec!["os"]);
        assert_eq!(collect(Dialect::Python, "import os.path"), vec!["os.path"]);
    }
    #[test]
    fn py_from_import() {
        assert_eq!(collect(Dialect::Python, "from sys import argv"), vec!["sys"]);
        assert_eq!(collect(Dialect::Python, "from a.b import c, d"), vec!["a.b"]);
    }
    #[test]
    fn py_multiline_from_is_captured() {
        let src = "from x import (\n  alpha,\n  beta,\n)\n";
        assert_eq!(collect(Dialect::Python, src), vec!["x"]);
    }
    #[test]
    fn py_multiple_imports() {
        let src = "import os\nimport sys\nfrom a import b\n";
        assert_eq!(collect(Dialect::Python, src), vec!["os", "sys", "a"]);
    }
    #[test]
    fn py_commented_import_is_ignored() {
        // 逐行实现会把注释里的 import 当成依赖，AST 不会
        let src = "# import os\n'''import sys'''\nimport json\n";
        assert_eq!(collect(Dialect::Python, src), vec!["json"]);
    }

    // ───────────── Rust ─────────────
    #[test]
    fn rust_use_simple() {
        assert_eq!(collect(Dialect::Rust, "use std::fs::File;"), vec!["std::fs::File"]);
    }
    #[test]
    fn rust_use_list() {
        assert_eq!(
            collect(Dialect::Rust, "use std::fs::{File, Path};"),
            vec!["std::fs"]
        );
    }
    #[test]
    fn rust_use_alias_strips_as() {
        // 旧逐行会把 ` as c` 当成路径末尾；AST 干净取 `a::b`
        assert_eq!(collect(Dialect::Rust, "use a::b as c;"), vec!["a::b"]);
    }
    #[test]
    fn rust_multiline_use_list() {
        let src = "use std::fs::{\n  File,\n  Path,\n};\n";
        assert_eq!(collect(Dialect::Rust, src), vec!["std::fs"]);
    }

    // ───────────── Go ─────────────
    #[test]
    fn go_single_import() {
        assert_eq!(collect(Dialect::Go, "import \"fmt\""), vec!["fmt"]);
    }
    #[test]
    fn go_grouped_import() {
        let src = "import (\n  \"fmt\"\n  \"os\"\n)\n";
        assert_eq!(collect(Dialect::Go, src), vec!["fmt", "os"]);
    }
    #[test]
    fn go_aliased_import() {
        // `import foo "bar"` 路径仍是 bar
        assert_eq!(collect(Dialect::Go, "import f \"fmt\""), vec!["fmt"]);
    }

    // ───────────── C / C++ ─────────────
    #[test]
    fn c_local_include_captured() {
        assert_eq!(collect(Dialect::C, "#include \"foo.h\""), vec!["foo.h"]);
    }
    #[test]
    fn c_system_include_skipped() {
        // 系统头文件（尖括号）不是项目内依赖，跳过（与旧 parse_c_imports 一致）
        assert!(collect(Dialect::C, "#include <stdio.h>").is_empty());
    }
    #[test]
    fn c_commented_include_ignored() {
        assert_eq!(
            collect(Dialect::C, "// #include \"ghost.h\"\n#include \"real.h\"\n"),
            vec!["real.h"]
        );
    }

    // ───────────── Java ─────────────
    #[test]
    fn java_import() {
        assert_eq!(
            collect(Dialect::Java, "import java.util.List;"),
            vec!["java.util.List"]
        );
    }
    #[test]
    fn java_static_wildcard_import() {
        assert_eq!(
            collect(Dialect::Java, "import static java.lang.Math.*;"),
            vec!["java.lang.Math.*"]
        );
    }
    #[test]
    fn java_static_import_is_no_longer_dropped() {
        // 旧逐行 `review::parse_java_imports` 会把 static 导入整条丢掉（依赖凭空消失）；
        // AST 分支对标 joern 照常产出。
        let src = "package a;\nimport java.util.List;\nimport static org.junit.Assert.assertEquals;\n";
        assert_eq!(
            collect(Dialect::Java, src),
            vec!["java.util.List", "org.junit.Assert.assertEquals"]
        );
        let old: Vec<String> = crate::commands::review::parse_java_imports(src)
            .into_iter()
            .map(|(p, _)| p)
            .collect();
        assert_eq!(old, vec!["java.util.List"], "旧逐行确实漏了 static 导入");
    }
    #[test]
    fn java_block_comment_import_is_ignored() {
        // 块注释里独占一行的 import 会被逐行实现当成真实依赖（幻影边）
        let src = "/*\nimport ghost.Phantom;\n*/\nimport real.Thing;\n";
        assert_eq!(collect(Dialect::Java, src), vec!["real.Thing"]);
    }

    // ───────────── Kotlin ─────────────
    #[test]
    fn kotlin_import_plain() {
        assert_eq!(
            collect(Dialect::Kotlin, "package a.b\n\nimport java.util.List\n"),
            vec!["java.util.List"]
        );
    }
    #[test]
    fn kotlin_wildcard_keeps_star_suffix() {
        // 对标 joern kotlin2cpg：importedEntity = ImportPath.pathStr（通配含 `.*`）
        assert_eq!(
            collect(Dialect::Kotlin, "import kotlin.math.*\n"),
            vec!["kotlin.math.*"]
        );
    }
    #[test]
    fn kotlin_alias_import_strips_as_clause() {
        // 旧逐行会得到脏值 "com.foo.Bar as Baz"；AST 干净取实体路径
        assert_eq!(
            collect(Dialect::Kotlin, "import com.foo.Bar as Baz\n"),
            vec!["com.foo.Bar"]
        );
        let old: Vec<String> = crate::commands::review::parse_java_imports("import com.foo.Bar as Baz\n")
            .into_iter()
            .map(|(p, _)| p)
            .collect();
        assert_eq!(old, vec!["com.foo.Bar as Baz"], "旧逐行确实带 as 尾巴");
    }
    #[test]
    fn kotlin_multiple_imports_and_package_not_counted() {
        let src = "package com.example.app\n\nimport a.B\nimport c.d.*\nimport e.F as G\n\nclass X\n";
        assert_eq!(collect(Dialect::Kotlin, src), vec!["a.B", "c.d.*", "e.F"]);
    }
    #[test]
    fn kotlin_commented_import_is_ignored() {
        let src = "// import ghost.Phantom\n/* import ghost2.Phantom2 */\nimport real.Thing\n";
        assert_eq!(collect(Dialect::Kotlin, src), vec!["real.Thing"]);
    }
    #[test]
    fn kotlin_import_line_numbers_are_source_lines() {
        let src = "package p\n\nimport a.B\n\nimport c.D\n";
        let got = extract_imports_ast(Dialect::Kotlin, src).unwrap().0;
        let pairs: Vec<(String, usize)> = got.into_iter().map(|x| (x.path, x.line)).collect();
        assert_eq!(
            pairs,
            vec![("a.B".to_string(), 3), ("c.D".to_string(), 5)]
        );
    }

    // ───────────── 注册表路由（java vs kotlin 必须走不同方言）─────────────
    #[test]
    fn registry_routes_kotlin_and_java_to_right_dialect() {
        // Kotlin 无分号 + 别名：只有走 Kotlin 方言才拿到干净路径
        let kt = crate::parser::parse_deps("kotlin", "package p\nimport com.foo.Bar as Baz\n");
        assert_eq!(
            kt.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
            vec!["com.foo.Bar"]
        );
        // Java 带分号 + static：只有走 Java 方言才把 static 导入算进来
        let java = crate::parser::parse_deps(
            "java",
            "package p;\nimport java.util.List;\nimport static org.junit.Assert.assertEquals;\n",
        );
        assert_eq!(
            java.iter().map(|d| d.path.as_str()).collect::<Vec<_>>(),
            vec!["java.util.List", "org.junit.Assert.assertEquals"]
        );
    }

    /// 真实数据回放（默认跳过）：`REPLAY_AST_IMPORT_DIR=<目录> cargo test replay_ast_imports -- --nocapture`
    /// 对比「AST 抽取」与「旧逐行抽取」的覆盖差，量化解析层收益（非 TS/JS 方言）。
    #[test]
    fn replay_ast_imports() {
        let Ok(dir) = std::env::var("REPLAY_AST_IMPORT_DIR") else {
            return;
        };
        fn walk_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| matches!(n, "node_modules" | "target" | ".git" | "vendor"))
                    {
                        continue;
                    }
                    walk_files(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk_files(std::path::Path::new(&dir), &mut files);

        let mut ast_total = 0usize;
        let mut line_total = 0usize;
        let mut errs = 0usize;
        let mut samples: Vec<String> = Vec::new();
        let mut diffs: Vec<String> = Vec::new();
        for f in &files {
            let Some(ext) = f.extension().and_then(|s| s.to_str()) else {
                continue;
            };
            let (lang, d): (Option<&str>, Dialect) = match ext {
                "py" | "pyi" => (Some("python"), Dialect::Python),
                "rs" => (Some("rust"), Dialect::Rust),
                "go" => (Some("go"), Dialect::Go),
                "c" | "h" => (Some("c"), Dialect::C),
                "cpp" | "cc" | "cxx" | "hpp" | "hh" => (Some("cpp"), Dialect::Cpp),
                "java" => (Some("java"), Dialect::Java),
                "kt" | "kts" => (Some("kotlin"), Dialect::Kotlin),
                _ => (None, Dialect::Python),
            };
            let Some(lang) = lang else { continue };
            let Ok(content) = std::fs::read_to_string(f) else {
                continue;
            };
            // 基线必须直连**旧逐行实现**：早期版本这里调 `parser::parse_deps`，而该入口
            // 已改为 AST 优先 → 基线被 AST 污染，量出来必然「持平」（度量 bug）。
            let line_paths: Vec<String> = {
                use crate::commands::review as rv;
                match lang {
                    "python" => rv::parse_python_imports(&content),
                    "rust" => rv::parse_rust_imports(&content),
                    "go" => rv::parse_go_imports(&content),
                    "c" | "cpp" => rv::parse_c_imports(&content),
                    "java" | "kotlin" => rv::parse_java_imports(&content),
                    _ => Vec::new(),
                }
                .into_iter()
                .map(|(p, _)| p)
                .collect()
            };
            let line = line_paths.len();
            line_total += line;
            match extract_imports_ast(d, &content) {
                Some((imports, has_error)) => {
                    ast_total += imports.len();
                    if has_error {
                        errs += 1;
                    }
                    // 逐文件路径级差异（不只是计数）：定位「AST 多抓 / 逐行脏值」的真实位置
                    let ast_paths: Vec<String> = imports.iter().map(|x| x.path.clone()).collect();
                    if ast_paths != line_paths && diffs.len() < 8 {
                        let only_ast: Vec<&String> =
                            ast_paths.iter().filter(|p| !line_paths.contains(p)).collect();
                        let only_line: Vec<&String> =
                            line_paths.iter().filter(|p| !ast_paths.contains(p)).collect();
                        diffs.push(format!(
                            "{}: +ast{:?} -line{:?}",
                            f.display(),
                            only_ast,
                            only_line
                        ));
                    }
                }
                None => {
                    ast_total += line; // 解析失败回退，按 line 计避免低估
                }
            }
            if samples.len() < 5 {
                samples.push(format!("{}: line={line}", f.display()));
            }
        }
        println!(
            "REPLAY_AST files={} ast={} lineBased={} parseErrFiles={} diffFiles={}",
            files.len(),
            ast_total,
            line_total,
            errs,
            diffs.len()
        );
        for d in &diffs {
            println!("  diff {d}");
        }
        for s in samples {
            println!("  sample {s}");
        }
    }
}

