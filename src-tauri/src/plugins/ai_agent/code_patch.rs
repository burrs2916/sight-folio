//! 锚点补丁定位器（R47 P2-A）
//!
//! 为什么必须有这一层
//! ------------------
//! `apply_change` 原本的唯一形态是「AI 输出整文件全文 → 直接覆盖写盘」。这个形态在
//! 真实项目里必然出事故，原因与模型能力无关，是接口设计本身的问题：
//!
//! 1. **截断即数据丢失**。让模型复述一个 800 行文件，它会省略「与本次改动无关」的段落
//!    （甚至自作主张地写 `// ... 其余保持不变`）。全文覆盖会把这些省略如实写进磁盘，
//!    一次改一个函数的请求，代价是文件的其余部分消失。
//! 2. **token 与延迟随文件规模线性膨胀**。改一行注释要重传整个文件两遍（读+写）。
//! 3. **无法判断意图**。全文写入的 diff 是「整文件对整文件」，评审者看不出模型究竟想改什么。
//!
//! 因此本模块提供**锚点补丁**：模型只提供 `old_text`（要被替换的原文片段）与 `new_text`，
//! 由本地代码在真实磁盘内容里定位后替换。模型不再承担「复述全文」的义务，也就不再有
//! 截断的机会。
//!
//! 定位的三条铁律（每一条都堵掉一种会静默改错代码的实现）
//! ----------------------------------------------------
//! · **必须唯一**。`old_text` 在文件里出现 2 次以上时拒收，而不是「取第一个」。
//!   `return null;` 这种片段在一个文件里能出现十几次，取第一个等于随机挑一处改。
//!   歧义时要求调用方补 `occurrence` 序号或扩大上下文——把选择权交回给看得见全文的一方。
//! · **匹配失败不猜**。严格匹配失败后只允许一档降级：把每行的**行尾空白**归一化后再匹配
//!   （处理模型复制代码时丢掉尾随空格、CRLF 变 LF 这类无语义差异），且降级命中要标记
//!   `approx`，让调用方知道这次替换的边界是推断出来的。绝不做「忽略缩进」「模糊相似度」
//!   之类的匹配——缩进在 Python/YAML 里是语义，相似度会把另一处相似代码改掉。
//! · **空锚点不是插入指令**。`old_text` 为空字符串时拒收。空串能在任意位置匹配，
//!   落到实现里就是「在文件开头插入」，而模型给空锚点的真实含义几乎总是「我不知道该改哪」。
//!
//! 本模块是纯函数（不碰 DB、不碰文件系统），所有分支都可单测；写盘与台账登记在
//! `change_ledger` / `tools::ApplyChangeTool` 里。

/// 锚点定位失败的原因。每种都对应一句能让模型自我纠正的回执，
/// 而不是笼统的 "patch failed"——模型拿到笼统错误只会原样重试。
#[derive(Debug, Clone, PartialEq)]
pub enum PatchError {
    /// old_text 为空（见铁律三）
    EmptyAnchor,
    /// 文件里找不到该片段
    NotFound,
    /// 出现多次且未指定 occurrence（附出现次数）
    Ambiguous(usize),
    /// 指定的 occurrence 超出实际出现次数（附实际次数）
    OccurrenceOutOfRange { found: usize, requested: usize },
    /// new_text 与 old_text 完全一致（空改动，不该落库产生一条待审记录）
    NoOp,
}

impl PatchError {
    /// 给模型看的错误信：说清楚发生了什么 + 下一步该怎么做。
    ///
    /// 无位置证据时的兜底版本（等价旧行为）。工具侧应优先用
    /// [`PatchError::message_with_hint`]，把 `locate_hint()` 收集到的证据一并回给模型。
    pub fn message(&self, rel_path: &str) -> String {
        self.message_with_hint(rel_path, &LocateHint::default())
    }

