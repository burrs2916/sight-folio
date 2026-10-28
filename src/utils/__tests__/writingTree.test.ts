// writingTree 结构树工具测试：chapterPathLabels 是文字封面兜底的「卷章号」唯一推导口径，
// 一旦分叉，各处文字封面就会显示不同的序号，所以锁成测试。
import { describe, it, expect } from 'vitest';
import { buildTree, chapterPathLabels, forestPreorderIndex } from '../writingTree';
import type { WritingChapter } from '../../services/tauri';

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
