// 右栏「创作组件」注册表测试
//
// 守两件事：
//   1. 分组语义 —— typed 组只给当前 L2 的专属元素、generic 组恒在（正文视图除外），
//      缺专属元素的视图必须给 hint 而不是空面板（联动绝不静默）；
//   2. 条目可用性 —— entityType 必须是真实注册过的类型、blank 语义与落点链路一致，
//      且所有 label / desc / group 键都能被 t() 解析（否则面板会渲染裸 key）。
import { describe, it, expect } from "vitest";
import {
  paletteFor,
  PALETTE_ENTITY_TYPES,
  PALETTE_PENDING,
  PALETTE_WRITING_HINT,
  PALETTE_TIMELINE_HINT,
} from "../writingPalette";
import { t } from "../../i18n";

const allItems = (genre: string, kind: Parameters<typeof paletteFor>[1]) =>
  paletteFor(genre, kind).groups.flatMap((g) => g.items);

describe("paletteFor", () => {
  it("大纲：给「本视图元素」（章 + 概要条）+「通用元素」（便签）两组", () => {
    const r = paletteFor("novel", "catalog");
    expect(r.groups.map((g) => g.key)).toEqual(["typed", "generic"]);
    const typed = r.groups[0].items;
    expect(typed.map((i) => i.id)).toEqual(["chapter", "outline"]);
    expect(r.groups[1].items.map((i) => i.id)).toEqual(["note"]);
    expect(r.hintKey).toBeNull();
  });

  it("章的叫法随书的体裁走：小说「章节」、散文「篇目」", () => {
    expect(allItems("novel", "catalog").find((i) => i.id === "chapter")!.labelKey)
      .toBe("analyzer.writing.entity.chapter.name");
    const essay = allItems("essay", "catalog").find((i) => i.id === "chapter")!;
    expect(essay.labelKey).toBe("writingLeft.tplEssayPiece");
    // 散文分支的键没进上面那条「键全可解析」的循环（它只跑 novel），在这里单独兜住
    expect(t(essay.labelKey)).not.toBe(essay.labelKey);
    // genre 同时随 payload 传给落点建档（章节命名与拖出分区口径一致）
    expect(essay.config).toMatchObject({ __blank: true, genre: "essay" });
  });

  it("诗歌拖源叫「诗作」，说明行也跟着换成「一首」（2026-11-09 开闸）", () => {
    const poem = allItems("poetry", "catalog").find((i) => i.id === "chapter")!;
    expect(poem.labelKey).toBe("writingLeft.tplPoem");
    expect(t(poem.labelKey)).toBe("诗作");
    // 说明行必须一起换：昨天散文只换了标签，说明还写着「拖出即建一章」，同一概念两个名词
    expect(t(poem.descKey)).toContain("一首");
    expect(poem.config).toMatchObject({ __blank: true, genre: "poetry" });
  });

  it("四个体裁的拖源标签与说明都翻得出来（面板不许渲染裸 key）", () => {
    for (const genre of ["novel", "essay", "poetry", "script"]) {
      for (const item of allItems(genre, "catalog")) {
        expect(t(item.labelKey), `${genre}/${item.id} 标签`).not.toBe(item.labelKey);
        expect(t(item.descKey), `${genre}/${item.id} 说明`).not.toBe(item.descKey);
      }
    }
  });

  it("人物 / 世界观：各只给自己的设定卡，且都走真建档", () => {
    const chars = paletteFor("novel", "characters");
    expect(chars.groups.find((g) => g.key === "typed")!.items.map((i) => i.id)).toEqual(["character"]);
    expect(chars.groups.find((g) => g.key === "typed")!.items[0].blank).toBe(true);
    expect(chars.hintKey).toBeNull();

    const world = paletteFor("novel", "worldview");
    expect(world.groups.find((g) => g.key === "typed")!.items.map((i) => i.id)).toEqual(["worldview"]);
    expect(world.hintKey).toBeNull();
  });

  it("正文视图：不出条目（画布被正文容器占满，落卡必被遮住），改给页签栏提示", () => {
    const r = paletteFor("novel", "writing");
    expect(r.groups).toEqual([]);
    expect(r.hintKey).toBe(PALETTE_WRITING_HINT);
  });

  it("时间线视图：只给通用元素 + 正确的聚合提示（事件在设定卡维护，非待数据模型）", () => {
    const r = paletteFor("novel", "timeline");
    expect(r.groups.map((g) => g.key)).toEqual(["generic"]);
    expect(r.hintKey).toBe(PALETTE_TIMELINE_HINT);
  });

  it("无专属元素的视图（统计/剧情线/伏笔）：只给通用元素 + 明示待数据模型，不放假条目", () => {
    for (const kind of ["stats", "storylines", "foreshadowing"] as const) {
      const r = paletteFor("novel", kind);
      expect(r.groups.map((g) => g.key)).toEqual(["generic"]);
      expect(r.hintKey).toBe(PALETTE_PENDING);
    }
  });

  it("视图没有 kind（遗留视图）按大纲处理，不给空面板", () => {
    const r = paletteFor("novel", undefined);
    expect(r.groups.map((g) => g.key)).toEqual(["typed", "generic"]);
    expect(r.hintKey).toBeNull();
  });

  it("历史遗留 kind（overview，非 WritingViewKind 成员）按无专属元素处理", () => {
    const r = paletteFor("novel", "overview");
    expect(r.groups.map((g) => g.key)).toEqual(["generic"]);
    expect(r.hintKey).toBe(PALETTE_PENDING);
  });

  it("所有条目的类型都是已注册实体，blank 语义与落点链路一致", () => {
    const kinds = ["catalog", "characters", "worldview", "timeline", "writing"] as const;
    const blankByType: Record<string, boolean> = {
      // 走 createBlankWritingEntity 真建档
      "writing-chapter": true,
      "writing-character": true,
      "writing-worldview": true,
      // 纯画布卡，不建业务实体
      "writing-outline": false,
      "annotation-text": false,
    };
    const seen = new Set<string>();
    for (const kind of kinds) {
      for (const item of allItems("novel", kind)) {
        seen.add(item.entityType);
        expect(PALETTE_ENTITY_TYPES).toContain(item.entityType);
        expect(item.blank).toBe(blankByType[item.entityType]);
        // blank 的条目必须把 __blank 放进 config，否则落点不会走建档链路
        expect(item.config.__blank === true).toBe(item.blank);
        expect(item.labelKey.length).toBeGreaterThan(0);
        expect(item.descKey.length).toBeGreaterThan(0);
      }
    }
    // 覆盖度：这 5 种就是面板当前的全部拖出物，多一个少一个都要有人注意到
    expect([...seen].sort()).toEqual([...PALETTE_ENTITY_TYPES].sort());
  });

  it("文案键全部可解析（面板不许渲染裸 key）", () => {
    const kinds = ["catalog", "characters", "worldview", "timeline", "writing"] as const;
    const resolves = (key: string) => t(key) !== key;
    for (const kind of kinds) {
      const r = paletteFor("novel", kind);
      for (const g of r.groups) {
        expect(resolves(g.labelKey), g.labelKey).toBe(true);
        for (const item of g.items) {
          expect(resolves(item.labelKey), item.labelKey).toBe(true);
          expect(resolves(item.descKey), item.descKey).toBe(true);
        }
      }
      if (r.hintKey) expect(resolves(r.hintKey), r.hintKey).toBe(true);
    }
    expect(resolves("editor.writing.palette.tab")).toBe(true);
    expect(resolves("writingLeft.palette")).toBe(true);
    expect(resolves("writingLeft.genreChipDragHint")).toBe(true);
  });
});
