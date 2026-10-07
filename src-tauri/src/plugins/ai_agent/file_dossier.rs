// sight-folio: file_dossier —— 单个文件的跨维度档案
//
// 为什么需要它
// ------------
// 扫描把数据按**维度**组织：技术债一张表、克隆一张表、churn 一张表……
// 上下文包也按维度分节（每节 Top-15）。这在「找出全项目最该看的地方」时是对的。
//
// 但焦点巡查派单交给 Agent 的任务形状恰好相反：**「去看 src/hot.ts」**。
// 而被点名的文件几乎总是「每一维都排在十几二十名」的跨维度共振文件 ——
// 它在任何一个分节的 Top-15 里都查不到。于是 Agent 只剩两条路：
//   · 逐个数据集调 scan_records(action=query, path=...)：八九次工具调用，
//     每次都要先猜这维有没有数据，猜错就是一次空查询的纯浪费；
//   · 退回 file_read 读源码：token 爆炸，而且读到的是原始代码，
//     不是已经算好的分析结果 —— 等于把扫描的成果整个扔掉。
//
// 本模块补的就是这个**取数形状与任务形状的错配**：一次调用给出一个文件的全维度画像。
//
// 三条不能改的口径
// ----------------
// 1. **路径必须落到 project_files.rel_path 上**。Agent 会拿档案里的路径去写 refs，
//    表外路径会被落库守门当场拒收。所以档案只认真实文件：解析不出来就回候选，
//    绝不用模糊匹配拼出一份「看起来像那么回事」的档案。
// 2. **可用性判定与 scan_records 的目录同口径**（复用 DATASETS 的 always_runs /
//    empty_meaning）。两处口径漂移会出现「目录说 Git 是盲区、档案却说这个文件很稳定」
//    的自相矛盾，而 Agent 没有任何办法发现。
// 3. **「查过确实没有」与「压根没查」必须分开呈现**：前者进 clean（可据此下阴性结论），
//    后者进 blind（不得下任何结论）。把两者混成「无数据」是 AI 分析里最贵的错误 ——
//    它会让 Agent 一本正经地说「该文件没有隐性耦合」，而真相是这个项目没接 Git。

use rusqlite::Connection;
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::scan_records::find_dataset;
use crate::infrastructure::Database;

/// 每一维明细的取数上限。档案是**索引不是全文**：给够判断所需，
/// 想看全量再用 scan_records(action=query) 带过滤条件下钻。
const TOP: usize = 6;
/// 对端聚合类（扇入扇出、调用、依赖）可以多给几行 —— 它们每行只有一个路径加一个计数。
const PARTNER_TOP: usize = 8;
/// 单个文本字段回传上限。片段与消息动辄几百字符，定位只需要开头一截。
const TEXT_CAP: usize = 140;

fn clip(s: &str) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > TEXT_CAP {
        let cut: String = flat.chars().take(TEXT_CAP - 1).collect();
        format!("{}…", cut)
    } else {
        flat
    }
}

/// LIKE 通配符转义 —— 与 scan_records 同样的理由：路径里 `_` 极其频繁
/// （`__tests__`、`snake_case`），不转义会让命中集悄悄偏大。
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 档案锁定的那个文件
#[derive(Debug, Clone, PartialEq)]
pub struct DossierFile {
    pub id: String,
    pub rel_path: String,
    pub language: String,
    pub size: i64,
    pub lines: i64,
}

/// 路径解析结果。**多义时绝不替 Agent 猜**：猜错会让它把 A 文件的问题
/// 写到 B 文件的 refs 上，而这种错在界面上看起来完全正常。
#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    /// 唯一命中，附带命中方式（回给 Agent，让它知道自己给的路径准不准）
    One(DossierFile, &'static str),
    /// 多个候选（或一个都没有时的最近候选）
    Ambiguous(Vec<DossierFile>),
}

/// 归一化 Agent 给的路径：反斜杠、`./` 前缀、以及从 refs 里原样粘过来的 `:行号`。
///
/// 最后一条是真实高频场景：洞察的 refs 格式就是 `文件:行号`，
/// Agent 顺手复制过来天经地义 —— 为此报一次「文件不存在」纯属自找麻烦。
pub fn normalize_path_input(raw: &str) -> String {
    let s = raw.trim().replace('\\', "/");
    let s = s.strip_prefix("./").unwrap_or(&s).to_string();
    // 去掉结尾的 `:123`（Windows 盘符 `C:` 后面不是纯数字，不会被误伤）
    if let Some(i) = s.rfind(':') {
        let tail = &s[i + 1..];
        if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit()) {
            return s[..i].trim_end_matches('/').to_string();
        }
    }
    s.trim_end_matches('/').to_string()
}

fn basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

const FILE_COLS: &str =
    "id, rel_path, COALESCE(language, ''), size, line_count FROM project_files \
     WHERE analysis_id = ?1 AND is_directory = 0 AND ";

fn fetch_files(conn: &Connection, tail: &str, binds: &[String]) -> Vec<DossierFile> {
    let sql = format!("SELECT {}{}", FILE_COLS, tail);
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
        Ok(DossierFile {
            id: r.get(0)?,
            rel_path: r.get(1)?,
            language: r.get(2)?,
            size: r.get(3)?,
            lines: r.get(4)?,
        })
    }) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok()).collect()
}

