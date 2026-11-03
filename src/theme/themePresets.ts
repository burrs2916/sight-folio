// sight-folio: 主题皮肤（preset）注册表 —— 「主题色彩」的唯一真源。
//
// 背景（第十三～十四轮遗留病灶）：主题色彩此前只覆盖 primary/secondary，页面底/卡片/
// 分割线由 AppTheme 写死（浅色底恒为米白 #FBF7EF、深色底恒为灰 900/800），再叠加侧边栏
// 选中底硬编码靛蓝、LibraryPage 局部主题硬编码靛蓝、设置面板色卡 default 显示蓝色
// #1976D2（与实际品牌紫 #4a338f 不符），导致用户「切主题色彩」在界面上几乎看不出变化，
// 误判成「开关坏了 / 其他主题都没有设置好」。
//
// 本模块把每个 preset 的「主色 + 辅助色 + 页面底色/卡片色 + 分割线」集中定义，浅色 /
// 深色各一套，由 AppTheme 统一注入 colorSchemes；设置面板色卡、LibraryPage 页面级局部
// 主题也都从这里取值，保证「色卡所见 = 实际生效值」。default preset 精确保持历史取值
// （米白底 + 品牌墨紫），做到零回归。

import { alpha } from '@mui/material/styles';
import { brand, gray, blue, green, orange, red, indigo } from './themePrimitives';
import { generatePalette, mixHex } from './colorUtils';
import { ensureContrast, resolveContrastText, WCAG } from './contrast';
import type { PaletteColor } from './colorUtils';
import type { ThemePreset } from '../store/themeStore';

/** 单个 preset 在某一明暗下的色板切面（其余语义色由 buildColorSchemes 统一补齐） */
export interface PresetPalette {
  /** 主色（驱动按钮/链接/选中指示条/焦点环等） */
  primary: PaletteColor;
  /** 辅助色 */
  secondary: PaletteColor;
  /** 页面底色 + 卡片色 —— 皮肤差异最直观的载体 */
  background: { default: string; paper: string };
  /** 分割线 */
  divider: string;
}

export interface ThemePresetDefinition {
  /** 设置面板色卡展示色：内置 preset 即实际生效的浅色主色（custom 为渐变占位） */
  swatch: string;
  light: PresetPalette;
  dark: PresetPalette;
}

/** 统一的辅助色（灰阶，不随 preset 变——避免与主色抢视觉） */
const SECONDARY: PaletteColor = {
  light: gray[300],
  main: gray[500],
  dark: gray[700],
  contrastText: '#ffffff',
};

/** 深色底由「中性深灰 + 少量 preset 主色」混合而来：既有可辨色相，又保持深色可读性。
 *  权重 0.86 表示保留 86% 中性灰、掺入 14% 主色。 */
const DARK_TINT = 0.86;

/** 设置面板 preset 展示顺序（也是 themeStore 归一化认的合法色板全集） */
export const PRESET_ORDER: ThemePreset[] = [
  'default',
  'blue',
  'green',
  'orange',
  'purple',
  'indigo',
  'teal',
  'rose',
  'slate',
  'custom',
];

