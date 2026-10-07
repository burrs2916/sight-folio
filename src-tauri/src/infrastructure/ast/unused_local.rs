//! 函数内未使用局部变量检测（joern 到达定义 / DEF-USE 的降级子集）
//!
//! 参考项目 joern-master：`dataflowengineoss` 在 CPG 上建完整「到达定义」（reaching
//! definition）数据流，核心原语 `DdgGenerator.usedIncomingDefsForNode` / `uses(node)`
//! 回答「这个定义（DEF）在哪些地方被使用（USE）」。一个局部变量的 DEF 若在数据依赖图
//! （DDG）里没有任何出边 → 它定义了却从没被读 → 是死变量。
//!
//! 我们当前 `commands/dead_code.rs` 只做两层死代码：①**引用级**（符号从未被 import/调用）②
//! **过程内不可达**（CFG 永远走不到的语句，见 `unreachable.rs`）。两者都不回答「变量定义了
//! 但没被用」。本模块补齐这一层，对标 joern 的 DEF-USE，但取其中**无歧义、零误报**的子集：
//!
//! **未使用局部变量**：在某函数体内，`let/const/var x = …`（或等价声明）绑定了一个名字 `x`，
//! 而 `x` 在此函数体的整棵子树里**再也没以标识符引用的形式出现过**（排除它自己的声明节点，
//! 也排除同名嵌套作用域声明节点）→ 死变量。
//!
//! 零误报保证（与 joern 同语义、但用更保守的启发式兜底）：
//! - 只看「名字字面量是否再出现为引用标识符」——只要出现过一次引用就不报（最坏是漏报，不是误报）。
//! - 引用计数覆盖 `identifier` + 对象简写 `shorthand_property_identifier`（如 `return { x }`、
//!   `const { x } = obj` 的读取侧）→ 避免把简写使用误判为未使用。
//! - 排除以下情况（都是真阳性或已知安全取舍，宁缺毋滥）：
//!   - 名字以 `_` 开头（作者显式声明「我知道没用」，与引用级死代码一致）。
//!   - 解构声明 `const { a, b } = …` / `let (a, b) = …`（部分使用常见，报单项会吵）→ 不收集这些名字。
//!   - 重赋值 `x = x + 1` / 增广赋值 `x += 1`（本身是 use，名字必然再现）。
//!   - 同名嵌套作用域（内部 `let x` 与外层 `x` 撞名）→ 名字在子树里再现 → 外层不报（漏报，安全）。
//!
//! 实现纯 tree-sitter AST 遍历，零新依赖。覆盖 TS/JS/Rust/Python/Go/Java/C#/C/C++ 共 9 方言
//! （与 `unreachable.rs` 同源；Swift/Kotlin/Ruby/PHP 节点 kind 未经实跑核实，按铁律先排除）。
//!
//! 输出为纯数据（`Vec<UnusedLocal>`），落库与前端呈现由 `commands/dead_code.rs` 负责，
//! 保持本模块可被单测直接驱动、无 DB 耦合。

use crate::infrastructure::ast::{dialect_for, Dialect};
use tree_sitter::{Node, Parser};

/// 单条未使用局部变量发现
#[derive(Debug, Clone)]
pub struct UnusedLocal {
    pub line_start: usize,
    pub line_end: usize,
    /// 变量名
    pub name: String,
    /// 该声明的源码片段（截断）
    pub snippet: String,
    /// low：代码异味（建议级，非错误）；对标 joern 把「未使用」视为弱信号
    pub confidence: &'static str,
    /// 人类可读的判定说明
    pub reason: &'static str,
}

/// 引用侧参与计数的节点 kind（声明名字节点之外的「使用」形态）
pub fn is_ref_kind(kind: &str) -> bool {
    matches!(
        kind,
        "identifier" | "shorthand_property_identifier" | "shorthand_property_identifier_pattern"
    )
}