/// 四级解析，与洞察落库守门的 `nearest()` 同一套哲学：
/// 精确 → 路径后缀 → 同名文件 → 子串包含。**先命中的一级说了算**，
/// 不把四级结果混在一起打分 —— 精确匹配存在时，任何模糊候选都是噪声。
pub fn resolve_file(conn: &Connection, analysis_id: &str, raw: &str) -> Resolution {
    let input = normalize_path_input(raw);
    let aid = analysis_id.to_string();

    let exact = fetch_files(conn, "rel_path = ?2", &[aid.clone(), input.clone()]);
    if !exact.is_empty() {
        return if exact.len() == 1 {
            Resolution::One(exact.into_iter().next().unwrap(), "exact")
        } else {
            Resolution::Ambiguous(exact)
        };
    }

    let suffix = fetch_files(
        conn,
        "rel_path LIKE ?2 ESCAPE '\\' ORDER BY LENGTH(rel_path) ASC LIMIT 12",
        &[aid.clone(), format!("%/{}", escape_like(&input))],
    );
    if !suffix.is_empty() {
        return if suffix.len() == 1 {
            Resolution::One(suffix.into_iter().next().unwrap(), "suffix")
        } else {
            Resolution::Ambiguous(suffix)
        };
    }

    let by_name = fetch_files(
        conn,
        "name = ?2 ORDER BY LENGTH(rel_path) ASC LIMIT 12",
        &[aid.clone(), basename(&input).to_string()],
    );
    if !by_name.is_empty() {
        return if by_name.len() == 1 {
            Resolution::One(by_name.into_iter().next().unwrap(), "basename")
        } else {
            Resolution::Ambiguous(by_name)
        };
    }

    let contains = fetch_files(
        conn,
        "rel_path LIKE ?2 ESCAPE '\\' ORDER BY LENGTH(rel_path) ASC LIMIT 12",
        &[aid.clone(), format!("%{}%", escape_like(&input))],
    );
    if contains.len() == 1 {
        return Resolution::One(contains.into_iter().next().unwrap(), "contains");
    }
    if !contains.is_empty() {
        return Resolution::Ambiguous(contains);
    }

    // 一个都没有：退回「同 stem」的最近候选，让 Agent 有据可改而不是干瞪眼
    let stem = basename(&input).split('.').next().unwrap_or("").to_string();
    if stem.len() >= 3 {
        return Resolution::Ambiguous(fetch_files(
            conn,
            "name LIKE ?2 ESCAPE '\\' ORDER BY LENGTH(rel_path) ASC LIMIT 8",
            &[aid, format!("%{}%", escape_like(&stem))],
        ));
    }
    Resolution::Ambiguous(Vec::new())
}

// ─── 维度可用性：与 scan_records 的数据集目录同口径 ───

/// 一个档案维度的元信息。共享维度**一律从 DATASETS 取**，绝不在这里另抄一份：
/// 口径一旦分家，就会出现「目录说 Git 没跑、档案却给这个文件下了稳定性结论」。
struct Dim {
    key: &'static str,
    table: &'static str,
    /// 该维度是否每次扫描都会跑。决定 0 行到底能不能读成「没问题」。
    always_runs: bool,
    empty_meaning: &'static str,
}

/// 不在下钻数据集里的三个维度（它们各有更贴合的专用工具，故未进 DATASETS）。
const LOCAL_DIMS: &[(&str, &str, bool, &str)] = &[
    (
        "review",
        "review_findings",
        true,
        "审查阶段每次扫描都会跑，0 条说明本次没有命中任何规则",
    ),
    (
        "symbols",
        "project_symbols",
        false,
        "符号提取依赖语言分析器支持，未支持的语言为空 —— 不得据此断定「这个文件没有定义任何东西」",
    ),
    (
        "deps",
        "project_dependencies",
        false,
        "依赖边解析依赖语言分析器支持 —— 不得据此断定「这个文件没有依赖关系」",
    ),
];

fn dim_of(key: &'static str) -> Dim {
    if let Some(s) = find_dataset(key) {
        return Dim {
            key,
            table: s.table,
            always_runs: s.always_runs,
            empty_meaning: s.empty_meaning,
        };
    }
    let (table, always_runs, empty_meaning) = LOCAL_DIMS
        .iter()
        .find(|(k, ..)| *k == key)
        .map(|(_, t, a, e)| (*t, *a, *e))
        .unwrap_or(("", true, ""));
    Dim {
        key,
        table,
        always_runs,
        empty_meaning,
    }
}

/// 该维度在**本次扫描全局**有多少行。None 表示查询失败（表缺失/库损坏）——
/// 与「确实 0 行」必须分开，都压成 0 会把一次读取故障读成「这个维度很干净」。
fn dim_total(conn: &Connection, dim: &Dim, analysis_id: &str) -> Option<i64> {
    if dim.table.is_empty() {
        return None;
    }
    let sql = format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1", dim.table);
    conn.query_row(&sql, rusqlite::params![analysis_id], |r| r.get(0))
        .ok()
}

/// 一维的归宿：有数据 / 查过确实没有 / 压根没查。
enum Outcome {
    Data(Value),
    /// 跑过、本文件无记录 —— 可据此下阴性结论。附该维度全局行数作为佐证。
    Clean(i64),
    Blind(String),
}

/// 收集器：把三种归宿分流到档案的三个区，顺带保证每一维只被判定一次。
struct Bag {
    findings: Map<String, Value>,
    clean: Vec<Value>,
    blind: Vec<Value>,
}

impl Bag {
    fn new() -> Self {
        Self {
            findings: Map::new(),
            clean: Vec::new(),
            blind: Vec::new(),
        }
    }

    fn put(&mut self, key: &str, outcome: Outcome) {
        match outcome {
            Outcome::Data(v) => {
                self.findings.insert(key.to_string(), v);
            }
            Outcome::Clean(total) => self.clean.push(json!({ "dim": key, "dimRows": total })),
            Outcome::Blind(why) => self.blind.push(json!({ "dim": key, "why": why })),
        }
    }
}

/// 统一的三态判定。所有维度都必须走它，不许某一维自己拍脑袋。
fn classify(
    dim: &Dim,
    total: Option<i64>,
    file_rows: i64,
    data: impl FnOnce() -> Value,
) -> Outcome {
    match total {
        None => Outcome::Blind(format!(
            "维度 `{}` 读取失败（表可能尚未建立），行数未知 —— 不得据此下任何结论",
            dim.key
        )),
        // 全局 0 行且该维度不保证执行 → 是「没跑」不是「没问题」
        Some(0) if !dim.always_runs => Outcome::Blind(dim.empty_meaning.to_string()),
        Some(t) if file_rows == 0 => Outcome::Clean(t),
        Some(_) => Outcome::Data(data()),
    }
}

fn count_rows(conn: &Connection, sql: &str, binds: &[&str]) -> i64 {
    conn.query_row(sql, rusqlite::params_from_iter(binds.iter()), |r| r.get(0))
        .unwrap_or(0)
}

