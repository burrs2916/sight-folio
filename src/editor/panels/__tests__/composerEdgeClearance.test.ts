// 2026-11-03 李先生三轮定案（报修 → 驳回钳卡 → 指定算法）：
// 「全圆」档 composer 卡保持**全圆**（档位 × 3 = 60px，不许钳），四个快捷标签与底部
// 麦克风 / 斜杠 / 助手 / 发送要**对齐到弧线之后**：算出圆角在该行高度上的横向位置，
// 往后推到线内并留气口；量只由档位决定 —— 拖动左右边框时宽高变、圆角不变，控件不飘。
//
// 终案 = `composerRowInsetExtra(theme)`：弧 = 圆心 (r,r) 半径 r 的圆，行顶边 y=12
// （卡 px/py），弧横坐标 x = r − √(r² − (r−y)²)；追加内收 = max(0, x + 气口2 − 12)。
// 五档：none/small/medium/large → 0（逐像素零改动，弧本来就切不到），round → 14。
// 本锁钉：
//  ① 五档内收值精确（含 large 恰不触发、round = 14）；
//  ② 几何自证：每档「12 + 内收」严格退到弧后且 round 档气口 ≥ 2px；未内收（0）时
//     round 档必骑线 —— 判据非恒真，删内收就炸；medium/large 未内收也安全（不误伤）；
//  ③ 单调不减 + vars 非数值兜底为 medium 口径（0）；
//  ④ 源码同步：卡 sx 圆角乘数 3 与 CARD_RADIUS_MULT=3 一致（改一边必炸）、
//     两行 pl + 底行 pr 挂 composerRowInsetExtra、「钳卡」旧方案 0 复活。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { composerRowInsetExtra } from '../workbenchComponents';
import { BORDER_RADIUS_BASE } from '../../../theme/appearanceScales';

const MULT = 3; // 卡 sx 的 borderRadius 乘数（锁④核对源码一致）
const PAD = 12; // 卡 px/py = 1.5 × spacing(8)
const GAP = 2; // 贴边内容与弧线最小气口

function insetAt(r: number, y: number): number {
  if (r <= 0 || y >= r) return 0;
  return r - Math.sqrt(r * r - (r - y) * (r - y));
}

const extraOf = (base: number) => composerRowInsetExtra({ shape: { borderRadius: base } });

describe('锁 · composer 贴边行对齐弧线（全圆档骑线 / 钳卡回潮必炸）', () => {
  it('① 五档内收：none/small/medium/large = 0，round = 14（24 弧位 + 2 气口 − 12 内边距）', () => {
    expect(extraOf(BORDER_RADIUS_BASE.none)).toBe(0);
    expect(extraOf(BORDER_RADIUS_BASE.small)).toBe(0);
    expect(extraOf(BORDER_RADIUS_BASE.medium)).toBe(0);
    expect(extraOf(12)).toBe(0);
    expect(extraOf(20)).toBeCloseTo(insetAt(20 * MULT, PAD) + GAP - PAD, 6);
    expect(extraOf(20)).toBeCloseTo(14, 3);
  });

  it('② 几何自证：每档 12+内收 严格退到弧后，round 气口 ≥2；未内收时 round 必骑线', () => {
    for (const base of [0, 2, 6, 12, 20]) {
      const r = base * MULT;
      const line = PAD + extraOf(base);
      expect(line, `base=${base} 内容仍在弧内/骑线`).toBeGreaterThan(insetAt(r, PAD));
    }
    // round 档对齐后仍留 ≥2px 气口（「挨着」也算压线，李先生观感口径）
    const rRound = 20 * MULT;
    expect(PAD + extraOf(20) - insetAt(rRound, PAD)).toBeGreaterThanOrEqual(GAP);
    // 判据非恒真：不内收（历史病灶态）时 round 弧位越过内容起笔
    expect(insetAt(rRound, PAD)).toBeGreaterThan(PAD);
    // 不误伤：medium / large 弧本来就切不到行（内收 0 是正确行为）
    expect(insetAt(BORDER_RADIUS_BASE.medium * MULT, PAD)).toBeLessThanOrEqual(PAD);
    expect(insetAt(12 * MULT, PAD)).toBeLessThanOrEqual(PAD);
  });

  it('③ 单调不减；vars（非数值 borderRadius）兜底 medium 口径 = 0', () => {
    const bases = [0, 2, 6, 12, 20];
    for (let i = 1; i < bases.length; i++) {
      expect(extraOf(bases[i])).toBeGreaterThanOrEqual(extraOf(bases[i - 1]));
    }
    expect(composerRowInsetExtra({ shape: { borderRadius: 'var(--x)' } })).toBe(0);
  });

  it('④ 源码同步：卡乘数 = CARD_RADIUS_MULT，两行挂内收函数，钳卡旧案不许复活', () => {
    const src = readFileSync(resolve(__dirname, '../workbenchComponents.tsx'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src, 'CARD_RADIUS_MULT 必须与卡 sx 乘数同步').toContain('const CARD_RADIUS_MULT = 3;');
    expect(src, '卡 sx 圆角乘数漂移（找不回 3）').toContain('borderRadius: 3,');
    expect(src.match(/pl: composerRowInsetExtra/g)?.length, '第一排 + 底部动作条两处 pl').toBe(2);
    expect(src.match(/pr: composerRowInsetExtra/g)?.length, '底部动作条一处 pr').toBe(1);
    expect(
      src.match(/composerCardRadius|COMPOSER_CARD_RADIUS_MAX/g)?.length ?? 0,
      '「钳卡」旧方案复活 = 用户档位被牺牲',
    ).toBe(0);
  });
});
