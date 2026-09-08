/**
 * insightReport —— 把 AI 结论翻译成「可写进交付文档」的结构。模块无关。
 *
 * 为什么必须有这一层
 * ------------------
 * 到目前为止，链路的产出分成互不相干的两半：
 *   · 扫描报告（HTML/JSON/SVG）——机器测量出来的**事实**，可导出、可交付、可归档；
 *   · AI 洞察（ai_insights 表）——Agent 判断出来的**结论**，只活在面板和画布角标里。
 * 结果是：用户导出报告发给同事时，AI 花了大量 token 分析出的结论一个字都带不走；
 * 而 AI 的结论离开这个软件就失去了它赖以成立的事实依据。两边都残缺。
 *
 * 本文件负责把结论与事实合流，并且在合流时做一件同样重要的事：**核验证据**。
 *
 * 证据核验：抵御幻觉的最后一道闸
 * ------------------------------
 * 洞察的 refs 是模型写出来的字符串。模型完全可能写出一个项目里并不存在的
 * `src/services/UserService.ts:120`。这种引用一旦被原样印进交付文档，
 * 读者会默认它经过了校验 —— 报告的权威性反而成了幻觉的放大器。
 * 所以这里拿扫描到的真实路径集合逐条比对，对不上的显式标成「无法核实」，
 * 既不丢弃（丢弃等于替 AI 掩盖），也不假装可信。
 *
 * 模块无关
 * --------
 * 输入只有两样东西：洞察数组（结构等价于 ai_insights 行）与已知路径列表。
 * 不认识扫描的任何阶段、不认识画布、不认识报告的排版。任何未来接入
 * AiContextProvider 的模块，产出的洞察落在同一张表里，都能直接复用本层。
 */

import {
  SEVERITY_COLOR,
  severityLabel,
  SEVERITY_RANK,
  normalizeRefPath,
  normalizeSeverity,
  type InsightSeverity,
} from "./insightOverlay";
import type { AiContextQualityReport, AiDataQualityStatus } from "./contextTypes";
import { DATA_QUALITY_LABEL_KEY, coverageRatio } from "./dataQuality";
import { t } from "../i18n";

/** 报告层需要的洞察字段（结构等价 AiInsightDto，但不依赖 tauri 层类型） */
export interface ReportInsightInput {
  id: string;
  title: string;
  body: string;
  kind: string;
  severity: string;
  refs: string[];
  agentId?: string | null;
  seenCount?: number;
  firstSeen?: number;
  lastSeen?: number;
  /** 结论时效（后端拿当前扫描哈希与证据快照比对得出），缺省按「无从判断」处理 */
  freshness?: string;
  changedRefs?: string[];
  missingRefs?: string[];
  /**
   * 生命周期状态。后端新增 resolve 收口机制后，已收口的结论不再作为
   * 待办出现在报告主体里（与面板/画布一致：resolved 不上画布、单独成档）。
   * 缺省（旧数据 / 测试夹具）一律按 open 处理。
   */
  status?: string;
  /** 收口理由（status === "resolved" 时由 resolve 动作必填），报告里作为审计记录 */
  resolvedReason?: string | null;
  /** 收口操作人（Agent id 或 "user"） */
  resolvedBy?: string | null;
}

/** 时效档位：与后端 insight_freshness 常量一一对应 */
export type InsightFreshness =
  | "current"
  | "stale"
  | "orphaned"
  | "unanchored"
  | "unknown";

const FRESHNESS_VALUES: readonly InsightFreshness[] = [
  "current",
  "stale",
  "orphaned",
  "unanchored",
  "unknown",
];

export function normalizeFreshness(raw: string | undefined): InsightFreshness {
  const v = (raw ?? "").trim().toLowerCase();
  return (FRESHNESS_VALUES as readonly string[]).includes(v)
    ? (v as InsightFreshness)
    : "unknown";
}

export function freshnessLabel(f: InsightFreshness): string {
  return t(`report.freshnessLabel.${f}`);
}

/**
 * 交付文档里对时效的解释。
 *
 * 报告读者不在软件里，看不到面板上的颜色，也不知道「stale」是什么意思——
 * 每一档都必须用一句人话说清「这条结论现在该怎么对待」。
 */
export function freshnessNote(f: InsightFreshness): string {
  return t(`report.freshnessNote.${f}`);
}

