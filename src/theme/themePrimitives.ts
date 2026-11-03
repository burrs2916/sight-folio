import { createTheme, Shadows } from '@mui/material/styles';

declare module '@mui/material/Paper' {
  interface PaperPropsVariantOverrides {
    highlighted: true;
  }
}

declare module '@mui/material/styles' {
  interface ColorRange {
    50: string;
    100: string;
    200: string;
    300: string;
    400: string;
    500: string;
    600: string;
    700: string;
    800: string;
    900: string;
  }

  interface PaletteColor extends ColorRange {}

  interface Palette {
    baseShadow: string;
  }
}

const defaultTheme = createTheme();

export const brand = {
  50: '#f4f0fb',
  100: '#e8def7',
  200: '#d4c2ee',
  300: '#b99fdf',
  400: '#9d7bd0',
  500: '#8158be',
  600: '#68409f',
  700: '#4a338f',
  800: '#3a286f',
  900: '#2a1e52',
};

export const gray = {
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
};

export const green = {
  50: '#ecfdf5',
  100: '#d1fae5',
  200: '#a7f3d0',
  300: '#6ee7b7',
  400: '#34d399',
  500: '#10b981',
  600: '#059669',
  700: '#047857',
  800: '#065f46',
  900: '#064e3b',
};

// 金 accent ramp — 作为 Sight Folio 的暖色点缀（warning 语义沿用，视觉上即品牌金）
export const orange = {
  50: '#fcf5e4',
  100: '#f8e8c4',
  200: '#f1d18e',
  300: '#eabe5e',
  400: '#e4ac47',
  500: '#e0a93b',
  600: '#c98f2a',
  700: '#a87221',
  800: '#875b1c',
  900: '#6e4918',
};

export const red = {
  50: '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',
  700: '#b91c1c',
  800: '#991b1b',
  900: '#7f1d1d',
};

export const blue = {
  50: '#eff6ff',
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',
};

// 靛蓝 ramp — 现代工作台靛蓝主题的主色体系（LibraryPage 靛蓝 preset）
export const indigo = {
  50: '#eef2ff',
  100: '#e0e7ff',
  200: '#c7d2fe',
  300: '#a5b4fc',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#3730a3',
  900: '#312e81',
};

/**
 * 界面字体「跟随系统」档的字体栈（第二十三轮收口为具名常量）。
 *
 * 这是全仓「UI 字体」的历史取值：新增「界面字体」设置项后，`system` 档必须逐字符等于这串，
 * 否则升级当天所有人的界面字族会被静默换掉（本仓反复在清的那类「改 A 设置顺手改了 B」）。
 * 消费方：本文件的默认读数 + theme/appearanceScales 的 UI_FONT_STACKS.system，
 * 实际注入点 theme/AppTheme.tsx 按档位取后者。
 */
export const UI_FONT_STACK_SYSTEM =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const typography = {
  fontFamily: UI_FONT_STACK_SYSTEM,
  h1: {
    fontSize: defaultTheme.typography.pxToRem(48),
    fontWeight: 600,
    lineHeight: 1.25,
    letterSpacing: -0.02,
  },
  h2: {
    fontSize: defaultTheme.typography.pxToRem(36),
    fontWeight: 600,
    lineHeight: 1.25,
  },
  h3: {
    fontSize: defaultTheme.typography.pxToRem(30),
    fontWeight: 600,
    lineHeight: 1.25,
  },
  h4: {
    fontSize: defaultTheme.typography.pxToRem(24),
    fontWeight: 600,
    lineHeight: 1.5,
  },
  h5: {
    fontSize: defaultTheme.typography.pxToRem(20),
    fontWeight: 600,
    lineHeight: 1.5,
  },
  h6: {
    fontSize: defaultTheme.typography.pxToRem(18),
    fontWeight: 600,
    lineHeight: 1.6,
  },
  subtitle1: {
    fontSize: defaultTheme.typography.pxToRem(18),
    lineHeight: 1.6,
  },
  subtitle2: {
    fontSize: defaultTheme.typography.pxToRem(14),
    fontWeight: 500,
    lineHeight: 1.6,
  },
  body1: {
    fontSize: defaultTheme.typography.pxToRem(16),
    lineHeight: 1.6,
  },
  body2: {
    fontSize: defaultTheme.typography.pxToRem(14),
    fontWeight: 400,
    lineHeight: 1.6,
  },
  caption: {
    fontSize: defaultTheme.typography.pxToRem(12),
    fontWeight: 400,
    lineHeight: 1.5,
  },
  button: {
    textTransform: 'none',
    fontWeight: 500,
  },
};

const defaultShadows: Shadows = [
  'none',
  'var(--template-palette-baseShadow)',
  ...defaultTheme.shadows.slice(2),
] as Shadows;

export const shadows = defaultShadows;
