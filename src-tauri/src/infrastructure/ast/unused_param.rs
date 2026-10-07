//! 函数内未使用参数检测（joern 到达定义 / DEF-USE 的降级子集，与 unused_local 同族）
//!
//! 参考项目 joern-master：`dataflowengineoss/passes/reachingdef/ReachingDefProblem.scala`
//! 把每个方法参数当作一个 DEF（`defsForParams = method.parameter.l.map { param => ... }`），
//! 若其在数据依赖图（DDG）里没有任何出边（即 joern 查询 `cpg.parameter.whereNot(_.usedBy)`）
//! → 参数定义了却从没被读 → 死参数。
//!
//! 我们当前 `commands/dead_code.rs` 已有三层：①引用级（符号从未被 import/调用）②过程内不可达
//! （CFG 永远走不到的语句）③未使用局部变量（DEF-USE 子集，见 `unused_local.rs`）。
//! 三者都不回答「函数参数定义了却没被用」。本模块补齐这一层，对标 joern 的 DEF-USE，取其中
//! **无歧义、零误报**的子集：
//!
//! **未使用参数**：某函数 `fn f(a, b)` 的参数 `a`，在函数体整棵子树里**再也没以标识符引用的形式
//! 出现过**（排除参数自身的声明节点、同名嵌套作用域声明节点）→ 死参数。与 unused_local 完全同语义，
//! 仅声明来源从「let/const 语句」换成「参数列表」。
//!
//! 零误报保证（更保守，因为未使用参数在真实代码里极常见且多为良性）：
//! - 只看「名字字面量是否再出现为引用标识符」——出现过一次引用就不报（最坏是漏报，不是误报）。
//! - 引用计数覆盖 `identifier` + 对象简写 `shorthand_property_identifier`（如 `return { a }` 的读取侧）。
//! - **约定接收者自动排除**：`self` / `cls` / `this` / `me`（linters 默认忽略，方法里几乎必然「未用」却非错误）。
//! - 以 `_` 开头的参数（作者显式声明「我知道没用」，与引用级死代码一致）。
//! - 解构参数 `function f({ a })` / 剩余参数里的命名（部分使用常见，不报单项）。
//! - 忽略 TypeScript 参数属性 `constructor(private x)`，它隐式成为字段，不能算未用。
//!
//! 置信度固定 `low`：未使用参数常是回调签名、占位参数、API 对齐所致，仅作建议级提示。
//!
//! 实现纯 tree-sitter AST 遍历，零新依赖。覆盖 TS/JS/Rust/Python/Go/Java/C#/C/C++ 共 9 方言
//! （与 `unreachable.rs` / `unused_local.rs` 同源；Swift/Kotlin/Ruby/PHP 节点 kind 未经实跑核实，按铁律先排除）。
//!
//! 输出为纯数据（`Vec<UnusedParam>`），落库与前端呈现由 `commands/dead_code.rs` 负责。

use crate::infrastructure::ast::unused_local::{
    collect_idents, collect_rust_format_names, in_test_context, is_ref_kind, snippet_of, supported,
};
use crate::infrastructure::ast::{dialect_for, Dialect};
use tree_sitter::{Node, Parser};

/// 单条未使用参数发现
#[derive(Debug, Clone)]
pub struct UnusedParam {
    pub line_start: usize,
    pub line_end: usize,
    /// 参数名
    pub name: String,
    /// 该参数的源码片段（截断）
    pub snippet: String,
    /// low：代码异味（建议级，非错误）
    pub confidence: &'static str,
    /// 人类可读的判定说明
    pub reason: &'static str,
}

/// 约定接收者/绑定名——这些名字即使「从未作为标识符出现」也不应报未使用
const CONVENTIONAL_RECEIVERS: &[&str] = &["self", "cls", "this", "me"];

