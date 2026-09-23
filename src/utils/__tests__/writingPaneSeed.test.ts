// L2 题材编辑面 seed 语义（utils/writingPaneSeed）单测
//
// 这两条规则都能造成「看着没坏其实坏了」的故障：
//   - 映射错 → 用户在「人物设定」页签里编辑大纲，或在「大纲」页签里改人物；
//   - 残留判定错 → 老视图升级时会**删掉用户自己拖进来的卡**（与布局器产物同 type）。
// 所以两条都要锁死，尤其是「用户产物必须判 false」这条反向不变量。

import { describe, it, expect } from "vitest";
import {
  duplicateStudioPaneIds,
  findFullBleedCard,
  FULL_CANVAS_WRITING_CARDS,
  hasWritingCanvasCard,
  isFullCanvasWritingCard,
  isLegacyBoardCard,
  isWritingSurfaceTarget,
  shouldYieldToNativeContextMenu,
  studioPaneForViewKind,
  WRITING_CANVAS_CARD_TYPES,
  WRITING_SURFACE_ATTR,
} from "../writingPaneSeed";

describe("studioPaneForViewKind", () => {
  it("五个题材视图各映射到自己的编辑面", () => {
    expect(studioPaneForViewKind("catalog")).toBe("storyline");
    expect(studioPaneForViewKind("characters")).toBe("characters");
    expect(studioPaneForViewKind("worldview")).toBe("worldview");
    expect(studioPaneForViewKind("timeline")).toBe("timeline");
    // 剧情线页签此前不在表内 → 点开是空画布（2026-09-18 修）：线实体管理面
    expect(studioPaneForViewKind("storylines")).toBe("storylines");
    expect(studioPaneForViewKind("foreshadowing")).toBe("foreshadowings");
    // 灵感页签此前不在表内 → 点开是空画布（2026-09-18 修）：念头池分发工作台
    expect(studioPaneForViewKind("inspiration")).toBe("inspirations");
    // 校对页签此前不在表内 → 点开是空画布（2026-09-18 修）：全书体检发现清单
    expect(studioPaneForViewKind("proofread")).toBe("proofread");
    // 统计页签此前铺旧只读画布板（2026-09-19 升级）：StatsPane 编辑面
    expect(studioPaneForViewKind("stats")).toBe("stats");
    // 全书总览页签（2026-09-20 升级为 L2 第一公民）：BookOverviewPanel 编辑面
    expect(studioPaneForViewKind("overview")).toBe("overview");
  });

  it("非题材编辑视图返回 null（正文/自定义）", () => {
    // 注：timeline 已迁为工作室级编辑面（方向 A），故不再归于「非题材视图」；
    // storylines 已接剧情线管理面（P1 整合），同此；
    // foreshadowing 已接伏笔管理面（2026-09-18），同此；
    // inspiration 已接灵感工作台（2026-09-18），同此；
    // proofread 已接校对工作台（2026-09-18），同此；
    // stats 已接统计工作台（2026-09-19），同此
    for (const k of ["writing"]) {
      expect(studioPaneForViewKind(k)).toBeNull();
    }
  });

  it("空 / undefined / 历史遗留 kind 一律 null（不静默当大纲）", () => {
    // 注：overview 已升级为 L2 第一公民页签（studioPaneForViewKind 命中 → "overview"），
    // 不再是「历史遗留 kind」；此处只验真正未知的 kind 仍归 null，不静默当大纲。
    for (const k of [undefined, "", "不存在的kind"]) {
      expect(studioPaneForViewKind(k)).toBeNull();
    }
  });
});

