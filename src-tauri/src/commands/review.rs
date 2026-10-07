use crate::commands::AnalysisState;
use crate::domain::project_dependencies::ProjectDependency;
use crate::domain::project_files::ProjectFile;
use crate::domain::project_modules::ProjectModule;
use crate::domain::review_findings::ReviewFinding;
use crate::domain::review_rules::ReviewRule;
use crate::error::AppResult;
use crate::infrastructure::database::analysis_repository::AnalysisRepository;
use crate::infrastructure::database::project_dependency_repository::ProjectDependencyRepository;
use crate::infrastructure::database::project_file_repository::ProjectFileRepository;
use crate::infrastructure::database::project_module_repository::ProjectModuleRepository;
use crate::infrastructure::database::review_finding_repository::ReviewFindingRepository;
use crate::infrastructure::database::review_rule_repository::ReviewRuleRepository;
use crate::infrastructure::database::{
    SqliteProjectDependencyRepository, SqliteProjectFileRepository, SqliteProjectModuleRepository,
    SqliteReviewFindingRepository, SqliteReviewRuleRepository,
};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, State};

/// 规则语言作用域判断（§4.2 RuleRegistry ↔ 引擎 深度联动）
///
/// scope 语义：
/// - "all" 或空 → 通用规则，适用于所有语言
/// - 具体语言（"typescript"/"rust"/"python"）→ 仅适用于该语言的分析
fn rule_applies_to_language(rule: &ReviewRule, language: &str) -> bool {
    let scope = rule.scope.trim();
    scope.is_empty() || scope == "all" || scope == language
}

/// 文件级语言过滤：规则 scope 为具体语言时，仅检查匹配该语言的文件（混合项目场景）
fn file_matches_rule_language(rule: &ReviewRule, file: &ProjectFile) -> bool {
    let scope = rule.scope.trim();
    if scope.is_empty() || scope == "all" {
        return true;
    }
    file.language.as_deref() == Some(scope)
}

fn filter_files_by_rule(rule: &ReviewRule, files: &[ProjectFile]) -> Vec<ProjectFile> {
    files
        .iter()
        .filter(|f| file_matches_rule_language(rule, f))
        .cloned()
        .collect()
}

/// 执行一个 analysis 的所有 enabled 审查规则（按分析语言分发）
///
/// 支持规则类型：
/// - metric:   指标阈值（如 line_count > 800）
/// - metadata: 必填字段检查（如 layer_id 非空）
/// - unsafe:   Rust unsafe 代码块检测（读取源码扫描）
/// - graph:    图算法（circular 循环依赖 / in_degree_zero 死代码）
///
/// 规则 rule_body 格式：
/// - metric:   {"metric":"line_count","op":">","threshold":800}
/// - metadata: {"required_field":"layer_id","error_if_null":true}
/// - unsafe:   {"keywords":["unsafe"],"min_hits":1}
/// - graph:    {"algorithm":"circular","min_cycle_length":2} / {"algorithm":"in_degree_zero","min_lines":10}
///
/// 语言分发：读取 analysis.primary_language，仅执行 scope 匹配的规则
/// （scope="all" 的通用规则始终执行；scope 为具体语言的规则仅语言命中时执行）。
#[tauri::command(async)]
pub fn run_review_rules(
    analysis_id: String,
    app: AppHandle,
    analysis_state: State<'_, AnalysisState>,
    rule_repo: State<'_, Arc<SqliteReviewRuleRepository>>,
    finding_repo: State<'_, Arc<SqliteReviewFindingRepository>>,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    dep_repo: State<'_, Arc<SqliteProjectDependencyRepository>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<ReviewFinding>> {
    // 审查阶段进度（14 阶段之第 3 阶段：枚举 → 依赖 → 审查）
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Review,
        0,
        0,
        1,
        "执行审查规则…",
    );

    // 1. 读取分析的主要语言（语言分发依据）
    let analysis = analysis_state.repository.get_analysis_by_id(&analysis_id)?;
    let language = analysis
        .as_ref()
        .and_then(|a| a.primary_language.clone())
        .unwrap_or_default();

    // 2. 拉取数据
    let rules = rule_repo.list_enabled()?;
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let deps = dep_repo.list_by_analysis(&analysis_id)?;

    let mut findings: Vec<ReviewFinding> = Vec::new();

    for rule in &rules {
        // 按语言分发：scope 不匹配当前分析的规则跳过
        if !rule_applies_to_language(rule, &language) {
            continue;
        }

        match (rule.rule_type.as_str(), rule.target_type.as_str()) {
            ("metric", "file") => {
                let lang_files = filter_files_by_rule(rule, &files);
                findings.extend(apply_metric_rule_on_files(&analysis_id, rule, &lang_files));
            }
            ("metadata", "module") => {
                // sight-folio: 模块暂存扫描结果中的目录聚合（暂用 directory file 代替）
                let folders: Vec<ProjectFile> = files
                    .iter()
                    .filter(|f| f.is_directory && file_matches_rule_language(rule, f))
                    .cloned()
                    .collect();
                findings.extend(apply_metadata_rule_on_files(
                    &analysis_id,
                    rule,
                    &folders,
                    Some("module"),
                ));
            }
            ("metadata", "file") => {
                let lang_files = filter_files_by_rule(rule, &files);
                findings.extend(apply_metadata_rule_on_files(
                    &analysis_id,
                    rule,
                    &lang_files,
                    None,
                ));
            }
            ("unsafe", "file") => {
                // Rust 专属：unsafe 代码块检测（种子规则 rs-unsafe 使用）
                let lang_files = filter_files_by_rule(rule, &files);
                findings.extend(apply_unsafe_rule_on_files(
                    &analysis_id,
                    rule,
                    &lang_files,
                    &*cache,
                ));
            }
            ("friendly", "file") => {
                // 对外友好性：throw 空消息 / 硬编码中文错误消息（种子规则 rule_user_facing_message）
                let lang_files = filter_files_by_rule(rule, &files);
                findings.extend(apply_friendly_rule_on_files(
                    &analysis_id,
                    rule,
                    &lang_files,
                    &*cache,
                ));
            }
            ("graph", "module") | ("graph", "file") => {
                let parsed: serde_json::Value =
                    serde_json::from_str(&rule.rule_body).unwrap_or_default();
                let algorithm = parsed
                    .get("algorithm")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                match algorithm {
                    "circular" => {
                        findings.extend(apply_circular_dependency_rule(
                            &analysis_id,
                            rule,
                            &deps,
                            &files,
                        ));
                    }
                    "in_degree_zero" => {
                        findings.extend(apply_dead_code_rule(&analysis_id, rule, &files, &deps));
                    }
                    _ => {}
                }
            }
            _ => {
                // ai/ast 类型规则暂不实现
            }
        }
    }

    // 写入数据库
    finding_repo.delete_by_analysis(&analysis_id)?;
    finding_repo.save_batch(&findings)?;

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Review,
        100,
        1,
        1,
        "审查完成",
    );

    Ok(findings)
}