export const THEME_PRESETS: Record<Exclude<ThemePreset, 'custom'>, ThemePresetDefinition> = {
  // 品牌墨紫 + 米白暖底：历史默认外观，取值与改版前逐字段一致（零回归基线）
  default: {
    swatch: brand[700],
    light: {
      primary: { light: brand[300], main: brand[700], dark: brand[800], contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#FBF7EF', paper: '#ffffff' },
      divider: alpha(gray[300], 0.4),
    },
    dark: {
      primary: { light: brand[200], main: brand[300], dark: brand[400], contrastText: brand[900] },
      secondary: SECONDARY,
      background: { default: gray[900], paper: gray[800] },
      divider: alpha(gray[700], 0.6),
    },
  },
  // 湖蓝
  blue: {
    swatch: blue[600],
    light: {
      primary: { light: blue[300], main: blue[600], dark: blue[800], contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: blue[50], paper: '#ffffff' },
      divider: alpha(blue[300], 0.5),
    },
    dark: {
      primary: { light: blue[200], main: blue[300], dark: blue[400], contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], blue[600], 1 - DARK_TINT),
        paper: mixHex(gray[800], blue[600], 1 - DARK_TINT),
      },
      divider: alpha(blue[700], 0.5),
    },
  },
  // 松绿
  green: {
    // 浅色主色用 700 档（#047857，压白字 5.48）而非 600 档（#059669 仅 3.77）：
    // 色卡与生效主色同源（见 themePresets.test 的「色卡所见 = 生效值」锁），故两处一起改。
    swatch: green[700],
    light: {
      primary: { light: green[300], main: green[700], dark: green[800], contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: green[50], paper: '#ffffff' },
      divider: alpha(green[300], 0.45),
    },
    dark: {
      primary: { light: green[200], main: green[300], dark: green[400], contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], green[600], 1 - DARK_TINT),
        paper: mixHex(gray[800], green[600], 1 - DARK_TINT),
      },
      divider: alpha(green[800], 0.5),
    },
  },
  // 品牌金（暖橙）
  orange: {
    swatch: orange[600],
    light: {
      primary: { light: orange[300], main: orange[600], dark: orange[800], contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: orange[50], paper: '#ffffff' },
      divider: alpha(orange[300], 0.45),
    },
    dark: {
      primary: { light: orange[200], main: orange[300], dark: orange[400], contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], orange[600], 1 - DARK_TINT),
        paper: mixHex(gray[800], orange[600], 1 - DARK_TINT),
      },
      divider: alpha(orange[800], 0.5),
    },
  },
  // 紫罗兰：与 default（墨紫 #4a338f）刻意拉开色相/明度差异，避免「切了看不出」的老问题
  purple: {
    swatch: '#7c3aed',
    light: {
      primary: { light: '#a78bfa', main: '#7c3aed', dark: '#5b21b6', contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#f7f4ff', paper: '#ffffff' },
      divider: alpha('#c4b5fd', 0.55),
    },
    dark: {
      primary: { light: '#c4b5fd', main: '#a78bfa', dark: '#7c3aed', contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], '#7c3aed', 1 - DARK_TINT),
        paper: mixHex(gray[800], '#7c3aed', 1 - DARK_TINT),
      },
      divider: alpha('#5b21b6', 0.5),
    },
  },
  // 现代工作台靛蓝：沿用 LibraryPage 原局部主题的灰蓝底 + 白卡，改为全局 preset 提供
  indigo: {
    swatch: indigo[600],
    light: {
      primary: { light: indigo[400], main: indigo[600], dark: indigo[700], contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#f4f6fb', paper: '#ffffff' },
      divider: '#e2e8f0',
    },
    dark: {
      primary: { light: indigo[200], main: indigo[300], dark: indigo[400], contrastText: gray[900] },
      secondary: SECONDARY,
      background: { default: '#0f1420', paper: '#171e2e' },
      divider: '#334155',
    },
  },
  // ── 第二十三轮扩充的三套 ────────────────────────────────────────────────
  // 扩充口径与既有 6 套一致：主色 + 页面底 + 卡片底 + 分割线一起换（自定义主色只换主色，
  // 换不了底，所以才需要成套色板）。浅色主色一律挑「压白字 ≥ 4.5:1」的那一档，
  // 色卡所见 = 生效值（由 themePresets.test 的「两两不同 / 同源」锁兜住「切了看不出」）。
  // 青碧：比 green（松绿 #047857）更冷、更透，长时间看不胀眼
  teal: {
    swatch: '#0f766e',
    light: {
      primary: { light: '#5eead4', main: '#0f766e', dark: '#115e59', contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#f0fbfa', paper: '#ffffff' },
      divider: alpha('#99f6e4', 0.7),
    },
    dark: {
      primary: { light: '#99f6e4', main: '#5eead4', dark: '#2dd4bf', contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], '#0f766e', 1 - DARK_TINT),
        paper: mixHex(gray[800], '#0f766e', 1 - DARK_TINT),
      },
      divider: alpha('#115e59', 0.6),
    },
  },
  // 蔷薇：红相但不做「错误红」，与状态色 error(red) 拉开明度，避免「主色看着像报错」
  rose: {
    swatch: '#be123c',
    light: {
      primary: { light: '#fb7185', main: '#be123c', dark: '#9f1239', contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#fff5f6', paper: '#ffffff' },
      divider: alpha('#fecdd3', 0.75),
    },
    dark: {
      primary: { light: '#fda4af', main: '#fb7185', dark: '#f43f5e', contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], '#be123c', 1 - DARK_TINT),
        paper: mixHex(gray[800], '#be123c', 1 - DARK_TINT),
      },
      divider: alpha('#9f1239', 0.55),
    },
  },
  // 石墨：中性无彩，给「不想要任何色相」的创作者；深底用字面量而非掺主色，
  // 掺一个本身偏灰的主色只会得到与 default 深底几乎同值的另一套（切了看不出）
  slate: {
    swatch: '#475569',
    light: {
      primary: { light: '#94a3b8', main: '#475569', dark: '#334155', contrastText: '#ffffff' },
      secondary: SECONDARY,
      background: { default: '#f5f7fa', paper: '#ffffff' },
      divider: '#dfe4ec',
    },
    dark: {
      primary: { light: '#cbd5e1', main: '#94a3b8', dark: '#64748b', contrastText: gray[900] },
      secondary: SECONDARY,
      background: { default: '#141b24', paper: '#1d2531' },
      divider: '#333f4f',
    },
  },
};

/** custom preset 缓存：同一个自定义主色只构造一次，避免 useMemo 依赖抖动导致主题反复重建 */
const customCache = new Map<string, ThemePresetDefinition>();

