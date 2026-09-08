// project-sight: scan_records —— 扫描原始记录的下钻取数工具
//
// 为什么需要它
// ------------
// 上下文包（project_context）的每个分节都遵循「给结论与排序，不给原始明细」：
// 聚合口径 + Top-15。这在**首轮判断**上极其省 token，但它同时留下一个致命缺口——
// Agent 永远看不到第 16 名。
//
// 扫描把 14 个阶段的产物完整落库了（技术债、克隆、churn、变更耦合、度量、
// 调用边、数据流……动辄数万行），可 Agent 能拿到的只是其中一层薄薄的切片。
// 于是它只有两个选择：要么基于 Top-15 硬下全局结论（失真），要么退回 file_read
// 逐个读源码（token 爆炸，而且读到的是原始代码，不是已经算好的分析结果）。
//
// 本工具补的就是这一段：**按数据集分页下钻，全量可达，但每次只取你要的那几十行**。
// 它和上下文包是同一套「先看目录再取正文」的思路，只是粒度更细：
//   action=datasets  → 有哪些数据集、各有多少行（几十 token 决定钻哪个）
//   action=query     → 带过滤与分页取回紧凑记录（含 total / hasMore，完整性可感知）
//
// 设计约束
// --------
// 1. **表驱动**：所有可查数据集由 DATASETS 静态表声明，新增维度只加一条 spec，
//    工具骨架零改动。表名、列名一律来自静态表，绝不来自模型输入（防注入的根本手段）。
// 2. **必须带作用域**：扫描产物按 analysis_id 分片存在同一个库里，不带条件查询
//    会把历史扫描一起捞出来。统一走 resolve_scope。
// 3. **0 行必须解释清楚**：区分「过滤后无匹配」「该维度确实没有对象」「该维度本次
//    压根没跑」，否则 Agent 会把「没数据」读成「没问题」——这是 AI 分析里最贵的错误。

use async_trait::async_trait;
use rusqlite::types::Value as SqlValue;
use serde_json::{json, Map, Value};
use std::sync::Arc;

use super::engine::{AgentTool, ToolOutput};
use super::file_dossier;
use super::scope::resolve_scope;
use crate::infrastructure::Database;

/// 单条返回字段：SQL 列名 → 输出键名。
/// 输出键刻意用短驼峰（`cc` 而不是 `cyclomaticComplexity`），一份 100 行的结果
/// 能省下几百 token，而语义由 datasets 目录里的说明兜底。
pub struct FieldSpec {
    pub sql: &'static str,
    pub out: &'static str,
}

const fn f(sql: &'static str, out: &'static str) -> FieldSpec {
    FieldSpec { sql, out }
}

/// 一个可下钻的数据集
pub struct DatasetSpec {
    pub key: &'static str,
    pub label: &'static str,
    pub table: &'static str,
    pub fields: &'static [FieldSpec],
    /// 默认排序（写完整表达式，含 DESC）——默认序必须是「最值得先看的排最前」
    pub order_by: &'static str,
    /// 允许模型显式指定的排序列白名单
    pub order_columns: &'static [&'static str],
    /// path 过滤命中的列（多列时任一命中即可）
    pub path_columns: &'static [&'static str],
    /// 等值过滤白名单（如 severity / risk_level）
    pub filter_columns: &'static [&'static str],
    /// min_value 作用的数值列
    pub numeric_column: Option<&'static str>,
    /// 恒定附加条件（如文件清单要排除目录行）。静态字符串，不接受任何模型输入。
    pub base_filter: Option<&'static str>,
    /// 这张表是什么，一句话
    pub summary: &'static str,
    /// **该维度是否每次扫描都会跑**。
    /// true  → 0 行意味着「确实没有这类对象」，可以据此下阴性结论；
    /// false → 0 行更可能意味着「前置条件不满足（非 Git 仓库 / 语言不支持）」，
    ///         此时不得下任何阴性结论。这一个布尔值决定 Agent 敢不敢说「没问题」。
    pub always_runs: bool,
    /// 0 行时给 Agent 的解释
    pub empty_meaning: &'static str,
}

