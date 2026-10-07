//! Ruby / Swift / Vue / Svelte / C# / PHP 解析器（后端支持度较低的语言族）

use crate::commands::code_structure;
use crate::infrastructure::ast::Dialect;
use crate::parser::{DepImport, LanguageParser, ParsedImport, ParserCapabilities, SymbolCandidate};

/// C# 解析器：符号走 c-like 正则，有 CSharp 方言；无 include 依赖解析
pub struct CSharpParser;

impl LanguageParser for CSharpParser {
    fn id(&self) -> &'static str {
        "csharp"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["csharp"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true,
            deps: false, // 后端无 csharp 依赖解析
            symbol_refs: false,
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "cs" {
            Some("csharp")
        } else {
            None
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_c_like_symbols(content)
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new()
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::CSharp)
    }
}

/// PHP 解析器：符号走 c-like 正则，有 Php 方言；无依赖解析
pub struct PhpParser;

impl LanguageParser for PhpParser {
    fn id(&self) -> &'static str {
        "php"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["php"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true,
            deps: false, // 后端无 php 依赖解析
            symbol_refs: false,
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "php" {
            Some("php")
        } else {
            None
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        code_structure::extract_c_like_symbols(content)
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new()
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Php)
    }
}

/// Ruby 解析器：有 AST 度量，无符号提取/依赖解析/符号引用
pub struct RubyParser;

impl LanguageParser for RubyParser {
    fn id(&self) -> &'static str {
        "ruby"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["ruby"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: false,
            deps: false,
            symbol_refs: false,
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "rb" {
            Some("rb")
        } else {
            None
        }
    }

    fn extract_symbols(&self, _content: &str) -> Vec<SymbolCandidate> {
        Vec::new() // 后端无 ruby 符号提取
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new() // 后端无 ruby 依赖解析
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Ruby)
    }
}

/// Swift 解析器：有 AST 度量，无符号提取/依赖解析
pub struct SwiftParser;

impl LanguageParser for SwiftParser {
    fn id(&self) -> &'static str {
        "swift"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["swift"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: false,
            deps: false,
            symbol_refs: false,
            ast: true,
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "swift" {
            Some("swift")
        } else {
            None
        }
    }

    fn extract_symbols(&self, _content: &str) -> Vec<SymbolCandidate> {
        Vec::new() // 后端无 swift 符号提取
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new() // 后端无 swift 依赖解析
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        Some(Dialect::Swift)
    }
}

/// Vue 解析器：SFC 的 `<script>` 走 TS 正则提取符号；无独立 grammar、无依赖解析
pub struct VueParser;

impl LanguageParser for VueParser {
    fn id(&self) -> &'static str {
        "vue"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["vue"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities {
            symbols: true, // SFC script 走 TS 正则
            deps: false,
            symbol_refs: false, // 无独立 vue 符号级引用（svelte 同）
            ast: false,         // 无 vue grammar
        }
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "vue" {
            Some("vue")
        } else {
            None
        }
    }

    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        // 与既有行为一致：vue 走 extract_ts_symbols（SFC 里的 <script> 段）
        code_structure::extract_ts_symbols(content)
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new() // 后端无 vue 依赖解析
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        None // 无 vue grammar，AST 走启发式
    }
}

/// Svelte 解析器：语言检测支持，但符号/依赖/AST 均无
pub struct SvelteParser;

impl LanguageParser for SvelteParser {
    fn id(&self) -> &'static str {
        "svelte"
    }

    fn aliases(&self) -> &'static [&'static str] {
        &["svelte"]
    }

    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities::default()
    }

    fn detect(&self, ext: &str) -> Option<&'static str> {
        if ext == "svelte" {
            Some("svelte")
        } else {
            None
        }
    }

    fn extract_symbols(&self, _content: &str) -> Vec<SymbolCandidate> {
        Vec::new()
    }

    fn parse_deps(&self, _content: &str) -> Vec<DepImport> {
        Vec::new()
    }

    fn parse_imports_with_symbols(&self, _content: &str) -> Vec<ParsedImport> {
        Vec::new()
    }

    fn dialect(&self, _rel_path: &str) -> Option<Dialect> {
        None
    }
}
