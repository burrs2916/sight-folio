// sight-folio: 技术债量化评分（需求点 C，纯前端聚合，零后端成本）
//
// 对标 SonarQube 的 SQALE 模型：不满足于「有 N 处 TODO」，而是按严重度折算
// 「预计清偿工时」，让技术债变成一个可决策的数字（该不该还、先还哪）。
//
// 折算口径（对齐常见 SQALE 实践，可调）：
// - critical（FIXME/HACK 高危）≈ 2 人时/处
// - warning（TODO/XXX 中危）≈ 0.5 人时/处
// - info（OPTIMIZE/DEPRECATED 低危）≈ 0.1 人时/处
//
// 纯函数、无副作用，便于单测与在三处（画像 toast / 面板 / 报告）复用。

import type { TechDebtItem } from "../../services/tauri";
import { L } from "../../ai/aiLang";

/** 严重度 → 单处修复工时（人时） */
export const DEBT_HOURS_BY_SEVERITY: Record<string, number> = {
  critical: 2,
  warning: 0.5,
  info: 0.1,
};

/** 默认严重度（后端未标注时兜底） */
const DEFAULT_SEVERITY = "warning";

export function hoursOf(item: Pick<TechDebtItem, "severity">): number {
  return DEBT_HOURS_BY_SEVERITY[item.severity] ?? DEBT_HOURS_BY_SEVERITY[DEFAULT_SEVERITY];
}

export interface TechDebtSummary {
  /** 技术债标记总数 */
  count: number;
  /** 预计清偿总工时（人时，保留 1 位小数） */
  hours: number;
  /** 按严重度分布 */
  bySeverity: Record<string, number>;
  /** 按标记类型分布 */
  byMarker: Record<string, number>;
  /** 技术债最多的文件 Top N（按工时降序） */
  topFiles: { fileId: string; filePath: string; count: number; hours: number }[];
}

/** 聚合技术债清单 → 可解释的量化摘要 */
export function summarizeTechDebt(items: TechDebtItem[], topN = 5): TechDebtSummary {
  const bySeverity: Record<string, number> = {};
  const byMarker: Record<string, number> = {};
  const byFile = new Map<string, { fileId: string; filePath: string; count: number; hours: number }>();

  for (const item of items) {
    const sev = item.severity || DEFAULT_SEVERITY;
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    byMarker[item.marker] = (byMarker[item.marker] ?? 0) + 1;
    const cur = byFile.get(item.fileId) ?? {
      fileId: item.fileId,
      filePath: item.filePath,
      count: 0,
      hours: 0,
    };
    cur.count += 1;
    cur.hours += hoursOf(item);
    byFile.set(item.fileId, cur);
  }

  const hours = Math.round(Array.from(byFile.values()).reduce((acc, f) => acc + f.hours, 0) * 10) / 10;
  const topFiles = Array.from(byFile.values())
    .sort((a, b) => b.hours - a.hours)
    .slice(0, topN)
    .map((f) => ({ ...f, hours: Math.round(f.hours * 10) / 10 }));

  return { count: items.length, hours, bySeverity, byMarker, topFiles };
}

/** 人时 → 人话（1.2 → 「约 1.2 人时」；≥8 → 「约 1 人日」） */
export function formatDebtHours(hours: number): string {
  if (hours <= 0) return L("无", "none");
  if (hours < 8) return L(`约 ${Math.round(hours * 10) / 10} 人时`, `≈ ${Math.round(hours * 10) / 10} person-hours`);
  return L(`约 ${Math.round((hours / 8) * 10) / 10} 人日`, `≈ ${Math.round((hours / 8) * 10) / 10} person-days`);
}
