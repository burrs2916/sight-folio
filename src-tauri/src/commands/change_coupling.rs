//! 变更耦合分析：从版本历史里挖出「静态分析看不见的耦合」
//!
//! ## 这一维度补的是什么缺口
//!
//! 现有分析链已经能回答：
//! - 目录里有什么（project_scan）
//! - 代码里有哪些符号（code_structure）
//! - 谁 import 了谁（detect_dependencies）
//! - 谁调用了谁（call_graph）
//! - 哪个文件在快速变坏（git_history / churn）
//!
//! 但有一类耦合上述全部答不了：**两个文件之间没有任何静态关系，却每次都要
//! 一起改**。前后端契约、多处复制的常量、抽象泄漏、孪生实现……这些耦合只
//! 存在于开发者的脑子里和 git 历史里，一旦人员流动就变成隐性地雷。
//!
//! 本模块把这类耦合挖出来，并与静态依赖交叉，把结论分成两类：
//! - `structural`：有 import 且共变 —— 正常，仅在耦合度极高时提示
//! - `hidden`：**无 import 却高共变 —— 隐性耦合，重点告警**
//!
//! ## 降噪设计（这是这类分析能不能用的关键）
//!
//! 朴素实现（对每个提交里的文件两两配对）会被三种噪声淹没：
//!
//! 1. **巨型提交**：一次格式化 / 批量重命名会碰几百个文件，产生 N² 条毫无意义
//!    的"耦合"。→ 超过 `max_commit_size`（默认 30）的提交整体丢弃。
//! 2. **低频组合**：只一起改过 1~2 次纯属巧合。→ `min_co_changes`（默认 3）。
//! 3. **单侧高频**：某文件改了 500 次，凑巧和谁都撞上过。→ 用
//!    `degree = co / min(a, b)` 而非绝对次数，并用 Jaccard 交叉验证。
//!
//! ## 复杂度
//!
//! 设有 C 个提交、每个提交平均 k 个文件（已被 max_commit_size 上限约束），
//! 配对次数为 O(C · k²)，k ≤ 30 时即便 C 上万也是毫秒级。最终结果再按耦合度
//! 排序截断到 `top_n`（默认 400），避免把噪声推给前端画布。

use crate::domain::project_change_coupling::{
    degree_of, jaccard_of, ordered_pair, risk_level_of, top_dir_of, ChangeCoupling,
};
use crate::error::AppResult;
use crate::infrastructure::database::project_change_coupling_repository::ProjectChangeCouplingRepository;
use crate::infrastructure::database::project_dependency_repository::ProjectDependencyRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::{
    SqliteProjectChangeCouplingRepository, SqliteProjectDependencyRepository,
    SqliteProjectFileRepository,
};
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// 单个提交解析出的中间态
struct CommitEntry {
    at: i64,
    files: Vec<String>,
}

/// 与 git_history.rs 保持一致的重命名路径归一化
///
/// 两处各自持有一份是刻意的：git_history 用 `--numstat`（三列），本模块用
/// `--name-only`（单列），输出形态相同但解析路径不同，强行抽公共模块反而
/// 会让两边的解析器耦合在一起（正好是本分析要反对的事）。
fn normalize_path(p: &str) -> String {
    if !p.contains("=>") {
        return p.trim().to_string();
    }
    if let (Some(l), Some(r)) = (p.find('{'), p.find('}')) {
        if l < r {
            let mid = &p[l + 1..r];
            let new_part = mid.split("=>").nth(1).unwrap_or("").trim();
            let merged = format!("{}{}{}", &p[..l], new_part, &p[r + 1..]);
            return merged.replace("//", "/").trim().to_string();
        }
    }
    p.split("=>").nth(1).unwrap_or(p).trim().to_string()
}

