import { describe, expect, it } from 'vitest';
import { avgSentenceLen, formatBigCount } from '../formatCount';

// 背景：斗破苍穹全集 5,109,253 字 · 100,400 句，详情/书卡此前用裸数字展示，
// 102 万量级在窄卡片上不可直读。formatBigCount 负责中文「万」折算与英文千分位，
// avgSentenceLen 提供写作参考口径（平均每句字数）。

describe('formatBigCount', () => {
  it('中文语境：≥1 万折算「万」单位（5109253 → 510.9万）', () => {
    expect(formatBigCount(5109253, 'zh-CN')).toBe('510.9万');
  });

  it('中文语境：整万去掉小数位（100400 → 10万）', () => {
    expect(formatBigCount(100400, 'zh-CN')).toBe('10万');
  });

  it('中文语境：小数值保留 1 位小数', () => {
    expect(formatBigCount(12345, 'zh-CN')).toBe('1.2万');
    expect(formatBigCount(10999, 'zh-CN')).toBe('1.1万');
  });

  it('中文语境：1 万以下千分位展示', () => {
    expect(formatBigCount(9999, 'zh-CN')).toBe('9,999');
    expect(formatBigCount(0, 'zh-CN')).toBe('0');
  });

  it('英文语境：千分位', () => {
    expect(formatBigCount(5109253, 'en-US')).toBe('5,109,253');
    expect(formatBigCount(100400, 'en-US')).toBe('100,400');
    expect(formatBigCount(999, 'en-US')).toBe('999');
  });

  it('非法输入：返回原样字符串（不抛错不 NaN）', () => {
    expect(formatBigCount(-1, 'zh-CN')).toBe('-1');
    expect(formatBigCount(Number.NaN, 'zh-CN')).toBe('NaN');
  });
});

describe('avgSentenceLen', () => {
  it('斗破苍穹：5109253 字 / 100400 句 ≈ 51 字/句', () => {
    expect(avgSentenceLen(5109253, 100400)).toBe(51);
  });

  it('常规中文书籍：2 万字段落取整', () => {
    expect(avgSentenceLen(20000, 400)).toBe(50);
    expect(avgSentenceLen(20001, 400)).toBe(50);
  });

  it('chunkCount <= 0 时返回 null（调用方决定不展示）', () => {
    expect(avgSentenceLen(100, 0)).toBeNull();
    expect(avgSentenceLen(100, -3)).toBeNull();
  });

  it('非有限数返回 null', () => {
    expect(avgSentenceLen(Number.NaN, 100)).toBeNull();
    expect(avgSentenceLen(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
