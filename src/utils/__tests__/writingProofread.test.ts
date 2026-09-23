// 校对体检口径（utils/writingProofread）单测：
//   - chapterTextIssues 五类文本检查（重复标点/三连同字/超长段落/连续空行/引号混用）
//   - buildProofreadReport 六组分组与跳转 target
// 这两条错了会出现「校对页签报假问题」或「发现行点了跳不走」。
import { describe, it, expect } from "vitest";
import { buildProofreadReport, chapterTextIssues } from "../writingProofread";
import type { WritingChapter, WritingForeshadowing, WritingOutline, WritingTimelineEvent } from "../../services/tauri";

const ch = (id: string, content = "", wordCount = 0, status = "draft"): WritingChapter =>
  ({ id, bookId: "b1", title: id, content, sortOrder: 0, wordCount, status, volume: "", kind: "章", extra: "{}", createdAt: 0, updatedAt: 0 }) as WritingChapter;

const beat = (id: string, extra = "{}"): WritingOutline =>
  ({ id, bookId: "b1", title: `节拍 ${id}`, summary: "", chapterId: null, extra, sortOrder: 0, createdAt: 0, updatedAt: 0 }) as WritingOutline;

const ev = (id: string, at: string, storylineId: string | null = null): WritingTimelineEvent =>
  ({ id, bookId: "b1", settingId: null, at, event: `事件 ${id}`, chapterId: null, storylineId, sortOrder: 0, createdAt: 0, updatedAt: 0 }) as WritingTimelineEvent;

const fs = (id: string, plant: string, payoff: string): WritingForeshadowing =>
  ({ id, bookId: "b1", title: `伏笔 ${id}`, description: "", plantChapterId: plant, payoffChapterId: payoff, status: "pending", storylineId: null, sortOrder: 0, createdAt: 0, updatedAt: 0 }) as WritingForeshadowing;

describe("chapterTextIssues —— 五类文本检查", () => {
  it("重复标点：。。报 1 条并带计数", () => {
    const issues = chapterTextIssues(ch("c1", "他说好。。然后走了"));
    expect(issues.filter((i) => i.messageKey === "RepeatPunct")).toHaveLength(1);
  });

  it("三连同字：了了了报 1 条；普通叠词（慢慢）不报", () => {
    expect(chapterTextIssues(ch("c1", "完了了了，都完了"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: "RepeatChar" })]),
    );
    expect(chapterTextIssues(ch("c1", "他慢慢地走"))).toEqual([]);
  });

  it("超长段落：601 字单段报 1 条；600 字不报", () => {
    expect(chapterTextIssues(ch("c1", "字".repeat(601)))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: "LongParagraph" })]),
    );
    expect(chapterTextIssues(ch("c1", "字".repeat(600)))).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: "LongParagraph" })]),
    );
  });

  it("连续空行与引号混用", () => {
    expect(chapterTextIssues(ch("c1", "a\n\n\nb"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: "BlankLines" })]),
    );
    expect(chapterTextIssues(ch("c1", "他说“好”然后说\"行\""))).toEqual(
      expect.arrayContaining([expect.objectContaining({ messageKey: "QuoteMix" })]),
    );
  });

  it("每条发现都带章跳转 target（renderable ≠ useful）", () => {
    const issues = chapterTextIssues(ch("c1", "好。。"));
    expect(issues.every((i) => i.target?.type === "chapter" && i.target.id === "c1")).toBe(true);
  });
});

describe("buildProofreadReport —— 六组分组与跳转", () => {
  it("空章 / 完稿 0 字 / 预警伏笔 / 冲突事件 / 草稿 / 未挂线 / 未分发念头 各就各组", () => {
    const chapters = [ch("ch1", "", 0, "draft"), ch("ch2", "正文", 100, "finished"), ch("ch3", "", 0, "finished")];
    const outlines = [beat("b1")]; // 未分发念头（无 extra 挂载、未转时间线/伏笔）
    const events = [ev("e1", "第三日"), ev("e2", "第三日"), ev("e3", ""), ev("e4", "第五日", "sl1")];
    const foreshadowings = [fs("f1", "ch2", "ch1")]; // 回收章(ch1 序 0) ≤ 埋设章(ch2 序 1) → 预警
    const report = buildProofreadReport(chapters, outlines, events, foreshadowings, [{ id: "sl1" }]);

    expect(report.counts["chapter-account"]).toBe(2); // ch1 空章 + ch3 完稿 0 字
    expect(report.counts["foreshadow"]).toBe(1);
    expect(report.counts["timeline"]).toBe(3); // 冲突 e1/e2 两行 + 草稿 e3 汇总 1 行
    expect(report.counts["storyline"]).toBe(1); // e1/e2/e3 未挂线汇总 1 行
    expect(report.counts["idea"]).toBe(1);

    // 伏笔行 → 跳伏笔实体；冲突行 → 跳时间线事件
    const fsIssue = report.issues.find((i) => i.group === "foreshadow");
    expect(fsIssue?.target).toEqual({ type: "foreshadowing", id: "f1" });
    const conflictIssue = report.issues.find((i) => i.messageKey === "TimelineConflictRow");
    expect(conflictIssue?.target?.type).toBe("timeline-event");
  });

  it("体检全绿：空书零发现、counts 全 0", () => {
    const report = buildProofreadReport([], [], [], [], []);
    expect(report.issues).toHaveLength(0);
    for (const g of Object.keys(report.counts)) expect(report.counts[g as keyof typeof report.counts]).toBe(0);
  });

  it("已分发的念头不再计入未分发（beatImported 查重口径）", () => {
    const outlines = [beat("b1")];
    const events = [ev("e1", "")]; // event="事件 b1"? beatEventText(b1)="节拍 b1" ≠ "事件 e1" → 不算已转
    const withImport = [
      { ...ev("e9", ""), event: "节拍 b1" } as WritingTimelineEvent,
    ];
    expect(buildProofreadReport([], outlines, events, [], []).counts["idea"]).toBe(1);
    expect(buildProofreadReport([], outlines, withImport, [], []).counts["idea"]).toBe(0);
  });
});
