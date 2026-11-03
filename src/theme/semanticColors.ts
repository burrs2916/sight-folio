// sight-folio: 语义 / 品牌强调色单一真源（2026-11-02，第十八～十九轮）
//
// 背景：外观预设（preset）要联动「每一个区域」的底色、文字与描边，但界面上另有一批
// 颜色**不该**跟着主题皮肤走 —— 它们表达的是「这是什么类型 / 什么状态 / 哪个品牌」，
// 换了皮肤也必须保持同一语义。此前这些颜色以字面量散落在各组件里，既看不出归属，
// 也无从校验「该跟随的有没有跟随」；更糟的是它们只在浅色方案下选过值，深色下直接复用，
// 实测大量不达标（例如琥珀 #b45309 落在深底上只有 2.6:1，基本糊掉）。这里把剩余的字面量
// 收口成「语义色族（tone）」，并把「当前明暗下该用哪个前景」交给 src/theme/contrast.ts
// 按**实际底色**派生 —— 文字颜色随背景深度走，而不是随明暗二选一。
//
// 归属三分（后续所有颜色改动按此判断）：
//   ① 区域 / 外壳色（顶栏、侧栏、页底、卡片、选中底、浮层、分割线）→ 必须随主题派生，
//      见 src/theme/themeTokens.ts 与 --template-palette-*Channel 通道变量。
//   ② 语义 / 品牌色 → 本文件（或各自已有的具名调色板），刻意稳定：换皮肤不该让「需关注」变绿。
//   ③ 语义色作前景（文字 / 图标 / 圆点）→ 不再是固定字面量，一律经 resolveSemanticColor()
//      按当前底色派生（本文件下半部分），保证两套明暗下都可读。
//
// 角色拆分（第十九轮新增，解决同一常量既当文字色又当填充色的冲突）：
//   · `color` —— 前景角色：当前明暗下的文字 / 图标 / 圆点色，对「页面卡片底」与其自身
//     12% 叠层均满足 WCAG AA 4.5:1。
//   · `fill`  —— 填充角色：彩色底 + 白字（画布角标、报告徽章），模式无关，保证白字可读。
//   两者取值不同（深色下 `color` 偏亮、`fill` 偏深），混用就会出现「深底上的深字」或
//   「浅底上的白字」这类不可读组合 —— 这正是要拆开的原因。

import { blendOver, contrastRatio, ensureContrast, parseColor, WCAG } from './contrast';

/**
 * 顶栏全局搜索结果「对象类型」标识色。
 *
 * 三种结果类型要一眼可辨（分析=主题主色 / 符号=青 / 代码=紫）。其中分析结果是本项目
 * 自身产出的内容，跟随主题主色以呼应皮肤；符号与代码是**外来语汇**（源码里的标识符与
 * 代码块），固定青 / 紫，切皮肤时仍保持「不同类型不同色」的辨识度。仅作徽标色使用，
 * 尺寸大、字数少，不承担正文可读性。
 */
export const SEARCH_KIND_COLORS = {
  analysis: 'var(--template-palette-primary-main)',
  symbol: '#06B6D4',
  code: '#8B5CF6',
} as const;

/**
 * 语义色族：界面「状态 / 类型」色的唯一命名口径。
 *
 * 每一族只声明三件事 —— hue（色相基色，仅做叠层 / 描边来源）、light / dark（两套明暗下的
 * 前景起点）、fill（白字填充底）。实际前景由 resolveSemanticColor() 按当前底色再校正一次。
 */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'cyan'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'neutral'
  | 'accent';

export interface StatusToken {
  /** 色相基色：仅作 tint / 描边来源，模式无关 */
  hue: string;
  /** 浅色方案下的前景起点（对白底 / 浅色 tint 达标） */
  light: string;
  /** 深色方案下的前景起点（对深色底 / 深色 tint 达标） */
  dark: string;
  /** 彩色填充底（配白字），模式无关；保证与 #ffffff 的对比度 ≥ 4.5 */
  fill: string;
}

export const STATUS_TOKENS: Record<StatusTone, StatusToken> = {
  /** 成功 / 已采纳 / 正常触发 */
  success: { hue: '#22c55e', light: '#047857', dark: '#4ade80', fill: '#047857' },
  /** 注意 / 需关注（琥珀） */
  warning: { hue: '#f59e0b', light: '#b45309', dark: '#fbbf24', fill: '#b45309' },
  /** 失败 / 严重（红） */
  danger: { hue: '#ef4444', light: '#b91c1c', dark: '#fca5a5', fill: '#b91c1c' },
  /** 信息 / 待处理（天蓝） */
  info: { hue: '#38bdf8', light: '#0369a1', dark: '#7dd3fc', fill: '#0369a1' },
  /** 无锚点 / 低优先（青） */
  cyan: { hue: '#0891b2', light: '#0e7490', dark: '#67e8f9', fill: '#0e7490' },
  /** 提示级（靛） */
  indigo: { hue: '#6366f1', light: '#4338ca', dark: '#a5b4fc', fill: '#4338ca' },
  /** 主动补齐类原因（紫罗兰） */
  violet: { hue: '#a78bfa', light: '#6d28d9', dark: '#c4b5fd', fill: '#6d28d9' },
  /** 过期机会类原因（比紫罗兰更偏品红，需要与 violet 一眼可分） */
  purple: { hue: '#c084fc', light: '#7e22ce', dark: '#d8b4fe', fill: '#7e22ce' },
  /** 跳过 / 未变 / 灰（中性） */
  neutral: { hue: '#94a3b8', light: '#475569', dark: '#cbd5e1', fill: '#475569' },
  /** 中断 / 高危（暖橙） */
  accent: { hue: '#f97316', light: '#c2410c', dark: '#fdba74', fill: '#c2410c' },
};

