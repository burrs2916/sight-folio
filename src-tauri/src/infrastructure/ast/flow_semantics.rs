//! FlowSemantic 语义表（对标 joern `dataflowengineoss/DefaultSemantics.scala`）
//!
//! ## joern 是怎么做的
//!
//! joern 的数据流引擎里**没有**「污点引擎」这种独立组件，污点分析 =
//! `CFG + ReachingDefPass`（到达定义）+ **语义表** + 查询时剪边。语义表的位置在
//! `dataflowengineoss/src/main/scala/io/joern/dataflowengineoss/DefaultSemantics.scala`：
//!
//! ```scala
//! // DefaultSemantics.scala:24-71（节选）
//! F(Operators.addition,  List((1, -1), (2, -1))),   // 两个操作数都流向返回值
//! F(Operators.assignment, List((2, 1), (2, -1))),
//! PTF(Operators.modulo,  List.empty),               // PassThrough
//! PTF("<operator>.listLiteral"),
//! ```
//!
//! 索引约定（与 `Semantics.scala:131` 的 `ParameterNode` 一致）：
//!
//! | 索引 | 含义 |
//! |---|---|
//! | `0`  | receiver / base（`this`、实例对象） |
//! | `1..n` | 第 n 个参数 |
//! | `-1` | 返回值 |
//!
//! 两种映射（`Semantics.scala:142-158`）：
//!
//! - `FlowMapping(src, dst)` —— 显式声明 `src` 流向 `dst`；
//! - `PassThroughMapping` —— **对所有非 0 参数**：`i -> i` 且 `i -> -1`，
//!   但**不交叉污染**（不产生 `0 -> 0`，也不产生 `i -> j`）。注释原文：
//!   *"parameters are not sanitized, may affect the return value, and do not
//!   cross-taint. The main benefit is that this works for unbounded parameters
//!   e.g. VARARGS."*
//!
//! 剪边发生在 `passes/reachingdef/EdgeValidator.scala:45-60`：
//!
//! ```scala
//! private def isCallRetval(parentNode: StoredNode) = parentNode match {
//!   case call: Call => semanticsForCall(call).exists(!explicitlyFlowsToReturnValue(_))
//!   ...
//! }
//! private def explicitlyFlowsToReturnValue(flowPath: FlowPath) = flowPath match {
//!   case FlowMapping(_, ParameterNode(-1, None)) => true
//!   case PassThroughMapping                      => true
//!   case _                                       => false
//! }
//! ```
//!
//! 即：**只有语义表里查得到、且声明不流向返回值的调用，才阻断入参 → 返回值的边**。
//! 查不到的调用一律不剪（保守放行）。
//!
//! ## 我们之前缺什么
//!
//! 污点求解器在前端 `src/editor/utils/taintFlow.ts`，净化判定用的是一条正则黑名单
//! （`SANITIZER_RE`）。它有两类问题：
//!
//! 1. **误伤**：`normalize` 被列进净化名单，于是
//!    `const p = path.normalize(req.params.p); fs.readFileSync(p)` 被判成
//!    「已净化」→ **路径穿越漏洞整条漏报**。而 `path.normalize("../etc/passwd")`
//!    返回的还是 `../etc/passwd`，它根本不是净化器；joern 的语义表里也查无此条，
//!    按「查不到不剪」处理，污染照常传播。
//! 2. **不可维护、不可扩展**：一条 200 字符的正则同时承担「净化器名单」和
//!    「名字符号规范化」两件事，无法按语言区分，也无法表达「透传」这一正向语义。
//!
//! 本模块把判定从正则黑名单升级为 joern 式的**语义表**：
//!
//! - `Block` —— 对标「语义表查得到 + `!explicitlyFlowsToReturnValue`」→ 阻断；
//! - `PassThrough` —— 对标 `PassThroughMapping`（`i->-1` 且不净化）→ **明确放行**，
//!   并**覆盖**掉正则名单的误伤；
//! - 查不到 —— 与 joern「查不到不剪」对齐，回退到历史正则行为（零回归）。
//!
//! ## 范围纪律
//!
//! `Block` 名单与历史 `SANITIZER_RE` **逐项对齐**（唯一例外是 `normalize`/`normalise`
//! 移入 `PassThrough`，理由见上），确保本模块只**修漏报**、不引入新的误报。
//! 语义表查不到时的行为与改动前**完全一致**。
//!
//! ## 回放实测（本仓 23143 条流边，`probe_semantics_vs_regex`）
//!
//! ```text
//! 语义表命中     9510 (41.1%)   ← 走语义判定
//! 语义表未命中  13633 (58.9%)   ← 回退历史正则（零回归区）
//! 历史判净化      376 (1.6%)
//! 语义表判净化    366 (1.6%)
//! ```
//!
//! 判定**翻转**仅 10 条（0.04%），全部落在两个名字上，且两个翻转都是**修漏报**：
//!
//! - `sanitize_f64` × 8 —— `src-tauri/src/commands/cad.rs:413` 的 CAD 坐标
//!   数值钳位（`if v.is_finite() && v.abs() < 1e9 { v } else { 0.0 }`），
//!   与注入净化毫无关系，却被正则的 `sanitize\w*` 分支命中，白送 8 条
//!   「已净化」结论。
//! - `escapeRegExp` × 2 —— `src/editor/panels/CodeWorkbench.tsx:113` 的
//!   正则元字符转义，防的是正则注入，而我们的 sink 集合是
//!   sql/rce/xss/path/ssrf/deser，**不含正则执行**，当通用净化器属于越权。
//!
//! 净化归因分布：Number 147 · parseInt 119 · escapeHtml 47 · parseFloat 43 ·
//! basename 5 · encodeURIComponent 5 —— 全部是名副其实的类型收窄/转义调用。