/// 可下钻的数据集全集。
///
/// 刻意**不包含** review_findings 与 symbols 的检索能力（review_explain /
/// symbol_lookup 已经提供了更贴合的语义），避免两条路给出不一致的口径。
/// 死代码同理：它是 review_findings 里 rule_id='rule_dead_symbol' 的一类发现。
pub const DATASETS: &[DatasetSpec] = &[
    DatasetSpec {
        key: "techDebt",
        label: "技术债标记",
        table: "project_tech_debt",
        fields: &[
            f("file_path", "path"),
            f("line_no", "line"),
            f("marker", "marker"),
            f("severity", "severity"),
            f("snippet", "snippet"),
        ],
        order_by: "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'warning' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END ASC, file_path ASC, line_no ASC",
        order_columns: &["severity", "file_path", "line_no", "marker"],
        path_columns: &["file_path"],
        filter_columns: &["severity", "marker"],
        numeric_column: None,
        base_filter: None,
        summary: "源码里的 TODO/FIXME/HACK/XXX/DEPRECATED 等标记，带文件行号与原文片段",
        always_runs: true,
        empty_meaning: "本次扫描没有发现任何技术债标记（该阶段每次都会跑，0 行可以理解为确实没有）",
    },
    DatasetSpec {
        key: "clones",
        label: "重复代码",
        table: "project_code_clones",
        fields: &[
            f("group_id", "group"),
            f("file_path", "path"),
            f("start_line", "start"),
            f("end_line", "end"),
            f("line_count", "lines"),
            f("group_size", "copies"),
            f("clone_type", "type"),
            f("language", "lang"),
        ],
        order_by: "line_count DESC, group_id ASC",
        order_columns: &["line_count", "group_size", "file_path"],
        path_columns: &["file_path"],
        filter_columns: &["clone_type", "language", "group_id"],
        numeric_column: Some("line_count"),
        base_filter: None,
        summary: "克隆代码块；同一 group 的多行代表同一段代码的多个出现位置，按 group 过滤可看全组",
        always_runs: true,
        empty_meaning: "没有检测到达到阈值的重复代码块（该阶段每次都会跑）",
    },
    DatasetSpec {
        key: "churn",
        label: "Git 变更热点",
        table: "project_git_churn",
        fields: &[
            f("file_path", "path"),
            f("commit_count", "commits"),
            f("added_lines", "added"),
            f("deleted_lines", "deleted"),
            f("author_count", "authors"),
            f("churn_score", "score"),
            f("hotspot_level", "level"),
        ],
        order_by: "churn_score DESC, commit_count DESC",
        order_columns: &["churn_score", "commit_count", "author_count", "file_path"],
        path_columns: &["file_path"],
        filter_columns: &["hotspot_level"],
        numeric_column: Some("churn_score"),
        base_filter: None,
        summary: "每个文件的提交次数、增删行数、作者数与热点评分（代码演进视角）",
        always_runs: false,
        empty_meaning: "项目可能不在 Git 仓库内、或 git 阶段未执行 —— 不得据此断定「代码很稳定」",
    },
    DatasetSpec {
        key: "changeCoupling",
        label: "变更耦合",
        table: "project_change_coupling",
        fields: &[
            f("file_a_path", "a"),
            f("file_b_path", "b"),
            f("co_changes", "coChanges"),
            f("degree", "degree"),
            f("jaccard", "jaccard"),
            f("coupling_kind", "kind"),
            f("risk_level", "risk"),
            f("cross_module", "crossModule"),
        ],
        order_by: "degree DESC, co_changes DESC",
        order_columns: &["degree", "co_changes", "jaccard"],
        path_columns: &["file_a_path", "file_b_path"],
        filter_columns: &["coupling_kind", "risk_level"],
        numeric_column: Some("co_changes"),
        base_filter: None,
        summary: "总是被一起改动的文件对；kind=logical 表示没有静态依赖却总是同改（隐性耦合，最值得关注）",
        always_runs: false,
        empty_meaning: "依赖 Git 历史，非 Git 项目或历史过短时为空 —— 不得据此断定「模块之间没有隐性耦合」",
    },
    DatasetSpec {
        key: "metrics",
        label: "文件度量",
        table: "project_file_metrics",
        fields: &[
            f("file_path", "path"),
            f("total_lines", "lines"),
            f("code_lines", "code"),
            f("comment_lines", "comment"),
            f("cyclomatic_complexity", "cc"),
            f("complexity_level", "level"),
            f("max_nesting", "nesting"),
            f("function_count", "fns"),
            f("max_function_cc", "maxFnCc"),
            f("hot_function", "hotFn"),
            f("magic_number_count", "magic"),
        ],
        order_by: "cyclomatic_complexity DESC, total_lines DESC",
        order_columns: &[
            "cyclomatic_complexity",
            "total_lines",
            "max_nesting",
            "max_function_cc",
            "function_count",
            "file_path",
        ],
        path_columns: &["file_path"],
        filter_columns: &["complexity_level", "engine"],
        numeric_column: Some("cyclomatic_complexity"),
        base_filter: None,
        summary: "文件级度量：行数、圈复杂度、最大嵌套、函数数、最复杂函数、魔法数字",
        always_runs: true,
        empty_meaning: "度量阶段每次都会跑，0 行说明本次扫描没有可度量的源文件",
    },
    DatasetSpec {
        key: "callEdges",
        label: "调用边",
        table: "project_call_edges",
        fields: &[
            f("caller_name", "caller"),
            f("caller_file_path", "callerPath"),
            f("callee_name", "callee"),
            f("callee_file_path", "calleePath"),
            f("line_no", "line"),
            f("kind", "kind"),
        ],
        order_by: "caller_file_path ASC, line_no ASC",
        order_columns: &["caller_file_path", "callee_file_path", "caller_name", "callee_name"],
        path_columns: &["caller_file_path", "callee_file_path"],
        filter_columns: &["kind", "caller_name", "callee_name"],
        numeric_column: None,
        base_filter: None,
        summary: "函数调用边（谁调了谁，在第几行）；查某个函数的调用方更推荐用 impact_assess",
        always_runs: false,
        empty_meaning: "调用图依赖语言分析器支持，未支持的语言为空 —— 不得据此断定「这个函数没人调用」",
    },
    DatasetSpec {
        key: "dataFlow",
        label: "数据流摘要",
        table: "project_data_flow",
        fields: &[
            f("file_path", "path"),
            f("function_name", "fn"),
            f("line_no", "line"),
            f("params", "params"),
            f("param_to_return", "paramToReturn"),
            f("propagates", "propagates"),
            f("returns_call_result", "returnsCall"),
            f("sinks", "sinks"),
        ],
        order_by: "file_path ASC, line_no ASC",
        order_columns: &["file_path", "function_name"],
        path_columns: &["file_path"],
        filter_columns: &["propagates", "function_name"],
        numeric_column: None,
        base_filter: None,
        summary: "函数级 def-use 摘要：参数是否透传到返回值、是否流向 sink（污点传播剪枝的依据）",
        always_runs: false,
        empty_meaning: "数据流分析目前只覆盖 TS/JS/Rust/Python，其他语言为空 —— 不得据此断定「没有污点传播」",
    },
    DatasetSpec {
        key: "symbolRefs",
        label: "符号引用",
        table: "project_symbol_refs",
        fields: &[
            f("symbol_name", "symbol"),
            f("from_file_path", "fromPath"),
            f("to_file_path", "toPath"),
            f("ref_line", "line"),
            f("kind", "kind"),
        ],
        order_by: "symbol_name ASC, from_file_path ASC",
        order_columns: &["symbol_name", "from_file_path", "to_file_path"],
        path_columns: &["from_file_path", "to_file_path"],
        filter_columns: &["kind", "symbol_name"],
        numeric_column: None,
        base_filter: None,
        summary: "符号引用边（谁引用了哪个符号），死代码判定的前置数据",
        always_runs: false,
        empty_meaning: "引用解析依赖语言分析器支持 —— 引用为 0 不等于符号没人用，不得据此判定死代码",
    },
    DatasetSpec {
        key: "files",
        label: "文件清单",
        table: "project_files",
        fields: &[
            f("rel_path", "path"),
            f("language", "lang"),
            f("size", "size"),
            f("line_count", "lines"),
            f("extension", "ext"),
        ],
        order_by: "line_count DESC, size DESC",
        order_columns: &["line_count", "size", "rel_path"],
        path_columns: &["rel_path"],
        filter_columns: &["language", "extension"],
        numeric_column: Some("line_count"),
        // 目录行也躺在 project_files 里，混进来会让「文件数」和体量排序全部失真
        base_filter: Some("is_directory = 0"),
        summary: "本次扫描收录的文件清单（可按语言/路径过滤，按体量排序）",
        always_runs: true,
        empty_meaning: "本次扫描没有收录任何文件（扫描可能失败或全部被忽略规则排除）",
    },
];

