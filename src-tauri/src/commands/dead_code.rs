//! 死代码检测：找出「定义了但没人用」的符号
//!
//! 对应需求文档「代码之间的引用 / 索引」的反向用法。已有的三层引用数据：
//! - project_dependencies：文件级 import 关系
//! - project_symbol_refs：符号级引用（谁 import 了谁的什么）
//! - project_call_edges：函数调用边（谁调用了谁）
//!
//! 三者的**补集**就是死代码：某个 function/class/interface 既没有被任何文件
//! import，也没有被任何函数调用 —— 它对当前代码库没有贡献，只增加理解成本。
//!
//! 判定不是非黑即白，所以给出置信度而不是断言：
//! - high：未导出（无 export/pub）且零引用 —— 模块私有且无人用，基本可删
//! - medium：已导出但零引用 —— 可能是对外 API / 动态引用，需人工确认
//! - low：类型别名或接口 —— 类型层引用常被扫描器漏掉，仅作提示
//!
//! 入口文件（index/main/lib/mod/__init__）与测试文件天然「无人引用」，直接排除，
//! 否则会产生大量噪音，让整个功能失去可信度。

use crate::domain::project_call_edges::CallEdge;
use crate::domain::project_files::ProjectFile;
use crate::domain::project_symbols::ProjectSymbol;
use crate::domain::review_findings::ReviewFinding;
use crate::error::AppResult;
use crate::infrastructure::ast::unreachable::detect_unreachable;
use crate::infrastructure::ast::unused_import::detect_unused_imports;
use crate::infrastructure::ast::unused_local::detect_unused_locals;
use crate::infrastructure::ast::unused_param::detect_unused_params;
use crate::infrastructure::database::project_call_edge_repository::{
    ProjectCallEdgeRepository, SqliteProjectCallEdgeRepository,
};
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_symbol_repository::ProjectSymbolRepository;
use crate::infrastructure::database::review_finding_repository::ReviewFindingRepository;
use crate::infrastructure::database::{
    SqliteProjectFileRepository, SqliteProjectSymbolRepository, SqliteReviewFindingRepository,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::commands::project_scan::ScanContentCache;

/// 死代码检测使用的规则 id（migration.rs 中已种子化）
pub const DEAD_SYMBOL_RULE_ID: &str = "rule_dead_symbol";

/// 过程内不可达代码检测规则 id（joern CFG reachableBy 子集；运行时由 ensure_rule 兜底补种）
pub const DEAD_UNREACHABLE_RULE_ID: &str = "rule_dead_unreachable";

/// 未使用局部变量检测规则 id（joern 到达定义 / DEF-USE 子集；运行时由 ensure_rule 兜底补种）
pub const DEAD_UNUSED_LOCAL_RULE_ID: &str = "rule_dead_unused_local";

/// 未使用参数检测规则 id（joern 到达定义 / DEF-USE 子集，与未使用局部变量同族；运行时由 ensure_rule 兜底补种）
pub const DEAD_UNUSED_PARAM_RULE_ID: &str = "rule_dead_unused_param";

/// 跨文件未使用导出检测规则 id（joern 到达定义全库视图 `cpg.method.isPublic.whereNot(_.callIn)`；
/// 运行时由 ensure_rule 兜底补种）
pub const DEAD_UNUSED_EXPORT_RULE_ID: &str = "rule_dead_unused_export";

/// 未使用导入检测规则 id（joern IMPORT 节点 / 到达定义 DEF-USE 子集，与未使用局部变量同族；
/// 运行时由 ensure_rule 兜底补种）
pub const DEAD_UNUSED_IMPORT_RULE_ID: &str = "rule_dead_unused_import";

/// 全局不可达函数检测规则 id（joern 到达定义全库视图 `cpg.method.reachableBy(entryPoints)` 子集；
/// 运行时由 ensure_rule 兜底补种）
pub const DEAD_UNREACHABLE_FN_RULE_ID: &str = "rule_dead_unreachable_fn";

/// 死代码候选
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadSymbol {
    pub symbol_id: String,
    pub analysis_id: String,
    pub file_id: String,
    pub file_path: String,
    pub name: String,
    pub kind: String,
    pub line_start: i64,
    pub line_end: i64,
    /// exported | internal
    pub visibility: String,
    /// high | medium | low
    pub confidence: String,
    /// 判定说明（直接展示给用户）
    pub reason: String,
}

/// 入口文件：模块对外的门面，天然没有「被谁 import」的记录
fn is_entry_file(rel_path: &str) -> bool {
    let base = rel_path.rsplit('/').next().unwrap_or(rel_path);
    matches!(
        base,
        "index.ts"
            | "index.tsx"
            | "index.js"
            | "index.jsx"
            | "index.mjs"
            | "main.ts"
            | "main.tsx"
            | "main.js"
            | "main.rs"
            | "lib.rs"
            | "mod.rs"
            | "build.rs"
            | "__init__.py"
            | "__main__.py"
            | "setup.py"
            | "App.tsx"
            | "App.ts"
    )
}

/// 测试 / 声明 / 生成物：不参与死代码统计
fn is_excluded_file(rel_path: &str) -> bool {
    let lower = rel_path.to_lowercase();
    let base = lower.rsplit('/').next().unwrap_or(&lower).to_string();
    lower.contains(".test.")
        || lower.contains(".spec.")
        || lower.contains("__tests__")
        || lower.contains("/tests/")
        || lower.contains("/test/")
        || lower.contains("/__mocks__/")
        || lower.ends_with(".d.ts")
        || lower.ends_with("_test.rs")
        || lower.ends_with("_test.go")
        || base.starts_with("test_")
        || base == "conftest.py"
}

/// 是否对外可见（导出 / pub）
fn is_exported(modifiers: &str) -> bool {
    let m = modifiers.to_lowercase();
    m.contains("export") || m.contains("pub")
}

/// 单个符号的死代码判定；返回 None 表示不算死代码
fn judge(symbol: &ProjectSymbol) -> Option<DeadSymbol> {
    if is_entry_file(&symbol.file_path) || is_excluded_file(&symbol.file_path) {
        return None;
    }
    // 约定：下划线开头是「我知道它没用」的显式标记，尊重作者意图
    if symbol.name.starts_with('_') || symbol.name.is_empty() {
        return None;
    }

    let exported = is_exported(&symbol.modifiers);
    let type_like = matches!(symbol.kind.as_str(), "interface" | "type_alias" | "enum");

    let (confidence, reason) = if type_like {
        (
            "low",
            format!(
                "类型 {} 未被任何文件引用；类型层引用常在编译期消解，请人工确认",
                symbol.name
            ),
        )
    } else if exported {
        (
            "medium",
            format!(
                "{} 已导出但项目内无任何引用与调用；若非对外 API 可考虑收敛或删除",
                symbol.name
            ),
        )
    } else {
        (
            "high",
            format!(
                "{} 未导出且模块内外均无引用与调用，属于孤立代码",
                symbol.name
            ),
        )
    };

    Some(DeadSymbol {
        symbol_id: symbol.id.clone(),
        analysis_id: symbol.analysis_id.clone(),
        file_id: symbol.file_id.clone(),
        file_path: symbol.file_path.clone(),
        name: symbol.name.clone(),
        kind: symbol.kind.clone(),
        line_start: symbol.line_start,
        line_end: symbol.line_end,
        visibility: if exported { "exported" } else { "internal" }.to_string(),
        confidence: confidence.to_string(),
        reason,
    })
}

/// 从库中取出零引用符号并判定（不落库，供列表复用）
fn collect(
    analysis_id: &str,
    symbol_repo: &SqliteProjectSymbolRepository,
) -> AppResult<Vec<DeadSymbol>> {
    let candidates = symbol_repo.list_unreferenced(analysis_id)?;
    let mut out: Vec<DeadSymbol> = candidates.iter().filter_map(judge).collect();
    // 高置信度排前面，便于用户从最确定的开始清理
    out.sort_by(|a, b| {
        let rank = |c: &str| match c {
            "high" => 0,
            "medium" => 1,
            _ => 2,
        };
        rank(&a.confidence)
            .cmp(&rank(&b.confidence))
            .then(a.file_path.cmp(&b.file_path))
            .then(a.line_start.cmp(&b.line_start))
    });
    Ok(out)
}

/// 跨文件未使用导出判定；返回 None 表示不算「未使用导出」。
///
/// 与 `judge`（零引用即死）互补：本函数要求符号「至少被本文件引用/调用过」，
/// 专门挑出「被自身模块消费、但其导出面对项目内其它文件却无人引用」的冗余导出，
/// 对标 joern `cpg.method.isPublic.whereNot(_.callIn)`（零外部调用入边＝未使用导出）。
fn judge_export(symbol: &ProjectSymbol) -> Option<DeadSymbol> {
    if is_entry_file(&symbol.file_path) || is_excluded_file(&symbol.file_path) {
        return None;
    }
    // 约定：下划线开头是「我知道它没用」的显式标记，尊重作者意图
    if symbol.name.starts_with('_') || symbol.name.is_empty() {
        return None;
    }
    if !is_exported(&symbol.modifiers) {
        return None;
    }

    let type_like = matches!(symbol.kind.as_str(), "interface" | "type_alias" | "enum");
    let (confidence, reason) = if type_like {
        (
            "low",
            format!(
                "类型 {} 已导出但仅在本文件内使用，其它文件无引用；类型层引用常在编译期消解，请人工确认",
                symbol.name
            ),
        )
    } else {
        (
            "medium",
            format!(
                "{} 已导出但项目内仅本文件引用/调用，其它文件均未使用；若非对外 API 或动态加载（import()/反射），其导出可收敛或删除",
                symbol.name
            ),
        )
    };

    Some(DeadSymbol {
        symbol_id: symbol.id.clone(),
        analysis_id: symbol.analysis_id.clone(),
        file_id: symbol.file_id.clone(),
        file_path: symbol.file_path.clone(),
        name: symbol.name.clone(),
        kind: symbol.kind.clone(),
        line_start: symbol.line_start,
        line_end: symbol.line_end,
        visibility: "exported".to_string(),
        confidence: confidence.to_string(),
        reason,
    })
}

/// 从库中取出「跨文件未使用导出」候选并判定（不落库，供列表复用）
fn collect_unused_exports(
    analysis_id: &str,
    symbol_repo: &SqliteProjectSymbolRepository,
) -> AppResult<Vec<DeadSymbol>> {
    let candidates = symbol_repo.list_unused_exports(analysis_id)?;
    let mut out: Vec<DeadSymbol> = candidates.iter().filter_map(judge_export).collect();
    // 高置信度排前面，便于用户从最确定的开始清理
    out.sort_by(|a, b| {
        let rank = |c: &str| match c {
            "high" => 0,
            "medium" => 1,
            _ => 2,
        };
        rank(&a.confidence)
            .cmp(&rank(&b.confidence))
            .then(a.file_path.cmp(&b.file_path))
            .then(a.line_start.cmp(&b.line_start))
    });
    Ok(out)
}

/// 过程内不可达代码检测：遍历源码文件，调用 `ast::detect_unreachable`，
/// 把发现的不可达语句落库为 `rule_dead_unreachable` 审查发现。
///
/// 与引用级死代码互补——它只看「函数体内永远走不到的语句」，不看引用关系。
/// 复用扫描期已填充的 `ScanContentCache` 读取文件内容，与 `analyze_file_metrics`
/// 同源；缓存未命中（极少见）则跳过该文件，不阻塞整体检测。
fn detect_unreachable_dead_code(
    analysis_id: &str,
    app: &AppHandle,
    file_repo: &SqliteProjectFileRepository,
    finding_repo: &SqliteReviewFindingRepository,
    cache: &ScanContentCache,
) -> AppResult<()> {
    // 幂等补种规则定义（既有库无需重跑迁移）
    finding_repo.ensure_rule(
        DEAD_UNREACHABLE_RULE_ID,
        "过程内不可达代码",
        "函数体内永远走不到的语句（return/throw 之后的尾随语句、if(true/false) 常量条件死分支），对标 joern CFG reachableBy 子集",
        "cfg",
        "file",
        r##"{"algorithm":"intra_procedural_unreachable","kinds":["trailing_after_return","const_condition_dead_branch"]}"##,
        "warning",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNREACHABLE_RULE_ID)?;

    let all_files = file_repo.list_by_analysis(analysis_id)?;
    let source_files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();

    let now = chrono::Utc::now().timestamp();
    let mut findings: Vec<ReviewFinding> = Vec::new();

    for file in source_files {
        if is_excluded_file(&file.rel_path) {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };
        let lang = file.language.as_deref().unwrap_or("");
        let unreachable = detect_unreachable(lang, &file.rel_path, &content);
        for u in unreachable {
            let severity = if u.confidence == "high" {
                "warning"
            } else {
                "info"
            };
            findings.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(DEAD_UNREACHABLE_RULE_ID.to_string()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: severity.to_string(),
                message: format!(
                    "不可达代码：{}:{} — {}",
                    file.rel_path, u.line_start, u.snippet
                ),
                suggestion: Some(u.reason.to_string()),
                status: "open".to_string(),
                found_at: now,
                fixed_at: None,
                metadata: serde_json::json!({
                    "filePath": file.rel_path,
                    "lineStart": u.line_start,
                    "lineEnd": u.line_end,
                    "kind": "unreachable",
                    "confidence": u.confidence,
                    "snippet": u.snippet,
                })
                .to_string(),
            });
        }
    }

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    let _ = app;
    Ok(())
}

