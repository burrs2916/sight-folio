// project-sight: AI 上下文包持久化命令
// 前端模块供给者（scanContextProvider 等）构建好 AiContextPack 后调用 save_ai_context_pack 落库，
// Agent 工具 project_context 读取这些包（按 pack / 按单分节）以省 token。

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::infrastructure::Database;
use crate::infrastructure::database::ai_repository::*;

// ─── 入参 DTO（与前端 AiContextPack 的 camelCase 字段对齐）───

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSectionInputDto {
    pub key: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub token_estimate: u32,
    pub priority: u32,
    #[serde(default)]
    pub facts: Option<serde_json::Value>,
    /// 数据可信度：Agent 区分「没问题」与「没数据」的依据；旧前端不传则视为「可信」
    #[serde(default)]
    pub data_quality: Option<serde_json::Value>,
    /// 分节内容指纹（分节级增量的判定依据；旧前端不传则为空串）
    #[serde(default)]
    pub digest: String,
    /// 内容最后一次真正变化的时刻（ms）
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextPackInputDto {
    pub module_id: String,
    pub scope_id: String,
    pub scope_label: String,
    pub schema_version: u32,
    pub generated_at: i64,
    pub sections: Vec<AiContextSectionInputDto>,
    pub token_estimate: u32,
    pub digest: String,
    #[serde(default)]
    pub truncated_sections: Vec<String>,
    /// 本次内容发生变化的分节键（分节级增量保存时，sections 只需带这些节，
    /// 但 section_keys 仍要给全集，否则包元信息会漏节）
    #[serde(default)]
    pub changed_sections: Vec<String>,
    /// 包内分节键全集。分节增量保存时 sections 是子集，全集必须单独给。
    #[serde(default)]
    pub section_keys: Vec<String>,
}

// ─── 出参 DTO ───

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextSectionDto {
    pub key: String,
    pub title: String,
    pub summary: String,
    pub content: String,
    pub token_estimate: i64,
    pub priority: i64,
    pub facts: Option<serde_json::Value>,
    pub data_quality: Option<serde_json::Value>,
    pub digest: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextPackSummaryDto {
    pub id: String,
    pub scope_id: String,
    pub module_id: String,
    pub scope_label: String,
    pub schema_version: i64,
    pub generated_at: i64,
    pub token_estimate: i64,
    pub digest: String,
    pub truncated_sections: Vec<String>,
    pub section_keys: Vec<String>,
    pub section_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextPackDetailDto {
    pub id: String,
    pub scope_id: String,
    pub module_id: String,
    pub scope_label: String,
    pub schema_version: i64,
    pub generated_at: i64,
    pub token_estimate: i64,
    pub digest: String,
    pub truncated_sections: Vec<String>,
    pub sections: Vec<AiContextSectionDto>,
}

fn to_section_dto(s: AiContextSectionRow) -> AiContextSectionDto {
    AiContextSectionDto {
        key: s.section_key,
        title: s.title,
        summary: s.summary,
        content: s.content,
        token_estimate: s.token_estimate,
        priority: s.priority,
        facts: serde_json::from_str(&s.facts_json).ok(),
        data_quality: serde_json::from_str(&s.data_quality_json).ok(),
        digest: s.digest,
        updated_at: s.updated_at,
    }
}

fn to_section_input(s: AiContextSectionInputDto) -> AiContextSectionInput {
    AiContextSectionInput {
        section_key: s.key,
        title: s.title,
        summary: s.summary,
        content: s.content,
        token_estimate: s.token_estimate as i64,
        priority: s.priority as i64,
        facts_json: s
            .facts
            .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()))
            .unwrap_or_else(|| "{}".to_string()),
        data_quality_json: s
            .data_quality
            .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()))
            .unwrap_or_else(|| "{}".to_string()),
        digest: s.digest,
        updated_at: s.updated_at,
    }
}