/// 单个文本字段的最大回传长度。片段类字段（snippet）动辄几百字符，
/// 100 行结果就能吃掉几千 token，而定位问题只需要开头那一截。
const TEXT_CAP: usize = 160;
/// 单次返回行数上限。再多就该换过滤条件了，不该靠一次拉爆上下文。
const MAX_LIMIT: usize = 100;
const DEFAULT_LIMIT: usize = 20;

pub fn find_dataset(key: &str) -> Option<&'static DatasetSpec> {
    let k = key.trim();
    DATASETS
        .iter()
        .find(|d| d.key.eq_ignore_ascii_case(k) || d.key.replace('_', "").eq_ignore_ascii_case(&k.replace('_', "")))
}

/// LIKE 通配符转义。
///
/// 路径里 `_` 出现得极其频繁（`__tests__`、`snake_case`、`file_metrics`），
/// 而 LIKE 里的 `_` 匹配任意单字符。不转义的话，`src/_internal` 会顺带命中
/// `src/ainternal`，命中集只会偏大不会报错——Agent 拿到的「共 N 处」就此失真，
/// 而这种失真没有任何一层会替我们发现。
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// 解析后的查询条件。SQL 片段全部由静态白名单拼出，值一律走参数绑定。
struct QueryPlan {
    /// WHERE 子句（不含 `WHERE` 关键字），首项恒为 analysis_id 条件
    where_sql: String,
    /// 与 where_sql 中 `?` 顺序一致的绑定值（analysis_id 在最前）
    binds: Vec<String>,
    order_sql: String,
    /// 回给 Agent 的过滤条件回显，让它清楚「这批数字是在什么口径下得出的」
    echo: Map<String, Value>,
}