/// 未使用局部变量检测：遍历源码文件，调用 `ast::detect_unused_locals`，
/// 把发现的未使用局部变量落库为 `rule_dead_unused_local` 审查发现。
///
/// 与引用级死代码、过程内不可达代码互补——它只看「函数体内定义了却从没被读取的局部变量」，
/// 对标 joern 的到达定义（reaching definition）DEF-USE 模型。复用扫描期已填充的
/// `ScanContentCache` 读取文件内容，与 `analyze_file_metrics` 同源；缓存未命中则跳过该文件。
fn detect_unused_local_dead_code(
    analysis_id: &str,
    app: &AppHandle,
    file_repo: &SqliteProjectFileRepository,
    finding_repo: &SqliteReviewFindingRepository,
    cache: &ScanContentCache,
) -> AppResult<()> {
    // 幂等补种规则定义（既有库无需重跑迁移）
    finding_repo.ensure_rule(
        DEAD_UNUSED_LOCAL_RULE_ID,
        "未使用局部变量",
        "函数内声明后从未被读取的局部变量（let/const/var 等），对标 joern 到达定义 DEF-USE 模型；建议删除或改用 _ 前缀",
        "def-use",
        "file",
        r##"{"algorithm":"intra_procedural_unused_local","kinds":["unused_local"]}"##,
        "info",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNUSED_LOCAL_RULE_ID)?;

    let all_files = file_repo.list_by_analysis(analysis_id)?;
    let source_files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();

    let now = chrono::Utc::now().timestamp();
    let mut findings: Vec<ReviewFinding> = Vec::new();

    for file in source_files {
        if is_excluded_file(&file.rel_path) {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };
        let lang = file.language.as_deref().unwrap_or("");
        let unused = detect_unused_locals(lang, &file.rel_path, &content);
        for u in unused {
            findings.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(DEAD_UNUSED_LOCAL_RULE_ID.to_string()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: "info".to_string(),
                message: format!(
                    "未使用局部变量：{} ({}:{}) — {}",
                    u.name, file.rel_path, u.line_start, u.snippet
                ),
                suggestion: Some(u.reason.to_string()),
                status: "open".to_string(),
                found_at: now,
                fixed_at: None,
                metadata: serde_json::json!({
                    "filePath": file.rel_path,
                    "name": u.name,
                    "lineStart": u.line_start,
                    "lineEnd": u.line_end,
                    "kind": "unused_local",
                    "confidence": u.confidence,
                    "snippet": u.snippet,
                })
                .to_string(),
            });
        }
    }

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    let _ = app;
    Ok(())
}