/// 取一批行并映射成紧凑 JSON。查询失败返回空 —— 调用方已经先用
/// count 判过「有没有」，这里的空只可能是并发下的边界，不影响结论口径。
fn map_rows<F>(conn: &Connection, sql: &str, binds: &[&str], f: F) -> Vec<Value>
where
    F: Fn(&rusqlite::Row<'_>) -> rusqlite::Result<Value>,
{
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| f(r)) else {
        return Vec::new();
    };
    rows.filter_map(|r| r.ok()).collect()
}

// ─── 各维度取数 ───

fn add_metrics(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("metrics");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_file_metrics WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            // 同一路径可能有多行（不同引擎/重复入库），取圈复杂度最大的那行。
            // 与风险交叉「同路径取最大不累加」同口径，两处给出的复杂度必须一致。
            let rows = map_rows(
                conn,
                "SELECT total_lines, code_lines, comment_lines, cyclomatic_complexity, \
                        complexity_level, max_nesting, function_count, max_function_cc, \
                        hot_function, magic_number_count, engine \
                 FROM project_file_metrics WHERE analysis_id = ?1 AND file_path = ?2 \
                 ORDER BY cyclomatic_complexity DESC LIMIT 1",
                &[aid, path],
                |r| {
                    Ok(json!({
                        "lines": r.get::<_, i64>(0)?,
                        "code": r.get::<_, i64>(1)?,
                        "comment": r.get::<_, i64>(2)?,
                        "cc": r.get::<_, i64>(3)?,
                        "level": r.get::<_, String>(4)?,
                        "nesting": r.get::<_, i64>(5)?,
                        "fns": r.get::<_, i64>(6)?,
                        "maxFnCc": r.get::<_, i64>(7)?,
                        "hotFn": r.get::<_, String>(8)?,
                        "magic": r.get::<_, i64>(9)?,
                        "engine": r.get::<_, String>(10)?,
                    }))
                },
            );
            rows.into_iter().next().unwrap_or(Value::Null)
        }),
    );
}

fn add_review(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("review");
    let total = dim_total(conn, &dim, aid);
    // review_findings.target_id 存的是 project_files.id，必须 JOIN 才拿得到路径。
    // COALESCE 兜底非文件目标（模块/符号级发现），否则它们会整批消失。
    const WHERE: &str = "FROM review_findings f LEFT JOIN project_files pf ON pf.id = f.target_id \
                         WHERE f.analysis_id = ?1 AND COALESCE(pf.rel_path, f.target_id) = ?2 \
                         AND f.status = 'open'";
    let n = count_rows(conn, &format!("SELECT COUNT(*) {}", WHERE), &[aid, path]);
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            let by_sev = map_rows(
                conn,
                &format!("SELECT f.severity, COUNT(*) {} GROUP BY f.severity", WHERE),
                &[aid, path],
                |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])),
            );
            let mut sev = Map::new();
            for pair in by_sev {
                if let Some(a) = pair.as_array() {
                    if let (Some(k), Some(v)) = (a.first().and_then(|x| x.as_str()), a.get(1)) {
                        sev.insert(k.to_string(), v.clone());
                    }
                }
            }
            let top = map_rows(
                conn,
                &format!(
                    "SELECT f.severity, COALESCE(r.name, f.rule_id, '(unknown)'), f.message, COALESCE(f.suggestion, '') \
                     FROM review_findings f \
                     LEFT JOIN review_rules r ON r.id = f.rule_id \
                     LEFT JOIN project_files pf ON pf.id = f.target_id \
                     WHERE f.analysis_id = ?1 AND COALESCE(pf.rel_path, f.target_id) = ?2 AND f.status = 'open' \
                     ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END \
                     LIMIT {}",
                    TOP
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "sev": r.get::<_, String>(0)?,
                        "rule": r.get::<_, String>(1)?,
                        "msg": clip(&r.get::<_, String>(2)?),
                        "fix": clip(&r.get::<_, String>(3)?),
                    }))
                },
            );
            json!({
                "open": n,
                "bySeverity": Value::Object(sev),
                "top": top,
                "more": "review_explain(action=\"findings\", severity=...) 看全部与规则说明",
            })
        }),
    );
}

fn add_tech_debt(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("techDebt");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_tech_debt WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            let top = map_rows(
                conn,
                &format!(
                    "SELECT line_no, marker, severity, snippet FROM project_tech_debt \
                     WHERE analysis_id = ?1 AND file_path = ?2 \
                     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, line_no \
                     LIMIT {}",
                    TOP
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "line": r.get::<_, i64>(0)?,
                        "marker": r.get::<_, String>(1)?,
                        "sev": r.get::<_, String>(2)?,
                        "text": clip(&r.get::<_, String>(3)?),
                    }))
                },
            );
            json!({ "count": n, "top": top })
        }),
    );
}

fn add_clones(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("clones");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_code_clones WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            let blocks = map_rows(
                conn,
                &format!(
                    "SELECT group_id, start_line, end_line, line_count, group_size, clone_type \
                     FROM project_code_clones WHERE analysis_id = ?1 AND file_path = ?2 \
                     ORDER BY line_count DESC LIMIT {}",
                    TOP.min(4)
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "group": r.get::<_, String>(0)?,
                        "start": r.get::<_, i64>(1)?,
                        "end": r.get::<_, i64>(2)?,
                        "lines": r.get::<_, i64>(3)?,
                        "copies": r.get::<_, i64>(4)?,
                        "type": r.get::<_, String>(5)?,
                    }))
                },
            );
            // 「跟谁重复」才是这一维的可执行信息；只说「有 3 处克隆」等于没说。
            let enriched: Vec<Value> = blocks
                .into_iter()
                .map(|mut b| {
                    let gid = b["group"].as_str().unwrap_or("").to_string();
                    let partners = map_rows(
                        conn,
                        "SELECT DISTINCT file_path FROM project_code_clones \
                         WHERE analysis_id = ?1 AND group_id = ?2 AND file_path <> ?3 LIMIT 3",
                        &[aid, &gid, path],
                        |r| Ok(json!(r.get::<_, String>(0)?)),
                    );
                    if let Some(o) = b.as_object_mut() {
                        o.insert("with".into(), json!(partners));
                    }
                    b
                })
                .collect();
            json!({ "count": n, "blocks": enriched })
        }),
    );
}

