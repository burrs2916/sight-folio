//! 过程间数据流分析：把「调用可达」收窄为「数据可达」
//!
//! ## 它解决什么
//!
//! R34 的影响链沿调用图多跳传播，回答「改了我会波及多远」。但调用图里有大量
//! **不传数据的调用**：
//!
//! ```text
//! handleScan(payload) ──▶ logger.info(msg)   // 数据进去了，出不来
//! parseConfig(raw)    ──▶ validate(cfg)      // 数据进去了，结论会返回
//! ```
//!
//! 前者的上游不该被点亮 —— 改 `payload` 的结构，`logger.info` 的其他调用方
//! 毫发无损。把这两类边区分开，影响面通常能收窄 20%~40%，工程师才愿意信任它。
//!
//! ## 怎么做
//!
//! 复用 R31 的 tree-sitter 解析（`infrastructure::ast::dataflow`）为每个函数
//! 产出「输入 → 输出」摘要（IFDS 意义上的 function summary），落库供前端影响链
//! 引擎做剪枝。本命令只负责**批量解析 + 落库 + 汇总**，判定规则全在纯函数模块里，
//! 可以脱离 Tauri 单测。
//!
//! ## 语言覆盖与保守性
//!
//! 只有 TS/TSX/JS/Rust/Python 会产出摘要。**没有摘要的函数一律按透传处理**：
//! 分析能力缺失时宁可高估影响面，也不能让用户漏掉真实风险。

use crate::domain::project_data_flow::{DataFlowFact, DataFlowHotspot, DataFlowSummary};
use crate::error::AppResult;
use crate::infrastructure::ast::dataflow::{analyze_dataflow, FunctionFlow};
use crate::infrastructure::database::project_data_flow_repository::ProjectDataFlowRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::domain::project_files::ProjectFile;
use crate::infrastructure::database::{
    SqliteProjectDataFlowRepository, SqliteProjectFileRepository,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering as AtomicOrdering};
use std::sync::Arc;
use rayon::prelude::*;
use tauri::{AppHandle, State};

/// 摘要条数上限：超大仓库全量函数摘要会撑爆 IPC，截断后仍足够剪枝
const MAX_FACTS: usize = 30_000;

