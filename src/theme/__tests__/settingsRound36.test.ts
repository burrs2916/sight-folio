// 第三十六轮 · 「代码编辑器字号微调」迁入设置库的源码扫描锁 + 换算纯函数锁
//
// 这一轮修的是用户那句「设置没生效 / 重启就没了」里最后一条还留在 localStorage 的读数：
// 「字体大小」这一维的**代码区微调步数**。它此前不在设置备份的 7 个键里、不参与「恢复默认」、
// 不跨窗口跟随、写失败还是空 catch。搬到 theme 域之后，本文件管的是「别被下一个改动拆回去」：
//  ① 旧 localStorage 键不许再有第二个读写点（迁移点只允许在 themeStore 里出现一次）；
//  ② 档位 → px、步数 → px 的换算不许在组件里各写一份（第二十四轮的病灶就是各写一份）；
//  ③ 新增落库字段必须同步进「按字段合并」的两处清单，否则迟到读回又会整份盖人。
//
// 判据一律「先归一空白、否定式判据先剥注释」（第 35 轮记的两条自纠，本轮继续沿用）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CODE_FONT_BASE,
  CODE_FONT_ZOOM_DEFAULT,
  CODE_FONT_ZOOM_MAX,
  CODE_FONT_ZOOM_MIN,
  applyCodeFontLineHeight,
  applyCodeFontZoom,
  clampCodeFontZoom,
  codeFontSize,
  codeFontSizeWithZoom,
  codeFontZoomFromAbsolutePx,
  codeLineHeight,
} from '../appearanceScales';
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

const SRC_ROOT = resolve(__dirname, '../..');
const THEME_STORE = resolve(SRC_ROOT, 'store/themeStore.ts');
const MONACO = resolve(SRC_ROOT, 'editor/panels/MonacoCodeEditor.tsx');
const APPEARANCE_STORE = resolve(SRC_ROOT, 'store/appearanceStore.ts');
const DRAWER = resolve(SRC_ROOT, 'components/layout/SettingsDrawer.tsx');
const CODE_FONT_HOOK = resolve(SRC_ROOT, 'hooks/useCodeFont.ts');

const read = (p: string) => readFileSync(p, 'utf-8');
/** 归一空白：源码扫描锁不许绑 prettier 的换行/缩进 */
const flat = (s: string) => s.replace(/\s+/g, ' ');
/** 剥掉注释再扫「不许出现 X」这类否定判据：注释里的历史说明不是代码（第 35 轮自纠） */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');

