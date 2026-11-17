// sight-folio: AI Agent 工具的「分析作用域」解析与覆盖度自检
//
// 为什么必须有这一层：
// 扫描产物是**按 analysis_id 分片**存进同一个库的（project_files / project_symbols /
// review_findings / project_code_index … 每张表都带 analysis_id）。一个库里同时存在
// 多次扫描的分片是常态：换项目扫、重扫、旧分析被删了但数据分片还在（migration 只
// CREATE/ALTER 不 DROP，孤儿分片会长期残留）。
//
// 如果 Agent 工具直接 `SELECT COUNT(*) FROM project_files`，拿到的是**所有分片之和**：
// 明明 502 个文件却报 1496，明明 4566 条审查发现却报 13374。Agent 拿着这种数字去做
// 架构判断、算比例、排热点，结论必然失真，而且失真得非常隐蔽（数字看着"很合理"）。
//
// 所以所有读扫描表的工具都必须先解析出一个明确的作用域，再带着 analysis_id 查询。
// 解析顺序（从最可信到最兜底）：
//   1. 调用方显式给的 analysis_id —— 但要校验它真的有数据，避免打错字后静默返回空;
//   2. analyses 表里扫描就绪的最新一条 —— 单项目场景下 Agent 不必知道 id 就能用;
//   3. 数据分片里体量最大的那个 analysis_id —— 应对「分析记录被删、分片还在」的孤儿库;
//   4. 都没有 —— 明确报错让 Agent 去提示用户先扫描，而不是返回一堆 0 让它瞎猜。

use serde_json::{json, Value};
use std::sync::Arc;

use crate::infrastructure::Database;

/// 一个明确的分析作用域：所有扫描类查询都必须落在它上面
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysisScope {
    pub analysis_id: String,
    /// 展示名（analyses 表里的 name；孤儿分片没有记录时退化为 id）
    pub label: String,
    /// 项目根目录（可能为空）
    pub project_root: String,
    /// 解析来源，回给 Agent 让它知道这个作用域是怎么定下来的
    pub resolved_by: &'static str,
}

impl AnalysisScope {
    /// 回给 Agent 的作用域标识。每个工具的 metadata 都带上它，
    /// 这样 Agent 在多轮对话里始终清楚"我现在看的是哪个项目的哪次扫描"。
    pub fn to_json(&self) -> Value {
        json!({
            "analysisId": self.analysis_id,
            "label": self.label,
            "projectRoot": self.project_root,
            "resolvedBy": self.resolved_by,
        })
    }

    /// 人类可读的一行说明，拼在工具文本输出的开头
    pub fn header(&self) -> String {
        format!(
            "[scope] analysis={} ({}) resolvedBy={}",
            self.analysis_id, self.label, self.resolved_by
        )
    }
}

/// 扫描各维度在当前作用域下的数据量。
/// 0 行不等于"没问题"，而是"这一维度本次扫描没产出" —— 必须区分开，
/// 否则 Agent 会把「symbol_refs 查到 0 条引用」读成「这个符号没人用，可以删」。
#[derive(Debug, Clone)]
pub struct DimensionCoverage {
    pub key: &'static str,
    #[allow(dead_code)]
    pub label: &'static str,
    pub count: i64,
}

/// 覆盖度探针：(表名, 维度键, 中文标签)
const COVERAGE_PROBES: &[(&str, &str, &str)] = &[
    ("project_files", "files", "文件"),
    ("project_symbols", "symbols", "符号"),
    ("project_dependencies", "dependencies", "模块依赖"),
    ("project_modules", "modules", "模块"),
    ("project_layers", "layers", "架构分层"),
    ("review_findings", "reviewFindings", "审查发现"),
    ("project_file_metrics", "fileMetrics", "文件度量"),
    ("project_symbol_refs", "symbolRefs", "符号引用"),
    ("project_call_edges", "callEdges", "调用边"),
    ("project_tech_debt", "techDebt", "技术债"),
    ("project_code_clones", "codeClones", "代码克隆"),
    ("project_code_index", "codeIndex", "全文索引"),
];