/// 取函数体节点（仅函数级作用域）；非函数节点返回 None。
/// 与 unused_local 的不同：Go 额外识别 `method_declaration`（其接收者在 `receiver` 字段，
/// 不进入 `parameters`，故提取参数时天然跳过，不会把 `r *Repo` 误报为未用）。
fn function_body<'a>(d: Dialect, node: Node<'a>) -> Option<Node<'a>> {
    match d {
        Dialect::TypeScript | Dialect::Tsx => match node.kind() {
            "function_declaration"
            | "function_expression"
            | "generator_function_declaration"
            | "generator_function"
            | "method_definition"
            | "arrow_function" => node.child_by_field_name("body"),
            _ => None,
        },
        Dialect::Rust => match node.kind() {
            "function_item" | "closure_expression" => node.child_by_field_name("body"),
            _ => None,
        },
        Dialect::Python => match node.kind() {
            "function_definition" => node.child_by_field_name("body"),
            _ => None,
        },
        Dialect::Go => match node.kind() {
            "function_declaration" | "method_declaration" | "func_literal" => {
                node.child_by_field_name("body")
            }
            _ => None,
        },
        Dialect::Java => match node.kind() {
            "function_declaration" | "method_declaration" | "constructor_declaration" => {
                node.child_by_field_name("body")
            }
            _ => None,
        },
        Dialect::CSharp => match node.kind() {
            "method_declaration"
            | "constructor_declaration"
            | "local_function_declaration"
            | "anonymous_method_expression"
            | "parenthesized_lambda_expression"
            | "simple_lambda_expression" => node.child_by_field_name("body"),
            _ => None,
        },
        Dialect::Cpp | Dialect::C => match node.kind() {
            "function_definition" => node.child_by_field_name("body"),
            _ => None,
        },
        _ => None,
    }
}

fn is_function_node(d: Dialect, node: Node) -> bool {
    function_body(d, node).is_some()
}

/// 祖先链上是否存在函数节点（用于只处理「最外层函数」，嵌套函数体随外层一起被平铺扫描）
fn has_ancestor_function(d: Dialect, node: Node) -> bool {
    let mut p = node.parent();
    while let Some(pn) = p {
        if function_body(d, pn).is_some() {
            return true;
        }
        p = pn.parent();
    }
    false
}

/// 取参数列表容器节点（不同方言字段名不同）
fn params_container<'a>(d: Dialect, node: Node<'a>) -> Option<Node<'a>> {
    match d {
        Dialect::TypeScript | Dialect::Tsx | Dialect::Python | Dialect::Java | Dialect::CSharp => {
            node.child_by_field_name("parameters")
        }
        Dialect::Go => node.child_by_field_name("parameters"),
        Dialect::Rust => node.child_by_field_name("parameters"),
        Dialect::Cpp | Dialect::C => node
            .child_by_field_name("declarator")
            .and_then(|decl| decl.child_by_field_name("parameters")),
        _ => None,
    }
}

/// 把单个 identifier 节点登记为参数名（约定名/下划线前缀外部统一过滤）
fn push_one<'a>(n: Node<'a>, source: &[u8], out: &mut Vec<(String, usize, usize, String)>) {
    if n.kind() == "identifier" {
        if let Ok(t) = n.utf8_text(source) {
            out.push((
                t.to_string(),
                n.id(),
                n.start_position().row + 1,
                snippet_of(n, source),
            ));
        }
    }
}

/// 从参数 pattern 节点提取简单标识符名（处理默认值 / 可变绑定包裹等形态）
fn push_ident_from_pattern<'a>(
    pat: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, usize, String)>,
) {
    match pat.kind() {
        "identifier" => push_one(pat, source, out),
        "assignment_pattern" => {
            // default value: (a = 1) → 真实名在 left
            if let Some(left) = pat.child_by_field_name("left") {
                push_ident_from_pattern(left, source, out);
            }
        }
        "mutable_binding_pattern" | "binding_pattern" => {
            let mut cursor = pat.walk();
            let kids: Vec<Node<'a>> = pat.named_children(&mut cursor).collect();
            if kids.len() == 1 && kids[0].kind() == "identifier" {
                push_one(kids[0], source, out);
            }
        }
        _ => {
            // 兜底：取第一个 identifier 后代
            let mut cursor = pat.walk();
            let mut stack = vec![pat];
            while let Some(n) = stack.pop() {
                if n.kind() == "identifier" {
                    push_one(n, source, out);
                    return;
                }
                for c in n.named_children(&mut cursor) {
                    stack.push(c);
                }
            }
        }
    }
}