/// 把一个函数摘要转成落库行
fn to_fact(
    analysis_id: &str,
    file_id: &str,
    file_path: &str,
    f: &FunctionFlow,
    now: i64,
) -> DataFlowFact {
    DataFlowFact {
        id: format!("dfl_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
        analysis_id: analysis_id.to_string(),
        file_id: file_id.to_string(),
        file_path: file_path.to_string(),
        function_name: f.name.clone(),
        line_no: f.line,
        params: f.params.join(","),
        param_to_return: f.param_to_return.join(","),
        propagates: f.propagates(),
        returns_call_result: f.returns_call_result,
        call_flows: serde_json::to_string(&f.param_to_call).unwrap_or_else(|_| "[]".into()),
        sinks: serde_json::to_string(&f.sinks).unwrap_or_else(|_| "[]".into()),
        created_at: now,
    }
}

/// 主命令：为整个分析构建函数级数据流摘要并落库
#[tauri::command(async)]
pub fn analyze_data_flow(
    analysis_id: String,
    app: AppHandle,
    changed_rel_paths: Option<Vec<String>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    flow_repo: State<'_, Arc<SqliteProjectDataFlowRepository>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<DataFlowSummary> {
    let all_files: Vec<ProjectFile> = file_repo
        .list_by_analysis(&analysis_id)?
        .into_iter()
        .filter(|f| !f.is_directory)
        .collect();
    let rel_to_id: HashMap<String, String> = all_files
        .iter()
        .map(|f| (f.rel_path.clone(), f.id.clone()))
        .collect();

    // 增量：changed_rel_paths 为 Some 时只重算变更/新增文件，未变更文件携带上一轮旧行。
    // Some(空) = 有基线且零文件变更（全部携带，收益最大），必须与 None（全量）区分。
    let incremental = changed_rel_paths.is_some();
    let changed_set: std::collections::HashSet<String> =
        changed_rel_paths.unwrap_or_default().into_iter().collect();
    let process_files: Vec<&ProjectFile> = if incremental {
        all_files
            .iter()
            .filter(|f| changed_set.contains(&f.rel_path))
            .collect()
    } else {
        all_files.iter().collect()
    };
    let process_total = process_files.len() as i64;

    let now = chrono::Utc::now().timestamp();
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::DataFlow,
        0,
        0,
        process_total,
        "分析过程间数据流…",
    );

    // 携带未变更文件的既有行：按 file_path 重映射 file_id 到当前文件表，保证无悬挂引用
    let existing = flow_repo.list_by_analysis(&analysis_id)?;
    let mut carried: Vec<DataFlowFact> = Vec::new();
    if incremental {
        for mut fact in existing {
            if !changed_set.contains(&fact.file_path) {
                if let Some(cid) = rel_to_id.get(&fact.file_path) {
                    fact.file_id = cid.clone();
                    carried.push(fact);
                }
            }
        }
    }

    // 纯计算并行化：每个变更文件独立解析数据流摘要；DB 写入留在并行区外串行提交
    let app2 = app.clone();
    let done = AtomicI64::new(0);
    let new_facts: Vec<DataFlowFact> = process_files
        .par_iter()
        .filter_map(|file| {
            // 计数放在闭包入口：非 AST 方言、空函数体等提前返回的文件同样算「已处理」，
            // 否则进度条会在跳过大量文件时卡住不动
            let seq = done.fetch_add(1, AtomicOrdering::Relaxed) + 1;
            if seq % 200 == 0 {
                crate::commands::project_scan::emit_stage_progress(
                    &app2,
                    crate::commands::project_scan::ScanStage::DataFlow,
                    ((seq as f64 / process_total.max(1) as f64) * 100.0) as i64,
                    seq,
                    process_total,
                    "分析过程间数据流…",
                );
            }
            let language = file.language.as_deref()?;
            if !crate::infrastructure::ast::supports(language, &file.rel_path) {
                return None;
            }
            let flow = cache
                .read(file)
                .and_then(|src| analyze_dataflow(language, &file.rel_path, &src))?;
            if flow.functions.is_empty() {
                return None;
            }
            Some(
                flow.functions
                    .iter()
                    .map(|f| to_fact(&analysis_id, &file.id, &file.rel_path, f, now))
                    .collect::<Vec<_>>(),
            )
        })
        .flatten()
        .collect();

    let mut all_facts = carried;
    all_facts.extend(new_facts);
    if all_facts.len() > MAX_FACTS {
        all_facts.truncate(MAX_FACTS);
    }

    // 汇总（含携带行，保证画像口径一致）
    let analyzed_files = all_facts
        .iter()
        .map(|f| f.file_id.clone())
        .collect::<std::collections::HashSet<_>>()
        .len() as i64;
    let propagating = all_facts.iter().filter(|f| f.propagates).count() as i64;
    let sink_functions = all_facts.iter().filter(|f| f.sinks != "[]").count() as i64;
    let param_flows: i64 = all_facts
        .iter()
        .map(|f| {
            serde_json::from_str::<Vec<serde_json::Value>>(&f.call_flows)
                .map(|v| v.len() as i64)
                .unwrap_or(0)
        })
        .sum();

    let mut hotspots: Vec<DataFlowHotspot> = all_facts
        .iter()
        .filter(|f| f.sinks != "[]")
        .filter_map(|f| {
            let sinks: Vec<String> = serde_json::from_str(&f.sinks).unwrap_or_default();
            if sinks.is_empty() {
                return None;
            }
            Some(DataFlowHotspot {
                function_name: f.function_name.clone(),
                file_path: f.file_path.clone(),
                line_no: f.line_no,
                count: sinks.len() as i64,
                detail: sinks.iter().take(3).cloned().collect::<Vec<_>>().join(", "),
            })
        })
        .collect();
    hotspots.sort_by(|a, b| b.count.cmp(&a.count));
    hotspots.truncate(10);

    let summary = DataFlowSummary {
        analyzed_files,
        functions: all_facts.len() as i64,
        propagating,
        blocking: all_facts.len() as i64 - propagating,
        sink_functions,
        param_flows,
        top_sinks: hotspots,
    };

    flow_repo.delete_by_analysis(&analysis_id)?;
    if !all_facts.is_empty() {
        flow_repo.save_batch(&all_facts)?;
    }
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::DataFlow,
        100,
        process_total,
        process_total,
        "数据流分析完成",
    );
    Ok(summary)
}

/// 列出数据流摘要（前端影响链剪枝 / 数据流画像用）
#[tauri::command(async)]
pub fn list_data_flow(
    analysis_id: String,
    flow_repo: State<'_, Arc<SqliteProjectDataFlowRepository>>,
) -> AppResult<Vec<DataFlowFact>> {
    flow_repo.list_by_analysis(&analysis_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow_of(src: &str, name: &str) -> FunctionFlow {
        analyze_dataflow("typescript", "a.ts", src)
            .unwrap()
            .functions
            .into_iter()
            .find(|f| f.name == name)
            .unwrap()
    }

    #[test]
    fn fact_serializes_arrays_into_compact_text() {
        let f = flow_of(
            "function run(a: string, b: number) {\n  save(a);\n  this.last = b;\n  return a;\n}\n",
            "run",
        );
        let fact = to_fact("an1", "f1", "src/a.ts", &f, 100);
        assert_eq!(fact.params, "a,b");
        assert_eq!(fact.param_to_return, "a");
        assert!(fact.propagates);
        assert!(fact.call_flows.contains("save"));
        assert!(fact.sinks.contains("this.last"));
        assert_eq!(fact.created_at, 100);
    }

    #[test]
    fn blocking_function_is_marked_not_propagating() {
        let f = flow_of("function sink(msg: string) {\n  console.warn(msg);\n}\n", "sink");
        let fact = to_fact("an1", "f1", "src/a.ts", &f, 0);
        assert!(!fact.propagates, "只消费不产出的函数必须落库为阻断点");
        assert_eq!(fact.param_to_return, "");
    }
}
