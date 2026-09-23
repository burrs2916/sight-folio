//! 代码克隆（重复代码）检测命令
//!
//! 对应需求文档「新需求点发掘」：代码重复率是 SonarQube / PMD-CPD / jscpd 等
//! 前沿静态分析平台的一级质量指标，此前 sight-folio 完全缺失该维度 ——
//! 扫描能看到文件、符号、依赖、复杂度、技术债，却看不到「同一段逻辑被抄了几遍」，
//! 而这恰恰是重构收益最高、最容易量化的技术债来源。
//!
//! ## 算法：k-gram 指纹 + winnowing（Schleimer et al. 2003）
//!
//! 1. **归一化**：逐行剥离注释、压缩空白、丢弃过短的结构行（`}`、`);` 等），
//!    保留「归一化行 → 原始行号」映射，保证结果能精确定位回源码。
//! 2. **k-gram 哈希**：对归一化行序列开 K 行滑窗，FNV-1a 滚动哈希得到指纹序列。
//! 3. **winnowing**：在指纹序列上再开 W 宽度窗口，每窗只保留最小指纹。
//!    该策略保证「任意长度 ≥ K+W-1 的重复」必被捕获，同时显著降低指纹数量。
//! 4. **对角线合并**：同一指纹出现在两处 → 一个 seed；把 (fileA, fileB, 行差)
//!    相同的 seed 归到同一条「对角线」，对角线上连续/邻接的 seed 合并成极大克隆块。
//! 5. **分组**：对克隆块的归一化内容再取一次哈希作为 group_id，
//!    使「同一段代码出现 N 次」自然聚成一个 N 实例的克隆组（而非 N*(N-1)/2 个孤立对）。
//!
//! ## 噪声控制
//! - 指纹出现次数超过 MAX_HASH_OCCURRENCES 视为样板代码（如统一的 import 头），整体丢弃。
//! - 同文件内自重叠（行差 < K）的匹配丢弃。
//! - 克隆块有效行数 < MIN_CLONE_LINES 丢弃。

use crate::domain::project_code_clones::CodeClone;
use crate::error::AppResult;
use crate::infrastructure::database::project_code_clone_repository::ProjectCodeCloneRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::{
    SqliteProjectCodeCloneRepository, SqliteProjectFileRepository,
};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// k-gram 行数：连续 5 行构成一个指纹单元
const K_GRAM: usize = 5;
/// winnowing 窗口宽度
const WINNOW_W: usize = 4;
/// 克隆块最小有效行数（低于此值不算重复，避免噪声）
const MIN_CLONE_LINES: usize = 6;
/// Type-2 参数化克隆的最小有效行数（参数化后匹配面更广，阈值相应抬高防误报）
const MIN_CLONE_LINES_TYPE2: usize = 10;
/// 单个指纹的最大出现次数，超过视为样板代码
const MAX_HASH_OCCURRENCES: usize = 24;
/// 单文件最大行数，超大文件（生成物/压缩产物）跳过
const MAX_FILE_LINES: usize = 20000;
/// 归一化后行的最小长度，过短的结构行不参与比对
const MIN_NORMALIZED_LEN: usize = 8;
/// 输出克隆实例数量上限，防止极端项目撑爆数据库
const MAX_CLONE_ROWS: usize = 4000;

// ───────────────────────── 归一化 ─────────────────────────

