import { describe, it, expect, beforeEach } from "vitest";
import { useWritingStore } from "../../../store/writingStore";
import { writingContextProvider, WRITING_MODULE_ID } from "../writingContextProvider";
import type { WritingBook, WritingChapter, WritingOutline, WritingSetting, WritingTimelineEvent, WritingStoryline, WritingForeshadowing } from "../../../services/tauri";

const BOOK_ID = "book_test";

function makeBook(): WritingBook {
  return {
    id: BOOK_ID,
    title: "测试之书",
    description: "一个测试用的故事",
    genre: "",
    medium: "",
    status: "draft",
    coverColor: "#4A338F",
    dailyGoal: 0,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function makeChapter(partial: Partial<WritingChapter>): WritingChapter {
  return {
    id: `chap_${Math.random().toString(36).slice(2, 8)}`,
    bookId: BOOK_ID,
    title: "第一章",
    content: "<p>林越推开门，雨声涌了进来。</p>",
    sortOrder: 1,
    wordCount: 12,
    status: "draft",
    volume: "",
    parentId: null,
    kind: "章",
    extra: "{}",
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  } as WritingChapter;
}

function makeSetting(partial: Partial<WritingSetting>): WritingSetting {
  return {
    id: `set_${Math.random().toString(36).slice(2, 8)}`,
    bookId: BOOK_ID,
    kind: "character",
    name: "林越",
    subtitle: "主角",
    description: "沉默寡言的前刑警，怕水。",
    extra: "{}",
    sortOrder: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

describe("writingContextProvider", () => {
  beforeEach(() => {
    useWritingStore.setState({
      books: [makeBook()],
      activeBookId: BOOK_ID,
      activeChapterId: null,
      chapters: [makeChapter({})],
      settings: [makeSetting({})],
      activeSettingId: null,
      timelineEvents: [],
    });
  });

  it("isAvailable 仅对当前激活书为真", () => {
    expect(writingContextProvider.isAvailable(BOOK_ID)).toBe(true);
    expect(writingContextProvider.isAvailable("book_other")).toBe(false);
  });

  it("未激活的书 buildPack 返回 null", () => {
    useWritingStore.setState({ activeBookId: null });
    expect(writingContextProvider.buildPack(BOOK_ID)).toBeNull();
  });

  it("buildPack 产出八个分节，正文为纯文本", () => {
    useWritingStore.setState({ activeChapterId: null, chapters: [makeChapter({ id: "chap_a" })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 });
    expect(pack).not.toBeNull();
    expect(pack!.moduleId).toBe(WRITING_MODULE_ID);
    expect(pack!.scopeLabel).toBe("测试之书");
    const keys = pack!.sections.map((s) => s.key);
    // P0-2：写作域五组语料接入后 4 → 8（时间线·剧情线 / 伏笔 / 灵感 / 校对）
    expect(keys).toEqual([
      "book-overview",
      "active-chapter",
      "characters",
      "worldbuilding",
      "timeline-storylines",
      "foreshadowing",
      "inspirations",
      "proofread",
    ]);

    // 正文分节：无选中章节 → empty + 明确盲区声明
    const chapterSection = pack!.sections.find((s) => s.key === "active-chapter")!;
    expect(chapterSection.dataQuality?.status).toBe("empty");

    // 人设卡有数据 → ok，且 facts 带结构化名单
    const charSection = pack!.sections.find((s) => s.key === "characters")!;
    expect(charSection.dataQuality?.status ?? "ok").toBe("ok");
    expect(charSection.facts).toMatchObject({ count: 1, names: ["林越"] });
  });

  it("正文分节在选中章节时剥离 HTML 标签", () => {
    useWritingStore.setState({ activeChapterId: "chap_a", chapters: [makeChapter({ id: "chap_a" })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const chapterSection = pack.sections.find((s) => s.key === "active-chapter")!;
    expect(chapterSection.dataQuality?.status ?? "ok").toBe("ok");
    expect(chapterSection.content).toContain("林越推开门");
    expect(chapterSection.content).not.toContain("<p>");
  });

  it("没有人设卡时 characters 分节声明 empty 并解释后果（不把没数据读成没问题）", () => {
    useWritingStore.setState({ settings: [] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === "characters")!;
    expect(charSection.dataQuality?.status).toBe("empty");
    expect(charSection.dataQuality?.reason).toBeTruthy();
  });

  it("人设卡时间线（独立表 writing_timeline_events）渲染进 characters 分节（D 全书级实体）", () => {
    const setting = makeSetting({
      extra: JSON.stringify({
        relations: [{ target: "苏晚", type: "旧搭档" }],
      }),
    });
    const ev: WritingTimelineEvent = {
      id: "ev_1",
      bookId: BOOK_ID,
      settingId: setting.id,
      at: "第一章前",
      event: "离开刑警队",
      chapterId: null,
      storylineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    useWritingStore.setState({ settings: [setting], timelineEvents: [ev] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === "characters")!;
    expect(charSection.content).toContain("苏晚(旧搭档)");
    expect(charSection.content).toContain("第一章前：离开刑警队");
    expect(charSection.facts).toMatchObject({ count: 1, relationsTotal: 1, timelineTotal: 1 });
  });

  it("人设卡 extra 是坏 JSON 时按空数据处理，不让 pack 构建崩掉", () => {
    useWritingStore.setState({ settings: [makeSetting({ extra: "{not-json" })] });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const charSection = pack.sections.find((s) => s.key === "characters")!;
    expect(charSection.facts).toMatchObject({ count: 1, relationsTotal: 0, timelineTotal: 0 });
  });

  it("book-overview 渲染大纲节拍（P5）：已落章显示章节名，梗概跟随", () => {
    useWritingStore.setState({
      activeChapterId: "chap_a",
      chapters: [makeChapter({ id: "chap_a" })],
      outlines: [
        {
          id: "o1",
          bookId: BOOK_ID,
          title: "雨夜重逢",
          summary: "林越再遇苏晚",
          chapterId: "chap_a",
          extra: "{}",
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        } satisfies WritingOutline,
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const overview = pack.sections.find((s) => s.key === "book-overview")!;
    expect(overview.content).toContain("雨夜重逢 → 第一章");
    expect(overview.content).toContain("林越再遇苏晚");
    expect(overview.facts).toMatchObject({ outlineCount: 1 });
  });

  it("提供写作预设，且不写死 agent / 模型", () => {
    const presets = writingContextProvider.presets ?? [];
    expect(presets.map((p) => p.key)).toContain("character-consistency");
    expect(presets.map((p) => p.key)).toContain("plot-review");
    // 预设协议里没有 agent 字段——agentId 永远由用户在发起时选择
    for (const p of presets) {
      expect((p as unknown as Record<string, unknown>).agentId).toBeUndefined();
    }
  });

  it("相同内容两次构建 digest 一致（增量闸门的前提）", () => {
    useWritingStore.setState({ activeChapterId: "chap_a", chapters: [makeChapter({ id: "chap_a" })] });
    const p1 = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    const p2 = writingContextProvider.buildPack(BOOK_ID, { now: 6000 })!;
    expect(p1.digest).toBe(p2.digest);
  });

  it("写作域语料分节（P0-2）：时间线/伏笔/灵感渲染进 pack 且带计数 facts", () => {
    const storyline: WritingStoryline = {
      id: "sl_1",
      bookId: BOOK_ID,
      name: "复仇线",
      color: "#4fc3f7",
      description: "主线",
      sortOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const ev: WritingTimelineEvent = {
      id: "ev_t1",
      bookId: BOOK_ID,
      settingId: null,
      at: "第一章",
      event: "林越收到匿名信",
      chapterId: null,
      storylineId: "sl_1",
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const foreshadowing: WritingForeshadowing = {
      id: "fs_1",
      bookId: BOOK_ID,
      title: "雨夜的怀表",
      description: "林越口袋里多了一块不属于他的怀表",
      plantChapterId: null,
      payoffChapterId: null,
      status: "pending",
      storylineId: null,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    useWritingStore.setState({
      timelineEvents: [ev],
      storylines: [storyline],
      foreshadowings: [foreshadowing],
      outlines: [
        {
          id: "o_loose",
          bookId: BOOK_ID,
          title: "苏晚也许知道真相",
          summary: "",
          chapterId: null,
          extra: "{}",
          sortOrder: 1,
          createdAt: 1,
          updatedAt: 1,
        } satisfies WritingOutline,
      ],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;

    const timeline = pack.sections.find((s) => s.key === "timeline-storylines")!;
    expect(timeline.content).toContain("林越收到匿名信");
    expect(timeline.facts).toMatchObject({ eventCount: 1, storylineCount: 1 });

    const fs = pack.sections.find((s) => s.key === "foreshadowing")!;
    expect(fs.content).toContain("雨夜的怀表");
    expect(fs.facts).toMatchObject({ count: 1 });

    const insp = pack.sections.find((s) => s.key === "inspirations")!;
    expect(insp.content).toContain("苏晚也许知道真相");
    expect(insp.facts).toMatchObject({ looseCount: 1 });
  });

  it("空库时四个语料分节仍产出（builder 自带「暂无」兜底，不崩、不丢分节）", () => {
    useWritingStore.setState({
      activeChapterId: null,
      timelineEvents: [],
      storylines: [],
      foreshadowings: [],
      outlines: [],
    });
    const pack = writingContextProvider.buildPack(BOOK_ID, { now: 5000 })!;
    for (const key of ["timeline-storylines", "foreshadowing", "inspirations", "proofread"]) {
      const sec = pack.sections.find((s) => s.key === key);
      expect(sec, `${key} 分节应存在`).toBeTruthy();
      expect((sec!.content ?? "").length).toBeGreaterThan(0);
    }
  });
});
