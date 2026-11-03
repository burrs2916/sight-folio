/**
 * 主题取色工具 —— 各区域底色 / 卡面色 / 强调底色的唯一派生入口（2026-11-02，第十六轮）
 *
 * 背景：全局主题走 MUI v9 cssVariables，palette 里每个取值都是 `var(--template-palette-…)`
 * 引用串，`alpha('var(…)', a)` 会被 colorManipulator 直接拒绝（只认字面量颜色）。于是页面里
 * 到处出现「写死 rgba(99,102,241,…) / rgba(74,51,143,…)」的散点，切预设、切明暗时纹丝不动。
 *
 * 做法：MUI 会为每个 palette 条目额外注入一个 `${key}Channel` 变量（形如 "74 51 143"），
 * 且在 light / dark 两块变量表里各自取值。用 `rgb(var(--…Channel) / a)` 就能拿到
 * **跟随预设、跟随明暗**的半透明色，无需任何明暗分支。
 *
 * 双通道兜底：语料库页（LibraryPage）用「全新构造 + cssVariables:false」的页面级主题包住内容，
 * 那里 theme.vars 不存在，此时退回 `alpha(hex, a)`（同样是该页面主题的真实色值）。
 */

import { alpha } from '@mui/material/styles';

type AnyTheme = { vars?: { palette?: unknown } | undefined; palette?: unknown } | undefined | null;

/** 沿点号路径取字符串值（不存在 / 非字符串 → undefined） */
function pick(source: unknown, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), source);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 通用派生：`path` 是 palette 里的点号路径（如 'primary.main'、'text.primary'、
 * 'background.paper'、'divider'、'primary.contrastText'）。
 * - vars 主题：读 `${path}Channel`，拼 `rgb(var(--…) / a)` —— 随预设 / 随明暗联动；
 * - 非 vars 主题：退回 `alpha(hex, a)`；
 * - 两者都没有：返回 `transparent`（不至于把界面画坏）。
 */
export function themeTint(theme: AnyTheme, path: string, opacity: number): string {
  const channel = pick(theme?.vars?.palette, `${path}Channel`);
  if (channel) return `rgb(${channel} / ${opacity})`;
  const hex = pick(theme?.palette, path);
  if (hex) return alpha(hex, opacity);
  return 'transparent';
}

/** 主色低透明度底：选中行 / 图标底 / 页面 tint 等 —— 跟随「主题色彩」预设 */
export function primaryTint(theme: AnyTheme, opacity: number): string {
  return themeTint(theme, 'primary.main', opacity);
}

/** 中性 tint：搜索框、状态条等中性底 —— 浅色下沉、深色上浮，随明暗联动 */
export function neutralTint(theme: AnyTheme, opacity: number): string {
  return themeTint(theme, 'text.primary', opacity);
}

/** 半透明纸面：浮层工具栏 / 悬浮控制条底 —— 跟随卡片底色 */
export function paperTint(theme: AnyTheme, opacity: number): string {
  return themeTint(theme, 'background.paper', opacity);
}

/** 半透明分割线 / 描边 —— 跟随主题分割线 */
export function dividerTint(theme: AnyTheme, opacity: number): string {
  return themeTint(theme, 'divider', opacity);
}
