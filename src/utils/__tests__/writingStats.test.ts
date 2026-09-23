// utils/writingStats 单测：KPI / 卷分布 / 章节体量离群 / 日更快照差分
// 锁死口径（pane、右栏总览卡、AI 语料三处共用这一份，口径错即三处同错）。
import { describe, it, expect } from "vitest";
import {
  buildChapterWordRows,
  buildVolumeRows,
  chapterOutlier,
  computeWritingKpis,
  diffDailyStats,
  localDay,
} from "../writingStats";
import type { WritingChapter, WritingDailyStat, WritingSetting } from "../../services/tauri";

const ch = (o: Partial<WritingChapter> & { id: string }): WritingChapter =>
  ({
    bookId: "b1",
    title: o.id,
    content: "",
    sortOrder: 0,
    wordCount: 0,
    status: "draft",
    volume: "",
    extra: "{}",
    createdAt: 0,
    updatedAt: 0,
    ...o,
  }) as WritingChapter;

const setting = (id: string): WritingSetting =>
  ({ id, bookId: "b1", name: id, kind: "character", content: "{}", extra: "{}", createdAt: 0, updatedAt: 0 }) as unknown as WritingSetting;

describe("computeWritingKpis", () => {
  it("汇总总字数/章节数/卷数/设定数/章均（未分卷不算卷）", () => {
    const chapters = [
      ch({ id: "c1", wordCount: 1000, volume: "第一卷" }),
      ch({ id: "c2", wordCount: 2000, volume: "第一卷" }),
      ch({ id: "c3", wordCount: 3000, volume: "" }),
    ];
    const kpis = computeWritingKpis(chapters, [setting("s1"), setting("s2")]);
    expect(kpis.totalWords).toBe(6000);
    expect(kpis.chapterCount).toBe(3);
    expect(kpis.volumeCount).toBe(1); // 空卷名不是一卷
    expect(kpis.settingCount).toBe(2);
    expect(kpis.avgWords).toBe(2000);
    expect(kpis.maxChapterWords).toBe(3000);
  });

  it("空书全 0 不炸", () => {
    const kpis = computeWritingKpis([], []);
    expect(kpis.totalWords).toBe(0);
    expect(kpis.avgWords).toBe(0);
    expect(kpis.maxVolumeWords).toBe(0);
  });
});

describe("buildVolumeRows", () => {
  it("按首次出现顺序归组，完稿计数", () => {
    const chapters = [
      ch({ id: "c1", wordCount: 100, volume: "卷二", status: "finished" }),
      ch({ id: "c2", wordCount: 200, volume: "卷一" }),
      ch({ id: "c3", wordCount: 300, volume: "卷二" }),
    ];
    const rows = buildVolumeRows(chapters);
    expect(rows.map((r) => r.volume)).toEqual(["卷二", "卷一"]); // 首现顺序
    expect(rows[0]).toMatchObject({ chapters: 2, words: 400, finished: 1 });
    expect(rows[0].chapterIds).toEqual(["c1", "c3"]);
  });
});

describe("chapterOutlier / buildChapterWordRows", () => {
  it("超长 = >2×章均；偏短 = <0.3×章均且章数≥3", () => {
    // 章均 2000：4000 不算超长（边界），4001 超长；500 偏短，600 不算
    expect(chapterOutlier(4000, 2000, 5)).toBeNull();
    expect(chapterOutlier(4001, 2000, 5)).toBe("long");
    expect(chapterOutlier(500, 2000, 5)).toBe("short");
    expect(chapterOutlier(600, 2000, 5)).toBeNull();
    // 0 字章不标偏短（空章是章账的事，不是体量离群）
    expect(chapterOutlier(0, 2000, 5)).toBeNull();
    // 1~2 章的书不标偏短（短篇常态）
    expect(chapterOutlier(100, 2000, 2)).toBeNull();
  });

  it("buildChapterWordRows 保持章序并带离群标注", () => {
    const chapters = [
      ch({ id: "c1", title: "第一章", wordCount: 1000, sortOrder: 1 }),
      ch({ id: "c2", title: "第二章", wordCount: 9000, sortOrder: 2 }),
      ch({ id: "c3", title: "第三章", wordCount: 1000, sortOrder: 3 }),
    ];
    // 章均 ≈ 3667：9000 > 2× → long；1000 < 0.3× → short
    const rows = buildChapterWordRows(chapters);
    expect(rows.map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
    expect(rows[0].outlier).toBe("short");
    expect(rows[1].outlier).toBe("long");
    expect(rows[2].outlier).toBe("short");
  });
});

describe("diffDailyStats", () => {
  it("快照差分出每日新增；缺快照沿用最近已知总量（不归零）", () => {
    const today = new Date(2026, 8, 20); // 本地 2026-09-20
    const stats: WritingDailyStat[] = [
      { day: localDay(new Date(2026, 8, 18)), wordCount: 1000 },
      { day: localDay(new Date(2026, 8, 20)), wordCount: 2500 },
      // 09-19 缺快照
    ];
    const deltas = diffDailyStats(stats, today);
    expect(deltas).toHaveLength(30);
    // 末三位：09-18 前基线之后…直接按 day 查
    const byDay = new Map(deltas.map((d) => [d.day, d.delta]));
    expect(byDay.get("2026-09-19")).toBe(0); // 缺快照 → 总量没变
    expect(byDay.get("2026-09-20")).toBe(1500); // 2500 - 1000
  });

  it("负差分钳为 0（防回退噪声）", () => {
    const today = new Date(2026, 8, 20);
    const stats: WritingDailyStat[] = [
      { day: localDay(new Date(2026, 8, 19)), wordCount: 2000 },
      { day: localDay(new Date(2026, 8, 20)), wordCount: 500 }, // 异常回退
    ];
    const deltas = diffDailyStats(stats, today);
    expect(deltas[deltas.length - 1]?.delta).toBe(0);
  });
});
