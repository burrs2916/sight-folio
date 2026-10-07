//! 设计模式识别引擎（证据加权打分）
//!
//! ## 为什么重写
//!
//! 旧实现（`code_structure::detect_patterns`）是一串裸子串匹配，误报率高到让这个功能失去意义：
//!
//! | 旧规则 | 真实后果（在本项目 src/ 上实测） |
//! |---|---|
//! | `body.contains("return this")` → 建造者 | 50 个 TS/TSX 文件含 `return this`，但含 `return this;` 的是 **0 个** —— 全部命中的其实是 `return this.state` 之类的属性读取，**建造者模式 100% 误报** |
//! | `body.contains("fn new(")` → 工厂 | Rust 里 `fn new()` 是惯用构造函数，32 个 .rs 文件全被判成工厂 |
//! | `body.contains("-> Self")` → 建造者 | 55 个 .rs 文件命中，同样是惯用写法而非链式建造 |
//! | `body.contains("dispatch(")` → 观察者 | 任何调用 Redux/reducer `dispatch()` 的地方都算观察者 |
//!
//! 更糟的是「类体」取的是**声明行往后 400 行的定长窗口**，会越过类边界读到下一个类的内容，
//! 于是误报还会互相传染。而 `patterns.dedup()` 用的是 `Vec::dedup`（只去相邻重复），
//! 非相邻的重复 id 根本没被去掉。最后 `strategy` 有中文标签却从来没有任何代码路径会产出它 —— 死标签。
//!
//! ## 新引擎的三条原则
//!
//! 1. **先拿到真正的类体**：花括号语言做括号配对，Python 按缩进块切，绝不越过符号边界。
//! 2. **区分「声明」与「调用」**：`declares_method` 只认方法定义行，
//!    调用点（`repo.create(...)`）不再被算作「这个类有 create 方法」。
//! 3. **加权打分而非布尔或**：每个模式由若干信号构成，各自带权重，
//!    命名信号（弱，容易撞车）权重低，结构信号（强，需要真的写成那样）权重高，
//!    总分过阈值才算命中，并把分数作为 `confidence` 一路带到前端 —— 让用户自己判断可信度，
//!    而不是把猜测伪装成事实。
//!
//! 输出的 `DetectedPattern` 带 `signals`（命中了哪几条证据），前端悬浮即可看到判定依据。

/// 命中阈值：加权得分达到此值才认为模式成立
///
/// 0.6 的取法：结构/命名信号累加到此值才判定模式成立。
/// - **高精度命名**（类名以 Factory/Repository/... 结尾，见 `SIG_NAME_STRONG`=0.62）
///   可单独越过阈值 —— 命名即模式，无需翻方法体；
/// - **歧义命名**（Manager 之类，`SIG_NAME_WEAK`=0.25）仍必须辅以结构证据，
///   这是压制旧引擎「裸子串误报」的关键。
pub const CONFIDENCE_THRESHOLD: f64 = 0.6;

/// 强命名信号（如类名以 Factory / Repository / Service 结尾）。
///
/// 取值 0.62 > 阈值 0.6：对「命名即模式」的高精度模式（GoF 创建/结构/行为型、
/// 以及 Repository/Service/Store/Provider/... 等架构角色），**仅凭类名即可判定** ——
/// 一个叫 `UserRepository` 的类几乎必然是仓储模式，不需要再翻它的方法体。
///
/// 这与「压制误报」并不矛盾：旧引擎的误报来自**结构探针**（`return this`/`new`/`dispatch`
/// 等）命中无关代码，而非命名。本引擎仍把 `Manager` 等**歧义命名**压在 `SIG_NAME_WEAK`（0.25），
/// 必须辅以结构证据才能成立 —— 所以 `DataManager` 空类不会被误判。
const SIG_NAME_STRONG: f64 = 0.62;
/// 弱命名信号（如类名以 Manager 结尾，太常见）
const SIG_NAME_WEAK: f64 = 0.25;
/// 强结构信号（如真的存在 `return this;` 链式返回）
const SIG_STRUCT_STRONG: f64 = 0.45;
/// 中等结构信号
const SIG_STRUCT_MED: f64 = 0.3;
/// 辅助信号
const SIG_AUX: f64 = 0.2;

/// 模式分类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternCategory {
    /// GoF 创建型
    Creational,
    /// GoF 结构型
    Structural,
    /// GoF 行为型
    Behavioral,
    /// 架构角色（Repository/Service 等，非 GoF 但同样有分析价值）
    Architectural,
}

impl PatternCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            PatternCategory::Creational => "creational",
            PatternCategory::Structural => "structural",
            PatternCategory::Behavioral => "behavioral",
            PatternCategory::Architectural => "architectural",
        }
    }
}

/// 一次模式命中
#[derive(Debug, Clone)]
pub struct DetectedPattern {
    /// 模式 id
    pub id: String,
    /// 置信度 0..1（加权得分，上限截断到 1）
    pub confidence: f64,
    /// 命中的证据描述（人话，前端悬浮展示）
    pub signals: Vec<String>,
    pub category: PatternCategory,
}

/// 打分累加器
struct Scorer {
    score: f64,
    signals: Vec<String>,
}