/// 同步前端分析器插件声明的规则到规则引擎（§4.2 RuleRegistry ↔ 引擎 深度联动）
///
/// 前端每个语言插件在 RuleRegistry 中声明规则（id/name/severity/category），
/// 判断一条规则是否后端可执行（sync_analyzer_rules 过滤用）。
/// 后端 metric 执行器只支持 line_count/size；complexity/nesting/long-function/params/
/// coupling/magic-number 等由前端 ruleEngine 读取 FileMetric 执行。
/// 抽成纯函数便于单元测试，避免「同步了却永不触发」的死规则。
pub fn rule_is_backend_executable(rule: &ReviewRule) -> bool {
    match rule.rule_type.as_str() {
        "unsafe" | "graph" | "metadata" => true,
        "metric" => {
            let parsed: serde_json::Value =
                serde_json::from_str(&rule.rule_body).unwrap_or_default();
            let metric = parsed.get("metric").and_then(|v| v.as_str()).unwrap_or("");
            matches!(metric, "line_count" | "size")
        }
        _ => false,
    }
}

/// 扫描完成后由前端把当前语言的插件规则下发到后端：
/// - 后端已存在同 id 规则（内置种子，如 rs-unsafe）→ 跳过，保留种子可执行版本；
/// - 后端缺失（用户自定义/新插件）→ 补充写入，不覆盖用户对 enabled 的修改。
///
/// 审计修复（2026-08-12，R44）：只接收后端能真实执行的规则类型——
/// metric 执行器只支持 line_count/size，complexity/nesting/long-function/params/
/// coupling/magic-number 等指标由前端 ruleEngine 读取 FileMetric 真实执行，
/// 同步过来只会造出「已同步=已生效」的死规则（永不触发）。这里直接拒绝，
/// 避免把不可执行规则写进 review_rules 表造成误导。
///
/// 返回本次实际新增的规则数量。
#[tauri::command]
pub fn sync_analyzer_rules(
    rules: Vec<ReviewRule>,
    rule_repo: State<'_, Arc<SqliteReviewRuleRepository>>,
) -> AppResult<usize> {
    let mut synced = 0;
    for rule in rules {
        // 只接受后端执行器认识的规则类型
        if !rule_is_backend_executable(&rule) {
            continue;
        }
        if rule_repo.get(&rule.id)?.is_none() {
            rule_repo.save(&rule)?;
            synced += 1;
        }
    }
    Ok(synced)
}

fn apply_metric_rule_on_files(
    analysis_id: &str,
    rule: &ReviewRule,
    files: &[ProjectFile],
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let metric = parsed.get("metric").and_then(|v| v.as_str()).unwrap_or("");
    let op = parsed.get("op").and_then(|v| v.as_str()).unwrap_or(">");
    let threshold = parsed
        .get("threshold")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let mut out = Vec::new();
    for file in files {
        if file.is_directory {
            continue;
        }
        let value = match metric {
            "line_count" => file.line_count,
            "size" => file.size,
            // 历史同步进来的 AST 类指标（complexity/nesting/params 等）后端无法执行。
            // 同步入口已过滤（sync_analyzer_rules 只收 line_count/size），
            // 这里对存量死规则静默跳过，不产出误导性 finding。
            _ => continue,
        };

        let triggered = match op {
            ">" => value > threshold,
            ">=" => value >= threshold,
            "<" => value < threshold,
            "<=" => value <= threshold,
            "==" => value == threshold,
            "!=" => value != threshold,
            _ => false,
        };

        if triggered {
            out.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(rule.id.clone()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: rule.severity.clone(),
                message: format!(
                    "{} 触发规则「{}」: {} = {} {} {}",
                    file.rel_path, rule.name, metric, value, op, threshold
                ),
                suggestion: Some(format!("建议拆分该 {} 或进行重构", metric)),
                status: "open".to_string(),
                found_at: chrono::Utc::now().timestamp(),
                fixed_at: None,
                metadata: "{}".to_string(),
            });
        }
    }
    out
}

