// sight-folio: AI Agent 专用工具集
// 这些工具让 AI 能够查询项目代码结构、搜索符号、读取文件、分析架构

use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use super::change_ledger::{ChangeLedger, NewCodeChange};
use super::code_patch::{
    apply_patch, content_hash, full_write_guard, locate_hint, patch_preview, truncate_chars,
    LocateHint,
};
use super::engine::{AgentTool, ToolOutput};
use super::scan_records::ScanRecordsTool;
use super::scope::{coverage_json, data_coverage, render_coverage, resolve_scope};
use crate::commands::call_graph::{compute_call_reachability, CallReachabilityResult};
use crate::infrastructure::database::ai_repository::*;
use crate::infrastructure::database::project_call_edge_repository::ProjectCallEdgeRepository;
use crate::infrastructure::database::writing_repository::WritingRepository;
use crate::infrastructure::database::SqliteProjectCallEdgeRepository;
use crate::infrastructure::database::SqliteWritingRepository;
use crate::infrastructure::Database;

/// 各工具**自我设界**的输出预算。
///
/// 为什么必须是每个工具自己管：引擎层（`engine.rs` 的 `ToolOutput`）对 `result`
/// 不做任何截断——工具想吐多少就吐多少，一次失控的调用能把整份文件灌进上下文，
/// 把这一轮乃至整个会话的预算一次性烧光。所以每个会返回多行内容的工具都得自带闸门，
/// 并在真的截断时**明说**（给出继续读的确切参数），让模型不必猜。
///
/// 阈值对标 openclaw `harness/utils/truncate.ts:2-4`（读 2000 行 / 50KB）
/// 与 claw-code `file_ops.rs:612`（列表默认上限 250）。

/// `file_read` 单次最多返回多少行（对标 openclaw 的 2000 行）。
const FILE_READ_MAX_LINES: usize = 2_000;
/// `file_read` 单次最多返回多少字符（对标 openclaw 的 50KB，略留余量给行号前缀）。
const FILE_READ_MAX_CHARS: usize = 48_000;
/// `file_read` 未指定 end_line 时的默认窗口行数。
const FILE_READ_DEFAULT_LINES: i64 = 200;
/// `code_search` 的 max_results 允许上限（模型可以调小，不能调大）。
const CODE_SEARCH_MAX_RESULTS: usize = 200;
/// `code_search` 单行内容的最大展示字符数（超长行靠 file_read 看原文，不要在搜索结果里铺开）。
const SEARCH_LINE_MAX_CHARS: usize = 200;

/// 所有读扫描表的工具共用的 analysis_id 参数声明。
///
/// 扫描产物按 analysis_id 分片存在同一个库里，不带这个条件查询会把历史扫描、
/// 别的项目的分片一起捞出来（实测同一库里躺着 3 份分片，文件数会虚高到 3 倍）。
/// 声明成可选是刻意的：单项目场景下 Agent 不用先去查 id，省一轮工具调用。
fn analysis_id_param() -> Value {
    json!({
        "type": "string",
        "description": "Scope the query to one scan (analysisId). Optional — omit it and the latest completed scan is used automatically. Every response echoes back the resolved scope so you always know which project/scan you are looking at."
    })
}

// ─── code_search: 全文搜索代码内容 ───

pub struct CodeSearchTool {
    db: Arc<Database>,
}

impl CodeSearchTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for CodeSearchTool {
    fn name(&self) -> &str {
        "code_search"
    }

    fn description(&self) -> &str {
        "Search project source code by keyword. Returns one line per match \
         (`path:line: content`), capped at 200 results. Results are scoped to a single scan \
         (see analysis_id). Narrow the query with file_pattern instead of raising max_results — \
         a broad keyword can match thousands of lines you will never read."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search keyword or pattern"
                },
                "file_pattern": {
                    "type": "string",
                    "description": "Optional path fragment to filter files (e.g. 'src/editor', '.rs')"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (default 20, hard cap 200). Larger values are clamped."
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["query"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let query = params["query"].as_str().ok_or("query is required")?;
        let file_pattern = params["file_pattern"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        // 钳制而不是照抄：模型经常随手写个 1000、5000，不设上限一次调用就能把
        // 十几万 token 灌进上下文（实测 5000 条 pretty JSON ≈ 15.8 万 token）。
        // 想更全应当收窄 query / file_pattern，而不是加大条数——这也是回执里要明说的话。
        let max_results = params["max_results"]
            .as_i64()
            .unwrap_or(20)
            .clamp(1, CODE_SEARCH_MAX_RESULTS as i64) as usize;

        let scope = resolve_scope(&self.db, &params)?;
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;

        // 全文索引按 analysis_id 分片；漏掉这个条件会把历史扫描的行也搜出来，
        // 命中位置指向早已改过的行号，Agent 据此定位必然扑空。
        let pattern = format!("%{}%", query);
        let results: Vec<Value> = match file_pattern {
            Some(fp) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT file_path, line_number, line_content
                         FROM project_code_index
                         WHERE analysis_id = ?1 AND line_content LIKE ?2 AND file_path LIKE ?3
                         ORDER BY file_path, line_number
                         LIMIT ?4",
                    )
                    .map_err(|e| e.to_string())?;
                let fp_like = format!("%{}%", fp);
                let q = stmt
                    .query_map(
                        rusqlite::params![scope.analysis_id, pattern, fp_like, max_results as i64],
                        map_index_row,
                    )
                    .map_err(|e| e.to_string())?;
                q.filter_map(|r| r.ok()).collect()
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT file_path, line_number, line_content
                         FROM project_code_index
                         WHERE analysis_id = ?1 AND line_content LIKE ?2
                         ORDER BY file_path, line_number
                         LIMIT ?3",
                    )
                    .map_err(|e| e.to_string())?;
                let q = stmt
                    .query_map(
                        rusqlite::params![scope.analysis_id, pattern, max_results as i64],
                        map_index_row,
                    )
                    .map_err(|e| e.to_string())?;
                q.filter_map(|r| r.ok()).collect()
            }
        };

        // 一行一条 `path:line: content`。
        // 原来是 `serde_json::to_string_pretty`——同样的内容被缩进和花括号撑成 2~3 倍：
        // 实测 20 条结果 pretty 631 token / 扁平 363 token（−42%），而信息量完全一样。
        let body = render_search_hits(&results);

        // 命中条数顶到上限＝很可能还有更多。不明说的话模型会把这批当全集，
        // 得出「项目里只有这些地方用到 X」的错误结论——这类错最难被发现。
        let capped = results.len() >= max_results;
        let tail = if capped {
            format!(
                "\n[Result cap {} reached — there may be more matches. Narrow it down with \
                 file_pattern or a more specific query instead of raising max_results.]",
                max_results
            )
        } else if results.is_empty() {
            "\n[No match. Try a shorter/distinctive keyword (the index matches substrings literally, \
             so a long phrase with different spacing or wrapping will miss), or use symbol_lookup \
             to find the definition first.]"
                .to_string()
        } else {
            String::new()
        };

        Ok(ToolOutput {
            success: true,
            result: format!(
                "{}\nFound {} matches for '{}':\n{}{}",
                scope.header(),
                results.len(),
                query,
                body,
                tail
            ),
            metadata: json!({
                "count": results.len(),
                "capped": capped,
                "maxResults": max_results,
                "scope": scope.to_json(),
            }),
        })
    }
}

/// `file_read` 的行范围钳制：请求区间 ∩ [start, start+2000) ∩ [start, 文件总行数]。
///
/// 抽成纯函数是为了能在无 DB 的情况下单测——「模型传了 99999 会不会失控」这类问题
/// 不该等到集成测试才发现。
fn clamp_read_range(start: i64, requested_end: i64, total_lines: i64) -> i64 {
    requested_end
        .min(start + FILE_READ_MAX_LINES as i64 - 1)
        .min(total_lines.max(start))
}

/// 文件没读完时追加的续读指路。
///
/// 三件事缺一不可：还剩多少（让人知道没看完）、为什么停（区分主动请求与被动截断）、
/// 下一步的确切参数（可以直接照抄，不必心算）。
fn continuation_notice(
    path: &str,
    start: i64,
    shown_end: i64,
    total_lines: i64,
    hit_char_cap: bool,
) -> String {
    let reason = if hit_char_cap {
        "48KB size limit"
    } else if shown_end >= start + FILE_READ_MAX_LINES as i64 - 1 {
        "2000-line limit"
    } else {
        "your requested range"
    };
    let next_start = shown_end + 1;
    let next_end = (next_start + (shown_end - start)).min(total_lines);
    format!(
        "\n[Showing lines {}–{} of {} ({}). To continue: file_read(file_path=\"{}\", start_line={}, end_line={})]",
        start, shown_end, total_lines, reason, path, next_start, next_end
    )
}

