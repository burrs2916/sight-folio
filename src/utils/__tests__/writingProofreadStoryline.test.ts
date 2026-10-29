// 剧情线线级体检（utils/writingProofread ⑤″）。
//
// 「写着写着支线丢了」是长篇/连载最典型的叙事事故，也是这个产品存在的理由之一。
// 但线级判定极易误报：长期不推进的支线常常是作者有意留到后面。所以这里的断言一半在测
// 「该报的报了」，一半在测「不该报的一条都不许报」。
import { describe, it, expect } from 'vitest';
import { buildProofreadReport, type ProofreadFinding } from '../writingProofread';
import type { WritingChapter, WritingTimelineEvent } from '../../services/tauri';

const ch = (id: string, sortOrder: number): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content: '正文',
    sortOrder,
    wordCount: 100,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    storylineId: null,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

/** 一条挂在某章上的剧情线事件 */
const ev = (id: string, storylineId: string, chapterId: string | null): WritingTimelineEvent =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at: `日-${id}`,
    event: `事件 ${id}`,
    chapterId,
    storylineId,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingTimelineEvent;

/** c0..c(n-1)，sortOrder 与编号一致 */
const book = (n: number) => Array.from({ length: n }, (_, i) => ch(`c${i}`, i));

/** 按稳定 key 取发现（key 同时是 React key，撞了就会少渲染一行） */
const of = (key: string, issues: ProofreadFinding[]) => issues.filter((i) => i.key === key);

describe('剧情线体检 ⑤″：悬空线', () => {
  it('事件存在但一条都没落到章节 → 报悬空，并指向这条线本身', () => {
    const r = buildProofreadReport(book(10), [], [
      ev('e1', 'sl1', null),
      ev('e2', 'sl1', null),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    const hit = of('sl:sl1:unanchored', r.issues);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      group: 'storyline',
      messageKey: 'StorylineUnanchoredOne',
      target: { type: 'storyline', id: 'sl1' },
    });
  });

  it('只要有一条挂上章就不算悬空（悬空说的是整条线悬着）', () => {
    const r = buildProofreadReport(book(10), [], [
      ev('e1', 'sl1', null),
      ev('e2', 'sl1', 'c3'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    expect(of('sl:sl1:unanchored', r.issues)).toHaveLength(0);
  });

  it('空线只报「没挂事件」，不重复报成悬空', () => {
    const r = buildProofreadReport(book(10), [], [], [], [{ id: 'sl1', name: '复仇线' }]);
    expect(r.issues.some((i) => i.messageKey === 'StorylineEmptyOne')).toBe(true);
    expect(of('sl:sl1:unanchored', r.issues)).toHaveLength(0);
  });

  it('多条线各自成行，key 不撞（React key 撞了会少报一条）', () => {
    const r = buildProofreadReport(book(10), [], [
      ev('e1', 'sl1', null),
      ev('e2', 'sl2', null),
    ], [], [{ id: 'sl1', name: 'A 线' }, { id: 'sl2', name: 'B 线' }]);
    expect(of('sl:sl1:unanchored', r.issues)).toHaveLength(1);
    expect(of('sl:sl2:unanchored', r.issues)).toHaveLength(1);
  });
});

describe('剧情线体检 ⑤″：搁置线', () => {
  it('最后一条事件停在 30 章以前 → 报搁置，带上章名与间隔', () => {
    const r = buildProofreadReport(book(45), [], [
      ev('e1', 'sl1', 'c0'),
      ev('e2', 'sl1', 'c5'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    const hit = of('sl:sl1:dormant', r.issues);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.args).toMatchObject({ name: '南疆线', title: 'c5', gap: 39 });
    expect(hit[0]?.target).toEqual({ type: 'storyline', id: 'sl1' });
  });

  it('短书不报（门槛与人物缺席同一尺度，短书报断档纯属噪音）', () => {
    const r = buildProofreadReport(book(20), [], [
      ev('e1', 'sl1', 'c0'),
      ev('e2', 'sl1', 'c1'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    expect(of('sl:sl1:dormant', r.issues)).toHaveLength(0);
  });

  it('间隔不足 30 章不报', () => {
    const r = buildProofreadReport(book(45), [], [
      ev('e1', 'sl1', 'c0'),
      ev('e2', 'sl1', 'c20'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    expect(of('sl:sl1:dormant', r.issues)).toHaveLength(0);
  });

  it('只有一条事件时不报搁置：更可能是计划中尚未展开的线', () => {
    const r = buildProofreadReport(book(45), [], [ev('e1', 'sl1', 'c0')], [], [
      { id: 'sl1', name: '远期线' },
    ]);
    expect(of('sl:sl1:dormant', r.issues)).toHaveLength(0);
  });

  it('章序按 sortOrder 而非数组顺序：目录乱序传入也不会算错间隔', () => {
    const scrambled = [...book(45)].reverse();
    const r = buildProofreadReport(scrambled, [], [
      ev('e1', 'sl1', 'c0'),
      ev('e2', 'sl1', 'c5'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    expect(of('sl:sl1:dormant', r.issues)[0]?.args).toMatchObject({ gap: 39 });
  });

  it('事件挂在已删章上不会被当成锚点（否则会掩盖真实的搁置）', () => {
    const r = buildProofreadReport(book(45), [], [
      ev('e1', 'sl1', 'c0'),
      ev('e2', 'sl1', 'c999'),
    ], [], [{ id: 'sl1', name: '南疆线' }]);
    // 唯一有效锚点是 c0，但只有 1 个 → 按「计划中的线」保守不报
    expect(of('sl:sl1:dormant', r.issues)).toHaveLength(0);
  });
});
