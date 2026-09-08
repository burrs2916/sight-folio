//! TypeScript / JavaScript 解析器（含 JSX/TSX 与 Vue SFC 的符号提取）

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::ts_imports;
use crate::parser::{ParsedImport, SymbolCandidate};
use crate::parser::{DepImport, LanguageParser, ParserCapabilities};

/// TypeScript / JavaScript 解析器。
///
/// 能力（与后端实际支持对齐）：
/// - 符号提取：TS/JS 正则（含 vue 走 TS 提取）
/// - 依赖解析：import/require
/// - 符号级引用：import 符号名
/// - AST 度量：TS/TSX 方言（JS 走 TSX grammar，是 JS 超集）
pub struct TypeScriptParser;

impl LanguageParser for TypeScriptParser {
    fn id(&self) -> &'static str {
        "typescript"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["typescript", "javascript", "vue"]
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
        match ext {
            "ts" | "tsx" => Some("typescript"),
            "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
            "vue" => Some("vue"),
            _ => None,
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_ts_symbols(content)
    }

    /// 依赖级 import。
    ///
    /// 优先走 AST（`ts_imports::extract_ts_imports`，对标 joern jssrc2cpg 的 import 捕获）：
    /// 覆盖静态 / 副作用 / 再导出 / 动态 `import()` / `require`，且免疫注释与字符串。
    /// vue SFC 或解析失败回退旧逐行实现；语法有错的文件与逐行结果取并集（只增不减）。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let line_based = || -> Vec<DepImport> {
            review::parse_js_imports(content)
                .into_iter()
                .map(|(path, line)| DepImport { path, line, kind: None })
                .collect()
        };
        let Some((ast_imports, has_error)) = ts_imports::extract_ts_imports(content) else {
            return line_based();
        };
        let mut out: Vec<DepImport> = ast_imports
            .iter()
            .map(|i| DepImport {
                path: i.path.clone(),
                line: i.line,
                kind: i.kind.dep_kind(),
            })
            .collect();
        if has_error {
            // 语法错误文件：AST 可能局部丢失，与逐行结果并集去重（按 路径+行 判重）
            let seen: std::collections::HashSet<(String, usize)> =
                out.iter().map(|d| (d.path.clone(), d.line)).collect();
            for d in line_based() {
                if !seen.contains(&(d.path.clone(), d.line)) {
                    out.push(d);
                }
            }
        }
        out
    }

    /// 符号级 import 引用。语义与旧逐行实现一致（`{ A as B }` 取 `A`，默认/命名空间取本地名），
    /// 但补齐了多行 import、动态导入、副作用导入与再导出，并免疫注释。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        let Some((ast_imports, has_error)) = ts_imports::extract_ts_imports(content) else {
            return code_structure::parse_ts_imports(content);
        };
        let mut out: Vec<ParsedImport> = ast_imports
            .into_iter()
            .map(|i| ParsedImport {
                path: i.path,
                line: i.line,
                symbols: i.symbols,
            })
            .collect();
        if has_error {
            let seen: std::collections::HashSet<(String, usize)> =
                out.iter().map(|p| (p.path.clone(), p.line)).collect();
            for p in code_structure::parse_ts_imports(content) {
                if !seen.contains(&(p.path.clone(), p.line)) {
                    out.push(p);
                }
            }
        }
        out
    }

    fn dialect(&self, rel_path: &str) -> Option<Dialect> {
        let ext = rel_path.rsplit('.').next().unwrap_or("").to_lowercase();
        if ext == "tsx" || ext == "jsx" || ext == "js" || ext == "mjs" || ext == "cjs" {
            Some(Dialect::Tsx)
        } else {
            Some(Dialect::TypeScript)
        }
    }
}
