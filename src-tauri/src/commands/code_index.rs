//! 代码全文索引命令：按行索引源码内容，支持全文检索跳转
//!
//! 对应需求文档「索引」：扫描得到文件清单后，把每个源码文件的**代码行**
//! （非空、非纯注释）按行写入 project_code_index，前端全局搜索可
//! 按内容片段检索（search_code_content），点击跳转到文件 + 行号。

use crate::domain::project_code_index::{CodeIndexEntry, MAX_INDEX_LINE_LEN};
use crate::domain::project_files::ProjectFile;
use crate::error::AppResult;
use crate::infrastructure::database::project_code_index_repository::ProjectCodeIndexRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::{
    SqliteProjectCodeIndexRepository, SqliteProjectFileRepository,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering as AtomicOrdering};
use std::sync::Arc;
use rayon::prelude::*;
use tauri::{AppHandle, State};

/// 简单判定：该行是否值得索引（非空、非纯注释、长度合理）
fn is_indexable(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.len() > MAX_INDEX_LINE_LEN {
        return false;
    }
    // 跳过纯注释行（//、#、*、--、<!-- 开头），保留行内混合代码
    if t.starts_with("//")
        || t.starts_with('#')
        || t.starts_with('*')
        || t.starts_with("--")
        || t.starts_with("<!--")
        || t.starts_with("/*")
        || t.starts_with("*/")
    {
        return false;
    }
    true
}

/// 主命令：为分析的全部源码文件建立代码行索引（幂等：先删后插）
#[tauri::command(async)]
pub fn index_code_content(
    analysis_id: String,
    app: AppHandle,
    changed_rel_paths: Option<Vec<String>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    index_repo: State<'_, Arc<SqliteProjectCodeIndexRepository>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<u64> {
    let all_files: Vec<ProjectFile> = file_repo
        .list_by_analysis(&analysis_id)?
        .into_iter()
        .filter(|f| !f.is_directory)
        .collect();
    let rel_to_id: HashMap<String, String> = all_files
        .iter()
        .map(|f| (f.rel_path.clone(), f.id.clone()))
        .collect();

    // Some(空) = 有基线且零文件变更（全部携带旧行，收益最大），必须与 None（全量）区分
    let incremental = changed_rel_paths.is_some();
    let changed_set: std::collections::HashSet<String> =
        changed_rel_paths.unwrap_or_default().into_iter().collect();
    let process_files: Vec<&ProjectFile> = if incremental {
        all_files.iter().filter(|f| changed_set.contains(&f.rel_path)).collect()
    } else {
        all_files.iter().collect()
    };
    let process_total = process_files.len() as i64;

    let now = chrono::Utc::now().timestamp();
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Index,
        0, 0, process_total, "建立代码全文索引…",
    );

    // 携带未变更文件的既有索引行（按 file_path 重映射 file_id，避免悬挂引用）
    let existing = index_repo.list_by_analysis(&analysis_id)?;
    let mut carried: Vec<CodeIndexEntry> = Vec::new();
    if incremental {
        for mut entry in existing {
            if !changed_set.contains(&entry.file_path) {
                if let Some(cid) = rel_to_id.get(&entry.file_path) {
                    entry.file_id = cid.clone();
                    carried.push(entry);
                }
            }
        }
    }

    // 纯计算并行化：逐文件读盘 + 行切分，互不依赖；DB 写入留到并行区外
    let app2 = app.clone();
    let done = AtomicI64::new(0);
    let new_entries: Vec<CodeIndexEntry> = process_files
        .par_iter()
        .flat_map(|file| {
            // 计数放在入口：读盘失败提前返回的文件同样算「已处理」，避免进度条卡住
            let seq = done.fetch_add(1, AtomicOrdering::Relaxed) + 1;
            if seq % 200 == 0 {
                crate::commands::project_scan::emit_stage_progress(
                    &app2,
                    crate::commands::project_scan::ScanStage::Index,
                    ((seq as f64 / process_total.max(1) as f64) * 100.0) as i64,
                    seq,
                    process_total,
                    "建立代码全文索引…",
                );
            }
            let mut local = Vec::new();
            let Some(content) = cache.read(file) else {
                return local;
            };
            for (i, raw) in content.lines().enumerate() {
                if !is_indexable(raw) {
                    continue;
                }
                local.push(CodeIndexEntry {
                    id: format!("idx_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                    analysis_id: analysis_id.clone(),
                    file_id: file.id.clone(),
                    file_path: file.rel_path.clone(),
                    line_no: (i + 1) as i64,
                    content: raw.trim().to_string(),
                    created_at: now,
                });
            }
            local
        })
        .collect();

    let mut all_entries = carried;
    all_entries.extend(new_entries);

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Index, 100, process_total, process_total,
        "建立代码全文索引…",
    );
    index_repo.delete_by_analysis(&analysis_id)?;
    if !all_entries.is_empty() {
        index_repo.save_batch(&all_entries)?;
    }
    Ok(all_entries.len() as u64)
}

/// 全文检索：FTS5 倒排索引优先 + LIKE 兜底
///
/// 检索策略（对应「索引层：LIKE 模糊 → 词法索引」的前沿差距）：
/// 1. **FTS5 优先**：分词匹配 + bm25 相关度排序，命中词所在行越短、词频越高排越前，
///    大项目下相比 LIKE 全表扫描是数量级的性能差异。
/// 2. **LIKE 兜底**：FTS5 是按 token 匹配的，用户搜标识符**中间片段**
///    （如用 `Line` 找 `startLine`）时 FTS 无命中，此时回退子串匹配补齐结果。
/// 3. 两者结果按 (file_path, line_no) 去重合并，FTS 结果保持在前（相关度优先）。
#[tauri::command(async)]
pub fn search_code_content(
    analysis_id: String,
    query: String,
    limit: Option<usize>,
    index_repo: State<'_, Arc<SqliteProjectCodeIndexRepository>>,
) -> AppResult<Vec<CodeIndexEntry>> {
    let limit = limit.unwrap_or(30).clamp(1, 100);
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let mut out = index_repo.search_fts(&analysis_id, q, limit as i64)?;

    if out.len() < limit {
        let seen: std::collections::HashSet<(String, i64)> = out
            .iter()
            .map(|e| (e.file_path.clone(), e.line_no))
            .collect();
        let like = format!("%{}%", q);
        let fallback = index_repo.search(&analysis_id, &like, limit as i64)?;
        for e in fallback {
            if out.len() >= limit {
                break;
            }
            if !seen.contains(&(e.file_path.clone(), e.line_no)) {
                out.push(e);
            }
        }
    }

    out.truncate(limit);
    Ok(out)
}

/// 列出分析的代码索引条目数（判断是否需要建索引）
#[tauri::command]
pub fn count_code_index(
    analysis_id: String,
    index_repo: State<'_, Arc<SqliteProjectCodeIndexRepository>>,
) -> AppResult<u64> {
    let all = index_repo.list_by_analysis(&analysis_id)?;
    Ok(all.len() as u64)
}
