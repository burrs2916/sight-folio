// sight-folio: 情感弧线分析（写作方案 A3）回归锁
//
// 锁定：① 段落切分与偏移正确；② 主导情绪按词表归组；③ 强度 1-5 与副词/标点加成；
// ④ 平淡区（连续无情绪段）与断层（情绪剧变）标记。
import { describe, it, expect } from 'vitest';
import { analyzeEmotionArc } from '../emotionArc';

describe('analyzeEmotionArc（情感弧线 · A3）', () => {
  it('按换行切段落并保留偏移；无情绪段 emotion=none、强度 1', () => {
    const r = analyzeEmotionArc('第一段平淡叙事。\n第二段仍然平静。\n');
    expect(r).toHaveLength(2);
    expect(r[0].text).toBe('第一段平淡叙事。');
    expect(r[0].start).toBe(0);
    expect(r[0].end).toBe('第一段平淡叙事。'.length);
    expect(r[0].emotion).toBe('none');
    expect(r[0].intensity).toBe(1);
    expect(r[1].start).toBeGreaterThan(r[0].end);
  });

  it('情绪词归组：伤心/心碎 → sadness；害怕/惊慌 → fear；开心/欣喜 → joy', () => {
    expect(analyzeEmotionArc('他感到一阵伤心。')[0].emotion).toBe('sadness');
    expect(analyzeEmotionArc('她害怕得直发抖。')[0].emotion).toBe('fear');
    expect(analyzeEmotionArc('他开心得跳起来。')[0].emotion).toBe('joy');
    expect(analyzeEmotionArc('她愤怒地摔了杯子。')[0].emotion).toBe('anger');
  });

  it('强度 1-5：多类别情绪词 + 强度副词 + 感叹号叠加，封顶 5', () => {
    const flat = analyzeEmotionArc('他感到伤心。')[0];
    expect(flat.intensity).toBeLessThanOrEqual(5);
    expect(flat.intensity).toBeGreaterThanOrEqual(2);
    const intense = analyzeEmotionArc('她伤心、愤怒、绝望，几乎要哭出来！')[0];
    expect(intense.intensity).toBe(5);
    expect(intense.emotion).toBe('sadness');
  });

  it('平淡区：连续两段无情绪词 → 两段均 flat；有情绪词后闭环', () => {
    const r = analyzeEmotionArc('他走进房间。\n桌上的东西没有动过。\n他关上门。\n他忽然害怕起来。');
    expect(r[0].flat).toBe(true);
    expect(r[1].flat).toBe(true);
    expect(r[2].flat).toBe(true);
    expect(r[3].flat).toBe(false);
  });

  it('断层：喜悦接悲伤（剧变类）→ 后段 breakpoint；相邻均无情绪不标断层', () => {
    const r = analyzeEmotionArc('大家都开心极了。\n她却难过得说不出话。\n雨还在下。');
    expect(r[1].breakpoint).toBe(true);
    expect(r[2].breakpoint).toBe(false);
  });

  it('空文本/单段：返回空或单段，且无越界标记', () => {
    expect(analyzeEmotionArc('')).toEqual([]);
    const single = analyzeEmotionArc('只有一段。');
    expect(single).toHaveLength(1);
    expect(single[0].flat).toBe(false);
    expect(single[0].breakpoint).toBe(false);
  });
});
