// sight-folio: Show-not-Tell 顾问（写作方案 B3）回归锁
// ① 短句 + 抽象情绪词 + 无细节支撑 → 报直述，给出分类方向与示范改写；
// ② 有动作/感官/比喻细节的句子不报（避免与 C1"以行写情"冲突）；
// ③ 长句不报；同一情绪词多句只建议首次处；偏移可定位。
import { describe, it, expect } from 'vitest';
import { detectShowTell } from '../showTell';

describe('detectShowTell（Show-not-Tell 顾问 · B3）', () => {
  it('识别纯直述句：短句 + 情绪词 + 无细节，按情绪分类给方向与示范', () => {
    const r = detectShowTell('她很难过。他转过身离开了。');
    expect(r).toHaveLength(1);
    expect(r[0].emotionWord).toBe('难过');
    expect(r[0].emotionKind).toBe('sadness');
    expect(r[0].directions.length).toBeGreaterThanOrEqual(2);
    expect(r[0].rewriteExample.length).toBeGreaterThan(5);
    // 偏移（与 A2 句界口径一致：不含拖尾换行的 clean 文本端点即句尾）
    expect(r[0].start).toBe(0);
    expect(r[0].end).toBe('她很难过。'.length);
  });

  it('有动作/感官/比喻细节的句子不算直述（不打扰已呈现的情绪）', () => {
    const r = detectShowTell('她难过地低下头，攥紧了衣角。');
    expect(r).toHaveLength(0);
  });

  it('长句含情绪词不报（直述口径限短句）', () => {
    const r = detectShowTell('经历过那些漫长的夜晚之后，他心里只剩下一种说不清道不明的难过和疲惫。');
    expect(r).toHaveLength(0);
  });

  it('同情绪词只建议首次出现处；不同词分别建议', () => {
    const r = detectShowTell('他很难过。她也很难过。\n她很生气。');
    expect(r).toHaveLength(2);
    expect(r[0].emotionKind).toBe('sadness');
    expect(r[1].emotionWord).toBe('生气');
    expect(r[1].emotionKind).toBe('anger');
  });

  it('未归类情绪词归 general，且仍给出方向', () => {
    const r = detectShowTell('她感到十分美丽。');
    expect(r).toHaveLength(1);
    expect(r[0].emotionKind).toBe('general');
    expect(r[0].directions.length).toBeGreaterThanOrEqual(2);
  });

  it('空文本返回空数组', () => {
    expect(detectShowTell('')).toEqual([]);
  });
});