/** 递归列出 src 下全部源码文件（跳过测试：迁移键名在测试里必然还要出现） */
function srcFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      srcFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('代码字号微调 · 换算纯函数（单一真源）', () => {
  it('medium 档 + 0 步 = 迁移前那个数（老用户升级当天观感不变）', () => {
    expect(codeFontSizeWithZoom('editor', 'medium', CODE_FONT_ZOOM_DEFAULT)).toBe(CODE_FONT_BASE.editor);
    expect(codeFontSizeWithZoom('editor', 'medium')).toBe(13);
  });

  it('步数是在档位基准上加减，不是覆盖档位', () => {
    // 档位「大」时基准本身就大，微调只是叠加 —— 这正是第二十四轮把绝对 px 换成步数的理由
    expect(codeFontSizeWithZoom('editor', 'large', 2)).toBe(codeFontSize('editor', 'large') + 2);
    expect(codeFontSizeWithZoom('editor', 'small', 2)).toBe(codeFontSize('editor', 'small') + 2);
    expect(codeFontSizeWithZoom('editor', 'large', 2)).not.toBe(codeFontSizeWithZoom('editor', 'small', 2));
  });

  it('脏步数一律收敛：非法值回缺省档、越界钳到端点、小数就近取整', () => {
    expect(clampCodeFontZoom(undefined)).toBe(CODE_FONT_ZOOM_DEFAULT);
    expect(clampCodeFontZoom(null)).toBe(CODE_FONT_ZOOM_DEFAULT);
    expect(clampCodeFontZoom('abc')).toBe(CODE_FONT_ZOOM_DEFAULT);
    expect(clampCodeFontZoom(Number.NaN)).toBe(CODE_FONT_ZOOM_DEFAULT);
    expect(clampCodeFontZoom(Number.POSITIVE_INFINITY)).toBe(CODE_FONT_ZOOM_DEFAULT);
    expect(clampCodeFontZoom(999)).toBe(CODE_FONT_ZOOM_MAX);
    expect(clampCodeFontZoom(-999)).toBe(CODE_FONT_ZOOM_MIN);
    expect(clampCodeFontZoom('3')).toBe(3);
    expect(clampCodeFontZoom(2.6)).toBe(3);
    expect(clampCodeFontZoom(1.2)).toBe(1);
  });

  it('最终像素另有安全区间（步数已钳一次，这里防「大档位 + 正步数」冲出可读区）', () => {
    expect(applyCodeFontZoom(200, 5)).toBe(100);
    expect(applyCodeFontZoom(7, -6)).toBe(6);
    expect(applyCodeFontZoom(Number.NaN, 2)).toBe(CODE_FONT_BASE.editor);
  });

  it('行高与字号同源：微调一步行高也跟着走，不留「字号改了行高没改」的挤压', () => {
    const px = codeFontSizeWithZoom('editor', 'medium', 3);
    expect(applyCodeFontLineHeight(px)).toBe(px + 7);
    // 不传步数时与迁移前的 codeLineHeight 逐像素一致（这条是「老观感不变」的锁）
    expect(applyCodeFontLineHeight(codeFontSize('editor', 'large'))).toBe(codeLineHeight('editor', 'large'));
  });

  it('旧落点的绝对像素按 medium 基准折算成步数（绝不把绝对值直接当步数用）', () => {
    expect(codeFontZoomFromAbsolutePx(16)).toBe(3);
    expect(codeFontZoomFromAbsolutePx(13)).toBe(0);
    expect(codeFontZoomFromAbsolutePx(7)).toBe(CODE_FONT_ZOOM_MIN); // 折出 -6，钳在端点
    expect(codeFontZoomFromAbsolutePx('abc')).toBe(CODE_FONT_ZOOM_DEFAULT);
    // 反例：把绝对 px 当步数会用出 16px 的偏移，档位彻底被盖掉
    expect(codeFontZoomFromAbsolutePx(16)).not.toBe(16);
  });
});

describe('代码字号微调 · 落库清单同步（漏一处就又是一次「改完被旧值盖回」）', () => {
  const src = read(THEME_STORE);

  it('THEME_PERSISTED_FIELDS 里有 codeFontZoom —— 迟到读回按字段合并才认这一维', () => {
    const fields = flat(src).match(/const THEME_PERSISTED_FIELDS = \[(.*?)\] as const;/);
    expect(fields, '没扫到字段清单 = 这把锁自己失效').toBeTruthy();
    expect(fields![1]).toContain("'codeFontZoom'");
  });

  it('isSameThemeConfig 逐字段比了这一维（漏了会把「只改微调」的广播判成没变而跳过）', () => {
    expect(flat(src)).toMatch(/na\.codeFontZoom === nb\.codeFontZoom/);
  });

  it('归一化把这一维收进合法区间，默认值显式写了缺省步数', () => {
    expect(flat(src)).toMatch(/merged\.codeFontZoom = clampCodeFontZoom\(merged\.codeFontZoom\)/);
    expect(flat(src)).toMatch(/codeFontZoom: CODE_FONT_ZOOM_DEFAULT/);
  });

  it('内置外观预设一律不声明这一维（点预设不该顺手改掉创作者的手感）', () => {
    const profilesSrc = read(APPEARANCE_STORE);
    const builtInBlock = profilesSrc.slice(0, profilesSrc.indexOf('export interface AppearanceProfile'));
    expect(code(builtInBlock)).not.toContain('codeFontZoom');
  });

  it('反查预设按「声明了才算」的口径处理这一维（与 motion / uiFont 同一条尺）', () => {
    expect(flat(read(APPEARANCE_STORE))).toMatch(/declaredMatches\(t\.codeFontZoom,\s*theme\.codeFontZoom\)/);
  });
});

