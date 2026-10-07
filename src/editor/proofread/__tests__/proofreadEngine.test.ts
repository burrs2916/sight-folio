// 批次③ T5：编辑器实时校对引擎单测
//   - runProofread 三类检测（typo / repeat / sensitive）与排序/空文本
//   - buildTextIndex + textRangeToPos 与 getText() 规则的一致性（定位自洽）
import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { runProofread } from '../proofreadEngine';
import { buildTextIndex, textRangeToPos } from '../locate';

// 最小 schema：doc → 多个 paragraph → text（与 TipTap 默认 blockSeparator='\n\n' 的展平规则一致）
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    text: { group: 'inline' },
  },
});

/** 用 schema 直接构造 doc，避免依赖 DOM（node 环境可跑） */
const docFromParas = (...paras: string[]) =>
  schema.node(
    'doc',
    null,
    paras.map((t) => schema.node('paragraph', null, schema.text(t))),
  );

describe('runProofread —— 三类检测', () => {
  it('错别字短语命中（typoPhrases 表）', () => {
    const issues = runProofread('他行事一诺千斤，从不作假。');
    const typo = issues.filter((i) => i.kind === 'typo');
    expect(typo.length).toBeGreaterThan(0);
    expect(typo[0]).toMatchObject({ kind: 'typo' });
    expect(typo[0].suggestion).toBeTruthy();
  });

  it('正确成语不误报', () => {
    expect(runProofread('他行事一诺千金，从不作假。')).toEqual([]);
  });

  it('重复用词命中（相邻/近邻重复）', () => {
    const issues = runProofread('我不信我不信，这不可能。');
    const rep = issues.filter((i) => i.kind === 'repeat');
    expect(rep.length).toBeGreaterThan(0);
    expect(rep[0].excerpt).toContain('我不信');
  });

  it('敏感词分级命中（warning / block）', () => {
    const issues = runProofread('文中提到法轮功相关内容。');
    const sn = issues.filter((i) => i.kind === 'sensitive');
    expect(sn.length).toBeGreaterThan(0);
    expect(sn[0].severity).toBe('block');
  });

  it('空文本返回 []', () => {
    expect(runProofread('')).toEqual([]);
    expect(runProofread('   \n  ')).toEqual([]);
  });

  it('结果按 start 升序；同 start 优先 block>warning>typo>repeat', () => {
    const issues = runProofread('我不信我不信，法轮功一诺千金');
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i].start).toBeGreaterThanOrEqual(issues[i - 1].start);
    }
    const order: Record<string, number> = { block: 3, warning: 2, typo: 1, repeat: 0 };
    const rank = (i: (typeof issues)[number]) =>
      i.kind === 'sensitive' ? order[i.severity ?? 'warning'] : order[i.kind];
    for (let i = 1; i < issues.length; i++) {
      if (issues[i].start === issues[i - 1].start) {
        expect(rank(issues[i - 1])).toBeGreaterThanOrEqual(rank(issues[i]));
      }
    }
  });
});

describe('buildTextIndex / textRangeToPos —— getText 规则一致性', () => {
  it('多段落 doc 展平后与 getText() 偏移一致', () => {
    const doc = docFromParas('第一段abc', '第二段');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('第一段abc\n\n第二段');
    // runProofread 在 idx.text 上得到 start/end → textRangeToPos → doc.textBetween 必须还原原文
    const start = idx.text.indexOf('第二');
    const range = textRangeToPos(idx, start, start + 2);
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('第二');
    // 闭环：整段定位的 range 应覆盖 doc 内全部文本（textBetween 不含 getText 虚构的 \n\n，故期望值为拼接文本）
    const whole = textRangeToPos(idx, 0, idx.text.length);
    expect(whole).not.toBeNull();
    expect(doc.textBetween(whole!.from, whole!.to)).toBe('第一段abc第二段');
  });

  it('跨段定位包含 \\n\\n 分隔符位置', () => {
    const doc = docFromParas('abcd', 'efgh');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('abcd\n\nefgh');
    const start = idx.text.indexOf('efg');
    const range = textRangeToPos(idx, start, start + 3);
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('efg');
  });

  it('区间越界或空区间返回 null', () => {
    const doc = docFromParas('hello');
    const idx = buildTextIndex(doc);
    expect(idx.text).toBe('hello');
    expect(textRangeToPos(idx, -5, 100)).toBeNull();
    expect(textRangeToPos(idx, 2, 2)).toBeNull();
    expect(textRangeToPos(idx, 3, 1)).toBeNull();
  });
});
