/**
 * 画布画像数据聚合工具（纯函数）
 *
 * 把 projectStore 中分散的分析数据（符号/设计模式/引用/度量）聚合成
 * 「文件 → 画像信息」映射，供画布 FileRenderer 一次性渲染：
 * - symbolCount：文件内符号数量（类/函数/接口等）
 * - patternNames：命中设计模式的中文名列表
 * - refCount：文件被引用的次数（入向引用边数）
 * - complexity：圈复杂度 + 等级（复杂度热力着色）
 */

import type {
  ProjectFile,
  ProjectSymbol,
  PatternHit,
  ProjectSymbolRef,
  FileMetric,
  TechDebtItem,
  CodeClone,
  GitChurn,
  CallEdge,
  DeadSymbol,
  ReviewFinding,
} from "../../services/tauri";
import { parseFileMetricMeta } from "../../services/tauri";
import { t } from "../../i18n";

/**
 * 重构优先级四象限（Michael Feathers churn-vs-complexity）
 * - refactorFirst：高复杂 + 高变更，每次改都痛且还在一直改
 * - legacyStable：高复杂 + 低变更，稳定的老代码，先别碰
 * - activeSimple：低复杂 + 高变更，正常的活跃开发区
 * - healthy：低复杂 + 低变更
 */
export type RiskQuadrant = "refactorFirst" | "legacyStable" | "activeSimple" | "healthy";

export interface FileInsight {
  symbolCount: number;
  patternNames: string[];
  refCount: number;
  complexity: number;
  complexityLevel: "low" | "medium" | "high" | "extreme";
  /** 复杂度度量引擎：ast（tree-sitter 精确）| heuristic（行级估算）| 无度量时不设置。
   *  前端热力图据此区分展示，避免估算值被当成精确值。 */
  complexityEngine?: "ast" | "heuristic";
  /** 语法错误行数（R46：tree-sitter ERROR/MISSING 节点；0=无语法错误） */
  syntaxErrorCount: number;
  /** 语法错误所在行号（1 起，供查看器定位） */
  syntaxErrorLines: number[];
  /** 该文件定义的符号名列表（前 8 个，用于 Tooltip 与连线标注） */
  symbolNames: string[];
  /** 技术债标记数（TODO/FIXME/HACK 等） */
  techDebtCount: number;
  /** 技术债标记类型汇总（如 ["FIXME","TODO"]，用于 Tooltip） */
  techDebtMarkers: string[];
  /** git 变更热度分值（无 git 数据时为 0） */
  churnScore: number;
  churnLevel: "low" | "medium" | "high" | "extreme";
  /** 提交次数 / 参与作者数（Tooltip 展示） */
  commitCount: number;
  authorCount: number;
  /** 调用出度：该文件内函数调用了多少个不同目标 */
  callOut: number;
  /** 调用入度：该文件内函数被多少处调用（影响面） */
  callIn: number;
  /** 死代码符号数（零引用） */
  deadCount: number;
  /** 该文件内的重复代码块数（克隆实例数） */
  cloneCount: number;
  /** 该文件内 Type-2 参数化克隆实例数（变量重命名后的近重复，比逐字复制更隐蔽） */
  cloneType2Count: number;
  /** 该文件被重复覆盖的代码行数（多个克隆块合并去重后的行数） */
  duplicatedLines: number;
  /** 重复率 = 重复行 / 代码行（0~1，无度量数据时以总行数兜底） */
  duplicationRatio: number;
  /** 重构优先级象限 */
  quadrant: RiskQuadrant;
  /** 命中该文件的审查发现数 */
  findingCount: number;
  /** 审查发现严重度加权分（error=5 / warning=2 / info=1），风险画像的排序依据 */
  riskScore: number;
  /** 各严重度计数（Tooltip 与属性面板展示） */
  findingSeverities: { error: number; warning: number; info: number };
}

/** 审查严重度 → 风险权重（统一口径：画像排序、属性面板、报告一致） */
export const SEVERITY_WEIGHT: Record<string, number> = {
  error: 5,
  critical: 5,
  warning: 2,
  warn: 2,
  info: 1,
  hint: 1,
};

/** 严重度别名归一化（后端可能给 critical/warn/hint 等变体） */
export function normalizeSeverity(s: string): "error" | "warning" | "info" {
  const k = (s || "").toLowerCase();
  if (k === "error" || k === "critical") return "error";
  if (k === "warning" || k === "warn") return "warning";
  return "info";
}

