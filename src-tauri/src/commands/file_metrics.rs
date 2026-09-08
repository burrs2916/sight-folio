//! 文件度量分析命令：行数统计 + 圈复杂度（复杂度热力图的数据基础）
//!
//! 对应需求文档「扫描项目需要分析：文件目录、代码结构、代码之间的引用、索引、依赖关系、
//! 设计模式」以及 §2「复杂度热力图」视角（typescriptAnalyzer 插件已注册该视角模板，
//! 本命令补齐数据侧缺口）。
//!
//! 产出 project_file_metrics 表，前端据此：
//! - 画布文件实体按复杂度等级热力着色（低/中/高/极高）
//! - 左侧文件树显示复杂度徽标
//! - 报告导出包含复杂度分布

use crate::domain::project_file_metrics::{complexity_level_of, FileMetric};
use crate::domain::project_files::ProjectFile;
use crate::error::AppResult;
use crate::infrastructure::ast;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_file_metric_repository::ProjectFileMetricRepository;
use crate::infrastructure::database::{
    SqliteProjectFileMetricRepository, SqliteProjectFileRepository,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use rayon::prelude::*;
use tauri::{AppHandle, State};

/// 计算单个文件的度量指标
fn compute_metric(file_id: &str, analysis_id: &str, rel_path: &str, lang: &str, content: &str) -> FileMetric {
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len() as i64;

    // 逐行分类：空行 / 注释行（含块注释状态机）/ 代码行
    let mut code_lines = 0i64;
    let mut comment_lines = 0i64;
    let mut blank_lines = 0i64;
    let mut in_block = false; // /* ... */ 块注释跨行状态

    for raw in &lines {
        let line = raw.trim();
        if line.is_empty() {
            blank_lines += 1;
            continue;
        }
        if in_block {
            comment_lines += 1;
            if line.contains("*/") {
                in_block = false;
            }
            continue;
        }
        if is_block_start(line) {
            comment_lines += 1;
            if !line.contains("*/") {
                in_block = true;
            }
            continue;
        }
        if is_line_comment(lang, line) {
            comment_lines += 1;
            continue;
        }
        code_lines += 1;
    }

    // ── 复杂度：优先 AST 精确计数，语言不支持时退回行级启发式 ──
    //
    // 两条路径产出的 FileMetric 结构完全相同，差别只在 `engine` 字段与
    // 是否带函数级明细，前端据此标注精度，不会把估算值当精确值展示。
    let astr = ast::analyze_source(lang, rel_path, content);

    let (cc, engine, max_nesting, function_count, max_function_cc, hot_function, magic_count, meta) =
        match &astr {
            Some(a) => {
                let hot = a.hottest_function().map(|f| f.name.clone()).unwrap_or_default();
                let meta = serde_json::json!({
                    "language": lang,
                    "engine": "ast",
                    "hasError": a.has_error,
                    "errorLines": a.error_lines,
                    "functions": a.functions,
                    "magicNumbers": a.magic_numbers,
                })
                .to_string();
                (
                    a.cyclomatic_complexity,
                    "ast",
                    a.max_nesting,
                    a.function_count(),
                    a.max_function_cc(),
                    hot,
                    a.magic_numbers.len() as i64,
                    meta,
                )
            }
            None => {
                let cc = estimate_complexity(lang, &lines);
                let meta = serde_json::json!({ "language": lang, "engine": "heuristic" }).to_string();
                (cc, "heuristic", 0, 0, 0, String::new(), 0, meta)
            }
        };

    FileMetric {
        id: format!("mtr_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
        analysis_id: analysis_id.to_string(),
        file_id: file_id.to_string(),
        file_path: rel_path.to_string(),
        total_lines: total,
        code_lines,
        comment_lines,
        blank_lines,
        cyclomatic_complexity: cc,
        complexity_level: complexity_level_of(cc).to_string(),
        engine: engine.to_string(),
        max_nesting,
        function_count,
        max_function_cc,
        hot_function,
        magic_number_count: magic_count,
        metadata: meta,
        created_at: chrono::Utc::now().timestamp(),
    }
}

/// 是否为块注释起始行（/* 开头，含 C 系语言与 Rust 的 /** 文档注释）
fn is_block_start(line: &str) -> bool {
    line.starts_with("/*") || line.starts_with("/**")
}

/// 是否为单行注释（按语言判定）
fn is_line_comment(lang: &str, line: &str) -> bool {
    if line.starts_with("//") || line.starts_with('*') {
        return true; // C 系、Rust、以及块注释中间行（* 开头在块内时已被状态机捕获）
    }
    if line.starts_with('#') {
        return true; // Python / Shell / Ruby / YAML
    }
    if line.starts_with("--") {
        return true; // SQL
    }
    if line.starts_with("<!--") {
        return true; // HTML/XML/Vue 模板
    }
    if line.starts_with('"') && line.ends_with('"') && line.len() > 2 && line.len() < 80 {
        // Python/Rust 的 docstring 简化判定：整行字符串字面量视为注释
        if matches!(lang, "python" | "rust") {
            return true;
        }
    }
    false
}

/// 圈复杂度近似：控制流关键字 + 布尔运算符 + 三元表达式
fn estimate_complexity(lang: &str, lines: &[&str]) -> i64 {
    let mut cc = 1i64; // 线性执行路径为 1
    for raw in lines {
        let line = raw.trim();
        if line.is_empty() || is_line_comment(lang, line) || is_block_start(line) {
            continue;
        }
        // 控制流关键字（每出现一个分支/循环/异常处理 +1）
        for kw in ["if ", "for ", "while ", "switch ", "case ", "catch ", "except ", "elif "] {
            if line.contains(kw) {
                cc += 1;
            }
        }
        // Rust match / if let / loop
        if lang == "rust" {
            if line.contains("match ") || line.contains("if let ") || line == "loop" || line.starts_with("loop ") {
                cc += 1;
            }
        }
        // Go 的 select 分支
        if lang == "go" && line.starts_with("case ") {
            cc += 1;
        }
        // 布尔短路运算符
        cc += line.matches("&&").count() as i64;
        cc += line.matches("||").count() as i64;
        // 三元/空值合并（排除 ?. 可选链、?? 与 泛型约束 ?:? 简化）
        let q = line.matches('?').count() as i64;
        let dot_q = line.matches("?.").count() as i64;
        let d_q = line.matches("??").count() as i64;
        let ternary = q - dot_q - d_q;
        cc += ternary.max(0);
    }
    cc.max(1)
}

/// 主命令：分析全部源码文件的度量指标，写入 project_file_metrics
///
/// `changed_rel_paths` 非空时走**增量**：未变更文件的既有度量按
/// `file_path → 当前 file_id` 重映射后携带，只重算变更文件。
/// 本表只引用 file_id（无跨文件符号耦合），重映射后不会产生悬挂引用。
#[tauri::command(async)]
pub fn analyze_file_metrics(
    analysis_id: String,
    app: AppHandle,
    changed_rel_paths: Option<Vec<String>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    metric_repo: State<'_, Arc<SqliteProjectFileMetricRepository>>,
    cancel: State<'_, crate::commands::project_scan::AnalysisCancelState>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<FileMetric>> {
    let all_files = file_repo.list_by_analysis(&analysis_id)?;
    let files: Vec<&ProjectFile> = all_files.iter().filter(|f| !f.is_directory).collect();
    let total = files.len() as i64;
    // 取消标志复制到 Arc，便于在 rayon 并行闭包里安全读取（State 不可跨线程移动）
    let cancel_state = cancel.inner().clone();

    // rel_path → 本次扫描的 file_id（file_id 每轮重新生成，携带旧行必须重映射）
    let rel_to_id: HashMap<&str, &str> = files
        .iter()
        .map(|f| (f.rel_path.as_str(), f.id.as_str()))
        .collect();

    // Some(空) = 有基线且零文件变更（全部携带旧行，收益最大），必须与 None（全量）区分
    let incremental = changed_rel_paths.is_some();
    let changed: HashSet<String> = changed_rel_paths.unwrap_or_default().into_iter().collect();

    let mut carried: Vec<FileMetric> = Vec::new();
    if incremental {
        for mut m in metric_repo.list_by_analysis(&analysis_id)? {
            if changed.contains(&m.file_path) {
                continue;
            }
            if let Some(fid) = rel_to_id.get(m.file_path.as_str()) {
                m.file_id = (*fid).to_string();
                carried.push(m);
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

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Metrics,
        0,
        0,
        total,
        if incremental {
            "度量文件复杂度（增量并行）…"
        } else {
            "度量文件复杂度（并行）…"
        },
    );

    // 纯计算阶段并行化：每个文件独立读取 + 行级/ AST 度量，互不依赖。
    // 取消检查放在每个任务入口；一旦置位，后续任务直接跳过（已调度任务仍会跑完，属可接受降级）。
    // DB 写入留在并行区之外串行批量提交，避免跨线程争用连接。
    let mut metrics: Vec<FileMetric> = process_files
        .par_iter()
        .filter(|_| !crate::commands::project_scan::analysis_cancelled(&cancel_state, &analysis_id))
        .map(|file| {
            let Some(content) = cache.read(file) else {
                return None;
            };
            let lang = file.language.as_deref().unwrap_or("");
            Some(compute_metric(
                &file.id,
                &analysis_id,
                &file.rel_path,
                lang,
                &content,
            ))
        })
        .filter_map(|x| x)
        .collect();

    metrics.extend(carried);

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Metrics,
        100,
        total,
        total,
        "度量完成",
    );

    metric_repo.delete_by_analysis(&analysis_id)?;
    if !metrics.is_empty() {
        metric_repo.save_batch(&metrics)?;
    }
    Ok(metrics)
}

/// 列出分析的全部文件度量（前端热力图/画像/报告用）
#[tauri::command(async)]
pub fn list_file_metrics(
    analysis_id: String,
    metric_repo: State<'_, Arc<SqliteProjectFileMetricRepository>>,
) -> AppResult<Vec<FileMetric>> {
    metric_repo.list_by_analysis(&analysis_id)
}
