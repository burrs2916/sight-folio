// 日记的节奏读数（㉖，2026-11-10）
//
// 为什么单独一个模块：连续记录 / 空档 / 月度密度这三件事全是**日期算术**，而日期算术在这个仓里
// 已经有两次前科 —— ㉕ 的 `todayDateKey` 不能用 `toISOString()`（那是 UTC，深夜记成昨天）、
// `writingStats.ts:94 localDay` 同样写明必须走本地日历。所以这里的天数差一律换算成
// **日历日序号**（`Date.UTC(y, m-1, d) / 86400000`：纯日历运算，本机时区与夏令时都插不进来），
// 绝不对 'YYYY-MM-DD' 用 `Date.parse`（那个按 UTC 解析，正是同一个坑）。
//
// 三条立场（写在代码旁边，免得下次有人"顺手"改掉）：
// 1. **只在首末条目之间数缺口**：第一本日记之前的岁月不是空档，末条之后到今天也不算；
// 2. **没标日期的条目必须显式报数**，不许静默丢掉（「折叠的是展示，不是事实」）：
//    ㉕ 只给「今天」按钮写 `entryDate`，用「＋」或拖货架建出的条目不带日期，
//    这类条目目前必然是多数 —— 任何"连续 N 天"若不说明这一点，就是在撒谎；
// 3. **人物出场频率不自己数**：提及计数只有 `writingProofread.computeSettingAppearances`
//    一份权威（它自己的注释写着「图谱与体检共用同一份计数」），本模块只做「章 → 天」的拼接。
//
// 本模块纯函数、不读 store、不碰 React、不碰 Rust。
import { chapterDeletedAt, type WritingChapter } from '../services/writing';
import { isDiaryDateKey, parseDiaryDate } from './diaryEntry';
import { computeSettingAppearances } from './writingProofread';

/**
 * 日历日序号：'YYYY-MM-DD' → 自 1970-01-01 起的天数。
 * 非法串返回 null（脏数据一律当"没有日期"，与 `parseDiaryDate` 同一口径，绝不猜）。
 *
 * 合法性一律交给 `diaryEntry.isDiaryDateKey`（形状 + 这一天真实存在）——
 * `Date.UTC` 会把 '2026-1-2' 宽容地当成 1 月 2 日、把 '2026-02-30' 归一到 3 月某天，
 * 宽容在这里等于替作者改日期。判据只有一处定义，这里不重复描述规则。
 */
