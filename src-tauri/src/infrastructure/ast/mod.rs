//! AST 级源码解析引擎（tree-sitter）
//!
//! ## 为什么需要它
//!
//! 此前所有代码度量都建立在**逐行正则/关键字匹配**之上，精度天花板很低：
//!
//! | 误判场景 | 行级启发式的结果 | AST 的结果 |
//! |---|---|---|
//! | `const msg = "if you see this"` | 复杂度 +1（命中 `"if "`） | 不计（字符串字面量） |
//! | `// case: 兼容旧版` | 复杂度 +1（命中 `case `） | 不计（注释节点） |
//! | `Map<string, T \| undefined>` | 复杂度 +1（命中 `\|\|`） | 不计（类型注解） |
//! | `foo?.bar ?? baz` | 三元统计要靠减法凑 | 精确区分可选链/空值合并 |
//! | 一个 800 行文件里哪个函数最复杂 | **无法回答**（只有文件级） | 逐函数 CC/嵌套/参数数 |
//!
//! ## 设计约束
//!
//! - **优雅降级**：只有 TypeScript/TSX/JavaScript/Rust/Python 有语法支持，
//!   其余语言（go/java/c...）继续走原有行级启发式，绝不因为接了 AST 就丢功能。
//! - **纯函数**：本模块不碰数据库、不碰 Tauri State，只做 `源码 -> 度量`，便于单测。
//! - **容错**：源码有语法错误时 tree-sitter 仍会产出带 ERROR 节点的树，
//!   我们照常统计（部分结果好过没有结果），只在 `has_error` 上做标记。

pub mod dataflow;
pub mod flow_semantics;
pub mod unreachable;
pub mod unused_import;
pub mod unused_local;
pub mod unused_param;

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser};

/// 单个函数/方法的度量（AST 独有能力：文件级度量下钻到函数级）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionMetric {
    /// 函数名（匿名函数回退为 `(anonymous)`；箭头函数取被赋值的变量名）
    pub name: String,
    /// 起始行（1-based，与源码查看器/画布跳转口径一致）
    pub line: i64,
    /// 结束行（1-based）
    pub end_line: i64,
    /// 函数体行数
    pub lines: i64,
    /// 函数级圈复杂度（1 + 该函数子树内的判定节点数，嵌套函数计入自身）
    pub cc: i64,
    /// 形参个数
    pub params: i64,
    /// 函数内最大控制流嵌套深度
    pub max_nesting: i64,
}

/// 阈值型魔法数字（比较上下文中的裸数字）
///
/// 只收「比较上下文」里的数字（`if (retry > 3)`、`while (i < 86400)`），
/// 不收样式常量与配置对象——否则在 MUI/React 代码里会淹没在 `fontSize: 12` 中，
/// 变成没人看的噪声。这是刻意收窄的口径。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MagicNumber {
    pub line: i64,
    pub value: String,
    /// 所在行去空白后的片段（≤120 字符），供前端直接展示
    pub snippet: String,
}

/// 一个文件的 AST 分析结果
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AstFileAnalysis {
    /// 文件级圈复杂度（1 + 全文件判定节点数）
    pub cyclomatic_complexity: i64,
    /// 全文件最大嵌套深度
    pub max_nesting: i64,
    /// 函数级明细（按 cc 降序）
    pub functions: Vec<FunctionMetric>,
    /// 阈值魔法数字
    pub magic_numbers: Vec<MagicNumber>,
    /// 解析树是否包含语法错误节点（度量仍可用，仅作提示）
    pub has_error: bool,
    /// 语法错误节点所在行号（1 起，去重升序；R46 起用于「直接提示语法错误」）
    pub error_lines: Vec<usize>,
}

impl AstFileAnalysis {
    pub fn function_count(&self) -> i64 {
        self.functions.len() as i64
    }
    pub fn max_function_cc(&self) -> i64 {
        self.functions.iter().map(|f| f.cc).max().unwrap_or(0)
    }
    /// 最复杂函数名（供前端「热点函数」直接展示，无需再排序）
    pub fn hottest_function(&self) -> Option<&FunctionMetric> {
        self.functions.iter().max_by_key(|f| f.cc)
    }
}

/// 语法方言：同一 `language` 字段下 .ts 与 .tsx 需要不同 grammar
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    TypeScript,
    Tsx,
    Rust,
    Python,
    /// Go（tree-sitter-go）
    Go,
    /// Java（tree-sitter-java）
    Java,
    /// C#（tree-sitter-c-sharp）
    CSharp,
    /// C++（tree-sitter-cpp）
    Cpp,
    /// C（tree-sitter-c）—— .c/.h，与 C++ 语法族相近但节点集更小
    C,
    /// Ruby（tree-sitter-ruby）
    Ruby,
    /// PHP（tree-sitter-php，用 LANGUAGE_PHP 以吃 HTML+PHP 混排文件）
    Php,
    /// Kotlin（tree-sitter-kotlin-ng）
    Kotlin,
    /// Swift（tree-sitter-swift）
    Swift,
}

impl Dialect {
    pub(crate) fn language(self) -> Language {
        match self {
            Dialect::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Dialect::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Dialect::Rust => tree_sitter_rust::LANGUAGE.into(),
            Dialect::Python => tree_sitter_python::LANGUAGE.into(),
            Dialect::Go => tree_sitter_go::LANGUAGE.into(),
            Dialect::Java => tree_sitter_java::LANGUAGE.into(),
            Dialect::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Dialect::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Dialect::C => tree_sitter_c::LANGUAGE.into(),
            Dialect::Ruby => tree_sitter_ruby::LANGUAGE.into(),
            // LANGUAGE_PHP 支持 `<?php ... ?>` 与 HTML 混排；LANGUAGE_PHP_ONLY 只吃纯 PHP，
            // 真实项目里 .php 常带 HTML，故选前者。
            Dialect::Php => tree_sitter_php::LANGUAGE_PHP.into(),
            Dialect::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Dialect::Swift => tree_sitter_swift::LANGUAGE.into(),
        }
    }

    /// 该方言是否具备**函数级数据流**支持。
    ///
    /// AST 度量（复杂度/嵌套/函数计数/魔法数字）覆盖全部方言，但数据流（参数 → 返回值 /
    /// 副作用 / 污点传播）目前只实现了这 4 种。其余方言优雅降级：`analyze_dataflow`
    /// 直接返回 `None`，下游据此跳过数据流相关画像，而不是拿到一个空壳结构。
    pub(crate) fn has_dataflow(self) -> bool {
        matches!(
            self,
            Dialect::TypeScript | Dialect::Tsx | Dialect::Rust | Dialect::Python
        )
    }
}