/// 保存一个上下文包（pack_id 由 scope+module 推导，重存即覆盖）。
/// 返回 pack_id，供调用方缓存或传递给 Agent。
#[tauri::command]
pub fn save_ai_context_pack(
    db: State<'_, Arc<Database>>,
    pack: AiContextPackInputDto,
) -> Result<String, String> {
    let id = format!("{}:{}", pack.scope_id, pack.module_id);
    let section_keys: Vec<String> = pack.sections.iter().map(|s| s.key.clone()).collect();

    let row = AiContextPackRow {
        id: id.clone(),
        scope_id: pack.scope_id,
        module_id: pack.module_id,
        scope_label: pack.scope_label,
        schema_version: pack.schema_version as i64,
        generated_at: pack.generated_at,
        token_estimate: pack.token_estimate as i64,
        digest: pack.digest,
        truncated_sections: pack.truncated_sections,
        section_keys,
    };

    let inputs: Vec<AiContextSectionInput> = pack.sections.into_iter().map(to_section_input).collect();

    AiContextPackRepo::save_pack(&db, &row, &inputs)?;
    Ok(id)
}

/// 分节级增量保存：只重写 sections 里给出的分节，其余分节原封不动。
///
/// 用在增量重扫场景——一次文件改动通常只撼动一两个分节，整包重写既浪费 IO，
/// 又会把所有分节的 updated_at 一起刷新，导致 Agent 再也分不清哪节真的变了。
///
/// 注意 `section_keys` 必须给**全集**（包元信息要完整），`sections` 才是变化子集。
#[tauri::command]
pub fn save_ai_context_sections(
    db: State<'_, Arc<Database>>,
    pack: AiContextPackInputDto,
) -> Result<usize, String> {
    let id = format!("{}:{}", pack.scope_id, pack.module_id);

    // section_keys 缺省时退化为「本次传来的分节」，避免旧调用方把包元信息写空；
    // 但这种情况下调用方应该走 save_ai_context_pack 而不是增量接口。
    let section_keys = if pack.section_keys.is_empty() {
        pack.sections.iter().map(|s| s.key.clone()).collect()
    } else {
        pack.section_keys.clone()
    };

    let row = AiContextPackRow {
        id: id.clone(),
        scope_id: pack.scope_id,
        module_id: pack.module_id,
        scope_label: pack.scope_label,
        schema_version: pack.schema_version as i64,
        generated_at: pack.generated_at,
        token_estimate: pack.token_estimate as i64,
        digest: pack.digest,
        truncated_sections: pack.truncated_sections,
        section_keys,
    };

    let inputs: Vec<AiContextSectionInput> = pack.sections.into_iter().map(to_section_input).collect();
    AiContextPackRepo::save_sections_partial(&db, &row, &inputs)
}

/// 取分节戳（指纹 + 更新时间，无正文）。
/// 前端据此水合「上次写了什么」，使应用重启后仍能继续增量，而不是退回整包重写。
#[tauri::command]
pub fn list_ai_context_section_stamps(
    db: State<'_, Arc<Database>>,
    pack_id: String,
) -> Result<Vec<AiContextSectionStamp>, String> {
    AiContextSectionRepo::list_stamps(&db, &pack_id)
}

/// 列出上下文包（按 analysis/scope 过滤或不传返回全部）。
#[tauri::command]
pub fn list_ai_context_packs(
    db: State<'_, Arc<Database>>,
    scope_id: Option<String>,
) -> Result<Vec<AiContextPackSummaryDto>, String> {
    let packs = AiContextPackRepo::list_packs(&db, scope_id.as_deref())?;
    let mut out = Vec::with_capacity(packs.len());
    for p in packs {
        let count = AiContextSectionRepo::list_by_pack(&db, &p.id)?.len();
        out.push(AiContextPackSummaryDto {
            id: p.id,
            scope_id: p.scope_id,
            module_id: p.module_id,
            scope_label: p.scope_label,
            schema_version: p.schema_version,
            generated_at: p.generated_at,
            token_estimate: p.token_estimate,
            digest: p.digest,
            truncated_sections: p.truncated_sections,
            section_keys: p.section_keys,
            section_count: count,
        });
    }
    Ok(out)
}

