/**
 * 技术债量化评分（SQALE 式偿还工时模型）
 *
 * 现状问题：扫描出 800 个 TODO、120 个高复杂度文件、40 个死代码符号之后，
 * 用户依然不知道「这个项目到底有多烂」「先修哪个」。计数是事实，不是判断。
 *
 * 本模块把各类问题按**预估偿还工时**折算成统一量纲，再除以代码规模得到
 * 技术债比率（Technical Debt Ratio, TDR），最终给出 A~E 评级：
 *
 *   TDR = 偿还总工时 / 开发总工时
 *   开发总工时 = 代码行数 × 每行开发成本（默认 0.06 工时/行 ≈ 每天 130 行有效产出）
 *
 * 评级阈值沿用 SQALE 业界惯例：
 *   A ≤ 5%   B ≤ 10%   C ≤ 20%   D ≤ 50%   E > 50%
 *
 * 所有系数集中在 EFFORT 常量里，是**可争论的工程估计**而非物理常数，
 * 调整时请连同这段注释一起更新，不要在调用处散落魔法数字。
 */

import type {
  TechDebtItem,
  FileMetric,
  DeadSymbol,
  ReviewFinding,
  ProjectFile,
} from "../services/tauri";

/** 各类问题的单件偿还工时（小时） */
export const EFFORT = {
  /** FIXME / HACK：往往是明确的坏味道，需要真正动代码 */
  markerCritical: 2,
  /** OPTIMIZE / DEPRECATED：改动范围可控 */
  markerWarning: 0.5,
  /** TODO / XXX：多数是备忘，成本低 */
  markerInfo: 0.15,
  /** 圈复杂度 extreme（>20）的文件：需要拆函数 */
  complexityExtreme: 4,
  /** 圈复杂度 high（11~20）的文件 */
  complexityHigh: 1.5,
  /** 高置信度死代码符号：确认 + 删除 + 回归 */
  deadHigh: 0.5,
  /** 中置信度死代码符号：需要人工确认是否对外 API */
  deadMedium: 0.25,
  /** 审查发现 critical */
  findingCritical: 3,
  /** 审查发现 warning */
  findingWarning: 0.75,
  /** 每行代码的开发成本（工时），用于折算 TDR 分母 */
  costPerLine: 0.06,
} as const;

export type DebtGrade = "A" | "B" | "C" | "D" | "E";

export interface DebtBreakdownItem {
  /** 分类 key */
  key: string;
  /** 中文标签 */
  label: string;
  /** 问题件数 */
  count: number;
  /** 该分类偿还工时（小时） */
  hours: number;
}

export interface TechDebtScore {
  /** 偿还总工时（小时，保留 1 位小数） */
  totalHours: number;
  /** 折算人天（按 8 小时） */
  totalDays: number;
  /** 技术债比率 0~1 */
  ratio: number;
  /** 评级 A~E */
  grade: DebtGrade;
  /** 参与计算的代码行数 */
  totalLines: number;
  /** 分类明细（按工时降序） */
  breakdown: DebtBreakdownItem[];
  /** 问题总件数 */
  totalIssues: number;
}

/** 评级 → 配色（画布 / 报告统一口径） */
export const GRADE_COLORS: Record<DebtGrade, string> = {
  A: "#22c55e",
  B: "#84cc16",
  C: "#f59e0b",
  D: "#f97316",
  E: "#ef4444",
};

/** 评级 → 一句话结论 */
export const GRADE_LABELS: Record<DebtGrade, string> = {
  A: "债务可忽略，保持现状",
  B: "债务轻微，按迭代顺手清理",
  C: "债务中等，建议排入专项",
  D: "债务较重，需要重构预算",
  E: "债务失控，优先止血",
};

