//! C / C++ 解析器（include 依赖解析 + c-like 符号提取；C#/PHP 见 other.rs）

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::{DepImport, LanguageParser, ParsedImport, ParserCapabilities, SymbolCandidate};

/// C / C++ 解析器（含 .h 头文件，走 C++ grammar 超集）
pub struct CLikeParser;

impl LanguageParser for CLikeParser {
    fn id(&self) -> &'static str {
        "c"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["c", "cpp"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true,     // c-like 正则（class/struct/interface；不含函数）
            deps: true,        // include 解析
            symbol_refs: true, // `#include` 文件级引用（文本包含语义，见 parse_imports_with_symbols）
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        match ext {
            "c" | "h" => Some("c"),
            "cpp" | "cc" | "cxx" | "hpp" | "hh" => Some("cpp"),
            _ => None,
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_c_like_symbols(content)
    }

    /// 依赖级 import：优先 AST（`imports_ast`，对标 joern c2cpg 的 #include 解析），
    /// 仅本地头文件（双引号）进依赖图、系统头文件（尖括号）跳过，且免疫注释 / 多行；
    /// 解析失败回退旧逐行，语法错误时并集去重。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let line_based: Vec<DepImport> = review::parse_c_imports(content)
            .into_iter()
            .map(|(path, line)| DepImport {
                path,
                line,
                kind: None,
            })
            .collect();
        crate::parser::imports_ast::extract_imports_with_fallback(Dialect::C, content, line_based)
    }

    /// 符号级 import：`#include "x.h"` 是**文本包含**（把整个头文件作用域搬进来），
    /// 不像 Go/Python 那样点名符号。故按 C 的真实语义产出**文件级**引用
    /// （`symbols` 为空，但解析层仍会给出准确的 `to_file_id`）。
    /// 系统头（尖括号）不是项目内依赖，跳过——与依赖级 `parse_deps` 同口径。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        // .h 走 C++ grammar（超集，见 dialect），两种都试，取先产出的那个
        crate::parser::symbol_imports_ast::extract_c_symbol_imports(Dialect::Cpp, content)
            .or_else(|| {
                crate::parser::symbol_imports_ast::extract_c_symbol_imports(Dialect::C, content)
            })
            .map(|(v, _err)| v)
            .unwrap_or_default()
    }

    fn dialect(&self, rel_path: &str) -> Option<Dialect> {
        let ext = rel_path.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "cpp" | "cc" | "cxx" | "hpp" | "hh" | "h" => Some(Dialect::Cpp), // .h 走 C++（超集）
            "c" => Some(Dialect::C),
            _ => None,
        }
    }
}
