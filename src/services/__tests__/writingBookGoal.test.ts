// 全书写作目标（T2）：parseBookGoal / serializeBookGoal 的解析与合并口径。
// 约束：坏 JSON / 空串回退空目标；serialize 保留未知字段（加字段零迁移）。
import { describe, expect, it } from 'vitest';
import { parseBookGoal, serializeBookGoal } from '../writing';

describe('parseBookGoal', () => {
  it('空串 / null / undefined 回退空目标', () => {
    expect(parseBookGoal('')).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
    expect(parseBookGoal(null)).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
    expect(parseBookGoal(undefined)).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
  });

  it('坏 JSON 回退空目标而非抛错', () => {
    expect(parseBookGoal('{oops')).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
    expect(parseBookGoal('null')).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
  });

  it('完整目标正常解析', () => {
    const goal = parseBookGoal(JSON.stringify({ targetWords: 500_000, targetChapters: 120, deadline: 1_800_000_000 }));
    expect(goal).toEqual({ targetWords: 500_000, targetChapters: 120, deadline: 1_800_000_000 });
  });

  it('非正数 / 非数字字段归零（容忍脏数据）', () => {
    const goal = parseBookGoal(JSON.stringify({ targetWords: -1, targetChapters: 'x', deadline: 0 }));
    expect(goal).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
  });

  it('部分字段缺失时只返回有值项，其余为 0', () => {
    const goal = parseBookGoal(JSON.stringify({ targetWords: 10_000 }));
    expect(goal).toEqual({ targetWords: 10_000, targetChapters: 0, deadline: 0 });
  });
});

describe('serializeBookGoal', () => {
  it('空 base 生成干净 JSON', () => {
    expect(serializeBookGoal(null, { targetWords: 10_000, targetChapters: 0, deadline: 0 })).toBe(
      '{"targetWords":10000,"targetChapters":0,"deadline":0}',
    );
  });

  it('合并进已有 extra 并保留未知字段（零迁移范式）', () => {
    const base = JSON.stringify({ coverKey: 'X', targetWords: 20_000 });
    const out = serializeBookGoal(base, { targetWords: 30_000, targetChapters: 2, deadline: 0 });
    expect(JSON.parse(out)).toEqual({ coverKey: 'X', targetWords: 30_000, targetChapters: 2, deadline: 0 });
  });

  it('坏 base JSON 丢弃旧内容但新目标仍可写', () => {
    const out = serializeBookGoal('{{{', { targetWords: 5, targetChapters: 1, deadline: 9 });
    expect(JSON.parse(out)).toEqual({ targetWords: 5, targetChapters: 1, deadline: 9 });
  });

  it('round-trip：serialize → parse 恒等', () => {
    const goal = { targetWords: 88_888, targetChapters: 33, deadline: 2_000_000_000 };
    expect(parseBookGoal(serializeBookGoal(null, goal))).toEqual(goal);
  });
});