/** 叠层透明度的统一口径（与旧字面量 ${color}1f / 0.12 / 0.35 对齐） */
export const SEMANTIC_ALPHA = {
  /** chip 淡底 */
  tint: 0.12,
  /** 铺满整卡的极淡底 */
  wash: 0.05,
  /** 描边 */
  border: 0.35,
} as const;

/** 一次解析出的语义色（前景已按当前底色校正到达标） */
export interface ResolvedSemanticColor {
  /** 色相基色 */
  hue: string;
  /** 前景角色：当前明暗下的文字 / 图标 / 圆点色 */
  color: string;
  /** tint 叠层（chip 淡底） */
  bg: string;
  /** wash 叠层（卡片极淡底） */
  tint: string;
  /** border 叠层（描边） */
  border: string;
  /** 填充角色：彩色底 + 白字 */
  fill: string;
}

function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * 按「当前底色 + 明暗」解析一个语义族的全部取值。
 *
 * 前景不是直接取 light/dark 起点，而是对该起点做一次 ensureContrast —— 分别对「页面卡片底」
 * 与「它自己的 12% 叠层」两处校验。这样即使某个 preset 的底色比基准更深 / 更亮，
 * 文字也不会掉到 4.5:1 以下（这正是「文字颜色随背景深度派生」的算法本体）。
 */
export function resolveSemanticColor(
  tone: StatusTone,
  background: string,
  mode: 'light' | 'dark',
): ResolvedSemanticColor {
  const token = STATUS_TOKENS[tone];
  const base = mode === 'dark' ? token.dark : token.light;
  const tint = blendOver(token.hue, SEMANTIC_ALPHA.tint, background);
  // 先对卡片底达标，再对该族自己的叠层底达标 —— 两处都要能读，就取「更难的那个」顺序校正
  const harder = contrastFallback(base, background, tint);
  const color = ensureContrast(ensureContrast(base, harder, WCAG.AA_TEXT), background, WCAG.AA_TEXT);
  return {
    hue: token.hue,
    color,
    bg: withAlpha(token.hue, SEMANTIC_ALPHA.tint),
    tint: withAlpha(token.hue, SEMANTIC_ALPHA.wash),
    border: withAlpha(token.hue, SEMANTIC_ALPHA.border),
    fill: token.fill,
  };
}

/** 两个背景里「对当前前景更不利」的那个（对比度更低） */
function contrastFallback(base: string, a: string, b: string): string {
  return contrastRatio(base, a) <= contrastRatio(base, b) ? a : b;
}

/** 一次解析出全部语义族（供 useSemanticColors 缓存） */
export function resolveSemanticPalette(
  background: string,
  mode: 'light' | 'dark',
): Record<StatusTone, ResolvedSemanticColor> {
  const out = {} as Record<StatusTone, ResolvedSemanticColor>;
  (Object.keys(STATUS_TOKENS) as StatusTone[]).forEach((tone) => {
    out[tone] = resolveSemanticColor(tone, background, mode);
  });
  return out;
}

/** 语义族 → 白字填充色（画布角标 / 报告徽章用）。模式无关。 */
export function statusFill(tone: StatusTone): string {
  return STATUS_TOKENS[tone].fill;
}

/**
 * AI 面板的「状态强调」色 → 语义族归属。
 *
 * 语义是「这条洞察此刻处于什么状态」，与皮肤无关：换主题皮肤不该让「需关注」变绿。
 * 具体色值不在这里写死，而是按当前明暗经 resolveSemanticColor 派生。
 */
export const INSIGHT_ACCENTS = {
  /** 自动分析：有活跃规则 / 正在运行 —— 琥珀（注意） */
  auto: 'warning',
  /** AI 洞察条目标题徽标 —— 金黄（提示） */
  insight: 'warning',
  /** 同一条洞察被多次确认 —— 天蓝（信息） */
  confirmed: 'info',
  /** 洞察已被采纳 —— 绿色（成功） */
  adopted: 'success',
} as const satisfies Record<string, StatusTone>;

export type InsightAccentKey = keyof typeof INSIGHT_ACCENTS;
