//! 技术债扫描命令：TODO/FIXME/HACK/XXX/OPTIMIZE/DEPRECATED 标记提取
//!
//! 对应需求文档「新需求点发掘」：代码中的遗留标记是技术债的最直观体现。
//! 产出 project_tech_debt 表，前端据此：
//! - 左侧实体面板「技术债」分组（按标记类型聚合，点击定位文件）
//! - 文件树 / 画布文件实体的技术债徽标（TODO 数量）
//! - 技术债画像（画布按技术债密度布局着色）

use crate::domain::project_files::ProjectFile;
use crate::domain::project_tech_debt::{severity_of, TechDebtItem};
use crate::error::AppResult;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_tech_debt_repository::ProjectTechDebtRepository;
use crate::infrastructure::database::{
    SqliteProjectFileRepository, SqliteProjectTechDebtRepository,
};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI64, Ordering as AtomicOrdering};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// 需要扫描的标记（优先匹配长的，避免 XXX 抢先命中 FIXME 子串）
const MARKERS: [&str; 6] = ["FIXME", "DEPRECATED", "OPTIMIZE", "HACK", "TODO", "XXX"];

/// 提取单行中的技术债标记
fn extract_markers(line: &str) -> Vec<(String, String)> {
    let upper = line.to_uppercase();
    let mut hits: Vec<(usize, String)> = Vec::new();
    for m in MARKERS {
        let mut start = 0;
        while let Some(pos) = upper[start..].find(m) {
            let abs = start + pos;
            // 要求标记前后是非字母数字字符，避免误命中（如 "TODOS"）
            let before_ok = abs == 0 || !upper.as_bytes()[abs - 1].is_ascii_alphanumeric();
            let after_ok = abs + m.len() >= upper.len()
                || !upper.as_bytes()[abs + m.len()].is_ascii_alphanumeric();
            if before_ok && after_ok {
                hits.push((abs, m.to_string()));
            }
            start = abs + m.len();
        }
    }
    hits.sort_by_key(|(pos, _)| *pos);
    // 相邻重复（如 XXX TODO 同处一行）保留
    hits.into_iter()
        .map(|(_, m)| (m.clone(), severity_of(&m).to_string()))
        .collect()
}

/// 主命令：扫描全部源码文件的技术债标记，写入 project_tech_debt
///
/// `changed_rel_paths` 非空时走**增量**：未变更文件的既有技术债行按
/// `file_path → 当前 file_id` 重映射后原样携带（本表只引用 file_id，
/// 不含跨文件符号耦合，重映射后不会留下悬挂引用），只对变更文件重扫。
#[tauri::command(async)]
pub fn scan_tech_debt(
    analysis_id: String,
    app: AppHandle,
    changed_rel_paths: Option<Vec<String>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    debt_repo: State<'_, Arc<SqliteProjectTechDebtRepository>>,
    cancel: State<'_, crate::commands::project_scan::AnalysisCancelState>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<TechDebtItem>> {
    let all_files = file_repo.list_by_analysis(&analysis_id)?;
    let files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();
    let total = files.len() as i64;
    let now = chrono::Utc::now().timestamp();
    let cancel_state = cancel.inner().clone();

    // rel_path → 本次扫描的 file_id：file_id 每次扫描都会重新生成，
    // 携带旧行前必须按路径重映射，否则会指向已被删除的文件记录。
    let rel_to_id: HashMap<&str, &str> = files
        .iter()
        .map(|f| (f.rel_path.as_str(), f.id.as_str()))
        .collect();

    // Some(空) = 有基线且零文件变更（全部携带旧行，收益最大），必须与 None（全量）区分
    let incremental = changed_rel_paths.is_some();
    let changed: HashSet<String> = changed_rel_paths.unwrap_or_default().into_iter().collect();

    // 携带未变更文件的既有结果（已删除的文件自然不在 rel_to_id 里，直接丢弃）
    let mut carried: Vec<TechDebtItem> = Vec::new();
    if incremental {
        for mut item in debt_repo.list_by_analysis(&analysis_id)? {
            if changed.contains(&item.file_path) {
                continue;
            }
            if let Some(fid) = rel_to_id.get(item.file_path.as_str()) {
                item.file_id = (*fid).to_string();
                carried.push(item);
            }
        }
    }

    let process_files: Vec<&ProjectFile> = if incremental {
        files
            .iter()
            .copied()
            .filter(|f| changed.contains(&f.rel_path))
            .collect()
    } else {
        files.clone()
    };
    let process_total = process_files.len() as i64;

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::TechDebt,
        0,
        0,
        total,
        if incremental {
            "扫描技术债（增量）…"
        } else {
            "扫描技术债…"
        },
    );

    let done = AtomicI64::new(0);
    // 纯文本扫描，逐文件互不依赖 → 并行；DB 写留在并行区外串行提交
    let mut items: Vec<TechDebtItem> = process_files
        .par_iter()
        .filter(|_| !crate::commands::project_scan::analysis_cancelled(&cancel_state, &analysis_id))
        .flat_map_iter(|file| {
            let seq = done.fetch_add(1, AtomicOrdering::Relaxed) + 1;
            if seq % 200 == 0 {
                crate::commands::project_scan::emit_stage_progress(
                    &app,
                    crate::commands::project_scan::ScanStage::TechDebt,
                    ((seq as f64 / process_total.max(1) as f64) * 100.0) as i64,
                    seq,
                    process_total,
                    "扫描技术债…",
                );
            }
            let mut out: Vec<TechDebtItem> = Vec::new();
            if let Some(content) = cache.read(file) {
                for (i, raw) in content.lines().enumerate() {
                    let line = raw.trim();
                    if line.is_empty() {
                        continue;
                    }
                    let markers = extract_markers(line);
                    if markers.is_empty() {
                        continue;
                    }
                    for (marker, severity) in markers {
                        let snippet: String = line.chars().take(120).collect();
                        out.push(TechDebtItem {
                            id: format!(
                                "debt_{}",
                                uuid::Uuid::new_v4().to_string().replace("-", "")
                            ),
                            analysis_id: analysis_id.clone(),
                            file_id: file.id.clone(),
                            file_path: file.rel_path.clone(),
                            line_no: (i + 1) as i64,
                            marker,
                            severity,
                            snippet,
                            created_at: now,
                        });
                    }
                }
            }
            out.into_iter()
        })
        .collect();

    items.extend(carried);

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::TechDebt,
        100,
        total,
        total,
        "技术债扫描完成",
    );

    debt_repo.delete_by_analysis(&analysis_id)?;
    if !items.is_empty() {
        debt_repo.save_batch(&items)?;
    }
    Ok(items)
}

/// 列出分析的全部技术债标记
#[tauri::command(async)]
pub fn list_tech_debt(
    analysis_id: String,
    debt_repo: State<'_, Arc<SqliteProjectTechDebtRepository>>,
) -> AppResult<Vec<TechDebtItem>> {
    debt_repo.list_by_analysis(&analysis_id)
}