/// Rust `format!`/`println!` 的命名插值 `{name}` / `{name:fmt}` 在 tree-sitter 里只是字符串内容，
/// 不以 identifier 节点呈现 → 若只看 identifier 引用会把 `let x = ...; println!("{x}")` 误判为未使用。
/// 这里把字符串字面量里的命名插值补登记为「使用」，保证零误报（只增不减，最坏是漏报）。
pub fn collect_rust_format_names(text: &str, refs: &mut Vec<(String, usize)>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                i += 2; // 转义 {{
                continue;
            }
            let start = i + 1;
            let mut j = start;
            while j < bytes.len()
                && bytes[j] != b'}'
                && bytes[j] != b':'
                && !bytes[j].is_ascii_whitespace()
            {
                j += 1;
            }
            let name = &text[start..j];
            if !name.is_empty()
                && name
                    .chars()
                    .next()
                    .map(|c| c.is_alphabetic() || c == '_')
                    .unwrap_or(false)
            {
                refs.push((name.to_string(), usize::MAX));
            }
            // 跳到 '}' 之后
            while j < bytes.len() && bytes[j] != b'}' {
                j += 1;
            }
            i = if j < bytes.len() { j + 1 } else { j };
        } else {
            i += 1;
        }
    }
}

/// Rust `#[test]` / `#[cfg(test)]` 上下文判定：tree-sitter-rust 把属性作为**被标注项的前驱兄弟节点**
/// （而非子节点）呈现，故需沿「当前节点及其所有祖先」的**前驱兄弟**查找 `attribute` 且文本含 "test"。
/// 命中 → 视为测试代码，跳过未使用检测（测试辅助变量本就允许未使用）。
pub fn in_test_context(d: Dialect, node: Node, source: &[u8]) -> bool {
    if d != Dialect::Rust {
        return false;
    }
    let mut cur = Some(node);
    while let Some(n) = cur {
        let mut sib = n.prev_sibling();
        while let Some(s) = sib {
            if s.kind() == "attribute_item" {
                if let Ok(t) = s.utf8_text(source) {
                    if t.contains("test") {
                        return true;
                    }
                }
            }
            sib = s.prev_sibling();
        }
        cur = n.parent();
    }
    false
}

/// 该方言是否支持未使用局部变量检测（节点 kind 已确认）
pub fn supported(d: Dialect) -> bool {
    matches!(
        d,
        Dialect::TypeScript
            | Dialect::Tsx
            | Dialect::Rust
            | Dialect::Python
            | Dialect::Go
            | Dialect::Java
            | Dialect::CSharp
            | Dialect::Cpp
            | Dialect::C
    )
}

/// 取函数体节点（仅函数级作用域）；非函数节点返回 None
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
            "function_declaration" | "func_literal" => node.child_by_field_name("body"),
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

/// 把某节点下所有直接/间接的 identifier 命名子节点收集进 `out`（用于 Go 名字列表等）
pub fn collect_idents<'a>(
    node: Node<'a>,
    source: &[u8],
    out: &mut Vec<(String, usize, usize, String)>,
) {
    let mut cursor = node.walk();
    for c in node.named_children(&mut cursor) {
        if c.kind() == "identifier" {
            if let Ok(t) = c.utf8_text(source) {
                out.push((
                    t.to_string(),
                    c.id(),
                    c.start_position().row + 1,
                    snippet_of(c, source),
                ));
            }
        }
    }
}

/// 取声明的源码片段（截断到 80 字符，用于落库 message）
pub fn snippet_of<'a>(node: Node<'a>, source: &[u8]) -> String {
    let s = node.utf8_text(source).unwrap_or("").trim().to_string();
    if s.len() > 80 {
        format!("{}…", &s[..80])
    } else {
        s
    }
}

/// 取 Rust `let` 模式里的简单标识符绑定（排除元组/结构体/通配等解构）
fn rust_let_name<'a>(pat: Node<'a>, source: &[u8]) -> Option<(String, usize, usize, String)> {
    if pat.kind() == "identifier" {
        return pat.utf8_text(source).ok().map(|t| {
            (
                t.to_string(),
                pat.id(),
                pat.start_position().row + 1,
                snippet_of(pat, source),
            )
        });
    }
    // 单层包裹（如 `mutable_binding_pattern`）取唯一 identifier 子节点
    let mut cursor = pat.walk();
    let kids: Vec<Node<'a>> = pat.named_children(&mut cursor).collect();
    if kids.len() == 1 && kids[0].kind() == "identifier" {
        return kids[0].utf8_text(source).ok().map(|t| {
            (
                t.to_string(),
                kids[0].id(),
                kids[0].start_position().row + 1,
                snippet_of(kids[0], source),
            )
        });
    }
    None
}