use std::collections::HashSet;
use std::sync::OnceLock;

// ─────────────────────────── 索引约定（对齐说明） ───────────────────────────
//
// joern 的 `FlowMapping` 用三个索引位表达全部数据流语义：
//
// | 索引 | 含义 | 出处 |
// |---|---|---|
// | `0`  | receiver / base（`this`、实例对象） | `Semantics.scala:131` `ParameterNode` |
// | `1..n` | 第 n 个参数 | 同上 |
// | `-1` | 返回值 | `EdgeValidator.scala:57` `ParameterNode(-1, None)` |
//
// 本模块**刻意不照搬这套索引**：`CallArgFlow::arg_index` 是实参的 0-based 位置
// （`0` = 第一个实参，与 receiver 无关），返回值也不占索引位 —— 返回值有没有被
// 污染由 `ChainSem` 这个三态结论直接给出，不映射到 `-1` 上。
//
// 之所以仍把约定写在这里，是因为它决定了语义表的**语义边界**：
// `PassThroughMapping` 明确「不产生 `0 -> 0`」（不交叉污染），而我们在过程内
// 已经用 `idents_with_call_path` 把接收者链当作数据来源展开过（见 `dataflow.rs`
// 中该函数的注释），两条路径合起来才等价于 joern 的完整覆盖。

/// 单个调用的语义结论（对标 joern `FlowPath` 的两个变体）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlowKind {
    /// 对标 `PassThroughMapping`：参数值原样保留（可能改变表示形式），
    /// **返回值仍携带入参的污染**，且不交叉污染。
    PassThrough,
    /// 对标「语义表查得到但不流向返回值」（`EdgeValidator.explicitlyFlowsToReturnValue == false`）：
    /// 入参的污染**不会**流到返回值，污点链到此终止。
    Block,
}

// ─────────────────────────── PassThrough 名单 ───────────────────────────
//
// 收录判据（三者同时成立）：
//   ① 是语言标准库/内建的纯变换（不改值的安全属性，只改表示或容器形态）；
//   ② 返回值由入参决定 → 对标 `i -> -1`；
//   ③ 不改变「是否危险」这一性质 → 对标 PassThrough 的 "not sanitized"。
//
// 注：`normalize` / `normalise` 在此表中，是**刻意**与历史正则名单不一致的地方：
// Unicode 规范化（`String.prototype.normalize`）与路径规范化（`path.normalize`）
// 都不消除注入payload，把它们当净化器是真实漏报源。

