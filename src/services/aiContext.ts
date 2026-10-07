import { invoke } from './core';
import type { AiContextPack } from '../ai/contextTypes';

// ─── AI 上下文包持久化 ───
// 前端模块供给者（scanContextProvider）构建好 AiContextPack 后落库，供 Rust Agent 工具 project_context 按需读取。
export const aiContextApi = {
  /** 保存一个上下文包（pack_id 由 scope+module 推导，重存即覆盖）。返回 pack_id。 */
  async saveAiContextPack(pack: AiContextPack): Promise<string> {
    return invoke<string>('save_ai_context_pack', { pack });
  },
  /**
   * 分节级增量保存：只重写 changedKeys 指定的分节，其余分节在库里原封不动。
   * sections 传变化子集，sectionKeys 必须传**全集**（否则包元信息会漏节）。
   * 返回实际写入的分节数。
   */
  async saveAiContextSections(pack: AiContextPack, changedKeys: string[]): Promise<number> {
    const changed = new Set(changedKeys);
    const payload = {
      ...pack,
      sections: pack.sections.filter((s) => changed.has(s.key)),
      sectionKeys: pack.sections.map((s) => s.key),
      changedSections: changedKeys,
    };
    return invoke<number>('save_ai_context_sections', { pack: payload });
  },
  /** 取分节戳（无正文）：用于水合增量状态，重启应用后仍能接着增量而不是整包重写 */
  async listAiContextSectionStamps(packId: string): Promise<AiContextSectionStamp[]> {
    return invoke<AiContextSectionStamp[]>('list_ai_context_section_stamps', { packId });
  },
  async listAiContextPacks(scopeId?: string): Promise<AiContextPackSummary[]> {
    return invoke<AiContextPackSummary[]>('list_ai_context_packs', { scopeId: scopeId ?? null });
  },
  async getAiContextPack(packId: string): Promise<AiContextPackDetail | null> {
    return invoke<AiContextPackDetail | null>('get_ai_context_pack', { packId });
  },
  async getAiContextSection(packId: string, sectionKey: string): Promise<AiContextSectionDto | null> {
    return invoke<AiContextSectionDto | null>('get_ai_context_section', { packId, sectionKey });
  },
  async deleteAiContextPack(packId: string): Promise<void> {
    return invoke('delete_ai_context_pack', { packId });
  },
  async saveAiInsight(insight: AiInsightInput): Promise<void> {
    return invoke('save_ai_insight', { insight });
  },
  async listAiInsights(analysisId: string): Promise<AiInsightDto[]> {
    return invoke<AiInsightDto[]>('list_ai_insights', { analysisId });
  },
  /**
   * 人工收口一条结论。理由必填（后端强校验）——面板上一键关掉但说不出为什么，
   * 等于把问题扫到地毯下面，下一轮 Agent 还会原样再报一遍。
   */
  async resolveAiInsight(analysisId: string, insightId: string, reason: string, resolvedBy = 'user'): Promise<string> {
    return invoke<string>('resolve_ai_insight', {
      analysisId,
      insightId,
      reason,
      resolvedBy,
    });
  },
  /**
   * G4 回扫验证闭环：AI 写回代码增量重扫后，后端自动复核本次诊断产出的洞察是否已解决。
   * 返回被自动收口的洞察数。
   */
  async verifyDiagnosisInsights(analysisId: string, paths: string[]): Promise<number> {
    return invoke<number>('verify_diagnosis_insights', { analysisId, paths });
  },

  // ─── 自动分析编排 ───
  /** 列出规则（传 moduleId 只取该模块的，避免无关规则参与判定） */
  async listAutoAnalysisRules(moduleId?: string): Promise<AiAutoAnalysisRule[]> {
    return invoke<AiAutoAnalysisRule[]>('list_ai_auto_analysis_rules', {
      moduleId: moduleId ?? null,
    });
  },
  async saveAutoAnalysisRule(rule: AiAutoAnalysisRuleInput): Promise<void> {
    return invoke('save_ai_auto_analysis_rule', { rule });
  },
  async deleteAutoAnalysisRule(ruleId: string): Promise<void> {
    return invoke('delete_ai_auto_analysis_rule', { ruleId });
  },
  /** 记录一次真实触发：推进冷却起点与去重指纹 */
  async markAutoAnalysisRun(ruleId: string, digest: string, conversationId?: string | null): Promise<void> {
    return invoke('mark_ai_auto_analysis_run', {
      ruleId,
      digest,
      conversationId: conversationId ?? null,
    });
  },
  /** 写运行轨迹（触发/跳过/失败都写，跳过必须带原因） */
  async recordAutoAnalysisRun(run: AiAutoAnalysisRunInput): Promise<void> {
    return invoke('record_ai_auto_analysis_run', { run });
  },
  async listAutoAnalysisRuns(limit = 30): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_auto_analysis_runs', { limit });
  },
  /**
   * 每个分析维度最近一次真正跑过的记录（覆盖台账原料）。
   * 分组取最新必须在 SQL 里做——从 listAutoAnalysisRuns 的最近 N 条里筛，
   * 久未分析的维度会因为被挤出窗口而被误报成「从未分析」。
   */
  async listAnalysisCoverage(moduleId: string, scopeId: string): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_analysis_coverage', { moduleId, scopeId });
  },
  /**
   * 回执：一轮分析真正结束后回填结局与产出条数。
   *
   * 发起与结束分两次写，是因为发起时 Agent 还没开口，等它答完会把扫描收尾挂住几十秒。
   * 但只写发起不写结束，「已发起」就会被当成「已分析」——模型报错那一轮照样点绿灯。
   */
  async finishAutoAnalysisRun(runId: string, outcome: AiAnalysisOutcome, insightCount = 0, detail = ''): Promise<void> {
    return invoke('finish_ai_auto_analysis_run', { runId, outcome, insightCount, detail });
  },
  /**
   * 清算中断轮次：把长期停在 pending 的轨迹落定为 interrupted，
   * 并在同一事务里退回它那一轮点名的焦点目标。返回被清算的轮次数。
   *
   * 回执写在 sendMessage 的回调里，进程还活着才写得成。应用被随手关掉时，
   * 那一轮既没 completed 也没 error，永远停在 pending —— 覆盖台账据此点绿灯、
   * 派单台账据此当已落实，而这一轮实际上一条结论都没有。
   */
  async reapStalePendingRuns(moduleId: string, scopeId: string, olderThanSec: number): Promise<number> {
    return invoke<number>('reap_stale_analysis_runs', { moduleId, scopeId, olderThanSec });
  },
  /** 每条规则在该作用域下的最近一条轨迹 —— 补跑调度的判据 */
  async listLatestRunPerRule(moduleId: string, scopeId: string): Promise<AiAutoAnalysisRun[]> {
    return invoke<AiAutoAnalysisRun[]>('list_ai_auto_analysis_latest_per_rule', {
      moduleId,
      scopeId,
    });
  },

  // ─── 焦点目标巡查派单 ───
  /**
   * 登记一轮派单：本轮点名交给 Agent 巡查的文件。
   *
   * 「派单即销账」是这张台账唯一正确的口径：用「有没有洞察」反推会让
   * 「Agent 看过、判定没问题」的文件被永久重复点名，变成不收敛的烧钱循环。
   */
  async recordFocusAssignments(input: {
    moduleId: string;
    scopeId: string;
    runId?: string;
    presetKey?: string;
    contextDigest?: string;
    targets: Array<{
      filePath: string;
      resonance?: number;
      note?: string;
      /** 复核派单专用：该文件当下的证据现状指纹，用于下一轮判断「这次变化派过单没有」 */
      evidenceDigest?: string;
      /**
       * 回归追责专用：该文件「本轮相对上一次扫描变坏了什么」的指纹。
       *
       * 与 contextDigest（整包变没变）、evidenceDigest（已知结论变没变）三分天下：
       * 三本账各记各的，任何一本都不能替另一本销账，否则一次派单会顺手抹掉
       * 另外两个维度的欠账，让对应档位永久静默。
       */
      regressionDigest?: string;
    }>;
  }): Promise<number> {
    return invoke<number>('record_ai_focus_assignments', {
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      runId: input.runId ?? null,
      presetKey: input.presetKey ?? null,
      contextDigest: input.contextDigest ?? null,
      targets: input.targets.map((t) => ({
        filePath: t.filePath,
        resonance: t.resonance ?? 0,
        note: t.note ?? '',
        evidenceDigest: t.evidenceDigest ?? '',
        regressionDigest: t.regressionDigest ?? '',
      })),
    });
  },
  /** 某作用域下的派单记录（每个文件一行，取最近一次） */
  async listFocusAssignments(moduleId: string, scopeId: string): Promise<AiFocusAssignmentDto[]> {
    return invoke<AiFocusAssignmentDto[]>('list_ai_focus_assignments', { moduleId, scopeId });
  },
  /**
   * 核销一轮派单：这一轮点名到底落实了没有。
   *
   * 「派单即销账」堵住了「判定没问题不写洞察 → 永远重复点名」的循环，
   * 却顺手开了反向的洞——**发起了、对话却失败**的那一轮同样销了账，
   * 于是一次网络抖动就能让共振榜第一名永久沉默。只有 error 会让派单作废重排。
   */
  async settleFocusAssignments(runId: string, outcome: string): Promise<number> {
    return invoke<number>('settle_ai_focus_assignments', { runId, outcome });
  },

  // ─── 指标快照：项目形态的历史基线 ───
  /**
   * 记录一次指标切面。返回 [行 id, 是否新增点]。
   *
   * 后端**不解析** metricsJson —— 指标定义是模块知识，公共层只负责存取，
   * 否则每接一个新模块都要回头改 Rust。
   */
  async recordMetricSnapshot(input: {
    moduleId: string;
    scopeId: string;
    digest: string;
    metricsJson: string;
    coverageJson?: string;
    triggerKind?: string;
    takenAt?: number;
  }): Promise<[string, boolean]> {
    return invoke<[string, boolean]>('record_ai_metric_snapshot', {
      id: null,
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      digest: input.digest,
      triggerKind: input.triggerKind ?? null,
      metricsJson: input.metricsJson,
      coverageJson: input.coverageJson ?? null,
      takenAt: input.takenAt ?? null,
    });
  },
  /** 指标时间轴（由新到旧） */
  async listMetricSnapshots(moduleId: string, scopeId: string, limit?: number): Promise<AiMetricSnapshotDto[]> {
    return invoke<AiMetricSnapshotDto[]>('list_ai_metric_snapshots', {
      moduleId,
      scopeId,
      limit: limit ?? null,
    });
  },

  // ─── 实体快照：哪个文件在变坏 ───
  /**
   * 记录一张实体榜单。返回 [行 id, 是否新增点]。
   *
   * total / cutoff / survivedJson 三个字段看着像统计装饰，实际是回归判定的地基：
   * 没有门槛分数就分不清「修好了」和「被挤下榜」，没有存活名单就会把
   * 「删掉遗留模块」当成质量改善。
   */
  async recordEntitySnapshot(input: {
    moduleId: string;
    scopeId: string;
    digest: string;
    entitiesJson: string;
    entityLabel?: string;
    coverageJson?: string;
    dimensionsJson?: string;
    survivedJson?: string;
    total?: number;
    cutoff?: number;
    triggerKind?: string;
    takenAt?: number;
  }): Promise<[string, boolean]> {
    return invoke<[string, boolean]>('record_ai_entity_snapshot', {
      id: null,
      moduleId: input.moduleId,
      scopeId: input.scopeId,
      digest: input.digest,
      triggerKind: input.triggerKind ?? null,
      entityLabel: input.entityLabel ?? null,
      entitiesJson: input.entitiesJson,
      coverageJson: input.coverageJson ?? null,
      dimensionsJson: input.dimensionsJson ?? null,
      survivedJson: input.survivedJson ?? null,
      total: input.total ?? null,
      cutoff: input.cutoff ?? null,
      takenAt: input.takenAt ?? null,
    });
  },
  /** 实体榜单序列（由新到旧）。回归只对照上一个点，默认取头几个 */
  async listEntitySnapshots(moduleId: string, scopeId: string, limit?: number): Promise<AiEntitySnapshotDto[]> {
    return invoke<AiEntitySnapshotDto[]>('list_ai_entity_snapshots', {
      moduleId,
      scopeId,
      limit: limit ?? null,
    });
  },
};