/// 由「语言标识 + 文件路径」决定方言。
///
/// 扫描器把 .ts / .tsx 统一标成 `typescript`，而 TSX 里的 `<div>` 用 TS grammar 解析会整片报错，
/// 所以必须再看一眼扩展名。JSX 的 .js/.jsx 同理走 TSX grammar（TSX 是 JS 的超集，解析 JS 无副作用）。
///
/// R45（解析器插件化）：方言判定收敛到 ParserRegistry（单一事实源）。
/// 本函数转发到 `crate::parser::dialect_for`；底层 Dialect 枚举与 grammar 仍在本模块。
/// 历史硬编码 match 已迁移到各语言 parser 的 `dialect()` 实现（parser/{ts,python,rust,...}.rs）。
pub fn dialect_for(language: &str, rel_path: &str) -> Option<Dialect> {
    crate::parser::dialect_for(language, rel_path)
}

/// 该语言是否具备 AST 级支持（前端用于展示「AST 精确 / 启发式估算」精度标记）
pub fn supports(language: &str, rel_path: &str) -> bool {
    dialect_for(language, rel_path).is_some()
}

// ─────────────────────────── 节点分类 ───────────────────────────

/// 判定节点（每个 +1 圈复杂度）。
///
/// 口径遵循 McCabe：每个会让执行路径分叉的语法结构算一条。
/// `else` 不计（它不新增路径，只是 if 的另一分支）；`default` / `_ =>` 同理不计。
fn is_decision_node(dialect: Dialect, node: &Node, source: &[u8]) -> bool {
    let kind = node.kind();
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => match kind {
            "if_statement" | "for_statement" | "for_in_statement" | "while_statement"
            | "do_statement" | "catch_clause" | "ternary_expression" => true,
            // switch 的每个 case 是一条路径，default 不是
            "switch_case" => true,
            // && / || / ?? 短路运算符各自新增一条路径
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||") | Some("??")
            ),
            _ => false,
        },
        Dialect::Rust => match kind {
            "if_expression"
            | "while_expression"
            | "while_let_expression"
            | "for_expression"
            | "loop_expression" => true,
            // match 的每条非通配臂算一条路径（`_ =>` 是兜底，不新增判定）
            "match_arm" => !is_wildcard_arm(node, source),
            // `?` 提前返回是一条隐式分支
            "try_expression" => true,
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        Dialect::Python => match kind {
            "if_statement"
            | "elif_clause"
            | "for_statement"
            | "while_statement"
            | "except_clause"
            | "conditional_expression"
            | "assert_statement"
            | "with_statement" => kind != "with_statement", // with 不分叉，占位保持可读
            // 推导式里的 for / if 同样是路径
            "for_in_clause" | "if_clause" => true,
            "boolean_operator" => true,
            _ => false,
        },
        Dialect::Go => match kind {
            "if_statement" | "for_statement" => true,
            // switch 的每个 case / type case 是一条路径，default 不是
            "expression_case" | "type_case" | "communication_case" => true,
            // && / || 短路运算符各自新增一条路径
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        Dialect::Java => match kind {
            "if_statement"
            | "for_statement"
            | "enhanced_for_statement"
            | "while_statement"
            | "do_statement"
            | "catch_clause"
            | "ternary_expression"
            | "switch_label" => true,
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        Dialect::CSharp => match kind {
            "if_statement"
            | "for_statement"
            | "foreach_statement"
            | "while_statement"
            | "do_statement"
            | "switch_section"
            | "conditional_expression"
            | "catch_clause" => true,
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        Dialect::Cpp => match kind {
            "if_statement"
            | "for_statement"
            | "while_statement"
            | "do_statement"
            | "case_statement"
            | "conditional_expression"
            | "catch_clause" => true,
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        // C 与 C++ 同语法族，但没有 try/catch（异常是 C++ 的）
        Dialect::C => match kind {
            "if_statement"
            | "for_statement"
            | "while_statement"
            | "do_statement"
            | "case_statement"
            | "conditional_expression" => true,
            "binary_expression" => matches!(
                operator_text(node, source).as_deref(),
                Some("&&") | Some("||")
            ),
            _ => false,
        },
        // Ruby 的修饰符写法（`return 1 if x` / `x unless y`）同样分叉，必须计入，
        // 否则大量 Ruby 惯用法会被漏算成直线代码。
        Dialect::Ruby => match kind {
            "if" | "if_modifier" | "unless" | "unless_modifier" | "while" | "while_modifier"
            | "until" | "until_modifier" | "for" | "when" | "rescue" | "conditional" => true,
            "binary" => is_short_circuit_binary(node, source),
            _ => false,
        },
        Dialect::Php => match kind {
            "if_statement"
            | "for_statement"
            | "foreach_statement"
            | "while_statement"
            | "do_statement"
            | "case_statement"
            | "catch_clause"
            | "conditional_expression" => true,
            // PHP 既有 && || 也有等价的 and or 关键字
            "binary_expression" => is_short_circuit_binary(node, source),
            _ => false,
        },
        Dialect::Kotlin => match kind {
            "if_expression" | "for_statement" | "while_statement" | "do_while_statement"
            | "when_entry" | "catch_block" => true,
            // Kotlin 的 elvis（`?:`）也是一次分叉，与 && || 一并计入
            "binary_expression" => is_short_circuit_binary(node, source),
            _ => false,
        },
        // Swift 把 && / || 提升为独立节点（conjunction/disjunction），不用再取 operator 文本
        Dialect::Swift => match kind {
            "if_statement"
            | "for_statement"
            | "while_statement"
            | "repeat_while_statement"
            | "switch_entry"
            | "guard_statement"
            | "catch_block"
            | "ternary_expression"
            | "conjunction_expression"
            | "disjunction_expression" => true,
            _ => false,
        },
    }
}

/// 二元节点是否使用了「短路 / 分叉」运算符（`&&` `||` `and` `or` `?:` `??`）。
///
/// 各 grammar 摆运算符的位置不统一：TS/Java/C#/C++/PHP 挂在 `operator` 字段上，
/// 而 Ruby 只把它当匿名子节点（`binary` → `identifier`, `&&`, `identifier`）。
/// 两条路都试一遍，避免因为 grammar 细节差异漏算圈复杂度。
fn is_short_circuit_binary(node: &Node, source: &[u8]) -> bool {
    const OPS: [&str; 6] = ["&&", "||", "and", "or", "?:", "??"];
    if let Some(op) = operator_text(node, source) {
        return OPS.contains(&op.as_str());
    }
    let mut cursor = node.walk();
    // 存成局部变量再返回：直接作尾表达式会让迭代器临时值活过 cursor，触发 E0597
    let found = node.children(&mut cursor).any(|c| OPS.contains(&c.kind()));
    found
}

/// 取二元表达式的运算符文本（tree-sitter 的 operator 是匿名字段节点）
pub(crate) fn operator_text(node: &Node, source: &[u8]) -> Option<String> {
    node.child_by_field_name("operator")
        .and_then(|op| op.utf8_text(source).ok())
        .map(|s| s.to_string())
}

/// Rust match 通配臂：`_ => ...`
fn is_wildcard_arm(node: &Node, source: &[u8]) -> bool {
    node.child_by_field_name("pattern")
        .and_then(|p| p.utf8_text(source).ok())
        .map(|t| t.trim() == "_")
        .unwrap_or(false)
}

/// 会增加嵌套深度的结构（用于「深层嵌套」坏味道）
fn is_nesting_node(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "for_in_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
                | "try_statement"
                | "catch_clause"
        ),
        Dialect::Rust => matches!(
            kind,
            "if_expression"
                | "while_expression"
                | "while_let_expression"
                | "for_expression"
                | "loop_expression"
                | "match_expression"
        ),
        Dialect::Python => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "while_statement"
                | "try_statement"
                | "with_statement"
                | "match_statement"
        ),
        Dialect::Go => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "func_literal"
                | "expression_switch_statement"
                | "type_switch_statement"
                | "select_statement"
        ),
        Dialect::Java => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "enhanced_for_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
                | "try_statement"
                | "catch_clause"
        ),
        Dialect::CSharp => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "foreach_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
                | "try_statement"
                | "catch_clause"
        ),
        Dialect::Cpp => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
                | "try_statement"
                | "catch_clause"
        ),
        Dialect::C => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
        ),
        // Ruby 的块（do…end / {…}）是真实的一层缩进，计入嵌套
        Dialect::Ruby => matches!(
            kind,
            "if" | "unless"
                | "while"
                | "until"
                | "for"
                | "case"
                | "begin"
                | "rescue"
                | "do_block"
                | "block"
        ),
        Dialect::Php => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "foreach_statement"
                | "while_statement"
                | "do_statement"
                | "switch_statement"
                | "try_statement"
                | "catch_clause"
        ),
        Dialect::Kotlin => matches!(
            kind,
            "if_expression"
                | "for_statement"
                | "while_statement"
                | "do_while_statement"
                | "when_expression"
                | "try_expression"
                | "catch_block"
        ),
        // guard 不算嵌套：它是提前返回，反而是「降低」嵌套的写法
        Dialect::Swift => matches!(
            kind,
            "if_statement"
                | "for_statement"
                | "while_statement"
                | "repeat_while_statement"
                | "switch_statement"
                | "do_statement"
                | "catch_block"
        ),
    }
}

