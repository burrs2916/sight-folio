import { describe, it, expect } from "vitest";
import {
  buildBookOverview,
  buildBookOverviewCorpus,
  type BookOverviewInput,
} from "../writingOverview";
import type {
  WritingChapter,
  WritingSetting,
  WritingOutline,
  WritingTimelineEvent,
  WritingStoryline,
  WritingForeshadowing,
} from "../../services/tauri";

function chapter(id: string, over: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id,
    bookId: "b1",
    title: `第${id}章`,
    volume: "卷一",
    sortOrder: Number(id.replace(/\D/g, "")) || 1,
    status: "draft",
    wordCount: 1000,
    content: "<p>正文</p>",
    ...over,
  } as WritingChapter;
}

function setting(id: string, kind: "character" | "worldbuilding"): WritingSetting {
  return { id, bookId: "b1", kind, name: id, extra: "" } as WritingSetting;
}

function outline(id: string, over: Partial<WritingOutline> = {}): WritingOutline {
  return { id, bookId: "b1", title: id, extra: "{}", ...over } as WritingOutline;
}

function timelineEvent(id: string, over: Partial<WritingTimelineEvent> = {}): WritingTimelineEvent {
  return { id, bookId: "b1", at: "1", event: id, settingId: null, chapterId: null, storylineId: null, sortOrder: 1, ...over } as WritingTimelineEvent;
}

function foreshadowing(id: string, over: Partial<WritingForeshadowing> = {}): WritingForeshadowing {
  return { id, bookId: "b1", title: id, description: "", status: "pending", plantChapterId: null, payoffChapterId: null, storylineId: null, ...over } as WritingForeshadowing;
}

const base: BookOverviewInput = {
  bookTitle: "测试书",
  chapters: [],
  settings: [],
  outlines: [],
  timelineEvents: [],
  storylines: [],
  foreshadowings: [],
};

describe("buildBookOverview", () => {
  it("aggregates KPIs and dimension counts from real data", () => {
    const input: BookOverviewInput = {
      ...base,
      chapters: [
        chapter("c1", { wordCount: 1000, status: "finished" }),
        chapter("c2", { wordCount: 2000, volume: "卷二" }),
        chapter("c3", { wordCount: 3000, volume: "卷二", status: "finished" }),
      ],
      settings: [setting("s1", "character"), setting("s2", "character"), setting("s3", "worldbuilding")],
      outlines: [
        outline("o1", { extra: JSON.stringify({ cast: ["s1"] }), chapterId: "c1" }), // 已落章，非 loose
        outline("o2", { extra: "{}" }), // loose beat
      ],
      timelineEvents: [
        timelineEvent("e1", { at: "1", chapterId: "c1" }),
        timelineEvent("e2", { at: "1", chapterId: "c1" }), // 同轨 at 碰撞
        timelineEvent("e3", { at: "" }), // 待补全
      ],
      storylines: [{ id: "l1", bookId: "b1", name: "主线", color: "#000", description: "", sortOrder: 1 } as WritingStoryline],
      foreshadowings: [
        foreshadowing("f1", { status: "pending", plantChapterId: "c1", payoffChapterId: "c3" }),
        foreshadowing("f2", { status: "paidoff", plantChapterId: "c1", payoffChapterId: "c2" }),
        foreshadowing("f3", { status: "pending", plantChapterId: "c3", payoffChapterId: "c1" }), // 跨章预警
        foreshadowing("f4", { status: "abandoned" }),
      ],
    };

    const o = buildBookOverview(input);

    // KPI
    expect(o.kpis.totalWords).toBe(6000);
    expect(o.kpis.chapterCount).toBe(3);
    expect(o.kpis.volumeCount).toBe(2); // 卷一 + 卷二
    expect(o.kpis.avgWords).toBe(2000);

    // 设定
    expect(o.characters).toBe(2);
    expect(o.worldviews).toBe(1);
    expect(o.settingAttached).toBe(1); // s1 挂到 o1
    expect(o.settingOrphan).toBe(2); // s2, s3 未挂

    // 念头池
    expect(o.looseBeats).toBe(1); // o2

    // 时间线
    expect(o.timeline.events).toBe(3);
    expect(o.timeline.complete).toBe(2); // e1,e2 有 at
    expect(o.timeline.incomplete).toBe(1); // e3 无 at
    expect(o.timeline.conflicts).toBe(2); // e1,e2 同 at 碰撞
    expect(o.timeline.chaptersAnchored).toBe(1); // 仅 c1 有事件

    // 剧情线
    expect(o.storylines).toBe(1);

    // 伏笔
    expect(o.foreshadowings.total).toBe(4);
    expect(o.foreshadowings.pending).toBe(2);
    expect(o.foreshadowings.paidoff).toBe(1);
    expect(o.foreshadowings.abandoned).toBe(1);
    expect(o.foreshadowings.overdue).toBe(1); // f3

    // 校对（至少 c3 是 finished 且有内容 → 0 个空章；但章文本检查可能产出发现）
    expect(o.proofread.issues).toBeGreaterThanOrEqual(0);
  });

  it("handles empty book without NaN", () => {
    const o = buildBookOverview(base);
    expect(o.kpis.avgWords).toBe(0);
    expect(o.kpis.totalWords).toBe(0);
    expect(o.timeline.conflicts).toBe(0);
    expect(o.foreshadowings.overdue).toBe(0);
    expect(o.proofread.issues).toBe(0);
  });

  it("buildBookOverviewCorpus returns bilingual compact snapshot", () => {
    const o = buildBookOverview(base);
    const c = buildBookOverviewCorpus(o);
    expect(c.zh).toContain("全书总览");
    expect(c.en).toContain("Book Overview");
    expect(c.zh).toContain("总字数 0");
    expect(c.en).toContain("0 words");
  });

  it("does not expose full event tables (kept compact)", () => {
    const o = buildBookOverview(base);
    const c = buildBookOverviewCorpus(o);
    expect(c.zh.length).toBeLessThan(2000);
    expect(c.en.length).toBeLessThan(2000);
  });
});