/** 库内一条实体榜单快照。JSON 字段由模块自己定义结构，后端原样存取 */
export interface AiEntitySnapshotDto {
  id: string;
  moduleId: string;
  scopeId: string;
  digest: string;
  triggerKind: string;
  entityLabel: string;
  entitiesJson: string;
  coverageJson: string;
  dimensionsJson: string;
  /** 上一批榜单实体中此刻仍存在的 id */
  survivedJson: string;
  /** 参与打分的实体总数（截断之前） */
  total: number;
  /** 榜单门槛：末位实体的分数 */
  cutoff: number;
  firstAt: number;
  lastAt: number;
  seenCount: number;
}

/** 库内一条指标快照。metricsJson / coverageJson 由模块自己定义结构，后端原样存取 */
export interface AiMetricSnapshotDto {
  id: string;
  moduleId: string;
  scopeId: string;
  digest: string;
  triggerKind: string;
  metricsJson: string;
  coverageJson: string;
  /** 该组指标首次出现时间（秒） */
  firstAt: number;
  /** 最近一次仍观测到该组指标的时间（秒） */
  lastAt: number;
  /** 连续观测次数：「保持了多久」本身就是信息 */
  seenCount: number;
}

/** 一条焦点目标派单记录：这个文件最近一次被点名巡查是什么时候、基于哪份数据 */
export interface AiFocusAssignmentDto {
  moduleId: string;
  scopeId: string;
  filePath: string;
  /** 派单所属轨迹 id，便于从文件跳回那一轮会话 */
  runId: string;
  presetKey: string;
  /** 派单当时的上下文指纹：与当前指纹不同 = 数据已变，值得复巡 */
  contextDigest: string;
  resonance: number;
  note: string;
  /** 累计被点名次数（点名多次仍无结论是需要人工介入的信号） */
  assignCount: number;
  /** 最近一次派单时间（秒） */
  assignedAt: number;
  /**
   * 核销状态：''=已发出待回执，其余同轨迹表（completed / no-output / error）。
   *
   * 只有 error 表示这次点名没有真的发生过（对话失败），读侧据此把它退回队列。
   * 历史行为空串，一律按「已落实」处理，与本列上线前的行为一致。
   */
  outcome?: string;
  /**
   * 派单时该文件的「证据现状」指纹（复核派单才有值）。
   *
   * contextDigest 是整包指纹，任何文件改动都会让它翻新，只能粗粒度回答「数据变了没有」；
   * 这一列精确到本文件的证据，用于判断「上次派出去的那次复核，针对的是不是同一次变化」。
   * 没有它，Agent 复核后若判定「结论仍成立」而不写任何东西，这个文件会被每轮重复点名。
   */
  evidenceDigest?: string;
  /**
   * 派单时该文件「本轮相对上一次扫描变坏了什么」的指纹（回归追责派单才有值）。
   *
   * 第三本账。回归信号与另外两者的关键差别是**它会过期**：再扫一次，这次的劣化
   * 就滚进了新基线，从此无从追问。所以它既不能靠 contextDigest 销账（整包指纹
   * 每次扫描都变，等于从不销账），也不能靠 evidenceDigest 销账（那记的是已知结论，
   * 一个刚变坏、还没有任何结论的文件在那本账上永远是空的）。
   */
  regressionDigest?: string;
}