const PASS_THROUGH: &[&str] = &[
    // ── TS / JS：String ──
    "trim",
    "trimstart",
    "trimend",
    "trimleft",
    "trimright",
    "tolowercase",
    "touppercase",
    "tolocalelowercase",
    "tolocaleuppercase",
    "substring",
    "substr",
    "slice",
    "split",
    "concat",
    "repeat",
    "padstart",
    "padend",
    "charat",
    "charcodeat",
    "codepointat",
    "indexof",
    "lastindexof",
    "includes",
    "startswith",
    "endswith",
    "replace",
    "replaceall",
    "match",
    "matchall",
    "search",
    "normalize",
    "normalise",
    "tostring",
    "valueof",
    "tolocalestring",
    // 数字格式化：值仍由入参决定（NaN 也属于「入参决定」）
    "tofixed",
    "toprecision",
    "toexponential",
    "tolocaledatestring",
    "toisostring",
    // ── TS / JS：Array / Object / JSON ──
    "join",
    "reverse",
    "sort",
    "flat",
    "flatmap",
    "map",
    "filter",
    "find",
    "findindex",
    "findlast",
    "findlastindex",
    "some",
    "every",
    "keys",
    "values",
    "entries",
    "from",
    "of",
    "assign",
    "freeze",
    "seal",
    "reduce",
    "reduceright",
    "foreach",
    "at",
    "with",
    "tosorted",
    "toreversed",
    "stringify",
    "parse",
    "clone",
    "structuredclone",
    // ── TS / JS：包装器与内建 ──
    "string",
    "boolean",
    "symbol",
    "bigint",
    "regexp",
    "date",
    "abs",
    "floor",
    "ceil",
    "round",
    "trunc",
    "sign",
    "pow",
    "sqrt",
    "max",
    "min",
    // decodeURI* 是 encodeURI* 的逆操作，解码后的串**更**危险，绝不阻断
    "decodeuri",
    "decodeuricomponent",
    "unescape",
    // ── Rust：std 纯变换 ──
    // 注：`to_string` 是 Rust 侧出现频次最高的中间调用（真实仓库探针 Top20 之首），
    // 它与 JS 的 `toString` 是同一个语义，只是命名风格不同，两条都要收录。
    "to_string",
    "to_owned",
    "to_vec",
    "as_str",
    "as_ref",
    "as_mut",
    "as_bytes",
    "as_path",
    "to_string_lossy",
    "to_str",
    "to_mut",
    "deref",
    "borrow",
    "iter",
    "iter_mut",
    "into_iter",
    "cloned",
    "copied",
    "collect",
    "filter_map",
    "flatten",
    "zip",
    "enumerate",
    "rev",
    "take",
    "skip",
    "chain",
    "unwrap_or",
    "unwrap_or_else",
    "unwrap_or_default",
    "ok_or",
    "ok_or_else",
    "and_then",
    "or_else",
    "map_or",
    "map_or_else",
    "map_err",
    "inspect",
    "to_lowercase",
    "to_uppercase",
    "split_whitespace",
    "splitn",
    "rsplitn",
    "trim_start",
    "trim_end",
    "replacen",
    "chars",
    "lines",
    "bytes",
    "display",
    "stringify_macro",
    "abs_diff",
    "clamp",
    "saturating_add",
    "fold",
    "sum",
    "product",
    "count",
    "position",
    "rposition",
    // 宏（`!` 后缀在 normalize_callee 里去掉，故按裸名收录）
    "vec",
    // ── Python：内建与 str / 容器 ──
    "strip",
    "lstrip",
    "rstrip",
    "casefold",
    "capitalize",
    "swapcase",
    "rsplit",
    "splitlines",
    "zfill",
    "ljust",
    "rjust",
    "center",
    "encode",
    "decode",
    "format",
    "format_map",
    "join",
    "sorted",
    "reversed",
    "tuple",
    "frozenset",
    "repr",
    "ascii",
    "ord",
    "chr",
    "deepcopy",
    "dumps",
    "items",
    "get",
    "setdefault",
    "pop",
    "copy",
    "hex",
    "oct",
    "bin",
];

