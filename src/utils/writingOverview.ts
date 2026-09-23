// sight-folio: 全书总览聚合（单一事实来源）
//
// 设计立场（与 stats / proofread / timeline 等口径一致，禁止第二份）：
//   右栏「要素」栏的《全书总览》仪表盘 与 AI 助手的「全书语料」都从这里取数，
//   不各自重算。所有指标都是**纯本地派生**，零新表、零 Rust 新命令。
//
// 收拢的纯函数口径：
//   - 体量 KPI / 卷分布 / 章节体量离群：utils/writingStats（与统计页签同一份）
//   - 校对体检六组：utils/writingProofread（与校对页签同一份）
//   - 时间线冲突 / 覆盖：utils/writingTimeline（与时间线页签同一份）
//   - 伏笔跨章预警：utils/writingForeshadowing（与伏笔页签同一份）
//   - 念头池（loose beats）/ 设定使用率：utils/writingOutline（与灵感/要素页签同一份）
//
// 该文件只依赖上述纯函数 + 类型，不 import 任何 store / Tauri，单测直接跑。

import type {
  WritingChapter,
  WritingSetting,
  WritingOutline,
  WritingTimelineEvent,
  WritingStoryline,
  WritingForeshadowing,
  WritingDailyStat,
} from "../services/tauri";
import {
  computeWritingKpis,
  buildVolumeRows,
  diffDailyStats,
  type WritingKpis,
} from "./writingStats";
import { buildProofreadReport, PROOFREAD_GROUPS } from "./writingProofread";
import { computeTimelineConflicts, computeCoverage, isComplete } from "./writingTimeline";
import { looseBeats, settingUsage } from "./writingOutline";
import { isOverdue } from "./writingForeshadowing";

/** 全书总览所需的最小数据切片（取 writingStore 当前书过滤后的数组）。 */
export interface BookOverviewInput {
  bookTitle: string | null;
  chapters: WritingChapter[];
  settings: WritingSetting[];
  outlines: WritingOutline[];
  timelineEvents: WritingTimelineEvent[];
  storylines: WritingStoryline[];
  foreshadowings: WritingForeshadowing[];
  /** 当前书的日更快照（Rust 落库当日全书总字数）。差分出每日新增，喂给 AI 全书语料的日更趋势行。 */
  dailyStats?: WritingDailyStat[];
}

export interface OverviewVolumeRow {
  volume: string;
  chapters: number;
  words: number;
  finished: number;
}

export interface OverviewProofreadGroup {
  group: string;
  count: number;
}

export interface OverviewForeshadowing {
  total: number;
  pending: number;
  paidoff: number;
  abandoned: number;
  overdue: number;
}

export interface OverviewTimeline {
  events: number;
  complete: number;
  incomplete: number;
  conflicts: number;
  chaptersAnchored: number;
}

/** 日更趋势（由 dailyStats 差分出每日新增）。 */
export interface OverviewDailyTrend {
  /** 近 7 天新增字数 */
  last7: number;
  /** 近 30 天新增字数 */
  last30: number;
  /** 截至今天连续写作天数（今天 0 字则记 0） */
  streak: number;
  /** 近 30 天每日新增序列（day + delta），供 AI 判断节奏与断更 */
  series: { day: string; delta: number }[];
}

/** 全书总览结构化结果（仪表盘与 AI 语料共用）。 */
export interface BookOverview {
  bookTitle: string | null;
  kpis: WritingKpis;
  volumes: OverviewVolumeRow[];
  characters: number;
  worldviews: number;
  settingAttached: number;
  settingOrphan: number;
  looseBeats: number;
  timeline: OverviewTimeline;
  storylines: number;
  foreshadowings: OverviewForeshadowing;
  proofread: { issues: number; byGroup: OverviewProofreadGroup[] };
  dailyTrend: OverviewDailyTrend;
}

/**
 * 聚合全书跨维度总览。单一事实来源：右栏仪表盘与 AI 全书语料都调它。
 * 全部读真实 writingStore 数据，纯派生，零副作用。
 */
export function buildBookOverview(input: BookOverviewInput): BookOverview {
  const { bookTitle, chapters, settings, outlines, timelineEvents, storylines, foreshadowings } = input;

  const kpis = computeWritingKpis(chapters, settings);
  const volumeRows = buildVolumeRows(chapters).map((v) => ({
    volume: v.volume || "未分卷",
    chapters: v.chapters,
    words: v.words,
    finished: v.finished,
  }));

  const characters = settings.filter((s) => s.kind === "character").length;
  const worldviews = settings.filter((s) => s.kind === "worldbuilding").length;
  const usage = settingUsage(outlines, settings);
  const attached = new Set(usage.attached);
  const settingAttached = settings.filter((s) => attached.has(s.id)).length;
  const settingOrphan = usage.orphan.length;

  const loose = looseBeats(outlines);
  const looseBeatsCount = loose.length;

  const completeEvents = timelineEvents.filter(isComplete);
  const timelineConflicts = computeTimelineConflicts(timelineEvents, { view: "book" }).size;
  const coverage = computeCoverage(chapters, completeEvents);
  const timeline: OverviewTimeline = {
    events: timelineEvents.length,
    complete: completeEvents.length,
    incomplete: timelineEvents.length - completeEvents.length,
    conflicts: timelineConflicts,
    chaptersAnchored: coverage.anchoredChapterCount,
  };

  const fsByStatus = (st: string) => foreshadowings.filter((f) => f.status === st).length;
  const foreshadowingsOverview: OverviewForeshadowing = {
    total: foreshadowings.length,
    pending: fsByStatus("pending"),
    paidoff: fsByStatus("paidoff"),
    abandoned: fsByStatus("abandoned"),
    overdue: foreshadowings.filter((f) => isOverdue(f, chapters)).length,
  };

  const report = buildProofreadReport(chapters, outlines, timelineEvents, foreshadowings, storylines);
  const proofread = {
    issues: report.issues.length,
    byGroup: PROOFREAD_GROUPS.map((g) => ({ group: g, count: report.counts[g] ?? 0 })).filter((x) => x.count > 0),
  };

  // 日更趋势：把当日全书总字数快照差分出每日新增。无快照则全 0（空书/未落库）。
  const dailyDeltas = diffDailyStats(input.dailyStats ?? [], new Date());
  const last7 = dailyDeltas.slice(-7).reduce((sum, d) => sum + d.delta, 0);
  const last30 = dailyDeltas.reduce((sum, d) => sum + d.delta, 0);
  let streak = 0;
  for (let i = dailyDeltas.length - 1; i >= 0; i--) {
    if (dailyDeltas[i].delta > 0) streak += 1;
    else break;
  }
  const dailyTrend: OverviewDailyTrend = {
    last7,
    last30,
    streak,
    series: dailyDeltas.map((d) => ({ day: d.day, delta: d.delta })),
  };

  return {
    bookTitle,
    kpis,
    volumes: volumeRows,
    characters,
    worldviews,
    settingAttached,
    settingOrphan,
    looseBeats: looseBeatsCount,
    timeline,
    storylines: storylines.length,
    foreshadowings: foreshadowingsOverview,
    proofread,
    dailyTrend,
  };
}