fn add_churn(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("churn");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_git_churn WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            map_rows(
                conn,
                "SELECT commit_count, added_lines, deleted_lines, author_count, churn_score, hotspot_level \
                 FROM project_git_churn WHERE analysis_id = ?1 AND file_path = ?2 LIMIT 1",
                &[aid, path],
                |r| {
                    Ok(json!({
                        "commits": r.get::<_, i64>(0)?,
                        "added": r.get::<_, i64>(1)?,
                        "deleted": r.get::<_, i64>(2)?,
                        "authors": r.get::<_, i64>(3)?,
                        "score": r.get::<_, f64>(4)?,
                        "level": r.get::<_, String>(5)?,
                    }))
                },
            )
            .into_iter()
            .next()
            .unwrap_or(Value::Null)
        }),
    );
}

fn add_coupling(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("changeCoupling");
    let total = dim_total(conn, &dim, aid);
    const WHERE: &str = "FROM project_change_coupling WHERE analysis_id = ?1 \
                         AND (file_a_path = ?2 OR file_b_path = ?2)";
    let n = count_rows(conn, &format!("SELECT COUNT(*) {}", WHERE), &[aid, path]);
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            // a/b 是无向对。不归一成「对端」的话，Agent 得自己逐行判断
            // 「这一行里哪个是我」—— 一个纯粹由存储形状造成的、毫无价值的推理负担。
            let top = map_rows(
                conn,
                &format!(
                    "SELECT CASE WHEN file_a_path = ?2 THEN file_b_path ELSE file_a_path END, \
                            co_changes, degree, jaccard, coupling_kind, risk_level, cross_module \
                     {} ORDER BY degree DESC, co_changes DESC LIMIT {}",
                    WHERE, TOP
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "with": r.get::<_, String>(0)?,
                        "coChanges": r.get::<_, i64>(1)?,
                        "degree": r.get::<_, f64>(2)?,
                        "jaccard": r.get::<_, f64>(3)?,
                        "kind": r.get::<_, String>(4)?,
                        "risk": r.get::<_, String>(5)?,
                        "crossModule": r.get::<_, i64>(6)? != 0,
                    }))
                },
            );
            json!({
                "count": n,
                "top": top,
                "note": "kind=logical 表示没有静态依赖却总是同改——隐性耦合，最值得追",
            })
        }),
    );
}

fn add_symbol_refs(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("symbolRefs");
    let total = dim_total(conn, &dim, aid);
    // 方向就是这一维的全部意义：谁在用我（扇入 = 改动的爆炸半径）
    // vs 我在用谁（扇出 = 我的依赖面）。混在一起等于把数据毁掉。
    // 自引用一律排除，与风险交叉的扇入口径一致。
    const IN_W: &str = "FROM project_symbol_refs WHERE analysis_id = ?1 \
                        AND to_file_path = ?2 AND from_file_path <> ?2";
    const OUT_W: &str = "FROM project_symbol_refs WHERE analysis_id = ?1 \
                         AND from_file_path = ?2 AND to_file_path <> ?2";
    let n_in = count_rows(conn, &format!("SELECT COUNT(*) {}", IN_W), &[aid, path]);
    let n_out = count_rows(conn, &format!("SELECT COUNT(*) {}", OUT_W), &[aid, path]);
    bag.put(
        dim.key,
        classify(&dim, total, n_in + n_out, || {
            let callers = map_rows(
                conn,
                &format!(
                    "SELECT from_file_path, COUNT(*) c {} GROUP BY from_file_path ORDER BY c DESC LIMIT {}",
                    IN_W, PARTNER_TOP
                ),
                &[aid, path],
                |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])),
            );
            let uses = map_rows(
                conn,
                &format!(
                    "SELECT to_file_path, COUNT(*) c {} GROUP BY to_file_path ORDER BY c DESC LIMIT {}",
                    OUT_W, PARTNER_TOP
                ),
                &[aid, path],
                |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])),
            );
            let distinct_in = count_rows(
                conn,
                &format!("SELECT COUNT(DISTINCT from_file_path) {}", IN_W),
                &[aid, path],
            );
            json!({
                "fanInFiles": distinct_in,
                "fanInRefs": n_in,
                "fanOutRefs": n_out,
                "referencedBy": callers,
                "references": uses,
                "note": "referencedBy/references 每项为 [对端文件, 引用次数]；fanInFiles 是去重后的引用方文件数（改动爆炸半径）",
            })
        }),
    );
}

fn add_call_edges(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("callEdges");
    let total = dim_total(conn, &dim, aid);
    const OUT_W: &str = "FROM project_call_edges WHERE analysis_id = ?1 \
                         AND caller_file_path = ?2 AND callee_file_path <> ?2 AND callee_file_path <> ''";
    const IN_W: &str = "FROM project_call_edges WHERE analysis_id = ?1 \
                        AND callee_file_path = ?2 AND caller_file_path <> ?2";
    let n_out = count_rows(conn, &format!("SELECT COUNT(*) {}", OUT_W), &[aid, path]);
    let n_in = count_rows(conn, &format!("SELECT COUNT(*) {}", IN_W), &[aid, path]);
    let internal = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_call_edges WHERE analysis_id = ?1 \
         AND caller_file_path = ?2 AND callee_file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n_out + n_in + internal, || {
            let outgoing = map_rows(
                conn,
                &format!(
                    "SELECT callee_file_path, COUNT(*) c {} GROUP BY callee_file_path ORDER BY c DESC LIMIT {}",
                    OUT_W, PARTNER_TOP
                ),
                &[aid, path],
                |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])),
            );
            let incoming = map_rows(
                conn,
                &format!(
                    "SELECT caller_file_path, COUNT(*) c {} GROUP BY caller_file_path ORDER BY c DESC LIMIT {}",
                    IN_W, PARTNER_TOP
                ),
                &[aid, path],
                |r| Ok(json!([r.get::<_, String>(0)?, r.get::<_, i64>(1)?])),
            );
            json!({
                "internal": internal,
                "outgoing": outgoing,
                "incoming": incoming,
                "note": "internal 是文件内部的调用条数；outgoing/incoming 每项为 [对端文件, 调用条数]",
            })
        }),
    );
}

