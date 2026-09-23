// 写作统计口径（收拢纯函数，禁止在 pane/右栏/AI 语料各写第二份）：
//
// 统计页签 = 全书体量与节奏总览：**纯本地派生、零新表、零 Rust 新命令**——
//   KPI（总字数/章节数/卷数/设定条目/平均章长）——数据源 writingStore（writing_chapters /
//         writing_settings 表，与校对/灵感等页签同一域口径）；
//   卷分布（按 chapter.volume 归组，空卷名归「未分卷」一组）；
//   章节体量排行（离群标注：>2×章均=超长、<0.3×章均=偏短，克制可解释）；
//   日更趋势（Rust 落库的「当日全书总字数」快照差分出每日新增，算法从
//         pages/WritingStatsDialog 下沉至此，Dialog 与统计页签共用一份）。
// 离群是 advisory 软提示：只标注不强制（创作者主权）。
import type { WritingChapter, WritingDailyStat, WritingSetting } from "../services/tauri";

// ─── 日更快照差分（自 WritingStatsDialog 下沉，口径与注释一并保留） ───

const WINDOW_DAYS = 30;

/** 本地时区的 YYYY-MM-DD（不能用 toISOString，那是 UTC，会在中国时区晚上差一天） */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface DailyDelta {
  day: string;
  delta: number;
}

/** 把快照序列差分成每日新增；快照按天补齐（缺的天沿用最近已知总量） */
export function diffDailyStats(stats: WritingDailyStat[], today: Date): DailyDelta[] {
  const byDay = new Map(stats.map((s) => [s.day, s.wordCount]));
  // 窗口 30 天 + 往前多看 1 天作为基线
  const days: string[] = [];
  for (let i = WINDOW_DAYS; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(localDay(d));
  }
  let prev = byDay.get(days[0]) ?? 0;
  const out: DailyDelta[] = [];
  for (let i = 1; i < days.length; i++) {
    const day = days[i];
    const total = byDay.get(day);
    const cur = total ?? prev; // 缺快照：总量没变（没保存 ≠ 归零）
    out.push({ day, delta: Math.max(0, cur - prev) });
    prev = cur;
  }
  return out;
}

export { WINDOW_DAYS };

// ─── KPI（全书体量一行读完） ───

export interface WritingKpis {
  totalWords: number;
  chapterCount: number;
  /** 只数「真有卷名」的卷——未分卷不是一个卷 */
  volumeCount: number;
  settingCount: number;
  avgWords: number;
  maxChapterWords: number;
  maxVolumeWords: number;
}

export function computeWritingKpis(chapters: WritingChapter[], settings: WritingSetting[]): WritingKpis {
  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const chapterCount = chapters.length;
  const avgWords = chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0;
  const volumes = new Set(chapters.map((c) => c.volume).filter((v) => v !== ""));
  return {
    totalWords,
    chapterCount,
    volumeCount: volumes.size,
    settingCount: settings.length,
    avgWords,
    maxChapterWords: chapters.reduce((max, c) => Math.max(max, c.wordCount || 0), 0),
    maxVolumeWords: buildVolumeRows(chapters).reduce((max, v) => Math.max(max, v.words), 0),
  };
}

// ─── 卷分布（按首次出现顺序 = 章序） ───

export interface WritingVolumeRow {
  volume: string;
  chapters: number;
  words: number;
  finished: number;
  /** 该卷章节 id（行展开明细用，保持章序） */
  chapterIds: string[];
}

export function buildVolumeRows(chapters: WritingChapter[]): WritingVolumeRow[] {
  const volMap = new Map<string, WritingVolumeRow>();
  for (const ch of chapters) {
    const key = ch.volume || "";
    const row = volMap.get(key) ?? { volume: key, chapters: 0, words: 0, finished: 0, chapterIds: [] };
    row.chapters += 1;
    row.words += ch.wordCount || 0;
    if (ch.status === "finished") row.finished += 1;
    row.chapterIds.push(ch.id);
    volMap.set(key, row);
  }
  return [...volMap.values()];
}

// ─── 章节体量 + 离群标注（advisory） ───

export type ChapterOutlier = "long" | "short" | null;

/**
 * 离群判定（克制口径，均基于「章均字数」）：
 *   超长 = 字数 > 2×章均；偏短 = 章节数 ≥ 3 时字数 < 0.3×章均（短章在 1~2 章的书里是常态，不标）。
 * 只标注不强制——离群章可能是刻意的节奏设计（高潮短章/过渡长章）。
 */
export function chapterOutlier(words: number, avgWords: number, chapterCount: number): ChapterOutlier {
  if (avgWords <= 0) return null;
  if (words > avgWords * 2) return "long";
  if (chapterCount >= 3 && words > 0 && words < avgWords * 0.3) return "short";
  return null;
}

export interface WritingChapterWordRow {
  id: string;
  title: string;
  volume: string;
  words: number;
  status: string;
  outlier: ChapterOutlier;
}

/** 章节体量行（保持章序 sortOrder），outlier 由 chapterOutlier 统一口径派生 */
export function buildChapterWordRows(chapters: WritingChapter[]): WritingChapterWordRow[] {
  const sorted = [...chapters].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = sorted.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const avg = sorted.length > 0 ? total / sorted.length : 0;
  return sorted.map((c) => ({
    id: c.id,
    title: c.title || "未命名",
    volume: c.volume || "",
    words: c.wordCount || 0,
    status: c.status,
    outlier: chapterOutlier(c.wordCount || 0, avg, sorted.length),
  }));
}
