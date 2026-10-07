//! 后端语言解析器插件框架（R45：解析器插件化）
//!
//! 背景：此前语言解析能力分散在 4 处硬编码 match 里——
//!   - `project_scan.rs::detect_language`（扩展名 → 语言 id）
//!   - `infrastructure/ast/mod.rs::dialect_for`（语言 → tree-sitter 方言）
//!   - `commands/code_structure.rs::extract_symbols`（语言 → 符号提取）
//!   - `commands/code_structure.rs::parse_imports_with_symbols`（语言 → import 解析）
//!   - `commands/review.rs::parse_*_imports`（语言 → 依赖路径解析）
//! 每加一种语言要同步改 5 处，漏一处就出现「前端声明了、后端没分析」的脱节。
//!
//! 本模块定义 `LanguageParser` trait + `ParserRegistry` 单例，把语言能力收敛为
//! **单一注册点**：每语言一个实现，注册后四处分发自动生效，前后端能力对齐
//! 由 `capabilities` 声明驱动（单一事实源，不再各自维护语言列表）。
//!
//! 与前端 `analyzerRegistry`（src/editor/analyzer/analyzerRegistry.ts）对齐：
//! 前端 manifest 的 `languageAliases` 与后端 parser 的 `aliases()` 必须一致，
//! 由前后端能力联动（`commands/parser_capabilities.rs`）统一校验。

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::infrastructure::ast::{self, Dialect};

mod c_like;
mod go;
mod imports_ast;
mod java;
mod other;
mod python;
mod rust;
mod symbol_imports_ast;
mod ts;
pub mod ts_imports;

// 类型重新导出：单一事实源在 commands::code_structure，这里随模块对外提供
// （外部以 `parser::SymbolCandidate` / `parser::ParsedImport` 引用）
pub use crate::commands::code_structure::{ParsedImport, SymbolCandidate};

/// 单文件符号候选（结构分析输出）——复用 code_structure 的类型（单一事实源）
// （类型已通过上方 `use crate::commands::code_structure::{...}` 导入并随模块导出）

/// 依赖级 import（路径 + 行号 + 可选种类，依赖图用）
#[derive(Debug, Clone, Default)]
pub struct DepImport {
    pub path: String,
    pub line: usize,
    /// 依赖种类覆盖。`None` = 由调用方按语言给默认值（import/use/include，保持既有行为）；
    /// `Some(k)` = 解析器点名的更精确种类，如动态导入 `dynamic-import`（懒加载边）。
    /// 对标 joern：静态 import 与 `import()` / `require` 是不同的 CALL 节点，消费方应能区分。
    pub kind: Option<&'static str>,
}

/// 语言解析器能力矩阵（声明式，供前后端能力对齐查询）。
/// 默认全 false，实现者按实际能力覆写——与前端 manifest.capabilities 对齐，
/// 避免「声明了能力但没实现」的脱节（历史：vue 声明 dependencyAnalysis 但后端无实现）。
#[derive(Debug, Clone, Copy, Default)]
pub struct ParserCapabilities {
    /// 符号提取
    pub symbols: bool,
    /// 依赖级 import 解析（依赖图）
    pub deps: bool,
    /// import 符号级解析（符号引用）
    pub symbol_refs: bool,
    /// AST 级度量（tree-sitter 方言）
    pub ast: bool,
}