/// 剥离行注释与行尾空白，压缩内部连续空白为单个空格
///
/// 说明：这是「近似」归一化，不做完整词法分析（字符串里的 `//` 会被误剥离）。
/// 对指纹比对而言，只要同一段源码被一致地归一化，就不影响重复判定。
fn normalize_line(raw: &str) -> String {
    let mut s = raw.trim();

    // 行注释：// … / # … / -- …（取最早出现的一个）
    let mut cut = s.len();
    for marker in ["//", "#", "--"] {
        if let Some(pos) = s.find(marker) {
            // 行首即注释，或前面不是紧贴的 URL 片段（简单判据：前一个字符不是 ':'）
            let is_url = pos > 0 && s.as_bytes()[pos - 1] == b':';
            if !is_url && pos < cut {
                cut = pos;
            }
        }
    }
    s = &s[..cut];

    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

/// 判断归一化行是否值得参与比对
fn is_meaningful(norm: &str) -> bool {
    if norm.len() < MIN_NORMALIZED_LEN {
        return false;
    }
    // 纯符号行（如 `});`、`} else {`）信息量低，要求至少含 3 个字母数字字符
    let alnum = norm.chars().filter(|c| c.is_alphanumeric()).count();
    alnum >= 3
}

// ───────────────────────── Type-2 参数化归一化 ─────────────────────────
//
// Type-1 克隆只剥离注释/空白，`foo = computeBar(x)` 与 `baz = computeQux(y)`
// 不会匹配。Type-2 克隆再做一层「标识符参数化」：把非关键字标识符按
// 首次出现顺序替换为占位符（$v0/$v1/…），同一标识符在文件内映射到同一
// 占位符 —— 于是变量改名、函数改名后的「复制粘贴改个名」也能被检出，
// 这正是 SonarQube / PMD-CPD 报告的 Type-2 克隆。

/// 常见语言关键字（参数化时保留原样，不做占位符替换）
const KEYWORDS: &[&str] = &[
    // TS/JS
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "class", "extends", "new",
    "import", "export", "from", "default", "try", "catch", "finally", "throw",
    "async", "await", "typeof", "instanceof", "in", "of", "this", "super",
    "interface", "type", "enum", "implements", "public", "private", "protected",
    "readonly", "static", "abstract", "get", "set", "yield", "delete", "void",
    "null", "undefined", "true", "false",
    // Rust
    "use", "mod", "pub", "fn", "struct", "enum", "trait", "impl", "let", "mut",
    "match", "ref", "move", "dyn", "where", "as", "unsafe", "extern", "crate",
    "self", "Self", "super", "loop", "while", "for", "if", "else", "return",
    "break", "continue", "const", "static", "type", "macro_rules",
    // Python
    "def", "class", "import", "from", "as", "if", "elif", "else", "for", "while",
    "return", "break", "continue", "pass", "raise", "try", "except", "finally",
    "with", "lambda", "yield", "global", "nonlocal", "assert", "del", "is",
    "not", "and", "or", "in", "None", "True", "False",
    // Go
    "package", "func", "var", "const", "struct", "interface", "map", "chan",
    "go", "defer", "select", "range", "goto", "fallthrough",
    // Java/C/C++ 公共
    "public", "protected", "private", "abstract", "final", "native", "synchronized",
    "transient", "volatile", "strictfp", "throw", "throws", "double", "float",
    "int", "long", "short", "byte", "char", "boolean", "signed", "unsigned",
    "sizeof", "typedef", "union", "auto", "register", "volatile", "static",
];

/// 判断字符是否属于标识符字符集
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// 把一行做 Type-2 参数化：非关键字标识符 → $v{n}（按首次出现顺序编号）
///
/// 同一标识符在文件内永远映射到同一个占位符（跨行一致的字典序由调用方维护）。
fn parameterize_line(
    line: &str,
    ident_map: &mut HashMap<String, usize>,
) -> String {
    let mut out = String::with_capacity(line.len() + 8);
    let mut chars = line.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_alphabetic() || c == '_' {
            // 读完整标识符
            let mut ident = String::new();
            while let Some(&ch) = chars.peek() {
                if is_ident_char(ch) {
                    ident.push(ch);
                    chars.next();
                } else {
                    break;
                }
            }
            if KEYWORDS.contains(&ident.as_str()) {
                out.push_str(&ident);
            } else {
                let next = ident_map.len();
                let idx = *ident_map.entry(ident.clone()).or_insert(next);
                out.push('$');
                out.push('v');
                out.push_str(&idx.to_string());
            }
        } else {
            out.push(c);
            chars.next();
        }
    }
    out
}

/// 整个文件做参数化：维护跨行一致的标识符 → 占位符映射
fn parameterize_file(lines: &[(String, i64)]) -> Vec<(String, i64)> {
    let mut ident_map: HashMap<String, usize> = HashMap::new();
    lines
        .iter()
        .map(|(norm, ln)| (parameterize_line(norm, &mut ident_map), *ln))
        .collect()
}