fn apply_metadata_rule_on_files(
    analysis_id: &str,
    rule: &ReviewRule,
    files: &[ProjectFile],
    target_type_override: Option<&str>,
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let field = parsed
        .get("required_field")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let error_if_null = parsed
        .get("error_if_null")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if field.is_empty() {
        return vec![];
    }

    let mut out = Vec::new();
    for file in files {
        let missing = match field {
            "layer_id" => file.layer_id.is_none(),
            "language" => file.language.is_none(),
            _ => false,
        };

        if missing && error_if_null {
            out.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(rule.id.clone()),
                target_id: file.id.clone(),
                target_type: target_type_override.unwrap_or("file").to_string(),
                severity: rule.severity.clone(),
                message: format!("{} 缺少必填字段 {}", file.rel_path, field),
                suggestion: Some(format!("请将 {} 归入对应的架构分层", file.name)),
                status: "open".to_string(),
                found_at: chrono::Utc::now().timestamp(),
                fixed_at: None,
                metadata: "{}".to_string(),
            });
        }
    }
    out
}

// ─── 语言专属规则执行（unsafe / graph） ───

/// Rust unsafe 代码块检测（rule_type = "unsafe"）
///
/// 读取源码内容，逐行扫描 unsafe 用法（unsafe 块 / unsafe fn / unsafe impl /
/// unsafe trait / unsafe extern），命中选择：
/// - keywords: 匹配的关键字列表（默认 ["unsafe"]）
/// - min_hits: 触发阈值（默认 1）
fn apply_unsafe_rule_on_files(
    analysis_id: &str,
    rule: &ReviewRule,
    files: &[ProjectFile],
    cache: &crate::commands::project_scan::ScanContentCache,
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let min_hits = parsed.get("min_hits").and_then(|v| v.as_i64()).unwrap_or(1) as usize;

    let mut out = Vec::new();
    for file in files {
        if file.is_directory {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };

        // 收集 unsafe 命中的行（去注释与字符串的粗过滤：跳过以 // 或 * 开头的注释行）
        let mut hits: Vec<(usize, String)> = Vec::new();
        for (i, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
                continue;
            }
            if is_unsafe_line(trimmed) {
                hits.push((i + 1, trimmed.chars().take(80).collect()));
            }
        }

        if hits.len() < min_hits {
            continue;
        }

        let (first_line, first_snippet) = hits.first().cloned().unwrap_or((0, String::new()));
        let line_nums: Vec<String> = hits.iter().map(|(n, _)| n.to_string()).collect();
        out.push(ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.to_string(),
            rule_id: Some(rule.id.clone()),
            target_id: file.id.clone(),
            target_type: "file".to_string(),
            severity: rule.severity.clone(),
            message: format!(
                "{} 存在 {} 处 unsafe 代码（首处第 {} 行: {}）",
                file.rel_path,
                hits.len(),
                first_line,
                first_snippet
            ),
            suggestion: Some(format!(
                "优先使用安全抽象（Vec/Option/Arc 等），确需 unsafe 时补充 Safety 注释并保持块最小化"
            )),
            status: "open".to_string(),
            found_at: chrono::Utc::now().timestamp(),
            fixed_at: None,
            metadata: format!(
                r#"{{"lines":[{}],"count":{}}}"#,
                line_nums.join(","),
                hits.len()
            ),
        });
    }
    out
}

/// 判断一行是否包含 unsafe 用法（块 / 函数 / impl / trait / extern / 裸指针）
fn is_unsafe_line(trimmed: &str) -> bool {
    trimmed.starts_with("unsafe ")
        || trimmed.starts_with("unsafe{")
        || trimmed.contains("unsafe {")
        || trimmed.contains("unsafe fn ")
        || trimmed.contains("unsafe impl ")
        || trimmed.contains("unsafe trait ")
        || trimmed.contains("unsafe extern ")
        || trimmed.ends_with("unsafe")
        || trimmed.contains("*mut ")
        || trimmed.contains("*const ")
}

/// 对外友好性规则（rule_type = "friendly"，种子规则 rule_user_facing_message）
///
/// 扫描用户可见的抛错/返回消息是否友好：
/// - throw new Error(...) / throw "..."/ assert!(...) 消息为空或仅占位（"" / 空串 / "error" 等）
/// - 错误消息为硬编码中文（无模板占位，且不满足「参数化」约定）—— 提示改用 i18n key / 参数模板
///
/// rule_body 可选 {"min_hits":1}；默认 min_hits = 1。
/// 命中优先级：空消息 > 硬编码中文 > 泛化英文占位（如 "error" / "failed" / "Error" 单词）。
fn apply_friendly_rule_on_files(
    analysis_id: &str,
    rule: &ReviewRule,
    files: &[ProjectFile],
    cache: &crate::commands::project_scan::ScanContentCache,
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let min_hits = parsed.get("min_hits").and_then(|v| v.as_i64()).unwrap_or(1) as usize;

    let mut out = Vec::new();
    for file in files {
        if file.is_directory {
            continue;
        }
        let Some(content) = cache.read(file) else {
            continue;
        };

        let mut hits: Vec<(usize, String, &'static str)> = Vec::new();
        for (i, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.starts_with('*') {
                continue;
            }
            if let Some(kind) = unfriendly_message_kind(trimmed) {
                hits.push((i + 1, trimmed.chars().take(80).collect(), kind));
            }
        }

        if hits.len() < min_hits {
            continue;
        }

        let (first_line, first_snippet, _) =
            hits.first().cloned().unwrap_or((0, String::new(), "empty"));
        let line_nums: Vec<String> = hits.iter().map(|(n, _, _)| n.to_string()).collect();
        // 分类统计
        let empty_cnt = hits.iter().filter(|(_, _, k)| *k == "empty").count();
        let hardcoded_cnt = hits.iter().filter(|(_, _, k)| *k == "hardcoded").count();
        let vague_cnt = hits.iter().filter(|(_, _, k)| *k == "vague").count();
        out.push(ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.to_string(),
            rule_id: Some(rule.id.clone()),
            target_id: file.id.clone(),
            target_type: "file".to_string(),
            severity: rule.severity.clone(),
            message: format!(
                "{} 存在 {} 处不友好的错误消息（空消息 {} / 硬编码 {} / 泛化 {}；首处第 {} 行: {}）",
                file.rel_path,
                hits.len(),
                empty_cnt,
                hardcoded_cnt,
                vague_cnt,
                first_line,
                first_snippet
            ),
            suggestion: Some(
                "使用 i18n key / 参数化模板替代硬编码文案，并保证错误消息非空、能说明「什么操作失败、如何解决」"
                    .to_string(),
            ),
            status: "open".to_string(),
            found_at: chrono::Utc::now().timestamp(),
            fixed_at: None,
            metadata: format!(
                r#"{{"lines":[{}],"count":{},"empty":{},"hardcoded":{},"vague":{}}}"#,
                line_nums.join(","),
                hits.len(),
                empty_cnt,
                hardcoded_cnt,
                vague_cnt
            ),
        });
    }
    out
}