/// 未使用参数检测：遍历源码文件，调用 `ast::detect_unused_params`，
/// 把发现的未使用参数落库为 `rule_dead_unused_param` 审查发现。
///
/// 与引用级死代码、过程内不可达代码、未使用局部变量互补——它只看「函数参数定义了却从没被读取」，
/// 对标 joern 的到达定义（reaching definition）DEF-USE 模型（`cpg.parameter.whereNot(_.usedBy)`）。
/// 复用扫描期已填充的 `ScanContentCache` 读取文件内容，与 `detect_unused_local_dead_code` 同源；
/// 缓存未命中则跳过该文件。
fn detect_unused_param_dead_code(
    analysis_id: &str,
    app: &AppHandle,
    file_repo: &SqliteProjectFileRepository,
    finding_repo: &SqliteReviewFindingRepository,
    cache: &ScanContentCache,
) -> AppResult<()> {
    // 幂等补种规则定义（既有库无需重跑迁移）
    finding_repo.ensure_rule(
        DEAD_UNUSED_PARAM_RULE_ID,
        "未使用参数",
        "函数参数声明后从未被读取（DEF-USE），对标 joern 到达定义模型；多为良性（回调签名/占位参数），仅作建议级提示",
        "def-use",
        "file",
        r##"{"algorithm":"intra_procedural_unused_param","kinds":["unused_param"]}"##,
        "info",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNUSED_PARAM_RULE_ID)?;

    let all_files = file_repo.list_by_analysis(analysis_id)?;
    let source_files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();

    let now = chrono::Utc::now().timestamp();
    let mut findings: Vec<ReviewFinding> = Vec::new();

    for file in source_files {
        if is_excluded_file(&file.rel_path) {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };
        let lang = file.language.as_deref().unwrap_or("");
        let unused = detect_unused_params(lang, &file.rel_path, &content);
        for u in unused {
            findings.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(DEAD_UNUSED_PARAM_RULE_ID.to_string()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: "info".to_string(),
                message: format!(
                    "未使用参数：{} ({}:{}) — {}",
                    u.name, file.rel_path, u.line_start, u.snippet
                ),
                suggestion: Some(u.reason.to_string()),
                status: "open".to_string(),
                found_at: now,
                fixed_at: None,
                metadata: serde_json::json!({
                    "filePath": file.rel_path,
                    "name": u.name,
                    "lineStart": u.line_start,
                    "lineEnd": u.line_end,
                    "kind": "unused_param",
                    "confidence": u.confidence,
                    "snippet": u.snippet,
                })
                .to_string(),
            });
        }
    }

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    let _ = app;
    Ok(())
}

