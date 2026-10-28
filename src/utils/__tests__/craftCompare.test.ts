// sight-folio: C3 写法对照工做台 · 纯函数回归锁
// filterReferenceHits（剔碎片/排序/截断） + compareCraft（节奏差异边界）+ countSourceChars（计数口径）。
import { describe, it, expect } from 'vitest';
import { filterReferenceHits, countSourceChars, compareCraft, CRAFT_REFERENCE_LIMIT } from '../craftCompare';
import type { CorpusSearchHit } from '../../services/corpus';

function hit(over: Partial<CorpusSearchHit> = {}): CorpusSearchHit {
  return {
    chunkId: 1,
    bookId: 1,
    bookTitle: '样本集',
    seq: 1,
    kind: 'text',
    chapterTitle: '第一章',
    content: '原句',
    occurrenceCount: 1,
    occurrences: [],
    ...over,
  };
}

describe('filterReferenceHits（对照句筛选）', () => {
  it('剔除碎片句（referenceTier=low），保留 high/medium/null', () => {
    const hits = [
      hit({ referenceTier: 'low', content: '他。' }),
      hit({ referenceTier: 'high', content: '优质句' }),
      hit({ referenceTier: 'medium', content: '普通句' }),
      hit({ content: '无分层字段' }),
    ];
    const out = filterReferenceHits(hits);
    expect(out.map((h) => h.content)).toEqual(['优质句', '普通句', '无分层字段']);
  });

  it('排序：high > medium/null（同分稳定保留输入顺序，low 已剔除）', () => {
    const hits = [
      hit({ referenceTier: null, content: '空' }),
      hit({ referenceTier: 'medium', content: '中' }),
      hit({ referenceTier: 'high', content: '高1' }),
      hit({ referenceTier: 'high', content: '高2' }),
      hit({ referenceTier: 'low', content: '碎片' }),
    ];
    const out = filterReferenceHits(hits);
    expect(out.map((h) => h.content)).toEqual(['高1', '高2', '空', '中']);
  });

  it('截断：超过 limit 只取前 limit 条（默认 6），limit 至少为 1', () => {
    const hits = Array.from({ length: 10 }, (_, i) => hit({ referenceTier: 'high', content: `句${i}` }));
    expect(filterReferenceHits(hits)).toHaveLength(CRAFT_REFERENCE_LIMIT);
    expect(filterReferenceHits(hits, 3).map((h) => h.content)).toEqual(['句0', '句1', '句2']);
    const one = filterReferenceHits(hits, 0);
    expect(one).toHaveLength(1);
  });

  it('空输入返回空数组，且不修改入参', () => {
    expect(filterReferenceHits([])).toEqual([]);
    expect(filterReferenceHits(null as unknown as CorpusSearchHit[])).toEqual([]);
    const hits = [hit({ referenceTier: 'high' })];
    const snapshot = [...hits];
    filterReferenceHits(hits);
    expect(hits).toEqual(snapshot);
  });
});

describe('countSourceChars（字符计数口径）', () => {
  it('汉字/标点计 1，连续 ASCII 词计 1', () => {
    expect(countSourceChars('雨夜，风急。')).toBe(6);
    // 汉字 6 + 逗号/句号 2 + 连续词 "The" "rain" 各计 1
    expect(countSourceChars('夜色渐深，The rain 不停。')).toBe(6 + 2 + 2);
    // 纯 ASCII 词串：每个连续词计 1
    expect(countSourceChars('The quick_brown fox.')).toBe(4);
  });

  it('空串/空白返回 0', () => {
    expect(countSourceChars('')).toBe(0);
    expect(countSourceChars('   ')).toBe(0);
  });
});

describe('compareCraft（节奏差异边界）', () => {
  it('±20% 内视为 similar', () => {
    // source 11 字符 vs candidate 12：+9% → similar
    const r1 = compareCraft(
      '这是一个十字符号源句。',
      hit({ content: '这也是十二个字符的长句。', analysis: { charCount: 12, tokenCount: 2 } }),
    );
    expect(r1.tempo).toBe('similar');
    // source 11 字符 vs candidate 9：-18% → similar
    const r2 = compareCraft('这是一个十个字的源句。', hit({ content: 'X', analysis: { charCount: 9, tokenCount: 1 } }));
    expect(r2.tempo).toBe('similar');
  });

  it('超 +20% 为 longer、超 -20% 为 shorter', () => {
    // source 7 字符 vs candidate 16：+129% → longer
    const longer = compareCraft('十个字符源句。', hit({ content: 'Y', analysis: { charCount: 16, tokenCount: 1 } }));
    expect(longer.tempo).toBe('longer');
    expect(longer.charDelta).toBe(9);
    expect(longer.ratio).toBe(129);
    // source 7 字符 vs candidate 4：-43% → shorter
    const shorter = compareCraft('十个字符源句。', hit({ content: 'Z', analysis: { charCount: 4, tokenCount: 1 } }));
    expect(shorter.tempo).toBe('shorter');
    expect(shorter.ratio).toBe(-43);
  });

  it('源句为空：similar 且 ratio 0；analysis 缺失回退本地计数', () => {
    const empty = compareCraft('', hit({ content: '对照句', analysis: { charCount: 8, tokenCount: 1 } }));
    expect(empty.tempo).toBe('similar');
    expect(empty.ratio).toBe(0);
    const fallback = compareCraft('源句文本内容。', hit({ content: '对照句文本！' }));
    expect(fallback.candidateChars).toBe(countSourceChars('对照句文本！'));
  });
});
