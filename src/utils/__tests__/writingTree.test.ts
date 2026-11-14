// writingTree 结构树工具测试：chapterPathLabels 是文字封面兜底的「卷章号」唯一推导口径，
// 一旦分叉，各处文字封面就会显示不同的序号，所以锁成测试。
import { describe, it, expect } from 'vitest';
import {
  buildTree,
  chapterPathLabels,
  defaultLevels,
  defaultRootKind,
  forestPreorderIndex,
} from '../writingTree';
import type { WritingChapter } from '../../services/tauri';
import { WRITING_GENRES, genreDef } from '../writingSchema';

function n(id: string, parentId: string | null, kind: string, sortOrder: number): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title: id,
    content: '',
    sortOrder,
    wordCount: 0,
    status: 'draft',
    volume: '',
    parentId,
    kind,
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('chapterPathLabels（根 → 目标节点的「kind 序号」路径）', () => {
  const chapters = [
    n('v1', null, '卷', 1),
    n('c1', 'v1', '章', 1),
    n('c2', 'v1', '章', 2),
    n('c3', null, '章', 2),
    n('old', null, '', 3),
  ];
  const forest = buildTree(chapters); // 同一层按 sortOrder 升序，序号 1 起

  it('输出根到目标节点的完整路径标签（卷 1 · 章 2）', () => {
    expect(chapterPathLabels(forest, 'c2')).toEqual(['卷 1', '章 2']);
    expect(chapterPathLabels(forest, 'v1')).toEqual(['卷 1']);
  });

  it('根层节点只输出自身标签；多个根各自从 1 编号', () => {
    expect(chapterPathLabels(forest, 'c3')).toEqual(['章 2']);
    expect(chapterPathLabels(forest, 'old')).toEqual(['章节 3']);
  });

  it('找不到 id 返回 null（渲染层据此不渲染文字封面）', () => {
    expect(chapterPathLabels(forest, 'ghost')).toBeNull();
    expect(chapterPathLabels([], 'any')).toBeNull();
  });
});

describe('forestPreorderIndex（绑定章节实体按章节树先序排列的基础）', () => {
  const chapters = [n('v1', null, '卷', 1), n('c1', 'v1', '章', 1), n('c2', 'v1', '章', 2), n('c3', null, '章', 2)];
  const forest = buildTree(chapters);

  it('先序 index 与 depth 与 buildTree 同源（根 → 深 → 平）', () => {
    const idx = forestPreorderIndex(forest);
    expect(idx.get('v1')).toEqual({ index: 0, depth: 0 });
    expect(idx.get('c1')).toEqual({ index: 1, depth: 1 });
    expect(idx.get('c2')).toEqual({ index: 2, depth: 1 });
    expect(idx.get('c3')).toEqual({ index: 3, depth: 0 });
  });

  it('空树 / 未知 id → 查不到（调用方按游离念头处理）', () => {
    expect(forestPreorderIndex([]).size).toBe(0);
    expect(forestPreorderIndex(forest).get('ghost')).toBeUndefined();
  });
});

// 2026-11-09 诗歌实装：体裁结构语言从"poetry/script 混给 essay 的 ['篇','节']"改成一张表。
// 这张表决定「新建」出来的顶层节点叫什么，也决定「加子级」的建议词。
// Rust 侧 `ai_agent/tools.rs::default_root_kind` 是同一张表的第二份实现，
// 那边有 `default_root_kind_covers_every_genre_id_frontend_can_give` 钉着同样的值。
describe('体裁结构语言（defaultRootKind / defaultLevels）', () => {
  it('小说与散文逐字不变（改造前后同一组值 = 零回归）', () => {
    // ⑱：顶层给可写单位「章」，不再给容器「卷」（给卷会让新建的书统计不到正文）
    expect(defaultRootKind('novel')).toBe('章');
    expect(defaultLevels('novel')).toEqual(['卷', '章']);
    expect(defaultRootKind('essay')).toBe('篇');
    expect(defaultLevels('essay')).toEqual(['篇', '节']);
  });

  it('旧书没设体裁 / 未知体裁回落小说（不许凭空造一套层级名）', () => {
    expect(defaultRootKind('')).toBe('章');
    expect(defaultLevels('')).toEqual(['卷', '章']);
    expect(defaultRootKind('reportage')).toBe('章');
  });

  it('诗歌：顶层是「首」，而**不是**下钻链的链首「辑」', () => {
    expect(defaultLevels('poetry')).toEqual(['辑', '首']);
    expect(defaultRootKind('poetry')).toBe('首');
    // 这条锁的是本次真正踩到的坑：createChapter 旧写法取 defaultLevels(genre)[0]，
    // 诗歌那样取到的是「辑」= 分组容器层，一首诗会被标成容器、并污染"章数"统计。
    expect(defaultRootKind('poetry')).not.toBe(defaultLevels('poetry')[0]);
  });

  it('剧本：幕 › 场 词表已登记且已开闸（⑮-2 分支必须齐，缺一支就是半开闸）', () => {
    expect(defaultRootKind('script')).toBe('场');
    expect(defaultLevels('script')).toEqual(['幕', '场']);
    expect(genreDef('script')?.ready, '⑮-2 已开闸：货架/页签/AI 三支的实锁在 writingSchema.test 与 workbenchGenre.test').toBe(true);
  });

  it('每个体裁的 root 一定出现在它的层级词汇表里（顶层不是一套没人用过的孤词）', () => {
    for (const g of WRITING_GENRES) {
      expect(defaultLevels(g.id), `${g.id} 的顶层层级名不在自己的词表里`).toContain(defaultRootKind(g.id));
      // ⑱ 之后真正的不变式：**顶层永远不是容器层**。
      // （我先写成"必须等于 levels 链尾"，那是错的 —— 散文的链是 篇›节，链尾是"节"，
      //   而它的顶层就该是"篇"。不变式要说的是"别拿容器当起步节点"，不是位置。）
      // 容器词表要跟着体裁长：日记带来「年 / 月」之后漏了它们，这条共享不变式就拦不住
      // 「新书顶层是个容器」这类丢统计口径的错（2026-11-10 实测：root 改成「年」时它仍绿）。
      const CONTAINER_KINDS = ['卷', '幕', '辑', '年', '月'];
      expect(CONTAINER_KINDS, `${g.id} 的顶层不该是容器层`).not.toContain(defaultRootKind(g.id));
    }
  });
});