/** 四象限 → 中文名 + 配色（画布与报告统一口径） */
export const QUADRANT_META: Record<RiskQuadrant, { label: string; color: string }> = {
  refactorFirst: { label: "insight.quad.refactorFirst", color: "#ef4444" },
  legacyStable: { label: "insight.quad.legacyStable", color: "#f59e0b" },
  activeSimple: { label: "insight.quad.activeSimple", color: "#3b82f6" },
  healthy: { label: "insight.quad.healthy", color: "#22c55e" },
};

/** 四象限 → 行动建议（画布区域标签与报告结论共用一套措辞） */
export const QUADRANT_HINT: Record<RiskQuadrant, string> = {
  refactorFirst: "insight.quadHint.refactorFirst",
  legacyStable: "insight.quadHint.legacyStable",
  activeSimple: "insight.quadHint.activeSimple",
  healthy: "insight.quadHint.healthy",
};

/**
 * v2.32 风险代理象限建议：非 Git 仓库（无变更热度）时，横轴回退为「审查风险分」
 * （error×5+warning×2+info）。此时「变更」措辞不再成立，改用「风险」口径，避免
 * 画布标签与真实横轴数据源错位（renderable but misleading）。
 */
export const QUADRANT_HINT_RISK: Record<RiskQuadrant, string> = {
  refactorFirst: "insight.quadHintRisk.refactorFirst",
  legacyStable: "insight.quadHintRisk.legacyStable",
  activeSimple: "insight.quadHintRisk.activeSimple",
  healthy: "insight.quadHintRisk.healthy",
};

/**
 * v2.38 重复率代理象限建议：无 Git 变更、无审查风险时，横轴回退为「代码重复率」
 * （扫描必然落库）。此时「变更/风险」措辞不再成立，改用「重复」口径，避免标签错位。
 */
export const QUADRANT_HINT_DUP: Record<RiskQuadrant, string> = {
  refactorFirst: "insight.quadHintDup.refactorFirst",
  legacyStable: "insight.quadHintDup.legacyStable",
  activeSimple: "insight.quadHintDup.activeSimple",
  healthy: "insight.quadHintDup.healthy",
};

/**
 * v2.38 文件规模代理象限建议：连重复率都为 0（极小/无克隆项目）时，横轴回退为「文件规模（行数）」。
 * 这是 scan 永远落库的数据，保证横轴至少有 spread，画像恒为二维散点而非竖线。
 */
export const QUADRANT_HINT_SIZE: Record<RiskQuadrant, string> = {
  refactorFirst: "insight.quadHintSize.refactorFirst",
  legacyStable: "insight.quadHintSize.legacyStable",
  activeSimple: "insight.quadHintSize.activeSimple",
  healthy: "insight.quadHintSize.healthy",
};

/** 复杂度等级 + 变更热度等级 → 四象限 */
export function quadrantOf(
  complexityLevel: FileInsight["complexityLevel"],
  churnLevel: FileInsight["churnLevel"]
): RiskQuadrant {
  const hiComplex = complexityLevel === "high" || complexityLevel === "extreme";
  const hiChurn = churnLevel === "high" || churnLevel === "extreme";
  if (hiComplex && hiChurn) return "refactorFirst";
  if (hiComplex) return "legacyStable";
  if (hiChurn) return "activeSimple";
  return "healthy";
}

/** churn 分值 → 热度等级（与后端 hotspot_level_of 保持同一阈值） */
export function churnLevelOf(score: number): FileInsight["churnLevel"] {
  if (score <= 10) return "low";
  if (score <= 30) return "medium";
  if (score <= 80) return "high";
  return "extreme";
}

/**
 * 设计模式 id → 中文名（与后端 `design_patterns::pattern_label` 保持一致）
 *
 * 后端引擎重写后新增了适配器/装饰器/门面/命令/访问者/模板方法六种，
 * 这里必须同步补齐，否则画布与面板会退化成显示英文 id。
 */
const PATTERN_LABELS: Record<string, string> = {
  singleton: "insight.pattern.singleton",
  factory: "insight.pattern.factory",
  builder: "insight.pattern.builder",
  observer: "insight.pattern.observer",
  strategy: "insight.pattern.strategy",
  adapter: "insight.pattern.adapter",
  decorator: "insight.pattern.decorator",
  facade: "insight.pattern.facade",
  command: "insight.pattern.command",
  visitor: "insight.pattern.visitor",
  template_method: "insight.pattern.template_method",
  repository: "insight.pattern.repository",
  service: "insight.pattern.service",
  store: "insight.pattern.store",
  provider: "insight.pattern.provider",
  controller: "insight.pattern.controller",
  middleware: "insight.pattern.middleware",
  plugin: "insight.pattern.plugin",
  hook: "insight.pattern.hook",
  hoc: "insight.pattern.hoc",
  factory_fn: "insight.pattern.factory_fn",
};