// ─────────────────────────── Block 名单 ───────────────────────────
//
// 对标 joern「语义表查得到 + 不流向返回值」（`EdgeValidator.explicitlyFlowsToReturnValue
// == false`）。
//
// **范围纪律**：本表与历史 `SANITIZER_RE` **逐项等价**，唯一例外是去掉了
// `normalize` / `normalise`（它们移入 PASS_THROUGH，理由见上）。
//
// 方向性说明：多列一个 Block = 多判定一条链「已净化」= **多一份漏报**。
// 所以我们不借这次重构顺手扩充净化器名单 —— 那属于独立的安全策略变更，
// 必须单独评估。本模块只**修**漏报，不**造**漏报。
const BLOCK: &[&str] = &[
    // escape*（历史正则 `escape\w*`）
    "escape",
    "escapehtml",
    "escape_html",
    "escapejavascript",
    "escapeshellarg",
    "escapeshellcmd",
    "escapeidentifier",
    "escapeliteral",
    "escapestring",
    // sanitize* / sanitise*
    "sanitize",
    "sanitise",
    // encodeURI* / encodeURIComponent
    "encodeuri",
    "encodeuricomponent",
    // HTML 实体化
    "htmlspecialchars",
    "striptags",
    "strip_tags",
    // quote*（历史正则 `quote\w*`）
    "quote",
    "quoteidentifier",
    "quote_plus",
    "urlencode",
    // 白名单式收窄
    "parameterize",
    "whitelist",
    "allowlist",
    // 类型收窄：把任意串压成数字 → 结构确实被破坏
    "parseint",
    "parsefloat",
    "number",
    // 路径收窄
    "basename",
    // 专用清洗库
    "dompurify",
    "xss",
];

/// 归一化调用名：`JSON.stringify` → `stringify`，`path.normalize` → `normalize`。
///
/// 与后端 `dataflow::short_callee`（取点号最后一段）和前端 `normCallName`
/// （去空白 + 转小写）口径保持一致，保证三方查的是同一张表。
/// Rust 宏的 `!` 后缀一并去掉（`format!` → `format`）。
fn normalize_callee(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('!').to_ascii_lowercase();
    match trimmed.rsplit('.').next() {
        Some(seg) if !seg.is_empty() => seg.to_string(),
        _ => trimmed,
    }
}

fn pass_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| PASS_THROUGH.iter().copied().collect())
}

fn block_set() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| BLOCK.iter().copied().collect())
}

/// 查语义表。查不到返回 `None` —— 与 joern「语义查不到就不剪边」完全对齐，
/// 调用方据此回退到历史行为。
pub fn semantics_for(callee: &str) -> Option<FlowKind> {
    let key = normalize_callee(callee);
    if key.is_empty() {
        return None;
    }
    if pass_set().contains(key.as_str()) {
        return Some(FlowKind::PassThrough);
    }
    if block_set().contains(key.as_str()) {
        return Some(FlowKind::Block);
    }
    None
}

/// 整条求值链的语义结论（对标 joern 沿 DDG 边逐级查语义再剪边）。
///
/// `names` 为**求值顺序**（内层在前）的调用名序列，即 `flow.via ++ [flow.callee]`。
///
/// 优先级：`Block` 一票否决（任何一环净化，整条链净化）；
/// 否则任一环 `PassThrough` 即整体放行（覆盖掉正则名单的误伤）；
/// 否则查不到，回退历史行为。
pub fn chain_semantics<'a, I>(names: I) -> ChainSem
where
    I: IntoIterator<Item = &'a str>,
{
    let mut saw_pass = false;
    let mut blocker: Option<&'a str> = None;
    for n in names {
        match semantics_for(n) {
            Some(FlowKind::Block) => {
                blocker = Some(n);
                break;
            }
            Some(FlowKind::PassThrough) => saw_pass = true,
            None => {}
        }
    }
    if let Some(name) = blocker {
        return ChainSem::Block(name.to_string());
    }
    if saw_pass {
        return ChainSem::PassThrough;
    }
    ChainSem::Unknown
}