/// 归一化整个文件，返回 (归一化行, 原始行号 1 起始) 序列
fn normalize_file(content: &str) -> Vec<(String, i64)> {
    let mut out = Vec::new();
    let mut in_block_comment = false;

    for (idx, raw) in content.lines().enumerate() {
        if out.len() > MAX_FILE_LINES {
            break;
        }
        let mut line = raw.to_string();

        // 块注释状态机（/* … */）
        if in_block_comment {
            if let Some(end) = line.find("*/") {
                line = line[end + 2..].to_string();
                in_block_comment = false;
            } else {
                continue;
            }
        }
        loop {
            let start = match line.find("/*") {
                Some(p) => p,
                None => break,
            };
            match line[start..].find("*/") {
                Some(rel) => {
                    let end = start + rel + 2;
                    line = format!("{}{}", &line[..start], &line[end..]);
                }
                None => {
                    line = line[..start].to_string();
                    in_block_comment = true;
                    break;
                }
            }
        }

        let norm = normalize_line(&line);
        if is_meaningful(&norm) {
            out.push((norm, (idx + 1) as i64));
        }
    }
    out
}

// ───────────────────────── 指纹 ─────────────────────────

/// FNV-1a 64 位哈希
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// 对归一化行序列做 k-gram 哈希 + winnowing，返回 (指纹, 归一化序列下标) 列表
fn winnow(lines: &[(String, i64)]) -> Vec<(u64, usize)> {
    if lines.len() < K_GRAM {
        return Vec::new();
    }
    // 每行先各自哈希，k-gram 再对 K 个行哈希做组合哈希
    let line_hashes: Vec<u64> = lines.iter().map(|(s, _)| fnv1a(s.as_bytes())).collect();

    let gram_count = line_hashes.len() - K_GRAM + 1;
    let mut grams: Vec<u64> = Vec::with_capacity(gram_count);
    for i in 0..gram_count {
        let mut buf = [0u8; K_GRAM * 8];
        for j in 0..K_GRAM {
            buf[j * 8..(j + 1) * 8].copy_from_slice(&line_hashes[i + j].to_le_bytes());
        }
        grams.push(fnv1a(&buf));
    }

    // winnowing：宽度 W 的窗口内取最小指纹（相同最小值取最右，避免重复选取）
    if grams.len() <= WINNOW_W {
        // 序列太短，全量保留
        return grams.iter().enumerate().map(|(i, h)| (*h, i)).collect();
    }
    let mut picked: Vec<(u64, usize)> = Vec::new();
    let mut last_pick: Option<usize> = None;
    for start in 0..=(grams.len() - WINNOW_W) {
        let window = &grams[start..start + WINNOW_W];
        let mut min_idx = 0usize;
        for (i, v) in window.iter().enumerate() {
            if *v <= window[min_idx] {
                min_idx = i;
            }
        }
        let abs = start + min_idx;
        if last_pick != Some(abs) {
            picked.push((grams[abs], abs));
            last_pick = Some(abs);
        }
    }
    picked
}

// ───────────────────────── 匹配与合并 ─────────────────────────

/// 单个文件的归一化产物
struct FileFingerprint {
    file_id: String,
    file_path: String,
    language: String,
    /// Type-1 归一化行（注释/空白剥离）
    lines: Vec<(String, i64)>,
    /// Type-1 winnowing 指纹
    marks: Vec<(u64, usize)>,
    /// Type-2 参数化行（标识符 → $v{n}）
    lines_param: Vec<(String, i64)>,
    /// Type-2 winnowing 指纹
    marks_param: Vec<(u64, usize)>,
}

/// 一个克隆块（归一化下标区间）
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct Block {
    file_idx: usize,
    /// 归一化序列起始下标（含）
    start: usize,
    /// 归一化序列结束下标（含）
    end: usize,
}

