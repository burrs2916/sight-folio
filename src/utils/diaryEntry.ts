// 日记的「哪天」（㉕，2026-11-10）
//
// 数据落点：`writing_chapters.extra` 里的 `entryDate`，形如 'YYYY-MM-DD'。
// 为什么不加数据库列：`extra` 是后端预留的 JSON 透传字段（`services/writing.ts:134-137` 原话
// 「加字段零迁移；save_chapter 走 INSERT OR REPLACE 且显式含 extra 列、serde 对未知顶层字段宽容」），
// 回收站的 `deletedAt` 已经是同一条先例。日期要的是"能存能读能改"，不需要成为索引列。
//
// 本模块只管**数据形状与本地日期口径**，不管体裁判断（那在 writingSchema.hasTodayEntryMode），
// 也不写 React。
import { chapterDeletedAt, parseChapterExtra, type WritingChapter } from '../services/writing';
import { t } from '../i18n';

/** 日期串的唯一合法形状。脏数据一律当"没有日期"，绝不猜。 */
export const DIARY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 形状对 **且这一天真实存在**（㉘）。
 *
 * 只看正则会放进来 '2026-11-31' / '2026-02-30' 这种"看着像日期"的串。它们比坏 JSON 更坏：
 * `parseDiaryDate` 认为有日期、`diaryMetrics.dateOrdinal` 认为是 null，
 * 于是这条既不进读数、也不进「未标日期」的数 —— 读数少一条而警示行不说它，正是「折叠了事实」。
 * 所以形状与真实性合起来才是本仓唯一的"这是哪天"判据，读写两侧都用它，别处不再各写一遍。
 */
export function isDiaryDateKey(v: unknown): v is string {
  if (typeof v !== 'string' || !DIARY_DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 今天的日期串，**按本地日历**。
 *
 * 不能用 `toISOString().slice(0,10)`：那是 UTC。李先生晚上 11 点写日记，
 * UTC 还是前一天，于是"今天"会建到昨天的条目上去 —— 这是日记体裁里最容易被发现也最难解释的错。
 */
export function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 读条目的日期；脏值 / 非日记 / 没写过一律返回空串（调用方按空串决定显不显示）。 */
export function parseDiaryDate(extra?: string): string {
  const v = parseChapterExtra(extra ?? '').entryDate;
  return isDiaryDateKey(v) ? v : '';
}

/**
 * 写回日期 = **合并写**，不是整块覆盖。
 *
 * `extra` 里住着回收站的 `deletedAt`、章头图等既有键；这里若写 `JSON.stringify({entryDate})`
 * 就等于每次改日期把人家删了、把封面图弄丢。传非法日期则删掉这个键（"取消标记这一天"）。
 */
export function writeDiaryDate(extra: string | undefined, date: string): string {
  const obj: Record<string, unknown> = { ...parseChapterExtra(extra ?? '') };
  if (isDiaryDateKey(date)) obj.entryDate = date;
  else delete obj.entryDate;
  return JSON.stringify(obj);
}

export function diaryDateParts(dateKey: string): { y: number; m: number; d: number } | null {
  if (!DIARY_DATE_RE.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return { y, m, d };
}

/** 条目标题：日记用真实日期（作者回来找的是"那天"，不是"第几条"）。 */
export function diaryEntryTitle(dateKey: string): string {
  const p = diaryDateParts(dateKey);
  if (!p) return '';
  return t('writing.diary.todayTitle', { y: p.y, m: p.m, d: p.d });
}

/** 树行尾注里的短日期（'11/10'）；没日期返回空串，由调用方过滤后再拼，保证非日记体裁逐字不变。 */
export function diaryDateShort(dateKey: string): string {
  const p = diaryDateParts(dateKey);
  return p ? t('writing.diary.dateShort', { m: p.m, d: p.d }) : '';
}

/** 找某一天的已有条目（跳过回收站里的）。日期是日记的主键，找到就该跳过去而不是再建一条。 */
export function findEntryByDate(chapters: WritingChapter[], dateKey: string): WritingChapter | undefined {
  if (!DIARY_DATE_RE.test(dateKey)) return undefined;
  return chapters.find((c) => chapterDeletedAt(c) === 0 && parseDiaryDate(c.extra) === dateKey);
}