/** 一条被核验过的证据引用 */
export interface ReportInsightRef {
  /** 规范化后的相对路径 */
  path: string;
  line: number | null;
  /** 模型写的原文，核验失败时报告里原样呈现，方便人判断是笔误还是幻觉 */
  raw: string;
  /**
   * 是否对应到扫描真实见过的文件/目录。
   * knownPaths 为空（调用方没提供核验依据）时一律为 true —— 无法核验时
   * 不能倒过来把所有证据都判成可疑，那是另一种误导。
   */
  verified: boolean;
}

/**
 * 结论稳定性：靠 seenCount 区分「这轮新冒出来的」和「多轮反复确认的」。
 * 交付文档里这两者的分量完全不同：反复确认的结论值得排进整改计划，
 * 只出现一次的更可能是模型在某一轮的偶然措辞。
 */
export type InsightStability = "new" | "reconfirmed" | "stable";

export interface ReportInsightItem {
  id: string;
  title: string;
  body: string;
  kind: string;
  kindLabel: string;
  severity: InsightSeverity;
  severityLabel: string;
  severityColor: string;
  refs: ReportInsightRef[];
  /** refs 中无法核实的条数，>0 时报告会在该条结论上打提示 */
  unverifiedCount: number;
  seenCount: number;
  firstSeen: number | null;
  lastSeen: number | null;
  stability: InsightStability;
  agentId: string | null;
  /** 结论时效：这条结论所依据的代码，现在还是不是当初那份 */
  freshness: InsightFreshness;
  freshnessLabel: string;
  /** 内容已变 / 已消失的证据路径，报告里直接点名，读者才知道该去看哪 */
  changedRefs: string[];
  missingRefs: string[];
  /** 生命周期状态与收口信息（resolved 时带理由，供报告审计成节） */
  status?: string;
  resolvedReason?: string | null;
  resolvedBy?: string | null;
}

/** 被结论点名最多的文件（交付文档里的「优先整改对象」） */
export interface InsightHotPath {
  path: string;
  /** 命中该路径的洞察条数 */
  count: number;
  /** 命中该路径的最高严重度 */
  severity: InsightSeverity;
}

export interface ReportInsightSummary {
  total: number;
  bySeverity: Record<InsightSeverity, number>;
  /** critical + high：需要立刻处理的条数 */
  actionable: number;
  /** 被多轮确认过的结论数（seenCount > 1） */
  stableCount: number;
  /** 本轮新增结论数（seenCount <= 1） */
  newCount: number;
  /** 证据核验失败的引用总数 */
  unverifiedRefs: string[];
  /** 参与产出这些结论的 Agent id（证明结论来自用户自己配置的 Agent，而非写死的模型） */
  agents: string[];
  items: ReportInsightItem[];
  hotPaths: InsightHotPath[];
  /** 各时效档位的条数 */
  byFreshness: Record<InsightFreshness, number>;
  /** stale + orphaned：所依据的代码已经变了，交付前应当先复核的条数 */
  needsReview: number;
  /**
   * 已收口（status === "resolved"）的结论数。
   *
   * 报告主体只汇总 open 结论；resolved 单独计数并提供 resolvedItems，
   * 让交付文档可以另起一节「已处理历史」做审计闭环，而不污染待办统计。
   */
  resolvedCount: number;
  /** 已收口结论明细（已按严重度→确认次数排序），供报告单独成节使用 */
  resolvedItems: ReportInsightItem[];
}

export function insightKindLabel(kind: string): string {
  const k = (kind ?? "").trim().toLowerCase();
  const label = t(`aiPanel.kind.${k}`);
  return label !== `aiPanel.kind.${k}` ? label : kind || t("aiPanel.kind.fallback");
}

/** seenCount → 稳定性档位。3 次是「反复出现」与「长期稳定」的经验分界 */
export function stabilityOf(seenCount: number | undefined): InsightStability {
  const n = seenCount ?? 1;
  if (n >= 3) return "stable";
  if (n >= 2) return "reconfirmed";
  return "new";
}

export function stabilityLabel(s: InsightStability): string {
  return t(`report.stability.${s}`);
}

/**
 * 核验索引：精确路径 + 目录 + basename 回退。
 *
 * 允许 basename 回退（模型常只写文件名 `UserService.ts`）是刻意的宽容，
 * 但**仅在项目内该文件名唯一时**才认 —— 同名文件有多个时无从判断指的是哪一个，
 * 硬猜会把结论挂到无辜的文件上，比标成「无法核实」危害更大。
 */