/// 取完整包（含全部分节正文）。
#[tauri::command]
pub fn get_ai_context_pack(
    db: State<'_, Arc<Database>>,
    pack_id: String,
) -> Result<Option<AiContextPackDetailDto>, String> {
    let pack = match AiContextPackRepo::get_pack(&db, &pack_id)? {
        Some(p) => p,
        None => return Ok(None),
    };
    let secs = AiContextSectionRepo::list_by_pack(&db, &pack_id)?;
    let sections = secs.into_iter().map(to_section_dto).collect();
    Ok(Some(AiContextPackDetailDto {
        id: pack.id,
        scope_id: pack.scope_id,
        module_id: pack.module_id,
        scope_label: pack.scope_label,
        schema_version: pack.schema_version,
        generated_at: pack.generated_at,
        token_estimate: pack.token_estimate,
        digest: pack.digest,
        truncated_sections: pack.truncated_sections,
        sections,
    }))
}

/// 取单个分节（Agent 按需取用的核心：只看要用的那节，不把全包塞进上下文）。
#[tauri::command]
pub fn get_ai_context_section(
    db: State<'_, Arc<Database>>,
    pack_id: String,
    section_key: String,
) -> Result<Option<AiContextSectionDto>, String> {
    match AiContextSectionRepo::get_section(&db, &pack_id, &section_key)? {
        Some(s) => Ok(Some(to_section_dto(s))),
        None => Ok(None),
    }
}

/// 删除一个上下文包（连带分节，FK ON DELETE CASCADE）。
#[tauri::command]
pub fn delete_ai_context_pack(db: State<'_, Arc<Database>>, pack_id: String) -> Result<(), String> {
    AiContextPackRepo::delete_pack(&db, &pack_id)
}