fn build_plan(spec: &DatasetSpec, analysis_id: &str, params: &Value) -> Result<QueryPlan, String> {
    let mut clauses = vec!["analysis_id = ?".to_string()];
    let mut binds = vec![analysis_id.to_string()];
    let mut echo = Map::new();

    if let Some(base) = spec.base_filter {
        clauses.push(base.to_string());
    }

    // 路径过滤：任一路径列包含该子串即命中（SQLite 的 LIKE 对 ASCII 不区分大小写）
    if let Some(path) = params["path"]
        .as_str()
        .or_else(|| params["path_contains"].as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        let ors: Vec<String> = spec
            .path_columns
            .iter()
            .map(|c| format!("{} LIKE ? ESCAPE '\\'", c))
            .collect();
        if ors.is_empty() {
            return Err(format!("dataset '{}' does not support path filtering", spec.key));
        }
        clauses.push(format!("({})", ors.join(" OR ")));
        let pattern = format!("%{}%", escape_like(path));
        for _ in spec.path_columns {
            binds.push(pattern.clone());
        }
        echo.insert("path".into(), json!(path));
    }

    // 等值过滤：列名必须在白名单里。不认识的列直接报错并列出可用列——
    // 静默忽略会让 Agent 以为自己筛过了，拿着全量数据当子集用，结论必错。
    if let Some(obj) = params["where"].as_object() {
        for (col, val) in obj {
            let hit = spec
                .filter_columns
                .iter()
                .find(|c| c.eq_ignore_ascii_case(col.trim()));
            let Some(hit) = hit else {
                return Err(format!(
                    "dataset '{}' cannot filter by '{}'. Filterable columns: {:?}",
                    spec.key, col, spec.filter_columns
                ));
            };
            let v = match val {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                Value::Bool(b) => if *b { "1".into() } else { "0".into() },
                _ => return Err(format!("filter value for '{}' must be a string, number or boolean", col)),
            };
            clauses.push(format!("{} = ?", hit));
            binds.push(v.clone());
            echo.insert((*hit).into(), json!(v));
        }
    }

    // 数值下限：整数直接内联（i64 无注入面），避免 TEXT/INTEGER 比较踩 SQLite 类型亲和的坑
    if let Some(min) = params["min_value"].as_i64() {
        let Some(col) = spec.numeric_column else {
            return Err(format!(
                "dataset '{}' has no numeric column for min_value",
                spec.key
            ));
        };
        clauses.push(format!("{} >= {}", col, min));
        echo.insert("minValue".into(), json!({ "column": col, "value": min }));
    }

    // 排序：列名白名单 + 方向只认 asc/desc
    let order_sql = match params["order_by"].as_str().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(col) => {
            let Some(hit) = spec
                .order_columns
                .iter()
                .find(|c| c.eq_ignore_ascii_case(col))
            else {
                return Err(format!(
                    "dataset '{}' cannot order by '{}'. Sortable columns: {:?}",
                    spec.key, col, spec.order_columns
                ));
            };
            let dir = if params["order"].as_str().is_some_and(|d| d.eq_ignore_ascii_case("asc")) {
                "ASC"
            } else {
                "DESC"
            };
            echo.insert("orderBy".into(), json!(format!("{} {}", hit, dir)));
            format!("{} {}", hit, dir)
        }
        None => spec.order_by.to_string(),
    };

    Ok(QueryPlan {
        where_sql: clauses.join(" AND "),
        binds,
        order_sql,
        echo,
    })
}

/// SQLite 值 → JSON，长文本截断（片段类字段能省下大量 token，定位只需要开头一截）
fn cell_to_json(v: SqlValue) -> Value {
    match v {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(i) => json!(i),
        SqlValue::Real(f) => json!(f),
        SqlValue::Text(s) => {
            let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
            if flat.chars().count() > TEXT_CAP {
                let cut: String = flat.chars().take(TEXT_CAP - 1).collect();
                json!(format!("{}…", cut))
            } else {
                json!(flat)
            }
        }
        SqlValue::Blob(_) => Value::Null,
    }
}

pub struct ScanRecordsTool {
    db: Arc<Database>,
}

