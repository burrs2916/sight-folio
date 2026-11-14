// 导出取数口径（写作台「另存为」六格式共用）。
//
// 为什么单独一个模块：完结作品页的快照导出在 Rust 侧按 `kind + parent_id` 重建目录树，
// 而写作台这条路是前端把章节传给后端渲染器。两侧必须同一个口径，否则「从成品页导出
// 有卷、从写作台导出没卷」这种二义性会一直留着（本次修的就是它）。
//
// 三条死口径：
//  1. **顺序 = 目录树先序**（父紧跟子），不是按 sort_order 扁平排。sort_order 只是
//     「同父兄弟内」的序，跨父级不可比 —— 扁平排会把卷整堆在最前面。
//  2. **容器判据复用 writingStats.isVolumeNode**（kind ∈ {卷,篇} 或确有子级），
//     禁在这里另写一份。
//  3. **旧模型书（全书无 parentId）走遗留 volume 字符串**，不带 depth/isVolume，
//     让后端留在历史渲染分支上，产物与改动前一致。
import type { WritingChapter } from '../services/tauri';
import { buildTree, type TreeNode } from './writingTree';
import { resolveVolumeResolver, isVolumeNode } from './writingStats';
import { parseChapterCover } from './writingOutline';

/** 传给后端导出器的一节（结构书带 kind/depth/isVolume，旧模型书带 volume 字符串）。 */
export interface ExportNode {
  title: string;
  content: string;
  /** 章/卷各自的封面相对引用（extra.coverImage）；无则 null。绝不向上借图。 */
  cover: string | null;
  /** 仅旧模型书：遗留卷名字符串（'' = 未分卷）。结构书不给这个字段。 */
  volume?: string;
  /** 仅结构书：层级名（部/卷/章/节…）。 */
  kind?: string;
  /** 仅结构书：树深度（根 = 0）。 */
  depth?: number;
  /** 仅结构书：是否容器节点（卷/篇/部），容器渲染成卷页而非内容章。 */
  isVolume?: boolean;
}

/**
 * 章节表 → 导出序列（先序 + 层级）。
 *
 * 输入是 store 里的扁平 `chapters`（调用方负责先 flush 未保存改动），
 * 输出顺序与左栏目录树 / 大纲树**从上到下看到的顺序**一致。
 */
export function flattenForExport(chapters: WritingChapter[]): ExportNode[] {
  const resolver = resolveVolumeResolver(chapters);
  const forest = buildTree(chapters);
  // legacy = 全书没有任何 parentId：老书写法，卷靠 volume 字符串表达
  const legacy = resolver.legacy;
  const out: ExportNode[] = [];

  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const n of nodes) {
      const node = n.node;
      const base: ExportNode = {
        title: node.title,
        content: node.content || '',
        cover: parseChapterCover(node.extra) ?? null,
      };
      if (legacy) {
        out.push({ ...base, volume: node.volume || '' });
      } else {
        out.push({
          ...base,
          kind: node.kind || '',
          depth,
          isVolume: isVolumeNode(resolver, node),
        });
      }
      walk(n.children, depth + 1);
    }
  };

  walk(forest, 0);
  return out;
}

/** 结构书里容器（卷）节点在纯文本里的分隔行，与后端 txt 渲染同口径。 */
export function volumeRuleForText(name: string, depth: number): string {
  const rule = depth <= 0 ? '════' : depth === 1 ? '────' : '····';
  return `${rule} ${name} ${rule}`;
}
