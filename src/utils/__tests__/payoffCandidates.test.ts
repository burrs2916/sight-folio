// 「重排回收章」的候选章口径（utils/writingForeshadowing.payoffCandidateChapters）。
//
// 这条规则决定体检报告里那个就地修复动作能不能真的修好问题：isOverdue 报的就是
// 「回收章 ≤ 埋设章」，所以候选里只要再出现埋设章及其之前的章，作者就能原样再踩一次坑。
import { describe, it, expect } from 'vitest';
import { payoffCandidateChapters } from '../writingForeshadowing';
import type { WritingChapter } from '../../services/tauri';

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
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

describe('payoffCandidateChapters', () => {
  const book = [ch('c3', 2), ch('c1', 0), ch('c2', 1), ch('c4', 3)];

  it('只给埋设章之后的章，且按章序排（埋设章自己也在排除之列）', () => {
    expect(payoffCandidateChapters(book, 'c2').map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  it('数组乱序传入不影响结果（章序以 sortOrder 为准）', () => {
    expect(payoffCandidateChapters([...book].reverse(), 'c1').map((c) => c.id)).toEqual(['c2', 'c3', 'c4']);
  });

  it('埋设章是最后一章 → 无候选（调用方须给出解释，不能摆一个空选择器）', () => {
    expect(payoffCandidateChapters(book, 'c4')).toEqual([]);
  });

  it('埋设章已被删除 → 无候选，不替作者猜一章', () => {
    expect(payoffCandidateChapters(book, 'cGone')).toEqual([]);
  });

  it('埋设章为空 → 无候选', () => {
    expect(payoffCandidateChapters(book, null)).toEqual([]);
    expect(payoffCandidateChapters(book, undefined)).toEqual([]);
  });

  it('并列 sortOrder 不视为「之后」（否则同一章可能被当成合法回收章）', () => {
    const tied = [ch('a', 1), ch('b', 1)];
    expect(payoffCandidateChapters(tied, 'a')).toEqual([]);
  });
});