/// 语言解析器插件 trait。
///
/// 每个实现对应一种（或一族）语言，注册进 `ParserRegistry` 后：
/// - 扫描管线的语言检测 / 符号提取 / 依赖解析 / 符号引用 四处分发自动生效；
/// - 能力矩阵由 `capabilities()` 显式声明，前端能力对齐据此做真实校验。
pub trait LanguageParser: Send + Sync {
    /// 唯一 id（小写），如 "typescript"
    fn id(&self) -> &'static str;
    /// 别名（小写 id 列表），与前端 manifest.languageAliases 对齐。
    /// 第一个元素必须等于 id()（约定），其余为别名。
    fn aliases(&self) -> &'static [&'static str];

    /// 声明式能力矩阵（默认全 false）
    fn capabilities(&self) -> ParserCapabilities {
        ParserCapabilities::default()
    }

    /// 扩展名（不含点，小写）→ 命中的语言 id（语言检测用）。
    /// 返回 `Some(alias)` 可区分同族语言的细粒度 id：
    /// 如 TypeScript 插件对 .js 返回 "javascript"、对 .ts 返回 "typescript"。
    /// 未命中返回 None。
    fn detect(&self, ext: &str) -> Option<&'static str>;

    /// 提取文件内所有符号（无符号能力返回空 Vec）
    fn extract_symbols(&self, content: &str) -> Vec<SymbolCandidate> {
        let _ = content;
        Vec::new()
    }

    /// 提取文件内所有符号（带语言 id 的变体）。
    ///
    /// 与 `parse_deps_for` / `parse_imports_with_symbols_for` 同样的存在原因：一个
    /// 实现服务多种语言时（`CLikeParser` 同时服务 `c` 与 `cpp`），没有语言 id 选不出
    /// tree-sitter 方言。默认委托 `extract_symbols`，单语言插件无需改动。
    fn extract_symbols_for(&self, lang: &str, content: &str) -> Vec<SymbolCandidate> {
        let _ = lang;
        self.extract_symbols(content)
    }

    /// 解析依赖级 import（路径 + 行号；无依赖能力返回空 Vec）
    fn parse_deps(&self, content: &str) -> Vec<DepImport> {
        let _ = content;
        Vec::new()
    }

    /// 解析依赖级 import（带语言 id 的变体）。
    ///
    /// 存在原因：少数插件**一个实现服务多种语言**（如 `JavaParser` 同时服务 `java` 与 `kotlin`），
    /// 而 `parse_deps(content)` 拿不到当前文件到底是哪一种，无法选对 tree-sitter 方言。
    /// 默认实现直接委托 `parse_deps`，因此单语言插件无需改动；需要区分的插件覆写本方法即可。
    fn parse_deps_for(&self, lang: &str, content: &str) -> Vec<DepImport> {
        let _ = lang;
        self.parse_deps(content)
    }

    /// 解析 import 符号级引用（路径 + 行号 + 符号名；无此能力返回空 Vec）
    fn parse_imports_with_symbols(&self, content: &str) -> Vec<ParsedImport> {
        let _ = content;
        Vec::new()
    }

    /// 解析 import 符号级引用（带语言 id 的变体）。
    ///
    /// 与 `parse_deps_for` 同样的存在原因：`JavaParser` 一个实现服务 `java` + `kotlin`，
    /// 无语言上下文选不出 tree-sitter 方言。默认委托 `parse_imports_with_symbols`，
    /// 单语言插件无需改动。
    fn parse_imports_with_symbols_for(&self, lang: &str, content: &str) -> Vec<ParsedImport> {
        let _ = lang;
        self.parse_imports_with_symbols(content)
    }

    /// AST 方言（无 AST 能力返回 None）
    fn dialect(&self, rel_path: &str) -> Option<Dialect> {
        let _ = rel_path;
        None
    }
}

/// 解析器注册表（单例，等价于前端 analyzerRegistry）
pub struct ParserRegistry {
    /// id → parser
    by_id: HashMap<&'static str, Box<dyn LanguageParser>>,
    /// alias → parser id
    alias_to_id: HashMap<&'static str, &'static str>,
    /// 注册顺序（保持确定性遍历）
    order: Vec<&'static str>,
}

impl ParserRegistry {
    fn register(&mut self, parser: Box<dyn LanguageParser>) {
        let id = parser.id();
        if self.by_id.contains_key(id) {
            // 重复注册：后注册覆盖（与前端 registry 一致）
            self.by_id.insert(id, parser);
            return;
        }
        self.order.push(id);
        self.by_id.insert(id, parser);
    }

    fn build_alias_index(&mut self) {
        for id in &self.order {
            if let Some(p) = self.by_id.get(id) {
                for a in p.aliases() {
                    self.alias_to_id.insert(a, p.id());
                }
            }
        }
    }