/// 统计当前作用域下各维度的行数。
/// 单表查询失败（表不存在等）按 -1 记，表示"探测不到"而非"为 0"。
pub fn data_coverage(
    db: &Arc<Database>,
    analysis_id: &str,
) -> Result<Vec<DimensionCoverage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(COVERAGE_PROBES.len());
    for (table, key, label) in COVERAGE_PROBES {
        let sql = format!("SELECT COUNT(*) FROM {} WHERE analysis_id = ?1", table);
        let count: i64 = conn
            .query_row(&sql, rusqlite::params![analysis_id], |r| r.get(0))
            .unwrap_or(-1);
        out.push(DimensionCoverage { key, label, count });
    }
    Ok(out)
}

/// 把覆盖度渲染成「Agent 不会误读」的文本块：
/// 有数据的正常列出，没数据的单独拎出来警告，避免空维度被当成阴性结论。
pub fn render_coverage(cov: &[DimensionCoverage]) -> String {
    let mut present: Vec<String> = Vec::new();
    let mut empty: Vec<&str> = Vec::new();
    for d in cov {
        match d.count {
            n if n > 0 => present.push(format!("{}={}", d.key, n)),
            0 => empty.push(d.key),
            _ => {}
        }
    }
    let mut s = format!("Data coverage: {}", present.join(", "));
    if !empty.is_empty() {
        s.push_str(&format!(
            "\n⚠ Dimensions with NO data in this scan: {}. \
             Absence of rows means the stage produced nothing (not analysed / unsupported language / stage skipped) — \
             it does NOT mean the code is clean. Never conclude \"no references\", \"no debt\" or \"safe to delete\" \
             from an empty dimension; say the data is unavailable instead.",
            empty.join(", ")
        ));
    }
    s
}

pub fn coverage_json(cov: &[DimensionCoverage]) -> Value {
    let mut map = serde_json::Map::new();
    for d in cov {
        map.insert(d.key.to_string(), json!(d.count));
    }
    Value::Object(map)
}

/// 从工具参数里取出显式 analysis_id（容忍空串与前后空格）
pub fn explicit_analysis_id(params: &Value) -> Option<String> {
    params["analysis_id"]
        .as_str()
        .or_else(|| params["analysisId"].as_str())
        .or_else(|| params["scope_id"].as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 判断某个 analysis_id 是否真的有扫描分片（防止打错字后静默返回空结果集）
fn has_data(conn: &rusqlite::Connection, analysis_id: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM project_files WHERE analysis_id = ?1 LIMIT 1",
        rusqlite::params![analysis_id],
        |_| Ok(()),
    )
    .is_ok()
}

/// 解析作用域。见文件头的四级顺序说明。
pub fn resolve_scope(db: &Arc<Database>, params: &Value) -> Result<AnalysisScope, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // ① 显式指定
    if let Some(id) = explicit_analysis_id(params) {
        if has_data(&conn, &id) {
            let (label, root) = lookup_meta(&conn, &id);
            return Ok(AnalysisScope {
                analysis_id: id,
                label,
                project_root: root,
                resolved_by: "explicit",
            });
        }
        // 显式给了却查无数据：把可选项列出来，让 Agent 一次纠正而不是反复试
        let available = list_scope_ids(&conn);
        return Err(format!(
            "analysis_id '{}' has no scan data. Available analysis ids: {:?}. \
             Omit analysis_id to use the latest scan automatically.",
            id, available
        ));
    }

    // ② analyses 表里扫描就绪的最新一条
    let latest: Option<(String, String, String)> = conn
        .query_row(
            "SELECT id, name, project_root FROM analyses \
             WHERE scan_status = 'ready' \
             ORDER BY COALESCE(last_scanned_at, updated_at) DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    if let Some((id, name, root)) = latest {
        if has_data(&conn, &id) {
            return Ok(AnalysisScope {
                analysis_id: id,
                label: name,
                project_root: root,
                resolved_by: "latest-ready-analysis",
            });
        }
    }

    // ③ 孤儿分片兜底：分析记录可能已被删，但分片还在库里，取体量最大的那个
    let biggest: Option<String> = conn
        .query_row(
            "SELECT analysis_id FROM project_files \
             GROUP BY analysis_id ORDER BY COUNT(*) DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(id) = biggest {
        let (label, root) = lookup_meta(&conn, &id);
        return Ok(AnalysisScope {
            analysis_id: id,
            label,
            project_root: root,
            resolved_by: "largest-orphan-shard",
        });
    }

    // ④ 真的什么都没有
    Err("No project scan data exists in this workspace yet. Ask the user to run a project scan first."
        .to_string())
}