/// 跨文件未使用导出检测：从库查询「已导出但仅本文件引用、项目内其它文件无引用/调用」的符号，
/// 落库为 `rule_dead_unused_export` 审查发现。对标 joern 到达定义全库视图
/// `cpg.method.isPublic.whereNot(_.callIn)`（零外部调用入边＝未使用导出）。
///
/// 与引用级死代码（rule_dead_symbol）、过程内不可达代码、未使用局部变量、未使用参数互补——
/// 它只看「导出符号面对项目内其它文件无人引用」，复用既有的 `project_symbol_refs` /
/// `project_call_edges` 两张引用表，零新抽取、零新 DB 表。依赖 analyze_symbol_references 与
/// analyze_call_graph 已运行（detect_dead_symbols 调用链保证）。
fn detect_unused_export_dead_code(
    analysis_id: &str,
    symbol_repo: &SqliteProjectSymbolRepository,
    finding_repo: &SqliteReviewFindingRepository,
) -> AppResult<()> {
    // 幂等补种规则定义（既有库无需重跑迁移）
    finding_repo.ensure_rule(
        DEAD_UNUSED_EXPORT_RULE_ID,
        "跨文件未使用导出",
        "已导出（export/pub）的符号在本文件内有引用/调用，但项目内其它文件均无引用或调用，对标 joern 到达定义全库视图 isPublic.whereNot(_.callIn)；可能是未被消费的对外 API、动态加载入口或冗余导出，建议人工确认",
        "def-use",
        "symbol",
        r##"{"algorithm":"cross_file_unused_export","kinds":["unused_export"]}"##,
        "info",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNUSED_EXPORT_RULE_ID)?;

    let dead = collect_unused_exports(analysis_id, symbol_repo)?;

    let now = chrono::Utc::now().timestamp();
    let findings: Vec<ReviewFinding> = dead
        .iter()
        .filter(|d| d.confidence != "low") // low 只在面板提示，不制造审查噪音
        .map(|d| ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.to_string(),
            rule_id: Some(DEAD_UNUSED_EXPORT_RULE_ID.to_string()),
            target_id: d.symbol_id.clone(),
            target_type: "symbol".to_string(),
            severity: "info".to_string(),
            message: format!(
                "跨文件未使用导出：{} ({}:{})",
                d.name, d.file_path, d.line_start
            ),
            suggestion: Some(d.reason.clone()),
            status: "open".to_string(),
            found_at: now,
            fixed_at: None,
            metadata: serde_json::json!({
                "filePath": d.file_path,
                "name": d.name,
                "kind": d.kind,
                "lineStart": d.line_start,
                "lineEnd": d.line_end,
                "visibility": d.visibility,
                "confidence": d.confidence,
            })
            .to_string(),
        })
        .collect();

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    Ok(())
}