    /// 语言 id 或别名 → parser
    pub fn get(&self, lang: &str) -> Option<&dyn LanguageParser> {
        let l = lang.to_lowercase();
        if let Some(p) = self.by_id.get(l.as_str()) {
            return Some(p.as_ref());
        }
        let pid = self.alias_to_id.get(l.as_str())?;
        self.by_id.get(pid).map(|b| b.as_ref())
    }

    /// 按扩展名检测语言 id（第一个命中）
    pub fn detect_language(&self, ext: &str) -> Option<&'static str> {
        let e = ext.to_lowercase();
        for id in &self.order {
            if let Some(p) = self.by_id.get(id) {
                if let Some(lang) = p.detect(&e) {
                    return Some(lang);
                }
            }
        }
        None
    }

    /// 全部注册的语言 id（能力对齐 / 覆盖报告用）
    pub fn language_ids(&self) -> Vec<&'static str> {
        self.order.clone()
    }

    /// 语言 → 能力矩阵（能力对齐 / 覆盖报告用）
    pub fn capabilities_of(&self, lang: &str) -> Option<ParserCapabilities> {
        self.get(lang).map(|p| p.capabilities())
    }
}

/// 全局注册表（惰性初始化 + 内置语言注册）
static REGISTRY: OnceLock<ParserRegistry> = OnceLock::new();

/// 内置语言解析器注册表（单例）
pub fn registry() -> &'static ParserRegistry {
    REGISTRY.get_or_init(|| {
        let mut r = ParserRegistry {
            by_id: HashMap::new(),
            alias_to_id: HashMap::new(),
            order: Vec::new(),
        };
        for p in builtin_parsers() {
            r.register(p);
        }
        r.build_alias_index();
        r
    })
}

/// 内置语言解析器清单（新语言在此追加一行 + 一个实现文件）
fn builtin_parsers() -> Vec<Box<dyn LanguageParser>> {
    vec![
        Box::new(ts::TypeScriptParser),
        Box::new(python::PythonParser),
        Box::new(rust::RustParser),
        Box::new(go::GoParser),
        Box::new(java::JavaParser),    // java + kotlin
        Box::new(c_like::CLikeParser), // c / cpp
        Box::new(other::CSharpParser),
        Box::new(other::PhpParser),
        Box::new(other::RubyParser),
        Box::new(other::SwiftParser),
        Box::new(other::VueParser),
        Box::new(other::SvelteParser),
    ]
}

/// 兼容入口：原 `ast::supports` / `ast::dialect_for` 的注册表驱动版本
pub fn dialect_for(lang: &str, rel_path: &str) -> Option<Dialect> {
    registry().get(lang)?.dialect(rel_path)
}

/// 兼容入口：语言是否有 AST 能力
pub fn supports_ast(lang: &str, rel_path: &str) -> bool {
    dialect_for(lang, rel_path).is_some()
}

/// 兼容入口：结构分析（原 code_structure::extract_symbols）
pub fn extract_symbols(lang: &str, content: &str) -> Vec<SymbolCandidate> {
    match registry().get(lang) {
        // 透传 lang：多语言共享实现（`c` / `cpp` 同族）据此选对 tree-sitter 方言
        Some(p) => p.extract_symbols_for(lang, content),
        None => Vec::new(),
    }
}

/// 兼容入口：依赖解析（原 review.rs parse_*_imports）
pub fn parse_deps(lang: &str, content: &str) -> Vec<DepImport> {
    match registry().get(lang) {
        // 透传 lang：多语言共享实现（java/kotlin）据此选对 tree-sitter 方言
        Some(p) => p.parse_deps_for(lang, content),
        None => Vec::new(),
    }
}