export function gradeOf(ratio: number): DebtGrade {
  if (ratio <= 0.05) return "A";
  if (ratio <= 0.1) return "B";
  if (ratio <= 0.2) return "C";
  if (ratio <= 0.5) return "D";
  return "E";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface DebtScoreInput {
  files: ProjectFile[];
  metrics: FileMetric[];
  techDebt: TechDebtItem[];
  deadSymbols: DeadSymbol[];
  findings: ReviewFinding[];
}

/**
 * 计算技术债评分
 *
 * 代码行数优先取 metrics 的 codeLines（排除空行注释更准），
 * 没有度量数据时退化用 files 的 lineCount。
 */
export function computeTechDebtScore(input: DebtScoreInput): TechDebtScore {
  const { files, metrics, techDebt, deadSymbols, findings } = input;

  // ── 分母：代码规模 ──
  let totalLines = metrics.reduce((sum, m) => sum + (m.codeLines || 0), 0);
  if (totalLines === 0) {
    totalLines = files.filter((f) => !f.isDirectory).reduce((sum, f) => sum + (f.lineCount || 0), 0);
  }

  // ── 分子：各类问题工时 ──
  const markerCritical = techDebt.filter((d) => d.severity === "critical").length;
  const markerWarning = techDebt.filter((d) => d.severity === "warning").length;
  const markerInfo = techDebt.filter((d) => d.severity === "info").length;

  const ccExtreme = metrics.filter((m) => m.complexityLevel === "extreme").length;
  const ccHigh = metrics.filter((m) => m.complexityLevel === "high").length;

  const deadHigh = deadSymbols.filter((d) => d.confidence === "high").length;
  const deadMedium = deadSymbols.filter((d) => d.confidence === "medium").length;

  // 死代码 finding 已在 deadSymbols 中计过，避免双算
  const openFindings = findings.filter(
    (f) => f.status === "open" && f.ruleId !== "rule_dead_symbol"
  );
  const findingCritical = openFindings.filter((f) => f.severity === "critical").length;
  const findingWarning = openFindings.filter((f) => f.severity === "warning").length;

  const raw: DebtBreakdownItem[] = [
    { key: "markerCritical", label: "FIXME / HACK 标记", count: markerCritical, hours: markerCritical * EFFORT.markerCritical },
    { key: "markerWarning", label: "OPTIMIZE / DEPRECATED 标记", count: markerWarning, hours: markerWarning * EFFORT.markerWarning },
    { key: "markerInfo", label: "TODO / XXX 标记", count: markerInfo, hours: markerInfo * EFFORT.markerInfo },
    { key: "complexityExtreme", label: "极高复杂度文件（CC>20）", count: ccExtreme, hours: ccExtreme * EFFORT.complexityExtreme },
    { key: "complexityHigh", label: "高复杂度文件（CC 11~20）", count: ccHigh, hours: ccHigh * EFFORT.complexityHigh },
    { key: "deadHigh", label: "死代码（高置信）", count: deadHigh, hours: deadHigh * EFFORT.deadHigh },
    { key: "deadMedium", label: "死代码（待确认）", count: deadMedium, hours: deadMedium * EFFORT.deadMedium },
    { key: "findingCritical", label: "审查违规（严重）", count: findingCritical, hours: findingCritical * EFFORT.findingCritical },
    { key: "findingWarning", label: "审查违规（警告）", count: findingWarning, hours: findingWarning * EFFORT.findingWarning },
  ];

  const breakdown = raw
    .filter((b) => b.count > 0)
    .map((b) => ({ ...b, hours: round1(b.hours) }))
    .sort((a, b) => b.hours - a.hours);

  const totalHours = round1(raw.reduce((sum, b) => sum + b.hours, 0));
  const devHours = totalLines * EFFORT.costPerLine;
  const ratio = devHours > 0 ? Math.min(totalHours / devHours, 1) : 0;

  return {
    totalHours,
    totalDays: round1(totalHours / 8),
    ratio,
    grade: gradeOf(ratio),
    totalLines,
    breakdown,
    totalIssues: raw.reduce((sum, b) => sum + b.count, 0),
  };
}

/** 空评分（无数据时的兜底） */
export function emptyTechDebtScore(): TechDebtScore {
  return {
    totalHours: 0,
    totalDays: 0,
    ratio: 0,
    grade: "A",
    totalLines: 0,
    breakdown: [],
    totalIssues: 0,
  };
}