describe('代码字号微调 · 旧落点不许复活', () => {
  const files = srcFiles(SRC_ROOT);

  it('旧 localStorage 键名作为**代码**只出现在 themeStore 的迁移函数里', () => {
    // 先剥注释：appearanceScales 的文件头注释会提一句「旧落点是 ps.editor.fontZoom」，
    // 那是历史说明不是第二个落点（第 35 轮自纠：否定式判据不剥注释 = 迟早误报，误报的结局是被人删锁）
    const owners = files.filter((f) => /ps\.editor\.(fontZoom|fontSize)/.test(code(read(f))));
    expect(
      owners.map((f) => f.replace(`${SRC_ROOT}/`, '')),
      '旧键出现处 = 又开了第二个落点',
    ).toEqual(['store/themeStore.ts']);
  });

  it('Monaco 组件不再自己碰 localStorage（持久化整条交回 store）', () => {
    const monacoCode = code(read(MONACO));
    expect(monacoCode).not.toMatch(/localStorage\.(get|set|remove)Item/);
    expect(monacoCode).not.toMatch(/readFontZoom|persistFontZoom|clampFontZoom|resolveEditorFontSize/);
  });

  it('组件里不许再各写一份「字号 + 7」的行高间距', () => {
    // 否定式判据先剥注释：本轮之前的注释里就出现过 +7 的字样
    expect(code(read(MONACO))).not.toMatch(/lineHeight:\s*[\w.]+\s*\+\s*7/);
    expect(code(read(CODE_FONT_HOOK))).not.toMatch(/\+\s*7\s*[;,}]/);
  });

  it('消费点读的是设置库里的步数，不是组件内 state', () => {
    expect(flat(read(MONACO))).toMatch(/useCodeFont\(['"]editor['"],\s*codeFontZoom\)/);
    expect(flat(read(MONACO))).toMatch(/useThemeStore\(\(s\)\s*=>\s*s\.config\.codeFontZoom\)/);
    expect(flat(read(MONACO))).toMatch(/increaseFont: \(\) => useThemeStore\.getState\(\)\.adjustCodeFontZoom\(1\)/);
    expect(flat(read(MONACO))).toMatch(/resetFont: \(\) => useThemeStore\.getState\(\)\.setCodeFontZoom\(0\)/);
  });

  it('设置抽屉那一行显示的是换算后的真实 px，且加减走的也是 store', () => {
    const drawer = read(DRAWER);
    expect(flat(drawer)).toMatch(/\{codeFontPx\}px/);
    expect(flat(drawer)).toMatch(/onClick=\{\(\) => adjustCodeFontZoom\(-1\)\}/);
    expect(flat(drawer)).toMatch(/onClick=\{\(\) => adjustCodeFontZoom\(1\)\}/);
    // 不许在抽屉里自己算「基准 + 步数」：换算入口只允许在 appearanceScales
    expect(code(drawer)).not.toMatch(/codeFontBasePx\s*[+-]\s*codeFontZoom/);
  });
});

describe('代码字号微调 · 双语文案', () => {
  const keys = ['codeFontSize', 'codeFontSizeMinus', 'codeFontSizePlus', 'codeFontSizeReset', 'codeFontSizeHint'];

  /** 取 settings 那一节：走 unknown 中转而不许 as Record<...>（整包 JSON 有三级嵌套，直转 tsc 当场红） */
  const settingsOf = (pack: unknown) => (pack as { settings: Record<string, string> }).settings;

  it('中英两侧键数一致（少一边就是英文界面露出裸 key）', () => {
    for (const key of keys) {
      expect(settingsOf(zhCN)[key], `中文缺 ${key}`).toBeTruthy();
      expect(settingsOf(enUS)[key], `英文缺 ${key}`).toBeTruthy();
    }
  });

  it('占位符集合一致（少一个 {base} 界面就会显示残渣）', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const zh = settingsOf(zhCN).codeFontSizeHint;
    const en = settingsOf(enUS).codeFontSizeHint;
    expect(placeholders(en)).toBe(placeholders(zh));
    expect(placeholders(zh)).toBe('{base},{steps}');
  });
});
