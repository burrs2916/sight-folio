//! Git 历史分析：把静态快照扩展到时间维度
//!
//! 现有的扫描能力（目录 / 结构 / 引用 / 复杂度 / 技术债）回答的都是
//! 「代码**现在**长什么样」。但真正决定重构优先级的往往是另一个问题：
//! **「哪些文件在持续变坏」**。
//!
//! 业界共识（Michael Feathers 的 churn-vs-complexity 四象限）：
//! - 高复杂度 + 高变更 = 重构第一优先级（每次改都痛，且还在一直改）
//! - 高复杂度 + 低变更 = 稳定的遗留代码，可以先不碰
//! - 低复杂度 + 高变更 = 正常的活跃开发区
//! - 低复杂度 + 低变更 = 健康
//!
//! 本模块通过 `git log --numstat` 采集每个文件的提交次数、增删行数、作者数，
//! 与 project_file_metrics 的圈复杂度交叉后即可在画布上直接画出这四象限。
//!
//! 实现约束：不引入 git2 依赖（编译重、跨平台链接麻烦），直接调用系统 git，
//! 无 git / 非仓库时安静降级为空结果，绝不打断整条扫描链。

use crate::domain::project_git_churn::{churn_score_of, hotspot_level_of, GitChurn};
use crate::error::AppResult;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_git_churn_repository::ProjectGitChurnRepository;
use crate::infrastructure::database::{
    SqliteProjectFileRepository, SqliteProjectGitChurnRepository,
};
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, State};

/// 单条提交记录解析出的中间态
#[derive(Default)]
struct Acc {
    commits: HashSet<String>,
    authors: HashSet<String>,
    added: i64,
    deleted: i64,
    first_at: i64,
    last_at: i64,
}