export function dateOrdinal(dateKey: string): number | null {
  if (!isDiaryDateKey(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** 单条有日期的条目（读数与语料都从这里取，不在别处再解析一遍 extra） */
export interface DiaryEntryRecord {
  chapterId: string;
  /** 'YYYY-MM-DD' */
  date: string;
}

export interface DiaryRecords {
  /** 带日期且未进回收站的条目，按日期升序（同日多条按 sortOrder 保留） */
  dated: DiaryEntryRecord[];
  /** 没标日期 / 日期是脏值的条目数（**读数覆盖不到它们**，界面必须说出来） */
  undatedCount: number;
  /** 其中在回收站里的条数（不算进 undatedCount：删除的条目不参与任何读数） */
  trashedCount: number;
}

/** 摘出「哪天写了什么」；回收站与非日记数据一并排除 */
export function diaryRecords(chapters: WritingChapter[]): DiaryRecords {
  const dated: DiaryEntryRecord[] = [];
  let undatedCount = 0;
  let trashedCount = 0;
  for (const c of chapters ?? []) {
    if (chapterDeletedAt(c) > 0) {
      trashedCount += 1;
      continue;
    }
    const date = parseDiaryDate(c.extra);
    if (date) dated.push({ chapterId: c.id, date });
    else undatedCount += 1;
  }
  dated.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  return { dated, undatedCount, trashedCount };
}

/** 一段空档：从 from 那天写完之后开始空，到 to 那天又有人写（含端点之间的整段缺口） */
export interface DiaryGap {
  /** 缺口第一天（= 前一条的次日） */
  from: string;
  /** 缺口最后一天（= 后一条的前一日） */
  to: string;
  days: number;
}

export interface DiaryRhythm {
  /** 有日期的条目数（同日写两条算两条） */
  entries: number;
  /** 不同的天 */
  distinctDates: number;
  firstDate: string;
  lastDate: string;
  /** 从**最后一条记录**往回数的连续天数（不判断"今天该不该写"） */
  currentStreak: number;
  longestStreak: number;
  /** 距最后一条记录过了几天（0 = 当天也写过）；无任何日期 = -1；记到未来按 0 */
  daysSinceLast: number;
  /** 首末之间一共空了多少天 */
  gapDays: number;
  /** 最长的前几段空档（按天数降序，同天数保持时间先后） */
  gaps: DiaryGap[];
  /** 同一天挂了多条（㉒ 当时因为「还没有日期字段」没做，㉕ 之后这条欠条该还） */
  duplicates: { date: string; count: number }[];
  undatedCount: number;
}

const MAX_GAP_ROWS = 3;

function keyFromOrdinal(ord: number): string {
  const d = new Date(ord * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 连续记录 / 空档 / 重复日期。
 * `today` 由调用方传入（默认本机今天）：读数只把它当作"今天写过没有"的参照点，
 * 不参与首末之间的缺口计算 —— 那样"三个月没写"才会被算成空档，而"这本日记刚开始写"不会。
 */
export function computeDiaryRhythm(chapters: WritingChapter[], today: Date = new Date()): DiaryRhythm {
  const { dated, undatedCount } = diaryRecords(chapters);
  const counts = new Map<string, number>();
  for (const r of dated) counts.set(r.date, (counts.get(r.date) ?? 0) + 1);

  const dates = [...counts.keys()].sort();
  const ordinals = dates
    .map((d) => ({ d, ord: dateOrdinal(d) }))
    .filter((x): x is { d: string; ord: number } => x.ord !== null)
    .map((x) => x.ord);

  const empty: DiaryRhythm = {
    entries: dated.length,
    distinctDates: dates.length,
    firstDate: '',
    lastDate: '',
    currentStreak: 0,
    longestStreak: 0,
    daysSinceLast: -1,
    gapDays: 0,
    gaps: [],
    duplicates: [],
    undatedCount,
  };
  if (ordinals.length === 0) return empty;

  const first = ordinals[0];
  const last = ordinals[ordinals.length - 1];

  let longest = 1;
  let run = 1;
  let gapDays = 0;
  const gapRows: DiaryGap[] = [];
  for (let i = 1; i < ordinals.length; i++) {
    const step = ordinals[i] - ordinals[i - 1];
    if (step === 1) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
      const missing = step - 1;
      if (missing > 0) {
        gapDays += missing;
        gapRows.push({ from: keyFromOrdinal(ordinals[i - 1] + 1), to: keyFromOrdinal(ordinals[i] - 1), days: missing });
      }
    }
  }

  let current = 1;
  for (let i = ordinals.length - 2; i >= 0; i--) {
    if (ordinals[i + 1] - ordinals[i] === 1) current += 1;
    else break;
  }

  const todayOrd = dateOrdinal(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  );
  const gaps = gapRows
    .slice()
    .sort((a, b) => (b.days - a.days || a.from.localeCompare(b.from)))
    .slice(0, MAX_GAP_ROWS);

  return {
    entries: dated.length,
    distinctDates: dates.length,
    firstDate: keyFromOrdinal(first),
    lastDate: keyFromOrdinal(last),
    currentStreak: current,
    longestStreak: Math.max(longest, current),
    daysSinceLast: todayOrd === null ? -1 : Math.max(0, todayOrd - last),
    gapDays,
    gaps,
    duplicates: [...counts.entries()].filter(([, n]) => n > 1).map(([date, count]) => ({ date, count })),
    undatedCount,
  };
}

/**
 * 人物出场频率（按天）：**只拼接**现成的提及计数，不自己数名字。
 *
 * 月度密度**故意不在这里**：年/月分组体量 ㉓-1 已经由「统计分布带」按 `bandGroup` 给过
 * （日记读「年月分布」），KPI 行也有「跨了几个月」。在这儿再算一份就是第二块看板，
 * 迟早与那边对不上数（本台账 ⑱⑲㉓ 反复写过的同一件事）。
 */
export interface DiaryPersonRow {
  settingId: string;
  name: string;
  mentions: number;
  /** 提到过这个人的天数（同日多条合并为一天） */
  days: number;
}

export function computeDiaryPeopleFrequency(
  chapters: WritingChapter[],
  settings: { id: string; name: string; extra: string }[],
  limit = 5,
): DiaryPersonRow[] {
  const { dated } = diaryRecords(chapters);
  const dateByChapter = new Map<string, string>();
  for (const r of dated) dateByChapter.set(r.chapterId, r.date);
  return computeSettingAppearances(chapters, settings)
    .map((a) => {
      const days = new Set<string>();
      for (const chapterId of a.chapterIds) {
        const d = dateByChapter.get(chapterId);
        if (d) days.add(d);
      }
      return { settingId: a.settingId, name: a.name, mentions: a.total, days: days.size };
    })
    .filter((r) => r.mentions > 0)
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}