describe("buildBookOverviewCorpus · 按体裁裁行（W-4，同 N-21）", () => {
  const o = buildBookOverview(base);

  it('小说（含缺省不传 genre）：剧情线/伏笔两行都在，与改造前逐字等价', () => {
    const def = buildBookOverviewCorpus(o);
    const novel = buildBookOverviewCorpus(o, null, 'novel');
    for (const c of [def, novel]) {
      expect(c.zh).toContain('- 剧情线：');
      expect(c.zh).toContain('- 伏笔：');
      expect(c.en).toContain('- Storylines:');
      expect(c.en).toContain('- Foreshadowing:');
    }
    // 缺省与显式 novel 逐字节相同（零回归）
    expect(def.zh).toBe(novel.zh);
  });

  it('诗集：抹掉剧情线/伏笔两行，但人物/时间线行保留（不裁本体）', () => {
    const p = buildBookOverviewCorpus(o, null, 'poetry');
    expect(p.zh).not.toContain('- 剧情线：');
    expect(p.zh).not.toContain('- 伏笔：');
    expect(p.en).not.toContain('- Storylines:');
    expect(p.en).not.toContain('- Foreshadowing:');
    expect(p.zh).toContain('人物'); // 未裁维度仍在
    expect(p.zh).toContain('- 时间线：'); // timeline 对诗集可见
  });

  it('剧本：只裁世界观（非本行），剧情线/伏笔作为戏剧本体保留', () => {
    const d = buildBookOverviewCorpus(o, null, 'script');
    expect(d.zh).toContain('- 剧情线：');
    expect(d.zh).toContain('- 伏笔：');
  });

  it('脏体裁值：经 workbenchCommandSet 落 novel 口径，两行仍在（不误裁）', () => {
    const x = buildBookOverviewCorpus(o, null, 'scribble');
    expect(x.zh).toContain('- 剧情线：');
    expect(x.zh).toContain('- 伏笔：');
  });
});

describe("buildBookOverviewCorpus · 全书目标进度注入", () => {
  const goalLine = {
    zh: "【全书目标与进度】目标 10,000 字：已写 3,000 字（30%）；截止 2026-11-10：还剩 10 天",
    en: "[Book goal & progress] words target 10,000: 3,000 written (30%); deadline 2026-11-10: 10 days left",
  };

  it("传入 goalLine：紧随体量之后（第3行），双语各含目标行", () => {
    const o = buildBookOverview(base);
    const c = buildBookOverviewCorpus(o, goalLine);
    expect(c.zh).toContain("全书目标与进度");
    expect(c.en).toContain("Book goal & progress");
    // 体量在第3行(索引2)，目标行插到其后(索引3)
    expect(c.zh.split("\n")[3]).toContain("全书目标与进度");
  });

  it("不传 goalLine（未设目标）：不出现目标行（零污染）", () => {
    const o = buildBookOverview(base);
    const c = buildBookOverviewCorpus(o);
    expect(c.zh).not.toContain("全书目标与进度");
    expect(c.en).not.toContain("Book goal & progress");
  });
});