export function patternLabel(p: string): string {
  return t(PATTERN_LABELS[p] ?? p);
}

/**
 * 模式分类 → 中文名 / 配色
 *
 * 分类不是装饰：GoF 三大类回答的是不同问题 ——
 * 创建型管「对象怎么来」、结构型管「对象怎么拼」、行为型管「对象怎么协作」；
 * 而 Repository/Service 属于架构角色（分层约定）而非 GoF 模式，单列一类避免混为一谈。
 * 画布按这四类分带，同带同色。
 */
export const PATTERN_CATEGORY_LABEL_KEY: Record<string, string> = {
  creational: "entityProj.cat.creational",
  structural: "entityProj.cat.structural",
  behavioral: "entityProj.cat.behavioral",
  architectural: "entityProj.cat.architectural",
};

export const PATTERN_CATEGORY_COLORS: Record<string, string> = {
  creational: "#38bdf8",
  structural: "#a855f7",
  behavioral: "#f59e0b",
  architectural: "#10b981",
};

/** 分类展示顺序（创建 → 结构 → 行为 → 架构角色，与 GoF 教材一致） */
export const PATTERN_CATEGORY_ORDER = ["creational", "structural", "behavioral", "architectural"];

/** 模式 id → 分类（后端未回填 category 的旧数据用此表兜底） */
const PATTERN_CATEGORY_OF: Record<string, string> = {
  singleton: "creational",
  factory: "creational",
  builder: "creational",
  adapter: "structural",
  decorator: "structural",
  facade: "structural",
  observer: "behavioral",
  strategy: "behavioral",
  command: "behavioral",
  visitor: "behavioral",
  template_method: "behavioral",
  repository: "architectural",
  service: "architectural",
  store: "architectural",
  provider: "architectural",
  controller: "architectural",
  middleware: "architectural",
  plugin: "architectural",
  hook: "behavioral",
  hoc: "structural",
  factory_fn: "creational",
};

export function patternCategoryOf(hit: { pattern: string; category?: string }): string {
  if (hit.category && PATTERN_CATEGORY_LABEL_KEY[hit.category]) return hit.category;
  return PATTERN_CATEGORY_OF[hit.pattern] ?? "behavioral";
}

/**
 * 模式种类 → 稳定配色（与分类色区分：分类色只有 4 个，模式有 13 个）
 *
 * 画布按「模式种类」着色后，同一模式的全部命中共享一个颜色 —— 仓储模式的 15 处命中
 * 在画布上天然成簇，用户一眼就能扫出「我的项目里 Repository 都长在哪些文件」。
 * 分类色只作兜底（后端未回填 patternId 的极旧数据）。
 */
export const PATTERN_PALETTE: Record<string, string> = {
  singleton: "#0ea5e9",
  factory: "#06b6d4",
  builder: "#3b82f6",
  adapter: "#a855f7",
  decorator: "#d946ef",
  facade: "#8b5cf6",
  observer: "#f59e0b",
  strategy: "#f97316",
  command: "#eab308",
  visitor: "#f43f5e",
  template_method: "#fb7185",
  repository: "#10b981",
  service: "#14b8a6",
  store: "#0d9488",
  provider: "#059669",
  controller: "#65a30d",
  middleware: "#ca8a04",
  plugin: "#7c3aed",
  hook: "#22d3ee",
  hoc: "#e879f9",
  factory_fn: "#5eead4",
};

export function patternColorOf(patternId: string): string {
  return PATTERN_PALETTE[patternId] ?? PATTERN_CATEGORY_COLORS[patternCategoryOf({ pattern: patternId })];
}

/** 复杂度等级 → 热力色（供渲染器统一使用） */
export const COMPLEXITY_COLORS: Record<FileInsight["complexityLevel"], string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#f97316",
  extreme: "#ef4444",
};

export function complexityLevelOf(cc: number): FileInsight["complexityLevel"] {
  if (cc <= 5) return "low";
  if (cc <= 10) return "medium";
  if (cc <= 20) return "high";
  return "extreme";
}

/** 重复率 → 热力色（画像布局、画布徽标、报告统一口径） */
export const DUPLICATION_COLORS = {
  none: "#22c55e",
  low: "#84cc16",
  medium: "#f59e0b",
  high: "#f97316",
  extreme: "#ef4444",
} as const;

