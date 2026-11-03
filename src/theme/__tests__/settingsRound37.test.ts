// 第三十七轮 · 主题层「圆角/字号档位化」的源码扫描锁 + 死副本钉尸锁
//
// 范围封闭（1922 审计 §3.1 实测）：全仓组件级 styleOverrides 只有 customizations.ts 与
// AppTheme.tsx(MuiCssBaseline) 两个文件 ⇒ 这两把锁罩住「档位被写死数字盖掉」这一类病灶的 100%。
//   锁 1：主题层（src/theme/**，排除 __tests__）不许用裸 px 声明圆角/字号 ——
//         写死数字 = styleOverrides 优先级高于 theme.shape.borderRadius 与 scaleTypography，
//         用户切「圆角大小/字体大小」这些组件永远不动（这正是本轮收的病灶）。
//   锁 2：档位数值只许出现在 appearanceScales.ts（唯一真源）—— 本轮删掉的
//         getDesignTokens / colorSchemes / shape 三份死副本就是「另抄一套档位」的形态，钉住别复活。
//
// 口径沿承第 35 轮自纠：否定式判据**先剥注释**（误报的结局是锁被整个人删掉）；
// 字号断言走「声明串含 --app-font-scale」，不在 jsdom 里断 calc 的计算像素（calc 不解析）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  inputsCustomizations,
  dataDisplayCustomizations,
  feedbackCustomizations,
  navigationCustomizations,
  surfacesCustomizations,
} from '../customizations';
import { uiFontSize, BORDER_RADIUS_BASE, RADIUS_CUSTOM_RANGE } from '../appearanceScales';

const THEME_DIR = resolve(__dirname, '..');
const SRC_DIR = resolve(__dirname, '../..');

const read = (p: string) => readFileSync(p, 'utf-8');
/** 归一空白：源码扫描锁不许绑 prettier 的换行/缩进（第 26 轮踩过的口径） */
const flat = (s: string) => s.replace(/\s+/g, ' ');
/** 剥块注释与整行注释后才许做「不许出现 X」的否定式判据（第 35 轮自纠 4） */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

function matchesAll(source: string, pattern: RegExp): string[] {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[0]);
  return out;
}