/// 调用图可达性：从入口点（导出/pub、`main`、被测试文件调用）沿 `call_edges` 做 BFS，
/// 凡「自由函数（Rust）」不可达且确有调用入边者即「全局不可达函数」——仅被同样不可达的代码
/// 调用，无任何入口可达路径。对标 joern 到达定义全库视图 `cpg.method.reachableBy(entryPoints)`。
///
/// 范围纪律（零误报优先）：
/// - 仅 `.rs` 可靠：TS/JS 的 UI 框架入口（组件/事件处理器）不可见于调用图、Go/C 符号级引用稀疏
///   → 易误报，明确 deferred（后续轮补框架入口 harness）。
/// - 仅 `kind == "function"`（自由函数）：方法经动态分派（this./trait 对象）常无调用边 → 误报，排除。
/// - 候选须有 ≥1 条调用入边：与 `rule_dead_symbol`（零引用）严格互补、排除纯回调（仅有值引用无调用）。
///   入口点种子可含任意 kind（含方法），BFS 跨 kind 遍历，避免「方法调用的自由函数」被漏判可达。
fn compute_unreachable_fns(symbols: &[ProjectSymbol], edges: &[CallEdge]) -> Vec<ProjectSymbol> {
    // 被测试文件调用的被调符号（测试可达 → 视为入口锚点，避免测试工具函数误报死）
    let test_called_callees: HashSet<String> = edges
        .iter()
        .filter(|e| is_excluded_file(&e.caller_file_path))
        .map(|e| e.callee_symbol_id.clone())
        .filter(|id| !id.is_empty())
        .collect();
    // 所有「确有调用入边」的符号（用于候选门禁，与 rule_dead_symbol 互补）
    let has_caller: HashSet<String> = edges
        .iter()
        .map(|e| e.callee_symbol_id.clone())
        .filter(|id| !id.is_empty())
        .collect();

    // 调用图邻接：caller -> 被调符号列表
    let mut callees_of: HashMap<String, Vec<String>> = HashMap::new();
    for e in edges {
        if e.caller_symbol_id.is_empty() || e.callee_symbol_id.is_empty() {
            continue;
        }
        callees_of
            .entry(e.caller_symbol_id.clone())
            .or_default()
            .push(e.callee_symbol_id.clone());
    }

    // 入口点种子（任意 kind / 任意语言均可作为根，但候选仅限 .rs 自由函数）
    let mut reachable: HashSet<String> = HashSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for s in symbols {
        let exported = is_exported(&s.modifiers);
        let is_main = s.name == "main";
        let test_called = test_called_callees.contains(&s.id);
        if exported || is_main || test_called {
            if reachable.insert(s.id.clone()) {
                queue.push_back(s.id.clone());
            }
        }
    }
    // BFS 正向遍历（caller -> callee）
    while let Some(cur) = queue.pop_front() {
        if let Some(cs) = callees_of.get(&cur) {
            for c in cs {
                if reachable.insert(c.clone()) {
                    queue.push_back(c.clone());
                }
            }
        }
    }

    symbols
        .iter()
        .filter(|s| s.kind == "function" && s.file_path.ends_with(".rs"))
        .filter(|s| !reachable.contains(&s.id))
        .filter(|s| !is_excluded_file(&s.file_path))
        .filter(|s| !s.name.starts_with('_') && !s.name.is_empty())
        .filter(|s| has_caller.contains(&s.id))
        .cloned()
        .collect()
}

/// 全局不可达函数检测：从库加载符号 + 调用边，计算可达性死函数，落库为 `rule_dead_unreachable_fn`
/// 审查发现。对标 joern 到达定义全库视图 `cpg.method.reachableBy(entryPoints)`，与引用级死代码
/// （rule_dead_symbol）、过程内不可达代码、未使用局部变量/参数、跨文件未使用导出、未使用导入互补——
/// 它只看「确被调用、但整条调用链无入口可达路径」的遗留自由函数。复用既有的 `project_symbols` /
/// `project_call_edges` 两张表，零新抽取、零新 DB 表。依赖 analyze_call_graph 已运行
/// （detect_dead_symbols 调用链保证）。
fn detect_unreachable_fn_dead_code(
    analysis_id: &str,
    call_edge_repo: &SqliteProjectCallEdgeRepository,
    symbol_repo: &SqliteProjectSymbolRepository,
    finding_repo: &SqliteReviewFindingRepository,
) -> AppResult<()> {
    finding_repo.ensure_rule(
        DEAD_UNREACHABLE_FN_RULE_ID,
        "全局不可达函数",
        "自由函数（Rust）无任何入口可达调用路径——仅被同样不可达的代码调用，对标 joern 到达定义全库视图 reachableBy(entryPoints)；多为遗留工具/重构残留，可安全删除或重新接线",
        "reachability",
        "symbol",
        r##"{"algorithm":"call_graph_reachability","kinds":["unreachable_fn"]}"##,
        "info",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNREACHABLE_FN_RULE_ID)?;

    let symbols = symbol_repo.list_by_analysis(analysis_id)?;
    let edges = call_edge_repo.list_by_analysis(analysis_id)?;
    let dead = compute_unreachable_fns(&symbols, &edges);

    let now = chrono::Utc::now().timestamp();
    let findings: Vec<ReviewFinding> = dead
        .iter()
        .map(|d| ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.to_string(),
            rule_id: Some(DEAD_UNREACHABLE_FN_RULE_ID.to_string()),
            target_id: d.id.clone(),
            target_type: "symbol".to_string(),
            severity: "info".to_string(),
            message: format!(
                "全局不可达函数：{} ({}:{}) — 无任何入口可达调用路径，仅被同样不可达的代码引用",
                d.name, d.file_path, d.line_start
            ),
            suggestion: Some(
                "可能是遗留工具或重构残留；若确认无外部接线可删除，否则应被某入口（main/导出/测试）调用".to_string(),
            ),
            status: "open".to_string(),
            found_at: now,
            fixed_at: None,
            metadata: serde_json::json!({
                "filePath": d.file_path,
                "name": d.name,
                "kind": d.kind,
                "lineStart": d.line_start,
                "lineEnd": d.line_end,
                "visibility": if is_exported(&d.modifiers) { "exported" } else { "internal" },
                "confidence": "low",
            })
            .to_string(),
        })
        .collect();

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    Ok(())
}