/// 提取单条声明节点绑定的简单标识符名（无则返回空）——对标 joern 只认「具名 DEF」
/// 返回 (名字, 声明节点 id, 行号, 片段)
fn decl_bindings<'a>(
    d: Dialect,
    node: Node<'a>,
    source: &[u8],
) -> Vec<(String, usize, usize, String)> {
    let mut out: Vec<(String, usize, usize, String)> = Vec::new();
    match d {
        Dialect::TypeScript | Dialect::Tsx | Dialect::Java | Dialect::CSharp => {
            if node.kind() == "variable_declarator" {
                if let Some(name) = node.child_by_field_name("name") {
                    if name.kind() == "identifier" {
                        if let Ok(t) = name.utf8_text(source) {
                            out.push((
                                t.to_string(),
                                name.id(),
                                name.start_position().row + 1,
                                snippet_of(name, source),
                            ));
                        }
                    }
                }
            }
        }
        Dialect::Cpp | Dialect::C => {
            // int x = 1;  → init_declarator { declarator: identifier, value }
            if node.kind() == "init_declarator" {
                if let Some(decl) = node.child_by_field_name("declarator") {
                    if decl.kind() == "identifier" {
                        if let Ok(t) = decl.utf8_text(source) {
                            out.push((
                                t.to_string(),
                                decl.id(),
                                decl.start_position().row + 1,
                                snippet_of(decl, source),
                            ));
                        }
                    }
                }
            }
        }
        Dialect::Rust => {
            if node.kind() == "let_declaration" {
                if let Some(pat) = node.child_by_field_name("pattern") {
                    if let Some(b) = rust_let_name(pat, source) {
                        out.push(b);
                    }
                }
            }
        }
        Dialect::Python => {
            // x = 1（单个标识符目标）；排除增广赋值（那是 use+rebind）
            if node.kind() == "assignment" {
                if let Some(left) = node.child_by_field_name("left") {
                    if left.kind() == "identifier" {
                        if let Ok(t) = left.utf8_text(source) {
                            out.push((
                                t.to_string(),
                                left.id(),
                                left.start_position().row + 1,
                                snippet_of(left, source),
                            ));
                        }
                    }
                }
            } else if node.kind() == "for_in_clause" {
                // for x in ...：循环变量
                if let Some(left) = node.child_by_field_name("left") {
                    if left.kind() == "identifier" {
                        if let Ok(t) = left.utf8_text(source) {
                            out.push((
                                t.to_string(),
                                left.id(),
                                left.start_position().row + 1,
                                snippet_of(left, source),
                            ));
                        }
                    }
                }
            }
        }
        Dialect::Go => {
            if node.kind() == "short_var_declaration" {
                // a, b := f()  → left: expression_list of identifiers
                if let Some(left) = node.child_by_field_name("left") {
                    collect_idents(left, source, &mut out);
                }
            } else if node.kind() == "var_declaration" {
                // var x = 1 / const x = 1（函数体内）→ var_spec/const_spec 的 name_list
                let mut cursor = node.walk();
                for kid in node.named_children(&mut cursor) {
                    if kid.kind() == "var_spec" || kid.kind() == "const_spec" {
                        if let Some(names) = kid.child_by_field_name("name_list") {
                            collect_idents(names, source, &mut out);
                        }
                    }
                }
            }
        }
        _ => {}
    }
    out
}

