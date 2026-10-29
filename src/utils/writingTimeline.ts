// 时间线纯函数库：抽离自 writingPanes.TimelinePane，供时间线主视图与右侧栏面板
// （总览 / 事件详情）共用同一套算法，避免口径分裂。
//
// 全部为纯函数：不触碰 store、不调用 t()（展示文案由调用方传入 labels）。
import type { WritingTimelineEvent, WritingChapter } from '../services/tauri';

/** 轨道（lane）：全书模式按设定分轨，章节模式按章分轨。两侧共用同一结构。 */
export type Lane = {
  id: string;
  name: string;
  isBook: boolean;
  settingId: string | null;
  events: WritingTimelineEvent[];
  /** 章节级 lane：绑定的章 id（用于双击跳章 / 新建默认绑章） */
  chapterId?: string | null;
  /** 章节级 lane 的排序序（chapter.sortOrder），仅按章模式使用 */
  order?: number;
  /** 章节级 lane 的层级名（章/节/卷…），作副标题 */
  subtitle?: string;
  /** 章节级 lane 的卷名（时间线 chapter 视图按卷聚合用） */
  volume?: string;
  /** 分组折叠节点：代表一个卷/阶段的聚合，可展开/收起内部章节轨道 */
  group?: {
    volume: string;
    chapters: Lane[];
  };
};