/// 未使用导入检测：遍历源码文件，调用 `ast::detect_unused_imports`，
/// 把发现的未使用导入落库为 `rule_dead_unused_import` 审查发现。
///
/// 与引用级死代码、过程内不可达代码、未使用局部变量、未使用参数、跨文件未使用导出互补——
/// 它只看「import 进来的名字在整个文件内从未被引用」，对标 joern 的 IMPORT 节点（importedAs
/// 绑定名若无 IDENTIFIER 引用即未使用）与到达定义（DEF-USE）模型。复用扫描期已填充的
/// `ScanContentCache` 读取文件内容，与 `detect_unused_local_dead_code` 同源；缓存未命中则跳过该文件。
fn detect_unused_import_dead_code(
    analysis_id: &str,
    app: &AppHandle,
    file_repo: &SqliteProjectFileRepository,
    finding_repo: &SqliteReviewFindingRepository,
    cache: &ScanContentCache,
) -> AppResult<()> {
    // 幂等补种规则定义（既有库无需重跑迁移）
    finding_repo.ensure_rule(
        DEAD_UNUSED_IMPORT_RULE_ID,
        "未使用导入",
        "导入声明引入的本地绑定名在整个文件内从未被引用（DEF-USE），对标 joern IMPORT 节点 importedAs 绑定；多为良性（再导出/动态加载/类型仅用），仅作建议级提示",
        "def-use",
        "file",
        r##"{"algorithm":"file_level_unused_import","kinds":["unused_import"]}"##,
        "info",
        "all",
    )?;
    finding_repo.delete_by_rule(analysis_id, DEAD_UNUSED_IMPORT_RULE_ID)?;

    let all_files = file_repo.list_by_analysis(analysis_id)?;
    let source_files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();

    let now = chrono::Utc::now().timestamp();
    let mut findings: Vec<ReviewFinding> = Vec::new();

    for file in source_files {
        if is_excluded_file(&file.rel_path) {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };
        let lang = file.language.as_deref().unwrap_or("");
        let unused = detect_unused_imports(lang, &file.rel_path, &content);
        for u in unused {
            findings.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(DEAD_UNUSED_IMPORT_RULE_ID.to_string()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: "info".to_string(),
                message: format!(
                    "未使用导入：{} ({}:{}) — {}",
                    u.name, file.rel_path, u.line_start, u.snippet
                ),
                suggestion: Some(u.reason.to_string()),
                status: "open".to_string(),
                found_at: now,
                fixed_at: None,
                metadata: serde_json::json!({
                    "filePath": file.rel_path,
                    "name": u.name,
                    "lineStart": u.line_start,
                    "lineEnd": u.line_end,
                    "kind": "unused_import",
                    "confidence": u.confidence,
                    "snippet": u.snippet,
                })
                .to_string(),
            });
        }
    }

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }
    let _ = app;
    Ok(())
}