/// 兼容入口：符号级 import 解析（原 code_structure::parse_imports_with_symbols）
pub fn parse_imports_with_symbols(lang: &str, content: &str) -> Vec<ParsedImport> {
    match registry().get(lang) {
        // 透传 lang：多语言共享实现（java/kotlin）据此选对 tree-sitter 方言
        Some(p) => p.parse_imports_with_symbols_for(lang, content),
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_resolves_language_ids_and_aliases() {
        let r = registry();
        assert!(r.get("typescript").is_some());
        assert!(r.get("javascript").is_some()); // 别名
        assert!(r.get("rust").is_some());
        assert!(r.get("kotlin").is_some()); // java parser 别名
        assert!(r.get("c").is_some());
        assert!(r.get("cpp").is_some());
        assert!(r.get("csharp").is_some());
        assert!(r.get("php").is_some());
        assert!(r.get("vue").is_some());
        assert!(r.get("svelte").is_some());
        assert!(r.get("brainfuck").is_none());
    }

    #[test]
    fn detect_language_matches_extensions() {
        let r = registry();
        assert_eq!(r.detect_language("ts"), Some("typescript"));
        assert_eq!(r.detect_language("js"), Some("javascript")); // ts 插件按扩展名细分
        assert_eq!(r.detect_language("rs"), Some("rust"));
        assert_eq!(r.detect_language("py"), Some("python"));
        assert_eq!(r.detect_language("cpp"), Some("cpp"));
        assert_eq!(r.detect_language("cs"), Some("csharp"));
        assert_eq!(r.detect_language("vue"), Some("vue"));
        assert_eq!(r.detect_language("xyz_unknown"), None);
    }

    #[test]
    fn dialect_for_matches_ast_support() {
        assert_eq!(dialect_for("typescript", "a.ts"), Some(Dialect::TypeScript));
        assert_eq!(dialect_for("typescript", "a.tsx"), Some(Dialect::Tsx));
        assert_eq!(dialect_for("rust", "a.rs"), Some(Dialect::Rust));
        assert_eq!(dialect_for("vue", "a.vue"), None); // vue 无独立 grammar
        assert_eq!(dialect_for("c", "a.h"), Some(Dialect::Cpp)); // .h 走 C++
    }

    #[test]
    fn symbol_extraction_via_registry() {
        let syms = extract_symbols("typescript", "export class Foo {}\nfunction bar() {}");
        assert!(!syms.is_empty());
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Foo"));
    }

    #[test]
    fn symbol_level_imports_go_through_ast_for_non_ts_languages() {
        // Rust：旧逐行把 path 取成最后一段 `ProjectFile` 且 `pub use` 整条失配丢弃
        let r = parse_imports_with_symbols("rust", "pub use crate::domain::model::ProjectFile;\n");
        assert_eq!(r.len(), 1, "pub use 必须被捕获，实际={:?}", r);
        assert_eq!(r[0].path, "crate::domain::model");
        assert_eq!(r[0].symbols, vec!["ProjectFile".to_string()]);

        // Kotlin：证明 `parse_imports_with_symbols_for` 的语言透传生效（别名不再污染符号名）
        let k = parse_imports_with_symbols("kotlin", "import a.b.C as Baz\n");
        assert_eq!(k.len(), 1);
        assert_eq!(k[0].path, "a.b.C");
        assert_eq!(k[0].symbols, vec!["C".to_string()]);

        // Java：静态导入不再整条丢弃
        let j =
            parse_imports_with_symbols("java", "import static org.junit.Assert.assertEquals;\n");
        assert_eq!(j.len(), 1);
        assert_eq!(j[0].path, "org.junit.Assert");
        assert_eq!(j[0].symbols, vec!["assertEquals".to_string()]);

        // Python：`from . import x` 不再丢
        let p = parse_imports_with_symbols("python", "from . import helpers\n");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].path, ".");
        assert_eq!(p[0].symbols, vec!["helpers".to_string()]);

        // TS 零回归护栏：仍走原实现，路径保持相对形态
        let t = parse_imports_with_symbols("typescript", "import { A } from './a';\n");
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].path, "./a");
        assert_eq!(t[0].symbols, vec!["A".to_string()]);
    }

    #[test]
    fn capability_matrix_matches_reality() {
        let r = registry();
        // ts：全能力（符号/依赖/引用/AST）
        let ts = r.capabilities_of("typescript").unwrap();
        assert!(ts.symbols && ts.deps && ts.symbol_refs && ts.ast);
        // vue：有符号（走 ts 正则）但无依赖解析、无 AST
        let vue = r.capabilities_of("vue").unwrap();
        assert!(vue.symbols);
        assert!(!vue.deps);
        assert!(!vue.ast);
    }
}