    /// 带上位置证据的错误信。
    ///
    /// `NotFound` 会附上最接近的候选片段（行号 + 相似度 + 首个差异坐标）并直接给出
    /// 下一步该调的 `file_read` 参数；`Ambiguous` 会列出每一处命中在第几行。
    /// 目的只有一个：让模型**在这一条回执里就能改对**，不必再发一次工具去「找它在哪」。
    pub fn message_with_hint(&self, rel_path: &str, hint: &LocateHint) -> String {
        match self {
            PatchError::EmptyAnchor => format!(
                "old_text must not be empty. To locate the edit in '{}', copy the exact original \
                 snippet you want to replace (from file_read output), including enough surrounding \
                 lines to make it unique.",
                rel_path
            ),
            PatchError::NotFound => {
                let mut out = format!(
                    "old_text was not found in '{}'. Re-read the file with file_read and copy the \
                     snippet verbatim (indentation and line breaks must match exactly). The file may \
                     also have changed since you last read it.",
                    rel_path
                );
                if !hint.candidates.is_empty() {
                    out.push_str("\n\nNearest matches in that file (most similar first):");
                    for c in &hint.candidates {
                        let indent_note = if c.indent_only_lines > 0 {
                            format!(", +{} differ only in indentation", c.indent_only_lines)
                        } else {
                            String::new()
                        };
                        out.push_str(&format!(
                            "\n  line {} — {}/{} lines identical{}; first difference at snippet line {} col {}: {}",
                            c.line_no,
                            c.exact_lines,
                            c.span,
                            indent_note,
                            c.diff_line,
                            c.diff_col,
                            c.preview,
                        ));
                    }
                    if let Some(best) = hint.candidates.first() {
                        let from = best.line_no.saturating_sub(2).max(1);
                        let to = best.line_no + best.span + 1;
                        out.push_str(&format!(
                            "\n\nTo see the closest one in context: file_read(file_path=\"{}\", start_line={}, end_line={})",
                            rel_path, from, to
                        ));
                    }
                }
                out
            }
            PatchError::Ambiguous(n) => {
                let mut out = format!(
                    "old_text appears {} times in '{}' — refusing to guess which one you meant.",
                    n, rel_path
                );
                if !hint.occurrences.is_empty() {
                    out.push_str("\nOccurrences (1-based, pass as `occurrence`):");
                    for (i, site) in hint.occurrences.iter().enumerate() {
                        out.push_str(&format!(
                            "\n  {}. line {}: {}",
                            i + 1,
                            site.line_no,
                            site.preview
                        ));
                    }
                    if hint.occurrences.len() < *n {
                        out.push_str(&format!(
                            "\n  … and {} more (not listed).",
                            n.saturating_sub(hint.occurrences.len())
                        ));
                    }
                    out.push_str(&format!(
                        "\nEither extend old_text with more surrounding lines until it is unique, or pass \
                         occurrence (1-based index of the match you want: 1..{}).",
                        n
                    ));
                } else {
                    out.push_str(
                        " Either extend old_text with more surrounding lines until it is unique, or pass \
                         occurrence (1-based index of the match you want).",
                    );
                }
                out
            }
            PatchError::OccurrenceOutOfRange { found, requested } => format!(
                "occurrence {} requested but old_text appears only {} time(s) in '{}'.",
                requested, found, rel_path
            ),
            PatchError::NoOp => format!(
                "new_text is identical to old_text — nothing to change in '{}'.",
                rel_path
            ),
        }
    }
}

/// 一次成功的补丁应用结果。
#[derive(Debug, Clone, PartialEq)]
pub struct PatchResult {
    /// 替换后的完整内容（供写盘）
    pub content: String,
    /// 命中片段的起始行号（1-based，含）
    pub start_line: usize,
    /// 命中片段的结束行号（1-based，含）
    pub end_line: usize,
    /// 替换后该片段占据的结束行号（1-based，含）——供前端定位光标
    pub new_end_line: usize,
    /// 是否走了「行尾空白归一化」降级（边界为推断，需要在回执里显式说明）
    pub approx: bool,
    /// 该锚点在文件中的总出现次数（1 或调用方指定 occurrence 时的实际次数）
    pub occurrences: usize,
}