/** src/theme 层的全部源码文件（递归，排除 __tests__ —— 本仓 rg 会跳过它们，判据一律自己走目录） */
function themeLayerFiles(dir: string = THEME_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...themeLayerFiles(p));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const BARE_RADIUS = /borderRadius:\s*[\d.]/;
const BARE_FONT = /fontSize:\s*(?:'|"|`)?-?\d/;

describe('锁 1 · 主题层不许裸 px 圆角/字号', () => {
  const files = themeLayerFiles();

  it('目录扫描本身要能扫到主题层的文件（路径写错会让下面几条整批假绿）', () => {
    expect(files.length, '一个主题层文件都没扫到 = 锁自己失效').toBeGreaterThanOrEqual(8);
    expect(files.map((f) => f.split('/').pop())).toEqual(
      expect.arrayContaining(['customizations.ts', 'themePrimitives.ts']),
    );
  });

  it('判据对合成样本要抓得住、对合法写法要放过（正则写松写死都是假绿）', () => {
    expect(BARE_RADIUS.test('borderRadius: 6')).toBe(true);
    expect(BARE_RADIUS.test('borderRadius: theme.shape.borderRadius * 1.67')).toBe(false);
    expect(BARE_RADIUS.test('borderRadius: shapeRadius(theme) * 1.67')).toBe(false);
    expect(BARE_RADIUS.test('borderRadius: baseBorderRadius')).toBe(false);
    expect(BARE_FONT.test('fontSize: 13.5')).toBe(true);
    expect(BARE_FONT.test("fontSize: '13.5px'")).toBe(true);
    expect(BARE_FONT.test('fontSize: uiFontSize(13.5)')).toBe(false);
    expect(BARE_FONT.test('fontSize: defaultTheme.typography.pxToRem(48)')).toBe(false);
    // 注释里的历史写法（appearanceScales.ts:41 的乘数示例）不算病灶 —— 前提就是先剥注释
    expect(BARE_RADIUS.test(code('// ① MUI 组件里用乘数 borderRadius: 1\n/** borderRadius: 6 */'))).toBe(false);
  });

  it('主题层全部文件（剥注释后）圆角/字号声明零裸 px', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = flat(code(read(f)));
      const r = matchesAll(src, BARE_RADIUS);
      const fz = matchesAll(src, BARE_FONT);
      if (r.length || fz.length) offenders.push(`${f.split('/').pop()}: ${[...r, ...fz].join(' , ')}`);
    }
    expect(offenders, `裸 px 圆角/字号回潮（会盖掉档位）：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('customizations.ts 的 8 处圆角真的走 shape 基准乘数（乘数表 1922 §3.2）', () => {
    const src = flat(code(read(join(THEME_DIR, 'customizations.ts'))));
    const mult = matchesAll(src, /shapeRadius\(theme\) \* ([\d.]+)/g).map((m) => m.split('* ')[1]);
    expect(mult.length, '8 处乘数圆角少一处 = 那一个组件又回到写死').toBe(8);
    const count = (v: string) => mult.filter((m) => m === v).length;
    expect(count('1.67'), 'InputBase/OutlinedInput/FilledInput 三处 1.67').toBe(3);
    expect(count('0.67'), 'Chip 一处 0.67').toBe(1);
    expect(count('1.33'), 'Alert/MenuItem/Accordion 三处 1.33').toBe(3);
    expect(count('2'), 'Card 一处 2').toBe(1);
  });

  it('customizations.ts 的 4 处字号真的走 uiFontSize()（13.5/13/11.5/19 一个不许掉）', () => {
    const src = flat(code(read(join(THEME_DIR, 'customizations.ts'))));
    const sizes = matchesAll(src, /uiFontSize\((\d+(?:\.\d+)?)\)/g).map((m) => m.match(/\(([\d.]+)\)/)![1]);
    expect(sizes.sort()).toEqual(['11.5', '13', '13.5', '19']);
  });
});

describe('锁 1 · 运行时语义（不是只钉文本）', () => {
  type Ctor = { styleOverrides: { root: unknown; input?: Record<string, unknown>; icon?: Record<string, unknown> } };
  const section = (group: unknown, comp: string) => (group as Record<string, Ctor>)[comp];
  const radiusAt = (group: unknown, comp: string, base: number): number => {
    const root = section(group, comp).styleOverrides.root;
    const fn = root as (a: { theme: { shape: { borderRadius: number }; vars?: undefined } }) => {
      borderRadius: number;
    };
    const out = typeof root === 'function' ? fn({ theme: { shape: { borderRadius: base }, vars: undefined } }) : root;
    return (out as { borderRadius: number }).borderRadius;
  };
  const INPUTS: Array<[unknown, string, number]> = [
    [inputsCustomizations, 'MuiInputBase', 10],
    [inputsCustomizations, 'MuiOutlinedInput', 10],
    [inputsCustomizations, 'MuiFilledInput', 10],
    [dataDisplayCustomizations, 'MuiChip', 4],
    [feedbackCustomizations, 'MuiAlert', 8],
    [navigationCustomizations, 'MuiMenuItem', 8],
    [surfacesCustomizations, 'MuiCard', 12],
    [surfacesCustomizations, 'MuiAccordion', 8],
  ];

  it('medium 档（shape=6）与写死时代的像素观感一致（乘数表的设计前提）', () => {
    for (const [group, comp, oldPx] of INPUTS) {
      expect(Math.abs(radiusAt(group, comp, 6) - oldPx), `${comp} medium 档偏离历史值 ${oldPx}px`).toBeLessThan(0.05);
    }
  });

  it('none 档（shape=0）真归零 —— 写死数字时切「直角」没反应，就是本轮修的病灶', () => {
    for (const [group, comp] of INPUTS) {
      expect(radiusAt(group, comp, 0), `${comp} 在直角档仍是裸数字`).toBe(0);
    }
  });

  it('圆角与档位严格成正比（large = medium×2，round = medium×20/6）', () => {
    for (const [group, comp] of INPUTS) {
      const m = radiusAt(group, comp, 6);
      expect(radiusAt(group, comp, 12), `${comp} large 档不成比例`).toBeCloseTo(m * 2, 6);
      expect(radiusAt(group, comp, 20), `${comp} round 档不成比例`).toBeCloseTo((m * 20) / 6, 6);
    }
  });

  it('输入框/标签/描述/下拉箭头的字号声明串含 --app-font-scale（档位通道真的接上）', () => {
    const input = section(inputsCustomizations, 'MuiOutlinedInput').styleOverrides.input!;
    const label = section(inputsCustomizations, 'MuiInputLabel').styleOverrides.root as Record<string, unknown>;
    const helper = section(inputsCustomizations, 'MuiFormHelperText').styleOverrides.root as Record<string, unknown>;
    const icon = section(inputsCustomizations, 'MuiSelect').styleOverrides.icon!;
    for (const [name, decl] of [
      ['MuiOutlinedInput.input', input.fontSize],
      ['MuiInputLabel.root', label.fontSize],
      ['MuiFormHelperText.root', helper.fontSize],
      ['MuiSelect.icon', icon.fontSize],
    ] as const) {
      expect(typeof decl, `${name} 字号没了`).toBe('string');
      expect(decl as string, `${name} 没走 --app-font-scale = 字体大小档位对它无效`).toContain('--app-font-scale');
    }
    expect(uiFontSize(13.5), 'uiFontSize 口径变了：同步复核本锁的声明串判据').toBe(
      'calc(13.5px * var(--app-font-scale, 1))',
    );
  });
});

describe('锁 2 · 档位数值只许出现在 appearanceScales.ts', () => {
  const SCALES = join(THEME_DIR, 'appearanceScales.ts');
  const PRIMITIVES = join(THEME_DIR, 'themePrimitives.ts');

  it('真源锚点：圆角真源逐字不变（2026-11-03 改版：三固定档 + 自定义数值档，改档位只许改这里）', () => {
    // 「大圆 12 / 全圆 20」两档由李先生拍板撤销，观感区间由 RADIUS_CUSTOM_RANGE(0–20) 承接
    expect(BORDER_RADIUS_BASE).toEqual({ none: 0, small: 2, medium: 6 });
    expect(RADIUS_CUSTOM_RANGE).toEqual({ min: 0, max: 20, step: 1, default: 6 });
  });

  it('三份死副本已下葬且钉住：themePrimitives 不再含 getDesignTokens/colorSchemes/shape 副本', () => {
    const src = flat(code(read(PRIMITIVES)));
    for (const dead of ['getDesignTokens', 'colorSchemes', 'customShadows', 'PaletteMode']) {
      expect(src, `死副本 ${dead} 回魂 = 又一份只抄不读的档位表`).not.toContain(dead);
    }
    expect(src).not.toMatch(/export\s+const\s+shape\b/);
    expect(src, 'getDesignTokens 当年把档位抄进 shape:{} 的形态不许回来').not.toMatch(
      /shape:\s*\{[^}]*borderRadius:\s*[\d.]/,
    );
  });

  it('活口没被顺手扫掉：brand/gray/ramps/typography/shadows/字体栈仍在 themePrimitives', () => {
    const src = read(PRIMITIVES);
    for (const alive of [
      'export const brand',
      'export const gray',
      'export const typography',
      'export const shadows',
      'export const UI_FONT_STACK_SYSTEM',
    ]) {
      expect(src, `${alive} 不见了（1922 §4 点名是活口，本轮删死副本不该碰它）`).toContain(alive);
    }
    const presets = read(join(THEME_DIR, 'themePresets.ts'));
    expect(presets, 'themePresets 对 ramp 的 import 是这些常量的唯一消费，别断').toMatch(
      /import\s*\{[^}]*brand[^}]*\}\s*from\s*'\.\/themePrimitives'/,
    );
  });

  it('全仓（剥注释、排除测试）BORDER_RADIUS_BASE 的导出与档位表结构只在 appearanceScales.ts 一处', () => {
    const dupExport: string[] = [];
    const dupTable: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '__tests__' || name === 'test') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
          const src = flat(code(read(p)));
          if (/export\s+const\s+BORDER_RADIUS_BASE\b/.test(src) && p !== SCALES) dupExport.push(p);
          if (/none:\s*0\s*,\s*small:\s*2\s*,\s*medium:\s*6/.test(src) && p !== SCALES) dupTable.push(p);
        }
      }
    };
    walk(SRC_DIR);
    expect(dupExport, '又导出了一份圆角档位表 = 两份真源迟早分家').toEqual([]);
    expect(dupTable, '又抄了一份 none/small/medium 档位数值').toEqual([]);
    // 防呆：真源自己必须能被同一段判据扫到，否则上面两条是空转
    expect(flat(code(read(SCALES)))).toMatch(/export\s+const\s+BORDER_RADIUS_BASE\b/);
    expect(flat(code(read(SCALES)))).toMatch(/none:\s*0\s*,\s*small:\s*2\s*,\s*medium:\s*6/);
  });
});
