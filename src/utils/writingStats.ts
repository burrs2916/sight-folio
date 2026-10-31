// 写作统计口径（收拢纯函数，禁止在 pane/右栏/AI 语料各写第二份）：
//
// 统计页签 = 全书体量与节奏总览：**纯本地派生、零新表、零 Rust 新命令**——
//   KPI（总字数/章节数/卷数/设定条目/平均章长）——数据源 writingStore（writing_chapters /
//         writing_settings 表，与校对/灵感等页签同一域口径）；
//   卷分布（按章节卷归属归组，归属见 resolveVolumeNames 注释；空卷名归「未分卷」一组）；
//   章节体量排行（离群标注：>2×章均=超长、<0.3×章均=偏短，克制可解释）；
//   日更趋势（Rust 落库的「当日全书总字数」快照差分出每日新增，算法从
//         pages/WritingStatsDialog 下沉至此，Dialog 与统计页签共用一份）。
// 离群是 advisory 软提示：只标注不强制（创作者主权）。
import type { WritingChapter, WritingDailyStat, WritingSetting } from '../services/tauri';
import type { WritingBookGoal } from '../services/writing';

// ─── 卷归属解析（2026-09-28 树感知修复） ───
//
// 历代模型差异：旧书用 chapter.volume 字符串表卷（'' = 未分卷）；新结构树由
// parentId + kind 表达（卷 = kind 为结构层「卷/篇」的节点或确有子级的容器，章挂在
// 卷下）。统计/总览/语料曾全按 volume 归组 → 新树书全部落「未分卷」。
// 修复：resolveVolumeNames 按树解析归属，旧模型书（全书无 parentId）零变化。

const STRUCTURE_KINDS = new Set(['卷', '篇']); // 默认根层级：novel→卷，essay/poetry/script→篇

export interface VolumeResolver {
  /** chapterId → 行（沿 parentId 上溯用） */
  byId: Map<string, WritingChapter>;
  /** 有子级节点的 id 集合（容器兜底判定） */
  hasChildren: Set<string>;
  /** 是否旧模型书：全书无 parentId 层级（纯 volume 字符串） */
  legacy: boolean;
}

export function resolveVolumeResolver(chapters: WritingChapter[]): VolumeResolver {
  const byId = new Map<string, WritingChapter>();
  const hasChildren = new Set<string>();
  for (const c of chapters) {
    byId.set(c.id, c);
    if (c.parentId) hasChildren.add(c.parentId);
  }
  return { byId, hasChildren, legacy: !chapters.some((c) => !!c.parentId) };
}

/**
 * 是否为卷级结构节点（不算内容章）：
 *   kind ∈ {卷, 篇}（默认结构层）直接命中；否则「确有子级」兜底
 *   （创作者自定义结构层如 部/集/幕 等——没有子级的空结构节点按内容章计，
 *   与树面板「容器 = 有子节点」展示口径一致的统计侧投影）。
 */
export function isVolumeNode(r: VolumeResolver, ch: WritingChapter): boolean {
  if (STRUCTURE_KINDS.has(ch.kind)) return true;
  return r.hasChildren.has(ch.id);
}

/** 旧模型（全书无 parentId）时章节卷名直接取遗留 volume 字段 */
function legacyVolumeName(r: VolumeResolver, ch: WritingChapter): string {
  return ch.volume || '';
}

/**
 * 章节卷名（'' = 未分卷）。旧模型书按 volume 字段；新树书沿 parentId 链向上
 * 找最近一个卷级祖先，取其标题为卷名；查无卷级祖先（章直接挂根下）→ 未分卷。
 */
export function volumeNameOf(r: VolumeResolver, ch: WritingChapter): string {
  if (r.legacy) return legacyVolumeName(r, ch);
  let cur = ch;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = r.byId.get(cur.parentId);
    if (!parent) break;
    if (isVolumeNode(r, parent)) return parent.title || '';
    cur = parent;
  }
  return '';
}

/** 统计口径的内容章列表：旧模型全部是章；新模型过滤卷级结构节点（卷本身不算章）。 */
export function contentChapters(r: VolumeResolver, chapters: WritingChapter[]): WritingChapter[] {
  if (r.legacy) return chapters;
  return chapters.filter((c) => !isVolumeNode(r, c));
}

// ─── 日更快照差分（自 WritingStatsDialog 下沉，口径与注释一并保留） ───

const WINDOW_DAYS = 30;

/** 本地时区的 YYYY-MM-DD（不能用 toISOString，那是 UTC，会在中国时区晚上差一天） */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface GoalProgress {
  pct: number;
  remain: number;
  hit: boolean;
}