impl ScanRecordsTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// 数据集目录：每个数据集多少行 + 一句话说明。
    /// 这是「花几十 token 决定钻哪个」的入口，等价于上下文包的 outline。
    pub fn build_catalog(&self, analysis_id: &str) -> Result<Value, String> {
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        let mut items = Vec::with_capacity(DATASETS.len());
        for spec in DATASETS {
            let sql = match spec.base_filter {
                Some(b) => format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1 AND {}", spec.table, b),
                None => format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1", spec.table),
            };
            // 查询失败（表缺失/库损坏）与「确实 0 行」必须分开表达：
            // 都压成 0 的话，Agent 会把一次读取故障读成「这个维度很干净」。
            let count: Option<i64> = conn
                .query_row(&sql, rusqlite::params![analysis_id], |r| r.get(0))
                .ok();
            let mut item = json!({
                "dataset": spec.key,
                "label": spec.label,
                "rows": count.unwrap_or(-1),
                "about": spec.summary,
            });
            match count {
                None => {
                    item["emptyMeaning"] =
                        json!("该数据集读取失败（表可能尚未建立），行数未知 —— 不得据此下任何结论");
                    item["safeToConcludeAbsence"] = json!(false);
                }
                Some(n) if n <= 0 => {
                    item["emptyMeaning"] = json!(spec.empty_meaning);
                    item["safeToConcludeAbsence"] = json!(spec.always_runs);
                }
                Some(_) => {}
            }
            items.push(item);
        }
        Ok(json!({
            "datasets": items,
            "hint": "These are the RAW scan records, not the Top-N slice you see in project_context sections. \
                     Pick one dataset and call action=query with filters (path / where / min_value) and paging (offset / limit) — \
                     every response tells you `total` and `hasMore`, so you always know how much you have NOT looked at. \
                     `rows: 0` with `safeToConcludeAbsence: false` means the dimension did not run (missing prerequisite), \
                     NOT that the project is clean — read `emptyMeaning` before concluding anything. \
                     For review findings use review_explain, for symbol definitions use symbol_lookup, \
                     for blast radius use impact_assess."
        }))
    }

    /// 下钻查询：过滤 + 分页 + 完整性回执
    pub fn build_query(&self, analysis_id: &str, params: &Value) -> Result<Value, String> {
        let key = params["dataset"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!(
                    "dataset is required. Available: {:?}. Call action=datasets first to see row counts.",
                    DATASETS.iter().map(|d| d.key).collect::<Vec<_>>()
                )
            })?;
        let spec = find_dataset(key).ok_or_else(|| {
            format!(
                "Unknown dataset '{}'. Available: {:?}",
                key,
                DATASETS.iter().map(|d| d.key).collect::<Vec<_>>()
            )
        })?;

        let limit = params["limit"]
            .as_i64()
            .map(|n| n.clamp(1, MAX_LIMIT as i64) as usize)
            .unwrap_or(DEFAULT_LIMIT);
        let offset = params["offset"].as_i64().map(|n| n.max(0) as usize).unwrap_or(0);

        let plan = build_plan(spec, analysis_id, params)?;
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;

        // 过滤后的总数：Agent 据此知道「还有多少没看」，完整性才是可感知的
        let count_sql = format!("SELECT COUNT(*) FROM {} WHERE {}", spec.table, plan.where_sql);
        let total: i64 = conn
            .query_row(
                &count_sql,
                rusqlite::params_from_iter(plan.binds.iter()),
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;

        // 未过滤的维度总量：用来区分「筛没了」和「这维度本来就没数据」
        let base_sql = match spec.base_filter {
            Some(b) => format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1 AND {}", spec.table, b),
            None => format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1", spec.table),
        };
        let dataset_total: i64 = conn
            .query_row(&base_sql, rusqlite::params![analysis_id], |r| r.get(0))
            .unwrap_or(0);

        let cols: Vec<&str> = spec.fields.iter().map(|f| f.sql).collect();
        let sql = format!(
            "SELECT {} FROM {} WHERE {} ORDER BY {} LIMIT {} OFFSET {}",
            cols.join(", "),
            spec.table,
            plan.where_sql,
            plan.order_sql,
            limit,
            offset
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let mut q = stmt
            .query_map(rusqlite::params_from_iter(plan.binds.iter()), |row| {
                let mut obj = Map::new();
                for (i, fs) in spec.fields.iter().enumerate() {
                    obj.insert(fs.out.to_string(), cell_to_json(row.get(i)?));
                }
                Ok(Value::Object(obj))
            })
            .map_err(|e| e.to_string())?;
        let rows: Vec<Value> = q.by_ref().filter_map(|r| r.ok()).collect();

        let returned = rows.len();
        let has_more = (offset + returned) < total as usize;

        // 数据可信度：三种 0 行必须分开讲，否则 Agent 会把「没数据」读成「没问题」
        let quality = if dataset_total == 0 {
            json!({
                "status": if spec.always_runs { "empty" } else { "unavailable" },
                "reason": spec.empty_meaning,
                "safeToConcludeAbsence": spec.always_runs,
            })
        } else if total == 0 {
            json!({
                "status": "ok",
                "reason": format!("当前过滤条件下无匹配；该维度共有 {} 行，放宽条件即可看到", dataset_total),
                "safeToConcludeAbsence": true,
            })
        } else {
            json!({
                "status": "ok",
                "reason": format!("共 {} 行匹配（该维度总计 {} 行）", total, dataset_total),
                "safeToConcludeAbsence": true,
            })
        };

        let mut hint = format!(
            "Showing {}–{} of {} matching rows in `{}`.",
            if returned == 0 { 0 } else { offset + 1 },
            offset + returned,
            total,
            spec.key
        );
        if has_more {
            hint.push_str(&format!(
                " {} more rows remain — call again with offset={} to continue, or narrow it down with path/where/min_value instead of paging blindly.",
                total as usize - (offset + returned),
                offset + returned
            ));
        } else if total > 0 {
            hint.push_str(" This is the complete result set for these filters — no rows are hidden from you.");
        }
        hint.push_str(
            " Cite findings as `path:line`. Do NOT open source files with file_read just to re-derive numbers that are already in these records.",
        );

        Ok(json!({
            "dataset": spec.key,
            "label": spec.label,
            "about": spec.summary,
            "total": total,
            "datasetTotal": dataset_total,
            "offset": offset,
            "limit": limit,
            "returned": returned,
            "hasMore": has_more,
            "nextOffset": if has_more { json!(offset + returned) } else { Value::Null },
            "orderBy": plan.order_sql,
            "filters": Value::Object(plan.echo),
            "dataQuality": quality,
            "rows": rows,
            "hint": hint,
        }))
    }
}