/// 函数类节点
fn is_function_node(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => matches!(
            kind,
            "function_declaration"
                | "function_expression"
                | "generator_function_declaration"
                | "generator_function"
                | "arrow_function"
                | "method_definition"
        ),
        Dialect::Rust => kind == "function_item",
        Dialect::Python => kind == "function_definition",
        Dialect::Go => matches!(
            kind,
            "function_declaration" | "method_declaration" | "func_literal"
        ),
        Dialect::Java => matches!(
            kind,
            "method_declaration" | "constructor_declaration" | "lambda_expression"
        ),
        Dialect::CSharp => matches!(
            kind,
            "method_declaration"
                | "local_function_statement"
                | "constructor_declaration"
                | "lambda_expression"
                | "anonymous_method_expression"
                | "destructor_declaration"
        ),
        Dialect::Cpp => matches!(kind, "function_definition" | "lambda_expression"),
        Dialect::C => kind == "function_definition",
        // Ruby：def / def self.x / lambda。do_block 是块不是函数，不计入函数数量，
        // 否则每个 `.each do` 都会被当成一个"函数"，函数数量严重虚高。
        Dialect::Ruby => matches!(kind, "method" | "singleton_method" | "lambda"),
        Dialect::Php => matches!(
            kind,
            "function_definition"
                | "method_declaration"
                | "arrow_function"
                | "anonymous_function"
                | "anonymous_function_creation_expression"
        ),
        Dialect::Kotlin => matches!(
            kind,
            "function_declaration"
                | "anonymous_function"
                | "lambda_literal"
                | "secondary_constructor"
        ),
        Dialect::Swift => matches!(
            kind,
            "function_declaration" | "lambda_literal" | "init_declaration" | "deinit_declaration"
        ),
    }
}

/// 数字字面量节点
fn is_number_literal(dialect: Dialect, kind: &str) -> bool {
    match dialect {
        Dialect::TypeScript | Dialect::Tsx => kind == "number",
        Dialect::Rust => matches!(kind, "integer_literal" | "float_literal"),
        Dialect::Python => matches!(kind, "integer" | "float"),
        // Go：整型 / 浮点 / 虚部字面量
        Dialect::Go => matches!(kind, "int_literal" | "float_literal" | "imaginary_literal"),
        // Java：十进制/十六进制/二进制/八进制整型 + 十进制浮点（grammar 用后缀区分）
        Dialect::Java => {
            kind.ends_with("integer_literal") || kind.ends_with("floating_point_literal")
        }
        // C#：整型 / 实数
        Dialect::CSharp => matches!(kind, "integer_literal" | "real_literal"),
        // C++：统一 number_literal
        Dialect::Cpp => kind == "number_literal",
        // C：与 C++ 同 grammar 族，同样是 number_literal
        Dialect::C => kind == "number_literal",
        Dialect::Ruby => matches!(kind, "integer" | "float"),
        Dialect::Php => matches!(kind, "integer" | "float"),
        // Kotlin-ng：整数是 number_literal，浮点单独一类
        Dialect::Kotlin => matches!(kind, "number_literal" | "float_literal"),
        Dialect::Swift => matches!(kind, "integer_literal" | "real_literal"),
    }
}

/// 是否为比较运算符（魔法数字只在比较上下文中收集）
fn is_comparison_op(op: &str) -> bool {
    matches!(op, ">" | "<" | ">=" | "<=" | "==" | "===" | "!=" | "!==")
}

/// 免于「魔法数字」指控的常见值：0/1/2/-1 属于边界与自增，不是业务阈值
fn is_benign_number(text: &str) -> bool {
    matches!(
        text.trim(),
        "0" | "1" | "2" | "-1" | "0.0" | "1.0" | "100" | "1000"
    )
}

// ─────────────────────────── 主入口 ───────────────────────────