/// 整链语义结论，序列化成 `CallArgFlow::sem` 落库。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainSem {
    /// 有调用被语义表判定为净化器；携带**决定性**调用名，
    /// 供前端在报告里标注「依据哪个调用判定已净化」。
    Block(String),
    /// 链上有语义表收录的透传调用：明确**不**净化（用于覆盖正则误伤）。
    PassThrough,
    /// 语义表无记录：调用方回退到历史正则判定（零回归）。
    Unknown,
}

impl ChainSem {
    /// 落库用的紧凑编码。
    ///
    /// - `"block:<name>"` —— 净化，附决定性调用名
    /// - `"pass"` —— 透传，明确不净化
    /// - `""` —— 无记录
    ///
    /// 旧数据没有 `sem` 字段 → `#[serde(default)]` 兜底成 `""` → 走历史分支，
    /// 因此**不需要任何数据库迁移**。
    pub fn encode(&self) -> String {
        match self {
            ChainSem::Block(name) => format!("block:{}", name),
            ChainSem::PassThrough => "pass".to_string(),
            ChainSem::Unknown => String::new(),
        }
    }

    /// 解码（Rust 侧镜像）。
    ///
    /// 生产链路上的解码器在 TS 侧（`taintFlow.ts::resolveSanitizer`）—— 语义表
    /// 的编码落进 `call_flows` 的 JSON 后由前端消费，Rust 不会把它读回来。
    /// 这里保留一份镜像，供单测与回放探针校验「编码 ↔ 解码」自洽，
    /// 防止将来有人改了 `encode` 忘了同步前端。
    #[allow(dead_code)]
    pub fn decode(raw: &str) -> ChainSem {
        if let Some(rest) = raw.strip_prefix("block:") {
            if !rest.is_empty() {
                return ChainSem::Block(rest.to_string());
            }
        }
        if raw == "pass" {
            return ChainSem::PassThrough;
        }
        ChainSem::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn member_call_is_matched_by_last_segment() {
        // 三方口径一致：后端 short_callee / 前端 normCallName / 本表
        assert_eq!(semantics_for("JSON.stringify"), Some(FlowKind::PassThrough));
        assert_eq!(semantics_for("escapeHtml"), Some(FlowKind::Block));
        assert_eq!(semantics_for("path.basename"), Some(FlowKind::Block));
        assert_eq!(
            semantics_for("String.prototype.trim"),
            Some(FlowKind::PassThrough)
        );
    }

    #[test]
    fn lookup_is_case_and_whitespace_insensitive() {
        assert_eq!(semantics_for("  ToString "), Some(FlowKind::PassThrough));
        assert_eq!(semantics_for("ESCAPEHTML"), Some(FlowKind::Block));
    }

    #[test]
    fn unknown_call_has_no_semantics() {
        // 与 joern「语义查不到就不剪边」对齐：返回 None，调用方回退历史行为
        assert_eq!(semantics_for("handleRequest"), None);
        assert_eq!(semantics_for(""), None);
    }

    #[test]
    fn normalize_is_pass_through_not_sanitizer() {
        // 本轮的核心修正：path.normalize / String.prototype.normalize 都不是净化器。
        // 历史正则把它们列进 SANITIZER_RE，导致路径穿越整条漏报。
        assert_eq!(semantics_for("normalize"), Some(FlowKind::PassThrough));
        assert_eq!(semantics_for("normalise"), Some(FlowKind::PassThrough));
        let sem = chain_semantics(["normalize", "readFileSync"]);
        assert_eq!(
            sem,
            ChainSem::PassThrough,
            "normalize 不该让整条链判成已净化"
        );
    }

    #[test]
    fn block_anywhere_in_chain_vetoes() {
        // const v = escapeHtml(req.body); render(v)
        let sem = chain_semantics(["escapeHtml", "render"]);
        assert_eq!(sem, ChainSem::Block("escapeHtml".to_string()));
        // const v = req.body.trim(); const w = escapeHtml(v); render(w)
        let sem = chain_semantics(["trim", "escapeHtml", "render"]);
        assert_eq!(sem, ChainSem::Block("escapeHtml".to_string()));
    }

    #[test]
    fn unknown_chain_stays_unknown() {
        assert_eq!(chain_semantics(["trim", "query"]), ChainSem::PassThrough);
        assert_eq!(chain_semantics(["helper", "save"]), ChainSem::Unknown);
    }

    #[test]
    fn encode_decode_round_trips() {
        for s in [
            ChainSem::Unknown,
            ChainSem::PassThrough,
            ChainSem::Block("escapeHtml".to_string()),
        ] {
            assert_eq!(ChainSem::decode(&s.encode()), s, "{:?}", s);
        }
        // 旧数据兜底
        assert_eq!(ChainSem::decode(""), ChainSem::Unknown);
        assert_eq!(ChainSem::decode("garbage"), ChainSem::Unknown);
        assert_eq!(ChainSem::decode("block:"), ChainSem::Unknown);
    }

    #[test]
    fn block_table_matches_historical_regex() {
        // 范围纪律：Block 名单必须与历史 SANITIZER_RE 等价（除 normalize/normalise）。
        // 这条测试锁住「只修漏报、不新增误报面」。
        let historical = [
            "escape",
            "escapeHtml",
            "sanitize",
            "sanitise",
            "encodeURI",
            "encodeURIComponent",
            "htmlspecialchars",
            "stripTags",
            "strip_tags",
            "quote",
            "parameterize",
            "whitelist",
            "allowlist",
            "parseInt",
            "parseFloat",
            "Number",
            "basename",
            "DOMPurify",
            "xss",
        ];
        for h in historical {
            assert_eq!(
                semantics_for(h),
                Some(FlowKind::Block),
                "{} 历史上被正则判为净化器，语义表必须保持 Block",
                h
            );
        }
    }

    // ───────────────── 回放探针（默认不跑，需显式 --ignored） ─────────────────

    /// 历史 `SANITIZER_RE` 的 Rust 等价实现（仅探针用，非产品代码）。
    ///
    /// 原型：`/(^|[$_.\s])(escape\w*|sanitize\w*|...|xss)$/`，
    /// 前端先对名做 `normCallName`（去空白 + 转小写）再分别测 last / norm。
    fn historical_regex_matches(name: &str) -> bool {
        let n = name.trim().to_ascii_lowercase();
        let last = n.rsplit('.').next().unwrap_or(&n).to_string();
        let exact = [
            "htmlspecialchars",
            "striptags",
            "strip_tags",
            "parameterize",
            "whitelist",
            "allowlist",
            "parseint",
            "parsefloat",
            "number",
            "normalize",
            "normalise",
            "basename",
            "dompurify",
            "xss",
        ];
        if exact.contains(&last.as_str()) {
            return true;
        }
        for prefix in ["escape", "sanitize", "sanitise", "encodeuri", "quote"] {
            if last.starts_with(prefix) {
                return true;
            }
        }
        false
    }

    /// 语义表 vs 历史正则 —— 真实仓库回放对比（默认不跑）
    ///
    /// 关心三件事：
    ///
    /// ① 有多少流边的判定**发生了翻转**（历史判「已净化」→ 现在不判，或反之）；
    /// ② 翻转集中在哪些调用名上 —— 若全是 `normalize` 这类论证过的条目，
    ///    说明改动精准；若混入意外名字，说明名单需要收紧；
    /// ③ 语义表的**覆盖率** —— 多少流边能查到语义（查不到的走历史分支，零回归）。
    ///
    ///   cargo test --lib flow_semantics::tests::probe_semantics_vs_regex -- --ignored --nocapture
    #[test]
    #[ignore = "真实仓库探针，按需手动运行"]
    fn probe_semantics_vs_regex() {
        use crate::infrastructure::ast::dataflow::analyze_dataflow;
        use std::collections::HashMap;
        use std::path::{Path, PathBuf};

        fn lang_of(p: &Path) -> Option<&'static str> {
            match p.extension().and_then(|e| e.to_str())? {
                "ts" | "tsx" => Some("typescript"),
                "js" | "jsx" | "mjs" => Some("javascript"),
                "rs" => Some("rust"),
                "py" => Some("python"),
                _ => None,
            }
        }
        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            let Ok(rd) = std::fs::read_dir(dir) else {
                return;
            };
            for e in rd.flatten() {
                let p = e.path();
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with('.') || n == "node_modules" || n == "target" || n == "dist" {
                    continue;
                }
                if p.is_dir() {
                    walk(&p, out);
                } else if lang_of(&p).is_some() {
                    out.push(p);
                }
            }
        }

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let mut files = Vec::new();
        walk(&root.join("src"), &mut files);
        if let Some(parent) = root.parent() {
            walk(&parent.join("src"), &mut files);
        }