#[async_trait]
impl AgentTool for ScanRecordsTool {
    fn name(&self) -> &str {
        "scan_records"
    }

    fn description(&self) -> &str {
        "Drill into the RAW records produced by the project scan — tech debt markers, code clones, git churn, \
         change coupling, file metrics, call edges, data-flow summaries, symbol references and the file list. \
         project_context sections only show a Top-15 slice of each dimension; this tool gives you the full set \
         with filtering and paging, so you can verify a hypothesis instead of extrapolating from the top rows. \
         Start with action=datasets (cheap: row counts + one-line descriptions), then action=query on the one you need. \
         When your task is about ONE specific file, use action=dossier with that path instead: it returns that file's \
         complete cross-dimension profile (metrics, review findings, tech debt, clones and who they duplicate, git churn, \
         change coupling, fan-in/fan-out, call edges, imports, symbols, data flow, plus AI conclusions already recorded \
         for it) in a single call — and it tells you which dimensions are genuinely clean versus which never ran."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["datasets", "query", "dossier"],
                    "description": "datasets = list available datasets with row counts (do this first); query = fetch records from one dataset; dossier = ONE call returns everything the scan knows about ONE file (use this whenever your task names a specific file)"
                },
                "dataset": {
                    "type": "string",
                    "enum": DATASETS.iter().map(|d| d.key).collect::<Vec<_>>(),
                    "description": "action=query: which dataset to read. Use action=datasets to see what each one contains and how many rows it has."
                },
                "path": {
                    "type": "string",
                    "description": "action=query: substring filter on the record's file path(s), e.g. `src/editor` to scope the question to one area. action=dossier: the file to profile — it must exist in this scan; ambiguous or unknown paths come back as candidates instead of a wrong dossier."
                },
                "where": {
                    "type": "object",
                    "description": "Exact-match filters, e.g. {\"severity\":\"critical\"} or {\"risk_level\":\"high\"}. Only the dataset's filterable columns are accepted — an unknown column is an error, never a silent no-op."
                },
                "min_value": {
                    "type": "integer",
                    "description": "Lower bound on the dataset's main numeric column (churn score, clone line count, cyclomatic complexity, co-changes...). The fastest way to cut a long tail."
                },
                "order_by": {
                    "type": "string",
                    "description": "Sort column (must be one of the dataset's sortable columns). Defaults to the most decision-relevant order for that dataset."
                },
                "order": {
                    "type": "string",
                    "enum": ["desc", "asc"],
                    "description": "Sort direction, default desc"
                },
                "limit": {
                    "type": "integer",
                    "description": "Rows per call, default 20, max 100"
                },
                "offset": {
                    "type": "integer",
                    "description": "Paging offset. The response returns `nextOffset` when more rows remain."
                },
                "analysis_id": {
                    "type": "string",
                    "description": "Scope the query to one scan (analysisId). Optional — omit it and the latest completed scan is used automatically."
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("datasets");
        let scope = resolve_scope(&self.db, &params)?;

        match action {
            "datasets" | "list" | "catalog" => {
                let payload = self.build_catalog(&scope.analysis_id)?;
                Ok(ToolOutput {
                    success: true,
                    result: payload.to_string(),
                    metadata: json!({ "scope": scope.to_json(), "action": "datasets" }),
                })
            }
            "query" | "records" | "rows" => {
                let payload = self.build_query(&scope.analysis_id, &params)?;
                Ok(ToolOutput {
                    success: true,
                    result: payload.to_string(),
                    metadata: json!({
                        "scope": scope.to_json(),
                        "dataset": payload["dataset"],
                        "total": payload["total"],
                        "hasMore": payload["hasMore"],
                    }),
                })
            }
            // 按**文件**下钻，而不是按维度。焦点巡查交给 Agent 的任务形状就是
            // 「去看这个文件」，而数据是按维度存的；不补这一刀，Agent 只能逐维硬翻。
            "dossier" | "file" | "profile" => {
                let payload = file_dossier::build_dossier(&self.db, &scope.analysis_id, &params)?;
                Ok(ToolOutput {
                    success: true,
                    result: payload.to_string(),
                    metadata: json!({
                        "scope": scope.to_json(),
                        "action": "dossier",
                        "resolved": payload["resolved"],
                        "file": payload["file"]["path"],
                    }),
                })
            }
            other => Err(format!(
                "Unknown action '{}'. Use datasets|query|dossier.",
                other
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::migration;
    use std::sync::{Arc, Mutex};

    fn mem_db() -> Arc<Database> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        migration::init_tables(&conn).unwrap();
        Arc::new(Database(Mutex::new(conn)))
    }

    fn seed_file(
        db: &Arc<Database>,
        analysis_id: &str,
        idx: usize,
        lang: &str,
        lines: i64,
        is_dir: bool,
    ) {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO project_files \
             (id, analysis_id, path, rel_path, name, extension, language, size, line_count, is_directory) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                format!("f{}", idx),
                analysis_id,
                format!("src/sub/f{}.ts", idx),
                format!("src/sub/f{}.ts", idx),
                format!("f{}.ts", idx),
                "ts",
                lang,
                lines * 40,
                lines,
                if is_dir { 1 } else { 0 }
            ],
        )
        .unwrap();
    }

    fn seed_debt(db: &Arc<Database>, analysis_id: &str, n: usize, severity: &str, base: &str) {
        let conn = db.0.lock().unwrap();
        for i in 0..n {
            conn.execute(
                "INSERT INTO project_tech_debt \
                 (id, analysis_id, file_id, file_path, line_no, marker, severity, snippet) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![
                    format!("d{}-{}-{}", base.replace('/', "_"), severity, i),
                    analysis_id,
                    format!("f{}", i),
                    format!("{}/mod{}.ts", base, i),
                    10 + i as i64,
                    "TODO",
                    severity,
                    "long snippet ".repeat(20)
                ],
            )
            .unwrap();
        }
    }

