// 结构树工具（Sight Folio 大纲）
//
// 数据层只有一张扁平的 writing_chapters 表，靠 parentId 串成任意深树，kind 是创作者
// 自填的层级名（部/卷/章/节/幕/场…）。这里把扁平列表建成树，并给出「按体裁的默认层级」
// —— 默认层级只是 UI 的「加子级」建议，创作者可随时改名/越级，系统不强制一致。

import type { WritingChapter } from '../services/tauri';

export interface TreeNode {
  node: WritingChapter;
  children: TreeNode[];
  depth: number;
}

// ─── 树行缩进几何（所有消费 buildTree 的树共用同一口径）───
// 大纲树 NodeRow / 左栏目录树 / 写作台章节树必须是同一个系统，不是各画各的树。

/** 首层缩进（px）：depth=0 的行左内边距。 */
export const INDENT_BASE = 8;
/** 每深一层增加的缩进（px），也是引导线间距。 */
export const INDENT_STEP = 20;
/** 行内视觉中线（px）：elbow 横钩的 top 值。 */
export const ROW_CENTER_Y = 11;

/** 行左内边距公式（px 单位必须显式带上：模板插值不会自动加单位，「… 28」是非法 CSS）。 */
export const treeRowIndent = (depth: number): string => `${INDENT_BASE + depth * INDENT_STEP}px`;

/**
 * 按体裁给的默认层级词汇表（仅作「加子级」的默认建议，非约束）。
 * 小说：卷 › 章；散文/诗歌/剧本：篇（可再下钻节）。
 */
export function defaultLevels(genre: string): string[] {
  if (genre === 'essay' || genre === 'poetry' || genre === 'script') return ['篇', '节'];
  return ['卷', '章']; // novel 及未指定
}

/** 给定父节点的 kind 与它在树中的深度，推测「加子级」应给的默认层级名。 */
export function suggestedChildKind(parentKind: string, depth: number, levels: string[]): string {
  // 命中默认词汇表则顺延下一层；否则沿用最后一层（允许无限下钻）。
  const idx = levels.indexOf(parentKind);
  if (idx >= 0 && idx + 1 < levels.length) return levels[idx + 1];
  if (levels.length > 0) return levels[levels.length - 1];
  return '章';
}

function normParent(p: string | null | undefined): string {
  return p && p.length > 0 ? p : '';
}

/** 扁平章节列表 → 根节点数组（按 sortOrder 升序；子节点递归同序）。 */
export function buildTree(chapters: WritingChapter[]): TreeNode[] {
  const byParent = new Map<string, WritingChapter[]>();
  for (const c of chapters) {
    const p = normParent(c.parentId);
    const arr = byParent.get(p);
    if (arr) arr.push(c);
    else byParent.set(p, [c]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

  const make = (node: WritingChapter, depth: number): TreeNode => ({
    node,
    depth,
    children: (byParent.get(node.id) ?? []).map((c) => make(c, depth + 1)),
  });

  return (byParent.get('') ?? []).map((c) => make(c, 0));
}

/** 收集某节点所有后代 id（含自身）—— reparent 时防环（不能拖进自己的子树）。 */
export function descendantIds(root: TreeNode, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode) => {
    out.add(n.node.id);
    n.children.forEach(walk);
  };
  const start = findNode(root, id);
  if (start) walk(start);
  return out;
}

export function findNode(root: TreeNode, id: string): TreeNode | null {
  if (root.node.id === id) return root;
  for (const c of root.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 从根树里按 id 定位（扁平查找也行，这里走树）。 */
export function findNodeInForest(forest: TreeNode[], id: string): TreeNode | null {
  for (const r of forest) {
    const f = findNode(r, id);
    if (f) return f;
  }
  return null;
}

/**
 * 节点在结构树上的「层级路径标签」（文字封面兜底等共用）：
 * 沿根到目标节点，每层输出「kind 序号」（如 卷 1 → 章 3；序号 = 该节点在兄弟中的次序，
 * buildTree 已按 sortOrder 升序，故序数 1 起、各入口一致）。kind 为空（旧模型节点）
 * 用「章节」兜底。找不到 id 返回 null。禁第二份实现 —— 文字封面的卷章号只从这里出。
 */
export function chapterPathLabels(forest: TreeNode[], id: string): string[] | null {
  return chapterPathLabelMap(forest).get(id) ?? null;
}

/**
 * 一次性构建整树的「id → 层级路径标签」表（O(n)）：上万行的章树逐行调用
 * chapterPathLabels 会退化成 O(n²) 全树扫描，这里建表后各渲染行 O(1) 查。
 * 与 chapterPathLabels 同源同口径（后者内部即建表再查），禁第二份推导。
 */
export function chapterPathLabelMap(forest: TreeNode[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (nodes: TreeNode[], prefix: string[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const t = nodes[i];
      const label = `${t.node.kind || '章节'} ${i + 1}`;
      const path = [...prefix, label];
      out.set(t.node.id, path);
      walk(t.children, path);
    }
  };
  walk(forest, []);
  return out;
}