/// 把「行尾空白」归一化：每行 trim_end，行分隔符统一成 `\n`。
///
/// 只归一行尾，不动行首（缩进有语义）。归一化只用于**匹配**，替换仍作用在原始内容上。
fn normalize_line_ends(s: &str) -> String {
    s.replace("\r\n", "\n")
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 收集 needle 在 haystack 中所有出现位置（字节偏移）。
///
/// 重叠匹配按「找到即跳过整段」处理：`aa` 在 `aaa` 里算 1 次而不是 2 次。
/// 代码片段场景下重叠匹配没有语义，按不重叠计数更接近人的直觉。
fn find_all(haystack: &str, needle: &str) -> Vec<usize> {
    if needle.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut from = 0usize;
    while let Some(rel) = haystack[from..].find(needle) {
        let at = from + rel;
        out.push(at);
        from = at + needle.len();
        if from > haystack.len() {
            break;
        }
    }
    out
}

/// 字节偏移 → 1-based 行号
fn line_of(content: &str, byte_offset: usize) -> usize {
    content[..byte_offset.min(content.len())]
        .bytes()
        .filter(|b| *b == b'\n')
        .count()
        + 1
}

/// 片段占据的行数（末尾换行不额外计一行）
fn span_lines(fragment: &str) -> usize {
    if fragment.is_empty() {
        return 1;
    }
    fragment.bytes().filter(|b| *b == b'\n').count() + 1
}

/// 在 `content` 中用 `new_text` 替换唯一命中的 `old_text`。
///
/// `occurrence`：1-based。`None` 表示要求唯一命中（出现多次即拒收）。
pub fn apply_patch(
    content: &str,
    old_text: &str,
    new_text: &str,
    occurrence: Option<usize>,
) -> Result<PatchResult, PatchError> {
    if old_text.is_empty() {
        return Err(PatchError::EmptyAnchor);
    }
    if old_text == new_text {
        return Err(PatchError::NoOp);
    }

    // 一档：严格精确匹配
    let hits = find_all(content, old_text);
    if !hits.is_empty() {
        let at = pick_hit(&hits, occurrence)?;
        return Ok(build_result(
            content,
            at,
            old_text,
            new_text,
            hits.len(),
            false,
        ));
    }

    // 二档：行尾空白 + CRLF 归一化后匹配。
    // 归一化会改变字节偏移，因此命中后要把偏移映射回原文——
    // 做法是按「归一化后的行号」定位，再在原文按行重建替换，避免偏移换算出错。
    let norm_content = normalize_line_ends(content);
    let norm_old = normalize_line_ends(old_text);
    if norm_old.is_empty() {
        return Err(PatchError::NotFound);
    }
    let norm_hits = find_all(&norm_content, &norm_old);
    if norm_hits.is_empty() {
        return Err(PatchError::NotFound);
    }
    let at = pick_hit(&norm_hits, occurrence)?;
    let start_line = line_of(&norm_content, at);
    let old_span = span_lines(&norm_old);

    // 在原文里按行替换 [start_line, start_line + old_span) 这段
    let orig_lines: Vec<&str> = content.split('\n').collect();
    if start_line - 1 + old_span > orig_lines.len() {
        return Err(PatchError::NotFound);
    }
    let mut rebuilt: Vec<String> = Vec::with_capacity(orig_lines.len());
    rebuilt.extend(orig_lines[..start_line - 1].iter().map(|s| s.to_string()));
    let new_span_lines: Vec<&str> = new_text.split('\n').collect();
    rebuilt.extend(new_span_lines.iter().map(|s| s.to_string()));
    rebuilt.extend(
        orig_lines[start_line - 1 + old_span..]
            .iter()
            .map(|s| s.to_string()),
    );

    Ok(PatchResult {
        content: rebuilt.join("\n"),
        start_line,
        end_line: start_line + old_span - 1,
        new_end_line: start_line + new_span_lines.len() - 1,
        approx: true,
        occurrences: norm_hits.len(),
    })
}

fn pick_hit(hits: &[usize], occurrence: Option<usize>) -> Result<usize, PatchError> {
    match occurrence {
        None => {
            if hits.len() > 1 {
                Err(PatchError::Ambiguous(hits.len()))
            } else {
                Ok(hits[0])
            }
        }
        Some(n) => {
            if n == 0 || n > hits.len() {
                Err(PatchError::OccurrenceOutOfRange {
                    found: hits.len(),
                    requested: n,
                })
            } else {
                Ok(hits[n - 1])
            }
        }
    }
}

fn build_result(
    content: &str,
    at: usize,
    old_text: &str,
    new_text: &str,
    occurrences: usize,
    approx: bool,
) -> PatchResult {
    let mut next = String::with_capacity(content.len() + new_text.len());
    next.push_str(&content[..at]);
    next.push_str(new_text);
    next.push_str(&content[at + old_text.len()..]);
    let start_line = line_of(content, at);
    PatchResult {
        content: next,
        start_line,
        end_line: start_line + span_lines(old_text) - 1,
        new_end_line: start_line + span_lines(new_text) - 1,
        approx,
        occurrences,
    }
}

/// 反向补丁：把已应用的改动撤回（`new_text` → `old_text`）。
///
/// 用于「文件在改动之后又被别人改过」时的片段级回滚：此时整文快照回写会吞掉后来的改动，
/// 只能把这一处换回去。同样要求唯一命中——找不到或有歧义时宁可拒绝回滚，
/// 让用户拿 `.bak` 手动处理，也不要改错地方。
pub fn revert_patch(
    content: &str,
    old_text: &str,
    new_text: &str,
) -> Result<PatchResult, PatchError> {
    apply_patch(content, new_text, old_text, None)
}

/// 全文覆盖模式的「截断护栏」。
///
/// 判据不是「是否变短」（删代码本来就该变短），而是**骤减**：原文有一定体量、
/// 新内容却少掉近半。这个形状几乎只由两种原因产生：模型省略了未改动段落，
/// 或输出被 max_tokens 截断。两者都是数据丢失，不该在用户看到 diff 之前落盘。
///
/// 返回 `Some(理由)` 表示应当拒收。
pub fn full_write_guard(old_content: &str, new_content: &str) -> Option<String> {
    let old_lines = old_content.lines().count();
    let new_lines = new_content.lines().count();
    // 小文件（<= 80 行）整体重写是正常操作，不设限
    if old_lines <= 80 {
        return None;
    }
    let kept = new_lines as f64 / old_lines as f64;
    if kept < 0.6 {
        return Some(format!(
            "Refusing full-content write: {} lines → {} lines ({:.0}% of the original). \
             This shape almost always means the response omitted unchanged parts or was truncated, \
             which would delete working code. Use the anchored form instead: pass old_text (the exact \
             snippet to replace) and new_text. If the shrink is intentional (deleting code), \
             do it as one or more anchored patches so the diff shows what is removed.",
            old_lines,
            new_lines,
            kept * 100.0
        ));
    }
    // 结尾出现「省略号占位」几乎可以确诊截断（模型写 `// ... rest unchanged`）
    let tail: String = new_content
        .lines()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();
    for marker in [
        "rest of the file unchanged",
        "rest unchanged",
        "remains unchanged",
        "其余保持不变",
        "其余不变",
        "省略",
    ] {
        if tail.contains(marker) {
            return Some(format!(
                "Refusing full-content write: the content ends with a placeholder ('{}'), \
                 meaning parts of the file were not actually written out. Use old_text/new_text \
                 anchored patches instead.",
                marker
            ));
        }
    }
    None
}

/// 给模型看的补丁回执：命中行号 + 前后各 2 行上下文。
///
/// 刻意不回整段新内容——模型已经知道自己写了什么，回执的价值在于确认
/// 「本地把它落在了第几行、周围长什么样」，这也是它自查改错位置的唯一依据。
pub fn patch_preview(new_content: &str, start_line: usize, new_end_line: usize) -> String {
    let lines: Vec<&str> = new_content.split('\n').collect();
    let from = start_line.saturating_sub(3); // 0-based 起点 = start_line-1-2
    let to = (new_end_line + 2).min(lines.len());
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate().take(to).skip(from) {
        let no = i + 1;
        let marker = if no >= start_line && no <= new_end_line {
            ">"
        } else {
            " "
        };
        out.push_str(&format!("{}{:>5} | {}\n", marker, no, line));
    }
    out
}

/// 内容指纹（撤销时判断磁盘是否还是我们写下的那份）。
///
/// 用 FNV-1a：不需要密码学强度，只需要「内容变了指纹一定变」，
/// 且不引入新依赖（项目已刻意保持后端依赖精简）。
pub fn content_hash(content: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in content.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

// ─── 定位证据：把「定位失败」从一句笼统错误变成可自我纠正的指路 ───
//
// **为什么需要它**（对标 openclaw `sessions/tools/edit-diff.ts:378-424` 的候选提示与
// `:442-456` 的 "Found N occurrences…must be unique"）：
// 原来的 `NotFound` 只说「重读文件照抄」，`Ambiguous(n)` 只给一个次数。模型两者都拿不到
// 位置信息，只能再发一次 `file_read` 从头找——一次无效往返就是几千 token，而且重试时
// 依然是在盲猜。把「每处命中在第几行」「最接近的候选差在哪一行哪一列」直接写进回执，
// 模型一条消息就能改对，不必额外调工具。
//
// **为什么不动 `PatchError` 的形状**：既有 20+ 条单测直接断言 `PatchError::Ambiguous(2)`
// 这种元组变体，给枚举加字段会让它们全部编译失败。证据走独立的 `LocateHint`，
// 由调用方（`ApplyChangeTool`）在失败时按需附加 —— 纯增量，零回归。
//
// 全部是纯函数（不碰 DB、不碰文件系统），所有分支可单测。

/// 收集证据时最多扫多少行，防止在超大文件里做无用功。
const LOCATE_SCAN_MAX_LINES: usize = 20_000;
/// 候选/命中预览每行的最大字符数（避免把超长行灌进上下文）。
const CANDIDATE_PREVIEW_CHARS: usize = 120;
/// 最多给几条候选。
const MAX_CANDIDATES: usize = 3;
/// 歧义时最多列出几处命中（超出的只报「还有 N 处」）。
const MAX_LISTED_OCCURRENCES: usize = 8;
/// 只差缩进的行在相似度里的权重（低于 1.0：它「接近」但不「等于」精确匹配）。
const INDENT_ONLY_WEIGHT: f64 = 0.7;
/// 候选收集上限（防御性：极端重复文件里避免无界分配）。
const MAX_COLLECTED_CANDIDATES: usize = 2_000;

/// 锚点在文件中的一处命中。
#[derive(Debug, Clone, PartialEq)]
pub struct OccurrenceSite {
    /// 片段起始行号（1-based）
    pub line_no: usize,
    /// 片段首行预览（已截断）
    pub preview: String,
}

/// 与锚点最接近的候选片段（`NotFound` 时给出）。
#[derive(Debug, Clone, PartialEq)]
pub struct CandidateLine {
    /// 候选片段的起始行号（1-based）
    pub line_no: usize,
    /// 锚点占多少行（供回执给出 file_read 的建议区间）
    pub span: usize,
    /// 有多少行与锚点逐行（各自去行尾空白后）完全相同
    pub exact_lines: usize,
    /// 有多少行只差缩进（`trim` 后相同）—— 最高频的定位失败原因，必须单列
    pub indent_only_lines: usize,
    /// 综合相似度 0.0~1.0，仅用于排序
    pub score: f64,
    /// 首个差异落在片段内第几行（1-based）；完全一致时为 0
    pub diff_line: usize,
    /// 首个差异落在那一行的第几列（1-based，按字符计）；完全一致时为 0
    pub diff_col: usize,
    /// 片段首行预览（已截断）
    pub preview: String,
}

/// 一次失败定位能给模型的全部位置证据。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocateHint {
    /// 每一处命中（歧义时模型真正缺的就是这个）
    pub occurrences: Vec<OccurrenceSite>,
    /// 完全找不到时最接近的候选（按相似度降序）
    pub candidates: Vec<CandidateLine>,
}

impl LocateHint {
    pub fn is_empty(&self) -> bool {
        self.occurrences.is_empty() && self.candidates.is_empty()
    }
}

/// 为一次失败的定位收集位置证据。
///
/// 三档递进，与 `apply_patch` 的匹配口径**严格一致**（先精确、再行尾空白归一化），
/// 否则会出现「apply_patch 说找不到、证据却说在第 12 行」这种自相矛盾的回执。
pub fn locate_hint(content: &str, old_text: &str) -> LocateHint {
    let mut hint = LocateHint::default();
    if content.is_empty() || old_text.is_empty() {
        return hint;
    }

    // 一档：精确命中 —— 列出每一处所在行号与首行预览
    let hits = find_all(content, old_text);
    if !hits.is_empty() {
        hint.occurrences = sites_at(content, &hits);
        return hint;
    }

    // 二档：行尾空白 + CRLF 归一化后的命中（行号按归一化后的文本算，
    // 与 apply_patch 二档用的 `line_of(norm_content, at)` 同源）
    let norm_content = normalize_line_ends(content);
    let norm_old = normalize_line_ends(old_text);
    if !norm_old.is_empty() {
        let norm_hits = find_all(&norm_content, &norm_old);
        if !norm_hits.is_empty() {
            hint.occurrences = sites_at(&norm_content, &norm_hits);
            return hint;
        }
    }

    // 三档：彻底找不到 —— 滑窗找最接近的几处，告诉模型差在哪
    hint.candidates = nearest_candidates(content, old_text, MAX_CANDIDATES);
    hint
}

fn sites_at(content: &str, hits: &[usize]) -> Vec<OccurrenceSite> {
    hits.iter()
        .take(MAX_LISTED_OCCURRENCES)
        .map(|&at| {
            let line_no = line_of(content, at);
            let preview = content[at..].split('\n').next().unwrap_or("").trim_end();
            OccurrenceSite {
                line_no,
                preview: truncate_chars(preview, CANDIDATE_PREVIEW_CHARS),
            }
        })
        .collect()
}

/// 在文件里滑一个与锚点等高的窗口，挑出最像的 `k` 处。
///
/// 相似度刻意**不用字符串编辑距离**：「5 行里 4 行一模一样、第 5 行只差缩进」是模型
/// 一眼能懂且能直接照着改的说法，而一个 0.73 的编辑距离分数对它毫无行动指导意义。
/// 逐行比较还有个附带好处：成本与文件行数线性相关，超大文件也跑得动。
fn nearest_candidates(content: &str, old_text: &str, k: usize) -> Vec<CandidateLine> {
    let anchor: Vec<&str> = old_text.split('\n').collect();
    let span = anchor.len();
    let all: Vec<&str> = content.split('\n').collect();
    let scan_end = all.len().min(LOCATE_SCAN_MAX_LINES);
    if span == 0 || scan_end < span {
        return Vec::new();
    }

    let mut scored: Vec<(CandidateLine, usize)> = Vec::new(); // (候选, 首个差异位置，用于并列时的次级排序)
    for start in 0..=(scan_end - span) {
        let win = &all[start..start + span];
        let mut exact = 0usize;
        let mut indent_only = 0usize;
        for (a, b) in win.iter().zip(anchor.iter()) {
            let a = a.trim_end();
            let b = b.trim_end();
            if a == b {
                exact += 1;
            } else if a.trim_start() == b.trim_start() {
                // 只差缩进。不能当成「不相似」扔掉——它是最高频的一类定位失败，
                // 直接丢弃会让候选列表在这类场景下全空，等于没做。
                indent_only += 1;
            }
        }
        // 一行都不沾边就不是「差点匹配上」，列出来只会稀释注意力
        if exact == 0 && indent_only == 0 {
            continue;
        }
        let (diff_line, diff_col) = first_difference(win, &anchor);
        let cand = CandidateLine {
            line_no: start + 1,
            span,
            exact_lines: exact,
            indent_only_lines: indent_only,
            score: (exact as f64 + INDENT_ONLY_WEIGHT * indent_only as f64) / span as f64,
            diff_line,
            diff_col,
            preview: truncate_chars(win[0].trim_end(), CANDIDATE_PREVIEW_CHARS),
        };
        scored.push((cand, diff_line * 1_000_000 + diff_col));
        if scored.len() >= MAX_COLLECTED_CANDIDATES {
            break;
        }
    }

    // 相似度降序；并列时首个差异出现得越晚越像（公共前缀更长）
    scored.sort_by(|a, b| {
        b.0.score
            .partial_cmp(&a.0.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.1.cmp(&a.1))
            .then_with(|| a.0.line_no.cmp(&b.0.line_no))
    });
    scored.into_iter().map(|(c, _)| c).take(k).collect()
}

/// 逐行比对齐后，找出第一个差异落在片段内第几行第几列。
///
/// 比较前两侧都 `trim_end`（行尾空白不计入语义差异），并且**只在行内比较**——
/// 缩进差异会被算成第 1 列不同，这正是模型最需要的那类信号。
/// 完全一致时返回 (0, 0)。
fn first_difference(win: &[&str], anchor: &[&str]) -> (usize, usize) {
    for (i, (a, b)) in win.iter().zip(anchor.iter()).enumerate() {
        let a = a.trim_end();
        let b = b.trim_end();
        if a == b {
            continue;
        }
        let col = a
            .chars()
            .zip(b.chars())
            .position(|(ca, cb)| ca != cb)
            .map(|p| p + 1)
            .unwrap_or_else(|| a.chars().count().min(b.chars().count()) + 1);
        return (i + 1, col);
    }
    (0, 0)
}

/// 按**字符**截断（不能用字节下标，中文/emoji 会切在 UTF-8 中间导致 panic）。
pub fn truncate_chars(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "fn a() {\n    let x = 1;\n    return x;\n}\n\nfn b() {\n    let x = 2;\n    return x;\n}\n";

    // ── 铁律一：必须唯一 ──

    #[test]
    fn ambiguous_anchor_is_refused_not_guessed() {
        // "    return x;" 在两个函数里各出现一次；取第一个等于随机改一处
        let err = apply_patch(SRC, "    return x;", "    return x + 1;", None).unwrap_err();
        assert_eq!(err, PatchError::Ambiguous(2));
        // 错误信必须告诉模型两条出路（扩大上下文 / 指定序号）
        let msg = err.message("src/a.rs");
        assert!(
            msg.contains("occurrence"),
            "must suggest occurrence: {}",
            msg
        );
        assert!(
            msg.contains("unique"),
            "must suggest extending anchor: {}",
            msg
        );
    }

    #[test]
    fn occurrence_selects_the_requested_hit() {
        let r = apply_patch(SRC, "    return x;", "    return x * 2;", Some(2)).unwrap();
        // 第二个函数体被改，第一个保持原样
        assert!(r.content.contains("let x = 1;\n    return x;\n"));
        assert!(r.content.contains("let x = 2;\n    return x * 2;\n"));
        assert_eq!(r.occurrences, 2);
        assert_eq!(r.start_line, 8);
    }

    #[test]
    fn occurrence_out_of_range_reports_actual_count() {
        let err = apply_patch(SRC, "    return x;", "y", Some(5)).unwrap_err();
        assert_eq!(
            err,
            PatchError::OccurrenceOutOfRange {
                found: 2,
                requested: 5
            }
        );
    }

    #[test]
    fn unique_anchor_reports_exact_line_span() {
        let r = apply_patch(
            SRC,
            "fn b() {\n    let x = 2;",
            "fn b() {\n    let x = 20;",
            None,
        )
        .unwrap();
        assert_eq!((r.start_line, r.end_line), (6, 7));
        assert!(!r.approx);
        assert!(r.content.contains("let x = 20;"));
    }

    #[test]
    fn multi_line_replacement_tracks_new_end_line() {
        // 1 行换 3 行：new_end_line 必须随之变长，前端才能把光标放对
        let r = apply_patch(
            SRC,
            "    let x = 1;",
            "    let x = 1;\n    let y = 2;\n    let z = 3;",
            None,
        )
        .unwrap();
        assert_eq!(r.start_line, 2);
        assert_eq!(r.end_line, 2);
        assert_eq!(r.new_end_line, 4);
    }

    // ── 铁律二：匹配失败不猜，降级只到行尾空白 ──

    #[test]
    fn trailing_whitespace_and_crlf_are_tolerated_but_marked_approx() {
        let src = "fn a() {\r\n    let x = 1;   \r\n}\r\n";
        let r = apply_patch(src, "    let x = 1;\r\n", "    let x = 42;", None).unwrap();
        assert!(r.approx, "degraded match must be flagged");
        assert!(r.content.contains("let x = 42;"));
        assert_eq!(r.start_line, 2);
    }

    #[test]
    fn indentation_difference_is_not_tolerated() {
        // 缩进在 Python/YAML 里是语义，绝不能模糊匹配：
        // 锚点缩进比原文深（8 空格 vs 4 空格）时必须判 NotFound，不能"忽略行首空白"命中。
        let err = apply_patch(SRC, "        let x = 1;", "        let x = 9;", None).unwrap_err();
        assert_eq!(err, PatchError::NotFound);
        // 而子串（不含行首缩进）本身在原文里唯一，允许命中——这是精确匹配的正常结果
        let ok = apply_patch(SRC, "let x = 1;", "let x = 9;", None).unwrap();
        assert!(ok.content.contains("    let x = 9;"));
    }

    #[test]
    fn not_found_tells_model_to_reread() {
        let err = apply_patch(SRC, "fn nope() {}", "x", None).unwrap_err();
        assert_eq!(err, PatchError::NotFound);
        assert!(err.message("src/a.rs").contains("file_read"));
    }

    // ── 铁律三：空锚点不是插入指令 ──

    #[test]
    fn empty_anchor_is_refused() {
        assert_eq!(
            apply_patch(SRC, "", "anything", None).unwrap_err(),
            PatchError::EmptyAnchor
        );
    }

    #[test]
    fn noop_patch_is_refused() {
        // 空改动会在台账里留下一条无内容的待审记录，污染评审列表
        assert_eq!(
            apply_patch(SRC, "let x = 1;", "let x = 1;", None).unwrap_err(),
            PatchError::NoOp
        );
    }

    // ── 反向补丁（撤销）──

    #[test]
    fn revert_patch_restores_original_fragment() {
        let r = apply_patch(SRC, "    let x = 2;", "    let x = 22;", None).unwrap();
        let back = revert_patch(&r.content, "    let x = 2;", "    let x = 22;").unwrap();
        assert_eq!(back.content, SRC);
    }

    #[test]
    fn revert_refuses_when_fragment_no_longer_unique() {
        // 撤销时如果 new_text 已经在文件里出现多次（后来有人复制了这段），
        // 宁可拒绝也不要改错地方
        let content = "a();\nb();\na();\n";
        let err = revert_patch(content, "z();", "a();").unwrap_err();
        assert_eq!(err, PatchError::Ambiguous(2));
    }

    // ── 全文护栏 ──

    #[test]
    fn guard_blocks_suspicious_shrink_on_large_file() {
        let old = (0..200)
            .map(|i| format!("line {}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let new = (0..80)
            .map(|i| format!("line {}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let why = full_write_guard(&old, &new).expect("must refuse");
        assert!(
            why.contains("old_text"),
            "must point to the anchored form: {}",
            why
        );
    }

    #[test]
    fn guard_allows_small_file_rewrite_and_modest_shrink() {
        let small_old = (0..40)
            .map(|i| format!("l{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(full_write_guard(&small_old, "one line").is_none());
        let old = (0..200)
            .map(|i| format!("l{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let new = (0..150)
            .map(|i| format!("l{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(full_write_guard(&old, &new).is_none());
    }

    #[test]
    fn guard_catches_placeholder_tail() {
        let old = (0..200)
            .map(|i| format!("l{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        let mut new = (0..190)
            .map(|i| format!("l{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        new.push_str("\n// ... 其余保持不变\n");
        let why = full_write_guard(&old, &new).expect("must refuse placeholder tail");
        assert!(why.contains("placeholder"));
    }

    // ── 回执与指纹 ──

    #[test]
    fn preview_marks_changed_lines_with_context() {
        let r = apply_patch(SRC, "    let x = 2;", "    let x = 22;", None).unwrap();
        let preview = patch_preview(&r.content, r.start_line, r.new_end_line);
        assert!(
            preview.contains(">    7 |     let x = 22;"),
            "preview: {}",
            preview
        );
        assert!(
            preview.contains("     6 | fn b() {"),
            "needs context: {}",
            preview
        );
    }

    #[test]
    fn content_hash_changes_with_content() {
        assert_eq!(content_hash("abc"), content_hash("abc"));
        assert_ne!(content_hash("abc"), content_hash("abd"));
        assert_eq!(content_hash("").len(), 16);
    }

    // ── 定位证据：让模型在一条回执里就能改对 ──

    const HINT_SRC: &str = "fn alpha() {\n    let v = 1;\n    return v;\n}\n\nfn beta() {\n    let v = 2;\n    return v;\n}\n";

    #[test]
    fn locate_hint_lists_every_occurrence_line() {
        // 歧义时模型真正缺的是「这 N 处分别在第几行」，不是一个数字
        let hint = locate_hint(HINT_SRC, "    return v;");
        assert!(
            hint.candidates.is_empty(),
            "found exactly — no candidates needed"
        );
        assert_eq!(hint.occurrences.len(), 2);
        assert_eq!(hint.occurrences[0].line_no, 3);
        assert_eq!(hint.occurrences[1].line_no, 8);
        assert_eq!(hint.occurrences[0].preview, "    return v;");
    }

    #[test]
    fn ambiguous_receipt_shows_line_numbers_and_occurrence_range() {
        let src = "a()\nb()\na()\nb()\na()\n";
        let err = apply_patch(src, "a()", "z()", None).unwrap_err();
        assert_eq!(err, PatchError::Ambiguous(3));
        let msg = err.message_with_hint("p.rs", &locate_hint(src, "a()"));
        assert!(msg.contains("line 1"), "must list line 1: {}", msg);
        assert!(msg.contains("line 3"), "must list line 3: {}", msg);
        assert!(msg.contains("line 5"), "must list line 5: {}", msg);
        assert!(
            msg.contains("1..3"),
            "must state the valid occurrence range: {}",
            msg
        );
    }

    #[test]
    fn not_found_receipt_points_at_the_closest_candidate() {
        // 锚点与第 3 行起的那段只差一个标识符：回执必须指出是第 3 行、差在第几个字符
        let hint = locate_hint(HINT_SRC, "    return z;\n}\n\nfn beta() {");
        assert!(hint.occurrences.is_empty());
        let best = hint.candidates.first().expect("must find a near miss");
        assert_eq!(best.line_no, 3, "closest window starts at line 3");
        assert_eq!(best.span, 4);
        assert_eq!(best.exact_lines, 3, "3 of 4 lines are identical");
        assert_eq!(
            best.diff_line, 1,
            "first difference is on the 1st snippet line"
        );
        assert_eq!(
            best.diff_col, 12,
            "'return v' vs 'return z' differ at col 12"
        );

        let msg = PatchError::NotFound.message_with_hint("src/a.rs", &hint);
        assert!(
            msg.contains("Nearest matches"),
            "must list candidates: {}",
            msg
        );
        assert!(
            msg.contains("file_read(file_path=\"src/a.rs\", start_line=1, end_line=8)"),
            "must give a copy-pasteable next call: {}",
            msg
        );
    }

    #[test]
    fn not_found_receipt_is_honest_when_nothing_is_close() {
        // 锚点与文件毫无共同点时不该硬凑候选——那比不给更误导
        let hint = locate_hint("fn a() {}\n", "completely unrelated snippet");
        assert!(hint.is_empty());
        let msg = PatchError::NotFound.message_with_hint("a.rs", &hint);
        assert!(
            !msg.contains("Nearest matches"),
            "no invented candidates: {}",
            msg
        );
    }

    #[test]
    fn locate_hint_matches_apply_patch_on_degraded_match() {
        // 口径必须与 apply_patch 二档一致：二档能中的锚点，证据也要报「命中」而不是「候选」
        let src = "fn a() {\r\n    let x = 1;   \r\n}\r\n";
        let r = apply_patch(src, "    let x = 1;\r\n", "    let x = 42;", None).unwrap();
        let hint = locate_hint(src, "    let x = 1;\r\n");
        assert!(r.approx, "this anchor goes through the degraded tier");
        assert_eq!(hint.occurrences.len(), 1, "hint must agree it was found");
        assert_eq!(hint.occurrences[0].line_no, r.start_line);
    }

    #[test]
    fn locate_hint_caps_how_many_occurrences_are_listed() {
        let src = "x\n".repeat(50);
        let hint = locate_hint(&src, "x");
        assert_eq!(hint.occurrences.len(), MAX_LISTED_OCCURRENCES);
        let msg = PatchError::Ambiguous(50).message_with_hint("a.rs", &hint);
        assert!(
            msg.contains("42 more"),
            "must say how many were omitted: {}",
            msg
        );
    }

    #[test]
    fn candidates_are_ranked_by_similarity() {
        let src = "AAA\nBBB\nCCC\nAAA\nXXX\nYYY\n";
        let hint = locate_hint(src, "AAA\nBBB\nQQQ");
        let lines: Vec<usize> = hint.candidates.iter().map(|c| c.line_no).collect();
        assert_eq!(
            lines,
            vec![1, 4],
            "higher-similarity window must come first: {:?}",
            hint.candidates
        );
        assert!(hint.candidates[0].score > hint.candidates[1].score);
    }

    #[test]
    fn message_without_hint_keeps_the_original_wording() {
        // 兜底路径必须完全等价于旧的 message()，否则没有证据的场景会退化
        let err = PatchError::NotFound;
        assert_eq!(
            err.message("a.rs"),
            err.message_with_hint("a.rs", &LocateHint::default())
        );
        let amb = PatchError::Ambiguous(2);
        assert_eq!(
            amb.message("a.rs"),
            amb.message_with_hint("a.rs", &LocateHint::default())
        );
    }

    #[test]
    fn truncate_chars_is_utf8_safe() {
        // 按字节截断会切在 UTF-8 字符中间直接 panic，这里锁死按字符截
        let s = "中文内容".repeat(50);
        let out = truncate_chars(&s, 10);
        assert_eq!(out.chars().count(), 11, "10 chars + ellipsis: {}", out);
        assert!(out.ends_with('…'));
        assert!(truncate_chars("short", 100) == "short");
    }

    #[test]
    fn indentation_difference_is_reported_at_column_one() {
        // 只差缩进的行必须被算作「接近」而不是丢弃——这是最高频的定位失败原因。
        // 用 0 缩进的文件配 4 缩进的锚点：原文里不存在该子串，走候选分支。
        // 两个函数体里各有一个 0 缩进的 `let x = 1;`，两者都是只差缩进的近邻。
        let src = "fn a() {\nlet x = 1;\n}\nfn b() {\nlet x = 1;\n}\n";
        let hint = locate_hint(src, "    let x = 1;");
        let best = hint
            .candidates
            .first()
            .expect("indent-only near miss must be kept");
        assert_eq!(best.line_no, 2);
        assert_eq!(best.exact_lines, 0);
        assert_eq!(best.indent_only_lines, 1);
        assert_eq!(best.diff_col, 1, "indent differs at the very first column");
        assert!(
            hint.candidates.len() >= 2,
            "both let-bindings are near misses"
        );

        let msg = PatchError::NotFound.message_with_hint("a.rs", &hint);
        assert!(
            msg.contains("differ only in indentation"),
            "must name the cause: {}",
            msg
        );
    }

    #[test]
    fn candidate_scan_is_bounded_on_huge_files() {
        // 20000 行以上只扫前 20000 行：定位证据是给模型的提示，不值得为它全文件扫描
        let huge = "let x = 1;\n".repeat(50_000);
        let hint = locate_hint(&huge, "let x = 2;\nlet x = 1;");
        assert!(hint
            .candidates
            .iter()
            .all(|c| c.line_no <= LOCATE_SCAN_MAX_LINES));
        assert!(!hint.candidates.is_empty());
    }
}
