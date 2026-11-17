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
 * 体裁 → 结构语言（**唯一**判据）。
 *
 * 为什么重写成一张表：旧实现是 `poetry || script` 一起混给 essay 的 `['篇','节']`，
 * 那是"当年不报错的兜底"而不是设计（2026-11-09 李先生：诗歌、剧本这两个题材都没实现，
 * 看看如何提升）。一张表把两个字段摆在一起，谁再加体裁就必须同时想清楚顶层与下钻链。
 *
 * - `root`：「零配置起步」点新建时给顶层节点的层级名。它**不等于 `levels[0]`**：
 *   诗的本体单位是「首」，「辑」只是可选分组层。照抄 `levels[0]` 会得到「顶层=辑」，
 *   一首诗被挂上容器层级名，而容器词表（`writingStats.STRUCTURE_KINDS` 只认「卷」）
 *   会把空的「辑」计成一章 —— 名词错了还会污染统计。
 *   小说 / 散文沿用历史值（卷 / 篇），逐字不变 = 零回归。
 * - `levels`：「加子级」的默认建议链（非约束，作者可任意改名 / 越级）。
 *   剧本的 幕 / 场 于 2026-11-09 开闸（⑮-2a）：`writingSchema.script.ready = true`，
 *   术语全链 / 页签裁剪 / 货架 / 斜杠命令 / 人设都已按戏剧配齐；**仍未做**的是正文排版
 *   （角色名、台词缩进、舞台指示样式 —— 属承载层，等李先生点头）。（审计文档 §1 记录的是开闸前状态。）
 */
// root = 「零配置起步」那个顶层节点该是什么，⑱ 起统一取**可写单位**，不取容器层：
//   novel 章（不是卷）、script 场（不是幕）、essay 篇、poetry 首。
// 理由不是好看：`contentChapters` 用 `isVolumeNode`（kind==='卷' 或有子级）排除容器，
// 而新建书的第一个节点用的就是这个 root —— 取容器层会得到一个「有正文的卷」，
// 统计里**章节数算 0**（活证据：库里 `新建作品 2` 的唯一节点 kind=卷、标题却是「第 1 章」）。
// levels 不变：作者仍能用「加子级」建 卷 / 幕 / 辑。
const GENRE_STRUCTURE: Record<string, { root: string; levels: string[] }> = {
  novel: { root: '章', levels: ['卷', '章'] },
  essay: { root: '篇', levels: ['篇', '节'] },
  poetry: { root: '首', levels: ['辑', '首'] },
  script: { root: '场', levels: ['幕', '场'] },
  // 日记（2026-11-10）：作者定的是「年 › 月 › 天」。root 仍取**可写单位**「天」而不是「年」——
  // 理由与 18 号那条裁定一字不差：新建书第一个节点用的就是这个 root，给容器层会得到一个
  // 「有正文的年」，`isVolumeNode` 把它当分组排除，统计里日记天数直接算 0。年与月留在 levels 里，
  // 作者要分就分、不分就平铺（levels 只是「加子级」的建议链，不是约束）。
  diary: { root: '天', levels: ['年', '月', '天'] },
};

/** 未指定 / 未知体裁回落小说（历史书 `genre=''` 的零回归路径）。 */
function structureOf(genre: string): { root: string; levels: string[] } {
  return GENRE_STRUCTURE[genre] ?? GENRE_STRUCTURE.novel;
}

/**
 * 「零配置起步」新建**顶层**节点时的层级名（= 该体裁的**可写单位**，见上面 root 的注释；⑱）。
 * 前端（writingStore.createChapter）与 Rust（ai_agent/tools.rs 的 default_root_kind）
 * 必须同一口径，否则 AI 建的节点和用户手点的节点会是两套层级命名。
 */
export function defaultRootKind(genre: string): string {
  return structureOf(genre).root;
}

/**
 * 按体裁给的默认层级词汇表（仅作「加子级」的默认建议，非约束）。
 * 小说：卷 › 章；散文：篇 › 节；诗歌：辑 › 首；剧本：幕 › 场；日记：年 › 月 › 天。
 */
export function defaultLevels(genre: string): string[] {
  return structureOf(genre).levels;
}

/** 给定父节点的 kind 与它在树中的深度，推测「加子级」应给的默认层级名。 */
export function suggestedChildKind(parentKind: string, _depth: number, levels: string[]): string {
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
 * 树先序索引表（id → { index, depth }）：与大纲树同构的扁平呈现（如灵感念头按绑定章节
 * 排成树序）共用。index = 该节点在「根 → 深 → 平」先序遍历中的次序（0 起），故绑定同一
 * 章节的实体天然聚在同一层；depth 与 buildTree 同源。禁第二份实现。
 */
export function forestPreorderIndex(forest: TreeNode[]): Map<string, { index: number; depth: number }> {
  const out = new Map<string, { index: number; depth: number }>();
  let i = 0;
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      out.set(n.node.id, { index: i++, depth: n.depth });
      walk(n.children);
    }
  };
  walk(forest);
  return out;
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
