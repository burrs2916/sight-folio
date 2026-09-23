/** CodeWorkbench 大纲工具：symbol 标签/颜色与大纲树构建（无 JSX）。 */

import { t } from "../../i18n";

import { parseFileMetricMeta, projectScanApi, type FileChangeEvent, type ProjectFile, type ProjectSymbol } from "../../services/tauri";

import { fuzzyScore } from "./CodeWorkbenchTree";

/** 符号 kind → 短标签（大纲行首徽标）。getter 而非模块级 const：
 *   const 会在模块加载时固化中文（切语言不刷新，历史教训 ×3）。 */
export function symbolKindLabel(kind: string): string {
  const label = t(`workbench.symbolKind.${kind}`);
  // t() 对未知 key 返回 key 本身 → 用带前缀的 key 判断是否命中
  return label !== `workbench.symbolKind.${kind}` ? label : kind;
}

/** 符号 kind → 着色（按类别，与语言着色区分） */
export function symbolKindColor(kind: string): string {
  switch (kind) {
    case "class":
    case "interface":
    case "struct":
    case "enum":
    case "type":
      return "#a371f7";
    case "function":
    case "method":
    case "constructor":
      return "#3fb950";
    case "module":
    case "namespace":
      return "#d29922";
    case "variable":
    case "const":
    case "let":
    case "field":
    case "property":
      return "#58a6ff";
    default:
      return "#8b949e";
  }
}

/** 大纲符号树节点（按 lineStart/lineEnd 包含关系推导层级，对标 Zed outline 的嵌套结构） */
export interface OutlineNode {
  sym: ProjectSymbol;
  children: OutlineNode[];
  depth: number;
}

/** 大纲「按类型聚类」视图的 kind 稳定排序（类型 → 函数 → 模块 → 变量 → 其它），让聚类分组顺序可预期 */
export const KIND_ORDER = [
  "class", "interface", "struct", "enum", "type",
  "function", "method", "constructor",
  "module", "namespace",
  "variable", "const", "let", "field", "property",
  "unknown",
];
export function kindSortIndex(kind: string): number {
  const i = KIND_ORDER.indexOf(kind || "unknown");
  return i < 0 ? KIND_ORDER.length : i;
}

/**
 * 由平铺符号列表推导嵌套大纲：子符号的 [lineStart,lineEnd] 落在其父符号范围内即视为嵌套。
 * 排序先按 lineStart 升序、同行再按 lineEnd 降序，保证更宽（更外层）的符号先入栈成为父节点。
 * 栈式算法：每处理一个符号，先把「不再包含它」的栈顶弹出，剩余栈顶即其最近父节点。
 */
export function buildOutlineTree(symbols: ProjectSymbol[]): OutlineNode[] {
  const sorted = symbols
    .slice()
    .sort((a, b) => a.lineStart - b.lineStart || b.lineEnd - a.lineEnd);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const sym of sorted) {
    const node: OutlineNode = { sym, children: [], depth: 0 };
    while (stack.length) {
      const top = stack[stack.length - 1];
      const contained =
        top.sym.lineStart <= sym.lineStart &&
        sym.lineEnd <= top.sym.lineEnd &&
        !(top.sym.lineStart === sym.lineStart && top.sym.lineEnd === sym.lineEnd);
      if (contained) break;
      stack.pop();
    }
    if (stack.length) {
      const parent = stack[stack.length - 1];
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/** 深度优先收集子树全部节点（含根），用于「全部展开/折叠」与过滤。 */
export function collectOutlineNodes(nodes: OutlineNode[], acc: OutlineNode[] = []): OutlineNode[] {
  for (const n of nodes) {
    acc.push(n);
    if (n.children.length) collectOutlineNodes(n.children, acc);
  }
  return acc;
}

/** 子树最佳模糊命中分（用于排序：命中越靠前/越连续越优先，贴近 Zed picker 体验）。 */
export function outlineNodeBestScore(n: OutlineNode, q: string): number {
  const self = fuzzyScore(n.sym.name, q) ?? -Infinity;
  let best = self;
  for (const c of n.children) best = Math.max(best, outlineNodeBestScore(c, q));
  return best;
}

/** 递归模糊剪枝 + 排序（对标 Zed outline/picker 的模糊评分过滤，05:00 待续③）：
 *  保留「自身命中」或「含命中后代」的节点（自动展开匹配分支），并对每层按子树最佳分降序、
 *  同行按行号升序排序，使最相关符号排在顶部，而非原始出现顺序。 */
export function filterOutlineTree(nodes: OutlineNode[], q: string): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const n of nodes) {
    const self = fuzzyScore(n.sym.name, q);
    const kids = filterOutlineTree(n.children, q);
    if (self != null || kids.length) out.push({ ...n, children: kids });
  }
  out.sort(
    (a, b) =>
      outlineNodeBestScore(b, q) - outlineNodeBestScore(a, q) || a.sym.lineStart - b.sym.lineStart,
  );
  return out;
}