fn add_deps(bag: &mut Bag, conn: &Connection, aid: &str, file_id: &str) {
    let dim = dim_of("deps");
    let total = dim_total(conn, &dim, aid);
    // project_dependencies 存的是 file **id**，必须 JOIN 才能给出 Agent 可用的路径。
    // 只取文件级边（模块级边属于架构视角，不是单文件档案该回答的问题）。
    const OUT_W: &str = "FROM project_dependencies d JOIN project_files pf ON pf.id = d.to_id \
                         WHERE d.analysis_id = ?1 AND d.from_id = ?2 \
                         AND d.from_type = 'file' AND d.to_type = 'file'";
    const IN_W: &str = "FROM project_dependencies d JOIN project_files pf ON pf.id = d.from_id \
                        WHERE d.analysis_id = ?1 AND d.to_id = ?2 \
                        AND d.from_type = 'file' AND d.to_type = 'file'";
    let n_out = count_rows(conn, &format!("SELECT COUNT(*) {}", OUT_W), &[aid, file_id]);
    let n_in = count_rows(conn, &format!("SELECT COUNT(*) {}", IN_W), &[aid, file_id]);
    bag.put(
        dim.key,
        classify(&dim, total, n_out + n_in, || {
            let imports = map_rows(
                conn,
                &format!(
                    "SELECT pf.rel_path, d.kind, d.is_circular {} ORDER BY d.is_circular DESC, pf.rel_path LIMIT {}",
                    OUT_W, PARTNER_TOP
                ),
                &[aid, file_id],
                |r| {
                    let circular: i64 = r.get(2)?;
                    Ok(json!({ "path": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "circular": circular != 0 }))
                },
            );
            let imported_by = map_rows(
                conn,
                &format!(
                    "SELECT pf.rel_path, d.kind, d.is_circular {} ORDER BY d.is_circular DESC, pf.rel_path LIMIT {}",
                    IN_W, PARTNER_TOP
                ),
                &[aid, file_id],
                |r| {
                    let circular: i64 = r.get(2)?;
                    Ok(json!({ "path": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?, "circular": circular != 0 }))
                },
            );
            json!({
                "importsCount": n_out,
                "importedByCount": n_in,
                "imports": imports,
                "importedBy": imported_by,
            })
        }),
    );
}

fn add_symbols(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("symbols");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_symbols WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            // 按跨度排序：最长的函数/类就是这个文件的主体，也是重构最先动的地方
            let top = map_rows(
                conn,
                &format!(
                    "SELECT name, kind, line_start, line_end FROM project_symbols \
                     WHERE analysis_id = ?1 AND file_path = ?2 \
                     ORDER BY (line_end - line_start) DESC LIMIT {}",
                    PARTNER_TOP
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "name": r.get::<_, String>(0)?,
                        "kind": r.get::<_, String>(1)?,
                        "line": r.get::<_, i64>(2)?,
                        "span": r.get::<_, i64>(3)? - r.get::<_, i64>(2)?,
                    }))
                },
            );
            json!({ "count": n, "largest": top })
        }),
    );
}

fn add_data_flow(bag: &mut Bag, conn: &Connection, aid: &str, path: &str) {
    let dim = dim_of("dataFlow");
    let total = dim_total(conn, &dim, aid);
    let n = count_rows(
        conn,
        "SELECT COUNT(*) FROM project_data_flow WHERE analysis_id = ?1 AND file_path = ?2",
        &[aid, path],
    );
    bag.put(
        dim.key,
        classify(&dim, total, n, || {
            let top = map_rows(
                conn,
                &format!(
                    "SELECT function_name, line_no, param_to_return, sinks FROM project_data_flow \
                     WHERE analysis_id = ?1 AND file_path = ?2 \
                     ORDER BY (CASE WHEN sinks <> '[]' THEN 0 ELSE 1 END), propagates DESC, line_no LIMIT {}",
                    TOP.min(4)
                ),
                &[aid, path],
                |r| {
                    Ok(json!({
                        "fn": r.get::<_, String>(0)?,
                        "line": r.get::<_, i64>(1)?,
                        "paramToReturn": clip(&r.get::<_, String>(2)?),
                        "sinks": clip(&r.get::<_, String>(3)?),
                    }))
                },
            );
            json!({ "count": n, "top": top })
        }),
    );
}

/// 该文件已经有过哪些 AI 结论。
///
/// 这一段是档案里**最直接省 token 的部分**：没有它，Agent 每一轮都会把
/// 同一个问题重新想一遍、重新写一条，去重只能靠落库时的指纹兜底 ——
/// 而那时 token 已经烧掉了。
fn ai_insights(conn: &Connection, aid: &str, path: &str) -> Value {
    let pattern = format!("%{}%", escape_like(path));
    let rows = map_rows(
        conn,
        "SELECT id, kind, severity, title, COALESCE(seen_count, 1), COALESCE(status, 'open') \
         FROM ai_insights \
         WHERE analysis_id = ?1 AND COALESCE(status, 'open') = 'open' AND refs LIKE ?2 ESCAPE '\\' \
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, \
                  COALESCE(last_seen, 0) DESC \
         LIMIT 8",
        &[aid, &pattern],
        |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "kind": r.get::<_, String>(1)?,
                "sev": r.get::<_, String>(2)?,
                "title": clip(&r.get::<_, String>(3)?),
                "seen": r.get::<_, i64>(4)?,
            }))
        },
    );
    if rows.is_empty() {
        return json!({
            "count": 0,
            "note": "该文件尚无未关闭的 AI 结论 —— 这一轮的结论是新的，值得写回",
        });
    }
    json!({
        "count": rows.len(),
        "items": rows,
        "note": "这些结论已经沉淀过了。不要重复保存同样的判断：要么给出新角度，\
                 要么核实后用 context_insight(action=\"resolve\") 收口。",
    })
}

// ─── 入口 ───

