// 写作台正文排版设置（P3）：per-book 持久化到 localStorage。
//
// 为什么不走 DB：书/章表是后端 scan_writing_book / writing_* 管的，
// 排版是纯前端展示偏好，加字段零迁移铁律下最安全的落点是 localStorage
// （key 按书 id 隔离，换书互不影响；丢失也只是回到默认排版，无数据损失）。

export type PaperTone = 'default' | 'sepia' | 'green';

/** 正文字体 key：设置面板按此展示，编辑器按 FONT_FAMILY_STACKS 渲染 */
export type FontFamilyKey = 'system' | 'song' | 'kai' | 'hei' | 'fangsong' | 'yahei';

/** 英文字体 key：可单独设置，与中文字体分离组合（美观优先，兼顾系统可用性） */
export type LatinFontFamilyKey =
  | 'system'
  | 'georgia'
  | 'times'
  | 'garamond'
  | 'playfair'
  | 'lora'
  | 'inter'
  | 'helvetica'
  | 'sf'
  | 'roboto'
  | 'lato'
  | 'montserrat'
  | 'consolas'
  | 'courier'
  | 'jetbrains';

/** 英文字体分组：衬线（正文感）/ 无衬线（现代感）/ 等宽（代码感） */
export type LatinFontGroup = 'serif' | 'sans' | 'mono';

export interface BookTypography {
  /** 正文字号 px（14–22） */
  fontSize: number;
  /** 正文字体（写作常用中文排版字体，按 key 映射到 font-family） */
  fontFamily: FontFamilyKey;
  /** 西文字体（与中文分离设置：衬线/无衬线/等宽三组，体现英文排版美观与丰富度） */
  latinFontFamily: LatinFontFamilyKey;
  /** 行距（1.6 / 1.9 / 2.2） */
  lineHeight: number;
  /** 段间距 em（0 / 0.5 / 1 / 1.5） */
  paraSpacing: number;
  /** 首行缩进 2em（中文出版惯例） */
  indent: boolean;
  /** 正文页宽 px（620 / 760 / 900） */
  pageWidth: number;
  /** 纸色：跟随主题 / 米黄 / 护眼绿 */
  paper: PaperTone;
}

