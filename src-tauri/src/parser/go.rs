//! Go 解析器

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::{DepImport, LanguageParser, ParserCapabilities};
use crate::parser::{ParsedImport, SymbolCandidate};

pub struct GoParser;

impl LanguageParser for GoParser {
    fn id(&self) -> &'static str {
        "go"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["go"]
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
        if ext == "go" {
            Some("go")
        } else {
            None
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_go_symbols(content)
    }

    /// 依赖级 import：优先 AST（`imports_ast`，对标 joern gosrc2cpg DependencySrcProcessor），
    /// 覆盖 `import (...)` 分组块 / 多行 / 别名 / 注释免疫；解析失败回退旧逐行，语法错误时并集去重。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let line_based: Vec<DepImport> = review::parse_go_imports(content)
            .into_iter()
            .map(|(path, line)| DepImport {
                path,
                line,
                kind: None,
            })
            .collect();
        crate::parser::imports_ast::extract_imports_with_fallback(Dialect::Go, content, line_based)
    }

    /// 符号级 import：**用量驱动**——Go 的 import 不点名符号（导入整个包），
    /// 符号经由 `pkg.Ident` 使用。故扫全文件归集每个包名实际被用到的成员，
    /// 产出带 `symbols` 的记录，使落库行有真实 `to_symbol_id`
    /// （死代码判定 / 前端引用计数 / 画布引用边均只认该字段）。
    /// 抽取失败（grammar 不可用）时返回空，与历史行为一致。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        crate::parser::symbol_imports_ast::extract_go_symbol_imports(content)
            .map(|(v, _err)| v)
            .unwrap_or_default()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Go)
    }
}
