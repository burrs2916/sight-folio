// ㉬ 单元默认名的五体裁矩阵（2026-11-11 轮 72 续五班）。
//
// 由来：真人两次为这件事发火 ——「点散文还是按小说走」（2026-11-08 在册）与「点日记进去正文
// 怎么是"第一首"」（本轮）。建单位的入口有六处，命名早已被 `unitNameKey` 收成一处，
// 但**没人把"五种体裁各自该拿到什么名字"钉成一枚便宜的纯用例**，于是 `paneCardBookIdentity`
// 只能借整张卡挂载去测一个字符串 —— 那类用例一改体裁就连带炸两枚（本轮就炸了）。
// 口径：命名判据只测这一枚函数；卡层要测的是"认书"，不是命名。
import { describe, expect, it } from 'vitest';
import { WRITING_GENRES, unitNameKey } from '../writingSchema';
import zh from '../../i18n/zh-CN.json';

const W = (zh as unknown as { writing: Record<string, string> }).writing;
const LEAF = { novel: '章', essay: '篇', poetry: '首', script: '场', diary: '天' } as const;

describe('㉬ 建正文单位的默认名 · 五体裁矩阵', () => {
  it('每种体裁各领自己的单位词，谁也不许冒充谁', () => {
    for (const [genre, unit] of Object.entries(LEAF)) {
      const key = unitNameKey(genre);
      const val = W[key.split('.').pop() as string];
      expect(typeof val, `${genre} 的 ${key} 在 i18n 里没实值`).toBe('string');
      expect(val, `${genre} 单位词不对`).toBe(`第 {n} ${unit}`);
    }
  });

  it('未开闸 / 未设 / 脏体裁 → 一律落回历史名「第 {n} 章」（不许凭空发明第六种叫法）', () => {
    const fallback = W[unitNameKey('').split('.').pop() as string];
    expect(fallback).toBe('第 {n} 章');
    for (const g of ['', 'xxx', ...WRITING_GENRES.filter((x) => !x.ready).map((x) => x.id)]) {
      expect(unitNameKey(g), g).toBe('writing.newChapterName');
    }
  });

  it('日记必须是「天」，且不许在任何体裁的默认名里出现 章/首 之外的错位（防"日记长出一首"）', () => {
    expect(unitNameKey('diary')).toBe('writing.newDayName');
    // 日记这本书里绝不该出现的单位词
    expect(W.newDayName).not.toMatch(/首|章|篇|场/);
  });
});
