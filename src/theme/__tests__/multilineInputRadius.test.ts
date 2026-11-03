// 2026-11-03 李先生报修（第 91/92 轮之间插单）：圆角切「全圆」后，AI 对话框的多行输入框
// 首行光标被圆弧压住。病灶：输入框圆角 = 档位 × 1.67，全圆档 33.4px；multiline 首行从
// padding-top 8.5px 起笔，33.4px 圆在该高度的水平侵入 ≈11.1px，叠加 1.75px 聚焦描边
// ⇒ 光标（x=14px）正好压在弧线上。单行框光标在竖向中央且被浏览器钳到半高，不受影响。
// 修法：customizations.ts 的 MuiInputBase root 上以 '&.MuiInputBase-multiline'
// （MUI v9 给 outlined/filled/standard 三变体 multiline 形态根节点统一挂的类，SSR 实测）
// 钳到 MULTILINE_INPUT_RADIUS_MAX。本锁钉四件事：
//  ① 运行时钳制值：全圆/large 档钳到上限、medium 及以下逐像素不变、none 档真归零；
//  ② 单行框不殃及：三变体根部仍是全乘数（「全圆」胶囊观感保留）；
//  ③ 几何判据自证：上限值下光标净空 ≥6px，原病灶 33.4px 在同判据下 <2px —— 写死回潮必炸；
//  ④ 钳制选择器全仓单点（真源在 appearanceScales，判据先剥注释，口径沿第 35/37 轮）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inputsCustomizations } from '../customizations';
import { MULTILINE_INPUT_RADIUS_MAX, BORDER_RADIUS_BASE } from '../appearanceScales';

type InputCustomizations = Record<
  'MuiInputBase' | 'MuiOutlinedInput' | 'MuiFilledInput',
  { styleOverrides: { root: unknown } }
>;
type RootOut = {
  borderRadius: number;
  '&.MuiInputBase-multiline'?: { borderRadius: number };
};

const rootOut = (comp: keyof InputCustomizations, base: number): RootOut => {
  const root = (inputsCustomizations as InputCustomizations)[comp].styleOverrides.root;
  expect(typeof root, `${comp} root 应是随档位的函数（静态对象 = 档位化回潮）`).toBe('function');
  const fn = root as (a: { theme: { shape: { borderRadius: number }; vars?: undefined } }) => RootOut;
  return fn({ theme: { shape: { borderRadius: base }, vars: undefined } });
};

/** 左上圆角在高度 y 处对内容区的水平侵入量（圆心 (r,r)）：y=0 处侵入 r，y≥r 后归零 */
const intrusionAt = (r: number, y: number): number => {
  if (r <= 0 || y >= r) return 0;
  return r - Math.sqrt(r * r - (r - y) * (r - y));
};

// small 号 outlined 多行的光标几何（MUI v9 默认 padding '8.5px 14px'，聚焦描边 1.75px
// 由 customizations.ts 的 MuiOutlinedInput '&.Mui-focused' 钉死）：
const CARET_TOP_Y = 8.5;
const CARET_X = 14;
const FOCUS_BORDER = 1.75;
/** 光标左缘到描边内缘的净空；实测口径：<2px = 「光标被圆角压住」的病灶区 */
const caretClearance = (r: number): number => CARET_X - FOCUS_BORDER - intrusionAt(r, CARET_TOP_Y);

describe('锁 · 多行输入框圆角钳制（全圆档光标压字回潮必炸）', () => {
  it('运行时钳制值：全圆/large 钳到上限，medium 及以下逐像素不变，none 真归零', () => {
    const clampOf = (base: number): number => {
      const out = rootOut('MuiInputBase', base);
      expect(out['&.MuiInputBase-multiline'], '多行钳制条款没了 = 光标压字病灶回潮').toBeTruthy();
      return out['&.MuiInputBase-multiline']!.borderRadius;
    };
    expect(clampOf(BORDER_RADIUS_BASE.none)).toBe(0);
    expect(clampOf(BORDER_RADIUS_BASE.small)).toBeCloseTo(2 * 1.67, 6);
    expect(clampOf(BORDER_RADIUS_BASE.medium)).toBeCloseTo(6 * 1.67, 6);
    expect(clampOf(12)).toBe(MULTILINE_INPUT_RADIUS_MAX);
    expect(clampOf(20)).toBe(MULTILINE_INPUT_RADIUS_MAX);
  });

  it('单行框不殃及：三变体根部仍是全乘数（「全圆」胶囊观感保留）', () => {
    const round = 20;
    for (const comp of ['MuiInputBase', 'MuiOutlinedInput', 'MuiFilledInput'] as const) {
      expect(rootOut(comp, round).borderRadius, `${comp} 单行框圆角被误钳`).toBeCloseTo(round * 1.67, 6);
    }
  });

  it('几何判据自证：上限净空 ≥6px，病灶值 33.4 同判据 <2px；全档位钳后值都过', () => {
    expect(caretClearance(MULTILINE_INPUT_RADIUS_MAX)).toBeGreaterThanOrEqual(6);
    expect(caretClearance(20 * 1.67), '判据失真预警：33.4px 弧下光标净空应 <2px').toBeLessThan(2);
    for (const base of [0, 2, 6, 12, 20]) {
      const r = Math.min(base * 1.67, MULTILINE_INPUT_RADIUS_MAX);
      expect(caretClearance(r), `base=${base} 钳后 r=${r} 光标净空不足`).toBeGreaterThanOrEqual(6);
    }
  });

  it('源码：钳制选择器全仓单点、钳值走 MULTILINE_INPUT_RADIUS_MAX，不裸 px（剥注释后判）', () => {
    const src = readFileSync(resolve(__dirname, '../customizations.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src.match(/'&\.MuiInputBase-multiline'/g)?.length, '钳制条款必须恰好一处（多写=分叉真源）').toBe(1);
    expect(src, '钳值不许写死数字，走 MULTILINE_INPUT_RADIUS_MAX').toMatch(
      /Math\.min\(box \* 1\.67, MULTILINE_INPUT_RADIUS_MAX\)/,
    );
    // 钳制只许挂在 MuiInputBase（罩全变体），别在 Outlined/Filled 重复挂 —— 用区间位置判，不绑格式
    const at = src.indexOf("'&.MuiInputBase-multiline'");
    const baseStart = src.indexOf('MuiInputBase: {');
    const outlinedStart = src.indexOf('MuiOutlinedInput: {');
    expect(baseStart).toBeGreaterThanOrEqual(0);
    expect(outlinedStart, '找不到 MuiOutlinedInput 段界，区间判据失效').toBeGreaterThan(baseStart);
    expect(at > baseStart && at < outlinedStart, '钳制条款不在 MuiInputBase 段内 = 挂错组件，特异性覆盖链断裂').toBe(
      true,
    );
  });
});