/** 自动分析规则：「某模块上下文更新后，让哪个已配置 Agent 用什么预设去分析」 */
export interface AiAutoAnalysisRule {
  id: string;
  enabled: boolean;
  /** 监听哪个模块的上下文产出（当前唯一供给者 project-scan，未来任意模块复用） */
  moduleId: string;
  /** null = 该模块下所有作用域通用；填值则只对某个分析生效 */
  scopeId: string | null;
  /** 用户在 UI 选定的已配置 Agent，永不由代码写死 */
  agentId: string;
  presetKey: string;
  /** "full-scan" 仅全量扫描后 / "any-scan" 含 watch 增量重扫 */
  triggerOn: string;
  /** 冷却窗口（分钟）：距上次触发不足则跳过 */
  cooldownMinutes: number;
  /** 内容指纹未变化时跳过 */
  skipIfUnchanged: boolean;
  lastRunAt: number;
  lastDigest: string;
  lastConversationId: string | null;
}

export type AiAutoAnalysisRuleInput = Omit<AiAutoAnalysisRule, 'lastRunAt' | 'lastDigest' | 'lastConversationId'>;

/** 一次编排的审计记录 */
export interface AiAutoAnalysisRun {
  id: string;
  ruleId: string;
  moduleId: string;
  scopeId: string;
  agentId: string;
  presetKey: string;
  packId: string | null;
  conversationId: string | null;
  triggerKind: string;
  /** "triggered" | "skipped" | "failed" */
  status: string;
  detail: string;
  /**
   * 本次分析所基于的上下文内容指纹（只有 triggered 才有值）。
   * 覆盖台账靠它区分「久没分析」与「数据变了、结论已经对不上」——
   * 时间只能说明久，说明不了变。
   */
  contextDigest?: string;
  /**
   * 机器可读的判定原因：ok / rotate-gap / cooling / busy / unchanged / agent-missing …
   *
   * detail 是给人看的中文句子，会随文案调整而变。补跑要判断的是「这次跳过是不是
   * 可恢复的」，拿自然语言当协议，改一个字调度就失灵。
   */
  reason?: string;
  /** 发起之后的归宿；空串 = 早于回执特性的历史记录，按「无法判断」处理 */
  outcome?: AiAnalysisOutcome | '';
  /** 本轮实际沉淀的洞察条数（回执时回填） */
  insightCount?: number;
  /** 回执落点时间（秒）；0 = 尚未回执 */
  finishedAt?: number;
  createdAt: number;
}