/// 判定一行是否含「不友好」的错误消息，返回分类：
/// - Some("empty")      消息为空或占位（throw new Error() / throw new Error("") / Error("")）
/// - Some("hardcoded")  消息为硬编码中文（含 CJK 且无模板占位符）
/// - Some("vague")      消息为泛化英文占位（error / failed / Error / Fail 等单单词）
fn unfriendly_message_kind(trimmed: &str) -> Option<&'static str> {
    // 提取 throw new Error(...) / throw Error(...) / Error(...) / throw "..." 的消息参数
    let msg = extract_error_message(trimmed)?;
    let msg = msg.trim();
    // 空消息 / 纯空白
    if msg.is_empty() {
        return Some("empty");
    }
    // 泛化占位：单单词且为常见占位
    let lower = msg.to_lowercase();
    if matches!(
        lower.as_str(),
        "error" | "failed" | "fail" | "exception" | "err" | "unknown" | "oops"
    ) {
        return Some("vague");
    }
    // 硬编码中文（CJK），且不含模板占位（${} / {} / {name} / %s 等）→ 提示参数化
    // 注意：只认「真正的参数化」形态（${...} / {...} / %s / %d），
    // 避免把消息正文里恰好出现的普通花括号误判为参数化。
    let has_cjk = msg.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
    let has_placeholder =
        msg.contains("${") || msg.contains("{") || msg.contains("%s") || msg.contains("%d");
    if has_cjk && !has_placeholder {
        return Some("hardcoded");
    }
    None
}