/// 超大文件阈值（>1.5MB 基本都是生成物/打包产物，解析代价与收益不成正比）
pub const MAX_SOURCE_BYTES: usize = 1_500_000;
/// 判定为「压缩产物」的平均行长（正常源码几乎不可能超过 400 字符/行）
pub const MINIFIED_AVG_LINE: usize = 400;
/// 只有超过这个体积才做压缩产物判定（小文件即使一行也无所谓）
pub const MINIFIED_MIN_BYTES: usize = 60_000;

/// 是否为压缩/打包产物：体积不小 且 平均行长离谱。
///
/// 为什么单独判：`bundle.min.js` 常常只有 800KB（过得了体积关），却是**一整行**。
/// tree-sitter 对这种输入会构造出极深的表达式树，解析时间和内存都会爆，
/// 而分析结论毫无意义（没人会去重构压缩产物）。
pub(crate) fn looks_minified(source: &str) -> bool {
    if source.len() < MINIFIED_MIN_BYTES {
        return false;
    }
    let line_count = source.lines().count().max(1);
    source.len() / line_count > MINIFIED_AVG_LINE
}

/// 解析并分析一个源文件。语言不支持 / 文件不适合解析时返回 `None`（调用方自行降级）。
pub fn analyze_source(language: &str, rel_path: &str, source: &str) -> Option<AstFileAnalysis> {
    let dialect = dialect_for(language, rel_path)?;
    if source.len() > MAX_SOURCE_BYTES || looks_minified(source) {
        return None;
    }
    let mut parser = Parser::new();
    parser.set_language(&dialect.language()).ok()?;
    let tree = parser.parse(source, None)?;
    let bytes = source.as_bytes();
    let root = tree.root_node();

    let mut acc = Acc {
        dialect,
        source: bytes,
        lines: source.lines().collect(),
        decisions: 0,
        max_nesting: 0,
        functions: Vec::new(),
        magic: Vec::new(),
    };
    acc.walk(root, 0);

    acc.functions
        .sort_by(|a, b| b.cc.cmp(&a.cc).then(a.line.cmp(&b.line)));
    acc.functions.truncate(60); // 单文件保留最复杂的 60 个函数，足够定位热点
    acc.magic.truncate(40);

    Some(AstFileAnalysis {
        cyclomatic_complexity: acc.decisions + 1,
        max_nesting: acc.max_nesting,
        functions: acc.functions,
        magic_numbers: acc.magic,
        has_error: root.has_error(),
        error_lines: collect_error_lines(root),
    })
}

/// 收集语法错误节点（ERROR / MISSING）所在行号，1 起、去重、升序。
///
/// tree-sitter 在语法错误处产出 ERROR 节点（无法归约的 token）与
/// MISSING 节点（期望但缺失的 token，如 `function f( {` 缺 `)`）。
/// 两者都说明「这一行附近语法有问题」，是 IDE 级「直接提示语法错误」
/// 的定位数据。多行错误节点取起始行。
fn collect_error_lines(root: tree_sitter::Node) -> Vec<usize> {
    let mut out = Vec::new();
    fn walk(n: tree_sitter::Node, out: &mut Vec<usize>) {
        let kind = n.kind();
        if kind == "ERROR" || kind == "MISSING" {
            let line = n.start_position().row + 1;
            if !out.contains(&line) {
                out.push(line);
            }
            // ERROR 节点内部不再深入（子节点错误信息不增加定位价值）
            return;
        }
        let mut cursor = n.walk();
        for child in n.children(&mut cursor) {
            walk(child, out);
        }
    }
    walk(root, &mut out);
    out.sort_unstable();
    out
}

struct Acc<'a> {
    dialect: Dialect,
    source: &'a [u8],
    lines: Vec<&'a str>,
    decisions: i64,
    max_nesting: i64,
    functions: Vec<FunctionMetric>,
    magic: Vec<MagicNumber>,
}

impl<'a> Acc<'a> {
    /// 单趟深度优先遍历，同时累计文件级判定数、嵌套深度、函数明细与魔法数字。
    /// 只走一遍树是刻意的：520 个文件 × 多趟遍历会把扫描时间拖成秒级。
    fn walk(&mut self, node: Node<'a>, depth: i64) {
        let kind = node.kind();

        // 只对「命名节点」做分类判定。Ruby 的关键字 token 与语句节点同名
        // （`if_modifier` 内含一个 kind 为 `if` 的匿名 token），不过滤会把每个
        // 决策点数两遍，CC 直接翻倍。其余语言的决策/嵌套/函数/数字节点也都是命名节点，
        // 统一过滤既修 Ruby 又更严谨。
        let named = node.is_named();

        if named && is_decision_node(self.dialect, &node, self.source) {
            self.decisions += 1;
        }

        let next_depth = if named && is_nesting_node(self.dialect, kind) {
            let d = depth + 1;
            if d > self.max_nesting {
                self.max_nesting = d;
            }
            d
        } else {
            depth
        };

        if named && is_function_node(self.dialect, kind) {
            if let Some(fm) = self.function_metric(node) {
                self.functions.push(fm);
            }
        }

        if named && is_number_literal(self.dialect, kind) {
            self.collect_magic(node);
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self.walk(child, next_depth);
        }
    }

    /// 计算单个函数的度量（在其子树内独立统计，不受外层影响）
    fn function_metric(&self, node: Node<'a>) -> Option<FunctionMetric> {
        let line = node.start_position().row as i64 + 1;
        let end_line = node.end_position().row as i64 + 1;
        // 箭头函数常被当作回调内联在 map/filter 里，1~2 行的不值得单列
        if is_arrow_like(self.dialect, node.kind()) && end_line - line < 2 {
            return None;
        }
        let mut cc = 1i64;
        let mut nesting = 0i64;
        self.subtree_stats(node, 0, &mut cc, &mut nesting);
        Some(FunctionMetric {
            name: self.function_name(node),
            line,
            end_line,
            lines: end_line - line + 1,
            cc,
            params: self.param_count(node),
            max_nesting: nesting,
        })
    }