interface VerifyIndex {
  files: Set<string>;
  dirs: Set<string>;
  uniqueBasename: Map<string, string>;
}

function buildVerifyIndex(knownPaths: readonly string[]): VerifyIndex {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const byBasename = new Map<string, string[]>();

  for (const raw of knownPaths) {
    const { path } = normalizeRefPath(raw);
    if (!path) continue;
    files.add(path);

    const base = path.slice(path.lastIndexOf("/") + 1);
    const list = byBasename.get(base);
    if (list) list.push(path);
    else byBasename.set(base, [path]);

    // 逐级登记祖先目录：结论点名一个目录（「整个 utils 层耦合过高」）也算有效证据
    let i = path.lastIndexOf("/");
    while (i > 0) {
      dirs.add(path.slice(0, i));
      i = path.lastIndexOf("/", i - 1);
    }
  }

  const uniqueBasename = new Map<string, string>();
  for (const [base, list] of byBasename) {
    if (list.length === 1) uniqueBasename.set(base, list[0]);
  }
  return { files, dirs, uniqueBasename };
}

function verifyRef(raw: string, index: VerifyIndex | null): ReportInsightRef {
  const { path, line } = normalizeRefPath(raw);
  if (!index) return { path, line, raw, verified: true };
  if (!path) return { path, line, raw, verified: false };

  if (index.files.has(path) || index.dirs.has(path)) {
    return { path, line, raw, verified: true };
  }
  const base = path.slice(path.lastIndexOf("/") + 1);
  const hit = index.uniqueBasename.get(base);
  if (hit) return { path: hit, line, raw, verified: true };

  return { path, line, raw, verified: false };
}

export interface BuildInsightReportOptions {
  /**
   * 扫描到的真实文件相对路径。给了才做证据核验；
   * 不给则所有引用按「无从核验」处理并一律标 verified，报告里也不会出现核验提示。
   */
  knownPaths?: readonly string[];
  /** 热点路径最多列几条 */
  topPaths?: number;
}

/**
 * 汇总洞察为报告可直接渲染的结构。
 *
 * 排序口径与面板/画布保持一致（严重度优先、同级按确认次数降序），
 * 这样同一批结论在软件里和在导出的文档里顺序相同 —— 顺序不一致会让人
 * 怀疑是两份不同的数据。
 */