function buildCustomPreset(customPrimary?: string): ThemePresetDefinition {
  const base = customPrimary && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(customPrimary) ? customPrimary : brand[700];
  const cached = customCache.get(base);
  if (cached) return cached;

  const palette = generatePalette(base);
  const def: ThemePresetDefinition = {
    swatch: `linear-gradient(135deg, ${palette.main} 0%, ${palette.dark} 100%)`,
    light: {
      primary: palette,
      secondary: SECONDARY,
      // 极浅同色相底：主色只掺入 6%，保证文字对比度不受影响
      background: { default: mixHex('#ffffff', base, 0.06), paper: '#ffffff' },
      divider: alpha(base, 0.22),
    },
    dark: {
      // 深色下主色取 generatePalette 的 light 档作为 main，保证在深底上仍可辨识
      primary: { light: palette.light, main: palette.light, dark: palette.main, contrastText: gray[900] },
      secondary: SECONDARY,
      background: {
        default: mixHex(gray[900], base, 1 - DARK_TINT),
        paper: mixHex(gray[800], base, 1 - DARK_TINT),
      },
      divider: alpha(base, 0.35),
    },
  };
  customCache.set(base, def);
  return def;
}

/** preset → 色板定义（custom 由 customPrimary 动态生成） */
export function resolvePreset(preset: ThemePreset, customPrimary?: string): ThemePresetDefinition {
  if (preset === 'custom') return buildCustomPreset(customPrimary);
  return THEME_PRESETS[preset] ?? THEME_PRESETS.default;
}

/** 设置面板色卡颜色（与主题实际生效值同源） */
export function getPresetSwatch(preset: ThemePreset, customPrimary?: string): string {
  return resolvePreset(preset, customPrimary).swatch;
}

/**
 * 由 preset 组装完整的 MUI colorSchemes（含 info/warning/error/success/grey/action 等
 * 非 preset 语义色，保持历史取值不变）。default preset 的结果与改版前逐字段一致。
 */
export function buildColorSchemes(preset: ThemePreset, customPrimary?: string) {
  const def = resolvePreset(preset, customPrimary);
  return {
    light: buildScheme(def.light, 'light'),
    dark: buildScheme(def.dark, 'dark'),
  };
}

/**
 * 彩色底上的前景统一派生口径。
 *
 * 规则是「声明值达标即保留，不达标才退到可读候选」：这样历史外观（如 default 的白字紫底）
 * 一分不改，而真正不可读的组合（如品牌金主色 #c98f2a 压白字只有 2.8:1、深色方案下
 * info/warning/error/success 取 500 档压白字只有 2.5～3.8:1）自动换成 #111827 ——
 * 否则深色主题里所有按钮/徽章上的字都糊成一片，而这正是「文字颜色随背景联动」的落点之一。
 */
function readable(color: PaletteColor): PaletteColor {
  return { ...color, contrastText: resolveContrastText(color.main, color.contrastText) };
}

// 注意：这里刻意不写返回类型注解 —— palette 里含自定义键 baseShadow（MUI 未在
// PaletteOptions 上声明、只增强到 Palette），annotation 会触发多余属性检查；
// 由 TS 推断即可（下游用变量传入 createTheme，不做字面量多余属性检查）。
function buildScheme(slice: PresetPalette, mode: 'light' | 'dark') {
  const isLight = mode === 'light';
  return {
    palette: {
      primary: readable(slice.primary),
      secondary: readable(slice.secondary),
      info: readable({
        light: blue[300],
        main: isLight ? blue[600] : blue[500],
        dark: isLight ? blue[800] : blue[700],
        contrastText: '#ffffff',
      }),
      warning: readable({
        light: orange[300],
        main: isLight ? orange[800] : orange[500],
        dark: isLight ? orange[900] : orange[700],
        contrastText: '#ffffff',
      }),
      error: readable({
        light: red[300],
        main: isLight ? red[600] : red[500],
        dark: isLight ? red[800] : red[700],
        contrastText: '#ffffff',
      }),
      success: readable({
        light: green[300],
        main: isLight ? green[700] : green[500],
        dark: isLight ? green[800] : green[700],
        contrastText: '#ffffff',
      }),
      grey: { ...gray },
      divider: slice.divider,
      background: slice.background,
      // 区域文字同样「由背景深度派生」而非只按明暗二选一：声明值是历史起点，
      // 一旦某个 preset 的卡片底更浅 / 更深让它掉到 4.5:1 以下，就在此沿黑白方向校正。
      // 现网 6 套 preset 的声明值全部达标，故取值为历史值原样 → 零回归。
      // 取「卡片底」作基准：浅色下它比页面底更亮、深色下比页面底更暗，是两种模式里更难的一侧。
      text: isLight
        ? {
            primary: ensureContrast(gray[800], slice.background.paper, WCAG.AA_TEXT),
            secondary: ensureContrast(gray[600], slice.background.paper, WCAG.AA_TEXT),
          }
        : {
            primary: ensureContrast('#f9fafb', slice.background.paper, WCAG.AA_TEXT),
            secondary: ensureContrast(gray[400], slice.background.paper, WCAG.AA_TEXT),
          },
      action: isLight
        ? { hover: alpha(gray[200], 0.2), selected: alpha(gray[200], 0.3) }
        : { hover: alpha(gray[600], 0.2), selected: alpha(gray[600], 0.3) },
      baseShadow: isLight
        ? '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)'
        : '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
    },
  };
}
