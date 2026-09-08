//! Python 解析器

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::{ParsedImport, SymbolCandidate};
use crate::parser::{DepImport, LanguageParser, ParserCapabilities};

pub struct PythonParser;

impl LanguageParser for PythonParser {
    fn id(&self) -> &'static str {
        "python"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["python"]
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
        if matches!(ext, "py" | "pyi") { Some("python") } else { None }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_python_symbols(content)
    }

    /// 依赖级 import：优先 AST（`imports_ast`，对标 joern pysrc2cpg ImportsPass），
    /// 覆盖多行 from-import / 分组 / 注释免疫；解析失败回退旧逐行，语法错误时并集去重。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let line_based: Vec<DepImport> = review::parse_python_imports(content)
            .into_iter()
            .map(|(path, line)| DepImport { path, line, kind: None })
            .collect();
        crate::parser::imports_ast::extract_imports_with_fallback(Dialect::Python, content, line_based)
    }

    /// 符号级 import：优先 AST（`symbol_imports_ast`，对标 joern `pysrc2cpg` ImportsPass）。
    ///
    /// 旧逐行 `code_structure::parse_py_imports` 的缺口：`from . import x`（`module == "."`）
    /// 整条丢弃、多行括号 from-import 只取首行、`from x import *` 无通配语义、注释幻影。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        crate::parser::symbol_imports_ast::extract_symbol_imports_with_fallback(
            Dialect::Python,
            content,
            code_structure::parse_py_imports(content),
        )
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Python)
    }
}