/// 从指纹表构建克隆块集合（对角线合并）
///
/// `marks_by_file` 决定用哪套指纹（type1 → marks / type2 → marks_param），
/// `min_lines` 决定块的最小有效行数（type2 阈值更高防误报）。
fn build_blocks(
    marks_by_file: &[Vec<(u64, usize)>],
    min_lines: usize,
) -> Vec<Block> {
    // hash → 出现位置 (文件下标, 归一化下标)
    let mut index: HashMap<u64, Vec<(usize, usize)>> = HashMap::new();
    for (fi, mks) in marks_by_file.iter().enumerate() {
        for (h, pos) in mks {
            index.entry(*h).or_default().push((fi, *pos));
        }
    }

    // 对角线：(fileA, fileB, delta) → fileA 上的 seed 起点集合
    let mut diagonals: HashMap<(usize, usize, i64), Vec<usize>> = HashMap::new();

    for (_, locs) in index.iter() {
        if locs.len() < 2 || locs.len() > MAX_HASH_OCCURRENCES {
            continue;
        }
        for i in 0..locs.len() {
            for j in (i + 1)..locs.len() {
                let (fa, pa) = locs[i];
                let (fb, pb) = locs[j];
                let (fa, pa, fb, pb) = if (fa, pa) <= (fb, pb) {
                    (fa, pa, fb, pb)
                } else {
                    (fb, pb, fa, pa)
                };
                let delta = pb as i64 - pa as i64;
                // 同文件内自重叠丢弃
                if fa == fb && delta.unsigned_abs() < K_GRAM as u64 {
                    continue;
                }
                diagonals.entry((fa, fb, delta)).or_default().push(pa);
            }
        }
    }

    let mut blocks: Vec<Block> = Vec::new();
    for ((fa, fb, delta), mut starts) in diagonals {
        starts.sort_unstable();
        starts.dedup();

        // 对角线上连续/邻接（间隔 ≤ K）的 seed 合并成极大区间
        let mut run_start = starts[0];
        let mut run_end = starts[0];
        for &s in starts.iter().skip(1) {
            if s <= run_end + K_GRAM {
                run_end = s;
            } else {
                push_block_pair(&mut blocks, fa, fb, delta, run_start, run_end, min_lines);
                run_start = s;
                run_end = s;
            }
        }
        push_block_pair(&mut blocks, fa, fb, delta, run_start, run_end, min_lines);
    }
    blocks
}

/// 把一条对角线区间还原为两侧的克隆块
fn push_block_pair(
    blocks: &mut Vec<Block>,
    fa: usize,
    fb: usize,
    delta: i64,
    run_start: usize,
    run_end: usize,
    min_lines: usize,
) {
    // seed 是 k-gram 起点，区间实际覆盖到 run_end + K - 1
    let a_start = run_start;
    let a_end = run_end + K_GRAM - 1;
    if a_end + 1 - a_start < min_lines {
        return;
    }
    let b_start = (a_start as i64 + delta).max(0) as usize;
    let b_end = (a_end as i64 + delta).max(0) as usize;

    blocks.push(Block { file_idx: fa, start: a_start, end: a_end });
    blocks.push(Block { file_idx: fb, start: b_start, end: b_end });
}

/// 剔除被更大块完全包含的小块（同文件内）
fn drop_contained(mut blocks: Vec<Block>) -> Vec<Block> {
    blocks.sort_by(|a, b| {
        a.file_idx
            .cmp(&b.file_idx)
            .then(a.start.cmp(&b.start))
            .then(b.end.cmp(&a.end))
    });
    blocks.dedup();

    let mut kept: Vec<Block> = Vec::new();
    for b in blocks {
        let contained = kept.iter().any(|k| {
            k.file_idx == b.file_idx && k.start <= b.start && k.end >= b.end
        });
        if !contained {
            kept.push(b);
        }
    }
    kept
}

