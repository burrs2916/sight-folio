// 卷部结构弹窗 · 树口径回归锁（2026-09-14 方案 A；2026-09-21 升级为结构编辑器）
//
// 事故背景：弹窗（ArchitectureLayersPanel 书场景分支）原来读扫描层 metadata.volume 旧字符串
// 分组，与编辑区大纲搭的父/子树（writing_chapters.parent_id）零同步——
// 新书全堆「未分卷」卷章混列；旧书同一卷两份表示；卷节点还被扫成"章行"混进列表。
// 方案 A：直接渲染 buildTree 的层级——容器（部/卷/篇…）为组头，叶章为行。
// 2026-09-21：从只读查看器升级为结构编辑器，复用大纲树同一套 store CRUD；
// 叶章双击 = 开写作台（openWritingDesk），不再误拉代码工作台（navigateToSource→spawnCodeWorkbench）。
//
// 这条测试锁死：① 卷节点是组头、不再当章行（且全树不再用代码项目那套 ListItemButton）；
// ② 章行双击开写作台且带正确 chapterId；③ 组头带「{chapters} 章 · {words} 字 · 完稿 {finished}」进度账；
// ④ 空书给明示空态 + 新建入口。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  writing: {
    chapters: [] as any[],
    books: [] as any[],
    activeBookId: "b1" as string | null,
    loadChapters: vi.fn(async () => {}),
    createChapter: vi.fn(async () => ({ id: "new", title: "新卷 1" })),
    collapsedNodeIds: [] as string[],
    toggleNodeCollapse: vi.fn(),
  },
  openWritingDesk: vi.fn(async () => {}),
}));

vi.mock("../../../store/writingStore", () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock("../../../utils/writingDeskWindow", () => ({
  openWritingDesk: h.openWritingDesk,
}));

import { BookVolumeView } from "../ArchitectureLayersPanel";

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

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.activeBookId = "b1";
  h.writing.chapters = [];
  h.writing.books = [];
});

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

/** 找文本恰好等于 text 的最内层元素 */
function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll("*")) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}

describe("卷部结构弹窗 · 按父/子树渲染（回归锁）", () => {
  it("卷节点是组头；章行双击开写作台且带正确 chapterId；组头带进度账", async () => {
    h.writing.chapters = [
      chapter("v1", "卷 1", "卷", null),
      chapter("c1", "章 1", "章", "v1"),
      chapter("c2", "章 2", "章", "v1"),
      chapter("c3", "章 3", "章", null), // 根级章：不在任何卷下，照样显示
    ];
    mount(<BookVolumeView analysisId="wscan_b1" />);

    // 卷 1 是组头，不是章行（旧版会把卷节点扫成章行混进列表）
    const volEl = textEl("卷 1");
    expect(volEl, "卷 1 应渲染为组头").toBeTruthy();
    expect(volEl!.closest('[class*="MuiListItemButton-root"]'), "卷节点不得当章行").toBeNull();
    // 全树不再用代码项目那套 ListItemButton 章行
    expect(document.querySelector('[class*="MuiListItemButton-root"]'), "卷部结构不应再用 ListItemButton").toBeNull();

    // 三个章行都在
    for (const t of ["章 1", "章 2", "章 3"]) {
      expect(textEl(t), `${t} 应渲染`).toBeTruthy();
    }

    // 组头进度账：卷 1 下两章、0 字、完稿 0
    expect(textEl("2 章 · 0 字 · 完稿 0"), "组头应有进度账").toBeTruthy();

    // 双击章行 → 开写作台（不再误拉代码工作台）
    const titleEl = textEl("章 1")!;
    await act(async () => {
      titleEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(h.openWritingDesk).toHaveBeenCalledWith({ bookId: "b1", chapterId: "c1" });
  });

  it("空书给明示空态 + 新建入口", () => {
    h.writing.chapters = [];
    mount(<BookVolumeView analysisId="wscan_b1" />);
    expect(textEl("这本书还没有任何章节"), "空态文案应可见").toBeTruthy();
    // 空态应带「添加」入口
    const addBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("添加")
    );
    expect(addBtn, "空态应有添加入口").toBeTruthy();
  });
});