/// 判断目录是否在 git 工作区内
#[tauri::command]
pub fn is_git_repo(project_root: String) -> bool {
    Command::new("git")
        .args(["-C", &project_root, "rev-parse", "--is-inside-work-tree"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

/// 归一化 numstat 中的重命名路径，统一取「新路径」
///
/// git 会输出三种形态：
/// - `old.rs => new.rs`
/// - `src/{old => new}/mod.rs`
/// - `src/{ => new}/mod.rs`
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

/// 执行 git log 并聚合出每个文件的 churn 指标
fn collect_churn(project_root: &str, since_days: Option<i64>) -> HashMap<String, Acc> {
    let mut map: HashMap<String, Acc> = HashMap::new();

    let mut args: Vec<String> = vec![
        "-C".into(),
        project_root.into(),
        "log".into(),
        "--no-merges".into(),
        "--numstat".into(),
        // \x1e 作记录分隔，\x1f 作字段分隔，避免作者名 / 路径中出现分隔符
        "--pretty=format:\u{1e}\u{1f}%H\u{1f}%at\u{1f}%an".into(),
    ];
    if let Some(days) = since_days {
        if days > 0 {
            args.push(format!("--since={} days ago", days));
        }
    }

    let output = match Command::new("git").args(&args).output() {
        Ok(o) if o.status.success() => o,
        _ => return map,
    };
    let text = String::from_utf8_lossy(&output.stdout);

    let mut cur_hash = String::new();
    let mut cur_at: i64 = 0;
    let mut cur_author = String::new();

    for raw in text.lines() {
        if let Some(rest) = raw.strip_prefix('\u{1e}') {
            let mut parts = rest.split('\u{1f}');
            parts.next(); // 记录头后的空段
            cur_hash = parts.next().unwrap_or("").to_string();
            cur_at = parts.next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            cur_author = parts.next().unwrap_or("").to_string();
            continue;
        }
        let line = raw.trim();
        if line.is_empty() || cur_hash.is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let added_raw = cols.next().unwrap_or("-");
        let deleted_raw = cols.next().unwrap_or("-");
        let path_raw = match cols.next() {
            Some(p) if !p.is_empty() => p,
            _ => continue,
        };
        // 二进制文件为 "-"，计入提交次数但不计行数
        let added: i64 = added_raw.parse().unwrap_or(0);
        let deleted: i64 = deleted_raw.parse().unwrap_or(0);
        let path = normalize_path(path_raw);
        if path.is_empty() {
            continue;
        }

        let acc = map.entry(path).or_default();
        acc.commits.insert(cur_hash.clone());
        if !cur_author.is_empty() {
            acc.authors.insert(cur_author.clone());
        }
        acc.added += added;
        acc.deleted += deleted;
        if acc.last_at == 0 || cur_at > acc.last_at {
            acc.last_at = cur_at;
        }
        if acc.first_at == 0 || (cur_at > 0 && cur_at < acc.first_at) {
            acc.first_at = cur_at;
        }
    }
    map
}

/// 主命令：采集 git 变更热点并落库
///
/// `since_days` 传 None 表示全量历史；传 90 表示只看最近三个月
/// （老仓库全量会把早已稳定的文件也算成热点，近期窗口更贴近"现在在改哪"）。
#[tauri::command(async)]
pub fn analyze_git_history(
    analysis_id: String,
    app: AppHandle,
    project_root: String,
    since_days: Option<i64>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    churn_repo: State<'_, Arc<SqliteProjectGitChurnRepository>>,
) -> AppResult<Vec<GitChurn>> {
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Git,
        0,
        0,
        1,
        "分析 Git 变更热点…",
    );
    let raw = collect_churn(&project_root, since_days);
    if raw.is_empty() {
        churn_repo.delete_by_analysis(&analysis_id)?;
        crate::commands::project_scan::emit_stage_progress(
            &app,
            crate::commands::project_scan::ScanStage::Git,
            100,
            1,
            1,
            "无 Git 历史",
        );
        return Ok(Vec::new());
    }

    // rel_path → file_id，只保留仍存在于当前扫描结果中的文件
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let index: HashMap<String, String> = files
        .iter()
        .filter(|f| !f.is_directory)
        .map(|f| (f.rel_path.clone(), f.id.clone()))
        .collect();

    let now = chrono::Utc::now().timestamp();
    let mut items: Vec<GitChurn> = Vec::new();
    for (path, acc) in raw {
        let file_id = match index.get(&path) {
            Some(id) => id.clone(),
            None => continue, // 已删除 / 被忽略的文件不进画布
        };
        let commit_count = acc.commits.len() as i64;
        let author_count = acc.authors.len() as i64;
        let score = churn_score_of(commit_count, acc.added, acc.deleted, author_count);
        items.push(GitChurn {
            id: format!(
                "churn_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.clone(),
            file_id,
            file_path: path,
            commit_count,
            added_lines: acc.added,
            deleted_lines: acc.deleted,
            author_count,
            last_commit_at: acc.last_at,
            first_commit_at: acc.first_at,
            churn_score: score,
            hotspot_level: hotspot_level_of(score).to_string(),
            created_at: now,
        });
    }

    items.sort_by(|a, b| b.churn_score.cmp(&a.churn_score));

    churn_repo.delete_by_analysis(&analysis_id)?;
    if !items.is_empty() {
        churn_repo.save_batch(&items)?;
    }
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Git,
        100,
        1,
        1,
        "Git 变更热点分析完成",
    );
    Ok(items)
}

/// 列出已落库的变更热点
#[tauri::command(async)]
pub fn list_git_churn(
    analysis_id: String,
    churn_repo: State<'_, Arc<SqliteProjectGitChurnRepository>>,
) -> AppResult<Vec<GitChurn>> {
    churn_repo.list_by_analysis(&analysis_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_plain_path() {
        assert_eq!(normalize_path("src/a.rs"), "src/a.rs");
    }

    #[test]
    fn normalize_simple_rename() {
        assert_eq!(normalize_path("old.rs => new.rs"), "new.rs");
    }

    #[test]
    fn normalize_braced_rename() {
        assert_eq!(normalize_path("src/{old => new}/mod.rs"), "src/new/mod.rs");
    }

    #[test]
    fn normalize_braced_rename_with_empty_left() {
        assert_eq!(normalize_path("src/{ => new}/mod.rs"), "src/new/mod.rs");
    }

    #[test]
    fn hotspot_levels_are_monotonic() {
        assert_eq!(hotspot_level_of(3), "low");
        assert_eq!(hotspot_level_of(20), "medium");
        assert_eq!(hotspot_level_of(50), "high");
        assert_eq!(hotspot_level_of(200), "extreme");
    }
}