/// 把命中行渲染成扁平的 `path:line: content`。
///
/// 刻意不用 JSON：模型要的是「在哪一行、写的什么」，键名和引号是纯开销。
fn render_search_hits(results: &[Value]) -> String {
    results
        .iter()
        .map(|r| {
            let file = r["file"].as_str().unwrap_or("");
            let line = r["line"].as_i64().unwrap_or(0);
            let content = r["content"].as_str().unwrap_or("");
            format!(
                "{}:{}: {}",
                file,
                line,
                truncate_chars(content, SEARCH_LINE_MAX_CHARS)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn map_index_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let path: String = row.get(0)?;
    let line: i64 = row.get(1)?;
    let content: String = row.get(2)?;
    Ok(json!({ "file": path, "line": line, "content": content.trim() }))
}

// ─── file_read: 读取项目文件内容 ───

pub struct FileReadTool {
    db: Arc<Database>,
}

impl FileReadTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for FileReadTool {
    fn name(&self) -> &str {
        "file_read"
    }

    fn description(&self) -> &str {
        "Read a project file's indexed content by relative path, within a line range. \
         Content comes from the scan's full-text index, so line numbers match what other tools report. \
         Capped at 2000 lines / 48KB per call — when a file is longer, the reply tells you the exact \
         start_line to continue from."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Relative path of the file in the project"
                },
                "start_line": {
                    "type": "integer",
                    "description": "Start line number (1-based, optional)"
                },
                "end_line": {
                    "type": "integer",
                    "description": "End line number (1-based, optional). Defaults to start_line + 199. \
                     Clamped to 2000 lines / 48KB per call to protect the context window."
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["file_path"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let rel_path = params["file_path"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("file_path is required")?;

        let scope = resolve_scope(&self.db, &params)?;
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn
            .prepare(
                "SELECT id, rel_path, language, line_count FROM project_files
                 WHERE analysis_id = ?1 AND rel_path = ?2 AND is_directory = 0
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;

        let file_info: Option<(String, String, Option<String>, i64)> = stmt
            .query_row(rusqlite::params![scope.analysis_id, rel_path], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .ok();

        let (_id, path, lang, lines) = match file_info {
            Some(v) => v,
            None => {
                return Ok(ToolOutput {
                    success: false,
                    result: format!(
                        "{}\nFile '{}' not found in this scan. Paths are project-relative (e.g. 'src/foo/bar.ts'); \
                         use code_search or symbol_lookup to discover the exact path.",
                        scope.header(),
                        rel_path
                    ),
                    metadata: json!({ "scope": scope.to_json() }),
                });
            }
        };

        // 之前这里只回文件元信息，还写着「请用 read_source_file 命令取正文」——
        // 可 Agent 根本调不到 Tauri 命令，等于把它引进死胡同。
        // 扫描阶段已经把每一行存进了全文索引，直接从索引里取才是能用的实现。
        let start = params["start_line"].as_i64().unwrap_or(1).max(1);
        // 自我设界：行上限 + 字符上限双闸门。
        // 不设的话模型一句 end_line=99999 就能把整份文件灌进来——本仓最大的
        // `editor/utils/portraits.ts` 是 6733 行 / 22.9 万字符 ≈ 5.7 万 token，一次调用烧穿整个会话。
        let requested_end = params["end_line"]
            .as_i64()
            .unwrap_or(start + FILE_READ_DEFAULT_LINES - 1)
            .max(start);
        let end = clamp_read_range(start, requested_end, lines);

        let mut body = conn
            .prepare(
                "SELECT line_number, line_content FROM project_code_index
                 WHERE analysis_id = ?1 AND file_path = ?2 AND line_number BETWEEN ?3 AND ?4
                 ORDER BY line_number",
            )
            .map_err(|e| e.to_string())?;
        let mut text = String::new();
        let mut rows: Vec<(i64, String)> = Vec::new();
        let mut hit_char_cap = false;
        for row in body
            .query_map(
                rusqlite::params![scope.analysis_id, rel_path, start, end],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
        {
            let piece = format!("{:>5} | {}\n", row.0, row.1);
            // 至少返回一行：单行就超长时也要给出内容，否则模型完全无从下手
            if !rows.is_empty() && text.len() + piece.len() > FILE_READ_MAX_CHARS {
                hit_char_cap = true;
                break;
            }
            text.push_str(&piece);
            rows.push(row);
        }
        let text = text.trim_end_matches('\n').to_string();

        let lang_str = lang.clone().unwrap_or_else(|| "unknown".to_string());
        let last_shown = rows.last().map(|(n, _)| *n).unwrap_or(start - 1);
        let text = if rows.is_empty() {
            format!(
                "(no indexed content for lines {}–{}. The full-text index stage may not have run for this scan; \
                 do not treat this as an empty file.)",
                start, end
            )
        } else {
            text
        };

        // 续读指路。以前截断是**静默**的：回执只写「Showing lines 1–200」，
        // 模型很容易以为看完了整个文件，于是拿前 200 行去下判断（本仓 43% 的源文件超过 200 行）。
        // 现在把「还剩多少、下一段从哪继续」连同可直接照抄的调用一起给出。
        let shown_end = if rows.is_empty() { start } else { last_shown };
        let has_more = !rows.is_empty() && shown_end < lines;
        let notice = if has_more {
            continuation_notice(&path, start, shown_end, lines, hit_char_cap)
        } else {
            String::new()
        };

        Ok(ToolOutput {
            success: true,
            result: format!(
                "{}\nFile: {}\nLanguage: {}\nTotal lines: {}\nShowing lines {}–{}:\n{}{}",
                scope.header(),
                path,
                lang_str,
                lines,
                start,
                shown_end,
                text,
                notice
            ),
            metadata: json!({
                "path": path,
                "language": lang,
                "lines": lines,
                "returnedLines": rows.len(),
                "startLine": start,
                "endLine": shown_end,
                "hasMore": !rows.is_empty() && shown_end < lines,
                "nextStartLine": if !rows.is_empty() && shown_end < lines { Some(shown_end + 1) } else { None },
                "scope": scope.to_json(),
            }),
        })
    }
}

// ─── symbol_lookup: 查找符号定义（类/函数/接口等）───

pub struct SymbolLookupTool {
    db: Arc<Database>,
}

impl SymbolLookupTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for SymbolLookupTool {
    fn name(&self) -> &str {
        "symbol_lookup"
    }

    fn description(&self) -> &str {
        "Look up symbol definitions (classes, functions, interfaces, modules, etc.) in the project. Search by name or kind."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Symbol name to search for (partial match)"
                },
                "kind": {
                    "type": "string",
                    "description": "Symbol kind filter: class, function, interface, module, struct, enum, trait, etc."
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum results (default 15)"
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["name"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let name = params["name"].as_str().ok_or("name is required")?;
        let kind = params["kind"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let max_results = params["max_results"].as_i64().unwrap_or(15) as usize;

        let scope = resolve_scope(&self.db, &params)?;
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;

        let pattern = format!("%{}%", name);
        let results: Vec<Value> = match kind {
            Some(k) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT s.name, s.kind, s.file_path, s.start_line, s.end_line, s.visibility
                         FROM project_symbols s
                         WHERE s.analysis_id = ?1 AND s.name LIKE ?2 AND s.kind = ?3
                         ORDER BY s.name
                         LIMIT ?4",
                    )
                    .map_err(|e| e.to_string())?;
                let q = stmt
                    .query_map(
                        rusqlite::params![scope.analysis_id, pattern, k, max_results as i64],
                        map_symbol_row,
                    )
                    .map_err(|e| e.to_string())?;
                q.filter_map(|r| r.ok()).collect()
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT s.name, s.kind, s.file_path, s.start_line, s.end_line, s.visibility
                         FROM project_symbols s
                         WHERE s.analysis_id = ?1 AND s.name LIKE ?2
                         ORDER BY s.name
                         LIMIT ?3",
                    )
                    .map_err(|e| e.to_string())?;
                let q = stmt
                    .query_map(
                        rusqlite::params![scope.analysis_id, pattern, max_results as i64],
                        map_symbol_row,
                    )
                    .map_err(|e| e.to_string())?;
                q.filter_map(|r| r.ok()).collect()
            }
        };

        Ok(ToolOutput {
            success: true,
            result: format!(
                "{}\nFound {} symbols matching '{}':\n{}",
                scope.header(),
                results.len(),
                name,
                serde_json::to_string_pretty(&results).unwrap_or_default()
            ),
            metadata: json!({ "count": results.len(), "scope": scope.to_json() }),
        })
    }
}

fn map_symbol_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "name": row.get::<_, String>(0)?,
        "kind": row.get::<_, String>(1)?,
        "file": row.get::<_, String>(2)?,
        "start_line": row.get::<_, i64>(3)?,
        "end_line": row.get::<_, i64>(4)?,
        "visibility": row.get::<_, Option<String>>(5)?,
    }))
}

// ─── architecture_query: 查询项目架构信息 ───

pub struct ArchitectureQueryTool {
    db: Arc<Database>,
}

impl ArchitectureQueryTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ArchitectureQueryTool {
    fn name(&self) -> &str {
        "architecture_query"
    }

    fn description(&self) -> &str {
        "Query project architecture: modules, dependencies, layers, file counts, complexity metrics. \
         Use query_type=coverage first if you need to know which analysis dimensions actually have data \
         in this scan — an empty dimension means 'not analysed', never 'nothing found'."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query_type": {
                    "type": "string",
                    "enum": ["overview", "coverage", "modules", "dependencies", "layers", "complexity"],
                    "description": "What aspect of architecture to query. coverage = per-dimension row counts of this scan (tells you what is safe to reason about)."
                },
                "detail": {
                    "type": "string",
                    "description": "Optional specific name to look up"
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["query_type"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let query_type = params["query_type"]
            .as_str()
            .ok_or("query_type is required")?;
        let scope = resolve_scope(&self.db, &params)?;

        // coverage 走独立分支：它要在拿连接前先算覆盖度（data_coverage 自己会加锁）
        if query_type == "coverage" {
            let cov = data_coverage(&self.db, &scope.analysis_id)?;
            return Ok(ToolOutput {
                success: true,
                result: format!("{}\n{}", scope.header(), render_coverage(&cov)),
                metadata: json!({ "scope": scope.to_json(), "coverage": coverage_json(&cov) }),
            });
        }

        let cov = if query_type == "overview" {
            Some(data_coverage(&self.db, &scope.analysis_id)?)
        } else {
            None
        };

        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        let aid = scope.analysis_id.as_str();

        match query_type {
            "overview" => {
                let file_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM project_files WHERE analysis_id = ?1 AND is_directory = 0",
                        rusqlite::params![aid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let module_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM project_modules WHERE analysis_id = ?1",
                        rusqlite::params![aid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let dep_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM project_dependencies WHERE analysis_id = ?1",
                        rusqlite::params![aid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let symbol_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM project_symbols WHERE analysis_id = ?1",
                        rusqlite::params![aid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                let layer_count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM project_layers WHERE analysis_id = ?1",
                        rusqlite::params![aid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);

                let cov = cov.unwrap_or_default();
                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nProject Overview:\n- Files: {}\n- Modules: {}\n- Dependencies: {}\n- Symbols: {}\n- Layers: {}\n{}",
                        scope.header(),
                        file_count, module_count, dep_count, symbol_count, layer_count,
                        render_coverage(&cov)
                    ),
                    metadata: json!({
                        "files": file_count, "modules": module_count,
                        "dependencies": dep_count, "symbols": symbol_count, "layers": layer_count,
                        "scope": scope.to_json(), "coverage": coverage_json(&cov),
                    }),
                })
            }
            "modules" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT name, file_count, dep_count, be_dep_count, layer_id
                         FROM project_modules WHERE analysis_id = ?1
                         ORDER BY dep_count DESC LIMIT 20",
                    )
                    .map_err(|e| e.to_string())?;
                let modules: Vec<Value> = stmt
                    .query_map(rusqlite::params![aid], |row| {
                        Ok(json!({
                            "name": row.get::<_, String>(0)?,
                            "files": row.get::<_, i64>(1)?,
                            "deps": row.get::<_, i64>(2)?,
                            "be_deps": row.get::<_, i64>(3)?,
                            "layer": row.get::<_, Option<String>>(4)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nTop {} modules by dependency count:\n{}",
                        scope.header(),
                        modules.len(),
                        serde_json::to_string_pretty(&modules).unwrap_or_default()
                    ),
                    metadata: json!({ "count": modules.len(), "scope": scope.to_json() }),
                })
            }
            "dependencies" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT from_module, to_module, dep_type, COUNT(*) as edge_count
                         FROM project_dependencies WHERE analysis_id = ?1
                         GROUP BY from_module, to_module
                         ORDER BY edge_count DESC LIMIT 20",
                    )
                    .map_err(|e| e.to_string())?;
                let deps: Vec<Value> = stmt
                    .query_map(rusqlite::params![aid], |row| {
                        Ok(json!({
                            "from": row.get::<_, String>(0)?,
                            "to": row.get::<_, String>(1)?,
                            "type": row.get::<_, String>(2)?,
                            "weight": row.get::<_, i64>(3)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nTop {} dependencies:\n{}",
                        scope.header(),
                        deps.len(),
                        serde_json::to_string_pretty(&deps).unwrap_or_default()
                    ),
                    metadata: json!({ "count": deps.len(), "scope": scope.to_json() }),
                })
            }
            "layers" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, description, color, sort_order
                         FROM project_layers WHERE analysis_id = ?1 ORDER BY sort_order",
                    )
                    .map_err(|e| e.to_string())?;
                let layers: Vec<Value> = stmt
                    .query_map(rusqlite::params![aid], |row| {
                        Ok(json!({
                            "id": row.get::<_, String>(0)?,
                            "name": row.get::<_, String>(1)?,
                            "description": row.get::<_, Option<String>>(2)?,
                            "color": row.get::<_, Option<String>>(3)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nArchitecture layers:\n{}",
                        scope.header(),
                        serde_json::to_string_pretty(&layers).unwrap_or_default()
                    ),
                    metadata: json!({ "count": layers.len(), "scope": scope.to_json() }),
                })
            }
            "complexity" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT file_path, cyclomatic_complexity, line_count, import_count
                         FROM project_file_metrics WHERE analysis_id = ?1
                         ORDER BY cyclomatic_complexity DESC LIMIT 15",
                    )
                    .map_err(|e| e.to_string())?;
                let hotspots: Vec<Value> = stmt
                    .query_map(rusqlite::params![aid], |row| {
                        Ok(json!({
                            "file": row.get::<_, String>(0)?,
                            "complexity": row.get::<_, i64>(1)?,
                            "lines": row.get::<_, i64>(2)?,
                            "imports": row.get::<_, i64>(3)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nTop {} complexity hotspots:\n{}",
                        scope.header(),
                        hotspots.len(),
                        serde_json::to_string_pretty(&hotspots).unwrap_or_default()
                    ),
                    metadata: json!({ "count": hotspots.len(), "scope": scope.to_json() }),
                })
            }
            _ => Ok(ToolOutput {
                success: false,
                result: format!("Unknown query_type: '{}'. Use: overview, coverage, modules, dependencies, layers, complexity", query_type),
                metadata: Value::Null,
            }),
        }
    }
}

// ─── review_explain: 解释审查发现 ───

pub struct ReviewExplainTool {
    db: Arc<Database>,
}

impl ReviewExplainTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ReviewExplainTool {
    fn name(&self) -> &str {
        "review_explain"
    }

    fn description(&self) -> &str {
        "Explain code review findings from the scan: severity breakdown (query_type=summary), \
         concrete findings with rule name and file path (query_type=findings, filterable by severity/rule_id), \
         or the rule catalogue (query_type=rules)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query_type": {
                    "type": "string",
                    "enum": ["summary", "findings", "rules"],
                    "description": "What to query: summary of all findings, specific findings detail, or rule definitions"
                },
                "severity": {
                    "type": "string",
                    "enum": ["critical", "warning", "info"],
                    "description": "Filter by severity (optional)"
                },
                "rule_id": {
                    "type": "string",
                    "description": "Filter findings to one rule, e.g. 'rule_file_size_limit' (optional). Use query_type=summary to discover which rules fired."
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum findings to return (default 20, max 100)"
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["query_type"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let query_type = params["query_type"]
            .as_str()
            .ok_or("query_type is required")?;
        let severity = params["severity"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let rule_id = params["rule_id"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        let max_results = params["max_results"].as_i64().unwrap_or(20).clamp(1, 100);

        let scope = resolve_scope(&self.db, &params)?;
        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        let aid = scope.analysis_id.as_str();

        match query_type {
            "summary" => {
                let count_sev = |sev: &str| -> i64 {
                    conn.query_row(
                        "SELECT COUNT(*) FROM review_findings WHERE analysis_id = ?1 AND severity = ?2",
                        rusqlite::params![aid, sev],
                        |r| r.get(0),
                    )
                    .unwrap_or(0)
                };
                let critical = count_sev("critical");
                let warning = count_sev("warning");
                let info = count_sev("info");
                let rules: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM review_rules WHERE enabled = 1",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);

                // 按规则聚合：Agent 一眼看出"哪条规则在刷屏"，据此决定下一步取哪一类 findings，
                // 比直接拉 20 条明细更省 token 也更有判断力。
                let mut stmt = conn
                    .prepare(
                        "SELECT f.rule_id, COALESCE(r.name, f.rule_id), f.severity, COUNT(*) c
                         FROM review_findings f
                         LEFT JOIN review_rules r ON r.id = f.rule_id
                         WHERE f.analysis_id = ?1
                         GROUP BY f.rule_id, f.severity
                         ORDER BY c DESC LIMIT 20",
                    )
                    .map_err(|e| e.to_string())?;
                let by_rule: Vec<Value> = stmt
                    .query_map(rusqlite::params![aid], |row| {
                        Ok(json!({
                            "ruleId": row.get::<_, Option<String>>(0)?,
                            "rule": row.get::<_, String>(1)?,
                            "severity": row.get::<_, String>(2)?,
                            "count": row.get::<_, i64>(3)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nReview Summary:\n- Enabled rules: {}\n- Critical: {}\n- Warning: {}\n- Info: {}\n- Total: {}\n\nBreakdown by rule:\n{}",
                        scope.header(),
                        rules, critical, warning, info, critical + warning + info,
                        serde_json::to_string_pretty(&by_rule).unwrap_or_default()
                    ),
                    metadata: json!({
                        "rules": rules, "critical": critical,
                        "warning": warning, "info": info,
                        "scope": scope.to_json(),
                    }),
                })
            }
            "findings" => {
                // review_findings 里没有 rule_name / target_path / line_number 这些列
                // （历史 SQL 写错了列名，运行时直接报 no such column，这条链一直是断的）。
                // 真实形态是 rule_id → review_rules、target_id → project_files.id，
                // 所以必须两次 LEFT JOIN 才能给出 Agent 真正能用的「规则名 + 文件路径」。
                let mut sql = String::from(
                    "SELECT COALESCE(r.name, f.rule_id, '(unknown rule)') AS rule_name,
                            f.severity, f.message, f.suggestion,
                            COALESCE(pf.rel_path, f.target_id) AS target_path,
                            f.target_type, f.status, f.rule_id
                     FROM review_findings f
                     LEFT JOIN review_rules r ON r.id = f.rule_id
                     LEFT JOIN project_files pf ON pf.id = f.target_id
                     WHERE f.analysis_id = ?1",
                );
                if severity.is_some() {
                    sql.push_str(" AND f.severity = ?2");
                }
                if rule_id.is_some() {
                    sql.push_str(if severity.is_some() {
                        " AND f.rule_id = ?3"
                    } else {
                        " AND f.rule_id = ?2"
                    });
                }
                sql.push_str(
                    " ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, target_path LIMIT ",
                );
                sql.push_str(&max_results.to_string());

                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let findings: Vec<Value> = match (severity, rule_id) {
                    (Some(s), Some(r)) => stmt
                        .query_map(rusqlite::params![aid, s, r], map_finding_row)
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect(),
                    (Some(s), None) => stmt
                        .query_map(rusqlite::params![aid, s], map_finding_row)
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect(),
                    (None, Some(r)) => stmt
                        .query_map(rusqlite::params![aid, r], map_finding_row)
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect(),
                    (None, None) => stmt
                        .query_map(rusqlite::params![aid], map_finding_row)
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect(),
                };

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "{}\nReview findings ({} shown):\n{}",
                        scope.header(),
                        findings.len(),
                        serde_json::to_string_pretty(&findings).unwrap_or_default()
                    ),
                    metadata: json!({ "count": findings.len(), "scope": scope.to_json() }),
                })
            }
            "rules" => {
                // review_rules 没有 category 列，用 target_type 作为分组维度（真实存在且语义相近）
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, rule_type, target_type, severity, scope, enabled, description
                         FROM review_rules ORDER BY severity, target_type LIMIT 60",
                    )
                    .map_err(|e| e.to_string())?;
                let rules: Vec<Value> = stmt
                    .query_map([], |row| {
                        let enabled: i64 = row.get(6)?;
                        Ok(json!({
                            "id": row.get::<_, String>(0)?,
                            "name": row.get::<_, String>(1)?,
                            "type": row.get::<_, String>(2)?,
                            "targetType": row.get::<_, String>(3)?,
                            "severity": row.get::<_, String>(4)?,
                            "scope": row.get::<_, String>(5)?,
                            "enabled": enabled != 0,
                            "description": row.get::<_, Option<String>>(7)?,
                        }))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();

                Ok(ToolOutput {
                    success: true,
                    result: format!(
                        "Review rules ({}):\n{}",
                        rules.len(),
                        serde_json::to_string_pretty(&rules).unwrap_or_default()
                    ),
                    metadata: json!({ "count": rules.len() }),
                })
            }
            _ => Ok(ToolOutput {
                success: false,
                result: format!(
                    "Unknown query_type: '{}'. Use: summary, findings, rules",
                    query_type
                ),
                metadata: Value::Null,
            }),
        }
    }
}

fn map_finding_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "rule": row.get::<_, String>(0)?,
        "severity": row.get::<_, String>(1)?,
        "message": row.get::<_, String>(2)?,
        "suggestion": row.get::<_, Option<String>>(3)?,
        "file": row.get::<_, String>(4)?,
        "targetType": row.get::<_, String>(5)?,
        "status": row.get::<_, String>(6)?,
        "ruleId": row.get::<_, Option<String>>(7)?,
    }))
}

// ─── impact_assess: 评估变更影响面 ───

pub struct ImpactAssessTool {
    db: Arc<Database>,
}

impl ImpactAssessTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ImpactAssessTool {
    fn name(&self) -> &str {
        "impact_assess"
    }

    fn description(&self) -> &str {
        "Assess the blast radius of changing a file or symbol: who imports it, who calls it, and which \
         modules depend on it. Always check the `evidence` field in the response — if a dimension has no \
         data in this scan, absence of callers does NOT mean the target is unused."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "description": "File path (project-relative, partial match allowed) or exact symbol name"
                },
                "target_type": {
                    "type": "string",
                    "enum": ["file", "symbol"],
                    "description": "Whether the target is a file path or symbol name"
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["target", "target_type"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let target = params["target"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("target is required")?;
        let target_type = params["target_type"]
            .as_str()
            .ok_or("target_type is required")?;

        let scope = resolve_scope(&self.db, &params)?;
        // 影响面判断最怕「查到 0 条 → 结论没人用 → 建议删掉」。
        // 所以先取这两个维度在本次扫描下的真实行数，把「无数据」和「无引用」明确区分开。
        let cov = data_coverage(&self.db, &scope.analysis_id)?;
        let dim = |k: &str| {
            cov.iter()
                .find(|d| d.key == k)
                .map(|d| d.count)
                .unwrap_or(-1)
        };
        let refs_total = dim("symbolRefs");
        let calls_total = dim("callEdges");

        let conn = self.db.0.lock().map_err(|e| e.to_string())?;
        let aid = scope.analysis_id.as_str();
        let like = format!("%{}%", target);

        // 1) 解析根符号（文件级→该文件全部符号；符号级→精确名；支持多根）
        let roots: Vec<(String, String, String)>; // (symbol_id, name, file_path)
        match target_type {
            "file" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, file_path FROM project_symbols
                         WHERE analysis_id = ?1 AND file_path LIKE ?2
                         ORDER BY name ASC LIMIT 200",
                    )
                    .map_err(|e| e.to_string())?;
                roots = stmt
                    .query_map(rusqlite::params![aid, like], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
            }
            "symbol" => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, file_path FROM project_symbols
                         WHERE analysis_id = ?1 AND name = ?2
                         ORDER BY file_path ASC LIMIT 200",
                    )
                    .map_err(|e| e.to_string())?;
                roots = stmt
                    .query_map(rusqlite::params![aid, target], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
            }
            _ => {
                return Ok(ToolOutput {
                    success: false,
                    result: format!("Unknown target_type: '{}'. Use: file, symbol", target_type),
                    metadata: Value::Null,
                })
            }
        }

        // 目标未出现在调用图：可能是入口点 / 纯类型 / 未扫描 / 不存在 —— 明确区分「无数据」与「无引用」
        if roots.is_empty() {
            return Ok(ToolOutput {
                success: true,
                result: format!(
                    "{}\nNo symbol matching '{}' (type={}) was found in the call graph of this scan.\n\
                     It may be an entry point, a pure type/interface, not yet scanned, or simply absent.\n\n{}",
                    scope.header(),
                    target,
                    target_type,
                    evidence_note(refs_total, calls_total)
                ),
                metadata: json!({
                    "roots": 0,
                    "scope": scope.to_json(),
                    "evidence": { "symbolRefsInScan": refs_total, "callEdgesInScan": calls_total },
                }),
            });
        }

        // 2) 取全量调用边，做有界双向可达性（joern reachableBy 等价物：传递闭包 + 上下游双方向）
        let repo = SqliteProjectCallEdgeRepository::new(self.db.clone());
        let edges = repo.list_by_analysis(&aid).unwrap_or_default();
        let root_ids: Vec<String> = roots.iter().map(|r| r.0.clone()).collect();
        let reach = compute_call_reachability(&edges, &root_ids, "both", 6);

        // 3) 汇总：上下游按跳数分布
        let up_by_depth = depth_histogram(&reach, "upstream");
        let down_by_depth = depth_histogram(&reach, "downstream");
        let sample_edges: Vec<Value> = reach
            .edges
            .iter()
            .take(15)
            .map(|e| {
                json!({
                    "caller": format!("{} @ {}", e.caller_name, short_id(&e.from_file_id)),
                    "callee": format!("{} @ {}", e.callee_name, short_id(&e.to_file_id)),
                    "line": e.line_no,
                    "direction": e.direction,
                })
            })
            .collect();

        let root_names: Vec<String> = roots
            .iter()
            .map(|r| format!("{} @ {}", r.1, r.2))
            .take(8)
            .collect();

        let summary = format!(
            "{header}\nImpact assessment for {tt} '{tgt}' (roots: {nroots} symbol(s)):\n\n\
             • Upstream callers (who depends on this — blast radius if changed): {up} symbols across {upf} files, by depth {upd}\n\
             • Downstream callees (what this depends on): {down} symbols across {downf} files, by depth {downd}\n\
             • Total call-chain edges in blast radius: {edges}\n\n\
             Sample call-chain edges (first {ns}):\n{samples}\n\n\
             {evidence}",
            header = scope.header(),
            tt = target_type,
            tgt = target,
            nroots = roots.len(),
            up = reach.upstream_count,
            upf = reach.upstream_files,
            upd = fmt_hist(&up_by_depth),
            down = reach.downstream_count,
            downf = reach.downstream_files,
            downd = fmt_hist(&down_by_depth),
            edges = reach.edges.len(),
            ns = sample_edges.len(),
            samples = serde_json::to_string_pretty(&sample_edges).unwrap_or_default(),
            evidence = evidence_note(refs_total, calls_total),
        );

        Ok(ToolOutput {
            success: true,
            result: summary,
            metadata: json!({
                "target": target,
                "target_type": target_type,
                "roots": roots.len(),
                "rootSymbols": root_names,
                "upstream": { "symbols": reach.upstream_count, "files": reach.upstream_files, "byDepth": up_by_depth },
                "downstream": { "symbols": reach.downstream_count, "files": reach.downstream_files, "byDepth": down_by_depth },
                "edges": reach.edges.len(),
                "scope": scope.to_json(),
                "evidence": { "symbolRefsInScan": refs_total, "callEdgesInScan": calls_total },
            }),
        })
    }
}

/// 按方向统计各跳数上的节点数（depth -> count），用于呈现爆炸半径形状。
fn depth_histogram(reach: &CallReachabilityResult, role: &str) -> HashMap<i64, i64> {
    let mut m: HashMap<i64, i64> = HashMap::new();
    for n in &reach.nodes {
        if n.role == role {
            *m.entry(n.depth).or_insert(0) += 1;
        }
    }
    m
}

/// 把跳数分布格式化成 "1跳:5, 2跳:12, 3跳:3"。
fn fmt_hist(h: &HashMap<i64, i64>) -> String {
    if h.is_empty() {
        return "(none)".to_string();
    }
    let mut keys: Vec<&i64> = h.keys().collect();
    keys.sort();
    keys.iter()
        .map(|k| format!("{}跳:{}", k, h[k]))
        .collect::<Vec<_>>()
        .join(", ")
}

/// 把长 file_id 截断成前 8 位，样例中更易读。
fn short_id(id: &str) -> String {
    if id.len() > 8 {
        format!("{}…", &id[..8])
    } else {
        id.to_string()
    }
}

/// 影响面结论的证据强度说明。
/// 这是防误判的关键：某个维度整表为空时，「查到 0 条」只说明这条证据链不存在，
/// 不能推出「无人引用」。把这句话直接写进工具输出，比指望模型自己想起来可靠得多。
fn evidence_note(refs_total: i64, calls_total: i64) -> String {
    let mut missing: Vec<&str> = Vec::new();
    if refs_total == 0 {
        missing.push("symbol references");
    }
    if calls_total == 0 {
        missing.push("call graph");
    }
    if missing.is_empty() {
        format!(
            "[evidence] Both evidence chains are populated in this scan (symbolRefs={}, callEdges={}); \
             an empty result here genuinely means no incoming usage was detected.",
            refs_total, calls_total
        )
    } else {
        format!(
            "[evidence] ⚠ This scan produced NO data for: {}. A zero result from those dimensions proves nothing. \
             Do NOT conclude the target is unused or safe to delete — state that the evidence is unavailable \
             and suggest re-running the corresponding scan stage.",
            missing.join(", ")
        )
    }
}

// ─── project_context: 读取已持久化的 AI 上下文包（省 token 的核心工具）───
//
// 配合前端 scanContextProvider：扫描完成后前端构建 AiContextPack 并落库，
// Agent 这边用本项目上下文做深度分析时，优先用本工具按需取（action=section 最省 token），
// 而不是去翻原始扫描表（那会淹没重点、疯狂烧 token）。
//
// 注意：本工具只读取「已构建好的上下文包」，不绑定任何具体 Agent / 模型 / prompt，
// 用哪个 Agent 完全由用户在前端配置（tool_ids）决定。

pub struct ProjectContextTool {
    db: Arc<Database>,
}

impl ProjectContextTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// 解析目标 pack：显式 pack_id 优先；否则按 scope_id 取该作用域最新包；
    /// 两者都不给时，若全库只有一个包就用它（单项目场景免去一次 list 往返）。
    ///
    /// 让 pack_id 可省是刻意的省 token 设计：Agent 拿到 analysisId 就能直接取上下文，
    /// 不必先 list 再 get，少一轮工具调用就少一轮完整对话上下文重放。
    fn resolve_pack_id(&self, params: &Value) -> Result<String, String> {
        if let Some(pid) = params["pack_id"].as_str() {
            if !pid.trim().is_empty() {
                return Ok(pid.to_string());
            }
        }
        let scope = params["scope_id"].as_str().filter(|s| !s.trim().is_empty());
        let packs = AiContextPackRepo::list_packs(&self.db, scope)?;
        match packs.len() {
            0 => Err(match scope {
                Some(s) => format!(
                    "No context pack found for scope_id='{}'. The project may not have been scanned yet, \
                     or the scan finished before context persistence was enabled — re-run the scan.",
                    s
                ),
                None => "No context packs exist yet. Run a project scan first.".to_string(),
            }),
            // list_packs 已按 generated_at DESC 排序，取首个即最新
            _ => Ok(packs[0].id.clone()),
        }
    }

    /// 解析分节的数据可信度。缺省 / 解析失败一律回退为「未声明 = 可信」，
    /// 与历史数据行为一致——宁可让 Agent 正常读，也不要因为一列 JSON 坏掉就把整节判成盲区。
    fn parse_data_quality(raw: &str) -> Value {
        match serde_json::from_str::<Value>(raw) {
            Ok(v) if v.get("status").and_then(|s| s.as_str()).is_some() => v,
            _ => json!({ "status": "ok" }),
        }
    }

    /// 该节的结论能否直接采信（ok / partial 可用，empty / unavailable 是盲区）
    fn quality_status(raw: &str) -> String {
        Self::parse_data_quality(raw)
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("ok")
            .to_string()
    }

    /// 分节目录条目（不含正文），outline 与 list 的错误提示复用。
    /// `since` 给定时额外标注该节自那一刻起是否变化，Agent 据此只重读变化节。
    fn outline_entry(s: &AiContextSectionRow, since: Option<i64>) -> Value {
        let quality = Self::parse_data_quality(&s.data_quality_json);
        // 下钻指路提到顶层：它藏在 dataQuality 内层时模型经常读漏，
        // 而漏掉的代价是拿 Top-N 当全集下全局结论。
        // 这里纯透传——数据集叫什么、由哪个工具提供，全部由供给模块自己声明，
        // 后端不认识任何具体模块，新模块接入这段代码零改动。
        let drilldown = quality.get("drilldown").filter(|d| d.is_object()).cloned();
        let mut entry = json!({
            "key": s.section_key,
            "title": s.title,
            "summary": s.summary,
            "tokenEstimate": s.token_estimate,
            "priority": s.priority,
            "hasFacts": s.facts_json.len() > 2,
            "digest": s.digest,
            "updatedAt": s.updated_at,
            // 可信度必须出现在目录里：Agent 花几十 token 就能筛掉盲区分节，
            // 既省下取正文的开销，也避免把「没数据」读成「没问题」。
            "dataQuality": quality,
        });
        if let Some(d) = drilldown {
            entry["drilldown"] = d;
        }
        if let Some(ts) = since {
            // updated_at 为 0 = 历史数据没有戳，无法证明「没变」→ 保守判为已变化。
            // 反过来把未知当成未变，会让 Agent 漏读真正更新过的分节。
            let changed = s.updated_at == 0 || s.updated_at > ts;
            entry["changedSince"] = json!(changed);
        }
        entry
    }

    /// 解析 since：接受毫秒时间戳；顺带容忍字符串数字（模型常把数字写成字符串）。
    /// 秒级时间戳（10 位）自动放大到毫秒，避免「传了 since 却全部判为已变化」。
    fn parse_since(params: &Value) -> Option<i64> {
        let raw = params["since"].as_i64().or_else(|| {
            params["since"]
                .as_str()
                .and_then(|s| s.trim().parse::<i64>().ok())
        })?;
        if raw <= 0 {
            return None;
        }
        Some(if raw < 100_000_000_000 {
            raw * 1000
        } else {
            raw
        })
    }

    /// 解析 section_keys：支持数组、逗号分隔串，或退化为单个 section_key
    fn parse_section_keys(params: &Value) -> Vec<String> {
        if let Some(arr) = params["section_keys"].as_array() {
            return arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        if let Some(raw) = params["section_keys"]
            .as_str()
            .or_else(|| params["section_key"].as_str())
        {
            return raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        Vec::new()
    }
}

#[async_trait]
impl AgentTool for ProjectContextTool {
    fn name(&self) -> &str {
        "project_context"
    }

    fn description(&self) -> &str {
        "Read AI-friendly context packs distilled from project scan results (architecture, hotspots, review findings, \
         coupling, tech debt, clones, dead code, call graph, patterns, symbols). \
         RECOMMENDED WORKFLOW to minimise tokens: (1) `action=outline` — returns the section catalogue \
         (key/title/summary/tokenEstimate) with NO bodies, costing only a few dozen tokens, so you can decide what is worth reading; \
         (2) `action=section` with `section_keys` — fetch only the sections you actually need (batching is supported, \
         so one call can return several sections). \
         Use `action=list` only when you need to discover which scopes/packs exist, and `action=get` only when you \
         genuinely need every section at once (expensive — avoid it). \
         `pack_id` may be omitted: pass `scope_id` (the analysisId) and the latest pack for that scope is used automatically. \
         INCREMENTAL ANALYSIS: every section carries `digest` and `updatedAt`. If you have analysed this project before, \
         pass `since` (ms epoch of your last analysis — the `lastSeen` returned by the `context_insight` tool is a good value) \
         to `action=outline`; the response then lists exactly which sections changed. Re-reading unchanged sections \
         produces no new information and burns tokens, so fetch only the changed ones and reuse your recorded insights for the rest. \
         DATA TRUST: every section carries `dataQuality.status` (ok | partial | empty | unavailable) and the outline returns \
         `blindSpotSections`. A section whose status is empty/unavailable has NO data behind it — its \"nothing found\" wording \
         is a blind spot, never evidence of health. Skip fetching those bodies (saves tokens) and state the gap explicitly \
         in your conclusions. The `coverage` section holds the full stage-by-stage completeness report."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["outline", "section", "list", "get"],
                    "description": "outline = section catalogue without bodies (start here); section = fetch specific section bodies; list = list available packs; get = fetch entire pack (expensive)"
                },
                "scope_id": {
                    "type": "string",
                    "description": "analysisId. Used to filter for action=list, and to auto-resolve the latest pack when pack_id is omitted."
                },
                "pack_id": {
                    "type": "string",
                    "description": "pack id (format: `{scopeId}:{moduleId}`), e.g. `abc123:project-scan`. Optional — omit it and pass scope_id instead to use the latest pack."
                },
                "section_keys": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "section keys to fetch for action=section; batching several keys in one call is cheaper than several calls. Typical keys: coverage (data completeness report — read it before trusting any 'nothing found'), overview, architecture, hotspots, review, coupling, techDebt, clones, deadCode, callGraph, dataFlow, patterns, symbols."
                },
                "section_key": {
                    "type": "string",
                    "description": "single section key (legacy alias for section_keys with one entry)."
                },
                "since": {
                    "type": "integer",
                    "description": "Unix epoch in milliseconds of your previous analysis. For action=outline it marks each section with `changedSince` and returns `changedSections`. For action=section with no explicit keys, it fetches exactly the changed sections. This is the cheapest way to stay up to date."
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"]
            .as_str()
            .ok_or("action is required (outline|section|list|get)")?;

        match action {
            "list" => {
                let scope = params["scope_id"].as_str();
                let packs = AiContextPackRepo::list_packs(&self.db, scope)?;
                let summaries: Vec<Value> = packs
                    .iter()
                    .map(|p| {
                        json!({
                            "id": p.id,
                            "scopeId": p.scope_id,
                            "moduleId": p.module_id,
                            "scopeLabel": p.scope_label,
                            "schemaVersion": p.schema_version,
                            "generatedAt": p.generated_at,
                            "tokenEstimate": p.token_estimate,
                            "digest": p.digest,
                            "truncatedSections": p.truncated_sections,
                            "sectionKeys": p.section_keys,
                        })
                    })
                    .collect();
                Ok(ToolOutput {
                    success: true,
                    result: serde_json::to_string_pretty(&summaries).unwrap_or_default(),
                    metadata: json!({ "count": summaries.len() }),
                })
            }
            "get" => {
                let pack_id = self.resolve_pack_id(&params)?;
                let pack_id = pack_id.as_str();
                match AiContextPackRepo::get_pack(&self.db, pack_id)? {
                    Some(pack) => {
                        let secs = AiContextSectionRepo::list_by_pack(&self.db, pack_id)?;
                        let sections: Vec<Value> = secs
                            .iter()
                            .map(|s| {
                                json!({
                                    "key": s.section_key,
                                    "title": s.title,
                                    "summary": s.summary,
                                    "content": s.content,
                                    "tokenEstimate": s.token_estimate,
                                    "priority": s.priority,
                                    "facts": serde_json::from_str::<Value>(&s.facts_json).unwrap_or(Value::Null),
                                    "dataQuality": Self::parse_data_quality(&s.data_quality_json),
                                })
                            })
                            .collect();
                        let out = json!({
                            "id": pack.id,
                            "scopeId": pack.scope_id,
                            "moduleId": pack.module_id,
                            "scopeLabel": pack.scope_label,
                            "schemaVersion": pack.schema_version,
                            "generatedAt": pack.generated_at,
                            "tokenEstimate": pack.token_estimate,
                            "digest": pack.digest,
                            "truncatedSections": pack.truncated_sections,
                            "sections": sections,
                        });
                        Ok(ToolOutput {
                            success: true,
                            result: serde_json::to_string_pretty(&out).unwrap_or_default(),
                            metadata: json!({ "sectionCount": sections.len() }),
                        })
                    }
                    None => Ok(ToolOutput {
                        success: false,
                        result: format!("No context pack found for pack_id={}", pack_id),
                        metadata: Value::Null,
                    }),
                }
            }
            // 省 token 的入口动作：只回目录，不回正文。
            // Agent 花几十 token 就能看清「有哪些维度、每节多大、值不值得读」，
            // 再用 section 精准取，避免 get 全包动辄上万 token 的浪费。
            "outline" => {
                let pack_id = self.resolve_pack_id(&params)?;
                let pack = AiContextPackRepo::get_pack(&self.db, &pack_id)?
                    .ok_or_else(|| format!("No context pack found for pack_id={}", pack_id))?;
                let secs = AiContextSectionRepo::list_by_pack(&self.db, &pack_id)?;
                let since = Self::parse_since(&params);

                let entries: Vec<Value> =
                    secs.iter().map(|s| Self::outline_entry(s, since)).collect();
                let changed_keys: Vec<String> = match since {
                    Some(ts) => secs
                        .iter()
                        .filter(|s| s.updated_at == 0 || s.updated_at > ts)
                        .map(|s| s.section_key.clone())
                        .collect(),
                    None => Vec::new(),
                };
                // 增量分析的成本账：只重读变化节能省下多少 token，直接算给 Agent 看，
                // 比一句「建议只读变化节」有说服力得多。
                let changed_tokens: i64 = match since {
                    Some(ts) => secs
                        .iter()
                        .filter(|s| s.updated_at == 0 || s.updated_at > ts)
                        .map(|s| s.token_estimate)
                        .sum(),
                    None => 0,
                };

                // 盲区清单：这些分节背后的分析阶段没跑成（语言不支持 / 无 Git 历史 / 阶段失败）。
                // 它们的正文里往往写着「未发现 X」，读起来像结论，其实是没数据——
                // 显式列出来，既省掉取正文的 token，也堵住「把盲区当健康」这个最贵的误判。
                let blind: Vec<String> = secs
                    .iter()
                    .filter(|s| {
                        let st = Self::quality_status(&s.data_quality_json);
                        st == "unavailable" || st == "empty"
                    })
                    .map(|s| s.section_key.clone())
                    .collect();
                let partial: Vec<String> = secs
                    .iter()
                    .filter(|s| Self::quality_status(&s.data_quality_json) == "partial")
                    .map(|s| s.section_key.clone())
                    .collect();

                // 被 Top-N 截断、但有全量原始记录可查的分节。
                // 这份清单是「哪些结论不能只看正文就下」的判据：正文给的是头部样本，
                // 真要说「全项目共有多少处」，必须先去 drilldown 指的工具核一遍。
                let drillable: Vec<Value> = secs
                    .iter()
                    .filter_map(|s| {
                        let q = Self::parse_data_quality(&s.data_quality_json);
                        let d = q.get("drilldown")?.as_object()?.clone();
                        let mut item = serde_json::Map::new();
                        item.insert("section".into(), json!(s.section_key));
                        for (k, v) in d {
                            item.insert(k, v);
                        }
                        Some(Value::Object(item))
                    })
                    .collect();

                let hint = match since {
                    Some(_) if changed_keys.is_empty() =>
                        "Nothing changed since the given timestamp. Reuse your previous conclusions \
                         (check the context_insight tool for what was already recorded) instead of re-reading sections."
                            .to_string(),
                    Some(_) => format!(
                        "Only these sections changed since the given timestamp: {:?} (~{} tokens). \
                         Fetch just those with action=section; re-reading unchanged sections wastes tokens.",
                        changed_keys, changed_tokens
                    ),
                    None =>
                        "Fetch bodies with action=section and section_keys=[...]; batch the keys you need in one call. \
                         Tip: pass `since` (ms epoch of your last analysis) to see which sections changed and read only those."
                            .to_string(),
                };

                let mut out = json!({
                    "packId": pack.id,
                    "scopeId": pack.scope_id,
                    "moduleId": pack.module_id,
                    "scopeLabel": pack.scope_label,
                    "generatedAt": pack.generated_at,
                    "totalTokenEstimate": pack.token_estimate,
                    "digest": pack.digest,
                    "truncatedSections": pack.truncated_sections,
                    "sections": entries,
                    "hint": hint,
                    "blindSpotSections": blind,
                    "partialSections": partial,
                    "drilldownSections": drillable,
                    "drilldownHint":
                        "Sections listed in `drilldownSections` only show a Top-N slice of their dimension; \
                         `total` is how many raw records actually exist. Before stating any project-wide count \
                         (\"there are N occurrences of X\"), verify it with the named tool and dataset — \
                         the section body alone cannot support that claim. \
                         Sections without a `drilldown` entry are NOT truncated: their body is the whole story.",
                    "dataQualityHint":
                        "Every section carries `dataQuality.status`. `unavailable`/`empty` means the underlying analysis \
                         stage did NOT produce data for this project (language unsupported, no git history, stage skipped) — \
                         a phrase like \"0 findings\" in such a section is a BLIND SPOT, not a clean bill of health. \
                         Never conclude \"there is no problem here\" from those sections; state the gap explicitly instead. \
                         `partial` means the conclusion only holds within the covered subset. \
                         Read the `coverage` section first if you need the full stage-by-stage breakdown.",
                });
                if since.is_some() {
                    out["changedSections"] = json!(changed_keys);
                    out["changedTokenEstimate"] = json!(changed_tokens);
                }

                Ok(ToolOutput {
                    success: true,
                    result: serde_json::to_string_pretty(&out).unwrap_or_default(),
                    metadata: json!({
                        "packId": pack.id,
                        "sectionCount": secs.len(),
                        "changedCount": changed_keys.len(),
                    }),
                })
            }
            "section" => {
                let pack_id = self.resolve_pack_id(&params)?;
                let mut keys = Self::parse_section_keys(&params);
                let since = Self::parse_since(&params);

                // 没点名分节但给了 since：直接取「自那时起变化的分节」。
                // 这是增量分析最省事也最省 token 的一条路——Agent 连 outline 都不用先跑。
                if keys.is_empty() {
                    if let Some(ts) = since {
                        let stamps = AiContextSectionRepo::list_stamps(&self.db, &pack_id)?;
                        keys = stamps
                            .into_iter()
                            .filter(|s| s.updated_at == 0 || s.updated_at > ts)
                            .map(|s| s.section_key)
                            .collect();
                        if keys.is_empty() {
                            return Ok(ToolOutput {
                                success: true,
                                result: json!({
                                    "packId": pack_id,
                                    "sections": [],
                                    "changedSections": [],
                                    "hint": "No section changed since the given timestamp — the previous analysis is still current. \
                                             Reuse your recorded insights instead of re-reading the pack.",
                                })
                                .to_string(),
                                metadata: json!({ "packId": pack_id, "returned": 0, "unchanged": true }),
                            });
                        }
                    }
                }

                if keys.is_empty() {
                    return Err(
                        "section_keys (array) or section_key (string) is required for action=section \
                         (alternatively pass `since` to fetch exactly the sections that changed). \
                         Call action=outline first to see which keys exist."
                            .to_string(),
                    );
                }

                let mut found: Vec<Value> = Vec::with_capacity(keys.len());
                let mut missing: Vec<String> = Vec::new();
                let mut tokens: i64 = 0;
                for key in &keys {
                    match AiContextSectionRepo::get_section(&self.db, &pack_id, key)? {
                        Some(s) => {
                            tokens += s.token_estimate;
                            found.push(json!({
                                "key": s.section_key,
                                "title": s.title,
                                "summary": s.summary,
                                "content": s.content,
                                "tokenEstimate": s.token_estimate,
                                "priority": s.priority,
                                "facts": serde_json::from_str::<Value>(&s.facts_json).unwrap_or(Value::Null),
                                "dataQuality": Self::parse_data_quality(&s.data_quality_json),
                                "digest": s.digest,
                                "updatedAt": s.updated_at,
                            }));
                        }
                        None => missing.push(key.clone()),
                    }
                }

                if found.is_empty() {
                    // 一个都没命中：把可用键回给 Agent，让它一次纠正而不是反复试错
                    let available: Vec<String> =
                        AiContextSectionRepo::list_by_pack(&self.db, &pack_id)?
                            .into_iter()
                            .map(|s| s.section_key)
                            .collect();
                    return Ok(ToolOutput {
                        success: false,
                        result: format!(
                            "None of the requested sections {:?} exist in pack '{}'. Available keys: {:?}",
                            keys, pack_id, available
                        ),
                        metadata: json!({ "packId": pack_id, "available": available }),
                    });
                }

                // 取回的分节里若有盲区，就地再警示一次。
                // 目录里提醒过一次不够——正文进了上下文之后，模型记住的往往是正文那句
                // 「未发现 X」，警示必须贴着正文一起送达才拦得住。
                let returned_blind: Vec<&Value> = found
                    .iter()
                    .filter(|s| {
                        matches!(
                            s["dataQuality"]["status"].as_str(),
                            Some("unavailable") | Some("empty")
                        )
                    })
                    .collect();
                let blind_keys: Vec<String> = returned_blind
                    .iter()
                    .filter_map(|s| s["key"].as_str().map(|k| k.to_string()))
                    .collect();

                let mut out = json!({
                    "packId": pack_id,
                    "sections": found,
                    "missingSections": missing,
                });
                if !blind_keys.is_empty() {
                    out["blindSpotWarning"] = json!(format!(
                        "These sections have NO usable data: {:?}. Their \"0 / none found\" wording is a blind spot, \
                         not a conclusion — report the gap instead of declaring the project healthy on those dimensions.",
                        blind_keys
                    ));
                }
                Ok(ToolOutput {
                    success: true,
                    result: serde_json::to_string_pretty(&out).unwrap_or_default(),
                    metadata: json!({
                        "packId": pack_id,
                        "returned": found.len(),
                        "missing": missing.len(),
                        "tokenEstimate": tokens,
                    }),
                })
            }
            other => Err(format!(
                "Unknown action '{}'. Use outline|section|list|get (start with outline).",
                other
            )),
        }
    }
}

// ─── context_insight: 把分析结论回写进项目分析（闭合「扫描 → AI 分析 → 沉淀」）───
//
// 只读上下文是半条链：Agent 读完扫描数据给出结论，结论散在对话里，
// 人看不到、下一次分析也用不上，每次都得从零重算（既烧 token 又反复给同样的建议）。
// 本工具让 Agent 把结论写回 ai_insights 表：
//   · save —— 结论落库，带位置引用（文件:行号），UI 可展示、可点击定位；
//   · list —— 先读历史洞察，已给过的结论不必重复给，做真正的增量分析。
//
// 与 project_context 同样的原则：不绑定任何具体 Agent / 模型 / prompt，
// 用哪个 Agent 由用户在前端配置（tool_ids）决定。

pub struct ContextInsightTool {
    db: Arc<Database>,
}

impl ContextInsightTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// 归一化严重度，非法值退化为 info（宁可降级也不要因为拼写让整条链失败）
    fn normalize_severity(raw: Option<&str>) -> String {
        match raw.unwrap_or("info").trim().to_lowercase().as_str() {
            "critical" | "blocker" => "critical",
            "high" | "major" => "high",
            "medium" | "moderate" | "warning" => "medium",
            "low" | "minor" => "low",
            _ => "info",
        }
        .to_string()
    }

    /// 归一化洞察类型，便于 UI 分组与后续检索
    fn normalize_kind(raw: Option<&str>) -> String {
        match raw.unwrap_or("finding").trim().to_lowercase().as_str() {
            "recommendation" | "suggestion" => "recommendation",
            "risk" => "risk",
            "summary" | "overview" => "summary",
            "roadmap" | "plan" => "roadmap",
            _ => "finding",
        }
        .to_string()
    }

    fn parse_refs(params: &Value) -> Vec<String> {
        if let Some(arr) = params["refs"].as_array() {
            return arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        if let Some(raw) = params["refs"].as_str() {
            return raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        Vec::new()
    }

    /// 引用全军覆没时回给 Agent 的拒绝信。
    ///
    /// 这封信要同时做到三件事，少一件都会让下一轮原样重犯：
    ///   ① 明说**没有保存**（含糊其辞会让模型以为成功了，转头去写总结）；
    ///   ② 逐条点名错在哪、最接近的真实路径是什么（只否定不给路，模型只会再编一个）；
    ///   ③ 给两条出路——改成真实路径重提交，或干脆不带 refs 保存成全局结论。
    fn render_ref_rejection(verdict: &RefVerdict) -> String {
        let mut lines: Vec<String> = Vec::new();
        lines.push(
            "NOT SAVED. Every path in `refs` was checked against the files this scan actually \
             found, and none of them exists. A conclusion pinned to invented locations is worse \
             than no conclusion: the user clicks it and lands nowhere."
                .to_string(),
        );
        for c in verdict.rejected() {
            if c.candidates.is_empty() {
                lines.push(format!("  · `{}` → no such file in the scan", c.raw));
            } else {
                lines.push(format!(
                    "  · `{}` → no such file. Closest real paths: {}",
                    c.raw,
                    c.candidates
                        .iter()
                        .map(|p| format!("`{}`", p))
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
        lines.push(
            "Fix it one of two ways: (a) re-send with paths you can actually see in the context \
             sections / `code_search` / `scan_records` results — copy them verbatim, do not retype \
             from memory; or (b) drop `refs` entirely and save it as a project-wide conclusion. \
             Do not guess a third path."
                .to_string(),
        );
        lines.join("\n")
    }

    /// 保存成功但引用被修正/部分丢弃时的回执，让 Agent 下一轮自己写对。
    fn render_ref_feedback(verdict: &RefVerdict) -> String {
        let mut out = String::new();
        let corrected = verdict.corrected();
        if !corrected.is_empty() {
            out.push_str("\nRefs corrected on save: ");
            out.push_str(
                &corrected
                    .iter()
                    .map(|c| format!("`{}` → `{}`（{}）", c.raw, c.normalized, c.note))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
        }
        let rejected = verdict.rejected();
        if !rejected.is_empty() {
            out.push_str("\nRefs dropped (not found in this scan, so they were NOT stored): ");
            out.push_str(
                &rejected
                    .iter()
                    .map(|c| {
                        if c.candidates.is_empty() {
                            format!("`{}`", c.raw)
                        } else {
                            format!("`{}` (did you mean `{}`?)", c.raw, c.candidates[0])
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("; "),
            );
            out.push_str(
                " — cite the real paths next time so this conclusion keeps all its evidence.",
            );
        }
        out
    }

    /// 引用核验的机器可读回执（前端与后续轮次都可能要用）
    fn ref_metadata(verdict: &RefVerdict) -> Value {
        json!({
            "accepted": verdict.accepted_refs(),
            "corrected": verdict.corrected().iter().map(|c| json!({
                "raw": c.raw, "normalized": c.normalized, "status": c.status, "note": c.note,
            })).collect::<Vec<_>>(),
            "rejected": verdict.rejected().iter().map(|c| json!({
                "raw": c.raw, "candidates": c.candidates,
            })).collect::<Vec<_>>(),
        })
    }

    /// 列表默认给摘要而非全文：洞察正文可能很长，列历史时先给梗概省 token
    fn preview(body: &str, max: usize) -> String {
        let flat = body.split_whitespace().collect::<Vec<_>>().join(" ");
        if flat.chars().count() <= max {
            return flat;
        }
        let cut: String = flat.chars().take(max).collect();
        format!("{}…", cut)
    }

    /// 构建 list 输出（同步，便于单测）：在每条洞察上附上稳定性信号
    /// （seenCount / firstSeen / lastSeen / stability），并给出聚合统计，
    /// 让 Agent 一眼看出哪些结论是「跨轮反复确认的稳定发现」、哪些是本轮新结论。
    /// 归一化 freshness 过滤词：模型会写 needs_review / needsReview / fresh 等各种同义说法，
    /// 不认就退化成「不过滤」，绝不因为一个措辞差异让它拿到空列表而误以为没有待复核项。
    fn normalize_freshness_filter(raw: Option<&str>) -> Option<&'static str> {
        let s = raw?.trim().to_lowercase().replace(['-', '_', ' '], "");
        match s.as_str() {
            "stale" | "needsreview" | "changed" | "outdated" => Some("stale"),
            "orphaned" | "missing" | "gone" | "deleted" => Some("orphaned"),
            "current" | "fresh" | "valid" => Some("current"),
            "unanchored" | "norefs" => Some("unanchored"),
            "unknown" => Some("unknown"),
            _ => None,
        }
    }

    fn build_list_output(
        &self,
        analysis_id: &str,
        include_body: bool,
        limit: usize,
        freshness_filter: Option<&str>,
        include_resolved: bool,
    ) -> Result<Value, String> {
        let all = AiInsightRepo::list_by_analysis(&self.db, analysis_id)?;
        let resolved_count = all
            .iter()
            .filter(|r| r.status == insight_status::RESOLVED)
            .count();

        // 已收口的结论默认退出视野：留着它们，「沉淀」就会退化成一份只增不减的旧账，
        // Agent 每轮都要为已经修好的问题付一次阅读成本。
        let rows: Vec<&AiInsightRow> = all
            .iter()
            .filter(|r| include_resolved || r.status != insight_status::RESOLVED)
            .collect();
        let total = rows.len();
        let reconfirmed = rows.iter().filter(|r| r.seen_count > 1).count();

        // 时效统计永远基于（未关闭的）全量：过滤只影响返回哪些条目，不能让「待复核有几条」
        // 这种决策性数字跟着过滤器变——那会让 Agent 以为问题已经清空了。
        let count_of = |k: &str| rows.iter().filter(|r| r.freshness == k).count();
        let stale = count_of("stale");
        let orphaned = count_of("orphaned");
        let current = count_of("current");

        let want = Self::normalize_freshness_filter(freshness_filter);
        let selected: Vec<&AiInsightRow> = rows
            .iter()
            .copied()
            .filter(|r| want.map(|w| r.freshness == w).unwrap_or(true))
            .collect();

        let items: Vec<Value> = selected
            .iter()
            .take(limit)
            .map(|r| {
                json!({
                    "id": r.id,
                    "kind": r.kind,
                    "severity": r.severity,
                    "title": r.title,
                    "body": if include_body { r.body.clone() } else { Self::preview(&r.body, 160) },
                    "refs": r.refs,
                    "packId": r.pack_id,
                    "agentId": r.agent_id,
                    "seenCount": r.seen_count,
                    "firstSeen": r.first_seen,
                    "lastSeen": r.last_seen,
                    "stability": if r.seen_count > 1 { "reconfirmed" } else { "new" },
                    "freshness": r.freshness,
                    "changedRefs": r.changed_refs,
                    "missingRefs": r.missing_refs,
                    "status": r.status,
                    "resolvedReason": r.resolved_reason,
                })
            })
            .collect();

        // 复核队列独立于 limit 截断：待复核的条目是本轮最该动的东西，
        // 不能因为排在列表第 51 位就从 Agent 的视野里消失。
        let review_queue: Vec<Value> = rows
            .iter()
            .filter(|r| r.status != insight_status::RESOLVED)
            .filter(|r| r.freshness == "stale" || r.freshness == "orphaned")
            .take(12)
            .map(|r| {
                json!({
                    "id": r.id,
                    "title": r.title,
                    "severity": r.severity,
                    "freshness": r.freshness,
                    "changedRefs": r.changed_refs,
                    "missingRefs": r.missing_refs,
                })
            })
            .collect();

        let mut hint = String::new();
        if !include_body {
            hint.push_str(
                "Bodies are previews (call again with include_body=true for full text). \
                 `seenCount>1` (stability=reconfirmed) means the SAME conclusion was already recorded in earlier runs — \
                 treat it as a stable, reusable finding, prioritize acting on it, and do NOT re-save it. \
                 Only save genuinely new conclusions to keep the insight list clean. ",
            );
        }
        hint.push_str(
            "FRESHNESS tells you whether each conclusion still stands against the CURRENT code: \
             `current` = the cited files are byte-identical to when the conclusion was drawn (do not re-analyse, do not re-save); \
             `stale` = at least one cited file changed since then (re-check it first — it may already be fixed, or may have gotten worse); \
             `orphaned` = every cited file is gone (the code was deleted or moved; confirm and say so explicitly); \
             `unanchored` = the conclusion has no usable refs, so it can never be verified — avoid producing more of these; \
             `unknown` = no basis for comparison. Spend this run's budget on `stale` + `orphaned` and on genuinely unexplored ground; \
             re-deriving `current` conclusions is pure waste. You can fetch just those with action=list and freshness=stale. ",
        );
        hint.push_str(
            "CLOSE THE LOOP: when you re-check a `stale`/`orphaned` conclusion and find it no longer holds \
             (the code was fixed, deleted or refactored away), call action=resolve with a short reason instead of \
             silently ignoring it. Resolved conclusions leave the list and stop costing you tokens on every later run. \
             Never resolve something you have not actually verified in the current code — and if a resolved problem \
             ever comes back, simply save it again: it reopens automatically.",
        );

        Ok(json!({
            "analysisId": analysis_id,
            "total": total,
            "returned": items.len(),
            "filteredBy": want,
            "matched": selected.len(),
            "reconfirmed": reconfirmed,
            "newCount": total.saturating_sub(reconfirmed),
            "resolvedCount": resolved_count,
            "includesResolved": include_resolved,
            "freshnessSummary": {
                "current": current,
                "stale": stale,
                "orphaned": orphaned,
                "needsReview": stale + orphaned,
            },
            "reviewQueue": review_queue,
            "insights": items,
            "hint": hint,
        }))
    }
}

#[async_trait]
impl AgentTool for ContextInsightTool {
    fn name(&self) -> &str {
        "context_insight"
    }

    fn description(&self) -> &str {
        "Persist your analysis conclusions back into the project analysis, and read back previously saved ones. \
         Use `action=list` BEFORE analysing so you can build on earlier conclusions instead of repeating them \
         (this is how incremental analysis stays cheap), and `action=save` AFTER analysing to record each actionable \
         conclusion so the user sees it in the UI and future runs can reuse it. \
         Save one insight per distinct conclusion — keep the title short and put the reasoning plus concrete \
         remediation steps in the body, with `refs` pointing at exact locations like `src/foo/bar.ts:120`. \
         WHERE YOUR CONCLUSIONS END UP: saved insights are not just chat output — they are pinned as badges on the \
         project canvas and printed into the exported analysis report (HTML/JSON/SVG) that the user hands to their team. \
         EVERY path in `refs` is verified against the files actually discovered by the scan AT SAVE TIME: if none of \
         your refs matches a scanned file the save is REJECTED outright and you get the closest real paths back to \
         retry with; if only some are wrong they are silently dropped and named in the response. A bare filename that \
         is unique in the project is auto-aligned to its full path, and a line number past the end of the file is \
         discarded. So never invent or guess a path — cite only locations you have actually seen in the context \
         sections or via the code/symbol lookup tools, and omit `refs` entirely rather than filling it with \
         plausible-looking paths. \
         REFS ALSO DECIDE WHETHER A CONCLUSION CAN EVER EXPIRE: the exact content of every cited file is frozen when you \
         save, and compared against the code on every later scan. A conclusion with good refs comes back to you marked \
         `stale` the moment its code changes; a conclusion without refs is `unanchored` and will haunt the list forever \
         because nothing can ever prove it resolved. Cite precisely and you make your own future runs cheaper."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "save", "resolve"],
                    "description": "list = read previously saved insights for an analysis; save = persist a new insight; resolve = close a conclusion you verified is no longer true"
                },
                "analysis_id": {
                    "type": "string",
                    "description": "analysisId (the scan scope this insight belongs to). Required."
                },
                "title": {
                    "type": "string",
                    "description": "short headline of the conclusion (action=save)"
                },
                "body": {
                    "type": "string",
                    "description": "full reasoning and concrete remediation steps, markdown allowed (action=save)"
                },
                "kind": {
                    "type": "string",
                    "enum": ["finding", "recommendation", "risk", "summary", "roadmap"],
                    "description": "insight category, defaults to finding (action=save)"
                },
                "severity": {
                    "type": "string",
                    "enum": ["critical", "high", "medium", "low", "info"],
                    "description": "impact level, defaults to info (action=save)"
                },
                "refs": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "location references such as `src/foo/bar.ts:120` so the UI can jump straight to the code (action=save)"
                },
                "pack_id": {
                    "type": "string",
                    "description": "context pack this insight was derived from, e.g. `abc123:project-scan` (action=save, optional)"
                },
                "include_body": {
                    "type": "boolean",
                    "description": "action=list: return full bodies instead of previews. Defaults to false to save tokens."
                },
                "limit": {
                    "type": "integer",
                    "description": "action=list: max insights to return, defaults to 20"
                },
                "freshness": {
                    "type": "string",
                    "enum": ["stale", "orphaned", "current", "unanchored", "unknown"],
                    "description": "action=list: return only conclusions in this freshness state. Use `stale` to pull exactly the conclusions whose cited code changed since they were drawn — that is the cheapest way to spend a run's budget on what actually moved."
                },
                "include_resolved": {
                    "type": "boolean",
                    "description": "action=list: also return conclusions already closed. Defaults to false — closed items are settled history and re-reading them wastes tokens."
                },
                "insight_id": {
                    "type": "string",
                    "description": "action=resolve: id of the conclusion to close (take it from action=list). If you only have the exact title, pass it here instead — but ids are unambiguous."
                },
                "reason": {
                    "type": "string",
                    "description": "action=resolve: REQUIRED. One sentence stating what you verified in the current code, e.g. `the duplicated loader was merged in src/config/load.ts:1-40`. A close without evidence is just hiding the problem."
                }
            },
            "required": ["action", "analysis_id"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let action = params["action"]
            .as_str()
            .ok_or("action is required (list|save|resolve)")?;
        let analysis_id = params["analysis_id"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("analysis_id is required")?;

        match action {
            "list" => {
                let include_body = params["include_body"].as_bool().unwrap_or(false);
                let limit = params["limit"].as_u64().unwrap_or(20).clamp(1, 200) as usize;
                let payload = self.build_list_output(
                    analysis_id,
                    include_body,
                    limit,
                    params["freshness"].as_str(),
                    params["include_resolved"].as_bool().unwrap_or(false),
                )?;
                Ok(ToolOutput {
                    success: true,
                    result: serde_json::to_string_pretty(&payload).unwrap_or_default(),
                    metadata: json!({
                        "analysisId": analysis_id,
                        "total": payload["total"],
                        "reconfirmed": payload["reconfirmed"],
                        "needsReview": payload["freshnessSummary"]["needsReview"],
                        "resolvedCount": payload["resolvedCount"],
                    }),
                })
            }
            // 复核之后的收口动作。没有它，时效判定越准，面板上的旧账反而越厚。
            "resolve" => {
                let locator = params["insight_id"]
                    .as_str()
                    .or_else(|| params["id"].as_str())
                    .or_else(|| params["title"].as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or("insight_id is required for action=resolve (get it from action=list)")?;
                let reason = params["reason"]
                    .as_str()
                    .or_else(|| params["body"].as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or(
                        "reason is required for action=resolve — state what you verified in the current code",
                    )?;

                // 关闭者：Agent 自报的 id，没有就记成通用 agent（与 save 的口径一致）
                let by = params["agent_id"]
                    .as_str()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("agent");
                let id = AiInsightRepo::resolve(&self.db, analysis_id, locator, reason, by)?;
                Ok(ToolOutput {
                    success: true,
                    result: json!({
                        "resolved": true,
                        "insightId": id,
                        "reason": reason,
                        "hint": "Closed. It no longer appears in list/reviewQueue and stops costing tokens. \
                                 If the same problem shows up again later, just save it — it reopens automatically.",
                    })
                    .to_string(),
                    metadata: json!({ "analysisId": analysis_id, "insightId": id }),
                })
            }
            "save" => {
                let title = params["title"]
                    .as_str()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or("title is required for action=save")?;
                let body = params["body"]
                    .as_str()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or("body is required for action=save")?;

                // 落库守门：引用必须在这次扫描真见过的文件里，否则当场退回让 Agent 改正。
                // 事后在报告里标 UNVERIFIED 只是止损——那时结论已经沉淀进项目、
                // 还会在后续轮次被反复重新确认，纠偏成本反而更高。
                let raw_refs = Self::parse_refs(&params);
                let verdict = AiInsightRepo::verify_refs_for(&self.db, analysis_id, &raw_refs)?;
                if verdict.all_rejected() {
                    return Err(Self::render_ref_rejection(&verdict));
                }
                let checked_refs = verdict.accepted_refs();

                let row = AiInsightRow {
                    id: format!("ins_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
                    pack_id: params["pack_id"]
                        .as_str()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty()),
                    analysis_id: analysis_id.to_string(),
                    agent_id: params["agent_id"]
                        .as_str()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty()),
                    kind: Self::normalize_kind(params["kind"].as_str()),
                    title: title.to_string(),
                    body: body.to_string(),
                    severity: Self::normalize_severity(params["severity"].as_str()),
                    refs: checked_refs,
                    // G4 回扫验证：把诊断会话 id 与原始分析点类型随洞察落库，
                    // 重扫后 verify_diagnosis_insights 才能定位「这条洞察来自哪次诊断、针对什么问题」。
                    diagnosis_id: params["diagnosis_id"]
                        .as_str()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_default(),
                    source_kind: params["source_kind"]
                        .as_str()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_default(),
                    fingerprint: None,
                    seen_count: 0,
                    first_seen: 0,
                    last_seen: 0,
                    // 证据快照由仓库层按当次扫描结果冻结，工具层不参与
                    ..Default::default()
                };

                let (id, is_new) = AiInsightRepo::save_dedup(&self.db, &row)?;
                let mut message = if is_new {
                    format!(
                        "Insight saved (id={}, kind={}, severity={}, refs={} verified). It is now visible to the user in the analysis UI.",
                        id, row.kind, row.severity, row.refs.len()
                    )
                } else {
                    format!(
                        "Insight re-confirmed (id={}, kind={}, severity={}, refs={} verified). The same conclusion was already recorded for this analysis, so seen_count was incremented instead of creating a duplicate — the conclusion's stability is now visible in the UI (use context_insight action=list to see seenCount).",
                        id, row.kind, row.severity, row.refs.len()
                    )
                };
                message.push_str(&Self::render_ref_feedback(&verdict));
                if row.refs.is_empty() {
                    // 无引用不是错误（确有全局结论），但代价必须说清楚，否则模型会养成偷懒习惯
                    message.push_str(
                        "\nNote: this conclusion has no refs, so it cannot be pinned on the canvas, \
                         cannot be jumped to, and can never be proven resolved — it will stay \
                         `unanchored` forever. If any concrete location supports it, save it with refs.",
                    );
                }
                Ok(ToolOutput {
                    success: true,
                    result: message,
                    metadata: json!({
                        "id": id,
                        "analysisId": row.analysis_id,
                        "kind": row.kind,
                        "severity": row.severity,
                        "isNew": is_new,
                        "refs": Self::ref_metadata(&verdict),
                    }),
                })
            }
            other => Err(format!("Unknown action '{}'. Use list|save.", other)),
        }
    }
}

// ─── apply_change: AI 改代码（R46 P1 写回能力 → R47 P2-A 锚点补丁 + 改动台账）───

/// 应用代码修改（受控写回）。
///
/// 安全模型：
/// - 只能改当前 analysis 扫描进项目的文件（按 rel_path 查 project_files）；
/// - **优先锚点补丁**：模型给 `old_text`/`new_text`，本地在真实内容里唯一定位后替换。
///   全文覆盖（`content`）仍然保留但降级为兜底，且要过「截断护栏」——
///   让模型复述整个文件是数据丢失的主要来源（详见 `code_patch` 模块头）；
/// - 写前备份 `.bak`，并把改动登记进 `ai_code_changes` 台账（可逐条撤销）；
/// - 返回命中行号 + 上下文预览，供模型自查是否改在了它以为的位置。
///
/// 与文件监视器联动：写盘后 file-changes 事件触发前端增量重扫，
/// 用户立即看到 metrics/引用/技术债随改动更新——「AI 改 → 自动验证」闭环的第一环。
pub struct ApplyChangeTool {
    db: Arc<Database>,
}

impl ApplyChangeTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ApplyChangeTool {
    fn name(&self) -> &str {
        "apply_change"
    }

    fn description(&self) -> &str {
        "Edit a project file. PREFERRED form is an anchored patch: pass old_text (the exact snippet \
         to replace, copied verbatim from file_read) and new_text. The anchor must match exactly once \
         — if it appears multiple times, extend it with surrounding lines or pass occurrence. \
         Never re-emit the whole file unless it is small and you are rewriting it entirely (content \
         param, guarded against truncation). Only files inside the current scan are writable. \
         The previous version is backed up to .bak and every edit is recorded so the user can review \
         or undo it. Returns the affected line range plus a context preview — check it to confirm the \
         edit landed where you intended. After writing, the project auto-rescans the file."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Relative path of the file in the project (must exist in the scan)"
                },
                "old_text": {
                    "type": "string",
                    "description": "PREFERRED. Exact original snippet to replace (verbatim, including indentation). Must occur exactly once in the file — include a few surrounding lines to make it unique."
                },
                "new_text": {
                    "type": "string",
                    "description": "Replacement for old_text. Use an empty string to delete the snippet."
                },
                "occurrence": {
                    "type": "integer",
                    "description": "1-based index to disambiguate when old_text intentionally occurs multiple times. Omit unless a previous call reported ambiguity."
                },
                "content": {
                    "type": "string",
                    "description": "FALLBACK ONLY: complete new content of the file (whole-file rewrite). Rejected if it looks truncated. Prefer old_text/new_text."
                },
                "reason": {
                    "type": "string",
                    "description": "Why this change is applied (shown to the user in the change review list)"
                },
                "analysis_id": analysis_id_param()
            },
            "required": ["file_path"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let rel_path = params["file_path"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("file_path is required")?;
        let old_text = params["old_text"].as_str().unwrap_or("");
        let new_text_given = params.get("new_text").and_then(|v| v.as_str());
        let full_content = params["content"].as_str();
        let reason = params["reason"].as_str().unwrap_or("").trim().to_string();
        let occurrence = params["occurrence"]
            .as_u64()
            .map(|n| n as usize)
            .filter(|n| *n > 0);

        let scope = resolve_scope(&self.db, &params)?;

        // 1) 查文件（必须存在于扫描）——查完立刻释放 DB 锁，后面要做文件 IO 和台账写入
        let file_info: Option<(String, String)> = {
            let conn = self.db.0.lock().map_err(|e| e.to_string())?;
            let x = conn
                .prepare(
                    "SELECT id, path FROM project_files
                     WHERE analysis_id = ?1 AND rel_path = ?2 AND is_directory = 0
                     LIMIT 1",
                )
                .map_err(|e| e.to_string())?
                .query_row(rusqlite::params![scope.analysis_id, rel_path], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .ok();
            x
        };
        let (file_id, abs_path) = match file_info {
            Some(v) => v,
            None => {
                return Ok(ToolOutput {
                    success: false,
                    result: format!(
                        "File '{}' not found in this scan. Paths are project-relative \
                         (e.g. 'src/foo/bar.ts'). Use code_search / symbol_lookup to discover it.",
                        rel_path
                    ),
                    metadata: json!({ "scope": scope.to_json() }),
                })
            }
        };

        // 2) 项目根安全校验：绝对路径必须在项目根内
        let root = PathBuf::from(&scope.project_root);
        let abs = PathBuf::from(&abs_path);
        let abs_norm = abs.canonicalize().unwrap_or(abs.clone());
        if !abs_norm.starts_with(&root) {
            return Err(format!(
                "Refusing to write outside project root: {} (root: {})",
                abs_norm.display(),
                root.display()
            ));
        }

        // 3) 读原文（补丁模式必须有原文；文件不存在时只允许全文写入=新建）
        let before = match std::fs::read_to_string(&abs_norm) {
            Ok(s) => Some(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("read failed: {}", e)),
        };

        // 4) 决定写什么。补丁优先；两种参数都没给时不猜，直接把用法回给模型。
        let (next_content, mode, start_line, end_line, approx, anchor_old, anchor_new) =
            if !old_text.is_empty() {
                let current = match before.as_deref() {
                    Some(c) => c,
                    None => {
                        return Ok(ToolOutput {
                            success: false,
                            result: format!(
                                "File '{}' does not exist yet — an anchored patch has nothing to \
                                 match against. Pass content to create the file.",
                                rel_path
                            ),
                            metadata: json!({ "path": rel_path }),
                        })
                    }
                };
                let new_text = new_text_given.unwrap_or("");
                match apply_patch(current, old_text, new_text, occurrence) {
                    Ok(res) => (
                        res.content,
                        "patch",
                        res.start_line as i64,
                        res.end_line as i64,
                        res.approx,
                        old_text.to_string(),
                        new_text.to_string(),
                    ),
                    Err(e) => {
                        // 定位失败不是系统错误，是模型可以自我纠正的问题：
                        // 回一句能指出下一步动作的话，比 "patch failed" 有用得多。
                        // 附加位置证据（每处命中在第几行 / 最接近的候选差在哪），
                        // 让模型在这一条回执里就能改对，不用再花一次 file_read 去找。
                        let hint = match &e {
                            crate::plugins::ai_agent::code_patch::PatchError::NotFound
                            | crate::plugins::ai_agent::code_patch::PatchError::Ambiguous(_) => {
                                locate_hint(current, old_text)
                            }
                            _ => LocateHint::default(),
                        };
                        return Ok(ToolOutput {
                            success: false,
                            result: e.message_with_hint(rel_path, &hint),
                            metadata: json!({
                                "path": rel_path,
                                "stage": "locate",
                                "occurrenceLines": hint.occurrences.iter().map(|s| s.line_no).collect::<Vec<_>>(),
                                "candidateLines": hint.candidates.iter().map(|c| c.line_no).collect::<Vec<_>>(),
                            }),
                        });
                    }
                }
            } else if let Some(content) = full_content {
                if let Some(current) = before.as_deref() {
                    if let Some(why) = full_write_guard(current, content) {
                        return Ok(ToolOutput {
                            success: false,
                            result: why,
                            metadata: json!({ "path": rel_path, "stage": "guard" }),
                        });
                    }
                    if current == content {
                        return Ok(ToolOutput {
                            success: false,
                            result: format!(
                                "content is identical to the current '{}' — nothing to write.",
                                rel_path
                            ),
                            metadata: json!({ "path": rel_path, "stage": "guard" }),
                        });
                    }
                }
                let lines = content.lines().count() as i64;
                (
                    content.to_string(),
                    "full",
                    1,
                    lines.max(1),
                    false,
                    String::new(),
                    String::new(),
                )
            } else {
                return Ok(ToolOutput {
                    success: false,
                    result: format!(
                        "Nothing to apply to '{}'. Provide old_text + new_text (preferred: exact \
                         snippet replacement), or content for a whole-file rewrite.",
                        rel_path
                    ),
                    metadata: json!({ "path": rel_path, "stage": "params" }),
                });
            };

        // 5) 备份 .bak（保留既有行为：手动恢复的最后一道兜底）+ 写盘
        if let Some(current) = before.as_deref() {
            let ext = abs_norm
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();
            let bak = abs_norm.with_extension(format!("{}.bak", ext));
            std::fs::write(&bak, current).map_err(|e| e.to_string())?;
        }
        std::fs::write(&abs_norm, &next_content).map_err(|e| format!("write failed: {}", e))?;

        let old_lines = before.as_deref().map(|c| c.lines().count());
        let new_lines = next_content.lines().count();
        let delta = new_lines as i64 - old_lines.unwrap_or(0) as i64;

        // 6) 登记台账（AI 自己写的改动进 pending：等人过目再确认/撤销）。
        //    登记失败不回滚写盘——盘已经改了，谎报失败会让模型重复尝试；
        //    只在回执里说明「这条改动未进评审列表」，用户仍可用 .bak 兜底。
        let change = NewCodeChange {
            analysis_id: scope.analysis_id.clone(),
            file_id: file_id.clone(),
            rel_path: rel_path.to_string(),
            abs_path: abs_norm.to_string_lossy().to_string(),
            mode: mode.to_string(),
            origin: "agent".to_string(),
            reason: reason.clone(),
            old_text: anchor_old,
            new_text: anchor_new,
            before_content: before.as_deref().and_then(ChangeLedger::snapshot_or_none),
            after_content_hash: content_hash(&next_content),
            before_lines: old_lines.unwrap_or(0) as i64,
            after_lines: new_lines as i64,
            start_line,
            end_line,
            approx,
            conversation_id: String::new(),
            status: "pending".to_string(),
        };
        let change_id = ChangeLedger::record(&self.db, &change).ok();

        let preview_end = if mode == "patch" {
            // 补丁模式回执要覆盖「替换后」的行范围，否则多行替换的预览会截断
            let grown = new_lines as i64 - old_lines.unwrap_or(0) as i64;
            (end_line + grown.max(0)).max(start_line) as usize
        } else {
            end_line.min(start_line + 40) as usize
        };
        let preview = patch_preview(&next_content, start_line as usize, preview_end);

        Ok(ToolOutput {
            success: true,
            result: format!(
                "Edited '{}' ({} mode){}. Lines {}–{} affected; file total {} → {} ({}). \
                 {}Backup: {}.bak\n\nResulting code:\n{}\nThe project auto-rescans this file — \
                 check metrics / review / references for findings introduced by this edit. \
                 The user sees this edit in the change review list and can undo it.",
                rel_path,
                mode,
                if approx {
                    " [anchor matched after normalizing trailing whitespace — verify the range below]"
                } else {
                    ""
                },
                start_line,
                preview_end,
                old_lines.unwrap_or(0),
                new_lines,
                if delta >= 0 {
                    format!("+{}", delta)
                } else {
                    delta.to_string()
                },
                if change_id.is_none() {
                    "(warning: this edit could not be recorded in the review list) "
                } else {
                    ""
                },
                abs_norm.display(),
                preview,
            ),
            metadata: json!({
                "fileId": file_id,
                "path": rel_path,
                "mode": mode,
                "changeId": change_id,
                "startLine": start_line,
                "endLine": preview_end,
                "approx": approx,
                "oldLines": old_lines,
                "newLines": new_lines,
                "deltaLines": delta,
            }),
        })
    }
}

// ─── 工具注册工厂 ───

// ─── run_command: 在沙箱化的项目目录中执行终端命令（Agent 模式专有能力）───
//
// 安全模型（对标 VS Code 的 Agent 终端能力，但更保守）：
//  - **能力门控**：本工具只在 Agent 的 `tool_ids` 显式包含 `run_command` 时才被注册
//    （与 apply_change 同机制），任何默认 Agent 都拿不到它——用户必须在助手设置里手动开启。
//  - **危险命令黑名单**：匹配破坏性 / 提权 / 远程代码执行模式的命令直接拒绝，绝不执行。
//  - **超时**：默认 30s、上限 120s，超时杀进程，防止失控跑飞。
//  - **目录锁定**：cwd 只能是项目根或其下子目录，拒绝 `..` 越界。
//  - **输出截断**：stdout/stderr 合计截断到 20KB，避免把巨型日志灌进上下文。

/// 危险命令黑名单：命中即拒绝执行。返回拒绝原因文案（英文，进入模型上下文）。
fn denied_command_reason(cmd: &str) -> Option<&'static str> {
    let s = cmd.to_lowercase();
    let s = s.trim();

    // 远程代码执行：把下载内容管道给 shell / sudo（最常见的供应链投毒路径）
    for p in [
        "| sh",
        "|sh",
        "| bash",
        "|bash",
        "| zsh",
        "|zsh",
        "|sudo",
        "| sudo",
        "$(curl",
        "$(curl ",
        "$(wget",
        "$(wget ",
        "eval $(curl",
        "eval $(wget",
    ] {
        if s.contains(p) {
            return Some(
                "piping downloaded content to a shell / sudo (remote code execution risk)",
            );
        }
    }

    // 提权
    if s.starts_with("sudo ") || s == "sudo" {
        return Some("privilege escalation via sudo");
    }

    // 文件系统破坏性操作（带边界判断，避免误伤 `rm -rf /tmp` 这类常规清理）
    let destructive = [
        "rm -rf /",
        "rm -rf ~",
        "rm -rf /*",
        "mkfs",
        "dd if=",
        "shutdown",
        "reboot",
        "poweroff",
        ":(){",
        "> /dev/sd",
        "chmod 777 /",
        "chmod -r 777 /",
        "chmod -R 777 /",
        "truncate -s 0 /",
    ];
    for p in destructive {
        if contains_with_boundary(&s, p) {
            return Some("destructive filesystem operation");
        }
    }

    None
}

/// 含 `needle` 且其后紧跟非单词字符（或字符串结尾）才视为命中——
/// 用于区分 `rm -rf /`（删根，拒）与 `rm -rf /tmp`（删临时目录，不拦）。
fn contains_with_boundary(lower: &str, needle: &str) -> bool {
    if let Some(idx) = lower.find(needle) {
        let after = idx + needle.len();
        match lower.chars().nth(after) {
            None => true,
            Some(c) => !c.is_alphanumeric(),
        }
    } else {
        false
    }
}

/// 超时后按 pid 强杀子进程（cross-platform：macOS/Linux 用 `kill -9`，Windows 用 `taskkill /F`）。
#[cfg(unix)]
fn kill_child_by_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .status();
}
#[cfg(windows)]
fn kill_child_by_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .status();
}

pub struct RunCommandTool {
    db: Arc<Database>,
}

impl RunCommandTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for RunCommandTool {
    fn name(&self) -> &str {
        "run_command"
    }

    fn description(&self) -> &str {
        "Run a shell command in the project root directory (e.g. build, test, lint, format). \
         Returns combined stdout/stderr and the exit code. Subject to a destructive-command \
         denylist (rm -rf /, sudo, disk format, pipe-to-shell RCE, etc. are refused) and a timeout. \
         Use it to verify your edits actually compile/test, then iterate. Prefer scoped commands \
         over broad ones; never run a command you cannot fully explain."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to run via `sh -c` (POSIX). e.g. `npm test`, `cargo build`, `pnpm lint`."
                },
                "cwd": {
                    "type": "string",
                    "description": "Optional project-relative subdirectory to run in (default: project root). '..' traversal is rejected."
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Optional timeout in ms (default 30000, max 120000)."
                }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let command = params["command"]
            .as_str()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("command is required")?;

        if let Some(reason) = denied_command_reason(command) {
            return Ok(ToolOutput {
                success: false,
                result: format!(
                    "[run_command] REFUSED — {reason}.\nThis command matches a protected pattern and was not executed. \
                     If you need a similar but safe operation, rephrase it (e.g. target a specific directory, avoid sudo / pipe-to-shell)."
                ),
                metadata: json!({ "refused": true, "reason": reason }),
            });
        }

        let scope = resolve_scope(&self.db, &params)?;
        let root = PathBuf::from(&scope.project_root);
        if !root.exists() {
            return Ok(ToolOutput {
                success: false,
                result: format!(
                    "[run_command] Project root not found on disk: {}\nThe scan that backs this analysis may have been removed.",
                    scope.project_root
                ),
                metadata: json!({ "refused": true, "reason": "project_root_missing" }),
            });
        }

        let cwd = if let Some(sub) = params["cwd"].as_str().filter(|s| !s.is_empty()) {
            let sub = sub.trim().trim_start_matches('/');
            if sub.contains("..") {
                return Ok(ToolOutput {
                    success: false,
                    result: "[run_command] REFUSED — cwd must not contain '..' (directory traversal blocked)."
                        .to_string(),
                    metadata: json!({ "refused": true, "reason": "traversal" }),
                });
            }
            let p = root.join(sub);
            if !p.starts_with(&root) {
                return Ok(ToolOutput {
                    success: false,
                    result: "[run_command] REFUSED — cwd escapes the project root.".to_string(),
                    metadata: json!({ "refused": true, "reason": "escape" }),
                });
            }
            p
        } else {
            root.clone()
        };

        let timeout_ms = params["timeout_ms"]
            .as_i64()
            .unwrap_or(30000)
            .clamp(1000, 120000) as u64;

        let mut child = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(&cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("[run_command] Failed to spawn process: {e}"))?;
        // wait_with_output 会消费 child，故先取 pid 以便超时分支按 pid 强杀（cross-platform）。
        let pid = child.id().unwrap_or(0);

        let deadline = std::time::Duration::from_millis(timeout_ms);
        let output = match tokio::time::timeout(deadline, child.wait_with_output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                return Ok(ToolOutput {
                    success: false,
                    result: format!("[run_command] Wait error: {e}"),
                    metadata: json!({ "error": e.to_string() }),
                })
            }
            Err(_) => {
                kill_child_by_pid(pid);
                return Ok(ToolOutput {
                    success: false,
                    result: format!(
                        "[run_command] Timed out after {timeout_ms}ms; process (pid {pid}) killed."
                    ),
                    metadata: json!({ "timed_out": true }),
                });
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);
        let success = output.status.success();

        let mut combined = String::with_capacity(stdout.len() + stderr.len() + 1);
        combined.push_str(&stdout);
        if !stderr.is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(&stderr);
        }
        let truncated = combined.len() > 20000;
        let capped = if truncated {
            format!(
                "{}...\n[output truncated at 20000 chars]",
                &combined[..20000]
            )
        } else {
            combined
        };

        Ok(ToolOutput {
            success,
            result: format!(
                "[run_command] cwd={}\n$ {}\nexit_code={}\n{}",
                cwd.display(),
                command,
                exit_code,
                capped
            ),
            metadata: json!({
                "exit_code": exit_code,
                "cwd": cwd.to_string_lossy(),
                "command": command,
                "truncated": truncated
            }),
        })
    }
}

// ─── 写作域工具：read_chapter / list_chapters / read_character_card ───
// 这三个工具是「AI 助手与写作业务契合」改造的 P1 专用工具集：让 /ai 全页助手在写作
// 场景下能按需拿到章节全文 / 章节目录 / 人设卡，而不是被代码分析工具牵引着去读「项目」。
// 数据统一走 WritingRepository（与 Tauri command 层同源，口径零第二份）。

/// read_chapter 单次返回正文的最大字符数（对标 file_read 的预算自设界：长章截断并给出提示，
/// 不让模型用一次调用把整本书灌进上下文；需要更长时收窄到单章场景再读）。
const WRITING_CHAPTER_MAX_CHARS: usize = 24_000;

/// 轻量 HTML→纯文本：章节正文是 TipTap 富文本（<p>/<strong>/<em>/<br> 等），
/// 直接扔给 LLM 会把标签当成噪声；strip 掉标签并解码常见实体，压缩多余空行。
/// 不追求逐位还原富文本（LLM 只需要正文），保持无第三方依赖。
fn html_to_plain_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' {
            // 跳过整个标签（含属性，直到 >）
            for n in chars.by_ref() {
                if n == '>' {
                    break;
                }
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .lines()
        .map(str::trim_end)
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// list_chapters: 列出某本书的章节（id+标题+字数+状态），不含正文——让模型先知道结构再按需读正文。
pub struct ListChaptersTool {
    db: Arc<Database>,
}

impl ListChaptersTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ListChaptersTool {
    fn name(&self) -> &str {
        "list_chapters"
    }

    fn description(&self) -> &str {
        "List all chapters of a book in writing order (id, title, word count, status, volume). \
         Returns the skeleton only — no chapter text. Use read_chapter to fetch a chapter's full text. \
         Scope by book_id (get it from the attached [Current Book] / [Current Chapter] context)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "book_id": {
                    "type": "string",
                    "description": "The book to list chapters for."
                }
            },
            "required": ["book_id"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let book_id = params["book_id"].as_str().ok_or("book_id is required")?;
        let repo = SqliteWritingRepository::new(self.db.clone());
        let book = repo.get_book(book_id).map_err(|e| e.to_string())?;
        let Some(book) = book else {
            return Ok(ToolOutput {
                success: false,
                result: format!("[list_chapters] Book {book_id} not found"),
                metadata: json!({ "bookId": book_id }),
            });
        };
        let chapters = repo.list_chapters(book_id).map_err(|e| e.to_string())?;
        let rows: Vec<String> = chapters
            .iter()
            .map(|c| {
                format!(
                    "- id={} | {} | {} 字 | {} | {}",
                    c.id,
                    c.title,
                    c.word_count,
                    if c.status.is_empty() {
                        "草稿"
                    } else {
                        &c.status
                    },
                    if c.volume.is_empty() {
                        "未分卷"
                    } else {
                        &c.volume
                    }
                )
            })
            .collect();
        Ok(ToolOutput {
            success: true,
            result: format!(
                "[list_chapters] 《{}》共 {} 章\n{}",
                book.title,
                chapters.len(),
                if rows.is_empty() {
                    "(还没有章节)".to_string()
                } else {
                    rows.join("\n")
                }
            ),
            metadata: json!({ "bookId": book_id, "chapterCount": chapters.len() }),
        })
    }
}

/// read_chapter: 读取某章全文（富文本转纯文本），带字符预算自设界。
pub struct ReadChapterTool {
    db: Arc<Database>,
}

impl ReadChapterTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ReadChapterTool {
    fn name(&self) -> &str {
        "read_chapter"
    }

    fn description(&self) -> &str {
        "Read one chapter's full text (rich text flattened to plain prose). \
         Returns title, word count, status and the chapter body. \
         Long chapters are truncated at ~24000 chars with an explicit notice. \
         Pass chapter_id from list_chapters output or from the attached [Current Chapter] context."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "chapter_id": {
                    "type": "string",
                    "description": "The chapter to read."
                }
            },
            "required": ["chapter_id"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let chapter_id = params["chapter_id"]
            .as_str()
            .ok_or("chapter_id is required")?;
        let repo = SqliteWritingRepository::new(self.db.clone());
        let chapter = repo.get_chapter(chapter_id).map_err(|e| e.to_string())?;
        let Some(chapter) = chapter else {
            return Ok(ToolOutput {
                success: false,
                result: format!("[read_chapter] Chapter {chapter_id} not found"),
                metadata: json!({ "chapterId": chapter_id }),
            });
        };
        let text = html_to_plain_text(&chapter.content);
        let length = text.chars().count();
        let truncated = length > WRITING_CHAPTER_MAX_CHARS;
        let body: String = if truncated {
            let mut s: String = text.chars().take(WRITING_CHAPTER_MAX_CHARS).collect();
            s.push_str(&format!(
                "\n\n[正文已截断：共 {length} 字，仅展示前 {WRITING_CHAPTER_MAX_CHARS} 字。]"
            ));
            s
        } else {
            text
        };
        Ok(ToolOutput {
            success: true,
            result: format!(
                "[read_chapter] 《{}》 | {} 字 | {} | 所属书 id={}\n\n{}",
                chapter.title,
                chapter.word_count,
                if chapter.status.is_empty() {
                    "草稿"
                } else {
                    &chapter.status
                },
                chapter.book_id,
                body
            ),
            metadata: json!({
                "chapterId": chapter.id,
                "bookId": chapter.book_id,
                "title": chapter.title,
                "wordCount": chapter.word_count,
                "truncated": truncated
            }),
        })
    }
}

/// read_character_card: 读取某本书的人设卡（姓名+身份+描述+结构化档案字段）。
/// 返回全部人物卡，不做截断——人物卡总量受写作台限定（非正文，单张卡体积很小）。
pub struct ReadCharacterCardTool {
    db: Arc<Database>,
}

impl ReadCharacterCardTool {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentTool for ReadCharacterCardTool {
    fn name(&self) -> &str {
        "read_character_card"
    }

    fn description(&self) -> &str {
        "List all character cards of a book (name, subtitle, description, and structured profile \
         fields like appearance / personality / motivation / catchphrase when present). \
         Use it before answering questions about a character, instead of guessing from chapter text. \
         Pass book_id from the attached [Current Book] context."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "book_id": {
                    "type": "string",
                    "description": "The book whose character cards to read."
                }
            },
            "required": ["book_id"]
        })
    }

    async fn execute(&self, params: Value) -> Result<ToolOutput, String> {
        let book_id = params["book_id"].as_str().ok_or("book_id is required")?;
        let repo = SqliteWritingRepository::new(self.db.clone());
        let book = repo.get_book(book_id).map_err(|e| e.to_string())?;
        let Some(book) = book else {
            return Ok(ToolOutput {
                success: false,
                result: format!("[read_character_card] Book {book_id} not found"),
                metadata: json!({ "bookId": book_id }),
            });
        };
        let cards = repo
            .list_settings(book_id, "character")
            .map_err(|e| e.to_string())?;
        if cards.is_empty() {
            return Ok(ToolOutput {
                success: true,
                result: format!(
                    "[read_character_card] 《{}》还没有人设卡。请基于已有正文推理人物，不要凭空设定新的人物关系。",
                    book.title
                ),
                metadata: json!({ "bookId": book_id, "count": 0 }),
            });
        }
        let rows: Vec<String> = cards
            .iter()
            .map(|c| {
                let mut lines = vec![format!(
                    "## {}（{}）",
                    c.name,
                    if c.subtitle.is_empty() {
                        "人物"
                    } else {
                        &c.subtitle
                    }
                )];
                if !c.description.is_empty() {
                    lines.push(c.description.clone());
                }
                // 结构化档案字段（extra.profile），与前端 parseSettingExtra 同口径
                if let Ok(extra) = serde_json::from_str::<Value>(&c.extra) {
                    if let Some(profile) = extra.get("profile").and_then(Value::as_object) {
                        let parts: Vec<String> = profile
                            .iter()
                            .filter(|(_, v)| v.is_string() && !v.as_str().unwrap_or("").is_empty())
                            .map(|(k, v)| format!("{k}: {}", v.as_str().unwrap_or("")))
                            .collect();
                        if !parts.is_empty() {
                            lines.push(parts.join("；"));
                        }
                    }
                    if let Some(rels) = extra.get("relations").and_then(Value::as_array) {
                        if !rels.is_empty() {
                            let rels_str: Vec<String> = rels
                                .iter()
                                .filter_map(|r| {
                                    let t = r.get("target").and_then(Value::as_str);
                                    let ty = r.get("type").and_then(Value::as_str);
                                    match (t, ty) {
                                        (Some(t), Some(ty)) => Some(format!("{t}（{ty}）")),
                                        (Some(t), None) => Some(t.to_string()),
                                        _ => None,
                                    }
                                })
                                .collect();
                            if !rels_str.is_empty() {
                                lines.push(format!("关系：{}", rels_str.join("、")));
                            }
                        }
                    }
                }
                lines.join("\n")
            })
            .collect();
        Ok(ToolOutput {
            success: true,
            result: format!(
                "[read_character_card] 《{}》共 {} 张人设卡\n\n{}",
                book.title,
                cards.len(),
                rows.join("\n\n")
            ),
            metadata: json!({ "bookId": book_id, "count": cards.len() }),
        })
    }
}

pub fn create_project_sight_tools(
    db: Arc<Database>,
    enabled_tool_ids: &[String],
) -> super::engine::ToolRegistry {
    let mut registry = super::engine::ToolRegistry::new();

    for tool_id in enabled_tool_ids {
        match tool_id.as_str() {
            "code_search" => {
                registry.register(std::sync::Arc::new(CodeSearchTool::new(db.clone())));
            }
            "file_read" => {
                registry.register(std::sync::Arc::new(FileReadTool::new(db.clone())));
            }
            "symbol_lookup" => {
                registry.register(std::sync::Arc::new(SymbolLookupTool::new(db.clone())));
            }
            "architecture_query" => {
                registry.register(std::sync::Arc::new(ArchitectureQueryTool::new(db.clone())));
            }
            "review_explain" => {
                registry.register(std::sync::Arc::new(ReviewExplainTool::new(db.clone())));
            }
            "impact_assess" => {
                registry.register(std::sync::Arc::new(ImpactAssessTool::new(db.clone())));
            }
            "project_context" => {
                registry.register(std::sync::Arc::new(ProjectContextTool::new(db.clone())));
            }
            "context_insight" => {
                registry.register(std::sync::Arc::new(ContextInsightTool::new(db.clone())));
            }
            "scan_records" => {
                registry.register(std::sync::Arc::new(ScanRecordsTool::new(db.clone())));
            }
            "apply_change" => {
                registry.register(std::sync::Arc::new(ApplyChangeTool::new(db.clone())));
            }
            "run_command" => {
                registry.register(std::sync::Arc::new(RunCommandTool::new(db.clone())));
            }
            "list_chapters" => {
                registry.register(std::sync::Arc::new(ListChaptersTool::new(db.clone())));
            }
            "read_chapter" => {
                registry.register(std::sync::Arc::new(ReadChapterTool::new(db.clone())));
            }
            "read_character_card" => {
                registry.register(std::sync::Arc::new(ReadCharacterCardTool::new(db.clone())));
            }
            _ => {}
        }
    }

    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── project_context: 分节键解析（省 token 的批量取，参数形态要足够宽容）──

    #[test]
    fn parse_section_keys_accepts_array() {
        let p = json!({ "section_keys": ["hotspots", "review", "coupling"] });
        assert_eq!(
            ProjectContextTool::parse_section_keys(&p),
            vec!["hotspots", "review", "coupling"]
        );
    }

    #[test]
    fn parse_section_keys_accepts_comma_string() {
        // 模型常把数组参数写成逗号串，这里必须兼容，否则一次工具调用白白浪费
        let p = json!({ "section_keys": "hotspots, review ,techDebt" });
        assert_eq!(
            ProjectContextTool::parse_section_keys(&p),
            vec!["hotspots", "review", "techDebt"]
        );
    }

    #[test]
    fn parse_section_keys_falls_back_to_legacy_single_key() {
        let p = json!({ "section_key": "architecture" });
        assert_eq!(
            ProjectContextTool::parse_section_keys(&p),
            vec!["architecture"]
        );
    }

    #[test]
    fn parse_section_keys_drops_empty_entries() {
        let p = json!({ "section_keys": ["hotspots", "", "  ", "review"] });
        assert_eq!(
            ProjectContextTool::parse_section_keys(&p),
            vec!["hotspots", "review"]
        );
    }

    #[test]
    fn parse_section_keys_empty_when_absent() {
        assert!(ProjectContextTool::parse_section_keys(&json!({})).is_empty());
    }

    // ── project_context: 增量分析（since）—— 只重读变化的分节才是真正省 token 的一步 ──

    #[test]
    fn parse_since_accepts_millis_and_string_form() {
        assert_eq!(
            ProjectContextTool::parse_since(&json!({ "since": 1_700_000_000_000i64 })),
            Some(1_700_000_000_000)
        );
        // 模型常把数字参数写成字符串，不兼容就等于这次增量白做
        assert_eq!(
            ProjectContextTool::parse_since(&json!({ "since": "1700000000000" })),
            Some(1_700_000_000_000)
        );
    }

    #[test]
    fn parse_since_upgrades_seconds_to_millis() {
        // 传秒级时间戳时若不放大，since 会远小于所有 updated_at，
        // 结果「全部分节都变了」——增量静默退化为全量，最难发现的那种失效
        assert_eq!(
            ProjectContextTool::parse_since(&json!({ "since": 1_700_000_000i64 })),
            Some(1_700_000_000_000)
        );
    }

    #[test]
    fn parse_since_ignores_absent_or_invalid() {
        assert_eq!(ProjectContextTool::parse_since(&json!({})), None);
        assert_eq!(
            ProjectContextTool::parse_since(&json!({ "since": 0 })),
            None
        );
        assert_eq!(
            ProjectContextTool::parse_since(&json!({ "since": "not-a-number" })),
            None
        );
    }

    fn stamped_section(key: &str, updated_at: i64) -> AiContextSectionRow {
        stamped_section_with_quality(key, updated_at, "{}")
    }

    fn stamped_section_with_quality(
        key: &str,
        updated_at: i64,
        quality: &str,
    ) -> AiContextSectionRow {
        AiContextSectionRow {
            id: format!("pack#{}", key),
            pack_id: "pack".to_string(),
            section_key: key.to_string(),
            title: key.to_string(),
            summary: "s".to_string(),
            content: "body".to_string(),
            token_estimate: 10,
            priority: 0,
            facts_json: "{}".to_string(),
            data_quality_json: quality.to_string(),
            digest: format!("h-{}", key),
            updated_at,
        }
    }

    #[test]
    fn outline_entry_marks_changed_sections_only() {
        let fresh =
            ProjectContextTool::outline_entry(&stamped_section("techDebt", 2_000), Some(1_500));
        let stale =
            ProjectContextTool::outline_entry(&stamped_section("architecture", 1_000), Some(1_500));
        assert_eq!(fresh["changedSince"], json!(true));
        assert_eq!(stale["changedSince"], json!(false));
        // 指纹要一并回传：Agent 可用它自行判重，不必依赖时间戳
        assert_eq!(fresh["digest"], json!("h-techDebt"));
        assert_eq!(fresh["updatedAt"], json!(2_000));
    }

    #[test]
    fn outline_entry_treats_unstamped_history_as_changed() {
        // updated_at = 0 表示这行是加戳之前写入的历史数据，无法证明「没变」。
        // 宁可让 Agent 多读一次，也不能让它漏掉真正更新过的分节。
        let legacy =
            ProjectContextTool::outline_entry(&stamped_section("overview", 0), Some(9_999));
        assert_eq!(legacy["changedSince"], json!(true));
    }

    #[test]
    fn outline_entry_omits_change_flag_without_since() {
        let e = ProjectContextTool::outline_entry(&stamped_section("overview", 1_000), None);
        assert!(
            e.get("changedSince").is_none(),
            "no since = no change verdict"
        );
    }

    // ── 数据可信度：区分「查过了没问题」与「压根没数据」──

    #[test]
    fn parse_data_quality_falls_back_to_ok_on_garbage() {
        // 历史行没有这一列 / JSON 写坏了，都不能让整节被误判成盲区——
        // 那会让 Agent 对本来可信的结论加上「不可信」的免责声明，反而误导人。
        assert_eq!(ProjectContextTool::quality_status(""), "ok");
        assert_eq!(ProjectContextTool::quality_status("{}"), "ok");
        assert_eq!(ProjectContextTool::quality_status("not-json"), "ok");
        assert_eq!(
            ProjectContextTool::quality_status(r#"{"observed":0}"#),
            "ok"
        );
    }

    #[test]
    fn parse_data_quality_keeps_declared_status_and_reason() {
        let raw = r#"{"status":"unavailable","observed":0,"reason":"该语言无数据流分析器"}"#;
        let q = ProjectContextTool::parse_data_quality(raw);
        assert_eq!(q["status"], json!("unavailable"));
        assert_eq!(q["reason"], json!("该语言无数据流分析器"));
        assert_eq!(ProjectContextTool::quality_status(raw), "unavailable");
    }

    #[test]
    fn outline_entry_carries_quality_so_agent_can_skip_blind_spots() {
        let blind = ProjectContextTool::outline_entry(
            &stamped_section_with_quality(
                "dataFlow",
                1_000,
                r#"{"status":"unavailable","observed":0}"#,
            ),
            None,
        );
        // 目录里就带可信度 = 几十 token 决策要不要花钱取正文
        assert_eq!(blind["dataQuality"]["status"], json!("unavailable"));

        let solid = ProjectContextTool::outline_entry(&stamped_section("techDebt", 1_000), None);
        assert_eq!(solid["dataQuality"]["status"], json!("ok"));
    }

    // ── 下钻指路：模块声明「这一节的全量记录在哪」，后端只透传 ──

    #[test]
    fn outline_entry_lifts_drilldown_to_top_level() {
        // 藏在 dataQuality 内层时模型经常读漏，而漏掉就会拿 Top-N 当全集
        let e = ProjectContextTool::outline_entry(
            &stamped_section_with_quality(
                "techDebt",
                1_000,
                r#"{"status":"ok","observed":482,"truncated":true,
                    "drilldown":{"tool":"scan_records","dataset":"techDebt","total":482}}"#,
            ),
            None,
        );
        assert_eq!(e["drilldown"]["tool"], json!("scan_records"));
        assert_eq!(e["drilldown"]["dataset"], json!("techDebt"));
        assert_eq!(e["drilldown"]["total"], json!(482));
        // 内层原样保留，两处口径必须一致
        assert_eq!(e["dataQuality"]["drilldown"]["dataset"], json!("techDebt"));
    }

    #[test]
    fn outline_entry_has_no_drilldown_when_module_did_not_declare_one() {
        // 没声明就没有——绝不能凭分节名猜一个数据集塞进去：
        // 指错路比不指路更糟，Agent 会拿另一套口径的数字当证据。
        let e = ProjectContextTool::outline_entry(&stamped_section("architecture", 1_000), None);
        assert!(e.get("drilldown").is_none());
    }

    #[test]
    fn outline_entry_ignores_malformed_drilldown() {
        // 模块写坏了（写成字符串而不是对象）不能污染目录结构
        let e = ProjectContextTool::outline_entry(
            &stamped_section_with_quality(
                "clones",
                1_000,
                r#"{"status":"ok","drilldown":"scan_records"}"#,
            ),
            None,
        );
        assert!(e.get("drilldown").is_none());
    }

    // ── context_insight: 归一化（模型给的枚举值拼写不稳定，不能因此整条链失败）──

    #[test]
    fn normalize_severity_maps_aliases() {
        assert_eq!(
            ContextInsightTool::normalize_severity(Some("BLOCKER")),
            "critical"
        );
        assert_eq!(
            ContextInsightTool::normalize_severity(Some("Major")),
            "high"
        );
        assert_eq!(
            ContextInsightTool::normalize_severity(Some("warning")),
            "medium"
        );
        assert_eq!(ContextInsightTool::normalize_severity(Some("minor")), "low");
    }

    #[test]
    fn normalize_severity_defaults_to_info() {
        assert_eq!(ContextInsightTool::normalize_severity(None), "info");
        assert_eq!(ContextInsightTool::normalize_severity(Some("wat")), "info");
    }

    #[test]
    fn normalize_kind_maps_aliases_and_defaults() {
        assert_eq!(
            ContextInsightTool::normalize_kind(Some("suggestion")),
            "recommendation"
        );
        assert_eq!(ContextInsightTool::normalize_kind(Some("plan")), "roadmap");
        assert_eq!(
            ContextInsightTool::normalize_kind(Some("overview")),
            "summary"
        );
        assert_eq!(ContextInsightTool::normalize_kind(None), "finding");
    }

    #[test]
    fn context_insight_list_exposes_stability_and_reconfirmed_count() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::infrastructure::database::migration::init_tables(&conn).unwrap();
        let db = std::sync::Arc::new(Database(std::sync::Mutex::new(conn)));

        // 同一条结论被跨轮重分析确认 3 次 → 归并成 1 行，seen_count=3
        let mut base = AiInsightRow {
            id: "ins_a".into(),
            pack_id: None,
            analysis_id: "a1".into(),
            agent_id: None,
            kind: "finding".into(),
            title: "Tight coupling in auth module".into(),
            body: "reasoning...".into(),
            severity: "high".into(),
            refs: vec!["src/auth.ts:10".into()],
            fingerprint: None,
            seen_count: 0,
            first_seen: 0,
            last_seen: 0,
            ..Default::default()
        };
        AiInsightRepo::save_dedup(&db, &base).unwrap();
        AiInsightRepo::save_dedup(&db, &base).unwrap();
        AiInsightRepo::save_dedup(&db, &base).unwrap();
        // 一条全新结论
        base.id = "ins_b".into();
        base.title = "Missing error boundary in uploader".into();
        AiInsightRepo::save_dedup(&db, &base).unwrap();

        let tool = ContextInsightTool::new(db);
        let payload = tool
            .build_list_output("a1", false, 50, None, false)
            .unwrap();
        assert_eq!(payload["total"].as_i64(), Some(2));
        assert_eq!(payload["reconfirmed"].as_i64(), Some(1));
        assert_eq!(payload["newCount"].as_i64(), Some(1));
        let ins_a = payload["insights"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["id"].as_str() == Some("ins_a"))
            .expect("ins_a present in output");
        assert_eq!(ins_a["seenCount"].as_i64(), Some(3));
        assert_eq!(ins_a["stability"].as_str(), Some("reconfirmed"));
        // first/last_seen 由 save_dedup 用真实时钟写入，应是非零时间戳
        assert!(ins_a["firstSeen"].as_i64().unwrap_or(0) > 0);
        assert!(ins_a["lastSeen"].as_i64().unwrap_or(0) > 0);
    }

    #[test]
    fn context_insight_list_reports_freshness_and_filters_review_queue() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::infrastructure::database::migration::init_tables(&conn).unwrap();
        let db = std::sync::Arc::new(Database(std::sync::Mutex::new(conn)));

        let put = |rel: &str, hash: &str| {
            let c = db.0.lock().unwrap();
            c.execute(
                "INSERT OR REPLACE INTO project_files (id, analysis_id, path, rel_path, name, content_hash, is_directory) \
                 VALUES (?1,'a1',?2,?3,?4,?5,0)",
                rusqlite::params![
                    format!("f_{}", rel.replace('/', "_")),
                    format!("/abs/{}", rel),
                    rel,
                    rel,
                    hash
                ],
            )
            .unwrap();
        };
        put("src/stable.ts", "h_stable");
        put("src/moving.ts", "h_v1");

        let mk = |id: &str, title: &str, refs: Vec<String>| AiInsightRow {
            id: id.into(),
            analysis_id: "a1".into(),
            kind: "finding".into(),
            title: title.into(),
            body: "reasoning".into(),
            severity: "high".into(),
            refs,
            ..Default::default()
        };
        AiInsightRepo::save_dedup(
            &db,
            &mk("ins_ok", "Stable one", vec!["src/stable.ts:1".into()]),
        )
        .unwrap();
        AiInsightRepo::save_dedup(
            &db,
            &mk("ins_hot", "Moving one", vec!["src/moving.ts:9".into()]),
        )
        .unwrap();

        // 下一次扫描：moving.ts 内容变了 → 该结论必须被拎出来复核
        put("src/moving.ts", "h_v2");

        let tool = ContextInsightTool::new(db);
        let all = tool
            .build_list_output("a1", false, 50, None, false)
            .unwrap();
        assert_eq!(all["freshnessSummary"]["current"].as_i64(), Some(1));
        assert_eq!(all["freshnessSummary"]["stale"].as_i64(), Some(1));
        assert_eq!(all["freshnessSummary"]["needsReview"].as_i64(), Some(1));
        assert_eq!(all["reviewQueue"].as_array().unwrap().len(), 1);
        assert_eq!(all["reviewQueue"][0]["id"].as_str(), Some("ins_hot"));

        // 过滤只影响返回条目，统计口径必须仍是全量——否则 Agent 会以为问题清空了
        let only_stale = tool
            .build_list_output("a1", false, 50, Some("needs_review"), false)
            .unwrap();
        assert_eq!(only_stale["insights"].as_array().unwrap().len(), 1);
        assert_eq!(only_stale["insights"][0]["id"].as_str(), Some("ins_hot"));
        assert_eq!(
            only_stale["insights"][0]["changedRefs"][0].as_str(),
            Some("src/moving.ts")
        );
        assert_eq!(only_stale["total"].as_i64(), Some(2));
        assert_eq!(only_stale["filteredBy"].as_str(), Some("stale"));

        // 不认识的过滤词退化成不过滤，绝不让措辞差异变成「空列表」的假象
        let garbage = tool
            .build_list_output("a1", false, 50, Some("whatever"), false)
            .unwrap();
        assert_eq!(garbage["insights"].as_array().unwrap().len(), 2);
        assert!(garbage["filteredBy"].is_null());

        // 收口之后：该结论退出列表与复核队列，只在 resolvedCount 里留一笔账
        AiInsightRepo::resolve(
            &tool.db,
            "a1",
            "ins_hot",
            "moving.ts 已重构，问题不复存在",
            "agent_x",
        )
        .unwrap();
        let after = tool
            .build_list_output("a1", false, 50, None, false)
            .unwrap();
        assert_eq!(after["total"].as_i64(), Some(1), "已关闭的结论不再占用视野");
        assert_eq!(after["resolvedCount"].as_i64(), Some(1));
        assert_eq!(after["freshnessSummary"]["needsReview"].as_i64(), Some(0));
        assert!(after["reviewQueue"].as_array().unwrap().is_empty());

        // 想回看历史仍然可以，但必须显式要——默认不为已结的账付 token
        let with_resolved = tool.build_list_output("a1", false, 50, None, true).unwrap();
        assert_eq!(with_resolved["total"].as_i64(), Some(2));
        let closed = with_resolved["insights"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["id"].as_str() == Some("ins_hot"))
            .expect("resolved insight must be visible when explicitly requested");
        assert_eq!(closed["status"].as_str(), Some("resolved"));
        assert_eq!(
            closed["resolvedReason"].as_str(),
            Some("moving.ts 已重构，问题不复存在")
        );
    }

    #[tokio::test]
    async fn context_insight_resolve_requires_reason_and_closes_by_id() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::infrastructure::database::migration::init_tables(&conn).unwrap();
        let db = std::sync::Arc::new(Database(std::sync::Mutex::new(conn)));
        let tool = ContextInsightTool::new(db);

        tool.execute(json!({
            "action": "save",
            "analysis_id": "a1",
            "title": "Dead flag still referenced",
            "body": "reasoning",
            "severity": "medium",
        }))
        .await
        .unwrap();
        let id = {
            let listed = tool
                .build_list_output("a1", false, 10, None, false)
                .unwrap();
            listed["insights"][0]["id"].as_str().unwrap().to_string()
        };

        // 没有理由的关闭必须失败：否则模型会习惯性「一键清空」，沉淀彻底失真
        assert!(tool
            .execute(json!({ "action": "resolve", "analysis_id": "a1", "insight_id": id }))
            .await
            .is_err());

        let out = tool
            .execute(json!({
                "action": "resolve",
                "analysis_id": "a1",
                "insight_id": id,
                "reason": "flag 与其引用已在本轮扫描中消失",
                "agent_id": "agent_7",
            }))
            .await
            .unwrap();
        assert!(out.success);
        let listed = tool.build_list_output("a1", false, 10, None, true).unwrap();
        assert_eq!(listed["insights"][0]["status"].as_str(), Some("resolved"));
        assert_eq!(listed["resolvedCount"].as_i64(), Some(1));
    }

    #[test]
    fn parse_refs_accepts_array_and_string() {
        let a = json!({ "refs": ["src/a.ts:10", "src/b.ts:22"] });
        assert_eq!(
            ContextInsightTool::parse_refs(&a),
            vec!["src/a.ts:10", "src/b.ts:22"]
        );
        let s = json!({ "refs": "src/a.ts:10, src/b.ts:22" });
        assert_eq!(
            ContextInsightTool::parse_refs(&s),
            vec!["src/a.ts:10", "src/b.ts:22"]
        );
    }

    // ─── 落库守门：引用核验 ───

    fn insight_tool_with_files(files: &[(&str, i64)]) -> ContextInsightTool {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::infrastructure::database::migration::init_tables(&conn).unwrap();
        for (rel, lines) in files {
            conn.execute(
                "INSERT INTO project_files (id, analysis_id, path, rel_path, name, content_hash, is_directory, line_count) \
                 VALUES (?1,'a1',?2,?3,?4,'h',0,?5)",
                rusqlite::params![
                    format!("f_{}", rel.replace('/', "_")),
                    format!("/abs/{}", rel),
                    rel,
                    rel.rsplit('/').next().unwrap_or(rel),
                    lines,
                ],
            )
            .unwrap();
        }
        ContextInsightTool::new(std::sync::Arc::new(Database(std::sync::Mutex::new(conn))))
    }

    #[tokio::test]
    async fn save_rejects_insight_whose_refs_are_all_hallucinated() {
        // 两个同名文件 → 不做对齐（猜错比不猜危害大），只列候选
        let tool = insight_tool_with_files(&[("src/ai/tools.rs", 100), ("src/cli/tools.rs", 80)]);
        let err = tool
            .execute(json!({
                "action": "save",
                "analysis_id": "a1",
                "title": "Tool registry duplicates provider wiring",
                "body": "reasoning",
                "refs": ["lib/agent/tools.rs:42"],
            }))
            .await
            .expect_err("全是编出来的路径必须当场退回，不能落库");
        assert!(err.contains("NOT SAVED"));
        // 候选必须给出来，只否定不给路等于逼模型再编一个
        assert!(err.contains("src/ai/tools.rs"), "{}", err);

        // 库里不能留下任何痕迹
        let listed = tool.build_list_output("a1", false, 10, None, true).unwrap();
        assert_eq!(listed["total"].as_i64(), Some(0));
    }

    #[tokio::test]
    async fn save_keeps_valid_refs_and_reports_the_dropped_ones() {
        let tool = insight_tool_with_files(&[("src/a.ts", 200)]);
        let out = tool
            .execute(json!({
                "action": "save",
                "analysis_id": "a1",
                "title": "Config loader duplicated",
                "body": "reasoning",
                "refs": ["src/a.ts:10", "src/ghost.ts:3"],
            }))
            .await
            .unwrap();
        assert!(out.success);
        assert!(out.result.contains("Refs dropped"), "{}", out.result);
        let accepted = out.metadata["refs"]["accepted"].as_array().unwrap();
        assert_eq!(accepted.len(), 1);
        assert_eq!(accepted[0].as_str(), Some("src/a.ts:10"));
        assert_eq!(
            out.metadata["refs"]["rejected"].as_array().unwrap().len(),
            1
        );

        // 落库的只有核验通过的那条
        let listed = tool
            .build_list_output("a1", false, 10, None, false)
            .unwrap();
        let refs = listed["insights"][0]["refs"].as_array().unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].as_str(), Some("src/a.ts:10"));
    }

    #[tokio::test]
    async fn save_aligns_bare_filename_and_trims_out_of_range_line() {
        let tool = insight_tool_with_files(&[("src/deep/only.ts", 40)]);
        let out = tool
            .execute(json!({
                "action": "save",
                "analysis_id": "a1",
                "title": "Only module leaks state",
                "body": "reasoning",
                "refs": ["only.ts:900"],
            }))
            .await
            .unwrap();
        assert!(out.success);
        assert!(out.result.contains("Refs corrected"), "{}", out.result);
        let accepted = out.metadata["refs"]["accepted"].as_array().unwrap();
        // 文件名对齐到真实路径，越界行号丢掉但文件保留
        assert_eq!(accepted[0].as_str(), Some("src/deep/only.ts"));
    }

    #[tokio::test]
    async fn save_without_refs_succeeds_but_states_the_cost() {
        let tool = insight_tool_with_files(&[("src/a.ts", 10)]);
        let out = tool
            .execute(json!({
                "action": "save",
                "analysis_id": "a1",
                "title": "Project lacks integration tests",
                "body": "reasoning",
            }))
            .await
            .unwrap();
        assert!(out.success);
        assert!(out.result.contains("unanchored"), "{}", out.result);
    }

    #[tokio::test]
    async fn save_never_blocks_when_project_has_not_been_scanned() {
        let tool = insight_tool_with_files(&[]);
        let out = tool
            .execute(json!({
                "action": "save",
                "analysis_id": "a1",
                "title": "Early conclusion",
                "body": "reasoning",
                "refs": ["src/anything.ts:5"],
            }))
            .await
            .expect("没有扫描结果做对照时不能反过来否定模型");
        assert!(out.success);
        assert_eq!(
            out.metadata["refs"]["accepted"][0].as_str(),
            Some("src/anything.ts:5")
        );
    }

    #[test]
    fn preview_truncates_long_body_and_collapses_whitespace() {
        let body = "line one\n\n   line two   with     gaps";
        assert_eq!(
            ContextInsightTool::preview(body, 100),
            "line one line two with gaps"
        );
        let long = "x".repeat(300);
        let out = ContextInsightTool::preview(&long, 160);
        assert_eq!(out.chars().count(), 161); // 160 字符 + 省略号
        assert!(out.ends_with('…'));
    }
}