describe("isLegacyBoardCard —— 布局器 seed 标记必须判 true", () => {
  it("分镜板：章节卡 shotNo / 卷头 kind=volume", () => {
    expect(isLegacyBoardCard("writing-chapter", { shotNo: 3, fileId: "wfile_a", title: "第 1 章" })).toBe(true);
    expect(isLegacyBoardCard("writing-outline", { kind: "volume", title: "第一卷" })).toBe(true);
  });

  it("时间线板：事件卡 kind=event", () => {
    expect(isLegacyBoardCard("writing-outline", { kind: "event", title: "大战" })).toBe(true);
  });

  it("统计板：KPI/卷/章卡 kind=stat", () => {
    expect(isLegacyBoardCard("writing-outline", { kind: "stat", shape: "kpi" })).toBe(true);
    expect(isLegacyBoardCard("writing-outline", { kind: "stat", shape: "chapter" })).toBe(true);
  });

  it("关系板：共现边 depType=cooccur；节点卡带 chapterCount", () => {
    expect(isLegacyBoardCard("dependency-edge", { depType: "cooccur", fromName: "甲", toName: "乙" })).toBe(true);
    expect(isLegacyBoardCard("writing-character", { name: "甲", appearances: 12, chapterCount: 4 })).toBe(true);
    expect(isLegacyBoardCard("writing-worldview", { name: "王都", appearances: 3, chapterCount: 2 })).toBe(true);
  });
});

describe("isLegacyBoardCard —— 用户产物必须判 false（判错会删用户内容）", () => {
  it("studioBook.chapterCardConfig 的产出：有 chapterId/fileId，无 shotNo", () => {
    // 形状取自 studioBook.ts::chapterCardConfig
    const cfg = {
      fileId: "wfile_ch1",
      filePath: "writing://book1/ch1.md",
      title: "第 1 章",
      volume: "",
      wordCount: 0,
      chapterStatus: "draft",
      chapterId: "ch1",
    };
    expect(isLegacyBoardCard("writing-chapter", cfg)).toBe(false);
  });

  it("studioBook.settingCardConfig 的产出：有 settingId/appearances，无 chapterCount", () => {
    // 形状取自 studioBook.ts::settingCardConfig（人物）
    expect(
      isLegacyBoardCard("writing-character", { name: "甲", settingId: "s1", appearances: 0 })
    ).toBe(false);
    // 世界观分支会多一个 kind: "worldview" —— 不能被当成「配置里有 kind」
    expect(
      isLegacyBoardCard("writing-worldview", { name: "王都", settingId: "s2", appearances: 0, kind: "worldview" })
    ).toBe(false);
  });

  it("非共现的依赖边（代码场景 structure/deps）判 false", () => {
    expect(isLegacyBoardCard("dependency-edge", { depType: "imports", fromName: "a", toName: "b" })).toBe(false);
    expect(isLegacyBoardCard("dependency-edge", {})).toBe(false);
  });

  it("无 config / 其他类型一律 false", () => {
    expect(isLegacyBoardCard("writing-chapter", undefined)).toBe(false);
    expect(isLegacyBoardCard("writing-studio-pane", { pane: "storyline" })).toBe(false);
    expect(isLegacyBoardCard("writing-docs", { filePath: "writing://book1/" })).toBe(false);
    expect(isLegacyBoardCard("note", { text: "便签" })).toBe(false);
  });
});

describe("hasWritingCanvasCard —— 铺满画布的内容卡判定", () => {
  it("三种铺满卡都算「画布已有内容」", () => {
    // 只判 writing-workbench 是错的：L2 编辑面/正文容器同样是内容卡，
    // 漏判会让空态引导叠在编辑面之上
    for (const type of WRITING_CANVAS_CARD_TYPES) {
      expect(hasWritingCanvasCard([{ type }])).toBe(true);
    }
  });

  it("普通实体/空视图不算，且不因其他卡的存在而误判", () => {
    expect(hasWritingCanvasCard([])).toBe(false);
    expect(hasWritingCanvasCard([{ type: "writing-chapter" }, { type: "dependency-edge" }])).toBe(false);
    expect(hasWritingCanvasCard([{ type: "writing-chapter" }, { type: "writing-studio-pane" }])).toBe(true);
  });
});

describe("isFullCanvasWritingCard —— 框选必须排除的固定容器卡", () => {
  it("正文容器与题材编辑面判 true", () => {
    for (const type of FULL_CANVAS_WRITING_CARDS) {
      expect(isFullCanvasWritingCard(type)).toBe(true);
    }
  });

  it("普通卡片判 false（它们该能被框选/拖动，别误伤）", () => {
    // writing-workbench 是正常尺寸的可拖纸面卡，不在「铺满画布」之列
    for (const type of ["writing-workbench", "writing-chapter", "writing-character", "dependency-edge", "note"]) {
      expect(isFullCanvasWritingCard(type)).toBe(false);
    }
  });

  it("「铺满固定」集合是「画布内容卡」集合的子集（口径不能互相矛盾）", () => {
    for (const type of FULL_CANVAS_WRITING_CARDS) {
      expect(WRITING_CANVAS_CARD_TYPES.has(type)).toBe(true);
    }
  });
});