/// 提取单个参数节点（TS/JS 的 required_parameter / C 的 parameter_declaration 等）绑定的名字。
/// 注意：Go / Python 的节点形态与这里不同（名字是参数容器的直接 identifier 子节点），
/// 由 `function_param_names` 单独分发处理，本函数只覆盖 TS/JS/Rust/Java/C#/C/C++。
fn param_names<'a>(
    d: Dialect,
    p: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, usize, String)>,
) {
    match d {
        Dialect::TypeScript | Dialect::Tsx => {
            // 参数属性 constructor(private x) / protected y：带 accessibility_modifier，隐式为字段，不算未用。
            // 其 pattern 字段仍是 identifier（不是 parameter_property 节点），故靠 accessibility_modifier 判定。
            if p.kind() == "parameter_property"
                || p.named_children(&mut p.walk())
                    .any(|ch| ch.kind() == "accessibility_modifier")
            {
                return;
            }
            if let Some(pat) = p.child_by_field_name("pattern") {
                if pat.kind() == "parameter_property" {
                    return;
                }
                push_ident_from_pattern(pat, source, out);
            }
        }
        Dialect::Rust => {
            if let Some(pat) = p.child_by_field_name("pattern") {
                push_ident_from_pattern(pat, source, out);
            }
        }
        Dialect::Java => {
            // 接收者参数 this（Java 8+）不算未用
            if p.kind() == "receiver_parameter" {
                return;
            }
            if let Some(name) = p.child_by_field_name("name") {
                if name.kind() == "identifier" {
                    push_one(name, source, out);
                }
            }
        }
        Dialect::CSharp => {
            if let Some(name) = p.child_by_field_name("name") {
                if name.kind() == "identifier" {
                    push_one(name, source, out);
                }
            }
        }
        Dialect::Cpp | Dialect::C => {
            if let Some(decl) = p.child_by_field_name("declarator") {
                if decl.kind() == "identifier" {
                    push_one(decl, source, out);
                } else {
                    // pointer_declarator / reference_declarator / parenthesized_declarator → 下钻找 identifier
                    let mut cursor = decl.walk();
                    let mut stack = vec![decl];
                    while let Some(n) = stack.pop() {
                        if n.kind() == "identifier" {
                            push_one(n, source, out);
                            break;
                        }
                        for c in n.named_children(&mut cursor) {
                            stack.push(c);
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// 收集某函数节点的所有参数名（含容器遍历）。
/// Go / Python 的参数节点形态特殊（名字是参数容器/声明节点的直接 identifier 子节点），在此分发特殊处理。
fn function_param_names<'a>(
    d: Dialect,
    node: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, usize, String)>,
) {
    if let Some(container) = params_container(d, node) {
        let mut cursor = container.walk();
        for p in container.named_children(&mut cursor) {
            // 跳过类型注解 / 默认值表达式等（它们也可能含 identifier，但本身不是参数名绑定）
            if matches!(
                p.kind(),
                "type_identifier" | "predefined_type" | "optional_type" | "union_type"
            ) {
                continue;
            }
            match d {
                Dialect::Go => {
                    // parameter_declaration：identifier 子节点即参数名，type_identifier 是类型
                    let mut c2 = p.walk();
                    for c in p.named_children(&mut c2) {
                        if c.kind() == "identifier" {
                            push_one(c, source, out);
                        }
                    }
                }
                Dialect::Python => {
                    // 简单形参是 parameters 的直接 identifier；default/typed/*args 用 name 字段
                    if p.kind() == "identifier" {
                        push_one(p, source, out);
                    } else if let Some(name) = p.child_by_field_name("name") {
                        if name.kind() == "identifier" {
                            push_one(name, source, out);
                        }
                    }
                }
                _ => param_names(d, p, source, out),
            }
        }
    }
}

/// 遍历函数体子树：收集引用标识符出现（与 unused_local 同口径，含 Rust 命名格式插值）
fn collect_refs<'a>(node: Node<'a>, d: Dialect, source: &[u8], refs: &mut Vec<(String, usize)>) {
    if is_ref_kind(node.kind()) {
        if let Ok(t) = node.utf8_text(source) {
            refs.push((t.to_string(), node.id()));
        }
    }
    if d == Dialect::Rust
        && (node.kind() == "string_literal" || node.kind() == "raw_string_literal")
    {
        if let Ok(t) = node.utf8_text(source) {
            collect_rust_format_names(t, refs);
        }
    }
    let mut cursor = node.walk();
    for kid in node.named_children(&mut cursor) {
        collect_refs(kid, d, source, refs);
    }
}

/// 在单个函数上做「未使用参数」判定（参数名在体子树内从未被引用）
fn scan_function<'a>(d: Dialect, node: Node<'a>, source: &[u8], out: &mut Vec<UnusedParam>) {
    let Some(body) = function_body(d, node) else {
        return;
    };
    let mut params: Vec<(String, usize, usize, String)> = Vec::new();
    function_param_names(d, node, source, &mut params);
    let mut refs: Vec<(String, usize)> = Vec::new();
    collect_refs(body, d, source, &mut refs);

    // 参数声明节点 id 集合（声明节点本身不算使用）
    let mut param_ids_by_name: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (name, id, _, _) in &params {
        param_ids_by_name.entry(name.clone()).or_default().push(*id);
    }

    for (name, _pid, row, snippet) in &params {
        if CONVENTIONAL_RECEIVERS.contains(&name.as_str())
            || name.starts_with('_')
            || name.is_empty()
        {
            continue;
        }
        let ids = param_ids_by_name.get(name).cloned().unwrap_or_default();
        let used = refs
            .iter()
            .any(|(rn, rid)| rn == name && !ids.contains(rid));
        if used {
            continue;
        }
        out.push(UnusedParam {
            line_start: *row,
            line_end: *row,
            name: name.clone(),
            snippet: snippet.clone(),
            confidence: "low",
            reason: "函数参数声明后从未被读取，如确无用可删除或改用 _ 前缀",
        });
    }
}

/// 主入口：检测单文件的未使用参数
pub fn detect_unused_params(lang: &str, rel_path: &str, content: &str) -> Vec<UnusedParam> {
    let dialect = match dialect_for(lang, rel_path) {
        Some(d) if supported(d) => d,
        _ => return Vec::new(), // 不支持的方言直接返回空，零误报
    };
    if content.len() > 2_000_000 {
        return Vec::new();
    }
    let mut parser = Parser::new();
    let Ok(()) = parser.set_language(&dialect.language()) else {
        return Vec::new();
    };
    let Some(tree) = parser.parse(content, None) else {
        return Vec::new();
    };
    let bytes = content.as_bytes();
    let root = tree.root_node();
    if root.has_error() {
        return Vec::new(); // 语法错误文件不分析，避免 ERROR 节点导致误报
    }
    let mut out = Vec::new();

    // 收集最外层函数节点（含嵌套），只处理无祖先函数者；嵌套函数体随外层平铺扫描
    let mut stack: Vec<Node> = vec![root];
    while let Some(n) = stack.pop() {
        if is_function_node(dialect, n)
            && !has_ancestor_function(dialect, n)
            && !in_test_context(dialect, n, bytes)
        {
            scan_function(dialect, n, bytes, &mut out);
        }
        let mut cursor = n.walk();
        for kid in n.named_children(&mut cursor) {
            stack.push(kid);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(lang: &str, src: &str) -> Vec<UnusedParam> {
        detect_unused_params(lang, &format!("test.{}", lang), src)
    }

    fn names(rs: &[UnusedParam]) -> Vec<String> {
        rs.iter().map(|u| u.name.clone()).collect()
    }

    #[test]
    fn ts_unused_param_detected() {
        let src = r#"
function f(a, b) {
  return a;
}
"#;
        let r = run("typescript", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"a".to_string()));
    }

    #[test]
    fn ts_used_param_not_flagged() {
        let src = r#"
function f(a, b) {
  return a + b;
}
"#;
        let r = run("typescript", src);
        assert!(
            names(&r).is_empty(),
            "两个参数都被使用不应报错，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_underscore_param_intentional() {
        let src = r#"
function f(a, _b) {
  return a;
}
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"_b".to_string()));
    }

    #[test]
    fn ts_default_param_still_detected() {
        let src = r#"
function f(a, b = 1) {
  return a;
}
"#;
        let r = run("typescript", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "带默认值的未用参数也应检出，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_parameter_property_not_flagged() {
        // constructor(private x) 隐式字段，不应报未用
        let src = r#"
class A {
  constructor(private x: number) {}
}
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"x".to_string()),
            "参数属性不应报未用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn rust_unused_param_detected() {
        let src = r#"
fn f(a: i32, b: i32) -> i32 {
    a
}
"#;
        let r = run("rust", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
        assert!(!names(&r).contains(&"a".to_string()));
    }

    #[test]
    fn rust_self_not_flagged() {
        // 方法接收者 self 即使未用也不报
        let src = r#"
struct S;
impl S {
    fn f(&self, a: i32) -> i32 { a }
}
"#;
        let r = run("rust", src);
        assert!(!names(&r).contains(&"self".to_string()));
    }

    #[test]
    fn python_self_not_flagged() {
        let src = r#"
class A:
    def f(self, a):
        return a
"#;
        let r = run("python", src);
        assert!(!names(&r).contains(&"self".to_string()));
    }

    #[test]
    fn python_unused_param_detected() {
        let src = r#"
def f(a, b):
    return a
"#;
        let r = run("python", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn go_unused_param_detected_receiver_skipped() {
        // 方法接收者 r 不应被报；普通参数 b 未用应报
        let src = r#"
package main
type Repo struct{}
func (r *Repo) Get(a int, b int) int {
    return a
}
"#;
        let r = run("go", src);
        assert!(
            !names(&r).contains(&"r".to_string()),
            "接收者 r 不应报未用，实际: {:?}",
            names(&r)
        );
        assert!(
            names(&r).contains(&"b".to_string()),
            "未用参数 b 应报，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn go_multi_name_param() {
        // a, b int —— a 被用、b 未用
        let src = r#"
package main
func f(a, b int) int {
    return a
}
"#;
        let r = run("go", src);
        assert!(!names(&r).contains(&"a".to_string()));
        assert!(
            names(&r).contains(&"b".to_string()),
            "a,b int 中 b 未用应报，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn java_unused_param_detected() {
        let src = r#"
class A {
    int f(int a, int b) {
        return a;
    }
}
"#;
        let r = run("java", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn c_unused_param_detected() {
        let src = r#"
int f(int a, int b) {
    return a;
}
"#;
        let r = run("c", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn csharp_unused_param_detected() {
        let src = r#"
class A {
    int F(int a, int b) {
        return a;
    }
}
"#;
        let r = run("csharp", src);
        assert!(
            names(&r).contains(&"b".to_string()),
            "应检出未使用参数 b，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn nested_shadow_param_safe_miss() {
        // 参数 b 被内部函数读取 → 视作已用（漏报，安全，不误报）
        let src = r#"
function f(a, b) {
  function g() { return b; }
  return a;
}
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"b".to_string()),
            "被嵌套函数使用的参数不应误报，实际: {:?}",
            names(&r)
        );
    }

    /// 真实目录回放探针（env-gated，与历轮 replay_* 同口径）：统计某目录下各语言未使用参数数量，
    /// 用于「renderable ≠ useful」最终验收——确认该功能在真实代码库上确有产出（非仅单测锁）。
    #[test]
    fn replay_unused_params_dir() {
        let dir = match std::env::var("REPLAY_UNUSED_PARAM_DIR") {
            Ok(d) => d,
            Err(_) => return, // 无 env 时不运行，避免污染普通 test
        };
        let mut total = 0usize;
        let mut by_lang: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let mut parsed_files = 0usize;
        let verbose = std::env::var("REPLAY_UNUSED_PARAM_VERBOSE").is_ok();
        let mut samples: Vec<String> = Vec::new();
        replay_dir(
            std::path::Path::new(&dir),
            &mut total,
            &mut by_lang,
            &mut parsed_files,
            if verbose { Some(&mut samples) } else { None },
        );
        eprintln!(
            "[replay_unused_params] dir={} files={} total_unused_param={} by_lang={{ {:?} }}",
            dir, parsed_files, total, by_lang
        );
        for s in &samples {
            eprintln!("  - {}", s);
        }
        // 探针本身不断言，仅打印；真实收益由人工核对
    }

    fn replay_dir(
        p: &std::path::Path,
        total: &mut usize,
        by_lang: &mut std::collections::HashMap<String, usize>,
        parsed_files: &mut usize,
        mut samples: Option<&mut Vec<String>>,
    ) {
        let lang_of = |ext: &str| -> Option<&'static str> {
            match ext {
                "rs" => Some("rust"),
                "ts" | "tsx" => Some("typescript"),
                "js" | "jsx" | "mjs" => Some("typescript"), // 走 TSX grammar
                "py" => Some("python"),
                "go" => Some("go"),
                "java" => Some("java"),
                "cs" => Some("csharp"),
                "c" | "h" => Some("c"),
                "cpp" | "cc" | "cxx" | "hpp" | "hh" => Some("cpp"),
                _ => None,
            }
        };
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if matches!(
                    name,
                    "node_modules" | "target" | ".git" | "dist" | "dist-i18n"
                ) {
                    return;
                }
            }
            if let Ok(entries) = std::fs::read_dir(p) {
                for e in entries.flatten() {
                    replay_dir(
                        &e.path(),
                        total,
                        by_lang,
                        parsed_files,
                        samples.as_deref_mut(),
                    );
                }
            }
        } else if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if let Some(lang) = lang_of(ext) {
                if let Ok(content) = std::fs::read_to_string(p) {
                    *parsed_files += 1;
                    let rel = p.to_string_lossy().to_string();
                    let found = detect_unused_params(lang, &rel, &content);
                    if !found.is_empty() {
                        *by_lang.entry(lang.to_string()).or_default() += found.len();
                        *total += found.len();
                        if let Some(s) = samples {
                            for f in &found {
                                s.push(format!(
                                    "{}:{}  {}  ({})",
                                    rel, f.line_start, f.name, f.snippet
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
}
