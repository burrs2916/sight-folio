// 外观档位单一真源回归锁（第十八轮）
//
// 用户诉求：「右侧设置抽屉的外观预设、颜色模式、主题色彩、字体大小、圆角风格、布局预设
// 都要确保设置完成后生效」。
//
// 病灶（可在 git 历史里定位）：档位换算散落在三处且各有断链——
//  ① AppTheme 只写 `typography.fontSize`（unitless），而 themePrimitives 的全部 variant 用
//     pxToRem() 定死 rem ⇒ 切「字体大小」正文/标题纹丝不动；
//  ② SideMenu 写死 240/64，`layoutStore.sidebarWidth` 全项目零消费 ⇒ 「标准」与「宽屏」
//     渲染完全相同；
//  ③ contentPadding / navbarStyle 的档位值在 App.tsx 另写一份 map，面板预览与实际取值易失焦。
// 本文件把档位 → 数值/变量 的映射全部锁住，任何一处改档位都不会悄悄失去生效链路。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BORDER_RADIUS_BASE,
  CODE_FONT_BASE,
  CONTENT_PADDING_PX,
  FONT_SIZE_BASE,
  FONT_SIZE_SCALE,
  NAVBAR_HEIGHT_PX,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH_RANGE,
  appearanceCssVars,
  clampSidebarWidth,
  codeFontSize,
  codeLineHeight,
  scaleTypography,
} from '../appearanceScales';

const FONT_SIZES = ['small', 'medium', 'large'] as const;
const RADII = ['none', 'small', 'medium'] as const;

describe('字体大小档位', () => {
  it('三档基准字号递增，且 medium 为设计基准 14', () => {
    expect(FONT_SIZE_SCALE.medium).toBe(1);
    expect(FONT_SIZE_BASE.small).toBeLessThan(FONT_SIZE_BASE.medium);
    expect(FONT_SIZE_BASE.medium).toBeLessThan(FONT_SIZE_BASE.large);
  });

  it('缩放系数 = 基准字号 / medium 基准（与 shape 一致，面板预览可据此标注真实 px）', () => {
    for (const size of FONT_SIZES) {
      expect(FONT_SIZE_SCALE[size]).toBeCloseTo(FONT_SIZE_BASE[size] / FONT_SIZE_BASE.medium, 3);
    }
  });

  it('scaleTypography 等比缩放 rem variant（这是「字号真正生效」的关键）', () => {
    const variants = {
      h1: { fontSize: '3rem', fontWeight: 600 },
      body1: { fontSize: '1rem', lineHeight: 1.6 },
      caption: { fontSize: '0.75rem' },
      button: { textTransform: 'none' },
    };
    const scaled = scaleTypography(variants, 1.5);
    expect(scaled.h1.fontSize).toBe('4.5rem');
    expect(scaled.body1.fontSize).toBe('1.5rem');
    expect(scaled.caption.fontSize).toBe('1.125rem');
    // 非字号声明原样保留（不能把 fontWeight / lineHeight 抹掉）
    expect(scaled.h1.fontWeight).toBe(600);
    expect(scaled.body1.lineHeight).toBe(1.6);
    // 没有 fontSize 的 variant 不动
    expect(scaled.button).toEqual({ textTransform: 'none' });
  });

  it('系数 1 时返回同一对象引用（medium 档零开销、零改写）', () => {
    const variants = { body1: { fontSize: '1rem' } };
    expect(scaleTypography(variants, 1)).toBe(variants);
  });

  it('数字型 fontSize 也按系数缩放（兼容 unitless variant）', () => {
    expect(scaleTypography({ x: { fontSize: 10 } }, 2).x.fontSize).toBe(20);
  });
});