fn candidates_payload(input: &str, list: &[DossierFile]) -> Value {
    let items: Vec<Value> = list
        .iter()
        .map(|f| json!({ "path": f.rel_path, "lang": f.language, "lines": f.lines }))
        .collect();
    let hint = if items.is_empty() {
        format!(
            "No scanned file matches `{}`. This dossier only accepts paths that exist in THIS scan — \
             a made-up path would produce a dossier about nothing. Use scan_records(action=\"query\", \
             dataset=\"files\", path=\"<part of the name>\") to find the real path first.",
            input
        )
    } else {
        format!(
            "`{}` matches {} scanned files. Pick the exact `path` from candidates and call again — \
             guessing on your behalf would attach one file's problems to another file's refs.",
            input,
            items.len()
        )
    };
    json!({ "resolved": false, "input": input, "candidates": items, "hint": hint })
}

/// 组装一个文件的跨维度档案。
///
/// 一次调用替代八九次逐维查询，并且替 Agent 做掉三件它自己做不好的事：
///   · 方向归一（谁调我 / 我调谁、跟谁重复、跟谁同改）——存储形状不该由模型来消化；
///   · 三态区分（有数据 / 查过没有 / 压根没查）——这是它最容易出致命错误的地方；
///   · 带出已有结论——否则每轮都会把同一个问题重新想一遍再重新写一条。
pub fn build_dossier(
    db: &Arc<Database>,
    analysis_id: &str,
    params: &Value,
) -> Result<Value, String> {
    let raw = params["path"]
        .as_str()
        .or_else(|| params["file_path"].as_str())
        .or_else(|| params["file"].as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "path is required for action=dossier — give the file you want a full cross-dimension \
             profile of (e.g. the focus target you were asked to patrol)."
                .to_string()
        })?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (f, how) = match resolve_file(&conn, analysis_id, raw) {
        Resolution::One(f, how) => (f, how),
        Resolution::Ambiguous(list) => return Ok(candidates_payload(raw, &list)),
    };

    let path = f.rel_path.clone();
    let mut bag = Bag::new();
    add_metrics(&mut bag, &conn, analysis_id, &path);
    add_review(&mut bag, &conn, analysis_id, &path);
    add_tech_debt(&mut bag, &conn, analysis_id, &path);
    add_clones(&mut bag, &conn, analysis_id, &path);
    add_churn(&mut bag, &conn, analysis_id, &path);
    add_coupling(&mut bag, &conn, analysis_id, &path);
    add_symbol_refs(&mut bag, &conn, analysis_id, &path);
    add_call_edges(&mut bag, &conn, analysis_id, &path);
    add_deps(&mut bag, &conn, analysis_id, &f.id);
    add_symbols(&mut bag, &conn, analysis_id, &path);
    add_data_flow(&mut bag, &conn, analysis_id, &path);

    let insights = ai_insights(&conn, analysis_id, &path);
    let blind_keys: Vec<&str> = bag.blind.iter().filter_map(|b| b["dim"].as_str()).collect();

    let mut hint = format!(
        "Cross-dimension dossier for `{}` (path resolved by: {}). \
         `findings` = dimensions where this file actually has records; \
         `clean` = dimensions that DID run and found nothing for this file (safe to state as a \
         negative conclusion); `blind` = dimensions that did NOT run (say nothing about them). ",
        path, how
    );
    if !blind_keys.is_empty() {
        hint.push_str(&format!(
            "Blind here: {}. Do NOT phrase these as \"no problems found\". ",
            blind_keys.join(", ")
        ));
    }
    hint.push_str(
        "Every listed path comes from the scan's file table, so it is safe to copy verbatim into \
         insight refs. Each dimension is capped — use scan_records(action=\"query\", dataset=..., \
         path=...) for the full set, review_explain for rule details, impact_assess for blast radius. \
         Cite as `path:line`; do not re-read source with file_read to re-derive numbers already here.",
    );

    Ok(json!({
        "resolved": true,
        "file": { "path": path, "lang": f.language, "lines": f.lines, "size": f.size },
        "resolvedBy": how,
        "findings": Value::Object(bag.findings),
        "clean": bag.clean,
        "blind": bag.blind,
        "aiInsights": insights,
        "hint": hint,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::migration;
    use std::sync::Mutex;

    const AID: &str = "a1";
    const TARGET: &str = "src/core/hot.ts";

    fn mem_db() -> Arc<Database> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migration::init_tables(&conn).unwrap();
        Arc::new(Database(Mutex::new(conn)))
    }

    fn add_file(db: &Arc<Database>, id: &str, rel: &str) {
        let name = rel.rsplit('/').next().unwrap().to_string();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO project_files \
             (id, analysis_id, path, rel_path, name, extension, language, size, line_count, is_directory) \
             VALUES (?1,?2,?3,?3,?4,'ts','typescript',4096,320,0)",
            rusqlite::params![id, AID, rel, name],
        )
        .unwrap();
    }

    fn exec(db: &Arc<Database>, sql: &str, p: &[&dyn rusqlite::ToSql]) {
        let conn = db.0.lock().unwrap();
        conn.execute(sql, p).unwrap();
    }

    /// 只有目标文件、没有任何维度数据的最小库
    fn base_db() -> Arc<Database> {
        let db = mem_db();
        add_file(&db, "f1", TARGET);
        db
    }

    fn dossier(db: &Arc<Database>, path: &str) -> Value {
        build_dossier(db, AID, &json!({ "path": path })).unwrap()
    }

    fn dims(v: &Value, area: &str) -> Vec<String> {
        v[area]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x["dim"].as_str().unwrap().to_string())
            .collect()
    }

    // ─── 路径归一 ───

    #[test]
    fn normalize_strips_dot_slash_backslash_and_line_suffix() {
        assert_eq!(normalize_path_input("./src/a.ts"), "src/a.ts");
        assert_eq!(normalize_path_input("src\\core\\a.ts"), "src/core/a.ts");
        // refs 的格式就是 `文件:行号`，Agent 顺手复制过来是最高频的输入形态
        assert_eq!(normalize_path_input("src/a.ts:128"), "src/a.ts");
        assert_eq!(normalize_path_input("  src/a.ts/ "), "src/a.ts");
    }

    #[test]
    fn normalize_keeps_windows_drive_and_non_numeric_tail() {
        // 冒号后不是纯数字就不是行号，不能截
        assert_eq!(normalize_path_input("C:/proj/a.ts"), "C:/proj/a.ts");
        assert_eq!(normalize_path_input("src/a.ts:main"), "src/a.ts:main");
    }

    // ─── 四级解析 ───

    #[test]
    fn resolve_exact_then_suffix_then_basename() {
        let db = base_db();
        let conn = db.0.lock().unwrap();

        match resolve_file(&conn, AID, TARGET) {
            Resolution::One(f, how) => {
                assert_eq!(f.rel_path, TARGET);
                assert_eq!(how, "exact");
            }
            other => panic!("expected exact, got {:?}", other),
        }
        // 只给尾段
        match resolve_file(&conn, AID, "core/hot.ts") {
            Resolution::One(f, how) => {
                assert_eq!(f.rel_path, TARGET);
                assert_eq!(how, "suffix");
            }
            other => panic!("expected suffix, got {:?}", other),
        }
        // 目录猜错了，但文件名对：仍要救回来，而不是甩一句「文件不存在」
        match resolve_file(&conn, AID, "packages/app/hot.ts") {
            Resolution::One(f, how) => {
                assert_eq!(f.rel_path, TARGET);
                assert_eq!(how, "basename");
            }
            other => panic!("expected basename, got {:?}", other),
        }
    }

    #[test]
    fn resolve_never_guesses_between_same_named_files() {
        // 猜错的代价是把 A 文件的问题写到 B 文件的 refs 上，而界面上看起来完全正常
        let db = base_db();
        add_file(&db, "f2", "src/legacy/hot.ts");
        let conn = db.0.lock().unwrap();
        match resolve_file(&conn, AID, "hot.ts") {
            Resolution::Ambiguous(list) => assert_eq!(list.len(), 2),
            other => panic!("expected ambiguous, got {:?}", other),
        }
    }

    #[test]
    fn ambiguous_path_returns_candidates_not_an_empty_dossier() {
        let db = base_db();
        add_file(&db, "f2", "src/legacy/hot.ts");
        let v = dossier(&db, "hot.ts");
        assert_eq!(v["resolved"], json!(false));
        assert_eq!(v["candidates"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn unknown_path_says_so_instead_of_profiling_nothing() {
        let db = base_db();
        let v = dossier(&db, "src/does/not/exist_qqq.ts");
        assert_eq!(v["resolved"], json!(false));
        assert!(v["hint"]
            .as_str()
            .unwrap()
            .contains("No scanned file matches"));
    }

    #[test]
    fn path_is_required() {
        let db = base_db();
        assert!(build_dossier(&db, AID, &json!({})).is_err());
    }

    // ─── 三态：查过没有 vs 压根没查 ───

    #[test]
    fn separates_ran_and_empty_from_never_ran() {
        // 空库：techDebt 每次扫描都跑（0 行 = 确实没有）；churn 依赖 Git（0 行 = 没跑）。
        // 混成一句「无数据」，Agent 就会一本正经地说「该文件很稳定」——而真相是项目没接 Git。
        let db = base_db();
        let v = dossier(&db, TARGET);
        let clean = dims(&v, "clean");
        let blind = dims(&v, "blind");
        assert!(clean.contains(&"techDebt".to_string()), "clean={:?}", clean);
        assert!(clean.contains(&"clones".to_string()));
        assert!(blind.contains(&"churn".to_string()), "blind={:?}", blind);
        assert!(blind.contains(&"changeCoupling".to_string()));
        // 盲区必须在 hint 里被点名，模型不一定会去读结构化字段
        assert!(v["hint"].as_str().unwrap().contains("Blind here"));
    }

    #[test]
    fn a_dimension_that_ran_elsewhere_but_missed_this_file_is_clean_not_blind() {
        // churn 全局有行（说明 Git 阶段跑过），只是这个文件没被改过 → 可以下阴性结论
        let db = base_db();
        add_file(&db, "f2", "src/other.ts");
        exec(
            &db,
            "INSERT INTO project_git_churn (id, analysis_id, file_path, commit_count, churn_score, hotspot_level) \
             VALUES ('c1', ?1, 'src/other.ts', 9, 30, 'medium')",
            &[&AID],
        );
        let v = dossier(&db, TARGET);
        assert!(dims(&v, "clean").contains(&"churn".to_string()));
        assert!(!dims(&v, "blind").contains(&"churn".to_string()));
    }

    // ─── 方向归一：存储形状不该由模型来消化 ───

    #[test]
    fn symbol_refs_split_fan_in_from_fan_out_and_drop_self_refs() {
        let db = base_db();
        add_file(&db, "f2", "src/caller.ts");
        add_file(&db, "f3", "src/util.ts");
        let rows: [(&str, &str, &str); 4] = [
            ("r1", "src/caller.ts", TARGET),
            ("r2", "src/caller.ts", TARGET),
            ("r3", TARGET, "src/util.ts"),
            // 自引用：扇入口径与风险交叉一致，必须排除，否则大文件天然虚高
            ("r4", TARGET, TARGET),
        ];
        for (id, from, to) in rows {
            exec(
                &db,
                "INSERT INTO project_symbol_refs \
                 (id, analysis_id, from_file_id, from_file_path, to_file_id, to_file_path, symbol_name) \
                 VALUES (?1, ?2, 'x', ?3, 'y', ?4, 'doThing')",
                &[&id, &AID, &from, &to],
            );
        }
        let v = dossier(&db, TARGET);
        let sr = &v["findings"]["symbolRefs"];
        assert_eq!(sr["fanInRefs"], json!(2));
        assert_eq!(sr["fanOutRefs"], json!(1));
        assert_eq!(sr["fanInFiles"], json!(1));
        assert_eq!(sr["referencedBy"], json!([["src/caller.ts", 2]]));
        assert_eq!(sr["references"], json!([["src/util.ts", 1]]));
    }

    #[test]
    fn change_coupling_normalizes_the_partner_regardless_of_ab_order() {
        // a/b 是无向对。不归一，Agent 就得逐行判断「这行里哪个是我」
        let db = base_db();
        add_file(&db, "f2", "src/other.ts");
        exec(
            &db,
            "INSERT INTO project_change_coupling \
             (id, analysis_id, file_a_path, file_b_path, co_changes, degree, jaccard, coupling_kind, risk_level) \
             VALUES ('cc1', ?1, 'src/other.ts', ?2, 7, 0.8, 0.5, 'logical', 'high')",
            &[&AID, &TARGET],
        );
        let v = dossier(&db, TARGET);
        let top = &v["findings"]["changeCoupling"]["top"][0];
        assert_eq!(top["with"], json!("src/other.ts"));
        assert_eq!(top["kind"], json!("logical"));
    }

    #[test]
    fn clone_blocks_carry_the_other_side() {
        // 「有 3 处克隆」等于没说；「跟 src/other.ts 重复」才能动手
        let db = base_db();
        add_file(&db, "f2", "src/other.ts");
        for (id, path) in [("k1", TARGET), ("k2", "src/other.ts")] {
            exec(
                &db,
                "INSERT INTO project_code_clones \
                 (id, analysis_id, group_id, file_path, start_line, end_line, line_count, group_size) \
                 VALUES (?1, ?2, 'g1', ?3, 10, 60, 50, 2)",
                &[&id, &AID, &path],
            );
        }
        let v = dossier(&db, TARGET);
        let block = &v["findings"]["clones"]["blocks"][0];
        assert_eq!(block["with"], json!(["src/other.ts"]));
        assert_eq!(block["lines"], json!(50));
    }

    #[test]
    fn review_findings_resolve_target_id_to_a_real_path() {
        // review_findings 存的是 file id，不 JOIN 就一条都对不上
        let db = base_db();
        exec(
            &db,
            "INSERT INTO review_findings (id, analysis_id, rule_id, target_id, severity, message) \
             VALUES ('v1', ?1, 'no-god-file', 'f1', 'high', '文件过长，建议拆分')",
            &[&AID],
        );
        let v = dossier(&db, TARGET);
        let rev = &v["findings"]["review"];
        assert_eq!(rev["open"], json!(1));
        assert_eq!(rev["bySeverity"]["high"], json!(1));
        assert_eq!(rev["top"][0]["sev"], json!("high"));
    }

    #[test]
    fn dependencies_are_returned_as_paths_not_ids() {
        let db = base_db();
        add_file(&db, "f2", "src/dep.ts");
        exec(
            &db,
            "INSERT INTO project_dependencies \
             (id, analysis_id, from_id, from_type, to_id, to_type, kind, is_circular) \
             VALUES ('d1', ?1, 'f1', 'file', 'f2', 'file', 'import', 0)",
            &[&AID],
        );
        let v = dossier(&db, TARGET);
        let deps = &v["findings"]["deps"];
        assert_eq!(deps["importsCount"], json!(1));
        assert_eq!(deps["imports"][0]["path"], json!("src/dep.ts"));
    }

    #[test]
    fn metrics_take_the_worst_row_when_a_path_has_several() {
        // 与风险交叉「同路径取最大不累加」同口径，两处给出的复杂度必须一致
        let db = base_db();
        for (id, cc) in [("m1", 12), ("m2", 41)] {
            exec(
                &db,
                "INSERT INTO project_file_metrics \
                 (id, analysis_id, file_id, file_path, total_lines, cyclomatic_complexity, complexity_level) \
                 VALUES (?1, ?2, 'f1', ?3, 320, ?4, 'high')",
                &[&id, &AID, &TARGET, &cc],
            );
        }
        let v = dossier(&db, TARGET);
        assert_eq!(v["findings"]["metrics"]["cc"], json!(41));
    }

    // ─── 已有结论带回：档案里最直接省 token 的一段 ───

    #[test]
    fn brings_back_existing_open_insights_for_this_file() {
        let db = base_db();
        exec(
            &db,
            "INSERT INTO ai_insights (id, analysis_id, kind, title, severity, refs, status, seen_count) \
             VALUES ('i1', ?1, 'risk', '该文件承担了过多职责', 'high', ?2, 'open', 3)",
            &[&AID, &format!("[\"{}:88\"]", TARGET)],
        );
        // 已收口的不该再占 token
        exec(
            &db,
            "INSERT INTO ai_insights (id, analysis_id, kind, title, severity, refs, status) \
             VALUES ('i2', ?1, 'risk', '旧问题已修复', 'medium', ?2, 'resolved')",
            &[&AID, &format!("[\"{}:12\"]", TARGET)],
        );
        let v = dossier(&db, TARGET);
        let ins = &v["aiInsights"];
        assert_eq!(ins["count"], json!(1));
        assert_eq!(ins["items"][0]["id"], json!("i1"));
        assert_eq!(ins["items"][0]["seen"], json!(3));
    }

    #[test]
    fn says_plainly_when_the_file_has_no_prior_conclusion() {
        let db = base_db();
        let v = dossier(&db, TARGET);
        assert_eq!(v["aiInsights"]["count"], json!(0));
        assert!(v["aiInsights"]["note"].as_str().unwrap().contains("尚无"));
    }

    // ─── 出参契约 ───

    #[test]
    fn resolved_dossier_reports_the_real_path_and_how_it_was_matched() {
        // Agent 会把这里的路径原样抄进 refs，所以它必须是 files 表里的那一条
        let db = base_db();
        let v = dossier(&db, "core/hot.ts");
        assert_eq!(v["resolved"], json!(true));
        assert_eq!(v["file"]["path"], json!(TARGET));
        assert_eq!(v["resolvedBy"], json!("suffix"));
    }

    #[test]
    fn every_dimension_is_accounted_for_exactly_once() {
        // 漏掉一维 = Agent 既看不到数据也看不到「没查」的提示，是最危险的静默失真
        let db = base_db();
        let v = dossier(&db, TARGET);
        let mut all: Vec<String> = v["findings"].as_object().unwrap().keys().cloned().collect();
        all.extend(dims(&v, "clean"));
        all.extend(dims(&v, "blind"));
        let mut sorted = all.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), all.len(), "维度重复：{:?}", all);
        assert_eq!(all.len(), 11, "维度数变了，档案漏了一维？{:?}", all);
    }
}