impl Scorer {
    fn new() -> Self {
        Scorer {
            score: 0.0,
            signals: Vec::new(),
        }
    }
    /// 命中一条信号则加权并记录说明
    fn hit(&mut self, cond: bool, weight: f64, desc: &str) -> &mut Self {
        if cond {
            self.score += weight;
            self.signals.push(desc.to_string());
        }
        self
    }
    /// 反信号：命中则扣分（用于压制惯用写法造成的误报）
    fn penalty(&mut self, cond: bool, weight: f64, desc: &str) -> &mut Self {
        if cond {
            self.score -= weight;
            self.signals.push(format!("（反证）{}", desc));
        }
        self
    }
    fn finish(self, id: &str, category: PatternCategory) -> Option<DetectedPattern> {
        if self.score >= CONFIDENCE_THRESHOLD {
            Some(DetectedPattern {
                id: id.to_string(),
                confidence: self.score.min(1.0),
                signals: self.signals,
                category,
            })
        } else {
            None
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// 类体提取
// ═══════════════════════════════════════════════════════════════════

/// 从声明行开始提取真正的符号体
///
/// - 花括号语言：找到声明后的第一个 `{`，做括号配对直到深度归零。
///   括号计数跳过字符串字面量与行注释，避免 `"}"` 这类内容打乱配对。
/// - Python：按缩进块，取所有缩进大于声明行的后续行（空行不终止）。
///
/// `hard_limit` 是安全上限（行数），防止畸形文件导致扫描整个文件。
pub fn extract_body(lang: &str, lines: &[&str], decl_line_idx: usize, hard_limit: usize) -> String {
    if decl_line_idx >= lines.len() {
        return String::new();
    }
    if lang == "python" {
        return extract_indent_block(lines, decl_line_idx, hard_limit);
    }
    extract_brace_block(lines, decl_line_idx, hard_limit)
}

fn extract_brace_block(lines: &[&str], decl_line_idx: usize, hard_limit: usize) -> String {
    let end_cap = (decl_line_idx + hard_limit).min(lines.len());
    let mut depth: i32 = 0;
    let mut started = false;
    let mut out: Vec<&str> = Vec::new();

    for line in lines.iter().take(end_cap).skip(decl_line_idx) {
        out.push(line);
        let code = strip_line_noise(line);
        for ch in code.chars() {
            if ch == '{' {
                depth += 1;
                started = true;
            } else if ch == '}' {
                depth -= 1;
            }
        }
        if started && depth <= 0 {
            break;
        }
        // 声明行没有 `{`（如 `interface Foo` 后花括号换行）时继续读，
        // 但若连续多行都没开花括号就是没有体的声明（如 `type X = ...`），交给上限兜底。
    }
    out.join("\n")
}

fn extract_indent_block(lines: &[&str], decl_line_idx: usize, hard_limit: usize) -> String {
    let decl = lines[decl_line_idx];
    let base_indent = indent_of(decl);
    let end_cap = (decl_line_idx + hard_limit).min(lines.len());
    let mut out: Vec<&str> = vec![decl];

    for line in lines.iter().take(end_cap).skip(decl_line_idx + 1) {
        if line.trim().is_empty() {
            out.push(line);
            continue;
        }
        if indent_of(line) <= base_indent {
            break;
        }
        out.push(line);
    }
    out.join("\n")
}

fn indent_of(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').count()
}

/// 去掉行内注释与字符串字面量内容（保留引号本身以免误判），供括号配对使用
fn strip_line_noise(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    let mut in_str: Option<char> = None;
    while let Some(c) = chars.next() {
        match in_str {
            Some(q) => {
                if c == '\\' {
                    chars.next();
                } else if c == q {
                    in_str = None;
                }
            }
            None => {
                if c == '"' || c == '\'' || c == '`' {
                    in_str = Some(c);
                } else if c == '/' && chars.peek() == Some(&'/') {
                    break;
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

// ═══════════════════════════════════════════════════════════════════
// 语法探针：区分「声明」与「调用」
// ═══════════════════════════════════════════════════════════════════

/// 标识符边界判断：pos 处的匹配是否是一个完整标识符的开头
fn is_ident_boundary(prev: Option<char>) -> bool {
    match prev {
        None => true,
        Some(c) => !(c.is_alphanumeric() || c == '_' || c == '$' || c == '.'),
    }
}

/// 判断类体中是否**声明**了某个方法（而非调用它）
///
/// 认定为声明的形态：
/// - TS/JS：`name(` 出现在行首（可带 `public/private/static/async/get/set` 等修饰符）
/// - Rust：`fn name(`
/// - Python：`def name(` / `async def name(`
/// - Java/C#：`<修饰符> <返回类型> name(`
///
/// 明确排除：`obj.name(`（调用）、`return name(`（调用）。
pub fn declares_method(body: &str, name: &str) -> bool {
    let needle = format!("{}(", name);
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") || line.starts_with('*') {
            continue;
        }
        // Rust / Python 显式定义关键字
        if line.contains(&format!("fn {}", needle)) || line.contains(&format!("def {}", needle)) {
            return true;
        }
        // 花括号语言：剥掉修饰符后应以 name( 开头，且该行以 { 或 ) 收尾（方法签名特征）
        let stripped = strip_member_modifiers(line);
        if let Some(rest) = stripped.strip_prefix(&needle) {
            // 排除 `name();` 这种纯调用语句：方法声明的这一行通常以 `{` 结尾，
            // 或是接口里的签名（以 `;` 结尾但带返回类型冒号）。
            let looks_like_call = rest.trim_start().starts_with(')')
                && rest.trim_end().ends_with(';')
                && !rest.contains(':');
            if !looks_like_call {
                return true;
            }
        }
    }
    false
}

/// 剥掉成员修饰符前缀，返回剩余部分
fn strip_member_modifiers(line: &str) -> String {
    let mut s = line;
    loop {
        let before = s;
        for kw in [
            "public ",
            "private ",
            "protected ",
            "static ",
            "async ",
            "override ",
            "abstract ",
            "readonly ",
            "final ",
            "pub ",
            "get ",
            "set ",
            "virtual ",
            "internal ",
        ] {
            if let Some(rest) = s.strip_prefix(kw) {
                s = rest.trim_start();
            }
        }
        if s == before {
            break;
        }
    }
    s.to_string()
}

/// 语句级匹配：`return this` 必须是完整语句，不能是 `return this.foo`
///
/// 仅测试基线使用（旧引擎误判来源的历史判据），故 cfg(test) 门控，不进发布构建。
#[cfg(test)]
fn has_statement(body: &str, stmt: &str) -> bool {
    for raw in body.lines() {
        let line = raw.trim().trim_end_matches(';').trim();
        if line == stmt {
            return true;
        }
    }
    false
}

/// 子串匹配但要求左边界是标识符边界（避免 `myCreate(` 命中 `create(`）
pub fn contains_token(body: &str, token: &str) -> bool {
    let bytes: Vec<char> = body.chars().collect();
    let pat: Vec<char> = token.chars().collect();
    if pat.is_empty() || bytes.len() < pat.len() {
        return false;
    }
    for i in 0..=(bytes.len() - pat.len()) {
        if bytes[i..i + pat.len()] == pat[..] {
            let prev = if i == 0 { None } else { Some(bytes[i - 1]) };
            if is_ident_boundary(prev) {
                return true;
            }
        }
    }
    false
}

/// 统计类体中 `new Xxx(` / `Xxx::new(` 出现的**不同类型**数量
///
/// 工厂的本质是「按条件产出多种具体类型」，只造一种类型的通常只是普通构造函数。
fn distinct_constructed_types(body: &str) -> usize {
    let mut set = std::collections::BTreeSet::new();
    for raw in body.lines() {
        let line = raw.trim();
        let mut rest = line;
        while let Some(pos) = rest.find("new ") {
            let after = &rest[pos + 4..];
            let name: String = after
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            if name.len() > 1 && name.chars().next().is_some_and(|c| c.is_uppercase()) {
                set.insert(name);
            }
            rest = &after[..];
            if rest.is_empty() {
                break;
            }
        }
        // Rust：`Foo::new(` / `Box::new(Foo` 里的具体类型
        if let Some(pos) = line.find("::new(") {
            let head = &line[..pos];
            let name: String = head
                .chars()
                .rev()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if name.len() > 1
                && name != "Box"
                && name != "Arc"
                && name != "Rc"
                && name != "Vec"
                && name != "String"
                && name != "Self"
            {
                set.insert(name);
            }
        }
    }
    set.len()
}

/// 统计以指定前缀开头的**声明**方法数量（如 visit* / handle*）
fn count_declared_prefixed(body: &str, prefix: &str) -> usize {
    let mut n = 0;
    for raw in body.lines() {
        let line = strip_member_modifiers(raw.trim());
        let core = line
            .strip_prefix("fn ")
            .or_else(|| line.strip_prefix("def "))
            .unwrap_or(&line);
        if core.starts_with(prefix) {
            let after = &core[prefix.len()..];
            if after.contains('(') {
                n += 1;
            }
        }
    }
    n
}

/// 统计链式返回自身的方法数（`return this;` / `return self` / `-> Self` 且函数体真的 `self`）
fn fluent_return_count(lang: &str, body: &str) -> usize {
    let mut n = 0;
    for raw in body.lines() {
        let line = raw.trim().trim_end_matches(';').trim();
        if line == "return this" {
            n += 1;
        } else if lang == "python" && line == "return self" {
            n += 1;
        } else if lang == "rust" && line == "self" {
            // Rust 链式建造者惯例：方法末行裸 `self`
            n += 1;
        }
    }
    n
}

// ═══════════════════════════════════════════════════════════════════
// 各模式检测器
// ═══════════════════════════════════════════════════════════════════

/// 检测一个符号命中的全部设计模式
///
/// `name` 符号名，`kind` 符号类型（class/struct/interface/trait...），
/// `body` 由 [`extract_body`] 提取的真实符号体。
pub fn detect(lang: &str, name: &str, kind: &str, body: &str) -> Vec<DetectedPattern> {
    let mut out: Vec<DetectedPattern> = Vec::new();
    let lower = name.to_lowercase();

    // 结构型符号（类/结构体/接口/特征/枚举/模块）：跑经典 GoF + 架构角色检测器。
    let structural_kind = matches!(
        kind,
        "class" | "struct" | "interface" | "trait" | "enum" | "module"
    );
    // 函数式符号（function/const/let/variable 等）：TS/React 等现代代码库里设计模式
    // 大量以「函数 / 箭头常量」形态表达 —— Zustand `create<>()` store、`useXxx` Hook、
    // `withXxx` HOC、`createContext` Provider、`createXxx`/`makeXxx` 工厂。旧引擎只认 class，
    // 对这些项目近乎全漏，正是「设计模式画像点开什么都没有」被误判为功能失效的真根因。
    let functional_kind = matches!(
        kind,
        "function" | "const" | "constant" | "variable" | "let" | "arrow" | "closure"
    );
    if !structural_kind && !functional_kind {
        return out;
    }

    if structural_kind {
        if let Some(p) = detect_singleton(lang, &lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_factory(lang, &lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_builder(lang, &lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_observer(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_strategy(&lower, kind, body) {
            out.push(p);
        }
        if let Some(p) = detect_adapter(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_decorator(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_facade(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_command(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_visitor(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_template_method(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_repository(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_service(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_store(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_provider(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_controller(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_middleware(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_plugin(&lower, body) {
            out.push(p);
        }
    }

    if functional_kind {
        // 架构角色（命名即模式，复用既有 name-gated 检测器；这些检测器本身不校验 kind，
        // 故函数式符号只要命名命中 store/provider/service/... 即判为对应架构角色）。
        if let Some(p) = detect_store(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_provider(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_service(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_repository(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_controller(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_middleware(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_plugin(&lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_factory(lang, &lower, body) {
            out.push(p);
        }
        // 纯函数式模式（旧引擎完全没有对应）：自定义 Hook / 高阶组件 / 函数式工厂。
        if let Some(p) = detect_hook(lang, name, &lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_hoc(lang, name, &lower, body) {
            out.push(p);
        }
        if let Some(p) = detect_factory_fn(lang, name, &lower, body) {
            out.push(p);
        }
    }

    // 置信度高的排前面，方便前端只取 top-N 展示
    out.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

fn detect_singleton(_lang: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let static_holder = contains_token(body, "static instance")
        || contains_token(body, "_instance")
        || contains_token(body, "static let shared")
        || contains_token(body, "static var shared")
        || contains_token(body, "OnceCell")
        || contains_token(body, "OnceLock")
        || contains_token(body, "lazy_static");
    let accessor = declares_method(body, "getInstance")
        || declares_method(body, "get_instance")
        || declares_method(body, "instance")
        || declares_method(body, "shared")
        || declares_method(body, "global");
    let hidden_ctor = body.contains("private constructor")
        || body.contains("private init(")
        || body.contains("def __new__")
        || body.contains("protected constructor");

    s.hit(static_holder, SIG_STRUCT_STRONG, "持有静态单实例字段")
        .hit(
            accessor,
            SIG_STRUCT_MED,
            "暴露静态实例访问器（getInstance/shared）",
        )
        .hit(hidden_ctor, SIG_STRUCT_MED, "构造函数私有化")
        .hit(
            lower.ends_with("singleton"),
            SIG_NAME_STRONG,
            "类名以 Singleton 结尾",
        );
    s.finish("singleton", PatternCategory::Creational)
}

fn detect_factory(lang: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("factory");
    let creator = declares_method(body, "create")
        || declares_method(body, "make")
        || declares_method(body, "of")
        || declares_method(body, "from")
        || count_declared_prefixed(body, "create") > 0;
    let multi_type = distinct_constructed_types(body) >= 2;
    let branching =
        (body.contains("switch (") || body.contains("switch(") || body.contains("match "))
            && multi_type;

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Factory 结尾")
        .hit(creator, SIG_STRUCT_MED, "声明了 create/make 工厂方法")
        .hit(multi_type, SIG_STRUCT_STRONG, "内部构造两种以上具体类型")
        .hit(branching, SIG_AUX, "按分支条件选择具体类型");

    // 反证：Rust 里只有一个 `fn new()` 是惯用构造函数，不是工厂模式
    if lang == "rust" && !name_hit && !multi_type {
        s.penalty(
            declares_method(body, "new"),
            SIG_STRUCT_MED,
            "仅有惯用构造函数 new()",
        );
    }
    s.finish("factory", PatternCategory::Creational)
}

fn detect_builder(lang: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("builder");
    let fluent = fluent_return_count(lang, body);
    let has_build = declares_method(body, "build")
        || declares_method(body, "finish")
        || declares_method(body, "done");

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Builder 结尾")
        .hit(
            fluent >= 2,
            SIG_STRUCT_STRONG,
            "存在两个以上链式返回自身的方法",
        )
        .hit(fluent == 1, SIG_AUX, "存在链式返回自身的方法")
        .hit(has_build, SIG_STRUCT_MED, "声明了 build/finish 终结方法");
    s.finish("builder", PatternCategory::Creational)
}

fn detect_observer(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let sub = declares_method(body, "subscribe")
        || declares_method(body, "addListener")
        || declares_method(body, "addEventListener")
        || declares_method(body, "on")
        || declares_method(body, "attach")
        || declares_method(body, "register");
    let unsub = declares_method(body, "unsubscribe")
        || declares_method(body, "removeListener")
        || declares_method(body, "off")
        || declares_method(body, "detach");
    let notify = declares_method(body, "notify")
        || declares_method(body, "emit")
        || declares_method(body, "publish")
        || declares_method(body, "fire")
        || declares_method(body, "dispatch");
    let holder = contains_token(body, "listeners")
        || contains_token(body, "observers")
        || contains_token(body, "subscribers")
        || contains_token(body, "handlers");

    s.hit(
        sub && unsub,
        SIG_STRUCT_STRONG,
        "成对声明 订阅/取消订阅 方法",
    )
    .hit(notify, SIG_STRUCT_MED, "声明了 notify/emit 广播方法")
    .hit(holder, SIG_AUX, "持有监听者集合字段")
    .hit(
        lower.ends_with("observer") || lower.ends_with("emitter") || lower.ends_with("eventbus"),
        SIG_NAME_STRONG,
        "类名体现事件总线语义",
    );
    s.finish("observer", PatternCategory::Behavioral)
}

/// 策略模式：旧引擎有中文标签却从无代码产出，这里补上真实检测
fn detect_strategy(lower: &str, kind: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("strategy") || lower.ends_with("policy");
    let setter = declares_method(body, "setStrategy")
        || declares_method(body, "set_strategy")
        || declares_method(body, "usePolicy")
        || declares_method(body, "withStrategy");
    let holds = contains_token(body, "strategy") || contains_token(body, "policy");
    // 接口/特征 + 单一执行方法 = 策略契约
    let contract = matches!(kind, "interface" | "trait")
        && (declares_method(body, "execute")
            || declares_method(body, "apply")
            || declares_method(body, "run")
            || declares_method(body, "handle"));

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Strategy/Policy 结尾")
        .hit(setter, SIG_STRUCT_STRONG, "支持运行时替换策略实现")
        .hit(
            contract,
            SIG_STRUCT_MED,
            "接口仅声明单一执行方法（策略契约）",
        )
        .hit(holds && !name_hit, SIG_AUX, "持有策略字段");
    s.finish("strategy", PatternCategory::Behavioral)
}

fn detect_adapter(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("adapter") || lower.ends_with("wrapper");
    let wraps = contains_token(body, "adaptee")
        || contains_token(body, "inner")
        || contains_token(body, "wrapped")
        || contains_token(body, "delegate");
    let converts = declares_method(body, "adapt")
        || declares_method(body, "convert")
        || declares_method(body, "toDomain");

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Adapter/Wrapper 结尾")
        .hit(wraps, SIG_STRUCT_MED, "持有被适配对象字段")
        .hit(converts, SIG_STRUCT_MED, "声明了转换方法");
    s.finish("adapter", PatternCategory::Structural)
}

fn detect_decorator(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("decorator");
    let wraps = contains_token(body, "component")
        || contains_token(body, "inner")
        || contains_token(body, "wrapped");
    let delegates = contains_token(body, "super.")
        || contains_token(body, "this.inner.")
        || contains_token(body, "self.inner");

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Decorator 结尾")
        .hit(wraps, SIG_STRUCT_MED, "包裹同类型组件字段")
        .hit(delegates, SIG_STRUCT_MED, "方法委托给被包裹对象");
    s.finish("decorator", PatternCategory::Structural)
}

fn detect_facade(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("facade");
    // 门面的结构特征：聚合多个子系统字段并逐个转发
    let subsystems = ["service", "repository", "client", "manager", "gateway"]
        .iter()
        .filter(|k| contains_token(body, k))
        .count();

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Facade 结尾")
        .hit(subsystems >= 3, SIG_STRUCT_STRONG, "聚合三个以上子系统依赖")
        .hit(subsystems == 2, SIG_AUX, "聚合两个子系统依赖")
        .hit(
            lower.ends_with("manager") && subsystems >= 2,
            SIG_NAME_WEAK,
            "类名以 Manager 结尾且承担聚合职责",
        );
    s.finish("facade", PatternCategory::Structural)
}

fn detect_command(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("command") || lower.ends_with("action");
    let exec = declares_method(body, "execute")
        || declares_method(body, "run")
        || declares_method(body, "invoke");
    let undo = declares_method(body, "undo")
        || declares_method(body, "revert")
        || declares_method(body, "rollback");

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Command/Action 结尾")
        .hit(exec, SIG_STRUCT_MED, "声明了 execute 执行入口")
        .hit(
            undo,
            SIG_STRUCT_STRONG,
            "声明了 undo 撤销能力（命令模式强特征）",
        );
    s.finish("command", PatternCategory::Behavioral)
}

fn detect_visitor(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("visitor");
    let visits = count_declared_prefixed(body, "visit");
    let accept = declares_method(body, "accept");

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Visitor 结尾")
        .hit(visits >= 2, SIG_STRUCT_STRONG, "声明多个 visitXxx 方法")
        .hit(accept, SIG_STRUCT_MED, "声明了 accept 双分派入口");
    s.finish("visitor", PatternCategory::Behavioral)
}

fn detect_template_method(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let is_abstract = body.contains("abstract class")
        || body.contains("abstract ")
        || body.contains("raise NotImplementedError");
    let hooks = count_declared_prefixed(body, "on") + count_declared_prefixed(body, "do");
    let name_hit = lower.starts_with("abstract") || lower.starts_with("base");

    s.hit(
        is_abstract && hooks >= 2,
        SIG_STRUCT_STRONG,
        "抽象基类声明多个可覆写钩子",
    )
    .hit(is_abstract, SIG_STRUCT_MED, "存在抽象/未实现方法")
    .hit(name_hit, SIG_NAME_WEAK, "类名以 Abstract/Base 开头");
    s.finish("template_method", PatternCategory::Behavioral)
}

fn detect_repository(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit =
        lower.ends_with("repository") || lower.ends_with("repo") || lower.ends_with("dao");
    let crud = [
        "find", "save", "delete", "update", "insert", "list", "get_by", "list_by",
    ]
    .iter()
    .filter(|m| declares_method(body, m) || count_declared_prefixed(body, m) > 0)
    .count();

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Repository/DAO 结尾")
        .hit(crud >= 3, SIG_STRUCT_STRONG, "声明三种以上持久化操作")
        .hit(crud == 2, SIG_AUX, "声明两种持久化操作");
    s.finish("repository", PatternCategory::Architectural)
}

fn detect_service(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("service") || lower.ends_with("usecase");
    // 服务层特征：注入依赖（构造参数持有 repository/client）+ 编排方法
    let injects = contains_token(body, "repository")
        || contains_token(body, "repo")
        || contains_token(body, "client");
    let has_methods =
        count_declared_prefixed(body, "handle") + count_declared_prefixed(body, "process") > 0;

    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Service/UseCase 结尾")
        .hit(injects, SIG_STRUCT_MED, "注入仓储/客户端依赖")
        .hit(has_methods, SIG_AUX, "声明业务编排方法");
    s.finish("service", PatternCategory::Architectural)
}

/// 状态容器（Redux/Zustand/MobX 等）：类名以 Store 结尾几乎必是状态容器
fn detect_store(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("store");
    // `store` 本身也出现在 history/restore 等词里，故只认「结尾 store」；
    // 内部聚合状态/分发/选择器作为佐证，但命名已足够判定。
    let holds_state = contains_token(body, "state")
        || contains_token(body, "dispatch")
        || contains_token(body, "selector")
        || contains_token(body, "reducer");
    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Store 结尾（状态容器）")
        .hit(holds_state, SIG_AUX, "持有状态/分发/选择器字段");
    s.finish("store", PatternCategory::Architectural)
}

/// 提供方（React Context Provider、IoC Provider 等）
fn detect_provider(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("provider");
    let supplies = contains_token(body, "context")
        || contains_token(body, "children")
        || contains_token(body, "inject");
    s.hit(name_hit, SIG_NAME_STRONG, "类名以 Provider 结尾（提供方）")
        .hit(supplies, SIG_AUX, "向上下文/子节点/依赖提供能力");
    s.finish("provider", PatternCategory::Architectural)
}

/// 控制器（MVC / Web 路由层）
fn detect_controller(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("controller");
    let routes = count_declared_prefixed(body, "handle")
        + count_declared_prefixed(body, "get")
        + count_declared_prefixed(body, "post")
        + count_declared_prefixed(body, "put")
        + count_declared_prefixed(body, "delete");
    s.hit(
        name_hit,
        SIG_NAME_STRONG,
        "类名以 Controller 结尾（控制器）",
    )
    .hit(routes >= 2, SIG_STRUCT_MED, "声明多个路由/处理动作");
    s.finish("controller", PatternCategory::Architectural)
}

/// 中间件（请求 / 消息处理链）
fn detect_middleware(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit = lower.ends_with("middleware");
    let chain = declares_method(body, "next")
        || declares_method(body, "handle")
        || contains_token(body, "request")
        || contains_token(body, "response");
    s.hit(
        name_hit,
        SIG_NAME_STRONG,
        "类名以 Middleware 结尾（中间件）",
    )
    .hit(chain, SIG_AUX, "持有 next/handle 链式处理入口");
    s.finish("middleware", PatternCategory::Architectural)
}

/// 插件 / 扩展（可插拔架构）
fn detect_plugin(lower: &str, body: &str) -> Option<DetectedPattern> {
    let mut s = Scorer::new();
    let name_hit =
        lower.ends_with("plugin") || lower.ends_with("extension") || lower.ends_with("addon");
    let extensible = contains_token(body, "register")
        || contains_token(body, "hook")
        || contains_token(body, "extension_point");
    s.hit(
        name_hit,
        SIG_NAME_STRONG,
        "类名以 Plugin/Extension/Addon 结尾（插件）",
    )
    .hit(extensible, SIG_AUX, "暴露注册/钩子/扩展点");
    s.finish("plugin", PatternCategory::Architectural)
}

/// 命名是否落在「架构角色」后缀上（避免函数式检测器与架构角色重名造成双重标注）
fn is_architectural_name(lower: &str) -> bool {
    lower.ends_with("store")
        || lower.ends_with("provider")
        || lower.ends_with("service")
        || lower.ends_with("repository")
        || lower.ends_with("repo")
        || lower.ends_with("dao")
        || lower.ends_with("controller")
        || lower.ends_with("middleware")
        || lower.ends_with("plugin")
}

/// 扫描函数体是否真的调用了某个 Hook（use + 大写字母，覆盖内置与自定义 Hook 组合）
fn calls_any_hook(body: &str) -> bool {
    let bytes: Vec<char> = body.chars().collect();
    let pat: Vec<char> = "use".chars().collect();
    if pat.is_empty() {
        return false;
    }
    let mut i = 0;
    while i + pat.len() < bytes.len() {
        if bytes[i..i + pat.len()] == pat[..] {
            let prev = if i == 0 { None } else { Some(bytes[i - 1]) };
            let next = bytes[i + pat.len()];
            if is_ident_boundary(prev) && next.is_uppercase() {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// 自定义 Hook（React 约定 useXxx，且内部调用其它 Hook）
///
/// 旧引擎只认 class，对 `function useEditorSync()` / `const useXxx = () =>` 这类现代 TS/React
/// 模式完全失明。Hook 是行为型组合模式，归 behavioral。架构角色（store/provider/...）已由对应
/// 检测器标注，这里排除它们避免双重。
fn detect_hook(_lang: &str, name: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    if is_architectural_name(lower) {
        return None;
    }
    // 前缀后的字符必须大写（useXxx），用原始 name 判断，避免小写化后误判
    let name_hit =
        lower.starts_with("use") && name.chars().nth(3).map_or(false, |c| c.is_uppercase());
    if !name_hit {
        return None;
    }
    let calls = calls_any_hook(body);
    let mut s = Scorer::new();
    s.hit(
        name_hit,
        SIG_NAME_STRONG,
        "命名符合 useXxx 自定义 Hook 约定",
    )
    .hit(
        calls,
        SIG_STRUCT_MED,
        "内部调用了其它 Hook（useState/useEffect 等）",
    );
    s.finish("hook", PatternCategory::Behavioral)
}

/// 高阶组件（withXxx 命名，接收组件返回增强组件 —— 装饰器模式的函数式表达）
fn detect_hoc(_lang: &str, name: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    if is_architectural_name(lower) {
        return None;
    }
    let name_hit =
        lower.starts_with("with") && name.chars().nth(4).map_or(false, |c| c.is_uppercase());
    if !name_hit {
        return None;
    }
    let returns_component = contains_token(body, "forwardRef")
        || contains_token(body, "memo(")
        || body.contains("=> (")
        || contains_token(body, "props)");
    let mut s = Scorer::new();
    s.hit(name_hit, SIG_NAME_STRONG, "命名符合 withXxx 高阶组件约定")
        .hit(
            returns_component,
            SIG_STRUCT_MED,
            "返回一个增强后的组件（装饰器形态）",
        );
    s.finish("hoc", PatternCategory::Structural)
}

/// 函数式工厂（createXxx / makeXxx 命名，创建并返回新实例）
///
/// 与 class 级 `detect_factory`（仅认 *Factory 命名）互补：函数式项目里工厂常写作
/// `function createApp()` / `const makeApi = () =>`，命名是 create/make 前缀而非 Factory 后缀。
fn detect_factory_fn(_lang: &str, name: &str, lower: &str, body: &str) -> Option<DetectedPattern> {
    if is_architectural_name(lower) {
        return None;
    }
    let name_hit = (lower.starts_with("create")
        && name.chars().nth(6).map_or(false, |c| c.is_uppercase()))
        || (lower.starts_with("make") && name.chars().nth(4).map_or(false, |c| c.is_uppercase()));
    if !name_hit {
        return None;
    }
    let constructs = contains_token(body, "new ")
        || distinct_constructed_types(body) >= 1
        || body.contains("return {")
        || contains_token(body, "object");
    let mut s = Scorer::new();
    s.hit(
        name_hit,
        SIG_NAME_STRONG,
        "命名符合 createXxx/makeXxx 工厂约定",
    )
    .hit(constructs, SIG_STRUCT_MED, "创建并返回新实例/对象");
    s.finish("factory_fn", PatternCategory::Creational)
}

/// 模式 id → 中文名（前端 fileInsights.patternLabel 与之保持一致）
pub fn pattern_label(p: &str) -> String {
    match p {
        "singleton" => "单例模式",
        "factory" => "工厂模式",
        "builder" => "建造者模式",
        "observer" => "观察者模式",
        "strategy" => "策略模式",
        "adapter" => "适配器模式",
        "decorator" => "装饰器模式",
        "facade" => "门面模式",
        "command" => "命令模式",
        "visitor" => "访问者模式",
        "template_method" => "模板方法模式",
        "repository" => "仓储模式",
        "service" => "服务层模式",
        "store" => "状态容器模式",
        "provider" => "提供方模式",
        "controller" => "控制器模式",
        "middleware" => "中间件模式",
        "plugin" => "插件模式",
        "hook" => "自定义 Hook",
        "hoc" => "高阶组件",
        "factory_fn" => "函数式工厂",
        other => other,
    }
    .to_string()
}

// ═══════════════════════════════════════════════════════════════════
// 测试
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[DetectedPattern]) -> Vec<String> {
        v.iter().map(|p| p.id.clone()).collect()
    }

    // ── 回归：旧引擎的四大误报必须全部消失 ──

    #[test]
    fn return_this_property_is_not_builder() {
        // 旧引擎：body.contains("return this") → 命中建造者。实测本项目 50 个文件全是这种。
        let body = r#"
class UserPanel {
  render() {
    return this.state.value;
  }
  getName() {
    return this.name;
  }
}"#;
        let got = detect("typescript", "UserPanel", "class", body);
        assert!(
            !ids(&got).contains(&"builder".to_string()),
            "属性读取不应判为建造者: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn rust_idiomatic_new_is_not_factory() {
        let body = r#"
struct Config {
    path: String,
}
impl Config {
    fn new(path: String) -> Self {
        Self { path }
    }
}"#;
        let got = detect("rust", "Config", "struct", body);
        assert!(
            !ids(&got).contains(&"factory".to_string()),
            "惯用 new() 不应判为工厂: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn redux_dispatch_call_is_not_observer() {
        let body = r#"
class Toolbar {
  handleClick() {
    dispatch({ type: "save" });
    emit("changed");
  }
}"#;
        let got = detect("typescript", "Toolbar", "class", body);
        assert!(
            !ids(&got).contains(&"observer".to_string()),
            "调用点不应判为观察者: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn unambiguous_name_fires_alone() {
        // 高精度命名（Factory）本身就是模式：空体也应判定，无需结构佐证
        let got = detect(
            "typescript",
            "ThingFactory",
            "class",
            "class ThingFactory {}",
        );
        assert!(
            ids(&got).contains(&"factory".to_string()),
            "命名即模式应单独命中: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn ambiguous_name_still_needs_evidence() {
        // 歧义命名（Manager）仍必须结构佐证，避免旧引擎式误报
        let got = detect("typescript", "DataManager", "class", "class DataManager {}");
        assert!(got.is_empty(), "歧义命名空体不应命中: {:?}", ids(&got));
    }

    // ── 正例：真实模式必须检出 ──

    #[test]
    fn real_builder_is_detected() {
        let body = r#"
class QueryBuilder {
  where(cond: string) {
    this.conds.push(cond);
    return this;
  }
  limit(n: number) {
    this.n = n;
    return this;
  }
  build() {
    return new Query(this.conds);
  }
}"#;
        let got = detect("typescript", "QueryBuilder", "class", body);
        assert!(
            ids(&got).contains(&"builder".to_string()),
            "真实链式建造者应检出: {:?}",
            ids(&got)
        );
        let b = got.iter().find(|p| p.id == "builder").unwrap();
        assert!(
            b.confidence >= 0.9,
            "三条信号齐全应高置信: {}",
            b.confidence
        );
    }

    #[test]
    fn real_singleton_is_detected() {
        let body = r#"
class Logger {
  private static _instance: Logger;
  private constructor() {}
  static getInstance(): Logger {
    return Logger._instance;
  }
}"#;
        let got = detect("typescript", "Logger", "class", body);
        assert!(
            ids(&got).contains(&"singleton".to_string()),
            "标准单例应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn real_observer_is_detected() {
        let body = r#"
class EventBus {
  private listeners = new Map();
  subscribe(fn) { this.listeners.set(fn, 1); }
  unsubscribe(fn) { this.listeners.delete(fn); }
  emit(evt) { for (const l of this.listeners.keys()) l(evt); }
}"#;
        let got = detect("typescript", "EventBus", "class", body);
        assert!(
            ids(&got).contains(&"observer".to_string()),
            "标准事件总线应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn strategy_is_now_detectable() {
        // 旧引擎有「策略模式」标签却无任何产出路径
        let body = r#"
class Sorter {
  private strategy: SortStrategy;
  setStrategy(s: SortStrategy) { this.strategy = s; }
}"#;
        let got = detect("typescript", "Sorter", "class", body);
        assert!(
            ids(&got).contains(&"strategy".to_string()),
            "可替换策略应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn real_factory_with_multiple_types() {
        let body = r#"
class ShapeFactory {
  create(kind: string) {
    switch (kind) {
      case "c": return new Circle();
      case "s": return new Square();
    }
  }
}"#;
        let got = detect("typescript", "ShapeFactory", "class", body);
        assert!(
            ids(&got).contains(&"factory".to_string()),
            "多类型工厂应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn repository_is_detected() {
        let body = r#"
class UserRepository {
  find(id) {}
  save(u) {}
  delete(id) {}
}"#;
        let got = detect("typescript", "UserRepository", "class", body);
        let r = got.iter().find(|p| p.id == "repository");
        assert!(r.is_some(), "仓储应检出: {:?}", ids(&got));
        assert_eq!(r.unwrap().category, PatternCategory::Architectural);
    }

    #[test]
    fn architectural_name_detectors_fire() {
        let store = detect("typescript", "AuthStore", "class", "class AuthStore {}");
        assert!(
            ids(&store).contains(&"store".to_string()),
            "XxxStore 应检出: {:?}",
            ids(&store)
        );
        let provider = detect(
            "typescript",
            "ThemeProvider",
            "class",
            "class ThemeProvider {}",
        );
        assert!(
            ids(&provider).contains(&"provider".to_string()),
            "XxxProvider 应检出: {:?}",
            ids(&provider)
        );
        let ctrl = detect(
            "typescript",
            "UserController",
            "class",
            "class UserController {}",
        );
        assert!(
            ids(&ctrl).contains(&"controller".to_string()),
            "XxxController 应检出: {:?}",
            ids(&ctrl)
        );
        let mw = detect(
            "typescript",
            "AuthMiddleware",
            "class",
            "class AuthMiddleware {}",
        );
        assert!(
            ids(&mw).contains(&"middleware".to_string()),
            "XxxMiddleware 应检出: {:?}",
            ids(&mw)
        );
        let pl = detect("typescript", "PdfPlugin", "class", "class PdfPlugin {}");
        assert!(
            ids(&pl).contains(&"plugin".to_string()),
            "XxxPlugin 应检出: {:?}",
            ids(&pl)
        );
    }

    // ── 基础设施 ──

    #[test]
    fn brace_body_stops_at_class_boundary() {
        let src = vec![
            "class A {",
            "  foo() { return 1; }",
            "}",
            "class B {",
            "  private static _instance: B;",
            "}",
        ];
        let body = extract_body("typescript", &src, 0, 400);
        assert!(body.contains("foo()"));
        assert!(
            !body.contains("_instance"),
            "类体不应越界读到下一个类: {}",
            body
        );
    }

    #[test]
    fn brace_counting_ignores_braces_in_strings() {
        let src = vec!["class A {", "  s = \"}\";", "  foo() {}", "}"];
        let body = extract_body("typescript", &src, 0, 400);
        assert!(
            body.contains("foo()"),
            "字符串里的 }} 不应提前结束类体: {}",
            body
        );
    }

    #[test]
    fn python_body_uses_indentation() {
        let src = vec![
            "class A:",
            "    def foo(self):",
            "        pass",
            "",
            "class B:",
            "    _instance = None",
        ];
        let body = extract_body("python", &src, 0, 400);
        assert!(body.contains("def foo"));
        assert!(!body.contains("_instance"), "缩进块不应越界: {}", body);
    }

    #[test]
    fn declares_method_rejects_call_sites() {
        assert!(declares_method("  create(x) {", "create"));
        assert!(declares_method("  pub fn create(&self) {", "create"));
        assert!(declares_method("    def create(self):", "create"));
        assert!(!declares_method("    repo.create(user);", "create"));
        assert!(!declares_method("    return create();", "create"));
    }

    #[test]
    fn has_statement_is_exact() {
        assert!(has_statement("    return this;", "return this"));
        assert!(!has_statement("    return this.state;", "return this"));
    }

    #[test]
    fn contains_token_respects_boundary() {
        assert!(contains_token("let listeners = []", "listeners"));
        assert!(!contains_token("myListeners", "listeners"));
    }

    #[test]
    fn confidence_is_capped_at_one() {
        let body = r#"
class ThingFactory {
  create(kind) {
    switch (kind) {
      case 1: return new A();
      case 2: return new B();
    }
  }
  make() { return new A(); }
}"#;
        let got = detect("typescript", "ThingFactory", "class", body);
        let f = got.iter().find(|p| p.id == "factory").unwrap();
        assert!(f.confidence <= 1.0, "置信度不应超过 1: {}", f.confidence);
    }

    #[test]
    fn functional_kinds_get_functional_patterns_not_class_patterns() {
        // 函数不再是「全跳过」：createXxx 现在命中函数式工厂（而非旧引擎的「忽略函数」）。
        // 但同时不应被误判为类级 GoF 模式（建造者/单例等）。
        let got = detect("typescript", "createThing", "function", "return this;");
        let got_ids = ids(&got);
        assert!(
            !got_ids.contains(&"builder".to_string()),
            "函数不应被误判为类级建造者: {:?}",
            got_ids
        );
        assert!(
            !got_ids.contains(&"singleton".to_string()),
            "函数不应被误判为类级单例: {:?}",
            got_ids
        );
        assert!(
            got_ids.contains(&"factory_fn".to_string()),
            "createXxx 应命中函数式工厂: {:?}",
            got_ids
        );
    }

    // ── 函数式 / React 模式（旧引擎全漏，本轮补齐）──

    #[test]
    fn functional_zustand_store_is_detected() {
        let body = r#"
const useAuthStore = create<AuthState>()((set, get) => ({
  token: null,
  login: (t) => set({ token: t }),
  logout: () => set({ token: null }),
}));"#;
        let got = detect("typescript", "useAuthStore", "function", body);
        assert!(
            ids(&got).contains(&"store".to_string()),
            "Zustand store 应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn functional_hook_is_detected() {
        let body = r#"
function useEditorSync() {
  const [synced, setSynced] = useState(false);
  useEffect(() => { sync(); }, []);
  return synced;
}"#;
        let got = detect("typescript", "useEditorSync", "function", body);
        assert!(
            ids(&got).contains(&"hook".to_string()),
            "自定义 useXxx Hook 应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn functional_provider_is_detected() {
        let body = r#"
function ThemeProvider({ children }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}"#;
        let got = detect("typescript", "ThemeProvider", "function", body);
        assert!(
            ids(&got).contains(&"provider".to_string()),
            "XxxProvider 应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn functional_hoc_is_detected() {
        let body = r#"
const withRouter = (Component) => (props) => <Component {...props} route={useRoute()} />;"#;
        let got = detect("typescript", "withRouter", "function", body);
        assert!(
            ids(&got).contains(&"hoc".to_string()),
            "withXxx 高阶组件应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn functional_factory_fn_is_detected() {
        let body = r#"
function createApp(config) {
  const server = new Server(config);
  return server;
}"#;
        let got = detect("typescript", "createApp", "function", body);
        assert!(
            ids(&got).contains(&"factory_fn".to_string()),
            "createXxx 工厂应检出: {:?}",
            ids(&got)
        );
    }

    #[test]
    fn architectural_name_not_double_labeled_as_hook() {
        // useProjectStore 既是 useXxx 又是 store：应只标 store，避免双重标注成 hook
        let body = r#"const useProjectStore = create<State>()((set) => ({ value: 0, set }));"#;
        let got = detect("typescript", "useProjectStore", "function", body);
        let got_ids = ids(&got);
        assert!(
            got_ids.contains(&"store".to_string()),
            "应标为 store: {:?}",
            got_ids
        );
        assert!(
            !got_ids.contains(&"hook".to_string()),
            "架构角色不应被误标为 hook: {:?}",
            got_ids
        );
    }

    #[test]
    fn plain_function_is_not_a_pattern() {
        let got = detect(
            "typescript",
            "doWork",
            "function",
            "function doWork() { return 1; }",
        );
        assert!(got.is_empty(), "普通函数不应命中任何模式: {:?}", ids(&got));
    }

    #[test]
    fn signals_are_recorded_for_ui() {
        let body = r#"
class Logger {
  private static _instance: Logger;
  private constructor() {}
  static getInstance() { return Logger._instance; }
}"#;
        let got = detect("typescript", "Logger", "class", body);
        let s = got.iter().find(|p| p.id == "singleton").unwrap();
        assert!(!s.signals.is_empty(), "必须记录判定依据供前端展示");
    }
}