/**
 * 全书语料（中英双语），注入 AI 助手上下文，让模型每轮都带真实全书数据作答。
 * 刻意保持**紧凑**：KPI + 各维度计数 + 关键预警，不展开事件全表（那由各题材语料负责）。
 */
export function buildBookOverviewCorpus(o: BookOverview): { zh: string; en: string } {
  const zh = [
    "【全书总览】",
    `- 书名：${o.bookTitle ?? "（未命名）"}`,
    `- 体量：总字数 ${o.kpis.totalWords} · 章节 ${o.kpis.chapterCount} · 卷 ${o.kpis.volumeCount} · 平均章长 ${o.kpis.avgWords} 字`,
    `- 人物 ${o.characters} · 世界观设定 ${o.worldviews} · 已挂要素设定 ${o.settingAttached} · 孤立设定 ${o.settingOrphan}`,
    `- 未落章节拍（念头池）：${o.looseBeats}`,
    `- 时间线：事件 ${o.timeline.events}（完整 ${o.timeline.complete} / 待补全 ${o.timeline.incomplete}）· 同轨冲突 ${o.timeline.conflicts} · 已锚定章 ${o.timeline.chaptersAnchored}/${o.kpis.chapterCount}`,
    `- 剧情线：${o.storylines}`,
    `- 伏笔：共 ${o.foreshadowings.total}（待回收 ${o.foreshadowings.pending} / 已回收 ${o.foreshadowings.paidoff} / 已弃置 ${o.foreshadowings.abandoned}）· 跨章预警 ${o.foreshadowings.overdue}`,
    `- 校对体检：发现问题 ${o.proofread.issues}`
      + (o.proofread.byGroup.length > 0
        ? `（${o.proofread.byGroup.map((g) => `${g.group} ${g.count}`).join("、")}）`
        : ""),
    o.dailyTrend.last30 > 0
      ? `- 日更趋势：近7天 +${o.dailyTrend.last7} 字 · 近30天 +${o.dailyTrend.last30} 字 · 连续写作 ${o.dailyTrend.streak} 天`
      : "- 日更趋势：暂无落库快照（尚未记录每日字数）",
    "- 以上为全书跨维度快照，用于把握整体进度与风险；具体题材的明细见对应题材语料。",
  ].join("\n");

  const en = [
    "[Book Overview]",
    `- Title: ${o.bookTitle ?? "(untitled)"}`,
    `- Size: ${o.kpis.totalWords} words · ${o.kpis.chapterCount} chapters · ${o.kpis.volumeCount} volumes · avg ${o.kpis.avgWords} words/chapter`,
    `- Characters ${o.characters} · Worldbuilding ${o.worldviews} · Settings attached to beats ${o.settingAttached} · Orphan settings ${o.settingOrphan}`,
    `- Unanchored beats (idea pool): ${o.looseBeats}`,
    `- Timeline: ${o.timeline.events} events (complete ${o.timeline.complete} / drafts ${o.timeline.incomplete}) · same-track conflicts ${o.timeline.conflicts} · chapters anchored ${o.timeline.chaptersAnchored}/${o.kpis.chapterCount}`,
    `- Storylines: ${o.storylines}`,
    `- Foreshadowing: ${o.foreshadowings.total} total (pending ${o.foreshadowings.pending} / paid off ${o.foreshadowings.paidoff} / abandoned ${o.foreshadowings.abandoned}) · overdue warnings ${o.foreshadowings.overdue}`,
    `- Proofread: ${o.proofread.issues} findings`
      + (o.proofread.byGroup.length > 0
        ? ` (${o.proofread.byGroup.map((g) => `${g.group} ${g.count}`).join(", ")})`
        : ""),
    o.dailyTrend.last30 > 0
      ? `- Daily trend: +${o.dailyTrend.last7} words in last 7 days · +${o.dailyTrend.last30} in last 30 · ${o.dailyTrend.streak}-day writing streak`
      : "- Daily trend: no stored snapshots yet (daily word counts not recorded)",
    "- The above is a cross-dimension snapshot of the whole book for overall progress and risk; per-topic details are in the topic-specific corpus.",
  ].join("\n");

  return { zh, en };
}