    #[test]
    fn catalog_reports_row_counts_and_excludes_directory_rows() {
        let db = mem_db();
        for i in 1..=25 {
            seed_file(&db, "scan_1", i, "ts", i as i64, false);
        }
        // 这些目录行混在 project_files 里，files 数据集必须靠 base_filter 剥掉
        seed_file(&db, "scan_1", 100, "ts", 9999, true);
        seed_file(&db, "scan_1", 101, "ts", 9998, true);

        let tool = ScanRecordsTool::new(db);
        let catalog = tool.build_catalog("scan_1").unwrap();
        let files = catalog["datasets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["dataset"] == "files")
            .unwrap();
        assert_eq!(files["rows"], 25, "目录行不应计入文件数据集");
        assert!(files.get("emptyMeaning").is_none(), "有数据时不应提示空含义");
    }

    #[test]
    fn catalog_marks_absence_meaning_for_unrun_dimension() {
        let db = mem_db();
        let tool = ScanRecordsTool::new(db);
        // churn 是 always_runs=false 的数据集，且本库没有种子数据 → 必须提示「没跑」而非「干净」
        let catalog = tool.build_catalog("scan_empty").unwrap();
        let churn = catalog["datasets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["dataset"] == "churn")
            .unwrap();
        assert_eq!(churn["rows"], 0);
        assert_eq!(churn["safeToConcludeAbsence"], false);
        assert!(churn["emptyMeaning"].as_str().unwrap().len() > 0);
    }

    #[test]
    fn query_pages_through_full_set_and_reports_has_more() {
        let db = mem_db();
        for i in 1..=25 {
            seed_file(&db, "scan_1", i, "ts", i as i64, false);
        }
        let tool = ScanRecordsTool::new(db);

        let first = tool
            .build_query("scan_1", &json!({ "dataset": "files", "limit": 20, "offset": 0 }))
            .unwrap();
        assert_eq!(first["total"], 25);
        assert_eq!(first["returned"], 20);
        assert_eq!(first["hasMore"], true);
        assert_eq!(first["nextOffset"], 20);
        assert_eq!(first["datasetTotal"], 25);

        let second = tool
            .build_query("scan_1", &json!({ "dataset": "files", "limit": 20, "offset": 20 }))
            .unwrap();
        assert_eq!(second["returned"], 5);
        assert_eq!(second["hasMore"], false);
        assert_eq!(second["nextOffset"], Value::Null);
    }

    #[test]
    fn query_respects_exact_filter_and_path_substring() {
        let db = mem_db();
        seed_debt(&db, "scan_1", 3, "critical", "src/core");
        seed_debt(&db, "scan_1", 2, "warning", "src/core");
        seed_debt(&db, "scan_1", 4, "critical", "src/edge");

        let tool = ScanRecordsTool::new(db);

        let crit = tool
            .build_query("scan_1", &json!({ "dataset": "techDebt", "where": { "severity": "critical" } }))
            .unwrap();
        assert_eq!(crit["total"], 7, "critical 共 3+4=7 条");
        assert_eq!(crit["datasetTotal"], 9);

        let core = tool
            .build_query("scan_1", &json!({ "dataset": "techDebt", "path": "src/core" }))
            .unwrap();
        assert_eq!(core["total"], 5, "src/core 下 critical3 + warning2");

        let scoped = tool
            .build_query(
                "scan_1",
                &json!({ "dataset": "techDebt", "where": { "severity": "warning" }, "path": "src/core" }),
            )
            .unwrap();
        assert_eq!(scoped["total"], 2, "两个过滤条件叠加");
    }

    #[test]
    fn query_rejects_unknown_filter_column_instead_of_silent_noop() {
        let db = mem_db();
        seed_debt(&db, "scan_1", 1, "critical", "src/core");
        let tool = ScanRecordsTool::new(db);
        let res = tool.build_query(
            "scan_1",
            &json!({ "dataset": "techDebt", "where": { "not_a_column": "x" } }),
        );
        assert!(res.is_err(), "未知过滤列必须报错，绝不能静默忽略");
        assert!(res.unwrap_err().contains("not_a_column"));
    }

    #[test]
    fn query_data_quality_distinguishes_the_three_zero_states() {
        let db = mem_db();
        // 1) 维度确实跑了但被筛没了 → ok（可下阴性结论）
        for i in 1..=10 {
            seed_file(&db, "scan_1", i, "ts", i as i64, false);
        }
        let filtered_out = ScanRecordsTool::new(db.clone())
            .build_query("scan_1", &json!({ "dataset": "files", "where": { "language": "python" } }))
            .unwrap();
        assert_eq!(filtered_out["total"], 0);
        assert_eq!(filtered_out["datasetTotal"], 10);
        assert_eq!(filtered_out["dataQuality"]["status"], "ok");
        assert_eq!(filtered_out["dataQuality"]["safeToConcludeAbsence"], true);

        // 2) 维度每次都跑但本就 0 行 → empty（可下阴性结论）
        let empty_always = ScanRecordsTool::new(db.clone())
            .build_query("scan_no_files", &json!({ "dataset": "files" }))
            .unwrap();
        assert_eq!(empty_always["dataQuality"]["status"], "empty");
        assert_eq!(empty_always["dataQuality"]["safeToConcludeAbsence"], true);

        // 3) 维度本次没跑（always_runs=false）→ unavailable（严禁下阴性结论）
        let unrun = ScanRecordsTool::new(db.clone())
            .build_query("scan_no_files", &json!({ "dataset": "churn" }))
            .unwrap();
        assert_eq!(unrun["dataQuality"]["status"], "unavailable");
        assert_eq!(unrun["dataQuality"]["safeToConcludeAbsence"], false);
    }

    #[test]
    fn path_filter_treats_underscore_as_a_literal_not_a_wildcard() {
        let db = mem_db();
        // 目标目录带下划线（前端项目里 __tests__ 遍地都是）
        seed_debt(&db, "scan_1", 2, "warning", "src/__tests__");
        // 只差一个字符的邻居：未转义时 `_` 会当通配符把它一起捞进来
        seed_debt(&db, "scan_1", 3, "warning", "src/xxtestsxx");

        let tool = ScanRecordsTool::new(db);
        let hit = tool
            .build_query("scan_1", &json!({ "dataset": "techDebt", "path": "src/__tests__" }))
            .unwrap();
        assert_eq!(hit["total"], 2, "下划线必须按字面量匹配，不能顺带命中相邻目录");
        assert_eq!(hit["datasetTotal"], 5);
    }

    #[test]
    fn path_filter_escapes_percent_sign() {
        let db = mem_db();
        seed_debt(&db, "scan_1", 4, "warning", "src/core");
        let tool = ScanRecordsTool::new(db);
        // 未转义时 `%` 会匹配一切 → 返回全部 4 条；转义后按字面量找不到任何路径
        let res = tool
            .build_query("scan_1", &json!({ "dataset": "techDebt", "path": "%" }))
            .unwrap();
        assert_eq!(res["total"], 0, "`%` 必须按字面量处理，不能退化成 match-all");
    }

    #[test]
    fn parameters_enum_stays_in_sync_with_datasets_table() {
        let tool = ScanRecordsTool::new(mem_db());
        let enums: Vec<String> = tool.parameters()["properties"]["dataset"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        let keys: Vec<String> = DATASETS.iter().map(|d| d.key.to_string()).collect();
        assert_eq!(enums, keys, "tool 的 JSON 枚举必须和 DATASETS 静态表完全一致");
    }

    #[test]
    fn find_dataset_is_underscore_and_case_insensitive() {
        assert!(find_dataset("techDebt").is_some());
        assert!(find_dataset("techdebt").is_some());
        assert!(find_dataset("TECHDEBT").is_some());
        assert!(find_dataset("nope").is_none());
    }
}
