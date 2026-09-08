import type {
  ProjectFile,
  ProjectModule,
  ProjectDependency,
  ProjectLayer,
  ReviewFinding,
  ProjectSymbol,
  ProjectSymbolRef,
  PatternHit,
  FileMetric,
  TechDebtItem,
  CodeClone,
  DeadSymbol,
  GitChurn,
  CallEdge,
  CallGraphSummary,
  ChangeCoupling,
  DataFlowSummary,
} from "../../services/tauri";
import type { AiContextSection } from "../contextTypes";
import { estimateTokens } from "../tokenBudget";
import { L } from "../aiLang";

/**
 * 项目扫描 → AI 上下文分节构建器。
 *
 * 核心取舍：**给结论与排序，不给原始明细**。
 * 14 阶段扫描的原始行数动辄十万级，全量塞给 Agent 既烧 token 又淹没重点。
 * 这里每个分节都遵循同一套规则：
 *   1. 先给聚合口径（总量、分布、比例）——让 Agent 知道全貌，不必自己数；
 *   2. 再给 Top N 明细（按风险/影响排序）——让 Agent 直接落到该看的地方；
 *   3. 明细一律带 `文件:行号`，Agent 需要细节时用 file_read / code_search 精准取。
 * 这样一份包通常几千 token 就能覆盖一个中大型项目的全部分析维度。
 */

/** 各分节明细条目上限：够定位问题，又不至于淹没上下文 */
const TOP_N = 15;
const TOP_N_SMALL = 10;

export interface ScanSnapshot {
  files: ProjectFile[];
  modules: ProjectModule[];
  dependencies: ProjectDependency[];
  layers: ProjectLayer[];
  findings: ReviewFinding[];
  symbols: ProjectSymbol[];
  /** 符号引用边：死代码判定的前置数据，覆盖度体检据此判断「零引用」是结论还是盲区 */
  symbolRefs: ProjectSymbolRef[];
  patternHits: PatternHit[];
  metrics: FileMetric[];
  techDebt: TechDebtItem[];
  clones: CodeClone[];
  deadSymbols: DeadSymbol[];
  gitChurn: GitChurn[];
  callEdges: CallEdge[];
  callGraphSummary: CallGraphSummary | null;
  changeCoupling: ChangeCoupling[];
  dataFlowSummary: DataFlowSummary | null;
}

/** 组装一个分节，token 估算统一在这里算，避免各处漏算 */
export function makeSection(
  key: string,
  title: string,
  priority: number,
  summary: string,
  lines: string[],
  facts?: Record<string, unknown>,
): AiContextSection {
  const content = lines.filter((l) => l !== null && l !== undefined).join("\n");
  return {
    key,
    title,
    summary,
    content,
    tokenEstimate: estimateTokens(content),
    priority,
    facts,
    // 指纹与更新时间由 sectionDiff.stampSections 统一填充（单一计算点，避免各处口径不一）。
    // 这里留空值即「尚未打戳」，持久化层遇到空指纹会保守地当作变化处理。
    digest: "",
    updatedAt: 0,
  };
}

/** Markdown 表格：表头 + 行，空数据时返回提示行而不是空表 */
export function mdTable(headers: string[], rows: string[][]): string[] {
  if (rows.length === 0) return [L("_无数据_", "_no data_")];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

/** 计数聚合 */
export function countBy<T>(items: T[], keyOf: (item: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = keyOf(item);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** 把计数字典转成「键 n 条」的紧凑串，按数量降序 */
export function formatCounts(counts: Record<string, number>, limit = 12): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const shown = entries.slice(0, limit).map(([k, v]) => `${k} ${v}`);
  if (entries.length > limit) shown.push(`…另 ${entries.length - limit} 类`);
  return shown.length ? shown.join(" · ") : "无";
}

/** 截断长文本（片段/消息），避免单行撑爆上下文；同时转义竖线防止破表 */
export function cell(text: string | null | undefined, max = 80): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