        let mut total = 0usize;
        let (mut sem_hit, mut sem_miss) = (0usize, 0usize);
        let (mut old_san, mut new_san) = (0usize, 0usize);
        // 翻转统计：name -> (旧判净化 & 新不判, 旧不判 & 新判净化)
        let mut flips: HashMap<String, (usize, usize)> = HashMap::new();
        let mut san_names: HashMap<String, usize> = HashMap::new();

        for f in &files {
            let lang = lang_of(f).unwrap();
            let Ok(src) = std::fs::read_to_string(f) else {
                continue;
            };
            let rel = f
                .strip_prefix(&root)
                .unwrap_or(f)
                .to_string_lossy()
                .to_string();
            let Some(flow) = analyze_dataflow(lang, &rel, &src) else {
                continue;
            };
            for func in &flow.functions {
                for c in &func.param_to_call {
                    total += 1;
                    let chain: Vec<&str> = c
                        .via
                        .iter()
                        .map(|s| s.as_str())
                        .chain(std::iter::once(c.callee.as_str()))
                        .collect();
                    let old = chain.iter().any(|n| historical_regex_matches(n));
                    let new = matches!(ChainSem::decode(&c.sem), ChainSem::Block(_));
                    if old {
                        old_san += 1;
                    }
                    if new {
                        new_san += 1;
                    }
                    if c.sem.is_empty() {
                        sem_miss += 1;
                    } else {
                        sem_hit += 1;
                    }

                    if old != new {
                        // 归因到决定性名字：新判净化用 sem 里的名字，否则用链上任一命中正则的名字
                        let who = match ChainSem::decode(&c.sem) {
                            ChainSem::Block(n) => n,
                            _ => chain
                                .iter()
                                .find(|n| historical_regex_matches(n))
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| c.callee.clone()),
                        };
                        let e = flips.entry(who).or_insert((0, 0));
                        if old {
                            e.0 += 1;
                        } else {
                            e.1 += 1;
                        }
                    }
                    if new {
                        if let ChainSem::Block(n) = ChainSem::decode(&c.sem) {
                            *san_names.entry(n).or_insert(0usize) += 1;
                        }
                    }
                }
            }
        }

        assert!(total > 0, "探针至少要产出一条流边");
        let pct = |n: usize| n as f64 / total.max(1) as f64 * 100.0;
        println!("\n── FlowSemantic 语义表 vs 历史 SANITIZER_RE（回放对比） ──────────");
        println!("流边总数 {}", total);
        println!(
            "  语义表命中   {:>6} ({:.1}%)  ← 走语义判定",
            sem_hit,
            pct(sem_hit)
        );
        println!(
            "  语义表未命中 {:>6} ({:.1}%)  ← 回退历史正则（零回归区）",
            sem_miss,
            pct(sem_miss)
        );
        println!("  历史判净化   {:>6} ({:.1}%)", old_san, pct(old_san));
        println!("  语义表判净化 {:>6} ({:.1}%)", new_san, pct(new_san));

        let mut fl: Vec<_> = flips.into_iter().collect();
        fl.sort_by_key(|(_, v)| std::cmp::Reverse(v.0 + v.1));
        println!("\n判定翻转 Top 20（→不再净化 = 修漏报；→新增净化 = 需复核）:");
        for (name, (was_san, now_san)) in fl.iter().take(20) {
            println!(
                "  {:<32} 旧判净化 {:>4} · 新判净化 {:>4}",
                name, was_san, now_san
            );
        }

        let mut sn: Vec<_> = san_names.into_iter().collect();
        sn.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        println!("\n语义表判净化的调用 Top 15:");
        for (n, c) in sn.iter().take(15) {
            println!("  {:<40} {}", n, c);
        }
        println!();
    }
}