/// 尝试从一行中提取错误消息字符串字面量：
/// - `throw new Error("...")` / `throw Error("...")` / `Error("...")`
/// - `throw "..."` / `panic!("...")` / `assert!(..., "...")`
/// 提取失败返回 None（该行不是错误抛出）。
fn extract_error_message(trimmed: &str) -> Option<String> {
    let patterns: &[&str] = &[
        "new Error(",
        "throw Error(",
        "Error(",
        "panic!(",
        "throw new TypeError(",
        "throw new RangeError(",
        "throw new ReferenceError(",
        "throw new SyntaxError(",
        "assert!(",
    ];
    let pos = patterns.iter().filter_map(|p| trimmed.find(p)).min()?;
    let after = &trimmed[pos..];
    // 找到第一个引号（单/双），取其内容
    let quote_pos = match after.find(|c| c == '"' || c == '\'') {
        Some(p) => p,
        None => {
            // 无引号：Error() 空参视为空消息；变量/表达式（Error(err)）跳过——无法静态判断是否友好
            let open = after.find('(')?;
            let tail = &after[open + 1..];
            let close = tail.find(')')?;
            if tail[..close].trim().is_empty() {
                return Some(String::new());
            }
            return None;
        }
    };
    let quote = after.as_bytes()[quote_pos] as char;
    let rest = &after[quote_pos + 1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

/// graph 循环依赖检测（rule_type = "graph"，algorithm = "circular"）
///
/// 从依赖表中读取已标记 is_circular 的边，汇总去重后生成 finding。
/// 目标名解析：优先用文件/目录 rel_path，取不到时回退为 dep id。
fn apply_circular_dependency_rule(
    analysis_id: &str,
    rule: &ReviewRule,
    deps: &[ProjectDependency],
    files: &[ProjectFile],
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let min_cycle = parsed
        .get("min_cycle_length")
        .and_then(|v| v.as_i64())
        .unwrap_or(2);

    // id → 显示名（文件/目录 rel_path）
    let mut name_map: HashMap<String, String> = HashMap::new();
    for f in files {
        name_map.insert(f.id.clone(), f.rel_path.clone());
    }

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out = Vec::new();
    for dep in deps {
        if !dep.is_circular || dep.to_id.starts_with("external:") {
            continue;
        }
        if dep.from_id == dep.to_id {
            continue; // 自环不计入多节点循环
        }
        if !seen.insert((dep.from_id.clone(), dep.to_id.clone())) {
            continue;
        }
        let from_name = name_map
            .get(&dep.from_id)
            .cloned()
            .unwrap_or(dep.from_id.clone());
        let to_name = name_map
            .get(&dep.to_id)
            .cloned()
            .unwrap_or(dep.to_id.clone());
        out.push(ReviewFinding {
            id: format!(
                "finding_{}",
                uuid::Uuid::new_v4().to_string().replace("-", "")
            ),
            analysis_id: analysis_id.to_string(),
            rule_id: Some(rule.id.clone()),
            target_id: dep.from_id.clone(),
            target_type: "module".to_string(),
            severity: rule.severity.clone(),
            message: format!(
                "检测到循环依赖（环长 ≥ {}）：{} ↔ {}（{}）",
                min_cycle, from_name, to_name, dep.kind
            ),
            suggestion: Some("建议抽取公共模块、引入依赖反转或事件解耦以打破循环".to_string()),
            status: "open".to_string(),
            found_at: chrono::Utc::now().timestamp(),
            fixed_at: None,
            metadata: format!(
                r#"{{"from":"{}","to":"{}","kind":"{}"}}"#,
                from_name.replace('"', "\\\""),
                to_name.replace('"', "\\\""),
                dep.kind
            ),
        });
    }
    out
}

/// graph 死代码检测（rule_type = "graph"，algorithm = "in_degree_zero"）
///
/// 没有任何其他文件依赖它（入度为 0）且行数 >= min_lines 的文件视为潜在死代码。
fn apply_dead_code_rule(
    analysis_id: &str,
    rule: &ReviewRule,
    files: &[ProjectFile],
    deps: &[ProjectDependency],
) -> Vec<ReviewFinding> {
    let parsed: serde_json::Value = serde_json::from_str(&rule.rule_body).unwrap_or_default();
    let min_lines = parsed
        .get("min_lines")
        .and_then(|v| v.as_i64())
        .unwrap_or(10);

    // 收集所有被引用（作为依赖目标）的文件 id
    let mut referenced: HashSet<String> = HashSet::new();
    for dep in deps {
        if !dep.to_id.starts_with("external:") {
            referenced.insert(dep.to_id.clone());
        }
    }

    let mut out = Vec::new();
    for file in files {
        if file.is_directory || file.line_count < min_lines {
            continue;
        }
        if !referenced.contains(&file.id) {
            out.push(ReviewFinding {
                id: format!(
                    "finding_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.to_string(),
                rule_id: Some(rule.id.clone()),
                target_id: file.id.clone(),
                target_type: "file".to_string(),
                severity: rule.severity.clone(),
                message: format!(
                    "{} 未被任何其他文件依赖（{} 行），可能是死代码",
                    file.rel_path, file.line_count
                ),
                suggestion: Some(
                    "确认是否仍被动态引用（反射/脚本入口），否则可考虑删除或归档".to_string(),
                ),
                status: "open".to_string(),
                found_at: chrono::Utc::now().timestamp(),
                fixed_at: None,
                metadata: format!(r#"{{"lines":{}}}"#, file.line_count),
            });
        }
    }
    out
}

// ─── 依赖检测（简化版正则匹配） ───

/// 在扫描完成后调用，从 project_files 读取源码，解析 import/require 写入 project_dependencies
///
/// 支持：
/// - JS/TS: import ... from 'path'; const x = require('path')
/// - Python: import x; from x import y
/// - Rust: use x::y;
#[tauri::command(async)]
pub fn detect_dependencies(
    analysis_id: String,
    app: AppHandle,
    project_root: String,
    file_repo: State<'_, Arc<SqliteProjectFileRepository>>,
    dep_repo: State<'_, Arc<SqliteProjectDependencyRepository>>,
    module_repo: State<'_, Arc<SqliteProjectModuleRepository>>,
    cache: State<'_, crate::commands::project_scan::ScanContentCache>,
) -> AppResult<Vec<ProjectDependency>> {
    let files = file_repo.list_by_analysis(&analysis_id)?;
    let root = std::path::PathBuf::from(&project_root);
    let total = files.iter().filter(|f| !f.is_directory).count() as i64;
    let mut done = 0i64;
    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Deps,
        0,
        0,
        total,
        "分析模块依赖…",
    );

    // 1. 构建 path → id 映射（让依赖能找到目标）
    let mut path_to_id: HashMap<String, String> = HashMap::new();
    for f in &files {
        if !f.is_directory {
            path_to_id.insert(f.rel_path.clone(), f.id.clone());
            // 也存绝对路径作为后备
            path_to_id.insert(f.path.clone(), f.id.clone());
        }
    }

    // 2. 遍历所有文件，解析依赖
    let mut deps: Vec<ProjectDependency> = Vec::new();

    for file in &files {
        done += 1;
        if file.is_directory {
            continue;
        }
        if done % 200 == 0 {
            crate::commands::project_scan::emit_stage_progress(
                &app,
                crate::commands::project_scan::ScanStage::Deps,
                ((done as f64 / total.max(1) as f64) * 100.0) as i64,
                done,
                total,
                "分析模块依赖…",
            );
        }

        let Some(content) = cache.read(file) else {
            continue; // 跳过不可读文件
        };

        // R45（解析器插件化）：依赖解析由 ParserRegistry 驱动（parser::parse_deps），
        // 各语言插件声明 deps 能力并实现；未注册/无能力语言返回空（不再硬编码 match）。
        // 解析器可点名更精确的 kind（如动态 import → "dynamic-import"），
        // 未点名（None）时沿用按语言的默认 kind，保持既有行为。
        let imports = match file.language.as_deref() {
            Some(lang) => crate::parser::parse_deps(lang, &content)
                .into_iter()
                .map(|d| (d.path, d.line, d.kind))
                .collect::<Vec<(String, usize, Option<&'static str>)>>(),
            None => Vec::new(),
        };

        for (import_path, line_no, dep_kind) in imports {
            let lang_kind = match file.language.as_deref() {
                Some("rust") => "use",
                Some("c") | Some("cpp") => "include",
                _ => "import",
            };
            let kind = dep_kind.unwrap_or(lang_kind);
            // 仅处理相对路径导入（./ ../）；以 / 开头的视为相对根目录；其余视为包名，标记 external
            let resolved_rel = if import_path.starts_with("./") || import_path.starts_with("../") {
                if let Some(parent) = std::path::Path::new(&file.rel_path).parent() {
                    let joined = parent.join(&import_path);
                    normalize_path(&joined)
                } else {
                    import_path.clone()
                }
            } else if import_path.starts_with('/') {
                normalize_path(std::path::Path::new(import_path.trim_start_matches('/')))
            } else {
                // 可能是包名（npm/pip/cargo/go module），跳过并记为 external
                deps.push(ProjectDependency {
                    id: format!("dep_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                    analysis_id: analysis_id.to_string(),
                    from_id: file.id.clone(),
                    from_type: "file".to_string(),
                    to_id: format!("external:{}", import_path),
                    to_type: "external".to_string(),
                    kind: kind.to_string(),
                    line_no: Some(line_no as i64),
                    is_circular: false,
                    weight: 1,
                    metadata: format!(
                        r#"{{"raw":"{}","resolved":"external"}}"#,
                        import_path.replace('"', "\\\"")
                    ),
                    detected_at: chrono::Utc::now().timestamp(),
                });
                continue;
            };

            // 候选解析：原始路径 → 加扩展名 → 目录式 index.*
            let to_id = {
                let mut candidates: Vec<String> = Vec::new();
                candidates.push(resolved_rel.clone());
                if !resolved_rel.contains('.') {
                    for ext in [
                        "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp",
                    ] {
                        candidates.push(format!("{}/index.{}", resolved_rel, ext));
                    }
                    candidates.push(guess_extension(
                        &resolved_rel,
                        file.language.as_deref().unwrap_or(""),
                    ));
                }
                candidates
                    .iter()
                    .find_map(|c| path_to_id.get(c))
                    .cloned()
                    .unwrap_or_else(|| format!("external:{}", import_path))
            };

            deps.push(ProjectDependency {
                id: format!("dep_{}", uuid::Uuid::new_v4().to_string().replace("-", "")),
                analysis_id: analysis_id.to_string(),
                from_id: file.id.clone(),
                from_type: "file".to_string(),
                to_id,
                to_type: "file".to_string(),
                kind: kind.to_string(),
                line_no: Some(line_no as i64),
                is_circular: false,
                weight: 1,
                metadata: format!(
                    r#"{{"raw":"{}","resolved":"{}"}}"#,
                    import_path.replace('"', "\\\""),
                    resolved_rel
                ),
                detected_at: chrono::Utc::now().timestamp(),
            });
        }
    }

    // 3. 检测循环依赖（简单 DFS）
    let _ = &root; // 防止 unused 警告
    mark_circular_dependencies(&mut deps);

    // 4. 写入数据库
    dep_repo.delete_by_analysis(&analysis_id)?;
    dep_repo.save_batch(&deps)?;

    // 5. 自动生成语义模块（按顶层目录聚合文件，并统计出入依赖）
    {
        let mut file_to_top: HashMap<String, String> = HashMap::new();
        let mut top_files: HashMap<String, Vec<String>> = HashMap::new();
        for f in &files {
            if f.is_directory {
                continue;
            }
            let top = if f.rel_path.contains('/') {
                f.rel_path
                    .split('/')
                    .next()
                    .unwrap_or(&f.rel_path)
                    .to_string()
            } else {
                "root".to_string()
            };
            file_to_top.insert(f.id.clone(), top.clone());
            top_files.entry(top).or_default().push(f.id.clone());
        }

        let mut dep_count: HashMap<String, i64> = HashMap::new();
        let mut be_dep_count: HashMap<String, i64> = HashMap::new();
        for d in &deps {
            if let Some(top) = file_to_top.get(&d.from_id) {
                *dep_count.entry(top.clone()).or_insert(0) += 1;
            }
            if !d.to_id.starts_with("external:") {
                if let Some(top) = file_to_top.get(&d.to_id) {
                    *be_dep_count.entry(top.clone()).or_insert(0) += 1;
                }
            }
        }

        let module_palette = [
            "#6366F1", "#10B981", "#F59E0B", "#EC4899", "#06B6D4", "#8B5CF6", "#EF4444", "#14B8A6",
        ];
        let mut sorted_top: Vec<(&String, &Vec<String>)> = top_files.iter().collect();
        sorted_top.sort_by(|a, b| a.0.cmp(b.0));

        let now = chrono::Utc::now().timestamp();
        let mut module_list: Vec<ProjectModule> = Vec::new();
        for (idx, (top, fids)) in sorted_top.iter().enumerate() {
            let top_ref: &String = top;
            let name = if *top_ref == "root" {
                "根目录".to_string()
            } else {
                top_ref.clone()
            };
            module_list.push(ProjectModule {
                id: format!(
                    "module_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")
                ),
                analysis_id: analysis_id.clone(),
                name,
                description: Some(format!("包含 {} 个文件", fids.len())),
                layer_id: None,
                file_count: fids.len() as i64,
                dep_count: *dep_count.get(top_ref).unwrap_or(&0),
                be_dep_count: *be_dep_count.get(top_ref).unwrap_or(&0),
                x: 60.0 + (idx as f64 % 4.0) * 240.0,
                y: 60.0 + (idx as f64 / 4.0).floor() * 150.0,
                width: 200.0,
                height: 80.0,
                color: module_palette[idx % module_palette.len()].to_string(),
                metadata: "{}".to_string(),
                created_at: now,
                updated_at: now,
            });
        }
        if !module_list.is_empty() {
            let _ = module_repo.delete_by_analysis(&analysis_id);
            let _ = module_repo.save_batch(&module_list);
        }
    }

    crate::commands::project_scan::emit_stage_progress(
        &app,
        crate::commands::project_scan::ScanStage::Deps,
        100,
        total,
        total,
        "依赖分析完成",
    );
    Ok(deps)
}

pub fn parse_js_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        // import x from 'path' / import x from "path"
        if let Some(caps) = regex_js_import(trimmed) {
            out.push((caps, i + 1));
            continue;
        }
        // require('path') / require("path")
        if let Some(caps) = regex_js_require(trimmed) {
            out.push((caps, i + 1));
        }
    }
    out
}

fn regex_js_import(line: &str) -> Option<String> {
    let line = line
        .trim_start_matches("export ")
        .trim_start_matches("import ");
    let from_idx = line.find("from")?;
    let after = &line[from_idx + 4..];
    let s = after.trim().trim_start_matches(',').trim();
    if let Some(p) = extract_quoted(s) {
        return Some(p);
    }
    None
}

fn regex_js_require(line: &str) -> Option<String> {
    let req_idx = line.find("require(")?;
    let after = &line[req_idx + 8..];
    if let Some(p) = extract_quoted(after) {
        return Some(p);
    }
    None
}

pub fn parse_python_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") {
            // import x / import x.y / import x as y
            let rest = trimmed.trim_start_matches("import ").trim();
            let module = rest.split_whitespace().next().unwrap_or("");
            if !module.is_empty()
                && module
                    .chars()
                    .next()
                    .map(|c| c.is_alphabetic())
                    .unwrap_or(false)
            {
                out.push((module.to_string(), i + 1));
            }
        } else if trimmed.starts_with("from ") {
            // from x import y
            let rest = trimmed.trim_start_matches("from ").trim();
            let module = rest.split_whitespace().next().unwrap_or("");
            if !module.is_empty()
                && module
                    .chars()
                    .next()
                    .map(|c| c.is_alphabetic())
                    .unwrap_or(false)
                && module != "import"
            {
                out.push((module.to_string(), i + 1));
            }
        }
    }
    out
}