describe("findFullBleedCard —— 视口贴面渲染的卡", () => {
  it("正文容器 / 题材编辑面都能被选中", () => {
    const docs = { id: "d1", type: "writing-docs" };
    const pane = { id: "p1", type: "writing-studio-pane" };
    expect(findFullBleedCard([{ id: "c1", type: "writing-chapter" }, pane])).toBe(pane);
    expect(findFullBleedCard([docs])).toBe(docs);
  });

  it("普通实体视图返回 null（代码场景 / 只有章节卡的旧视图零副作用）", () => {
    expect(findFullBleedCard([])).toBeNull();
    expect(findFullBleedCard([{ id: "c1", type: "writing-chapter" }, { id: "e1", type: "dependency-edge" }])).toBeNull();
  });

  it("可拖的纸面卡（writing-workbench）不贴面 —— 它是正常尺寸实体，仍要能拖能选", () => {
    expect(findFullBleedCard([{ id: "w1", type: "writing-workbench" }])).toBeNull();
  });
});

describe("duplicateStudioPaneIds —— 重复铺下的编辑面残留", () => {
  const geom = { x: 0, y: 0, width: 1920, height: 1080 };
  const pane = (id: string, p = "storyline", g = geom) => ({
    id,
    type: "writing-studio-pane",
    config: { pane: p },
    transform: { ...g },
  });

  it("同 pane 同几何的重复项只保留第一张（真实事故：reconcile 双触发落了两张）", () => {
    expect(duplicateStudioPaneIds([pane("a"), pane("b")])).toEqual(["b"]);
    expect(duplicateStudioPaneIds([pane("a"), pane("b"), pane("c")])).toEqual(["b", "c"]);
  });

  it("只有一张 → 空（幂等，自愈反复跑不会删掉唯一编辑面）", () => {
    expect(duplicateStudioPaneIds([pane("a")])).toEqual([]);
    expect(duplicateStudioPaneIds([])).toEqual([]);
    expect(duplicateStudioPaneIds([{ id: "c1", type: "writing-chapter" }])).toEqual([]);
  });

  it("几何不一致的编辑面不算重复（用户自己摆到别处的卡绝不误删）", () => {
    expect(duplicateStudioPaneIds([pane("a"), pane("b", "storyline", { ...geom, x: 400 })])).toEqual([]);
    expect(duplicateStudioPaneIds([pane("a"), pane("b", "storyline", { ...geom, width: 900 })])).toEqual([]);
    // 缺 transform 的旧数据也一律判「不是重复」，宁可漏清
    expect(duplicateStudioPaneIds([pane("a"), { id: "b", type: "writing-studio-pane", config: { pane: "storyline" } }])).toEqual([]);
  });

  it("pane 种类不同不算重复（一个视图理论上只有一种编辑面，进了两张也不该互删）", () => {
    expect(duplicateStudioPaneIds([pane("a", "storyline"), pane("b", "characters")])).toEqual([]);
  });
});

