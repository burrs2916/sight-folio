// 写作台正文排版设置（P3）：per-book 持久化到 localStorage。
//
// 为什么不走 DB：书/章表是后端 scan_writing_book / writing_* 管的，
// 排版是纯前端展示偏好，加字段零迁移铁律下最安全的落点是 localStorage
// （key 按书 id 隔离，换书互不影响；丢失也只是回到默认排版，无数据损失）。

export type PaperTone = "default" | "sepia" | "green";

export interface BookTypography {
  /** 正文字号 px（14–22） */
  fontSize: number;
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

export const DEFAULT_TYPOGRAPHY: BookTypography = {
  fontSize: 16,
  lineHeight: 1.9,
  paraSpacing: 0.5,
  indent: false,
  pageWidth: 760,
  paper: "default",
};

const KEY_PREFIX = "sight-folio.typography.";

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
      lineHeight: clamp(Number(p.lineHeight) || DEFAULT_TYPOGRAPHY.lineHeight, 1.4, 2.6),
      paraSpacing: clamp(Number(p.paraSpacing) || 0, 0, 2),
      indent: p.indent === true,
      pageWidth: PAGE_WIDTH_OPTIONS.includes(p.pageWidth as (typeof PAGE_WIDTH_OPTIONS)[number])
        ? (p.pageWidth as number)
        : DEFAULT_TYPOGRAPHY.pageWidth,
      paper: p.paper === "sepia" || p.paper === "green" ? p.paper : "default",
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
    case "sepia":
      return dark ? "#2b261d" : "#f7efe0";
    case "green":
      return dark ? "#1f2a20" : "#e6efe2";
    default:
      return undefined;
  }
}