describe('圆角档位（2026-11-03 改版：三固定档 + 自定义数值档）', () => {
  it('三档基准圆角单调不减，none 恒为 0；旧大圆/全圆由自定义数值承接', () => {
    expect(BORDER_RADIUS_BASE.none).toBe(0);
    for (let i = 1; i < RADII.length; i++) {
      expect(BORDER_RADIUS_BASE[RADII[i]]).toBeGreaterThanOrEqual(BORDER_RADIUS_BASE[RADII[i - 1]]);
    }
  });

  it('圆角只有一份档位表：主题注入与设置抽屉预览同读 BORDER_RADIUS_BASE', () => {
    const root = process.cwd();
    const appTheme = readFileSync(`${root}/src/theme/AppTheme.tsx`, 'utf8');
    const drawer = readFileSync(`${root}/src/components/layout/SettingsDrawer.tsx`, 'utf8');
    // 注入点与预览点都必须走唯一口径 radiusBasePx（改版后 custom 档没有查表值，
    // 谁再手写 `BORDER_RADIUS_BASE[...]` 就是把生效值和预览值拆成两份数）
    expect(appTheme).toMatch(/radiusBasePx\(\{ borderRadius, borderRadiusCustom \}\)/);
    expect(drawer).toMatch(/radiusBasePx\(\{ borderRadius: opt\.id/);
    expect(appTheme).not.toMatch(/BORDER_RADIUS_BASE\[/);
    expect(drawer).not.toMatch(/BORDER_RADIUS_BASE\[/);
    // 第二十二轮删掉的五级 token 表不得回潮：它和 shape 基准是两份数（当初 .md 恰好相等，
    // 其余四级全仓零消费），留着迟早漂移成「改了不生效」。
    const scales = readFileSync(`${root}/src/theme/appearanceScales.ts`, 'utf8');
    expect(scales).not.toMatch(/export const BORDER_RADIUS_TOKENS/);
    expect(drawer).not.toMatch(/BORDER_RADIUS_TOKENS/);
  });
});

describe('外观 CSS 变量注入', () => {
  it('档位 → 字号缩放变量（静态 CSS 唯一消费的入口）', () => {
    const vars = appearanceCssVars({ fontSize: 'large' });
    expect(parseFloat(vars['--app-font-scale'])).toBeCloseTo(FONT_SIZE_SCALE.large, 3);
    expect(vars['--app-font-size-base']).toBe(`${FONT_SIZE_BASE.large}px`);
  });

  // 第三十一轮翻转的断言（依据须与实现同刀记账）：旧断言 `toHaveLength(2)` 封死了圆角变量，
  // 理由写着「MUI 已注入 --template-shape-borderRadius」—— 该前提经实测只对了一半：变量确实存在
  // （本仓 cssVarPrefix 配的是 'template'），但它依赖 MUI 内部配置，两轮审计因此各说各话。
  // 现在圆角档位由本仓自己的 --app-radius-base 承载，渲染锁见 radiusChannelRound31.test.tsx。
  it('--app-radius-base 随圆角档位取 radiusBasePx 的值（非 MUI 区的唯一跟随入口）', () => {
    for (const radius of RADII) {
      expect(appearanceCssVars({ fontSize: 'medium', borderRadius: radius })['--app-radius-base']).toBe(
        `${BORDER_RADIUS_BASE[radius]}px`,
      );
    }
    // custom 档：数值直通；缺数值回落缺省 6；越界钳到 20 —— 档位与主题注入、抽屉预览同源同表
    expect(
      appearanceCssVars({ fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 9 })['--app-radius-base'],
    ).toBe('9px');
    expect(appearanceCssVars({ fontSize: 'medium', borderRadius: 'custom' })['--app-radius-base']).toBe('6px');
    expect(
      appearanceCssVars({ fontSize: 'medium', borderRadius: 'custom', borderRadiusCustom: 99 })['--app-radius-base'],
    ).toBe('20px');
  });

  it('未声明圆角档时回落 medium（老设置库没有该字段也不炸）', () => {
    expect(appearanceCssVars({ fontSize: 'medium' })['--app-radius-base']).toBe(`${BORDER_RADIUS_BASE.medium}px`);
    expect(appearanceCssVars({ fontSize: 'medium', borderRadius: 'huge' as never })['--app-radius-base']).toBe(
      `${BORDER_RADIUS_BASE.medium}px`,
    );
  });

  it('脏档位回落到 medium（设置库被手改时不炸渲染层）', () => {
    const vars = appearanceCssVars({ fontSize: 'huge' as never });
    expect(vars['--app-font-scale']).toBe('1');
    expect(vars['--app-font-size-base']).toBe('14px');
  });

  it('注入表只有「真的有人读」的三项（死变量回潮即红）', () => {
    expect(Object.keys(appearanceCssVars({ fontSize: 'medium', borderRadius: 'medium' })).sort()).toEqual([
      '--app-font-scale',
      '--app-font-size-base',
      '--app-radius-base',
    ]);
  });
});

describe('布局档位', () => {
  it('内容留白四档齐全、递增、none 为 0', () => {
    expect(CONTENT_PADDING_PX.none).toBe('0px');
    const px = (['none', 'small', 'medium', 'large'] as const).map((k) => parseInt(CONTENT_PADDING_PX[k], 10));
    expect(px).toEqual([...px].sort((a, b) => a - b));
  });

  it('顶栏两档：slim 严格低于 standard（否则切档无视觉效果）', () => {
    expect(NAVBAR_HEIGHT_PX.slim).toBeLessThan(NAVBAR_HEIGHT_PX.standard);
  });

  it('侧栏宽度收敛到合法区间，脏值回默认', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_WIDTH_RANGE.min);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH_RANGE.max);
    expect(clampSidebarWidth(250)).toBe(250);
    expect(clampSidebarWidth('abc')).toBe(240);
    expect(clampSidebarWidth(undefined)).toBe(240);
    expect(SIDEBAR_COLLAPSED_WIDTH).toBeLessThan(SIDEBAR_WIDTH_RANGE.min);
  });
});

describe('渲染层真的读这些档位（防止「只存不读」回潮）', () => {
  const root = process.cwd();
  const sideMenu = readFileSync(`${root}/src/components/layout/SideMenu.tsx`, 'utf8');
  const navbar = readFileSync(`${root}/src/components/layout/AppNavbar.tsx`, 'utf8');
  const app = readFileSync(`${root}/src/App.tsx`, 'utf8');
  const appTheme = readFileSync(`${root}/src/theme/AppTheme.tsx`, 'utf8');

  it('SideMenu 宽度取自 config.sidebarWidth（不再写死 240）', () => {
    expect(sideMenu).toMatch(/expandedWidth=\{config\.sidebarWidth\}/);
    expect(sideMenu).not.toMatch(/const DRAWER_WIDTH = 240/);
  });

  it('SideMenu 消费 sidebarPosition（左右换位）', () => {
    expect(sideMenu).toMatch(/sidebarPosition === 'right'/);
    expect(app).toMatch(/sidebarPosition === 'right'/);
  });

  it('AppNavbar 消费 navbarStyle（slim 高度 + 收纳）', () => {
    expect(navbar).toMatch(/config\.navbarStyle === 'slim'/);
    expect(navbar).toMatch(/NAVBAR_HEIGHT_PX/);
  });

  it('App 主区 padding 取自档位表；AppTheme 按系数缩放 variant 并注入 CSS 变量', () => {
    expect(app).toMatch(/CONTENT_PADDING_PX\[layoutConfig\?\.contentPadding\]/);
    expect(appTheme).toMatch(/scaleTypography\(typography, fontScale\)/);
    expect(appTheme).toMatch(/appearanceCssVars/);
  });
});

// ─── 代码区字号（第二十四轮）─────────────────────────────────────────────────
// 病灶：字号档位只进 MUI 主题树，Monaco / xterm 各写死一个数字（编辑器 13、diff 13/12、终端 12），
// 于是「设置 → 字体大小」对代码编辑器、差异对照、集成终端**完全不生效**。
// 本组锁两件事：① 换算口径（medium 档 = 硬编码时代的原值，升级当天观感不变）；
// ② 每个消费点确实经 useCodeFont 读这条通道，而不是各写各的。
describe('代码区字号：字号档位覆盖到非 MUI 渲染区', () => {
  const CODE_ROLES = ['editor', 'diff', 'inlineDiff', 'terminal', 'compact'] as const;
  const root = process.cwd();

  it('medium 档就是各角色原来的硬编码值（老用户观感不变）', () => {
    expect(codeFontSize('editor', 'medium')).toBe(CODE_FONT_BASE.editor);
    expect(codeFontSize('diff', 'medium')).toBe(CODE_FONT_BASE.diff);
    expect(codeFontSize('terminal', 'medium')).toBe(CODE_FONT_BASE.terminal);
    expect(codeFontSize('compact', 'medium')).toBe(CODE_FONT_BASE.compact);
  });

  it('三档 × 全角色：小 ≤ 中 ≤ 大 且小档真的小于大档，取整并落在可读区间', () => {
    for (const role of CODE_ROLES) {
      const small = codeFontSize(role, 'small');
      const medium = codeFontSize(role, 'medium');
      const large = codeFontSize(role, 'large');
      expect(small <= medium, `${role} 档位顺序`).toBe(true);
      expect(medium <= large, `${role} 档位顺序`).toBe(true);
      expect(small < large, `${role} 小档必须真的小于大档（否则切档看不见变化）`).toBe(true);
      for (const px of [small, medium, large]) {
        expect(Number.isInteger(px), `${role} 字号必须是整数 px`).toBe(true);
        expect(px >= 10 && px <= 22, `${role} 字号越出可读区间`).toBe(true);
      }
    }
  });

  it('行高跟着字号一起缩放：只放大字号不放大行高 = 代码挤成一团', () => {
    for (const size of FONT_SIZES) {
      expect(codeLineHeight('editor', size)).toBe(codeFontSize('editor', size) + 7);
    }
  });

  it('Monaco / xterm 六个消费点都经 useCodeFont 读档位', () => {
    const files: [string, string][] = [
      ['MonacoCodeEditor', 'src/editor/panels/MonacoCodeEditor.tsx'],
      ['MonacoDiffEditor', 'src/editor/panels/MonacoDiffEditor.tsx'],
      ['ChangeReviewBar', 'src/editor/panels/ChangeReviewBar.tsx'],
      ['InlineChat', 'src/editor/panels/InlineChat.tsx'],
      ['WorkbenchAiPanel', 'src/editor/panels/WorkbenchAiPanel.tsx'],
      ['WorkbenchTerminalPane', 'src/editor/panels/WorkbenchTerminalPane.tsx'],
    ];
    for (const [name, rel] of files) {
      const src = readFileSync(`${root}/${rel}`, 'utf8');
      expect(src.includes('useCodeFont'), `${name} 必须经 useCodeFont 读字号档位`).toBe(true);
    }
    // 各消费点把钩子读数真的接到了编辑器的字号参数上（而不是读了不用）
    const monaco = readFileSync(`${root}/src/editor/panels/MonacoCodeEditor.tsx`, 'utf8');
    expect(monaco).toMatch(/fontSize: editorFontSize/);
    // 第三十六轮改口径：行高不再于组件里写「字号 + 7」，而是与字号同取自 useCodeFont 的读数
    //（+7 那个间距收进 theme/appearanceScales 一处）。判据强度没降：仍然要求行高**跟着字号走**，
    // 只是不许在消费点各写一份间距 —— 这正是本文件文件头那条「换算只许有一处」的原意。
    expect(monaco).toMatch(/lineHeight: codeFont\.lineHeight/);
    expect(monaco).not.toMatch(/lineHeight:\s*[\w.]+\s*\+\s*7/);
    expect(readFileSync(`${root}/src/theme/appearanceScales.ts`, 'utf8')).toMatch(
      /export function applyCodeFontLineHeight/,
    );
    // 档位是编辑器字号的唯一来源：旧的「localStorage 绝对 px 覆盖 options」链路必须已拆除
    expect(monaco).not.toMatch(/readPersistedFontSize/);
    const diff = readFileSync(`${root}/src/editor/panels/MonacoDiffEditor.tsx`, 'utf8');
    expect(diff).toMatch(/fontSize: codeFont\.fontSize/);
    const review = readFileSync(`${root}/src/editor/panels/ChangeReviewBar.tsx`, 'utf8');
    expect(review).toMatch(/fontSize: compactDiffFont\.fontSize/);
    expect(review).toMatch(/fontSize: inlineDiffFont\.fontSize/);
    const inline = readFileSync(`${root}/src/editor/panels/InlineChat.tsx`, 'utf8');
    expect(inline).toMatch(/fontSize: inlineDiffFont\.fontSize/);
    const ai = readFileSync(`${root}/src/editor/panels/WorkbenchAiPanel.tsx`, 'utf8');
    expect(ai).toMatch(/fontSize: inlineDiffFont\.fontSize/);
    const term = readFileSync(`${root}/src/editor/panels/WorkbenchTerminalPane.tsx`, 'utf8');
    expect(term).toMatch(/fontSize: codeFontRef\.current/);
    // 已开着的终端要就地跟随档位（只改构造参数 = 只有新开 tab 生效）
    expect(term).toMatch(/options\.fontSize = codeFont\.fontSize/);
  });

  it('状态栏 ± 存的是「相对档位的步数」，旧的绝对 px 键会被折算迁移', () => {
    // 口径迁移（第三十六轮）：这条锁原本盯的是 MonacoCodeEditor 里的那份 localStorage。
    // 本轮把同一份步数搬进设置库 theme 域，**判据一字未减**，只是权威位置换了：
    // ① 仍然存「相对步数」而不是绝对 px；② 旧 px 键仍然折算成步数；③ 读完仍然立刻清键。
    // 为什么必须跟着挪而不许留旧断言：旧落点留着第二个读写点才是本轮要消灭的东西
    //（那一份不在设置备份 / 不参与恢复默认 / 不跨窗口），锁留在旧位置等于把病灶钉死。
    // 同一条不变量的新落点另有两把锁：settingsRound36（旧键全仓只此一处 + 组件不碰 localStorage）
    // 与 codeFontZoomRound36（落库 / 复位 / 迁移的端到端行为）。
    const themeStore = readFileSync(`${root}/src/store/themeStore.ts`, 'utf8');
    expect(themeStore).toMatch(/ps\.editor\.fontZoom/);
    expect(themeStore).toMatch(/ps\.editor\.fontSize/);
    // 旧键读到即折算成步数并清掉：留着它，档位就会被旧绝对值重新盖住
    expect(themeStore).toMatch(/localStorage\.removeItem\(LEGACY_CODE_FONT_PX_KEY\)/);
    expect(themeStore).toMatch(/codeFontZoomFromAbsolutePx/);

    // 消费侧仍然只吃「档位基准 + 步数」，而不是自己存一份绝对字号
    const monaco = readFileSync(`${root}/src/editor/panels/MonacoCodeEditor.tsx`, 'utf8');
    expect(monaco).toMatch(/useCodeFont\(['"]editor['"], codeFontZoom\)/);
    expect(monaco).toMatch(/increaseFont: \(\) => useThemeStore\.getState\(\)\.adjustCodeFontZoom\(1\)/);
    const scales = readFileSync(`${root}/src/theme/appearanceScales.ts`, 'utf8');
    expect(scales).toMatch(/export function clampCodeFontZoom/);
    expect(scales).toMatch(/export function applyCodeFontZoom/);
  });
});