// ─── 右键命中面：贴面编辑层必须放行原生菜单 ───────────────────────────────────
//
// 反向不变量（真实缺陷回归锁）：右键**编辑器内部**（正文 TipTap / 大纲输入框）必须
// 判 true —— 判 false 就会弹画布实体菜单，用户看到的是「复制/排列/锁定/隐藏/删除」
// 这堆与写作无关、且 7/9 项点了没反应的项，正文的剪切/复制/粘贴还被一并拦掉。
// 反过来，**画布上的实体卡**必须判 false —— 判 true 会让所有实体卡都失去右键菜单。
describe("isWritingSurfaceTarget", () => {
  /** 造一棵 DOM：<div data-writing-surface><div><input> */
  function makeDom(marked: boolean) {
    const surface = document.createElement("div");
    if (marked) surface.setAttribute(WRITING_SURFACE_ATTR, "1");
    const inner = document.createElement("div");
    const input = document.createElement("input");
    inner.appendChild(input);
    surface.appendChild(inner);
    document.body.appendChild(surface);
    return { surface, inner, input };
  }

  it("编辑面内部的深层元素命中（右键落在 TipTap 正文里也要放行）", () => {
    const { input, inner } = makeDom(true);
    expect(isWritingSurfaceTarget(input)).toBe(true);
    expect(isWritingSurfaceTarget(inner)).toBe(true);
  });

  it("编辑面自身命中", () => {
    const { surface } = makeDom(true);
    expect(isWritingSurfaceTarget(surface)).toBe(true);
  });

  it("画布上的实体卡（无标记）判 false —— 否则所有实体卡都会失去右键菜单", () => {
    const { input } = makeDom(false);
    expect(isWritingSurfaceTarget(input)).toBe(false);
    expect(isWritingSurfaceTarget(document.createElement("div"))).toBe(false);
  });

  it("null / 非元素输入不抛错（React 事件 target 可能不是 Element）", () => {
    expect(isWritingSurfaceTarget(null)).toBe(false);
    expect(isWritingSurfaceTarget(undefined)).toBe(false);
    expect(isWritingSurfaceTarget({} as Element)).toBe(false);
  });

  it("标记名必须与画布实体身份牌区分开（挂成 data-component-id 就会被实体语义接走）", () => {
    expect(WRITING_SURFACE_ATTR).not.toBe("data-component-id");
  });
});

// ─── 右键放行判定：文书编辑区交回原生，画布实体卡照旧 ─────────────────────────
//
// 关键的反向不变量是最后两条：**代码场景与实体卡必须判 false** ——
// 判 true 会让分析器画布上的右键菜单整个消失（功能丢失）。
describe("shouldYieldToNativeContextMenu", () => {
  function el(tag: string, attrs: Record<string, string> = {}, parent?: Element) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    (parent ?? document.body).appendChild(e);
    return e;
  }

  it("贴面编辑层内部 → 放行（书场景与代码场景都放行，标记本身就是书场景专属）", () => {
    const surface = el("div", { [WRITING_SURFACE_ATTR]: "1" });
    const deep = el("span", {}, el("div", {}, surface));
    expect(shouldYieldToNativeContextMenu(deep, true)).toBe(true);
    expect(shouldYieldToNativeContextMenu(surface, true)).toBe(true);
  });

  it("书场景的载体卡内正文（contenteditable / input / textarea）→ 放行", () => {
    const card = el("div", { "data-component-id": "wfile_1" });
    const tiptap = el("div", { contenteditable: "true" }, card);
    const para = el("p", {}, tiptap);
    expect(shouldYieldToNativeContextMenu(para, true)).toBe(true);
    expect(shouldYieldToNativeContextMenu(el("input", {}, card), true)).toBe(true);
    expect(shouldYieldToNativeContextMenu(el("textarea", {}, card), true)).toBe(true);
  });

  it("代码场景的可编辑区 → 不放行（Monaco 的右键链路照旧，零回归）", () => {
    const tiptap = el("div", { contenteditable: "true" });
    const para = el("p", {}, tiptap);
    expect(shouldYieldToNativeContextMenu(para, false)).toBe(false);
    expect(shouldYieldToNativeContextMenu(el("input"), false)).toBe(false);
  });

  it("书场景里右键画布实体卡本身（非可编辑区）→ 不放行，画布菜单照常弹", () => {
    const card = el("div", { "data-component-id": "wfile_1" });
    const label = el("span", {}, card);
    expect(shouldYieldToNativeContextMenu(label, true)).toBe(false);
    expect(shouldYieldToNativeContextMenu(card, true)).toBe(false);
  });

  it("null / 非元素输入不抛错", () => {
    expect(shouldYieldToNativeContextMenu(null, true)).toBe(false);
    expect(shouldYieldToNativeContextMenu(undefined, false)).toBe(false);
    expect(shouldYieldToNativeContextMenu({} as Element, true)).toBe(false);
  });
});