/**
 * 一轮分析发起之后的归宿。
 *
 * · pending     —— 消息已发出，Agent 还在跑
 * · completed   —— 正常结束且有结论沉淀
 * · no-output   —— 正常结束但一条结论都没保存（合法：认真看过、确实没问题）
 * · error       —— 对话失败，这一轮等于没跑
 * · interrupted —— 长时间没等到回执，判定为中断（几乎总是「应用被关掉了」）
 *
 * 为什么 interrupted 要与 error 分开：两者对台账的效力完全相同（都不算覆盖、
 * 都要退回派单），但死法不同。合成一个值，用户在轨迹上只会看到「对话失败」，
 * 于是去查模型和密钥——而真正发生的事只是他关了窗口。
 */
export type AiAnalysisOutcome = 'pending' | 'completed' | 'no-output' | 'error' | 'interrupted';

export type AiAutoAnalysisRunInput = Omit<AiAutoAnalysisRun, 'createdAt' | 'insightCount' | 'finishedAt'>;

export interface AiInsightInput {
  id: string;
  packId?: string | null;
  analysisId: string;
  agentId?: string | null;
  kind: string;
  title: string;
  body: string;
  severity: string;
  refs?: string[];
}

export interface AiInsightDto {
  id: string;
  packId: string | null;
  analysisId: string;
  agentId: string | null;
  kind: string;
  title: string;
  body: string;
  severity: string;
  refs: string[];
  /** 同一结论被不同分析轮次确认的次数（去重累加），>1 说明结论稳定可复用 */
  seenCount?: number;
  /** 首次记录 / 最近确认时间戳（秒） */
  firstSeen?: number;
  lastSeen?: number;
  /**
   * 结论时效：拿本次扫描的文件内容哈希，回头比对结论产出当时冻结的证据快照。
   * 没有它，沉淀只会单调增长——改完的问题继续挂着误导人，Agent 每轮还要重读一遍。
   */
  freshness?: InsightFreshness;
  /** 证据内容已变的路径（这条结论需要复核） */
  changedRefs?: string[];
  /** 证据文件已不存在的路径 */
  missingRefs?: string[];
  /**
   * 证据**现状**指纹：各证据路径此刻的内容哈希聚合（与冻结在 evidence 里的旧哈希不同）。
   *
   * freshness 回答「变了没有」，这一份回答「现在长什么样」。复核派单靠它收敛：
   * Agent 复核后什么都不写时它不变（已派过单 → 不再点名），文件被再次改动时它必然变
   * （→ 重新排队）。判据落在客观代码上，不落在模型愿不愿意写字上。
   */
  evidenceDigest?: string;
  /**
   * 生命周期状态：`open` 仍占用注意力，`resolved` 已复核收口。
   * 时效判定只回答「证据还是不是那份」，收口才回答「这事还要不要管」——
   * 少了后者，判得越准，面板上的旧账反而越厚。
   */
  status?: 'open' | 'resolved';
  resolvedAt?: number;
  resolvedReason?: string | null;
  resolvedBy?: string | null;
}