fn lookup_meta(conn: &rusqlite::Connection, analysis_id: &str) -> (String, String) {
    conn.query_row(
        "SELECT name, project_root FROM analyses WHERE id = ?1",
        rusqlite::params![analysis_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .unwrap_or_else(|_| (analysis_id.to_string(), String::new()))
}

fn list_scope_ids(conn: &rusqlite::Connection) -> Vec<String> {
    let mut stmt = match conn.prepare(
        "SELECT analysis_id, COUNT(*) c FROM project_files GROUP BY analysis_id ORDER BY c DESC LIMIT 10",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    stmt.query_map([], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_analysis_id_accepts_aliases_and_trims() {
        assert_eq!(
            explicit_analysis_id(&json!({ "analysis_id": "  a1  " })).as_deref(),
            Some("a1")
        );
        assert_eq!(
            explicit_analysis_id(&json!({ "analysisId": "a2" })).as_deref(),
            Some("a2")
        );
        // scope_id 是 project_context 工具的叫法，两边保持互通
        assert_eq!(
            explicit_analysis_id(&json!({ "scope_id": "a3" })).as_deref(),
            Some("a3")
        );
    }

    #[test]
    fn explicit_analysis_id_ignores_blank() {
        assert!(explicit_analysis_id(&json!({ "analysis_id": "   " })).is_none());
        assert!(explicit_analysis_id(&json!({})).is_none());
    }

    #[test]
    fn render_coverage_warns_about_empty_dimensions() {
        let cov = vec![
            DimensionCoverage {
                key: "files",
                label: "文件",
                count: 502,
            },
            DimensionCoverage {
                key: "symbolRefs",
                label: "符号引用",
                count: 0,
            },
            DimensionCoverage {
                key: "techDebt",
                label: "技术债",
                count: -1,
            },
        ];
        let out = render_coverage(&cov);
        assert!(out.contains("files=502"));
        // 0 行必须进警告区，不能混在正常统计里
        assert!(out.contains("NO data"));
        assert!(out.contains("symbolRefs"));
        // -1（探测失败）既不算有数据也不算空维度，避免虚假警告
        assert!(!out.contains("techDebt"));
    }

    #[test]
    fn render_coverage_without_empty_dimensions_has_no_warning() {
        let cov = vec![DimensionCoverage {
            key: "files",
            label: "文件",
            count: 10,
        }];
        let out = render_coverage(&cov);
        assert!(out.contains("files=10"));
        assert!(!out.contains("NO data"));
    }

    #[test]
    fn coverage_json_maps_every_dimension() {
        let cov = vec![
            DimensionCoverage {
                key: "files",
                label: "文件",
                count: 5,
            },
            DimensionCoverage {
                key: "symbols",
                label: "符号",
                count: 0,
            },
        ];
        let v = coverage_json(&cov);
        assert_eq!(v["files"], json!(5));
        assert_eq!(v["symbols"], json!(0));
    }

    #[test]
    fn scope_header_and_json_expose_resolution_source() {
        let s = AnalysisScope {
            analysis_id: "scene_1".to_string(),
            label: "项目分析 1".to_string(),
            project_root: "/tmp/p".to_string(),
            resolved_by: "explicit",
        };
        assert!(s.header().contains("scene_1"));
        assert!(s.header().contains("explicit"));
        assert_eq!(s.to_json()["analysisId"], json!("scene_1"));
        assert_eq!(s.to_json()["resolvedBy"], json!("explicit"));
    }
}