/** 解析 at 为纯整数（仅当 at 整体为整数，如 "3" / "2024"）；混合单位（"第3年"）返回 null，避免跨章倒挂误报。 */
export function pureInt(at?: string | null): number | null {
  const s = at?.trim();
  return s && /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** 完整事件（同时有 at 与 event）才进主时间轴 / 合并轴；空 at 或空 event 的草稿归入「待补全」。 */
export function isComplete(ev: WritingTimelineEvent): boolean {
  return !!(ev.at?.trim() && ev.event?.trim());
}

// 事件 at 排序唯一口径：全部视图共用（时间线主视图 / 右侧栏 / 剧情线叙事与事件列表），禁止第二份。
const atCollator = new Intl.Collator('zh', { numeric: true });

/** 按 at 排序比较：中文数字感知（"3" < "10"）；空 at 排后（与「待补全殿后」分组语义一致）。 */
export function compareByAt(a?: string | null, b?: string | null): number {
  const ka = a?.trim() || '';
  const kb = b?.trim() || '';
  if (ka && kb) return atCollator.compare(ka, kb);
  if (ka) return -1;
  if (kb) return 1;
  return 0;
}

/** 章节级 lane：本书章按 sortOrder 为骨架，每章一组其绑定事件；末尾「未绑章」组收纳 chapterId 为空的事件。空章（无绑定事件）也列出并标「未锚定」，作为规划空缺提示。 */
export function buildChapterLanes(
  bookChapters: WritingChapter[],
  completeEvents: WritingTimelineEvent[],
  labels: { unbound: string; untitled: string },
  opts?: { groupByVolume?: boolean },
): Lane[] {
  const list: Lane[] = [...bookChapters]
    .sort((a, b) => a.sortOrder - b.sortOrder) // 契约：章记录按 sortOrder 为骨架，不依赖调用方传入顺序
    .map((c) => ({
      id: c.id,
      name: c.title || labels.untitled,
      isBook: false,
      settingId: null,
      chapterId: c.id,
      order: c.sortOrder,
      subtitle: c.kind || undefined,
      volume: c.volume || '',
      events: completeEvents.filter((e) => e.chapterId === c.id),
    }));
  const unbound = completeEvents.filter((e) => !e.chapterId);
  if (unbound.length > 0) {
    list.push({
      id: '__unbound__',
      name: labels.unbound,
      isBook: false,
      settingId: null,
      chapterId: null,
      order: Number.POSITIVE_INFINITY,
      events: unbound,
    });
  }
  if (!opts?.groupByVolume) return list;
  // 按 volume 分组聚合：章节量增长时避免纵向无限膨胀
  const groups = new Map<string, Lane[]>();
  for (const lane of list) {
    if (lane.id === '__unbound__') continue;
    const vol = lane.volume || '';
    if (!groups.has(vol)) groups.set(vol, []);
    groups.get(vol)!.push(lane);
  }
  const result: Lane[] = [];
  for (const [vol, chLanes] of groups) {
    const allEvents = chLanes.flatMap((l) => l.events);
    result.push({
      id: `__vol__${vol || '__none__'}`,
      name: vol || labels.untitled,
      isBook: false,
      settingId: null,
      chapterId: null,
      order: chLanes[0].order,
      events: allEvents,
      group: { volume: vol || labels.untitled, chapters: chLanes },
    });
  }
  result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const unboundLane = list.find((l) => l.id === '__unbound__');
  if (unboundLane) result.push(unboundLane);
  return result;
}

export type CoverageStats = {
  totalChapters: number;
  anchoredChapterCount: number;
  unboundEventCount: number;
};

/** 章节视图覆盖率：已锚定章（含至少一个已绑定完整事件）/ 总章；未绑章事件数。 */
export function computeCoverage(bookChapters: WritingChapter[], completeEvents: WritingTimelineEvent[]): CoverageStats {
  const anchoredChapterCount = bookChapters.filter((c) => completeEvents.some((e) => e.chapterId === c.id)).length;
  const unboundEventCount = completeEvents.filter((e) => !e.chapterId).length;
  return { totalChapters: bookChapters.length, anchoredChapterCount, unboundEventCount };
}

export type ConflictOptions = {
  view: 'book' | 'chapter' | 'storyline';
  /** 章节视图跨章时间倒挂用：本书章（用于取 sortOrder）。book 视图可省略。 */
  chapters?: WritingChapter[];
};

/** 冲突检测（派生视图 / 软提示，琥珀色不强制，调用方自行决定如何呈现）：
 * 1) 同轨 at 碰撞：同一轨道内两事件 at 完全相同（非空）→ 标黄（book 视图按设定分轨，chapter 视图按章分轨，未绑章自成一组）。
 * 2) 跨章时间倒挂（仅 chapter 视图）：早读章的解析时点整体晚于晚读章 → 标黄；仅 at 为纯整数时触发，避免混合单位误报。
 * 仅对完整事件检测（与 lane 构建口径一致：lane 只含 completeEvents）。
 */
/** 一条冲突：`kind` 说清是哪种，`with` 给出与之相撞的事件 id。 */
export type TimelineConflict = { kind: 'sameAt' | 'reversed'; with: string[] };

/**
 * 冲突判定**唯一**算法：eventId → 冲突详情。
 *
 * 下面那个 `computeTimelineConflicts` 只是它取键的投影。判定逻辑绝不允许有第二份：
 * 一旦分叉，画布标黄与体检报告就会各执一词，而作者看到的两个颜色都得信。
 *
 * 为什么要连 `with` 一起返回：block 级发现只说「某事件冲突」而不讲和谁撞、撞在哪个时点，
 * 作者跳过去仍要自己找一遍，等于没报。
 */
export function collectTimelineConflicts(
  events: WritingTimelineEvent[],
  opts: ConflictOptions,
): Map<string, TimelineConflict> {
  const out = new Map<string, TimelineConflict>();
  /** 同一事件可能同时中两种（chapter 视图）：保留先命中的 kind，`with` 取并集 */
  const mark = (id: string, kind: TimelineConflict['kind'], others: string[]) => {
    const hit = out.get(id);
    if (hit) {
      for (const o of others) if (o !== id && !hit.with.includes(o)) hit.with.push(o);
      return;
    }
    out.set(id, { kind, with: others.filter((o) => o !== id) });
  };
  const complete = events.filter(isComplete);

  const collideByAt = (group: WritingTimelineEvent[]) => {
    const byAt = new Map<string, string[]>();
    for (const ev of group) {
      const at = ev.at?.trim();
      if (!at) continue;
      const arr = byAt.get(at);
      if (arr) arr.push(ev.id);
      else byAt.set(at, [ev.id]);
    }
    for (const ids of byAt.values()) {
      if (ids.length < 2) continue;
      ids.forEach((id) => mark(id, 'sameAt', ids));
    }
  };

  const groupBy = (key: (ev: WritingTimelineEvent) => string) => {
    const byTrack = new Map<string, WritingTimelineEvent[]>();
    for (const ev of complete) {
      const k = key(ev);
      const arr = byTrack.get(k);
      if (arr) arr.push(ev);
      else byTrack.set(k, [ev]);
    }
    return byTrack;
  };

  if (opts.view === 'storyline') {
    // storyline 视图：按剧情线分轨（storylineId=null 归并到「未挂线」组），同轨 at 碰撞
    for (const group of groupBy((ev) => ev.storylineId ?? '__unlined__').values()) collideByAt(group);
  } else if (opts.view === 'book') {
    // 全书视图：按设定分轨（settingId=null 归并到全书组），同轨 at 碰撞
    for (const group of groupBy((ev) => ev.settingId ?? '__book__').values()) collideByAt(group);
  } else {
    // chapter 视图：按章分轨（未绑章自成一组），同轨 at 碰撞
    for (const group of groupBy((ev) => ev.chapterId ?? '__unbound__').values()) collideByAt(group);

    // 跨章时间倒挂：章按 sortOrder 排，两两比较纯整数时点
    const chapters = (opts.chapters ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const chItems = chapters
      .map((c) => ({
        order: c.sortOrder,
        items: complete
          .filter((e) => e.chapterId === c.id)
          .map((e) => ({ id: e.id, t: pureInt(e.at) }))
          .filter((x): x is { id: string; t: number } => x.t !== null),
      }))
      .filter((l) => l.items.length > 0);
    for (let i = 0; i < chItems.length; i++) {
      for (let j = i + 1; j < chItems.length; j++) {
        const a = chItems[i];
        const b = chItems[j];
        if (Math.min(...a.items.map((x) => x.t)) > Math.max(...b.items.map((x) => x.t))) {
          const aIds = a.items.map((x) => x.id);
          const bIds = b.items.map((x) => x.id);
          aIds.forEach((id) => mark(id, 'reversed', bIds));
          bIds.forEach((id) => mark(id, 'reversed', aIds));
        }
      }
    }
  }
  return out;
}

/** 冲突 id 集合（画布标黄用）。判定见 `collectTimelineConflicts`，此处只做投影。 */
export function computeTimelineConflicts(
  events: WritingTimelineEvent[],
  opts: ConflictOptions,
): Set<string> {
  return new Set(collectTimelineConflicts(events, opts).keys());
}

/** beat（大纲节拍）→ 时间线草稿文本：title+summary 合并为「标题：摘要」；空串 = 无可导入内容。 */
export function beatEventText(beat: { title?: string; summary?: string }): string {
  return [beat.title?.trim(), beat.summary?.trim()].filter(Boolean).join('：');
}

/** 该 beat 是否已导入过时间线（查重口径：任意事件的 event 全文精确匹配 beat 文本）。 */
export function beatImported(events: WritingTimelineEvent[], text: string): boolean {
  if (!text) return false;
  return events.some((e) => (e.event ?? '').trim() === text);
}

/** 剧情线联动派生：一组事件 → 挂线去重清单（线 + 该线事件数），按传入线序。章右栏「本章剧情线」与设定右栏「参与剧情线」共用同一份口径。 */
export function deriveLinesFromEvents<T extends { id: string }>(
  events: WritingTimelineEvent[],
  storylines: T[],
): { storyline: T; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (!e.storylineId) continue;
    counts.set(e.storylineId, (counts.get(e.storylineId) ?? 0) + 1);
  }
  return storylines
    .filter((l) => counts.has(l.id))
    .map((storyline) => ({ storyline, count: counts.get(storyline.id)! }));
}

/** lane 配色兜底（设定无 worldbuilding 子类型时按 id 哈希取色，跨重铺稳定）。不另写 TRACK_COLORS。 */
export const LANE_COLORS = [
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#14b8a6',
  '#6366f1',
  '#f97316',
  '#22c55e',
];

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// ─── 剧情 P2 · 线×章编排矩阵（2026-09-21）：线为行、章为列，一眼看「哪条线在哪几章有戏」 ───

export type StorylineChapterMatrix = {
  /** 章列（按 sortOrder 排好；title 为空串时调用方回退章序号） */
  columns: { id: string; title: string }[];
  rows: {
    /** null = 未挂线行（仅有事件时才生成，置尾） */
    storylineId: string | null;
    /** chapterId → 该线绑章完整事件数 */
    counts: Map<string, number>;
    /** chapterId → 该线绑章完整事件（点格悬浮/跳转用，插序 = 传入序） */
    events: Map<string, WritingTimelineEvent[]>;
    /** 该线未绑章事件数（未锚定提示，与章轴「未绑章」同语义） */
    unboundCount: number;
    /** 该线完整事件总数 */
    total: number;
  }[];
};

/**
 * 线×章矩阵（纯派生零模型）：每条线一行、本书章一列，格 = 该线绑定该章的完整事件数。
 * 内部先按 isComplete 过滤（幂等——调用方传整表也安全）；未绑章事件不进格、只计数。
 * 空线也出列（规划空缺提示）；未挂线事件归入 storylineId=null 行置尾（非空才生成）。
 */
export function buildStorylineChapterMatrix(
  storylines: { id: string }[],
  allEvents: WritingTimelineEvent[],
  bookChapters: WritingChapter[],
): StorylineChapterMatrix {
  const completeEvents = allEvents.filter(isComplete);
  const columns = [...bookChapters]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, title: c.title || '' }));

  const buildRow = (storylineId: string | null, evs: WritingTimelineEvent[]) => {
    const counts = new Map<string, number>();
    const events = new Map<string, WritingTimelineEvent[]>();
    let unboundCount = 0;
    for (const e of evs) {
      if (!e.chapterId) {
        unboundCount++;
        continue;
      }
      counts.set(e.chapterId, (counts.get(e.chapterId) ?? 0) + 1);
      const arr = events.get(e.chapterId);
      if (arr) arr.push(e);
      else events.set(e.chapterId, [e]);
    }
    return { storylineId, counts, events, unboundCount, total: evs.length };
  };

  const rows = storylines.map((sl) =>
    buildRow(
      sl.id,
      completeEvents.filter((e) => e.storylineId === sl.id),
    ),
  );
  const unlined = completeEvents.filter((e) => !e.storylineId);
  if (unlined.length > 0) rows.push(buildRow(null, unlined));
  return { columns, rows };
}