/// 主命令：检测死代码并写入 review_findings
///
/// 依赖顺序：需在 analyze_symbol_refs 与 analyze_call_graph 之后执行，
/// 否则引用数据为空会把所有符号误判为死代码。
///
/// 增量策略：本阶段**刻意保持全量重算**，不做按文件携带。
/// 死代码判定是全局耦合的——未变文件 A 的符号，可能因变更文件 B 新增/移除对它的
/// 引用而「复活」或「变死」，故其状态取决于整个引用图，无法安全按文件增量。
/// 且它仅是一次廉价的 `list_unreferenced` SQL + 逐符号 judge，成本远低于前面的
/// 结构解析/引用分析；在已增量的 symbol_refs/call_graph 之上重算，结果天然正确。
#[tauri::command(async)]
pub fn detect_dead_symbols(
    analysis_id: String,
    app: AppHandle,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
    call_edge_repo: State<'_, Arc<SqliteProjectCallEdgeRepository>>,
    finding_repo: State<'_, Arc<SqliteReviewFindingRepository>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<DeadSymbol>> {
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::DeadCode,
        0,
        0,
        1,
        "检测死代码…",
    );
    let dead = collect(&analysis_id, &symbol_repo)?;

    // 重跑前清掉本规则的旧结果，避免同一符号反复堆积
    finding_repo.delete_by_rule(&analysis_id, DEAD_SYMBOL_RULE_ID)?;

    let now = chrono::Utc::now().timestamp();
    let findings: Vec<ReviewFinding> = dead
        .iter()
        .filter(|d| d.confidence != "low") // low 只在面板提示，不制造审查噪音
        .map(|d| ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.clone(),
            rule_id: Some(DEAD_SYMBOL_RULE_ID.to_string()),
            target_id: d.symbol_id.clone(),
            target_type: "symbol".to_string(),
            severity: if d.confidence == "high" {
                "warning".to_string()
            } else {
                "info".to_string()
            },
            message: format!("疑似死代码：{} ({}:{})", d.name, d.file_path, d.line_start),
            suggestion: Some(d.reason.clone()),
            status: "open".to_string(),
            found_at: now,
            fixed_at: None,
            metadata: serde_json::json!({
                "filePath": d.file_path,
                "name": d.name,
                "kind": d.kind,
                "lineStart": d.line_start,
                "lineEnd": d.line_end,
                "visibility": d.visibility,
                "confidence": d.confidence,
            })
            .to_string(),
        })
        .collect();

    if !findings.is_empty() {
        finding_repo.save_batch(&findings)?;
    }

    // ── 过程内不可达代码（joern CFG reachableBy 子集）──
    // 与引用级死代码互补：即使符号被引用，函数体内也可能存在永远走不到的语句。
    detect_unreachable_dead_code(&analysis_id, &app, &file_repo, &finding_repo, &cache)?;

    // ── 未使用局部变量（joern 到达定义 DEF-USE 子集）──
    // 与引用级死代码、过程内不可达代码互补：函数体内定义了却从没被读取的局部变量。
    detect_unused_local_dead_code(&analysis_id, &app, &file_repo, &finding_repo, &cache)?;

    // ── 未使用参数（joern 到达定义 DEF-USE 同族）──
    // 与未使用局部变量互补：函数参数定义了却从没被读取的参数。
    detect_unused_param_dead_code(&analysis_id, &app, &file_repo, &finding_repo, &cache)?;

    // ── 跨文件未使用导出（joern 到达定义全库视图 isPublic.whereNot(_.callIn)）──
    // 与未使用参数互补：导出符号在本文件内被使用，但项目内其它文件从未引用/调用它。
    detect_unused_export_dead_code(&analysis_id, &symbol_repo, &finding_repo)?;

    // ── 未使用导入（joern IMPORT 节点 / 到达定义 DEF-USE 同族）──
    // 与未使用参数互补：import 进来的本地绑定名在整个文件内从未被引用。
    detect_unused_import_dead_code(&analysis_id, &app, &file_repo, &finding_repo, &cache)?;

    // ── 全局不可达函数（joern 到达定义全库视图 reachableBy(entryPoints)）──
    // 与未使用导入互补：调用图 BFS 从入口点出发，确被调用却无入口可达路径的遗留自由函数（Rust）。
    detect_unreachable_fn_dead_code(&analysis_id, &call_edge_repo, &symbol_repo, &finding_repo)?;

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::DeadCode,
        100,
        1,
        1,
        "死代码检测完成",
    );
    Ok(dead)
}

