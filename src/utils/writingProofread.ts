// 校对体检口径（收拢纯函数，禁止在 pane/右栏各写第二份）：
//
// 校对页签 = 全书质量发现清单：**纯本地派生、零新表、零 Rust**，六组维度——
//   章文本（重复标点/三连同字/超长段落/连续空行/引号混用，本地正则，advisory 软提示）
//   章账（空章 / 标记完稿但 0 字）
//   伏笔（跨章预警，isOverdue 复用）
//   时间线（冲突 computeTimelineConflicts 复用 + 待补全草稿汇总）
//   剧情线（未挂线事件汇总）
//   念头池（未分发念头汇总，beatImported/beatPlantedAsForeshadowing 复用）
// 发现是**可行动的**：每行带 target，点行即跳对应章/页签/实体（renderable ≠ useful）。
// 文本检查刻意克制：每章每类最多 1 条汇总行（带计数），不做逐条轰炸。
import type { WritingChapter, WritingForeshadowing, WritingOutline, WritingTimelineEvent } from "../services/tauri";
import { isOverdue } from "./writingForeshadowing";
import { computeTimelineConflicts, isComplete } from "./writingTimeline";
import { looseBeats } from "./writingOutline";
import { beatEventText, beatImported } from "./writingTimeline";
import { beatPlantedAsForeshadowing } from "./writingInspiration";

export type ProofreadGroup =
  | "chapter-text"
  | "chapter-account"
  | "foreshadow"
  | "timeline"
  | "storyline"
  | "idea";

export type ProofreadTarget =
  | { type: "chapter"; id: string }
  | { type: "foreshadowing"; id: string }
  | { type: "timeline-event"; id: string }
  | { type: "idea"; id: string }
  | { type: "view"; id: "timeline" | "storylines" | "inspiration" | "foreshadowing" };

export interface ProofreadIssue {
  /** 稳定 key（React key / 跳转定位） */
  key: string;
  group: ProofreadGroup;
  /** i18n 键（writing.proofreadIssue.* 扁平键） */
  messageKey: string;
  args?: Record<string, string | number>;
  /** 跳转目标；无 = 仅计数展示 */
  target?: ProofreadTarget;
}

/** 单章文本级检查（每类最多 1 条汇总行，args 带计数/字数）。 */
export function chapterTextIssues(chapter: WritingChapter): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  const text = chapter.content ?? "";
  if (!text.trim()) return issues;
  const mk = (messageKey: string, args?: Record<string, string | number>): ProofreadIssue => ({
    key: `${chapter.id}:${messageKey}`,
    group: "chapter-text",
    messageKey,
    args,
    target: { type: "chapter", id: chapter.id },
  });
  // 重复标点：。。！！？？……——（同一标点紧邻出现 ≥2 次）
  const punct = text.match(/([。！？…，、；：])\1{1,}/g);
  if (punct && punct.length > 0) issues.push(mk("RepeatPunct", { n: punct.length }));
  // 三连同字：了了了 / 的的的 —— 几乎必是笔误（两连叠词是正常修辞，不报）
  const repeat = text.match(/([\u4e00-\u9fff])\1{2,}/g);
  if (repeat && repeat.length > 0) issues.push(mk("RepeatChar", { n: repeat.length }));
  // 超长段落：单段 > 600 字无分段（阅读负担，advisory）
  const longPara = text.split(/\n/).filter((p) => p.trim().length > 600);
  if (longPara.length > 0) issues.push(mk("LongParagraph", { n: longPara.length }));
  // 连续空行：≥3 个换行（含空白行）
  const blanks = text.match(/\n[ \t]*\n[ \t]*\n/g);
  if (blanks && blanks.length > 0) issues.push(mk("BlankLines", { n: blanks.length }));
  // 引号风格混用：弯引号与直引号并存
  if (text.includes("“") && text.includes('"')) issues.push(mk("QuoteMix"));
  return issues;
}