/** 中文字体选项：key → 展示名与 CSS 字体栈（含西文/系统回退，保证缺字体时优雅回落） */
export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ key: FontFamilyKey; label: string; stack: string }> = [
  { key: 'system', label: '跟随系统', stack: '' },
  { key: 'song', label: '宋体', stack: "'Songti SC', 'SimSun', 'Noto Serif CJK SC', serif" },
  { key: 'kai', label: '楷体', stack: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Noto Serif CJK SC', serif" },
  { key: 'hei', label: '黑体', stack: "'Heiti SC', 'SimHei', 'Noto Sans CJK SC', sans-serif" },
  { key: 'fangsong', label: '仿宋', stack: "'FangSong', 'STFangsong', 'Noto Serif CJK SC', serif" },
  { key: 'yahei', label: '微软雅黑', stack: "'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif" },
];

/**
 * 英文字体选项：key → 展示名与 CSS 字体栈。
 * 分组 serif（衬线·正文感）/ sans（无衬线·现代感）/ mono（等宽·代码感）。
 * 栈刻意**不含末尾通用族**（serif/sans-serif/monospace）：
 * 由 resolveBodyFont 与中文字体栈拼接后统一收尾，避免出现两段通用族。
 */
export const LATIN_FONT_OPTIONS: ReadonlyArray<{
  key: LatinFontFamilyKey;
  label: string;
  group: LatinFontGroup;
  stack: string;
}> = [
  // 衬线：经典正文 / 报刊 / 复古
  { key: 'georgia', label: 'Georgia', group: 'serif', stack: "'Georgia', 'Times New Roman'" },
  { key: 'times', label: 'Times New Roman', group: 'serif', stack: "'Times New Roman', 'Times'" },
  { key: 'garamond', label: 'Garamond', group: 'serif', stack: "'Garamond', 'EB Garamond', 'ITC Garamond'" },
  { key: 'playfair', label: 'Playfair Display', group: 'serif', stack: "'Playfair Display', 'Georgia'" },
  { key: 'lora', label: 'Lora', group: 'serif', stack: "'Lora', 'Georgia', 'Times New Roman'" },
  // 无衬线：现代 / 屏幕阅读 / 品牌感
  { key: 'inter', label: 'Inter', group: 'sans', stack: "'Inter', 'Helvetica Neue', 'Arial'" },
  { key: 'helvetica', label: 'Helvetica Neue', group: 'sans', stack: "'Helvetica Neue', 'Helvetica', 'Arial'" },
  { key: 'sf', label: 'SF Pro', group: 'sans', stack: "'SF Pro Text', -apple-system, 'Segoe UI'" },
  { key: 'roboto', label: 'Roboto', group: 'sans', stack: "'Roboto', 'Segoe UI', 'Arial'" },
  { key: 'lato', label: 'Lato', group: 'sans', stack: "'Lato', 'Helvetica Neue', 'Arial'" },
  { key: 'montserrat', label: 'Montserrat', group: 'sans', stack: "'Montserrat', 'Segoe UI', 'Arial'" },
  // 等宽：代码 / 技术文档 / 强调
  { key: 'consolas', label: 'Consolas', group: 'mono', stack: "'Consolas', 'SF Mono', 'Menlo'" },
  { key: 'courier', label: 'Courier New', group: 'mono', stack: "'Courier New', 'Courier', 'Menlo'" },
  { key: 'jetbrains', label: 'JetBrains Mono', group: 'mono', stack: "'JetBrains Mono', 'Fira Code', 'Menlo'" },
];

/** 按 key 取 CSS font-family（system 用空串跟随系统字族） */
export function fontFamilyStack(key: FontFamilyKey): string {
  return FONT_FAMILY_OPTIONS.find((o) => o.key === key)?.stack ?? '';
}

/** 按 key 取英文字体栈（system 返回空串） */
export function latinFontStack(key: LatinFontFamilyKey): string {
  return LATIN_FONT_OPTIONS.find((o) => o.key === key)?.stack ?? '';
}

/** 系统缺省中文回退栈：英文字体单独设置、中文跟随系统时兜底（与 editorSx 原 fallback 一致） */
const CJK_FALLBACK_STACK = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";

/**
 * 组合正文 font-family：西文栈在前 + 中文栈在后，按各字体族的字形覆盖分工渲染。
 * - 全跟随系统 → ''（调用方自行回退到系统栈）；
 * - 仅中文 → 直接返回中文栈；
 * - 仅英文 → 西文栈 + 中文回退栈（中文仍由系统衬线兜底，不丢中文渲染）；
 * - 两者都有 → `latin, cjk`（西文字形走西文栈，中文走中文栈）。
 */
export function resolveBodyFont(latinKey: LatinFontFamilyKey, cjkKey: FontFamilyKey): string {
  const latin = latinFontStack(latinKey);
  const cjk = fontFamilyStack(cjkKey);
  if (!latin && !cjk) return '';
  if (!latin) return cjk;
  if (!cjk) return `${latin}, ${CJK_FALLBACK_STACK}`;
  return `${latin}, ${cjk}`;
}

/** 工具栏字号快捷档位（px）：写作常用档，精细调整仍可走排版面板 slider（14–22 连续） */
export const FONT_SIZE_PRESETS: ReadonlyArray<number> = [14, 15, 16, 18, 20, 22];

export const DEFAULT_TYPOGRAPHY: BookTypography = {
  fontSize: 16,
  fontFamily: 'system',
  latinFontFamily: 'system',
  lineHeight: 1.9,
  paraSpacing: 0.5,
  indent: false,
  pageWidth: 760,
  paper: 'default',
};

const KEY_PREFIX = 'sight-folio.typography.';

function keyOf(bookId: string): string {
  return `${KEY_PREFIX}${bookId}`;
}

const FONT_SIZE_RANGE = { min: 14, max: 22 } as const;
const PAGE_WIDTH_OPTIONS = [620, 760, 900] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 读某本书的排版（损坏/越界值逐项回落默认，绝不因脏数据炸掉编辑器） */
export function loadTypography(bookId: string | null): BookTypography {
  if (!bookId) return { ...DEFAULT_TYPOGRAPHY };
  try {
    const raw = localStorage.getItem(keyOf(bookId));
    if (!raw) return { ...DEFAULT_TYPOGRAPHY };
    const p = JSON.parse(raw) as Partial<BookTypography>;
    return {
      fontSize: clamp(Number(p.fontSize) || DEFAULT_TYPOGRAPHY.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
      fontFamily: FONT_FAMILY_OPTIONS.some((o) => o.key === p.fontFamily)
        ? (p.fontFamily as FontFamilyKey)
        : DEFAULT_TYPOGRAPHY.fontFamily,
      latinFontFamily:
        p.latinFontFamily === 'system' || LATIN_FONT_OPTIONS.some((o) => o.key === p.latinFontFamily)
          ? (p.latinFontFamily as LatinFontFamilyKey)
          : DEFAULT_TYPOGRAPHY.latinFontFamily,
      lineHeight: clamp(Number(p.lineHeight) || DEFAULT_TYPOGRAPHY.lineHeight, 1.4, 2.6),
      paraSpacing: clamp(Number(p.paraSpacing) || 0, 0, 2),
      indent: p.indent === true,
      pageWidth: PAGE_WIDTH_OPTIONS.includes(p.pageWidth as (typeof PAGE_WIDTH_OPTIONS)[number])
        ? (p.pageWidth as number)
        : DEFAULT_TYPOGRAPHY.pageWidth,
      paper: p.paper === 'sepia' || p.paper === 'green' ? p.paper : 'default',
    };
  } catch {
    return { ...DEFAULT_TYPOGRAPHY };
  }
}

export function saveTypography(bookId: string | null, tp: BookTypography): void {
  if (!bookId) return;
  try {
    localStorage.setItem(keyOf(bookId), JSON.stringify(tp));
  } catch {
    /* 存储失败不影响当前会话排版 */
  }
}

/** 纸色底：明暗主题各配一组（暗色下用低亮度暖/绿色调，避免刺眼白底） */
export function paperBackground(paper: PaperTone, dark: boolean): string | undefined {
  switch (paper) {
    case 'sepia':
      return dark ? '#2b261d' : '#f7efe0';
    case 'green':
      return dark ? '#1f2a20' : '#e6efe2';
    default:
      return undefined;
  }
}
