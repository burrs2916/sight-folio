// 结构树展开/收起回归锁（2026-09-14）
//
// 折叠交互：箭头放**行尾**（用户拍板：不挤头部布局），有子级才出现；
// 收起时整棵子树从 DOM 消失（尖角 SVG 旋转，无后位数——按钮尺寸与 ＋/× 完全一致）；
// 节拍也归尖角管：下面有子级或节拍就出现箭头，收起一起藏。
// 折叠态存 writingStore 内存字段（不落库），载体卡与 L2 题材编辑面共享。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    activeBookId: "b1" as string | null,
    collapsedNodeIds: [] as string[],
    toggleNodeCollapse: vi.fn((id: string) => {
      const i = h.writing.collapsedNodeIds.indexOf(id);
      if (i >= 0) h.writing.collapsedNodeIds.splice(i, 1);
      else h.writing.collapsedNodeIds.push(id);
    }),
    createChapter: vi.fn(async () => null),
    createChildNode: vi.fn(async (_parentId: string, _kind: string, _title: string) => null),
    reparentNode: vi.fn(async () => {}),
    renameNodeKind: vi.fn(async () => {}),
    setChapterStatus: vi.fn(async () => {}),
    renameChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
    createOutline: vi.fn(async () => null),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    createSetting: vi.fn(async () => null),
    updateSetting: vi.fn(async () => {}),
    deleteSetting: vi.fn(async () => {}),
    // StorylineSection（剧情线实体区）新增订阅 + 动作，mock 须一并供给
    storylines: [] as any[],
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
    // beat → 时间线草稿导入：BeatRow 新增订阅 + 创建动作，mock 须一并供给
    timelineEvents: [] as any[],
    createTimelineEvent: vi.fn(async () => null),
  },
  openChapterCarrierView: vi.fn(),
}));

vi.mock("../../../store/writingStore", () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock("../../../utils/studioBook", () => ({
  openChapterCarrierView: h.openChapterCarrierView,
}));

import { StorylinePane } from "../writingPanes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

/** 改完 store 后重渲染（模拟 zustand 触发的组件更新） */
async function rerender(ui: ReactElement) {
  await act(async () => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const chapter = (id: string, title: string, kind: string, parentId: string | null) => ({
  id,
  bookId: "b1",
  title,
  content: "",
  sortOrder: 0,
  wordCount: 0,
  status: "draft",
  volume: "",
  parentId,
  kind,
  createdAt: 0,
  updatedAt: 0,
});

const outline = (id: string, title: string, chapterId: string | null) => ({
  id,
  bookId: "b1",
  title,
  summary: "",
  chapterId,
  extra: "",
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

function rowOf(title: string): HTMLElement | null {
  const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement>("input"));
  const inp = inputs.find((i) => i.value === title);
  return inp ? (inp.parentElement as HTMLElement) : null;
}

function chevronOf(title: string): HTMLElement | null {
  const row = rowOf(title);
  if (!row) return null;
  return (
    row.querySelector<HTMLButtonElement>('button[title="收起子级"], button[title="展开子级"]') ??
    null
  );
}

function treePane() {
  return <StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={h.writing.outlines} settings={[]} />;
}

describe("结构树 · 展开/收起（回归锁）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writing.activeBookId = "b1";
    h.writing.books = [{ id: "b1", title: "长夜", genre: "novel" }];
    h.writing.collapsedNodeIds = [];
    h.writing.chapters = [chapter("v1", "卷 1", "卷", null), chapter("c1", "章 1", "章", "v1")];
    h.writing.outlines = [];
    h.writing.settings = [];
  });

  it("有子级的节点行尾有折叠箭头（默认展开 ⌄），无子级的不出现", () => {
    mount(treePane());
    expect(chevronOf("卷 1"), "卷 1 有子级却没折叠箭头").toBeTruthy();
    expect(chevronOf("卷 1")!.querySelector("svg"), "展开态按钮里应是尖角 SVG").toBeTruthy();
    expect(chevronOf("卷 1")!.textContent!.trim(), "展开态不应带后位数字").toBe("");
    expect(chevronOf("章 1"), "叶子节点不该有折叠箭头").toBeNull();
  });

  it("点箭头 → toggleNodeCollapse 收到本节点 id；收起后子级行从 DOM 消失", async () => {
    mount(treePane());
    const chevron = chevronOf("卷 1")!;
    await act(async () => {
      chevron.click();
    });
    expect(h.writing.toggleNodeCollapse).toHaveBeenCalledWith("v1");
    await rerender(treePane());
    expect(rowOf("章 1"), "收起后子级「章 1」还在 DOM 里").toBeNull();
  });

  it("再点一次 → 重新展开，子级行回来（往复切换不卡死）", async () => {
    mount(treePane());
    await act(async () => {
      chevronOf("卷 1")!.click();
    });
    await rerender(treePane());
    await act(async () => {
      chevronOf("卷 1")!.click();
    });
    await rerender(treePane());
    expect(rowOf("章 1"), "再点一次没把子级展开回来").toBeTruthy();
    expect(chevronOf("卷 1")!.querySelector("svg"), "展开态按钮里应是尖角 SVG").toBeTruthy();
    expect(chevronOf("卷 1")!.textContent!.trim(), "展开态不应带后位数字").toBe("");
  });

  it("收起的是整棵子树：孙级也一并消失（深层不漏渲染）", async () => {
    h.writing.chapters = [
      chapter("v1", "卷 1", "卷", null),
      chapter("c1", "章 1", "章", "v1"),
      chapter("s1", "节 1", "节", "c1"),
    ];
    mount(treePane());
    expect(rowOf("节 1"), "三层结构没渲染出孙级").toBeTruthy();
    await act(async () => {
      chevronOf("卷 1")!.click();
    });
    await rerender(treePane());
    expect(rowOf("章 1")).toBeNull();
    expect(rowOf("节 1"), "收起卷后孙级「节 1」还在 DOM 里").toBeNull();
  });

  it("只有节拍没有子级的节点也有折叠箭头；收起后节拍跟着一起藏", async () => {
    h.writing.chapters = [chapter("v1", "卷 1", "卷", null)]; // 无子级，只挂节拍
    h.writing.outlines = [outline("o1", "卷 1 的节拍", "v1")];
    mount(treePane());
    const beatVisible = () =>
      Array.from(document.body.querySelectorAll<HTMLInputElement>("input")).some((i) => i.value === "卷 1 的节拍");
    expect(chevronOf("卷 1"), "只有节拍也该有折叠箭头").toBeTruthy();
    expect(beatVisible(), "挂好的节拍没渲染出来").toBe(true);
    await act(async () => {
      chevronOf("卷 1")!.click();
    });
    await rerender(treePane());
    expect(beatVisible(), "收起后节拍应该一起藏").toBe(false);
  });
});
