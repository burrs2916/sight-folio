//! Rust 解析器

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::{DepImport, LanguageParser, ParserCapabilities};
use crate::parser::{ParsedImport, SymbolCandidate};

pub struct RustParser;

impl LanguageParser for RustParser {
    fn id(&self) -> &'static str {
        "rust"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["rust"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true,
            deps: true,
            symbol_refs: true,
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "rs" {
            Some("rust")
        } else {
            None
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_rust_symbols(content)
    }

    /// 依赖级 import：优先 AST（`imports_ast`，对标 joern 各 frontend 的 use 捕获），
    /// 覆盖 `use {..}` 分组 / 多行 / 注释免疫，并顺手修掉 `use a::b as c` 旧实现的 ` as c` 路径尾巴；
    /// 解析失败回退旧逐行，语法错误时并集去重。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let line_based: Vec<DepImport> = review::parse_rust_imports(content)
            .into_iter()
            .map(|(path, line)| DepImport {
                path,
                line,
                kind: None,
            })
            .collect();
        crate::parser::imports_ast::extract_imports_with_fallback(
            Dialect::Rust,
            content,
            line_based,
        )
    }

    /// 符号级 import：优先 AST（`symbol_imports_ast`，对标 joern `rust2cpg` UseTests 的 use tree 规格）。
    ///
    /// 旧逐行 `code_structure::parse_rs_imports` 的结构性缺口（这些是本仓实测事实）：
    ///   1. `use a::b::C` 的 `path` 取的是**最后一段** `C`（`rsplit("::").next()`）→ 消费点永远
    ///      解析不到目标文件；
    ///   2. `use x::*` 整条丢弃（joern 把通配当一等 import 节点）；
    ///   3. `pub use ...` 因 `strip_prefix("use ")` 失配而**完全消失**（本仓 `commands/mod.rs`
    ///      + `database/mod.rs` 合计 58 条再导出边全丢）；
    ///   4. 嵌套 `use a::{b::C, d::E}` 不展开；多行 use 列表丢失；注释内 use 变幻影引用。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        crate::parser::symbol_imports_ast::extract_symbol_imports_with_fallback(
            Dialect::Rust,
            content,
            code_structure::parse_rs_imports(content),
        )
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Rust)
    }
}