export function buildInsightReport(
  insights: readonly ReportInsightInput[] | undefined,
  options: BuildInsightReportOptions = {},
): ReportInsightSummary | null {
  if (!insights || insights.length === 0) return null;

  const index =
    options.knownPaths && options.knownPaths.length > 0
      ? buildVerifyIndex(options.knownPaths)
      : null;

  const bySeverity: Record<InsightSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const unverifiedRefs: string[] = [];
  const agents = new Set<string>();
  const pathAcc = new Map<string, { count: number; rank: number }>();
  const byFreshness: Record<InsightFreshness, number> = {
    current: 0,
    stale: 0,
    orphaned: 0,
    unanchored: 0,
    unknown: 0,
  };

  const isResolved = (ins: ReportInsightInput) => ins.status === "resolved";
  const toItem = (ins: ReportInsightInput): ReportInsightItem => {
    const severity = normalizeSeverity(ins.severity);
    const refs = (ins.refs ?? []).map((r) => verifyRef(r, index));
    let unverified = 0;
    for (const r of refs) {
      if (!r.verified) {
        unverified += 1;
        continue;
      }
    }

    const seenCount = ins.seenCount ?? 1;
    const freshness = normalizeFreshness(ins.freshness);
    return {
      id: ins.id,
      title: ins.title,
      body: ins.body,
      kind: ins.kind,
      kindLabel: insightKindLabel(ins.kind),
      severity,
      severityLabel: severityLabel(severity),
      severityColor: SEVERITY_COLOR[severity],
      refs,
      unverifiedCount: unverified,
      seenCount,
      firstSeen: ins.firstSeen && ins.firstSeen > 0 ? ins.firstSeen : null,
      lastSeen: ins.lastSeen && ins.lastSeen > 0 ? ins.lastSeen : null,
      stability: stabilityOf(seenCount),
      agentId: ins.agentId ?? null,
      freshness,
      freshnessLabel: freshnessLabel(freshness),
      changedRefs: ins.changedRefs ?? [],
      missingRefs: ins.missingRefs ?? [],
      status: ins.status,
      resolvedReason: ins.resolvedReason ?? null,
      resolvedBy: ins.resolvedBy ?? null,
    };
  };

  // 只聚合 open 结论：resolved 不再计入待办统计，但保留明细供报告单独成节
  const items: ReportInsightItem[] = insights.filter((i) => !isResolved(i)).map(toItem);
  const resolvedItems: ReportInsightItem[] = insights.filter(isResolved).map(toItem);

  for (const it of items) {
    bySeverity[it.severity] += 1;
    if (it.agentId) agents.add(it.agentId);
    const seenPathsInThisInsight = new Set<string>();
    for (const r of it.refs) {
      if (!r.verified) {
        unverifiedRefs.push(r.raw);
        continue;
      }
      // 同一条洞察多次点名同一文件（不同行号）只记一次，否则热点会被单条结论刷榜
      if (seenPathsInThisInsight.has(r.path)) continue;
      seenPathsInThisInsight.add(r.path);
      const prev = pathAcc.get(r.path);
      if (prev) {
        prev.count += 1;
        prev.rank = Math.min(prev.rank, SEVERITY_RANK[it.severity]);
      } else {
        pathAcc.set(r.path, { count: 1, rank: SEVERITY_RANK[it.severity] });
      }
    }
    byFreshness[it.freshness] += 1;
  }

  items.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return b.seenCount - a.seenCount;
  });

  resolvedItems.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return b.seenCount - a.seenCount;
  });

  const severityByRank: InsightSeverity[] = ["critical", "high", "medium", "low", "info"];
  const hotPaths: InsightHotPath[] = [...pathAcc.entries()]
    .map(([path, v]) => ({ path, count: v.count, severity: severityByRank[v.rank] }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    })
    .slice(0, options.topPaths ?? 10);

  return {
    total: items.length,
    bySeverity,
    actionable: bySeverity.critical + bySeverity.high,
    stableCount: items.filter((i) => i.seenCount > 1).length,
    newCount: items.filter((i) => i.seenCount <= 1).length,
    unverifiedRefs: [...new Set(unverifiedRefs)],
    agents: [...agents],
    items,
    hotPaths,
    byFreshness,
    needsReview: byFreshness.stale + byFreshness.orphaned,
    resolvedCount: resolvedItems.length,
    resolvedItems,
  };
}

/** 报告里的一行可信度声明 */
export interface QualityDisclosureRow {
  label: string;
  status: AiDataQualityStatus;
  statusLabel: string;
  observed: number;
  /** 覆盖率百分比，无 expected 时为 null */
  ratio: number | null;
  reason: string | null;
  caveat: string | null;
}

export interface QualityDisclosure {
  overall: AiDataQualityStatus;
  overallLabel: string;
  /** 盲区维度名（这些维度的「未发现问题」不能当结论） */
  blindSpots: string[];
  partial: string[];
  rows: QualityDisclosureRow[];
  /** 一句话结论，直接印在报告头部 */
  statement: string;
}

function overallStatement(status: AiDataQualityStatus): string {
  return t(`report.quality.stmt.${status}`);
}

/**
 * 把体检报告翻译成交付文档里的可信度声明。
 *
 * 为什么报告必须带这一段：一份对外交付的文档，读者没有任何途径知道
 * 「未发现循环依赖」背后是跑完了还是没跑。缺了这段声明，报告的沉默
 * 会被读成担保。
 */
export function buildQualityDisclosure(
  report: AiContextQualityReport | null | undefined,
): QualityDisclosure | null {
  if (!report || report.dimensions.length === 0) return null;

  const rows: QualityDisclosureRow[] = report.dimensions.map((d) => ({
    label: d.label,
    status: d.quality.status,
    statusLabel: t(DATA_QUALITY_LABEL_KEY[d.quality.status]),
    observed: d.observed,
    ratio: coverageRatio(d.quality),
    reason: d.quality.reason ?? null,
    caveat: d.quality.caveat ?? null,
  }));

  return {
    overall: report.overall,
    overallLabel: t(DATA_QUALITY_LABEL_KEY[report.overall]),
    blindSpots: rows.filter((r) => r.status === "unavailable").map((r) => r.label),
    partial: rows.filter((r) => r.status === "partial").map((r) => r.label),
    rows,
    statement: overallStatement(report.overall),
  };
}