pub fn parse_rust_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("use ") {
            // use x::y::z; or use x::{a, b};
            let rest = rest.trim_end_matches(';').trim();
            // 移除 { ... } 部分
            let module = if let Some(brace_idx) = rest.find('{') {
                &rest[..brace_idx]
            } else {
                rest
            };
            let module = module.trim_end_matches("::").trim();
            if !module.is_empty() {
                out.push((module.to_string(), i + 1));
            }
        }
    }
    out
}

pub fn parse_go_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut in_block = false;
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with("import (") {
            in_block = true;
            continue;
        }
        if in_block {
            if trimmed == ")" {
                in_block = false;
                continue;
            }
            if let Some(p) = extract_quoted(trimmed) {
                out.push((p, i + 1));
            }
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("import ") {
            let rest = rest.trim();
            if let Some(p) = extract_quoted(rest) {
                out.push((p, i + 1));
            }
        }
    }
    out
}

pub fn parse_c_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("#include") {
            let rest = rest.trim();
            // 仅处理本地头文件（双引号）；系统头文件（尖括号）跳过
            if rest.starts_with('"') {
                if let Some(p) = extract_quoted(rest) {
                    out.push((p, i + 1));
                }
            }
        }
    }
    out
}

pub fn parse_java_imports(content: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("import ") {
            let rest = rest.trim_end_matches(';').trim();
            if !rest.is_empty() && !rest.starts_with("static ") {
                out.push((rest.to_string(), i + 1));
            }
        }
    }
    out
}