/// 核心：从已归一化的文件集合计算克隆实例
///
/// 抽成纯函数便于单测（不触碰数据库 / 文件系统）。
/// `clone_type` 决定用哪套归一化行（"type1" 用 lines / "type2" 用 lines_param），
/// 并写入产出的每条记录。
fn compute_clones_with(
    files: &[FileFingerprint],
    analysis_id: &str,
    clone_type: &str,
    min_lines: usize,
) -> Vec<CodeClone> {
    let is_param = clone_type == "type2";
    let marks_by_file: Vec<Vec<(u64, usize)>> = files
        .iter()
        .map(|f| {
            if is_param {
                f.marks_param.clone()
            } else {
                f.marks.clone()
            }
        })
        .collect();
    let blocks = drop_contained(build_blocks(&marks_by_file, min_lines));
    if blocks.is_empty() {
        return Vec::new();
    }

    // 以「归一化内容哈希」作为克隆组标识 → 同一段代码的 N 个实例自然聚成一组
    let mut groups: HashMap<u64, Vec<&Block>> = HashMap::new();
    for b in &blocks {
        let lines_slice = if is_param {
            files[b.file_idx].lines_param.as_slice()
        } else {
            files[b.file_idx].lines.as_slice()
        };
        let end = b.end.min(lines_slice.len().saturating_sub(1));
        if end < b.start {
            continue;
        }
        let joined: String = lines_slice[b.start..=end]
            .iter()
            .map(|(s, _)| s.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        groups.entry(fnv1a(joined.as_bytes())).or_default().push(b);
    }

    let now = chrono::Utc::now().timestamp();
    let mut out: Vec<CodeClone> = Vec::new();

    // 组按「重复行数 × 实例数」降序，保证截断时保留最有价值的克隆
    let mut ordered: Vec<(u64, Vec<&Block>)> = groups
        .into_iter()
        .filter(|(_, v)| v.len() >= 2)
        .collect();
    ordered.sort_by(|a, b| {
        let score = |v: &Vec<&Block>| {
            let span = v[0].end - v[0].start + 1;
            span * v.len()
        };
        score(&b.1).cmp(&score(&a.1))
    });

    for (ghash, members) in ordered {
        if out.len() >= MAX_CLONE_ROWS {
            break;
        }
        let group_id = format!(
            "cg_{:016x}{}",
            ghash,
            if is_param { "_p" } else { "" }
        );
        let group_size = members.len() as i64;

        for b in members {
            let f = &files[b.file_idx];
            let lines_slice = if is_param {
                f.lines_param.as_slice()
            } else {
                f.lines.as_slice()
            };
            let end = b.end.min(lines_slice.len().saturating_sub(1));
            if end < b.start {
                continue;
            }
            let start_line = lines_slice[b.start].1;
            let end_line = lines_slice[end].1;
            // 片段原文用原始归一化行（type2 也展示原文而非占位符，便于人读）
            let snippet: String = f.lines[b.start].0.chars().take(120).collect();

            out.push(CodeClone {
                id: format!("clone_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
                analysis_id: analysis_id.to_string(),
                group_id: group_id.clone(),
                file_id: f.file_id.clone(),
                file_path: f.file_path.clone(),
                start_line,
                end_line,
                line_count: (end - b.start + 1) as i64,
                group_size,
                snippet,
                language: f.language.clone(),
                clone_type: clone_type.to_string(),
                created_at: now,
            });
        }
    }
    out
}

/// 按 clone_type 过滤掉 Type-2 中与 Type-1 完全重叠的块（避免重复报告）。
/// 规则：同一文件、行区间被 Type-1 块覆盖的 Type-2 块丢弃。
fn dedup_type2_against_type1(
    type1: &[CodeClone],
    type2: Vec<CodeClone>,
) -> Vec<CodeClone> {
    if type1.is_empty() {
        return type2;
    }
    type2
        .into_iter()
        .filter(|c2| {
            let covered = type1.iter().any(|c1| {
                c1.file_path == c2.file_path
                    && c1.start_line <= c2.end_line
                    && c1.end_line >= c2.start_line
            });
            !covered
        })
        .collect()
}

/// 同时计算 Type-1（逐字）与 Type-2（参数化）克隆，Type-2 与 Type-1 去重
fn compute_clones_typed(files: &[FileFingerprint], analysis_id: &str) -> Vec<CodeClone> {
    let type1 = compute_clones_with(files, analysis_id, "type1", MIN_CLONE_LINES);
    let type2_raw = compute_clones_with(files, analysis_id, "type2", MIN_CLONE_LINES_TYPE2);
    let type2 = dedup_type2_against_type1(&type1, type2_raw);
    type1.into_iter().chain(type2).collect()
}

// ───────────────────────── Tauri 命令 ─────────────────────────

/// 主命令：检测项目中的重复代码，写入 project_code_clones
#[tauri::command(async)]
pub fn detect_code_clones(
    analysis_id: String,
    app: AppHandle,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    clone_repo: State<'_, Arc<SqliteProjectCodeCloneRepository>>,
    cancel: State<'_, crate::commands::project_scan::AnalysisCancelState>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<CodeClone>> {
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let total = files.iter().filter(|f| !f.is_directory).count() as i64;
    let mut done = 0i64;

    let mut prints: Vec<FileFingerprint> = Vec::new();
    for file in &files {
        if file.is_directory {
            continue;
        }
        done += 1;
        if crate::commands::project_scan::analysis_cancelled(&cancel, &analysis_id) {
            break;
        }
        if done % 200 == 0 {
            crate::commands::project_scan::emit_stage_progress(
                &app,
                crate::commands::project_scan::ScanStage::Clones,
                ((done as f64 / total.max(1) as f64) * 100.0) as i64,
                done,
                total,
                "检测重复代码…",
            );
        }
        // 只对识别出语言的源码文件做克隆检测
        let language = file.language.clone().unwrap_or_default();
        if language.is_empty() {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };
        let lines = normalize_file(&content);
        if lines.len() < K_GRAM {
            continue;
        }
        let marks = winnow(&lines);
        if marks.is_empty() {
            continue;
        }
        // Type-2：参数化归一化行 + 独立指纹（阈值更高，见 compute_clones_typed）
        let lines_param = parameterize_file(&lines);
        let marks_param = winnow(&lines_param);
        prints.push(FileFingerprint {
            file_id: file.id.clone(),
            file_path: file.rel_path.clone(),
            language,
            lines,
            marks,
            lines_param,
            marks_param,
        });
    }

    let clones = compute_clones_typed(&prints, &analysis_id);

    clone_repo.delete_by_analysis(&analysis_id)?;
    if !clones.is_empty() {
        clone_repo.save_batch(&clones)?;
    }
    Ok(clones)
}

/// 列出分析的全部克隆实例
#[tauri::command(async)]
pub fn list_code_clones(
    analysis_id: String,
    clone_repo: State<'_, Arc<SqliteProjectCodeCloneRepository>>,
) -> AppResult<Vec<CodeClone>> {
    clone_repo.list_by_analysis(&analysis_id)
}

// ───────────────────────── 单元测试 ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(id: &str, path: &str, content: &str) -> FileFingerprint {
        let lines = normalize_file(content);
        let marks = winnow(&lines);
        let lines_param = parameterize_file(&lines);
        let marks_param = winnow(&lines_param);
        FileFingerprint {
            file_id: id.to_string(),
            file_path: path.to_string(),
            language: "typescript".to_string(),
            lines,
            marks,
            lines_param,
            marks_param,
        }
    }

    /// 构造一段足够长、内容各异的「业务代码」
    fn payload(prefix: &str, n: usize) -> String {
        (0..n)
            .map(|i| format!("const {}Value{} = compute{}(input{}, options{});", prefix, i, i, i, i))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn normalize_strips_comments_and_short_lines() {
        let src = "  const a = veryLongIdentifier + 1; // 注释\n}\n/* 块注释\n还是注释 */\nlet bbbb = ccccccc;";
        let out = normalize_file(src);
        let texts: Vec<&str> = out.iter().map(|(s, _)| s.as_str()).collect();
        assert!(texts.iter().any(|t| t.starts_with("const a =")));
        assert!(texts.iter().all(|t| !t.contains("注释")));
        // `}` 太短被丢弃
        assert!(texts.iter().all(|t| *t != "}"));
        // 行号映射保留原始位置
        assert_eq!(out[0].1, 1);
    }

    #[test]
    fn detects_cross_file_duplicate_block() {
        let dup = payload("shared", 14);
        let a = format!("{}\n{}", payload("headA", 6), dup);
        let b = format!("{}\n{}", payload("headB", 3), dup);

        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];
        let clones = compute_clones_typed(&files, "an1");

        assert!(!clones.is_empty(), "应检测出跨文件重复");
        // 同一段重复代码的两个实例应共享 group_id
        let g = &clones[0].group_id;
        let same: Vec<_> = clones.iter().filter(|c| &c.group_id == g).collect();
        assert_eq!(same.len(), 2, "该克隆组应有 2 个实例");
        let paths: Vec<&str> = same.iter().map(|c| c.file_path.as_str()).collect();
        assert!(paths.contains(&"src/a.ts") && paths.contains(&"src/b.ts"));
        assert!(same[0].line_count >= MIN_CLONE_LINES as i64);
        assert_eq!(same[0].group_size, 2);
    }

    #[test]
    fn no_false_positive_on_distinct_files() {
        // 用「结构真正不同」的内容：行数不同 + 每行形状不同，参数化后也无法对齐
        let a: String = (0..20)
            .map(|i| format!("const alpha{} = compute{}(input{}, options{});", i, i, i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let b: String = (0..20)
            .map(|i| format!("fn beta{}() -> i64 {{ input{} + options{} + extra{} }}", i, i, i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];
        let clones = compute_clones_typed(&files, "an1");
        assert!(clones.is_empty(), "内容结构完全不同的文件不应报重复，实际: {:?}", clones.len());
    }

    #[test]
    fn short_duplicate_below_threshold_is_ignored() {
        // head 用结构不同的内容，避免 Type-2 把 head 也匹配上
        let dup = payload("tiny", 3); // 小于 K_GRAM
        let head_a: String = (0..12)
            .map(|i| format!("let a{} = filter(input{});", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let head_b: String = (0..12)
            .map(|i| format!("fn b{}() {{ let x = {}; }}", i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let files = vec![
            mk("f1", "src/a.ts", &format!("{}\n{}", head_a, dup)),
            mk("f2", "src/b.ts", &format!("{}\n{}", head_b, dup)),
        ];
        let clones = compute_clones_typed(&files, "an1");
        assert!(clones.is_empty(), "低于最小行数的重复应被忽略");
    }

    #[test]
    fn groups_three_instances_together() {
        let dup = payload("triple", 16);
        let files = vec![
            mk("f1", "src/a.ts", &format!("{}\n{}", payload("h1", 4), dup)),
            mk("f2", "src/b.ts", &format!("{}\n{}", payload("h2", 7), dup)),
            mk("f3", "src/c.ts", &format!("{}\n{}", payload("h3", 2), dup)),
        ];
        let clones = compute_clones_typed(&files, "an1");
        let g = &clones[0].group_id;
        let same: Vec<_> = clones.iter().filter(|c| &c.group_id == g).collect();
        assert_eq!(same.len(), 3, "三处相同代码应聚成一个 3 实例的克隆组");
        assert!(same.iter().all(|c| c.group_size == 3));
    }

    #[test]
    fn severity_scales_with_size_and_count() {
        use crate::domain::project_code_clones::clone_severity;
        assert_eq!(clone_severity(8, 2), "info");
        assert_eq!(clone_severity(30, 2), "warning");
        assert_eq!(clone_severity(10, 4), "warning");
        assert_eq!(clone_severity(80, 2), "critical");
        assert_eq!(clone_severity(10, 8), "critical");
    }

    // ── Type-2 参数化克隆（标识符重命名后的近重复）──

    /// 构造一段「同构」业务代码：每行形如
    /// `const <prefix>Value<i> = compute<i>(input<i>, options<i>);`
    /// 前缀不同 → Type-1 不匹配，但参数化后完全同构 → Type-2 应匹配。
    fn param_payload(prefix: &str, n: usize) -> String {
        (0..n)
            .map(|i| format!("const {}Value{} = compute{}(input{}, options{});", prefix, i, i, i, i))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn type2_detects_renamed_identifiers() {
        // 同一段逻辑，只是变量/函数名前缀不同（复制后批量改名的典型场景）
        let a = param_payload("alpha", 14);
        let b = param_payload("beta", 14);
        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];

        let clones = compute_clones_typed(&files, "an1");
        let params: Vec<CodeClone> = clones
            .iter()
            .filter(|c| c.clone_type == "type2")
            .cloned()
            .collect();
        assert!(
            !params.is_empty(),
            "Type-2 应检出重命名标识符后的重复，实际 type2 数: {}",
            params.len()
        );
        assert!(params.iter().all(|c| c.clone_type == "type2"));
        let paths: Vec<&str> = params.iter().map(|c| c.file_path.as_str()).collect();
        assert!(paths.contains(&"src/a.ts") && paths.contains(&"src/b.ts"));
    }

    #[test]
    fn type2_group_id_is_distinct_from_type1() {
        // Type-1 不会匹配改名后的代码，Type-2 会 —— group_id 必须区分开
        let a = param_payload("alpha", 14);
        let b = param_payload("beta", 14);
        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];
        let clones = compute_clones_typed(&files, "an1");

        let t1: Vec<_> = clones.iter().filter(|c| c.clone_type == "type1").collect();
        let t2: Vec<_> = clones.iter().filter(|c| c.clone_type == "type2").collect();
        assert!(t2.len() >= 2, "Type-2 至少应有 2 条实例");

        if let Some(t1g) = t1.first() {
            assert!(!t1g.group_id.ends_with("_p"));
        }
        assert!(t2[0].group_id.ends_with("_p"), "type2 group_id 应带 _p 后缀");
    }

    #[test]
    fn parameterize_line_maps_identifiers_consistently() {
        // 每个文件用独立 ident_map（parameterize_file 的真实行为）：
        // 两个文件各自的第一个标识符都映射到 $v0，从而参数化后完全一致
        let mut map_a = std::collections::HashMap::new();
        let mut map_b = std::collections::HashMap::new();
        let p1 = parameterize_line("const alphaValue0 = compute0(input0, options0);", &mut map_a);
        let p2 = parameterize_line("const betaValue0 = compute0(input0, options0);", &mut map_b);
        assert_eq!(p1, p2, "同构行参数化后应一致: {p1} vs {p2}");
        assert!(p1.contains("$v"), "参数化后应含占位符");
        assert!(p1.starts_with("const "), "关键字应保留");

        // 同一文件内：同一标识符复用 → 同一占位符（保持结构信息）
        let mut map_c = std::collections::HashMap::new();
        let l1 = parameterize_line("alphaValue0 = compute0(alphaValue0);", &mut map_c);
        let l2 = parameterize_line("alphaValue0 = compute0(input0);", &mut map_c);
        assert_ne!(l1, l2, "同一文件内标识符复用关系不同 → 参数化后应不同");
        // 复用版：alphaValue0 两次都映射 $v0 → 左右相同
        assert!(l1.starts_with("$v0 = $v1($v0);") || l1.contains("$v0)"), "l1={l1}");
    }

    #[test]
    fn type2_ignores_different_structure() {
        // 每行多一个参数 → 参数化后结构不同，不应误报 type2
        let a = param_payload("same", 14);
        let b = (0..14)
            .map(|i| format!("const sameValue{} = compute{}(input{}, options{}, extra{});", i, i, i, i, i))
            .collect::<Vec<_>>()
            .join("\n");
        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];
        let clones = compute_clones_typed(&files, "an1");
        let t2: Vec<_> = clones.iter().filter(|c| c.clone_type == "type2").collect();
        assert!(t2.is_empty(), "结构不同不应误报 type2，实际: {:?}", t2.len());
    }

    #[test]
    fn type2_is_deduped_against_type1() {
        // 完全相同的代码（Type-1 已覆盖），同一区间不应重复报 Type-2
        let dup = payload("shared", 14);
        let a = format!("{}\n{}", payload("headA", 6), dup);
        let b = format!("{}\n{}", payload("headB", 3), dup);
        let files = vec![mk("f1", "src/a.ts", &a), mk("f2", "src/b.ts", &b)];
        let clones = compute_clones_typed(&files, "an1");

        let mut t1_ranges = std::collections::HashSet::new();
        for c in clones.iter().filter(|c| c.clone_type == "type1") {
            t1_ranges.insert((c.file_path.clone(), c.start_line, c.end_line));
        }
        for c in clones.iter().filter(|c| c.clone_type == "type2") {
            let key = (c.file_path.clone(), c.start_line, c.end_line);
            assert!(!t1_ranges.contains(&key), "Type-2 不应覆盖 Type-1 已报告的区间");
        }
    }
}
