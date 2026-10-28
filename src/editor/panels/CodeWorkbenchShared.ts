/** CodeWorkbench 共享逻辑：引用数据模型与符号重命名总线（无 React/MUI 依赖）。 */

/** 查找引用结果项（合并 symbolRefs 与 callEdges 去重后） */
export interface UsageHit {
  fileId: string;
  filePath: string;
  line: number;
  text: string;
  kind: string;
}

/** 引用结果按文件分组的呈现单元（对标 Zed find_all_references 的多缓冲分组） */
export interface UsageGroup {
  fileId: string;
  label: string;
  count: number;
  items: UsageHit[];
}

/** 重命名目标：一个 (文件, 行) 定位点（行级精度，匹配我们 symbolRefs 数据现实） */
export interface RenameTarget {
  fileId: string;
  filePath: string;
  line: number;
}

/** 转义正则特殊字符（符号名可能含 $ 等） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在单行内按词边界把旧名替换为新名（对标 Zed perform_rename 的精确范围改写，
 *  我们无列精度，退化为「整行词边界全替换」——同一行内该符号的每次出现都重命名）。
 *  返回改写后的文本与替换次数，未命中则 text 不变、count=0。 */
export function replaceWordOnLine(
  line: string,
  oldName: string,
  newName: string,
): { text: string; count: number } {
  if (!oldName) return { text: line, count: 0 };
  const re = new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");
  let count = 0;
  const text = line.replace(re, () => {
    count++;
    return newName;
  });
  return { text, count };
}

/**
 * 符号重命名提交事件总线（模块级）。
 * 生产方：CodeWorkbenchBody.confirmRename 写盘成功后 emit(oldName, newName)。
 * 消费方：EditorPane 的引用抽屉订阅，乐观刷新（标题/预览/懒读缓存切到新名）。
 * 解耦两个组件作用域，避免把引用面板状态上移或 prop 层层透传（零回归）。
 */
export type SymbolRenamedListener = (oldName: string, newName: string) => void;
export const symbolRenamedListeners = new Set<SymbolRenamedListener>();
export function emitSymbolRenamed(oldName: string, newName: string) {
  for (const l of symbolRenamedListeners) l(oldName, newName);
}
export function onSymbolRenamed(listener: SymbolRenamedListener): () => void {
  symbolRenamedListeners.add(listener);
  return () => {
    symbolRenamedListeners.delete(listener);
  };
}