export type DuplicationLevel = keyof typeof DUPLICATION_COLORS;

export const DUPLICATION_LABELS: Record<DuplicationLevel, string> = {
  none: "insight.dup.none",
  low: "insight.dup.low",
  medium: "insight.dup.medium",
  high: "insight.dup.high",
  extreme: "insight.dup.extreme",
};

/**
 * 重复率分级
 *
 * 阈值以 SonarQube 默认质量阈的 3% 重复率告警线为起点逐档放大：
 * ≤3% 可接受 / ≤10% 轻度 / ≤25% 中度 / ≤50% 重度 / >50% 几乎是复制品。
 */
export function duplicationLevelOf(ratio: number): DuplicationLevel {
  if (ratio <= 0.03) return "none";
  if (ratio <= 0.1) return "low";
  if (ratio <= 0.25) return "medium";
  if (ratio <= 0.5) return "high";
  return "extreme";
}

/** 默认画像（无数据时的兜底值） */
export function emptyFileInsight(): FileInsight {
  return {
    symbolCount: 0,
    patternNames: [],
    refCount: 0,
    complexity: 1,
    complexityLevel: "low",
    complexityEngine: undefined,
    syntaxErrorCount: 0,
    syntaxErrorLines: [],
    symbolNames: [],
    techDebtCount: 0,
    techDebtMarkers: [],
    churnScore: 0,
    churnLevel: "low",
    commitCount: 0,
    authorCount: 0,
    callOut: 0,
    callIn: 0,
    deadCount: 0,
    cloneCount: 0,
    cloneType2Count: 0,
    duplicatedLines: 0,
    duplicationRatio: 0,
    quadrant: "healthy",
    findingCount: 0,
    riskScore: 0,
    findingSeverities: { error: 0, warning: 0, info: 0 },
  };
}

/**
 * 聚合全部文件的分析数据 → fileId → FileInsight
 * @param files 扫描文件列表
 * @param symbols 符号索引（含 fileId）
 * @param patternHits 设计模式命中（按 filePath 匹配）
 * @param symbolRefs 符号级引用（按 toFileId 统计入向引用）
 * @param metrics 文件度量（按 fileId 匹配）
 */