fn extract_quoted(s: &str) -> Option<String> {
    let s = s.trim();
    if s.starts_with('\'') || s.starts_with('"') {
        let quote = s.chars().next()?;
        let rest = &s[1..];
        let end = rest.find(quote)?;
        return Some(rest[..end].to_string());
    }
    None
}

fn normalize_path(path: &std::path::Path) -> String {
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other),
        }
    }
    out.to_string_lossy().replace('\\', "/")
}

fn guess_extension(path: &str, lang: &str) -> String {
    match lang {
        "typescript" => format!("{}.ts", path),
        "javascript" => format!("{}.js", path),
        "python" => format!("{}.py", path),
        "rust" => format!("{}.rs", path),
        _ => path.to_string(),
    }
}

/// 动态导入（`import('./x')`）的依赖 kind。
/// 它是**真实存在的模块边**（要进依赖图、要进符号引用、要参与死代码判定），
/// 但**不参与循环依赖判定**——懒加载恰恰是打破循环的标准手段（代码分割），
/// 把它算进环里会产出「技术上成立、行动上错误」的告警噪声（与 dpdm
/// `--skip-dynamic-imports circular` 同口径）。
pub(crate) const DEP_KIND_DYNAMIC_IMPORT: &str = "dynamic-import";

/// 简单 DFS 标记循环依赖
fn mark_circular_dependencies(deps: &mut Vec<ProjectDependency>) {
    let mut graph: HashMap<String, Vec<String>> = HashMap::new();
    for dep in deps.iter() {
        if dep.kind == DEP_KIND_DYNAMIC_IMPORT {
            continue; // 懒加载边不构成循环（见上方常量注释）
        }
        graph
            .entry(dep.from_id.clone())
            .or_default()
            .push(dep.to_id.clone());
    }

    let mut in_path: HashSet<String> = HashSet::new();
    let mut visited: HashSet<String> = HashSet::new();

    // 对每个 dep 跑 DFS 看 from_id -> to_id -> ... -> from_id
    let mut circular_pairs: HashSet<(String, String)> = HashSet::new();

    for dep in deps.iter() {
        if dep.kind == DEP_KIND_DYNAMIC_IMPORT {
            continue; // 懒加载边不作为环的起点，也不会被标记
        }
        // DFS from to_id，看能否回到 from_id
        let target = dep.to_id.clone();
        let source = dep.from_id.clone();

        if !visited.contains(&target) {
            let mut stack: Vec<(String, Vec<String>)> = vec![(target.clone(), Vec::new())];
            while let Some((node, path)) = stack.pop() {
                if node == source && !path.is_empty() {
                    // 找到循环
                    for from in path.iter() {
                        circular_pairs.insert((from.clone(), node.clone()));
                    }
                    circular_pairs.insert((source.clone(), target.clone()));
                    break;
                }
                if in_path.contains(&node) {
                    continue;
                }
                in_path.insert(node.clone());
                let mut new_path = path.clone();
                new_path.push(node.clone());
                if let Some(children) = graph.get(&node) {
                    for child in children {
                        stack.push((child.clone(), new_path.clone()));
                    }
                }
                in_path.remove(&node);
                visited.insert(node);
            }
        }
    }

    // 标记
    for dep in deps.iter_mut() {
        if dep.kind == DEP_KIND_DYNAMIC_IMPORT {
            continue;
        }
        if circular_pairs.contains(&(dep.from_id.clone(), dep.to_id.clone())) {
            dep.is_circular = true;
        }
    }
}
#[cfg(test)]
mod review_tests {
    use super::{rule_is_backend_executable, unfriendly_message_kind};
    use crate::domain::review_rules::ReviewRule;