/// `git log --name-only` → 每个提交的文件列表
fn collect_commits(project_root: &str, since_days: Option<i64>) -> Vec<CommitEntry> {
    let mut args: Vec<String> = vec![
        "-C".into(),
        project_root.into(),
        "log".into(),
        "--no-merges".into(),
        "--name-only".into(),
        "--pretty=format:\u{1e}\u{1f}%H\u{1f}%at".into(),
    ];
    if let Some(days) = since_days {
        if days > 0 {
            args.push(format!("--since={} days ago", days));
        }
    }

    let output = match Command::new("git").args(&args).output() {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut commits: Vec<CommitEntry> = Vec::new();
    let mut cur: Option<CommitEntry> = None;

    for raw in text.lines() {
        if let Some(rest) = raw.strip_prefix('\u{1e}') {
            if let Some(c) = cur.take() {
                commits.push(c);
            }
            let mut parts = rest.split('\u{1f}');
            parts.next(); // 记录头后的空段
            let _hash = parts.next().unwrap_or("");
            let at = parts
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .unwrap_or(0);
            cur = Some(CommitEntry {
                at,
                files: Vec::new(),
            });
            continue;
        }
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(c) = cur.as_mut() {
            let p = normalize_path(line);
            if !p.is_empty() {
                c.files.push(p);
            }
        }
    }
    if let Some(c) = cur.take() {
        commits.push(c);
    }
    commits
}

/// 配对统计的累加器
#[derive(Default)]
struct PairAcc {
    co: i64,
    last_at: i64,
}

/// 纯计算核心：提交列表 → 文件对共变统计
///
/// 抽成独立函数是为了能脱离 git 与数据库单测（下方 tests 直接喂造好的提交）。
fn accumulate_pairs(
    commits: &[CommitEntry],
    max_commit_size: usize,
    keep: &HashSet<String>,
) -> (HashMap<String, i64>, HashMap<(String, String), PairAcc>) {
    let mut file_commits: HashMap<String, i64> = HashMap::new();
    let mut pairs: HashMap<(String, String), PairAcc> = HashMap::new();

    for c in commits {
        // 只保留仍存在于本次扫描结果中的文件（已删除 / 被 ignore 的不进画布）
        let mut files: Vec<&String> = c
            .files
            .iter()
            .filter(|p| keep.is_empty() || keep.contains(*p))
            .collect();
        files.sort();
        files.dedup();

        if files.is_empty() {
            continue;
        }
        // 单文件提交仍要计入 file_commits（它是 degree 的分母）
        for f in &files {
            *file_commits.entry((*f).clone()).or_insert(0) += 1;
        }
        // 巨型提交：只贡献分母，不贡献配对（否则 N² 噪声淹没真信号）
        if files.len() < 2 || files.len() > max_commit_size {
            continue;
        }
        for i in 0..files.len() {
            for j in (i + 1)..files.len() {
                let (a, b) = ordered_pair(files[i], files[j]);
                let e = pairs.entry((a.to_string(), b.to_string())).or_default();
                e.co += 1;
                if c.at > e.last_at {
                    e.last_at = c.at;
                }
            }
        }
    }
    (file_commits, pairs)
}

/// 主命令：分析变更耦合并落库
///
/// - `since_days`：只看最近 N 天（None = 全量）。老仓库建议传 365，
///   否则五年前的一次性协作会被算成"当前耦合"。
/// - `min_co_changes`：最小共变次数，默认 3
/// - `min_degree`：最小耦合度，默认 0.35
/// - `max_commit_size`：超过此文件数的提交视为批量操作丢弃，默认 30
/// - `top_n`：结果上限，默认 400
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn analyze_change_coupling(
    analysis_id: String,
    app: AppHandle,
    project_root: String,
    since_days: Option<i64>,
    min_co_changes: Option<i64>,
    min_degree: Option<f64>,
    max_commit_size: Option<i64>,
    top_n: Option<i64>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    dep_repo: State<'_, Arc<SqliteProjectDependencyRepository>>,
    cc_repo: State<'_, Arc<SqliteProjectChangeCouplingRepository>>,
) -> AppResult<Vec<ChangeCoupling>> {
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::ChangeCoupling,
        0,
        0,
        1,
        "分析变更耦合…",
    );
    let min_co = min_co_changes.unwrap_or(3).max(2);
    let min_deg = min_degree.unwrap_or(0.35).clamp(0.0, 1.0);
    let max_size = max_commit_size.unwrap_or(30).max(2) as usize;
    let limit = top_n.unwrap_or(400).max(1) as usize;

    // rel_path → file_id
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let index: HashMap<String, String> = files
        .iter()
        .filter(|f| !f.is_directory)
        .map(|f| (f.rel_path.clone(), f.id.clone()))
        .collect();
    let keep: HashSet<String> = index.keys().cloned().collect();

    let commits = collect_commits(&project_root, since_days);
    if commits.is_empty() {
        cc_repo.delete_by_analysis(&analysis_id)?;
        crate::commands::project_scan::emit_stage_progress(
            &app,
            crate::commands::project_scan::ScanStage::ChangeCoupling,
            100,
            1,
            1,
            "无 Git 历史",
        );
        return Ok(Vec::new());
    }

    let (file_commits, pairs) = accumulate_pairs(&commits, max_size, &keep);

    // 静态依赖集合（无向）：用于判定 structural / hidden
    let deps = dep_repo.list_by_analysis(&analysis_id)?;
    let mut static_pairs: HashSet<(String, String)> = HashSet::new();
    for d in &deps {
        if d.from_type != "file" || d.to_type != "file" {
            continue;
        }
        let (a, b) = ordered_pair(d.from_id.as_str(), d.to_id.as_str());
        static_pairs.insert((a.to_string(), b.to_string()));
    }

    let now = chrono::Utc::now().timestamp();
    let mut items: Vec<ChangeCoupling> = Vec::new();

    for ((pa, pb), acc) in pairs {
        if acc.co < min_co {
            continue;
        }
        let ca = *file_commits.get(&pa).unwrap_or(&0);
        let cb = *file_commits.get(&pb).unwrap_or(&0);
        let degree = degree_of(acc.co, ca, cb);
        if degree < min_deg {
            continue;
        }
        let (Some(ida), Some(idb)) = (index.get(&pa), index.get(&pb)) else {
            continue;
        };
        let (ia, ib) = ordered_pair(ida.as_str(), idb.as_str());
        let is_structural = static_pairs.contains(&(ia.to_string(), ib.to_string()));
        let cross_module = top_dir_of(&pa) != top_dir_of(&pb);
        let hidden = !is_structural;

        items.push(ChangeCoupling {
            id: format!("cc_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
            analysis_id: analysis_id.clone(),
            file_a_id: ida.clone(),
            file_a_path: pa.clone(),
            file_b_id: idb.clone(),
            file_b_path: pb.clone(),
            co_changes: acc.co,
            commits_a: ca,
            commits_b: cb,
            degree,
            jaccard: jaccard_of(acc.co, ca, cb),
            is_structural,
            cross_module,
            coupling_kind: if hidden { "hidden" } else { "structural" }.to_string(),
            risk_level: risk_level_of(degree, acc.co, hidden, cross_module).to_string(),
            last_co_change_at: acc.last_at,
            created_at: now,
        });
    }

    // 排序口径：先按风险等级，再按耦合度，再按共变次数
    // —— 让"隐性 + 跨模块"的高危对排在最前，用户一眼看到最该处理的
    let rank = |lv: &str| match lv {
        "extreme" => 3,
        "high" => 2,
        "medium" => 1,
        _ => 0,
    };
    items.sort_by(|a, b| {
        rank(&b.risk_level)
            .cmp(&rank(&a.risk_level))
            .then(
                b.degree
                    .partial_cmp(&a.degree)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(b.co_changes.cmp(&a.co_changes))
            .then(a.file_a_path.cmp(&b.file_a_path))
    });
    items.truncate(limit);

    cc_repo.delete_by_analysis(&analysis_id)?;
    if !items.is_empty() {
        cc_repo.save_batch(&items)?;
    }
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::ChangeCoupling,
        100,
        1,
        1,
        "变更耦合分析完成",
    );
    Ok(items)
}

/// 列出已落库的变更耦合
#[tauri::command(async)]
pub fn list_change_coupling(
    analysis_id: String,
    cc_repo: State<'_, Arc<SqliteProjectChangeCouplingRepository>>,
) -> AppResult<Vec<ChangeCoupling>> {
    cc_repo.list_by_analysis(&analysis_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(at: i64, files: &[&str]) -> CommitEntry {
        CommitEntry {
            at,
            files: files.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn pairs_counted_across_commits() {
        let commits = vec![
            commit(100, &["a.ts", "b.ts"]),
            commit(200, &["a.ts", "b.ts"]),
            commit(300, &["a.ts", "c.ts"]),
        ];
        let (fc, pairs) = accumulate_pairs(&commits, 30, &HashSet::new());
        assert_eq!(*fc.get("a.ts").unwrap(), 3);
        assert_eq!(*fc.get("b.ts").unwrap(), 2);
        let ab = pairs.get(&("a.ts".into(), "b.ts".into())).unwrap();
        assert_eq!(ab.co, 2);
        assert_eq!(ab.last_at, 200);
        assert_eq!(pairs.get(&("a.ts".into(), "c.ts".into())).unwrap().co, 1);
    }

    #[test]
    fn giant_commit_contributes_denominator_but_no_pairs() {
        // 一次触碰 5 个文件的批量提交，在 max_commit_size = 3 时不产生配对
        let commits = vec![commit(100, &["a", "b", "c", "d", "e"])];
        let (fc, pairs) = accumulate_pairs(&commits, 3, &HashSet::new());
        assert_eq!(*fc.get("a").unwrap(), 1, "分母仍要计入");
        assert!(pairs.is_empty(), "巨型提交不得产生 N² 噪声");
    }

    #[test]
    fn keep_filter_excludes_deleted_files() {
        let mut keep = HashSet::new();
        keep.insert("a.ts".to_string());
        keep.insert("b.ts".to_string());
        let commits = vec![commit(100, &["a.ts", "b.ts", "gone.ts"])];
        let (fc, pairs) = accumulate_pairs(&commits, 30, &keep);
        assert!(fc.get("gone.ts").is_none());
        assert_eq!(pairs.len(), 1, "只应剩 a-b 一对");
    }

    #[test]
    fn duplicate_paths_in_one_commit_counted_once() {
        // git log 对同一提交里被多次记录的路径（极少见但存在）不能重复计数
        let commits = vec![commit(100, &["a.ts", "a.ts", "b.ts"])];
        let (fc, pairs) = accumulate_pairs(&commits, 30, &HashSet::new());
        assert_eq!(*fc.get("a.ts").unwrap(), 1);
        assert_eq!(pairs.get(&("a.ts".into(), "b.ts".into())).unwrap().co, 1);
    }

    #[test]
    fn single_file_commit_makes_no_pair() {
        let commits = vec![commit(100, &["solo.ts"])];
        let (fc, pairs) = accumulate_pairs(&commits, 30, &HashSet::new());
        assert_eq!(*fc.get("solo.ts").unwrap(), 1);
        assert!(pairs.is_empty());
    }

    #[test]
    fn normalize_rename_paths() {
        assert_eq!(normalize_path("src/{old => new}/a.ts"), "src/new/a.ts");
        assert_eq!(normalize_path("old.ts => new.ts"), "new.ts");
        assert_eq!(normalize_path("plain.ts"), "plain.ts");
    }
}