// ─── AI 洞察持久化 ───

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInsightInputDto {
    pub id: String,
    pub pack_id: Option<String>,
    pub analysis_id: String,
    pub agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub severity: String,
    #[serde(default)]
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInsightDto {
    pub id: String,
    pub pack_id: Option<String>,
    pub analysis_id: String,
    pub agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub severity: String,
    pub refs: Vec<String>,
    /// 同一结论被不同分析轮次确认的次数（去重累加）
    pub seen_count: i64,
    /// 首次记录 / 最近确认时间戳（秒）
    pub first_seen: i64,
    pub last_seen: i64,
    /// 结论时效：current / stale / orphaned / unanchored / unknown。
    /// 拿本次扫描的文件哈希回头比对结论产出当时的证据快照得出——
    /// 没有它，沉淀只会单调增长，改完的问题继续挂在面板上误导人。
    pub freshness: String,
    /// 证据内容已变的路径（这条结论需要复核）
    pub changed_refs: Vec<String>,
    /// 证据文件已不存在的路径
    pub missing_refs: Vec<String>,
    /// 生命周期状态：open / resolved。已收口的结论不该继续占用注意力，
    /// 但也不能删——留着它，用户才看得见「这个问题是什么时候、因为什么被关掉的」。
    pub status: String,
    pub resolved_at: i64,
    pub resolved_reason: Option<String>,
    pub resolved_by: Option<String>,
}

/// Agent 基于上下文包产出的洞察落库（沉淀到分析，供 UI 展示）。
///
/// 与工具侧 `context_insight action=save` 共用同一道引用核验：守门只设在一条入口上，
/// 另一条就是绕过它的后门——哪条路进来的幻觉路径，最后都一样会挂在画布和报告上。
#[tauri::command]
pub fn save_ai_insight(db: State<'_, Arc<Database>>, insight: AiInsightInputDto) -> Result<(), String> {
    let verdict = AiInsightRepo::verify_refs_for(&db, &insight.analysis_id, &insight.refs)?;
    if verdict.all_rejected() {
        return Err(format!(
            "结论未保存：refs 里的位置在本次扫描结果中都不存在（{}）。请改用扫描到的真实路径，或不带 refs 保存为全局结论。",
            verdict
                .rejected()
                .iter()
                .map(|c| c.raw.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let row = AiInsightRow {
        id: insight.id,
        pack_id: insight.pack_id,
        analysis_id: insight.analysis_id,
        agent_id: insight.agent_id,
        kind: insight.kind,
        title: insight.title,
        body: insight.body,
        severity: insight.severity,
        refs: verdict.accepted_refs(),
        fingerprint: None,
        seen_count: 0,
        first_seen: 0,
        last_seen: 0,
        ..Default::default()
    };
    AiInsightRepo::save(&db, &row)
}

/// G4 回扫验证闭环：AI 写回代码触发增量重扫后，自动复核本次诊断产出的洞察是否已解决。
///
/// 调用方（前端 handleFileChanges）在重扫完成后带上本次变更路径调用；后端只对带
/// diagnosis_id 且 refs 命中变更路径的洞察做判定，已 resolved 的不动，避免重扫反复横跳。
/// 返回被自动收口的洞察数。
#[tauri::command]
pub fn verify_diagnosis_insights(
    db: State<'_, Arc<Database>>,
    analysis_id: String,
    paths: Vec<String>,
) -> Result<usize, String> {
    AiInsightRepo::verify_diagnosis_insights(&db, &analysis_id, &paths)
}

/// 列出某分析下的全部洞察（按创建时间倒序）。
#[tauri::command]
pub fn list_ai_insights(db: State<'_, Arc<Database>>, analysis_id: String) -> Result<Vec<AiInsightDto>, String> {
    let rows = AiInsightRepo::list_by_analysis(&db, &analysis_id)?;
    Ok(rows
        .into_iter()
        .map(|r| AiInsightDto {
            id: r.id,
            pack_id: r.pack_id,
            analysis_id: r.analysis_id,
            agent_id: r.agent_id,
            kind: r.kind,
            title: r.title,
            body: r.body,
            severity: r.severity,
            refs: r.refs,
            seen_count: r.seen_count,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            freshness: r.freshness,
            changed_refs: r.changed_refs,
            missing_refs: r.missing_refs,
            status: r.status,
            resolved_at: r.resolved_at,
            resolved_reason: r.resolved_reason,
            resolved_by: r.resolved_by,
        })
        .collect())
}

/// 人工收口一条结论：复核后确认它已经不成立。
///
/// 面板上必须有这个动作——否则「已解决」只能由 Agent 表达，而人恰恰是最有资格
/// 说「这个我刚改完」的那一个。理由由仓库层强制，空理由直接报错。
#[tauri::command]
pub fn resolve_ai_insight(
    db: State<'_, Arc<Database>>,
    analysis_id: String,
    insight_id: String,
    reason: String,
    resolved_by: Option<String>,
) -> Result<String, String> {
    AiInsightRepo::resolve(
        &db,
        &analysis_id,
        &insight_id,
        &reason,
        resolved_by.as_deref().unwrap_or("user"),
    )
}

// ─── 自动分析编排：让「上下文更新 → Agent 分析」不依赖人点按钮 ───
//
// 命令层刻意保持薄：判定逻辑（触发时机 / 冷却 / 指纹去重）放在前端纯函数里，
// 因为发起分析必须走前端的 agentStore（会话、流式、工具注册都在那条链上）。
// 后端只负责三件事：规则的持久化、运行轨迹的审计、以及「上次跑到哪」的状态推进。

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAutoAnalysisRuleInputDto {
    pub id: String,
    pub enabled: bool,
    pub module_id: String,
    #[serde(default)]
    pub scope_id: Option<String>,
    pub agent_id: String,
    pub preset_key: String,
    pub trigger_on: String,
    pub cooldown_minutes: i64,
    pub skip_if_unchanged: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAutoAnalysisRunInputDto {
    pub id: String,
    pub rule_id: String,
    pub module_id: String,
    pub scope_id: String,
    pub agent_id: String,
    pub preset_key: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub trigger_kind: String,
    pub status: String,
    #[serde(default)]
    pub detail: String,
    /// 本次分析基于的上下文内容指纹（只有 triggered 才有意义）。
    /// 覆盖台账靠它区分「久没分析」与「数据变了结论已过期」。
    #[serde(default)]
    pub context_digest: String,
    /// 机器可读的判定原因（补跑靠它，不靠 detail 文案）
    #[serde(default)]
    pub reason: String,
    /// 发起时应为 "pending"，由回执改写为 completed / no-output / error
    #[serde(default)]
    pub outcome: String,
}

/// 列出自动分析规则；传 moduleId 只取该模块的。
#[tauri::command]
pub fn list_ai_auto_analysis_rules(
    db: State<'_, Arc<Database>>,
    module_id: Option<String>,
) -> Result<Vec<AiAutoAnalysisRuleRow>, String> {
    AiAutoAnalysisRuleRepo::list(&db, module_id.as_deref())
}

/// 新建/更新一条规则。运行状态字段（last_run_at / last_digest）不在此写入，
/// 否则用户每保存一次配置就会把冷却窗口重置，去重也会失效。
#[tauri::command]
pub fn save_ai_auto_analysis_rule(
    db: State<'_, Arc<Database>>,
    rule: AiAutoAnalysisRuleInputDto,
) -> Result<(), String> {
    if rule.agent_id.trim().is_empty() {
        // Agent 永远由用户选择，后端不猜默认值：宁可报错也不静默绑一个 Agent
        return Err("agentId 不能为空：请先在界面选择一个已配置的 Agent".to_string());
    }
    let row = AiAutoAnalysisRuleRow {
        id: rule.id,
        enabled: rule.enabled,
        module_id: rule.module_id,
        scope_id: rule.scope_id.filter(|s| !s.trim().is_empty()),
        agent_id: rule.agent_id,
        preset_key: rule.preset_key,
        trigger_on: rule.trigger_on,
        cooldown_minutes: rule.cooldown_minutes.max(0),
        skip_if_unchanged: rule.skip_if_unchanged,
        // 下面三项由 mark_run 维护，save 时占位即可
        last_run_at: 0,
        last_digest: String::new(),
        last_conversation_id: None,
    };
    AiAutoAnalysisRuleRepo::save(&db, &row)
}

/// 删除规则（连带其运行轨迹）。
#[tauri::command]
pub fn delete_ai_auto_analysis_rule(db: State<'_, Arc<Database>>, rule_id: String) -> Result<(), String> {
    AiAutoAnalysisRuleRepo::delete(&db, &rule_id)
}

/// 记录一次真实触发：推进冷却起点与去重指纹。
#[tauri::command]
pub fn mark_ai_auto_analysis_run(
    db: State<'_, Arc<Database>>,
    rule_id: String,
    digest: String,
    conversation_id: Option<String>,
) -> Result<(), String> {
    AiAutoAnalysisRuleRepo::mark_run(&db, &rule_id, &digest, conversation_id.as_deref())
}

/// 写一条运行轨迹（触发 / 跳过 / 失败都记，跳过必须带原因）。
#[tauri::command]
pub fn record_ai_auto_analysis_run(
    db: State<'_, Arc<Database>>,
    run: AiAutoAnalysisRunInputDto,
) -> Result<(), String> {
    let row = AiAutoAnalysisRunRow {
        id: run.id,
        rule_id: run.rule_id,
        module_id: run.module_id,
        scope_id: run.scope_id,
        agent_id: run.agent_id,
        preset_key: run.preset_key,
        pack_id: run.pack_id,
        conversation_id: run.conversation_id,
        trigger_kind: run.trigger_kind,
        status: run.status,
        detail: run.detail,
        context_digest: run.context_digest,
        reason: run.reason,
        outcome: run.outcome,
        insight_count: 0,
        finished_at: 0,
        created_at: 0,
    };
    AiAutoAnalysisRunRepo::record(&db, &row)
}

/// 回执：一轮分析真正结束后回填结局与产出条数。
///
/// 发起与结束必须分成两次写：发起时 Agent 还没开口，等它答完再写会把扫描收尾
/// 阻塞几十秒。但只写发起不写结束，「已发起」就会被当成「已分析」，
/// 模型报错那一轮照样在台账上点绿灯——自动化最怕的不是没跑，是假装跑过。
#[tauri::command]
pub fn finish_ai_auto_analysis_run(
    db: State<'_, Arc<Database>>,
    run_id: String,
    outcome: String,
    insight_count: Option<i64>,
    detail: Option<String>,
) -> Result<(), String> {
    AiAutoAnalysisRunRepo::finish(
        &db,
        &run_id,
        &outcome,
        insight_count.unwrap_or(0),
        detail.as_deref().unwrap_or(""),
    )
}

/// 每条规则在该作用域下的最近一条轨迹 —— 补跑调度的判据。
#[tauri::command]
pub fn list_ai_auto_analysis_latest_per_rule(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
    AiAutoAnalysisRunRepo::latest_per_rule(&db, &module_id, &scope_id)
}

/// 最近的运行轨迹（UI 用它证明自动化在正常工作，或解释为什么没跑）。
#[tauri::command]
pub fn list_ai_auto_analysis_runs(
    db: State<'_, Arc<Database>>,
    limit: Option<i64>,
) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
    AiAutoAnalysisRunRepo::list_recent(&db, limit.unwrap_or(30))
}

/// 每个分析维度最近一次真正发起的记录 —— 覆盖台账的原料。
///
/// 单独开一个命令而不是让前端从 list_recent 里筛：轨迹表会随时间无限增长，
/// 只取最近 30 条时，一个很久没跑过的维度会直接从列表里消失，
/// 台账就会把「三个月前分析过一次」错报成「从未分析」。分组取最新必须在 SQL 里做。
#[tauri::command]
pub fn list_ai_analysis_coverage(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
) -> Result<Vec<AiAutoAnalysisRunRow>, String> {
    AiAutoAnalysisRunRepo::latest_per_preset(&db, &module_id, &scope_id)
}

/// 清算中断轮次：把长期停在 pending 的轨迹落定为 interrupted，同时退回它那一轮的派单。
///
/// 回执写在 sendMessage 的回调里 —— 进程还活着才写得成。桌面应用被随手关掉时，
/// 那一轮既没 completed 也没 error，永远停在 pending：覆盖台账看 status='triggered'
/// 点绿灯，派单台账看 outcome=''（待回执）当已落实，两张表一起说谎，
/// 而这一轮实际上一条结论都没产出。「对话失败退回队列」只覆盖得到进程还在的那半边。
///
/// 由调度心跳在每一拍开头调用：一次带索引的 SELECT，绝大多数时候返回空。
#[tauri::command]
pub fn reap_stale_analysis_runs(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
    older_than_sec: i64,
) -> Result<usize, String> {
    AiAutoAnalysisRunRepo::reap_stale_pending(&db, &module_id, &scope_id, older_than_sec, 0)
}

// ─── 焦点目标巡查派单 ───

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFocusAssignmentInputDto {
    pub file_path: String,
    #[serde(default)]
    pub resonance: i64,
    #[serde(default)]
    pub note: String,
    /// 派单时该文件的证据现状指纹（仅复核派单需要，其余情况留空）。
    /// 由前端从洞察列表算出——它已经为了排序把这批数据读进内存，后端再查一遍是白花的 IO。
    #[serde(default)]
    pub evidence_digest: String,
    /// 派单时该文件「本轮变坏了什么」的指纹（仅回归追责派单需要，其余情况留空）。
    /// 与 evidence_digest 分开传：一个文件可以同时欠复核和欠追责，合并会互相冲销。
    #[serde(default)]
    pub regression_digest: String,
}

/// 登记一轮派单：本轮点名交给 Agent 巡查的文件。
///
/// 为什么点名要落库：轮转此前只换「问什么」，从不换「看哪个文件」，
/// 于是共振榜上不显眼的多维共振文件可以永远无人问津。要让编排也能「补文件」，
/// 就必须有一张账回答「这个文件派过单没有」——而这件事**不能**用有没有洞察来反推：
/// Agent 看完判定没问题时不会写洞察，那样它会被永久反复点名，形成不收敛的烧钱循环。
#[tauri::command]
pub fn record_ai_focus_assignments(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
    run_id: Option<String>,
    preset_key: Option<String>,
    context_digest: Option<String>,
    targets: Vec<AiFocusAssignmentInputDto>,
) -> Result<usize, String> {
    let run_id = run_id.unwrap_or_default();
    let preset_key = preset_key.unwrap_or_default();
    let context_digest = context_digest.unwrap_or_default();
    let rows: Vec<AiFocusAssignmentRow> = targets
        .into_iter()
        .map(|t| AiFocusAssignmentRow {
            module_id: module_id.clone(),
            scope_id: scope_id.clone(),
            file_path: t.file_path,
            run_id: run_id.clone(),
            preset_key: preset_key.clone(),
            context_digest: context_digest.clone(),
            resonance: t.resonance,
            note: t.note,
            assign_count: 1,
            // 0 = 由 SQL 取当前时间；显式传时间只在测试里有意义
            assigned_at: 0,
            // 刚发出去，尚未核销；回执到达时由 settle_ai_focus_assignments 落定
            outcome: String::new(),
            evidence_digest: t.evidence_digest,
            regression_digest: t.regression_digest,
        })
        .collect();
    AiFocusAssignmentRepo::record_many(&db, &rows)
}

/// 核销一轮派单：这一轮点名到底落实了没有。
///
/// 「派单即销账」堵住了「判定没问题不写洞察 → 永远重复点名」的不收敛循环，
/// 却顺手开了反向的洞：**发起了、对话却失败**的那一轮同样销了账。
/// 补跑调度会把规则重新排队，但焦点台账读库时这些文件已是「已巡查」，
/// 于是不会再被点名 —— 一次网络抖动就足以让共振榜第一名永久沉默。
///
/// 只有 outcome=error 会让派单作废重排。no-output **不作废**：
/// 用户的 Agent 若没被授权洞察工具，本来就不会有结论沉淀，
/// 按未落实处理只会换一个不收敛的循环。
#[tauri::command]
pub fn settle_ai_focus_assignments(
    db: State<'_, Arc<Database>>,
    run_id: String,
    outcome: String,
) -> Result<usize, String> {
    AiFocusAssignmentRepo::settle_by_run(&db, &run_id, &outcome)
}

/// 某作用域下的全部派单记录 —— 巡查台账的原料。
#[tauri::command]
pub fn list_ai_focus_assignments(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
) -> Result<Vec<AiFocusAssignmentRow>, String> {
    AiFocusAssignmentRepo::list_by_scope(&db, &module_id, &scope_id)
}

// ─── 指标快照：项目形态随时间的历史基线 ───

/// 记录一次指标快照。
///
/// 指标由**模块自己**算好后传进来，后端只负责存 —— 这不是偷懒，而是唯一正确的分工：
/// 指标的口径（复杂度怎么取、哪些维度这次不可用）必须与上下文包同源，
/// 在后端照着数据库再算一遍，两套口径迟早漂移，而漂移的表现是
/// 「界面上的趋势」和「Agent 读到的趋势」讲两个故事，且没人能发现哪个是对的。
///
/// 返回 (行 id, 是否新增)。未新增表示这组指标与上一个点完全一致，
/// 只是把那个点的「持续到现在」往后延了 —— 对调用方而言同样是成功。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn record_ai_metric_snapshot(
    db: State<'_, Arc<Database>>,
    id: Option<String>,
    module_id: String,
    scope_id: String,
    digest: String,
    trigger_kind: Option<String>,
    metrics_json: String,
    coverage_json: Option<String>,
    taken_at: Option<i64>,
) -> Result<(String, bool), String> {
    let digest = digest.trim().to_string();
    if digest.is_empty() {
        return Err("digest 不能为空：没有指纹就无法判断指标是否变化，时间轴会被重复点淹没".into());
    }
    let row = AiMetricSnapshotRow {
        id: id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
            format!(
                "msnap_{}_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0),
                &digest[..digest.len().min(8)]
            )
        }),
        module_id,
        scope_id,
        digest,
        trigger_kind: trigger_kind.unwrap_or_default(),
        metrics_json,
        coverage_json: coverage_json.unwrap_or_else(|| "[]".into()),
        first_at: 0,
        last_at: 0,
        seen_count: 1,
    };
    AiMetricSnapshotRepo::record(&db, &row, taken_at.unwrap_or(0))
}

/// 指标时间轴（由新到旧）。趋势对比通常只要头几个点，默认给 30。
#[tauri::command]
pub fn list_ai_metric_snapshots(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
    limit: Option<usize>,
) -> Result<Vec<AiMetricSnapshotRow>, String> {
    AiMetricSnapshotRepo::list(&db, &module_id, &scope_id, limit.unwrap_or(30))
}

// ─── 实体快照：哪个文件在变坏 ───

/// 记录一张实体榜单。分工与指标快照完全一致：模块算，后端只存。
///
/// total / cutoff 必须一并传：它们不是统计装饰，而是判定「跌出榜单」到底
/// 意味着修好了还是被挤下去了的唯一依据。缺了它们，回归引擎只能一律判不可比，
/// 这张表也就白建了。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn record_ai_entity_snapshot(
    db: State<'_, Arc<Database>>,
    id: Option<String>,
    module_id: String,
    scope_id: String,
    digest: String,
    trigger_kind: Option<String>,
    entity_label: Option<String>,
    entities_json: String,
    coverage_json: Option<String>,
    dimensions_json: Option<String>,
    survived_json: Option<String>,
    total: Option<i64>,
    cutoff: Option<f64>,
    taken_at: Option<i64>,
) -> Result<(String, bool), String> {
    let digest = digest.trim().to_string();
    if digest.is_empty() {
        return Err("digest 不能为空：没有指纹就无法判断榜单是否变化，回归序列会被重复点淹没".into());
    }
    let row = AiEntitySnapshotRow {
        id: id.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
            format!(
                "esnap_{}_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0),
                &digest[..digest.len().min(8)]
            )
        }),
        module_id,
        scope_id,
        digest,
        trigger_kind: trigger_kind.unwrap_or_default(),
        entity_label: entity_label.unwrap_or_default(),
        entities_json,
        coverage_json: coverage_json.unwrap_or_else(|| "[]".into()),
        dimensions_json: dimensions_json.unwrap_or_else(|| "[]".into()),
        survived_json: survived_json.unwrap_or_else(|| "[]".into()),
        total: total.unwrap_or(0),
        cutoff: cutoff.unwrap_or(0.0),
        first_at: 0,
        last_at: 0,
        seen_count: 1,
    };
    AiEntitySnapshotRepo::record(&db, &row, taken_at.unwrap_or(0))
}

/// 实体榜单序列（由新到旧）。回归只对照上一个点，默认给 4 个足够兜底。
#[tauri::command]
pub fn list_ai_entity_snapshots(
    db: State<'_, Arc<Database>>,
    module_id: String,
    scope_id: String,
    limit: Option<usize>,
) -> Result<Vec<AiEntitySnapshotRow>, String> {
    AiEntitySnapshotRepo::list(&db, &module_id, &scope_id, limit.unwrap_or(4))
}