export interface ProofreadReport {
  issues: ProofreadIssue[];
  counts: Record<ProofreadGroup, number>;
}

export const PROOFREAD_GROUPS: ProofreadGroup[] = [
  "chapter-text",
  "chapter-account",
  "foreshadow",
  "timeline",
  "storyline",
  "idea",
];

/** 全书体检汇总（六组维度；纯派生，零迁移，便于单测）。 */
export function buildProofreadReport(
  chapters: WritingChapter[],
  outlines: WritingOutline[],
  timelineEvents: WritingTimelineEvent[],
  foreshadowings: WritingForeshadowing[],
  storylines: { id: string }[] = []
): ProofreadReport {
  const issues: ProofreadIssue[] = [];

  // ① 章文本 + ② 章账（逐章）
  for (const c of chapters) {
    issues.push(...chapterTextIssues(c));
    if (!c.content?.trim() && (c.wordCount ?? 0) === 0) {
      issues.push({ key: `${c.id}:empty`, group: "chapter-account", messageKey: "EmptyChapter", args: { title: c.title || "…" }, target: { type: "chapter", id: c.id } });
    } else if (c.status === "finished" && (c.wordCount ?? 0) === 0) {
      issues.push({ key: `${c.id}:fin0`, group: "chapter-account", messageKey: "FinishedNoWords", args: { title: c.title || "…" }, target: { type: "chapter", id: c.id } });
    }
  }

  // ③ 伏笔：跨章预警逐条（isOverdue 与伏笔页签同一口径）
  for (const f of foreshadowings) {
    if (isOverdue(f, chapters)) {
      issues.push({
        key: `fs:${f.id}`,
        group: "foreshadow",
        messageKey: "ForeshadowOverdueRow",
        args: { title: f.title || "…" },
        target: { type: "foreshadowing", id: f.id },
      });
    }
  }

  // ④ 时间线：冲突逐行（跳选中事件）+ 待补全草稿汇总行（跳时间线页签）
  const conflictIds = computeTimelineConflicts(timelineEvents, { view: "book" });
  for (const evId of conflictIds) {
    const ev = timelineEvents.find((e) => e.id === evId);
    issues.push({
      key: `ev:${evId}`,
      group: "timeline",
      messageKey: "TimelineConflictRow",
      args: { text: (ev?.event || "").slice(0, 24) || "…" },
      target: { type: "timeline-event", id: evId },
    });
  }
  const drafts = timelineEvents.filter((e) => !isComplete(e));
  if (drafts.length > 0) {
    issues.push({ key: "tl:drafts", group: "timeline", messageKey: "TimelineDraftRow", args: { n: drafts.length }, target: { type: "view", id: "timeline" } });
  }

  // ⑤ 剧情线：未挂线事件汇总行
  const unlined = timelineEvents.filter((e) => !e.storylineId);
  if (unlined.length > 0) {
    issues.push({ key: "sl:unlined", group: "storyline", messageKey: "StorylineUnlinedRow", args: { n: unlined.length }, target: { type: "view", id: "storylines" } });
  }

  // ⑥ 念头池：未分发念头汇总行（已转时间线/伏笔的不算）
  const loose = looseBeats(outlines);
  const fresh = loose.filter((b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b));
  if (fresh.length > 0) {
    issues.push({
      key: "idea:fresh",
      group: "idea",
      messageKey: "IdeaUndispatchedRow",
      args: { n: fresh.length },
      target: fresh.length === 1 && fresh[0] ? { type: "idea", id: fresh[0].id } : { type: "view", id: "inspiration" },
    });
  }
  void storylines; // 预留：线级体检（空线/长静默线）后续在此扩展

  const counts = PROOFREAD_GROUPS.reduce(
    (acc, g) => ({ ...acc, [g]: issues.filter((i) => i.group === g).length }),
    {} as Record<ProofreadGroup, number>,
  );
  return { issues, counts };
}