    fn subtree_stats(&self, node: Node<'a>, depth: i64, cc: &mut i64, max_nesting: &mut i64) {
        // 与 walk() 同口径：只统计命名节点，避免 Ruby 关键字 token 重复计数
        let named = node.is_named();
        if named && is_decision_node(self.dialect, &node, self.source) {
            *cc += 1;
        }
        let next = if named && is_nesting_node(self.dialect, node.kind()) {
            let d = depth + 1;
            if d > *max_nesting {
                *max_nesting = d;
            }
            d
        } else {
            depth
        };
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self.subtree_stats(child, next, cc, max_nesting);
        }
    }

    /// 函数名解析：优先 name 字段；箭头/函数表达式回溯到被赋值的变量或对象键
    fn function_name(&self, node: Node<'a>) -> String {
        if let Some(name) = node
            .child_by_field_name("name")
            .and_then(|n| n.utf8_text(self.source).ok())
        {
            return name.to_string();
        }
        // C/C++ 函数名在 declarator 字段里（function_declarator -> identifier / qualified_identifier）
        if matches!(self.dialect, Dialect::Cpp | Dialect::C) {
            if let Some(decl) = node.child_by_field_name("declarator") {
                if let Some(n) = declarator_name(decl, self.source) {
                    return n;
                }
            }
        }
        // Ruby / Kotlin / Swift 的部分节点不挂 `name` 字段（如 Ruby 的 singleton_method、
        // Swift 的 init/deinit），退而求其次：取第一个标识符类命名子节点。
        if matches!(
            self.dialect,
            Dialect::Ruby | Dialect::Kotlin | Dialect::Swift | Dialect::Php
        ) {
            let mut cursor = node.walk();
            if let Some(id) = node.named_children(&mut cursor).find(|c| {
                matches!(
                    c.kind(),
                    "identifier" | "simple_identifier" | "name" | "constant"
                )
            }) {
                if let Ok(t) = id.utf8_text(self.source) {
                    return t.to_string();
                }
            }
            // init / deinit 没有名字，用关键字本身当函数名比 "(anonymous)" 有信息量
            match node.kind() {
                "init_declaration" => return "init".to_string(),
                "deinit_declaration" => return "deinit".to_string(),
                "secondary_constructor" => return "constructor".to_string(),
                _ => {}
            }
        }
        // const foo = () => {} / foo: () => {} / export default function(){}
        let mut cur = node.parent();
        for _ in 0..3 {
            let Some(p) = cur else { break };
            match p.kind() {
                "variable_declarator"
                | "pair"
                | "public_field_definition"
                | "assignment_expression" => {
                    let field = if p.kind() == "pair" { "key" } else { "name" };
                    if let Some(n) = p
                        .child_by_field_name(field)
                        .or_else(|| p.child_by_field_name("left"))
                        .and_then(|n| n.utf8_text(self.source).ok())
                    {
                        return n.to_string();
                    }
                }
                _ => {}
            }
            cur = p.parent();
        }
        "(anonymous)".to_string()
    }

    fn param_count(&self, node: Node<'a>) -> i64 {
        let params = node
            .child_by_field_name("parameters")
            .or_else(|| node.child_by_field_name("parameter"))
            .or_else(|| self.param_container(node));
        let Some(p) = params else {
            // Swift 没有参数容器节点，`parameter` 直接挂在 function_declaration 下
            let mut cursor = node.walk();
            let n = node
                .named_children(&mut cursor)
                .filter(|c| c.kind() == "parameter")
                .count() as i64;
            return n;
        };
        let mut cursor = p.walk();
        p.named_children(&mut cursor)
            .filter(|c| c.kind() != "comment" && c.kind() != "self_parameter")
            .count() as i64
    }

    /// 找参数容器节点（各 grammar 命名五花八门且不一定挂 `parameters` 字段）。
    ///
    /// Ruby 叫 `method_parameters` / `lambda_parameters`，Kotlin 叫 `function_value_parameters`，
    /// PHP 叫 `formal_parameters`，C/C++ 则把 `parameter_list` 藏在 `declarator` 里再下一层。
    fn param_container(&self, node: Node<'a>) -> Option<Node<'a>> {
        const CONTAINERS: [&str; 5] = [
            "method_parameters",
            "lambda_parameters",
            "function_value_parameters",
            "formal_parameters",
            "parameter_list",
        ];
        let mut cursor = node.walk();
        if let Some(found) = node
            .named_children(&mut cursor)
            .find(|c| CONTAINERS.contains(&c.kind()))
        {
            return Some(found);
        }
        // C/C++：function_definition -> function_declarator -> parameter_list
        if matches!(self.dialect, Dialect::C | Dialect::Cpp) {
            let decl = node.child_by_field_name("declarator")?;
            let mut c2 = decl.walk();
            return decl
                .named_children(&mut c2)
                .find(|c| c.kind() == "parameter_list");
        }
        None
    }

    /// 收集比较上下文里的裸数字
    fn collect_magic(&mut self, node: Node<'a>) {
        if self.magic.len() >= 40 {
            return;
        }
        let Ok(text) = node.utf8_text(self.source) else {
            return;
        };
        if is_benign_number(text) {
            return;
        }
        // 仅当父节点是比较型二元表达式时才算「阈值魔法数字」
        let Some(parent) = node.parent() else { return };
        let is_cmp = match self.dialect {
            Dialect::Python => parent.kind() == "comparison_operator",
            _ => {
                parent.kind() == "binary_expression"
                    && operator_text(&parent, self.source)
                        .map(|op| is_comparison_op(&op))
                        .unwrap_or(false)
            }
        };
        if !is_cmp {
            return;
        }
        let row = node.start_position().row;
        let snippet = self
            .lines
            .get(row)
            .map(|l| {
                let t = l.trim();
                if t.chars().count() > 120 {
                    t.chars().take(119).collect::<String>() + "…"
                } else {
                    t.to_string()
                }
            })
            .unwrap_or_default();
        self.magic.push(MagicNumber {
            line: row as i64 + 1,
            value: text.to_string(),
            snippet,
        });
    }
}

fn is_arrow_like(dialect: Dialect, kind: &str) -> bool {
    matches!(dialect, Dialect::TypeScript | Dialect::Tsx)
        && matches!(kind, "arrow_function" | "function_expression")
}