/// 遍历函数体子树：收集声明绑定 + 引用标识符出现
fn visit_all<'a>(
    node: Node<'a>,
    d: Dialect,
    source: &[u8],
    decls: &mut Vec<(String, usize, usize, String)>,
    refs: &mut Vec<(String, usize)>,
) {
    for b in decl_bindings(d, node, source) {
        decls.push(b);
    }
    if is_ref_kind(node.kind()) {
        if let Ok(t) = node.utf8_text(source) {
            refs.push((t.to_string(), node.id()));
        }
    }
    // Rust 命名格式插值 `{name}`（仅 Rust；其余方言的 f-string/位置参数已被 tree-sitter 正确解析）
    if d == Dialect::Rust
        && (node.kind() == "string_literal" || node.kind() == "raw_string_literal")
    {
        if let Ok(t) = node.utf8_text(source) {
            collect_rust_format_names(t, refs);
        }
    }
    let mut cursor = node.walk();
    for kid in node.named_children(&mut cursor) {
        visit_all(kid, d, source, decls, refs);
    }
}

/// 在单个函数体子树内做「平铺」未使用判定（含嵌套函数，避免跨作用域重复落点）
fn scan_body<'a>(d: Dialect, body: Node<'a>, source: &[u8], out: &mut Vec<UnusedLocal>) {
    let mut decls: Vec<(String, usize, usize, String)> = Vec::new();
    let mut refs: Vec<(String, usize)> = Vec::new();
    visit_all(body, d, source, &mut decls, &mut refs);

    // 同名声明节点 id 集合（排除这些 id 后，剩下的同名词面量出现才是「使用」）
    let mut decl_ids_by_name: std::collections::HashMap<String, Vec<usize>> =
        std::collections::HashMap::new();
    for (name, id, _, _) in &decls {
        decl_ids_by_name.entry(name.clone()).or_default().push(*id);
    }

    for (name, _decl_id, row, snippet) in &decls {
        let decl_ids = decl_ids_by_name.get(name).cloned().unwrap_or_default();
        let used = refs
            .iter()
            .any(|(rn, rid)| rn == name && !decl_ids.contains(rid));
        if used || name.starts_with('_') || name.is_empty() {
            continue;
        }
        out.push(UnusedLocal {
            line_start: *row,
            line_end: *row,
            name: name.clone(),
            snippet: snippet.clone(),
            confidence: "low",
            reason: "变量声明后从未被读取，可删除或改用 _ 前缀忽略",
        });
    }
}