/**
 * · current    证据仍在且内容未变，结论继续成立
 * · stale      至少一处证据变了 / 少了 —— 需复核
 * · orphaned   全部证据文件已不存在 —— 可能已修复，也可能只是搬了家
 * · unanchored 结论没写可用 refs，永远无法验证
 * · unknown    无从比对（没扫过，或是没有证据快照的历史数据）
 */
export type InsightFreshness = 'current' | 'stale' | 'orphaned' | 'unanchored' | 'unknown';

export interface AiContextPackSummary {
  id: string;
  scopeId: string;
  moduleId: string;
  scopeLabel: string;
  schemaVersion: number;
  generatedAt: number;
  tokenEstimate: number;
  digest: string;
  truncatedSections: string[];
  sectionKeys: string[];
  sectionCount: number;
}

export interface AiContextSectionDto {
  key: string;
  title: string;
  summary: string;
  content: string;
  tokenEstimate: number;
  priority: number;
  facts: unknown | null;
  /** 数据可信度（AiSectionDataQuality）；历史数据为 null 时按「可信」处理 */
  dataQuality: unknown | null;
  digest: string;
  updatedAt: number;
}

/** 分节戳：指纹 + 更新时间，**不含正文**。用于增量判定与新鲜度展示 */
export interface AiContextSectionStamp {
  sectionKey: string;
  digest: string;
  updatedAt: number;
  tokenEstimate: number;
}

export interface AiContextPackDetail {
  id: string;
  scopeId: string;
  moduleId: string;
  scopeLabel: string;
  schemaVersion: number;
  generatedAt: number;
  tokenEstimate: number;
  digest: string;
  truncatedSections: string[];
  sections: AiContextSectionDto[];
}