export function buildFileInsights(
  files: ProjectFile[],
  symbols: ProjectSymbol[],
  patternHits: PatternHit[],
  symbolRefs: ProjectSymbolRef[],
  metrics: FileMetric[],
  techDebt?: TechDebtItem[],
  gitChurn?: GitChurn[],
  callEdges?: CallEdge[],
  deadSymbols?: DeadSymbol[],
  findings?: ReviewFinding[],
  clones?: CodeClone[]
): Map<string, FileInsight> {
  const map = new Map<string, FileInsight>();

  // 符号按 fileId 聚合
  const symbolsByFile = new Map<string, ProjectSymbol[]>();
  for (const s of symbols) {
    const arr = symbolsByFile.get(s.fileId) || [];
    arr.push(s);
    symbolsByFile.set(s.fileId, arr);
  }

  // 设计模式按 filePath 聚合（去重，保留中文名）
  const patternsByPath = new Map<string, Set<string>>();
  for (const hit of patternHits) {
    const set = patternsByPath.get(hit.filePath) || new Set<string>();
    set.add(patternLabel(hit.pattern));
    patternsByPath.set(hit.filePath, set);
  }

  // 入向引用按 toFileId 聚合
  const refsByFile = new Map<string, number>();
  for (const r of symbolRefs) {
    if (!r.toFileId) continue;
    refsByFile.set(r.toFileId, (refsByFile.get(r.toFileId) || 0) + 1);
  }

  // 度量按 fileId 索引
  const metricByFile = new Map<string, FileMetric>();
  for (const m of metrics) {
    metricByFile.set(m.fileId, m);
  }

  // 技术债按 fileId 聚合（标记类型去重）
  const debtByFile = new Map<string, { count: number; markers: Set<string> }>();
  for (const d of techDebt ?? []) {
    const e = debtByFile.get(d.fileId) || { count: 0, markers: new Set<string>() };
    e.count += 1;
    e.markers.add(d.marker);
    debtByFile.set(d.fileId, e);
  }

  // git 变更热点按 fileId 索引
  const churnByFile = new Map<string, GitChurn>();
  for (const c of gitChurn ?? []) {
    churnByFile.set(c.fileId, c);
  }

  // 调用边按文件聚合出度 / 入度
  const callOutByFile = new Map<string, number>();
  const callInByFile = new Map<string, number>();
  for (const e of callEdges ?? []) {
    callOutByFile.set(e.callerFileId, (callOutByFile.get(e.callerFileId) || 0) + 1);
    callInByFile.set(e.calleeFileId, (callInByFile.get(e.calleeFileId) || 0) + 1);
  }

  // 死代码按 fileId 计数
  const deadByFile = new Map<string, number>();
  for (const d of deadSymbols ?? []) {
    deadByFile.set(d.fileId, (deadByFile.get(d.fileId) || 0) + 1);
  }

  // 代码克隆按 fileId 聚合：块数 + 去重后的重复行数
  //
  // 去重的必要性：同一段代码可能同时属于多个克隆组（例如 A 段既和 B 重复、
  // 又和 C 的一个子片段重复），直接把 lineCount 相加会让重复率超过 100%。
  // 这里用「行号集合」做并集，保证 duplicatedLines ≤ 文件实际行数。
  const cloneByFile = new Map<string, { count: number; lines: Set<number>; type2: number }>();
  for (const c of clones ?? []) {
    const e = cloneByFile.get(c.fileId) || { count: 0, lines: new Set<number>(), type2: 0 };
    e.count += 1;
    if (c.cloneType === "type2") e.type2 += 1;
    for (let ln = c.startLine; ln <= c.endLine; ln++) e.lines.add(ln);
    cloneByFile.set(c.fileId, e);
  }

  // 审查发现按 targetId（文件）聚合严重度 —— 风险画像的数据源
  const riskByFile = new Map<string, { error: number; warning: number; info: number }>();
  for (const fd of findings ?? []) {
    if (fd.targetType && fd.targetType !== "file") continue;
    const cur = riskByFile.get(fd.targetId) || { error: 0, warning: 0, info: 0 };
    cur[normalizeSeverity(fd.severity)] += 1;
    riskByFile.set(fd.targetId, cur);
  }

  for (const f of files) {
    if (f.isDirectory) continue;
    const fileSymbols = symbolsByFile.get(f.id) || [];
    const metric = metricByFile.get(f.id);
    const cc = metric?.cyclomaticComplexity ?? 1;
    const debt = debtByFile.get(f.id);
    const churn = churnByFile.get(f.id);
    const complexityLevel = metric
      ? (metric.complexityLevel as FileInsight["complexityLevel"])
      : complexityLevelOf(cc);
    const churnLevel = churn
      ? (churn.hotspotLevel as FileInsight["churnLevel"])
      : churnLevelOf(0);
    const sev = riskByFile.get(f.id) ?? { error: 0, warning: 0, info: 0 };
    const clone = cloneByFile.get(f.id);
    const dupLines = clone?.lines.size ?? 0;
    const baseLines = metric?.codeLines || f.lineCount || 0;
    const dupRatio = baseLines > 0 ? Math.min(1, dupLines / baseLines) : 0;
    map.set(f.id, {
      symbolCount: fileSymbols.length,
      patternNames: Array.from(patternsByPath.get(f.relPath) || []),
      refCount: refsByFile.get(f.id) || 0,
      complexity: cc,
      complexityLevel,
      complexityEngine: metric?.engine === "ast" ? "ast" : metric ? "heuristic" : undefined,
      syntaxErrorCount: metric ? (parseFileMetricMeta(metric).errorLines ?? []).length : 0,
      syntaxErrorLines: metric ? (parseFileMetricMeta(metric).errorLines ?? []) : [],
      symbolNames: fileSymbols.slice(0, 8).map((s) => s.name),
      techDebtCount: debt?.count ?? 0,
      techDebtMarkers: Array.from(debt?.markers ?? []),
      churnScore: churn?.churnScore ?? 0,
      churnLevel,
      commitCount: churn?.commitCount ?? 0,
      authorCount: churn?.authorCount ?? 0,
      callOut: callOutByFile.get(f.id) || 0,
      callIn: callInByFile.get(f.id) || 0,
      deadCount: deadByFile.get(f.id) || 0,
      cloneCount: clone?.count ?? 0,
      cloneType2Count: clone?.type2 ?? 0,
      duplicatedLines: dupLines,
      duplicationRatio: dupRatio,
      quadrant: quadrantOf(complexityLevel, churnLevel),
      findingCount: sev.error + sev.warning + sev.info,
      riskScore:
        sev.error * SEVERITY_WEIGHT.error +
        sev.warning * SEVERITY_WEIGHT.warning +
        sev.info * SEVERITY_WEIGHT.info,
      findingSeverities: sev,
    });
  }
  return map;
}