/** 日更目标进度：delta（今日已写）vs goal（日更目标，>0）；pct 截断到 [0,100] */
export function goalProgress(delta: number, goal: number): GoalProgress | null {
  if (!(goal > 0)) return null;
  const safeDelta = Math.max(0, delta);
  return {
    pct: Math.min(100, Math.round((safeDelta / goal) * 100)),
    remain: Math.max(0, goal - safeDelta),
    hit: safeDelta >= goal,
  };
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
  const r = resolveVolumeResolver(chapters);
  const content = contentChapters(r, chapters);
  const totalWords = content.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const chapterCount = content.length;
  const avgWords = chapterCount > 0 ? Math.round(totalWords / chapterCount) : 0;
  const volumes = new Set(content.map((c) => volumeNameOf(r, c)).filter((v) => v !== ''));
  return {
    totalWords,
    chapterCount,
    volumeCount: volumes.size,
    settingCount: settings.length,
    avgWords,
    maxChapterWords: content.reduce((max, c) => Math.max(max, c.wordCount || 0), 0),
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
  const r = resolveVolumeResolver(chapters);
  const volMap = new Map<string, WritingVolumeRow>();
  for (const ch of contentChapters(r, chapters)) {
    const key = volumeNameOf(r, ch);
    const row = volMap.get(key) ?? { volume: key, chapters: 0, words: 0, finished: 0, chapterIds: [] };
    row.chapters += 1;
    row.words += ch.wordCount || 0;
    if (ch.status === 'finished') row.finished += 1;
    row.chapterIds.push(ch.id);
    volMap.set(key, row);
  }
  return [...volMap.values()];
}

// ─── 章节体量 + 离群标注（advisory） ───

export type ChapterOutlier = 'long' | 'short' | null;

/**
 * 离群判定（克制口径，均基于「章均字数」）：
 *   超长 = 字数 > 2×章均；偏短 = 章节数 ≥ 3 时字数 < 0.3×章均（短章在 1~2 章的书里是常态，不标）。
 * 只标注不强制——离群章可能是刻意的节奏设计（高潮短章/过渡长章）。
 */
export function chapterOutlier(words: number, avgWords: number, chapterCount: number): ChapterOutlier {
  if (avgWords <= 0) return null;
  if (words > avgWords * 2) return 'long';
  if (chapterCount >= 3 && words > 0 && words < avgWords * 0.3) return 'short';
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
  const r = resolveVolumeResolver(chapters);
  const sorted = [...contentChapters(r, chapters)].sort((a, b) => a.sortOrder - b.sortOrder);
  const total = sorted.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const avg = sorted.length > 0 ? total / sorted.length : 0;
  return sorted.map((c) => ({
    id: c.id,
    title: c.title || '未命名',
    volume: volumeNameOf(r, c),
    words: c.wordCount || 0,
    status: c.status,
    outlier: chapterOutlier(c.wordCount || 0, avg, sorted.length),
  }));
}

export type StatsChapterFilter = 'all' | 'outlier' | 'normal';
export type StatsChapterSort = 'default' | 'words';

export function filterChapterRows(rows: WritingChapterWordRow[], filter: StatsChapterFilter): WritingChapterWordRow[] {
  if (filter === 'all') return rows;
  if (filter === 'outlier') return rows.filter((r) => r.outlier !== null);
  return rows.filter((r) => r.outlier === null);
}

export function sortChapterRows(rows: WritingChapterWordRow[], sort: StatsChapterSort): WritingChapterWordRow[] {
  if (sort === 'default') return rows;
  return [...rows].sort((a, b) => b.words - a.words);
}

// ─── 全书目标（T2）派生算法（单一权威，禁止在 pane / 右栏 / 各视图各写第二份） ───
//
// 口径来源：原 pages/WritingStatsDialog 内联的 deadlineToInput / inputToDeadline /
// wordGoalPct / chapterGoalPct / daysLeft / commitBookGoal 六处派生逻辑下沉至此。
// 写作台统计弹窗与工作室书属性卡（BookMetaPanel）共用同一份算法，杜绝跨视图数字漂移
// （达成率取整、剩余天数边界、日期↔Unix 秒换算只此一处）。全部纯函数，可单测锁边界。

/** 截止日期（Unix 秒）→ 本地日期输入串（YYYY-MM-DD）；未设（≤0）返回空串。 */
export function deadlineToInput(sec: number): string {
  if (!(sec > 0)) return '';
  const d = new Date(sec * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 本地日期输入串（YYYY-MM-DD）→ 截止 Unix 秒（本地当日零点）；空/坏串 → 0。 */
export function inputToDeadline(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return 0;
  const t = new Date(y, m - 1, d).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** 三字段编辑缓冲 → 完整 WritingBookGoal（未填/非法字段归 0，与写作台同口径）。 */
export function resolveBookGoalInput(wordsStr: string, chaptersStr: string, deadlineStr: string): WritingBookGoal {
  const w = parseInt(wordsStr, 10);
  const c = parseInt(chaptersStr, 10);
  return {
    targetWords: Number.isFinite(w) && w > 0 ? w : 0,
    targetChapters: Number.isFinite(c) && c > 0 ? c : 0,
    deadline: inputToDeadline(deadlineStr),
  };
}

export interface GoalBar {
  pct: number;
  hit: boolean;
  target: number;
  actual: number;
}

export interface BookGoalProgress {
  /** 总字数达成（targetWords≤0 → null 不展示进度条） */
  word: GoalBar | null;
  /** 章节数达成（targetChapters≤0 → null） */
  chapter: GoalBar | null;
  /** 距截止剩余天数：截止日当天=0，过期=负，未设=null */
  daysLeft: number | null;
}

/** 从目标 + 实际体量派生达成率 / 达标标记 / 剩余天数（pct 截断 [0,100]，四舍五入）。 */
export function deriveBookGoalProgress(
  goal: WritingBookGoal,
  actualWords: number,
  chapterCount: number,
  today: Date,
): BookGoalProgress {
  const word: GoalBar | null =
    goal.targetWords > 0
      ? {
          pct: Math.min(100, Math.round((Math.max(0, actualWords) / goal.targetWords) * 100)),
          hit: actualWords >= goal.targetWords,
          target: goal.targetWords,
          actual: Math.max(0, actualWords),
        }
      : null;
  const chapter: GoalBar | null =
    goal.targetChapters > 0
      ? {
          pct: Math.min(100, Math.round((Math.max(0, chapterCount) / goal.targetChapters) * 100)),
          hit: chapterCount >= goal.targetChapters,
          target: goal.targetChapters,
          actual: Math.max(0, chapterCount),
        }
      : null;
  let daysLeft: number | null = null;
  if (goal.deadline > 0) {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000;
    daysLeft = Math.floor((goal.deadline - todayStart) / 86400);
  }
  return { word, chapter, daysLeft };
}

/**
 * 把全书目标 + 达成进度渲染为一行双语语料（供 stats / overview AI 语料注入）。
 * 复用 deriveBookGoalProgress —— AI 看到的达成率 / 剩余天数与面板**逐字一致**，
 * 不设第二套算法。未设任何目标字段返回 null（不污染语料）。
 * actualWords / chapterCount 由调用方按单一权威口径传入（快照优先/软删过滤）。
 */
export function formatBookGoalCorpus(
  goal: WritingBookGoal,
  actualWords: number,
  chapterCount: number,
  today: Date = new Date(),
): { zh: string; en: string } | null {
  if (goal.targetWords <= 0 && goal.targetChapters <= 0 && goal.deadline <= 0) return null;
  const p = deriveBookGoalProgress(goal, actualWords, chapterCount, today);
  const zhParts: string[] = [];
  const enParts: string[] = [];
  if (p.word) {
    zhParts.push(
      `目标 ${p.word.target.toLocaleString()} 字：已写 ${p.word.actual.toLocaleString()} 字（${p.word.pct}%${p.word.hit ? '，已达标' : ''}）`,
    );
    enParts.push(
      `words target ${p.word.target.toLocaleString()}: ${p.word.actual.toLocaleString()} written (${p.word.pct}%${p.word.hit ? ', reached' : ''})`,
    );
  }
  if (p.chapter) {
    zhParts.push(
      `目标 ${p.chapter.target} 章：已写 ${p.chapter.actual} 章（${p.chapter.pct}%${p.chapter.hit ? '，已达标' : ''}）`,
    );
    enParts.push(
      `chapters target ${p.chapter.target}: ${p.chapter.actual} written (${p.chapter.pct}%${p.chapter.hit ? ', reached' : ''})`,
    );
  }
  if (goal.deadline > 0 && p.daysLeft !== null) {
    const dl = deadlineToInput(goal.deadline);
    zhParts.push(
      p.daysLeft < 0 ? `截止 ${dl}：已超期 ${Math.abs(p.daysLeft)} 天` : `截止 ${dl}：还剩 ${p.daysLeft} 天`,
    );
    enParts.push(
      p.daysLeft < 0
        ? `deadline ${dl}: overdue by ${Math.abs(p.daysLeft)} days`
        : `deadline ${dl}: ${p.daysLeft} days left`,
    );
  }
  if (zhParts.length === 0) return null;
  return {
    zh: `【全书目标与进度】${zhParts.join('；')}。据此评估完成节奏、缺口与是否需要调整目标或日更计划。`,
    en: `[Book goal & progress] ${enParts.join('; ')}. Use this to assess pace, remaining gap, and whether goals or daily plan need adjusting.`,
  };
}