/// 只读列表：不写 findings，供左侧实体面板「死代码」分组直接使用
#[tauri::command(async)]
pub fn list_dead_symbols(
    analysis_id: String,
    symbol_repo: State<'_, Arc<SqliteProjectSymbolRepository>>,
) -> AppResult<Vec<DeadSymbol>> {
    collect(&analysis_id, &symbol_repo)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sym(path: &str, name: &str, kind: &str, modifiers: &str) -> ProjectSymbol {
        ProjectSymbol {
            id: "s1".into(),
            analysis_id: "a1".into(),
            file_id: "f1".into(),
            file_path: path.into(),
            name: name.into(),
            kind: kind.into(),
            line_start: 1,
            line_end: 2,
            signature: String::new(),
            doc: None,
            modifiers: modifiers.into(),
            patterns: String::new(),
            metadata: "{}".into(),
            created_at: 0,
        }
    }

    #[test]
    fn entry_and_test_files_are_skipped() {
        assert!(judge(&sym("src/index.ts", "foo", "function", "")).is_none());
        assert!(judge(&sym("src/a.test.ts", "foo", "function", "")).is_none());
        assert!(judge(&sym("src-tauri/src/lib.rs", "foo", "function", "pub")).is_none());
        assert!(judge(&sym("src/types.d.ts", "Foo", "interface", "export")).is_none());
    }

    #[test]
    fn confidence_reflects_visibility_and_kind() {
        assert_eq!(
            judge(&sym("src/a.ts", "foo", "function", ""))
                .unwrap()
                .confidence,
            "high"
        );
        assert_eq!(
            judge(&sym("src/a.ts", "foo", "function", "export"))
                .unwrap()
                .confidence,
            "medium"
        );
        assert_eq!(
            judge(&sym("src/a.ts", "Foo", "interface", "export"))
                .unwrap()
                .confidence,
            "low"
        );
    }

    #[test]
    fn underscore_prefixed_symbols_are_intentional() {
        assert!(judge(&sym("src/a.ts", "_unused", "function", "")).is_none());
    }

    #[test]
    fn judge_export_requires_export_and_excludes_entry_and_underscore() {
        // 已导出、非入口、非测试、非下划线 → 命中（medium）
        let d = judge_export(&sym("src/util.ts", "formatDate", "function", "export")).unwrap();
        assert_eq!(d.confidence, "medium");
        assert_eq!(d.visibility, "exported");
        // 未导出 → 不命中
        assert!(judge_export(&sym("src/helper.ts", "internalOnly", "function", "")).is_none());
        // 入口文件导出 → 不命中
        assert!(judge_export(&sym("src/index.ts", "foo", "function", "export")).is_none());
        // 下划线前缀 → 不命中
        assert!(judge_export(&sym("src/util.ts", "_helper", "function", "export")).is_none());
        // 类型导出 → low（仅提示）
        assert_eq!(
            judge_export(&sym("src/types.ts", "Foo", "interface", "export"))
                .unwrap()
                .confidence,
            "low"
        );
        // Rust pub 视为导出（用非入口文件）
        assert!(judge_export(&sym("src/foo.rs", "helper", "function", "pub")).is_some());
    }

    // ── compute_unreachable_fns（joern reachableBy(entryPoints) 子集）──
    fn fn_sym(id: &str, path: &str, name: &str, modifiers: &str) -> ProjectSymbol {
        let mut s = sym(path, name, "function", modifiers);
        s.id = id.to_string();
        s
    }
    fn edge(caller_id: &str, callee_id: &str) -> CallEdge {
        CallEdge {
            caller_symbol_id: caller_id.to_string(),
            callee_symbol_id: callee_id.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn transitive_dead_cluster_flagged() {
        // x(无调用入边) -> y -> z；x 归 rule_dead_symbol，y/z 确有调用入边且整链无入口可达 → 命中。
        let syms = vec![
            fn_sym("x", "src/a.rs", "x", ""),
            fn_sym("y", "src/a.rs", "y", ""),
            fn_sym("z", "src/a.rs", "z", ""),
        ];
        let edges = vec![edge("x", "y"), edge("y", "z")];
        let dead = compute_unreachable_fns(&syms, &edges);
        let names: Vec<&str> = dead.iter().map(|d| d.name.as_str()).collect();
        assert!(names.contains(&"y"), "y should be dead: {:?}", names);
        assert!(names.contains(&"z"), "z should be dead: {:?}", names);
        assert!(
            !names.contains(&"x"),
            "x has no caller -> not this rule: {:?}",
            names
        );
    }

    #[test]
    fn entry_reachable_chain_kept() {
        // main(pub) -> a -> b；整链可达 → 无死。
        let syms = vec![
            fn_sym("main", "src/main.rs", "main", "pub"),
            fn_sym("a", "src/a.rs", "a", ""),
            fn_sym("b", "src/a.rs", "b", ""),
        ];
        let edges = vec![edge("main", "a"), edge("a", "b")];
        let dead = compute_unreachable_fns(&syms, &edges);
        assert!(
            dead.is_empty(),
            "entry-reachable chain must not be dead: {:?}",
            dead.iter().map(|d| &d.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_called_function_kept() {
        // foo 仅被测试文件调用 → 视为入口锚点，不应判死。
        let syms = vec![fn_sym("foo", "src/foo.rs", "foo", "")];
        let mut e = edge("test", "foo");
        e.caller_file_path = "src/foo.test.rs".to_string();
        let dead = compute_unreachable_fns(&syms, &[e]);
        assert!(
            dead.is_empty(),
            "test-called fn must be kept: {:?}",
            dead.iter().map(|d| &d.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn non_rust_dead_cluster_excluded() {
        // Go 的死链：范围纪律排除 Go/C → 不命中。
        let syms = vec![
            fn_sym("x", "src/a.go", "x", ""),
            fn_sym("y", "src/a.go", "y", ""),
        ];
        let edges = vec![edge("x", "y")];
        let dead = compute_unreachable_fns(&syms, &edges);
        assert!(
            dead.is_empty(),
            "Go must be excluded by scope: {:?}",
            dead.iter().map(|d| &d.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn callback_without_call_edge_excluded() {
        // 仅有值引用（无调用入边）的自由函数 → 不满足 has_caller 门禁 → 不命中（避免纯回调误报）。
        let syms = vec![fn_sym("cb", "src/a.rs", "cb", "")];
        let dead = compute_unreachable_fns(&syms, &[]);
        assert!(dead.is_empty());
    }

    #[test]
    fn method_called_free_fn_is_reachable() {
        // main -> method(M) -> free helper(H)；方法作 caller 也应让 H 可达（跨 kind BFS）。
        let syms = vec![
            fn_sym("main", "src/main.rs", "main", "pub"),
            fn_sym("M", "src/a.rs", "M", "method"),
            fn_sym("H", "src/a.rs", "H", ""),
        ];
        let edges = vec![edge("main", "M"), edge("M", "H")];
        let dead = compute_unreachable_fns(&syms, &edges);
        assert!(
            dead.is_empty(),
            "method-called free fn must be reachable: {:?}",
            dead.iter().map(|d| &d.name).collect::<Vec<_>>()
        );
    }
}