/// C++ `function_definition` 的 declarator 子树里找第一个名字节点
/// （identifier / field_identifier / qualified_identifier / destructor_name）
fn declarator_name(node: Node, source: &[u8]) -> Option<String> {
    match node.kind() {
        "identifier" | "field_identifier" | "qualified_identifier" | "destructor_name" => {
            node.utf8_text(source).ok().map(|s| s.to_string())
        }
        _ => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(n) = declarator_name(child, source) {
                    return Some(n);
                }
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实项目吞吐基准（默认不跑，需要时：`cargo test --lib ast_throughput -- --ignored --nocapture`）
    ///
    /// 存在的意义：AST 解析接在扫描链路上，一旦它变慢，用户直接感受为「扫描卡死」。
    /// 后续任何改动（换 grammar 版本、加新语言、加新度量）都应该跑一遍看有没有退化。
    #[test]
    #[ignore]
    fn ast_throughput_on_real_sources() {
        use std::time::Instant;
        let mut files = 0usize;
        let mut bytes = 0usize;
        let mut stack = vec![std::path::PathBuf::from("../src")];
        let t0 = Instant::now();
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else {
                continue;
            };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                    continue;
                }
                let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
                if !matches!(ext, "ts" | "tsx" | "js" | "jsx") {
                    continue;
                }
                let Ok(src) = std::fs::read_to_string(&p) else {
                    continue;
                };
                bytes += src.len();
                if analyze_source("typescript", p.to_str().unwrap_or(""), &src).is_some() {
                    files += 1;
                }
            }
        }
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        println!(
            "AST 吞吐：{files} 个文件 / {:.1} KB / {ms:.0} ms → {:.1} MB/s",
            bytes as f64 / 1024.0,
            (bytes as f64 / 1_048_576.0) / (ms / 1000.0).max(0.0001)
        );
        assert!(files > 0, "没扫到源文件，路径不对");
    }

    #[test]
    fn minified_bundle_is_skipped_not_parsed() {
        // 一整行的压缩产物：体积过关但平均行长离谱 —— 必须降级，否则解析会拖垮扫描
        let one_liner = format!("const a=1;{}", "b=b+1;".repeat(20_000));
        assert!(one_liner.len() > MINIFIED_MIN_BYTES);
        assert!(looks_minified(&one_liner));
        assert!(analyze_source("typescript", "dist/bundle.min.js", &one_liner).is_none());
    }

    #[test]
    fn normal_long_file_is_not_mistaken_for_minified() {
        // 正常的长源码（3000 行、每行 ~30 字符）不该被误判成压缩产物
        let normal = "const someReasonablyNamedValue = 1;\n".repeat(3000);
        assert!(normal.len() > MINIFIED_MIN_BYTES);
        assert!(!looks_minified(&normal));
        assert!(analyze_source("typescript", "src/big.ts", &normal).is_some());
    }

    #[test]
    fn small_one_liner_still_parses() {
        // 小文件即使只有一行也照常解析（阈值只针对大体积）
        let src = "export const f = (a: number) => (a > 3 ? 1 : 0);";
        assert!(!looks_minified(src));
        assert!(analyze_source("typescript", "src/tiny.ts", src).is_some());
    }

    #[test]
    fn string_literal_if_is_not_counted() {
        // 行级启发式会把这行的 "if " 算成分支——AST 不会
        let src = r#"const msg = "if you see this, heuristics lied"; const n = 1;"#;
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 1);
    }

    #[test]
    fn comment_case_is_not_counted() {
        let src = "// case: 兼容旧版\nfunction f() { return 1; }\n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 1);
    }

    #[test]
    fn generic_union_pipe_is_not_counted() {
        // Map<string, T | undefined> 里的 | 不是逻辑或
        let src = "type M = Map<string, number | undefined>;\n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 1);
    }

    #[test]
    fn ts_branches_are_counted_precisely() {
        let src = r#"
function f(a: number, b: number) {
  if (a > 0 && b > 0) { return 1; }
  for (const x of [1, 2]) { if (x) { return x; } }
  return a ? 1 : 2;
}
"#;
        // if(1) + &&(1) + for(1) + 内层 if(1) + 三元(1) + 基线 1 = 6
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 6);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "f");
        assert_eq!(f.params, 2);
        assert_eq!(f.cc, 6);
        assert_eq!(f.max_nesting, 2); // for > if
    }

    #[test]
    fn tsx_component_parses_without_error() {
        let src = "const C = ({on}: {on:boolean}) => <div className=\"x\">{on ? <b>1</b> : null}</div>;\n";
        let a = analyze_source("typescript", "C.tsx", src).unwrap();
        assert!(!a.has_error, "TSX 必须用 TSX grammar 才不报错");
        assert_eq!(a.cyclomatic_complexity, 2); // 基线 + 三元
    }

    #[test]
    fn arrow_name_resolves_from_variable() {
        let src = "const handleClick = (e: any) => {\n  if (e) { return 1; }\n  return 0;\n};\n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.functions[0].name, "handleClick");
    }

    #[test]
    fn rust_match_arms_count_but_wildcard_does_not() {
        let src = r#"
fn f(x: i32) -> i32 {
    match x {
        1 => 1,
        2 => 2,
        _ => 0,
    }
}
"#;
        // 两条具名臂 +2，通配臂不计，基线 1 => 3
        let a = analyze_source("rust", "a.rs", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 3);
    }

    #[test]
    fn rust_question_mark_is_a_branch() {
        let src = "fn f() -> Result<i32, ()> { let v = g()?; Ok(v) }\nfn g() -> Result<i32, ()> { Ok(1) }\n";
        let a = analyze_source("rust", "a.rs", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 2);
        assert_eq!(a.function_count(), 2);
    }

    #[test]
    fn python_elif_and_comprehension_count() {
        let src = "def f(a):\n    if a > 5:\n        return 1\n    elif a < 3:\n        return 2\n    return [x for x in range(10) if x]\n";
        // if + elif + for_in_clause + if_clause + 基线 = 5
        let a = analyze_source("python", "a.py", src).unwrap();
        assert_eq!(a.cyclomatic_complexity, 5);
        assert_eq!(a.functions[0].name, "f");
    }

    #[test]
    fn magic_numbers_only_in_comparisons() {
        let src = "const style = { fontSize: 12, padding: 24 };\nfunction f(retry: number) { if (retry > 37) { return 1; } return 0; }\n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        let vals: Vec<&str> = a.magic_numbers.iter().map(|m| m.value.as_str()).collect();
        assert_eq!(vals, vec!["37"], "样式常量不该被算作魔法数字");
        assert_eq!(a.magic_numbers[0].line, 2);
    }

    #[test]
    fn unsupported_language_returns_none() {
        assert!(analyze_source("go", "a.go", "func main() {}").is_some());
        assert!(analyze_source("markdown", "a.md", "# hi").is_none());
    }

    #[test]
    fn syntax_error_still_yields_metrics() {
        let src = "function f( { if (a) { return 1 } \n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert!(a.has_error);
        assert!(a.cyclomatic_complexity >= 1);
        // 语法错误行号定位：缺 `)` 的 `function f(` 在第 1 行
        assert!(!a.error_lines.is_empty());
        assert!(a.error_lines.iter().any(|&l| l == 1));
    }

    #[test]
    fn valid_code_has_no_error_lines() {
        let src = "function f(a: number) { return a + 1; }\n";
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert!(!a.has_error);
        assert!(a.error_lines.is_empty());
    }

    #[test]
    fn dialect_selection_by_extension() {
        assert_eq!(dialect_for("typescript", "a/b.tsx"), Some(Dialect::Tsx));
        assert_eq!(
            dialect_for("typescript", "a/b.ts"),
            Some(Dialect::TypeScript)
        );
        assert_eq!(dialect_for("javascript", "a/b.js"), Some(Dialect::Tsx));
        assert_eq!(dialect_for("rust", "a/b.rs"), Some(Dialect::Rust));
        assert_eq!(dialect_for("go", "a/b.go"), Some(Dialect::Go));
        assert_eq!(dialect_for("java", "a/b.java"), Some(Dialect::Java));
        assert_eq!(dialect_for("csharp", "a/b.cs"), Some(Dialect::CSharp));
        assert_eq!(dialect_for("cpp", "a/b.cpp"), Some(Dialect::Cpp));
        assert_eq!(dialect_for("ruby", "a/b.rb"), Some(Dialect::Ruby));
        assert_eq!(dialect_for("php", "a/b.php"), Some(Dialect::Php));
        assert_eq!(dialect_for("kotlin", "a/b.kt"), Some(Dialect::Kotlin));
        assert_eq!(dialect_for("swift", "a/b.swift"), Some(Dialect::Swift));
        // .c 走 C grammar，.h 走 C++ grammar（头文件常含 class/template，C++ 是 C 的超集）
        assert_eq!(dialect_for("c", "a/b.c"), Some(Dialect::C));
        assert_eq!(dialect_for("c", "a/b.h"), Some(Dialect::Cpp));
        // 仍为不支持的语言
        assert_eq!(dialect_for("dart", "a/b.dart"), None);
        assert_eq!(dialect_for("lua", "a/b.lua"), None);
    }

    /// 只有 TS/JS/Rust/Python 做函数级数据流，其余方言必须显式「无支持」而不是空结果
    #[test]
    fn only_four_dialects_declare_dataflow_support() {
        for (lang, path) in [
            ("typescript", "a.ts"),
            ("javascript", "a.js"),
            ("rust", "a.rs"),
            ("python", "a.py"),
        ] {
            assert!(
                dialect_for(lang, path).unwrap().has_dataflow(),
                "{lang} 应有数据流"
            );
        }
        for (lang, path) in [
            ("go", "a.go"),
            ("java", "a.java"),
            ("csharp", "a.cs"),
            ("cpp", "a.cpp"),
            ("c", "a.c"),
            ("ruby", "a.rb"),
            ("php", "a.php"),
            ("kotlin", "a.kt"),
            ("swift", "a.swift"),
        ] {
            assert!(
                !dialect_for(lang, path).unwrap().has_dataflow(),
                "{lang} 不应有数据流"
            );
        }
    }

    #[test]
    fn hottest_function_is_the_most_complex_one() {
        let src = r#"
function simple() { return 1; }
function complex(a: number) {
  if (a) { return 1; }
  while (a > 0) { a--; if (a === 3) { break; } }
  return a ? 1 : 0;
}
"#;
        let a = analyze_source("typescript", "a.ts", src).unwrap();
        assert_eq!(a.hottest_function().unwrap().name, "complex");
        assert!(a.max_function_cc() >= 5);
    }

    /// 调试用：打印 4 个新方言的语法树节点种类，核对决策/嵌套/函数/数字节点口径。
    /// 跑法：`cargo test --lib debug_dump_new_language_kinds -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn debug_dump_new_language_kinds() {
        let samples: &[(&str, &str, &str)] = &[
            ("go", "a.go", "package main\nfunc compute(a int, b int) int {\n\tif a > 0 && b > 0 { return 1 }\n\tfor i := 0; i < 10; i++ { if a == i { return i } }\n\tswitch a {\n\tcase 1: return 1\n\tcase 2: return 2\n\tdefault: return 0\n\t}\n}\n"),
            ("java", "a.java", "class A { int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; } }\n"),
            ("csharp", "a.cs", "class A { int Compute(int a, int b) { if (a > 0 && b > 0) { return 1; } foreach (var x in items){ if (a==x){return x;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; } }\n"),
            ("cpp", "a.cpp", "int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; }\n"),
            ("c", "a.c", "int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; default: return 0; } return a; }\n"),
            ("ruby", "a.rb", "def compute(a, b)\n  return 1 if a > 0 && b > 0\n  (0..10).each do |i|\n    return i if a == i\n  end\n  case a\n  when 1 then return 1\n  when 2 then return 2\n  end\n  a\nend\n"),
            ("php", "a.php", "<?php\nfunction compute($a, $b) {\n  if ($a > 0 && $b > 0) { return 1; }\n  for ($i = 0; $i < 10; $i++) { if ($a == $i) { return $i; } }\n  foreach ([1,2] as $x) { $a += $x; }\n  switch ($a) { case 1: return 1; case 2: return 2; default: return 0; }\n  while ($a > 0) { $a--; }\n  try { return $a; } catch (Exception $e) { return 0; }\n}\n"),
            ("kotlin", "a.kt", "class A {\n  fun compute(a: Int): Int {\n    val f = { x: Int -> x + 1 }\n    val g = fun(y: Int): Int { return y * 2 }\n    do { } while (a > 0)\n    val d = 1.5\n    val e = a ?: 0\n    return f(a) + g(a) + d.toInt()\n  }\n  constructor()\n}\n"),
            ("swift", "a.swift", "class A {\n  init() {}\n  deinit {}\n  func compute(a: Int) -> Int {\n    repeat { } while a > 0\n    do { try risky() } catch { return 0 }\n    let d = 1.5\n    let t = a > 0 ? 1 : 2\n    return t + Int(d)\n  }\n}\n"),
        ];
        for (lang, path, src) in samples {
            let d = dialect_for(lang, path).expect("dialect");
            let mut p = Parser::new();
            p.set_language(&d.language()).unwrap();
            let tree = p.parse(*src, None).unwrap();
            println!("===== {lang} ({path}) =====");
            dump_node(tree.root_node(), src.as_bytes(), 0);
        }
    }

    #[test]
    fn go_metrics_counted_precisely() {
        let src = "package main\nfunc compute(a int, b int) int {\n\tif a > 0 && b > 0 { return 1 }\n\tfor i := 0; i < 10; i++ { if a == i { return i } }\n\tswitch a {\n\tcase 1: return 1\n\tcase 2: return 2\n\tdefault: return 0\n\t}\n}\n";
        let a = analyze_source("go", "a.go", src).unwrap();
        // if(1) + &&(1) + for(1) + 内层 if(1) + 2 expression_case + 基线 1 = 7
        assert_eq!(a.cyclomatic_complexity, 7);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        assert_eq!(f.cc, 7);
        assert_eq!(f.max_nesting, 2); // for > if
    }

    #[test]
    fn java_metrics_counted_precisely() {
        let src = "class A { int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; } }\n";
        let a = analyze_source("java", "a.java", src).unwrap();
        // if(1) + &&(1) + for(1) + 内层 if(1) + 3 switch_label(含 default) + 基线 1 = 8
        assert_eq!(a.cyclomatic_complexity, 8);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.cc, 8);
        assert_eq!(f.max_nesting, 2);
    }

    #[test]
    fn csharp_metrics_counted_precisely() {
        let src = "class A { int Compute(int a, int b) { if (a > 0 && b > 0) { return 1; } foreach (var x in items){ if (a==x){return x;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; } }\n";
        let a = analyze_source("csharp", "a.cs", src).unwrap();
        // if(1) + &&(1) + foreach(1) + 内层 if(1) + 3 switch_section(含 default) + 基线 1 = 8
        assert_eq!(a.cyclomatic_complexity, 8);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "Compute");
        assert_eq!(f.cc, 8);
        assert_eq!(f.max_nesting, 2);
    }

    #[test]
    fn cpp_metrics_counted_precisely() {
        let src = "int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; }\n";
        let a = analyze_source("cpp", "a.cpp", src).unwrap();
        // if(1) + &&(1) + for(1) + 内层 if(1) + 3 case_statement(含 default) + 基线 1 = 8
        assert_eq!(a.cyclomatic_complexity, 8);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.cc, 8);
        assert_eq!(f.max_nesting, 2);
    }

    #[test]
    fn c_metrics_counted_precisely() {
        let src = "int compute(int a, int b) { if (a > 0 && b > 0) { return 1; } for (int i=0;i<10;i++){ if (a==i){return i;} } switch(a){ case 1: return 1; case 2: return 2; default: return 0; } return a; }\n";
        let a = analyze_source("c", "a.c", src).unwrap();
        // if(1) + &&(1) + for(1) + 内层 if(1) + 3 case_statement(含 default) + 基线 1 = 8
        assert_eq!(a.cyclomatic_complexity, 8);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        // 函数名藏在 declarator 里，与 C++ 同路径
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        assert_eq!(f.cc, 8);
        assert_eq!(f.max_nesting, 2);
    }

    #[test]
    fn ruby_metrics_counted_precisely() {
        let src = "def compute(a, b)\n  return 1 if a > 0 && b > 0\n  (0..10).each do |i|\n    return i if a == i\n  end\n  case a\n  when 1 then return 1\n  when 2 then return 2\n  end\n  a\nend\n";
        let a = analyze_source("ruby", "a.rb", src).unwrap();
        // if_modifier(1) + &&(1) + 块内 if_modifier(1) + 2 when + 基线 1 = 6
        assert_eq!(a.cyclomatic_complexity, 6);
        // do…end 块不算函数，只有 def 本身
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        assert_eq!(f.cc, 6);
    }

    #[test]
    fn ruby_blocks_are_not_counted_as_functions() {
        // 每个 .each do 都当函数会让函数数量虚高，这里锁死该行为
        let src = "def run(xs)\n  xs.each do |x|\n    x.map { |y| y + 1 }\n  end\nend\n";
        let a = analyze_source("ruby", "a.rb", src).unwrap();
        assert_eq!(a.function_count(), 1);
        assert_eq!(a.functions[0].name, "run");
    }

    #[test]
    fn php_metrics_counted_precisely() {
        let src = "<?php\nfunction compute($a, $b) {\n  if ($a > 0 && $b > 0) { return 1; }\n  foreach ([1,2] as $x) { if ($a == $x) { return $x; } }\n  switch ($a) { case 1: return 1; default: return 0; }\n  return $a;\n}\n";
        let a = analyze_source("php", "a.php", src).unwrap();
        // if(1) + &&(1) + foreach(1) + 内层 if(1) + 1 case_statement + 基线 1 = 6
        // PHP grammar 把 default 单列为 default_statement，故不计入（符合 McCabe）
        assert_eq!(a.cyclomatic_complexity, 6);
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        assert_eq!(f.cc, 6);
        assert_eq!(f.max_nesting, 2); // foreach > if
    }

    #[test]
    fn kotlin_metrics_counted_precisely() {
        let src = "fun compute(a: Int, b: Int): Int {\n    if (a > 0 && b > 0) { return 1 }\n    for (i in 0..10) { if (a == i) return i }\n    when (a) { 1 -> return 1; 2 -> return 2; else -> return 0 }\n    return a\n}\n";
        let a = analyze_source("kotlin", "a.kt", src).unwrap();
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        // if(1) + &&(1) + for(1) + 内层 if(1) + 3 when_entry(含 else) + 基线 1 = 8
        assert_eq!(f.cc, 8);
        assert_eq!(f.max_nesting, 2); // for > if
    }

    #[test]
    fn swift_metrics_counted_precisely() {
        let src = "func compute(a: Int, b: Int) -> Int {\n    if a > 0 && b > 0 { return 1 }\n    for i in 0...10 { if a == i { return i } }\n    switch a { case 1: return 1; case 2: return 2; default: return 0 }\n    guard a > 0 else { return 0 }\n    return a\n}\n";
        let a = analyze_source("swift", "a.swift", src).unwrap();
        assert_eq!(a.function_count(), 1);
        let f = &a.functions[0];
        assert_eq!(f.name, "compute");
        assert_eq!(f.params, 2);
        // if(1) + &&(1) + for(1) + 内层 if(1) + 3 switch_entry + guard(1) + 基线 1 = 9
        assert_eq!(f.cc, 9);
        assert_eq!(f.max_nesting, 2); // for > if（guard 不算嵌套）
    }

    #[test]
    fn new_languages_degrade_line_level_when_minified() {
        // 压缩产物仍应降级，不因接入 AST 而崩溃或拖慢扫描
        let one_liner = format!("package main\nfunc main(){{{}", "x=x+1;".repeat(20_000));
        assert!(looks_minified(&one_liner));
        assert!(analyze_source("go", "dist/a.go", &one_liner).is_none());
    }
}

#[cfg(test)]
fn dump_node(node: Node, src: &[u8], depth: usize) {
    let kind = node.kind();
    let text = if node.child_count() == 0 {
        node.utf8_text(src).ok().unwrap_or("")
    } else {
        ""
    };
    let pad = "  ".repeat(depth);
    if text.is_empty() {
        println!("{pad}{kind}");
    } else {
        println!("{pad}{kind} {text:?}");
    }
    let mut c = node.walk();
    for child in node.children(&mut c) {
        dump_node(child, src, depth + 1);
    }
}