    fn rule(rule_type: &str, rule_body: &str) -> ReviewRule {
        ReviewRule {
            id: "test-rule".to_string(),
            name: "test".to_string(),
            description: None,
            rule_type: rule_type.to_string(),
            target_type: "file".to_string(),
            rule_body: rule_body.to_string(),
            severity: "warning".to_string(),
            enabled: true,
            scope: "all".to_string(),
            builtin: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn backend_executable_rule_filter() {
        // 后端能执行的：unsafe / graph / metadata / metric(line_count|size)
        assert!(rule_is_backend_executable(&rule(
            "unsafe",
            r#"{"keywords":["unsafe"],"min_hits":1}"#
        )));
        assert!(rule_is_backend_executable(&rule(
            "graph",
            r#"{"algorithm":"circular"}"#
        )));
        assert!(rule_is_backend_executable(&rule(
            "metadata",
            r#"{"required_field":"layer_id"}"#
        )));
        assert!(rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"line_count","op":">","threshold":800}"#
        )));
        assert!(rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"size","op":">","threshold":100}"#
        )));
        // 后端不支持的 AST 类指标 → 拒绝（避免死规则）
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"cyclomatic_complexity","op":">","threshold":10}"#
        )));
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"max_nesting_depth","op":">","threshold":4}"#
        )));
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"max_function_lines","op":">","threshold":80}"#
        )));
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"max_function_params","op":">","threshold":5}"#
        )));
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"import_count","op":">","threshold":15}"#
        )));
        assert!(!rule_is_backend_executable(&rule(
            "metric",
            r#"{"metric":"magic_number_count","op":">","threshold":3}"#
        )));
        // 未知 rule_type 也拒绝
        assert!(!rule_is_backend_executable(&rule("ai", "{}")));
    }

    #[test]
    fn empty_message_is_unfriendly() {
        assert_eq!(
            unfriendly_message_kind("throw new Error(\"\")"),
            Some("empty")
        );
        assert_eq!(unfriendly_message_kind("throw new Error()"), Some("empty"));
    }

    #[test]
    fn hardcoded_cjk_message_is_unfriendly() {
        assert_eq!(
            unfriendly_message_kind("throw new Error(\"创建失败，请检查输入\")"),
            Some("hardcoded")
        );
        assert_eq!(
            unfriendly_message_kind("panic!(\"初始化失败\")"),
            Some("hardcoded")
        );
    }

    #[test]
    fn parameterized_message_is_friendly() {
        assert_eq!(
            unfriendly_message_kind("throw new Error(`创建失败: ${err.message}`)"),
            None
        );
        assert_eq!(
            unfriendly_message_kind("throw new Error(\"File not found: {path}\")"),
            None
        );
    }

    #[test]
    fn vague_placeholder_is_unfriendly() {
        assert_eq!(
            unfriendly_message_kind("throw new Error(\"error\")"),
            Some("vague")
        );
        assert_eq!(
            unfriendly_message_kind("throw new Error(\"failed\")"),
            Some("vague")
        );
    }

    #[test]
    fn non_throw_line_is_friendly() {
        assert_eq!(unfriendly_message_kind("const a = 1 + 2;"), None);
        assert_eq!(unfriendly_message_kind("return result;"), None);
        // 注释行过滤发生在 apply_friendly_rule_on_files 的行循环里（starts_with("//") 跳过），
        // unfriendly_message_kind 本身不感知注释；这里只验证「非 throw 语句」不命中
        assert_eq!(unfriendly_message_kind("logger.info(\"done\")"), None);
    }
}
