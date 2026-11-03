// sight-folio: 颜色对比度工具（2026-11-02，第十九轮）
//
// 背景：外观预设要联动「每个区域的底色 / 文字 / 描边」，而文字颜色**不能只按明暗二选一**
// ——同一套深色底在不同 preset 下深浅不同（例如品牌金混出的 #373735 比灰 900 亮一截），
// 同一支语义色（如琥珀 #b45309）落在浅底上清楚、落在深底上就糊成一片。此前一批语义色
// 只在「浅色方案」下选过值，深色方案直接复用，导致真实不可读（详见本轮对比度回归锁）。
//
// 这里提供「由背景深度派生前景」的全部计算底座：解析、相对亮度、对比度、半透明叠底、
// 达标判定，以及两个派生器 —— pickReadableText（从候选前景里挑对比度最高的）与
// ensureContrast（沿黑白方向逐级调整直到达标）。所有取色都走这里，不再手算。

import { mixHex } from './colorUtils';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number;
}

/** 支持 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()；解析失败返回 null。 */
export function parseColor(input: string): RGBA | null {
  const value = input.trim();
  if (value.startsWith('#')) {
    const clean = value.slice(1);
    if (clean.length === 3 || clean.length === 4) {
      const [r, g, b, a] = clean.split('').map((c) => Number.parseInt(c + c, 16));
      if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
      return { r, g, b, a: a === undefined ? 1 : a / 255 };
    }
    if (clean.length === 6 || clean.length === 8) {
      const r = Number.parseInt(clean.slice(0, 2), 16);
      const g = Number.parseInt(clean.slice(2, 4), 16);
      const b = Number.parseInt(clean.slice(4, 6), 16);
      const a = clean.length === 8 ? Number.parseInt(clean.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/[,/\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => Number.parseFloat(p));
  const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
  return { r, g, b, a: Math.min(Math.max(a, 0), 1) };
}

/** 相对亮度（WCAG 2.x 定义，sRGB 线性化后按 0.2126/0.7152/0.0722 加权）。 */
export function relativeLuminance(color: RGB | string): number {
  const rgb = typeof color === 'string' ? parseColor(color) : color;
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** 对比度（1~21）。任一参数解析失败返回 1（视为「不达标」）。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 把半透明前景按 alpha 叠到底色上，得到不透明结果色（十六进制）。
 *  用途：语义色的 12% tint 底要先合成，才能算「文字落在 tint 上」的真实对比度。 */
export function blendOver(fg: string, alpha: number, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  if (!f || !b) return bg;
  const a = Math.min(Math.max(alpha * f.a, 0), 1);
  const ch = (x: number, y: number) =>
    Math.round(x * a + y * (1 - a))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(f.r, b.r)}${ch(f.g, b.g)}${ch(f.b, b.b)}`;
}

/** WCAG 门槛 */
export const WCAG = {
  /** 正文文字 */
  AA_TEXT: 4.5,
  /** 大号文字（≥18pt / 14pt 粗体）与图形元素 */
  AA_LARGE: 3,
  /** 非文字元素（描边、图标、边界） */
  NON_TEXT: 3,
} as const;

export function meetsContrast(fg: string, bg: string, min: number = WCAG.AA_TEXT): boolean {
  return contrastRatio(fg, bg) >= min;
}

/**
 * 从候选前景里挑「对给定背景对比度最高」的那个 —— 用于派生 `contrastText`。
 * 会先过滤出达标候选，在达标集合里取对比度最高者，从而既保证可读、又尽量贴近声明值。
 */
export function pickReadableText(background: string, candidates: string[] = ['#ffffff', '#111827']): string {
  const parsed = candidates.filter((c) => parseColor(c) !== null);
  if (parsed.length === 0) return '#ffffff';
  const passing = parsed.filter((c) => meetsContrast(c, background));
  const pool = passing.length > 0 ? passing : parsed;
  return pool.reduce((best, cur) => (contrastRatio(cur, background) > contrastRatio(best, background) ? cur : best));
}

/**
 * 派生「彩色底上的前景色」的标准做法：声明值达标就用声明值（保留历史外观、零回归），
 * 只有它真的不可读时才退到候选里对比度最高的那个。用于 contrastText。
 */
export function resolveContrastText(background: string, preferred: string, min: number = WCAG.AA_TEXT): string {
  if (parseColor(preferred) && meetsContrast(preferred, background, min)) return preferred;
  return pickReadableText(background);
}

/** 沿黑白方向逐级逼近，直到与该背景的对比度达标；无法达标时返回对比度最高的那一档。 */
export function ensureContrast(base: string, background: string, min: number = WCAG.AA_TEXT): string {
  if (parseColor(base) === null) return base;
  if (meetsContrast(base, background, min)) return base;

  const steps = 10;
  let best = base;
  let bestRatio = contrastRatio(base, background);

  for (let i = 1; i <= steps; i += 1) {
    const weight = i / steps;
    for (const target of ['#000000', '#ffffff']) {
      const candidate = mixHex(base, target, weight);
      const ratio = contrastRatio(candidate, background);
      if (ratio >= min) return candidate;
      if (ratio > bestRatio) {
        best = candidate;
        bestRatio = ratio;
      }
    }
  }
  return bestRatio >= contrastRatio('#000000', background) ? '#000000' : best;
}
