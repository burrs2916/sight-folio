//! Java / Kotlin 解析器

use crate::commands::{code_structure, review};
use crate::infrastructure::ast::Dialect;
use crate::parser::{ParsedImport, SymbolCandidate};
use crate::parser::{DepImport, LanguageParser, ParserCapabilities};

pub struct JavaParser;

/// 旧逐行依赖抽取（AST 回退 / 并集源）
fn line_based(content: &str) -> Vec<DepImport> {
    review::parse_java_imports(content)
        .into_iter()
        .map(|(path, line)| DepImport { path, line, kind: None })
        .collect()
}

impl LanguageParser for JavaParser {
    fn id(&self) -> &'static str {
        "java"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["java", "kotlin"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true,
            deps: true,
            symbol_refs: true, // java/kotlin 走 java 组 import 解析
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        match ext {
            "java" => Some("java"),
            "kt" | "kts" => Some("kotlin"),
            _ => None,
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_java_symbols(content)
    }

    /// 依赖级 import —— 无语言上下文的兜底路径（保持旧逐行行为）。
    ///
    /// 本插件同时服务 `java` 与 `kotlin`，此签名拿不到具体语言、无法选对 tree-sitter 方言；
    /// 真实扫描链路走 `parse_deps_for(lang, content)`（AST 优先）。
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        line_based(content)
    }

    /// 依赖级 import（AST 优先，对标 joern javasrc2cpg / kotlin2cpg 的 import 节点）。
    ///
    /// 旧逐行实现（`review::parse_java_imports:1098`）的结构性缺口：
    ///   1. **静态导入整条丢弃**（`:1104` `!rest.starts_with("static ")`）→ `import static
    ///      org.junit.Assert.*;` 这类高频依赖凭空消失；joern 照常建 import 节点（isStatic
    ///      只影响作用域注册）；
    ///   2. Kotlin 别名 `import a.b.C as D` 的 ` as D` 被当成路径尾巴 → 脏依赖名；joern 把
    ///      别名放 `importedAs`，实体路径保持干净；
    ///   3. 块注释里独占一行的 `import x.y.Z;` 被当成真实依赖（幻影边）。
    ///
    /// AST 解析失败（grammar 异常）回退逐行；`has_error`（局部语法错）时与逐行结果并集去重，
    /// 只增不减（与 WP5 的 TS/JS、以及 Python/Rust/Go/C 分支同一套零回归约定）。
    fn parse_deps_for(&self, lang: &str, content: &str) -> Vec<DepImport> {
        let dialect = if lang.eq_ignore_ascii_case("kotlin") {
            Dialect::Kotlin
        } else {
            Dialect::Java
        };
        crate::parser::imports_ast::extract_imports_with_fallback(dialect, content, line_based(content))
    }

    /// 符号级 import —— 无语言上下文的兜底路径（保持旧逐行行为，同 `parse_deps` 的理由）。
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        code_structure::parse_java_imports(content)
    }

    /// 符号级 import（AST 优先，对标 joern javasrc2cpg `addImportsToScope` / kotlin2cpg
    /// `astForImportDirective`）。
    ///
    /// 旧逐行 `code_structure::parse_java_imports` 的缺口：
    ///   1. `import static a.b.C.m` 整条丢弃（joern：`isStatic` 只影响作用域注册，import 节点照建）；
    ///   2. `import a.b.*` 的 path 带 `.*` 脏尾 → 解析不到目录；
    ///   3. Kotlin `import a.b.C as Baz` 产出脏符号名 `"C as Baz"`（joern 把别名放 `importedAs`）；
    ///   4. 注释内 import 变幻影引用。
    fn parse_imports_with_symbols_for(&self, lang: &str, content: &str) -> Vec<ParsedImport> {
        let dialect = if lang.eq_ignore_ascii_case("kotlin") {
            Dialect::Kotlin
        } else {
            Dialect::Java
        };
        crate::parser::symbol_imports_ast::extract_symbol_imports_with_fallback(
            dialect,
            content,
            code_structure::parse_java_imports(content),
        )
    }

    fn dialect(&self, rel_path: &str) -> Option<Dialect> {
        let ext = rel_path.rsplit('.').next().unwrap_or("").to_lowercase();
        if ext == "kt" || ext == "kts" {
            Some(Dialect::Kotlin)
        } else {
            Some(Dialect::Java)
        }
    }
}