/// 主入口：检测单文件的未使用局部变量
pub fn detect_unused_locals(lang: &str, rel_path: &str, content: &str) -> Vec<UnusedLocal> {
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
            if let Some(body) = function_body(dialect, n) {
                scan_body(dialect, body, bytes, &mut out);
            }
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

    fn run(lang: &str, src: &str) -> Vec<UnusedLocal> {
        detect_unused_locals(lang, &format!("test.{}", lang), src)
    }

    fn names(rs: &[UnusedLocal]) -> Vec<String> {
        rs.iter().map(|u| u.name.clone()).collect()
    }

    #[test]
    fn ts_unused_const_detected() {
        let src = r#"
function f() {
  const unused = compute();
  return 1;
}
"#;
        let r = run("typescript", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用 const unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_used_const_not_flagged() {
        let src = r#"
function f() {
  const used = compute();
  return used;
}
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"used".to_string()));
    }

    #[test]
    fn ts_shorthand_return_is_use() {
        // return { x } 的 x 是 shorthand_property_identifier，应算使用
        let src = r#"
function f() {
  const x = compute();
  return { x };
}
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"x".to_string()),
            "简写返回应视为使用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn ts_underscore_intentional() {
        let src = r#"
function f() {
  const _tmp = compute();
  return 1;
}
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"_tmp".to_string()));
    }

    #[test]
    fn ts_destructure_not_flagged() {
        // 解构声明不收集名字 → 不误报
        let src = r#"
function f() {
  const { a, b } = useParams();
  return a;
}
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"b".to_string()));
    }

    #[test]
    fn ts_for_of_var_used() {
        let src = r#"
function f(arr) {
  for (const x of arr) {
    console.log(x);
  }
}
"#;
        let r = run("typescript", src);
        assert!(!names(&r).contains(&"x".to_string()));
    }

    #[test]
    fn rust_unused_let_detected() {
        let src = r#"
fn f() -> i32 {
    let unused = heavy();
    1
}
"#;
        let r = run("rust", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用 let unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn rust_let_mut_used() {
        let src = r#"
fn f() -> i32 {
    let mut acc = 0;
    acc += 1;
    acc
}
"#;
        let r = run("rust", src);
        assert!(
            !names(&r).contains(&"acc".to_string()),
            "let mut 被使用不应误报，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn rust_format_named_interp_is_use() {
        // format!("{name}") 的 name 是命名插值，应算使用（避免把 format 宏误判为未使用）
        let src = r#"
fn f() -> String {
    let name = "world".to_string();
    format!("hello {name}")
}
"#;
        let r = run("rust", src);
        assert!(
            !names(&r).contains(&"name".to_string()),
            "format! 命名插值应视为使用，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn rust_test_fn_skipped() {
        // #[test] 函数整体跳过（测试辅助变量允许未使用）
        let src = r#"
#[test]
fn probe() {
    let unused = compute();
    let _other = 2;
}
"#;
        let r = run("rust", src);
        assert!(
            !names(&r).contains(&"unused".to_string()),
            "#[test] 函数应跳过，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn rust_cfg_test_mod_skipped() {
        // #[cfg(test)] mod 内的函数跳过
        let src = r#"
#[cfg(test)]
mod tests {
    fn helper() {
        let unused = 1;
    }
}
"#;
        let r = run("rust", src);
        assert!(
            !names(&r).contains(&"unused".to_string()),
            "#[cfg(test)] mod 应跳过，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn python_unused_assignment_detected() {
        let src = r#"
def f():
    unused = compute()
    return 1
"#;
        let r = run("python", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用赋值 unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn python_used_assignment_not_flagged() {
        let src = r#"
def f():
    used = compute()
    return used
"#;
        let r = run("python", src);
        assert!(!names(&r).contains(&"used".to_string()));
    }

    #[test]
    fn go_short_var_unused_detected() {
        let src = r#"
package main
func f() int {
    unused := compute()
    return 1
}
"#;
        let r = run("go", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用 := unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn java_unused_local_detected() {
        let src = r#"
class A {
    int f() {
        int unused = compute();
        return 1;
    }
}
"#;
        let r = run("java", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用局部 int unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn c_unused_local_detected() {
        let src = r#"
int f() {
    int unused = compute();
    return 1;
}
"#;
        let r = run("c", src);
        assert!(
            names(&r).contains(&"unused".to_string()),
            "应检出未使用局部 int unused，实际: {:?}",
            names(&r)
        );
    }

    #[test]
    fn no_false_positive_on_nested_shadow() {
        // 外层 x 被内部函数读取 → 视作已使用（漏报，安全，不误报）
        let src = r#"
function f() {
  const x = 1;
  function g() { return x; }
  return 2;
}
"#;
        let r = run("typescript", src);
        assert!(
            !names(&r).contains(&"x".to_string()),
            "被嵌套函数使用的外层变量不应误报，实际: {:?}",
            names(&r)
        );
    }

    /// 真实目录回放探针（env-gated，与历轮 replay_* 同口径）：统计某目录下各语言未使用局部变量数量，
    /// 用于「renderable ≠ useful」最终验收——确认该功能在真实代码库上确有产出（非仅单测锁）。
    #[test]
    fn replay_unused_locals_dir() {
        let dir = match std::env::var("REPLAY_UNUSED_DIR") {
            Ok(d) => d,
            Err(_) => return, // 无 env 时不运行，避免污染普通 test
        };
        let mut total = 0usize;
        let mut by_lang: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let mut parsed_files = 0usize;
        let verbose = std::env::var("REPLAY_UNUSED_VERBOSE").is_ok();
        let mut samples: Vec<String> = Vec::new();
        replay_dir(
            std::path::Path::new(&dir),
            &mut total,
            &mut by_lang,
            &mut parsed_files,
            if verbose { Some(&mut samples) } else { None },
        );
        eprintln!(
            "[replay_unused_locals] dir={} files={} total_unused={} by_lang={{ {:?} }}",
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
                "cs" => Some("c_sharp"),
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
                    let found = detect_unused_locals(lang, &rel, &content);
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
