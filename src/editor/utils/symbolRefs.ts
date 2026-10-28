// sight-folio: 符号级引用索引工具
// 将后端 project_symbol_refs（引用边列表）聚合为「符号 → 引用点」映射，
// 供左侧实体面板展示被引用计数与引用点列表。纯函数，便于单元测试。
import type { ProjectSymbolRef } from "../../services/tauri";

/**
 * 按被引用符号分组引用点（to_symbol_id 命中者），并按文件+行号去重
 * （同一文件同一行多次 import 同一符号只算一个引用点）。
 * @returns Map<symbolId, ProjectSymbolRef[]>
 */
export function groupRefsBySymbol(refs: ProjectSymbolRef[]): Map<string, ProjectSymbolRef[]> {
  const map = new Map<string, ProjectSymbolRef[]>();
  for (const r of refs) {
    if (!r.toSymbolId) continue;
    const arr = map.get(r.toSymbolId) || [];
    arr.push(r);
    map.set(r.toSymbolId, arr);
  }
  // 去重：同一引用文件 + 同一行 + 同一符号名只保留一条
  for (const [k, arr] of map) {
    const seen = new Set<string>();
    const deduped: ProjectSymbolRef[] = [];
    for (const r of arr) {
      const key = `${r.fromFileId}:${r.refLine}:${r.symbolName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    map.set(k, deduped);
  }
  return map;
}

/**
 * 统计符号被引用次数（去重后）
 */
export function countRefsForSymbol(refsBySymbol: Map<string, ProjectSymbolRef[]>, symbolId: string): number {
  return refsBySymbol.get(symbolId)?.length ?? 0;
}

/** 引用点显示摘要（截断原文） */
export function refTextSummary(text: string, max = 44): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
