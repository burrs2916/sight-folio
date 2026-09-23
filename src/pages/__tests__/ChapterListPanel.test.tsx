// 写作台章列表 ChapterListPanel · 回归锁（2026-09-21 路线 B P1 收尾）
//
// 背景：章列表从 WritingPage 2997 行巨组件里抽离为 React.memo 子组件。
// WritingPage 每 800ms 自动保存翻转顶层 saveState 触发整树重渲染；抽离后只要 props
// 全为稳定引用（openDialog=useCallback / store 选择器 / useState setter / useMemo），
// memo 浅比较命中即可跳过整段列表重渲染。
//
// 这条测试锁死四件事：
// ① 导出物必须是 memo 包裹（防止后人顺手把 memo 摘掉，隔离就地失效）；
// ② 章行渲染 + 卷分组头渲染（含 O(1) 下标号）；
// ③ 普通模式点行 = setActiveChapter 切章（清设定选中）；批量模式点行 = 切换选中 updater；
//    行尾动作（移卷/改名/删除）走 openDialog 且 stopPropagation 不误触切章；
// ④ 搜索无命中 → 空态、零行渲染。
// 组件是纯 props 驱动（不碰 writingStore / Tauri），本测试零 mock。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

import { ChapterListPanel } from "../ChapterListPanel";
import type { ChapterListPanelProps } from "../ChapterListPanel";

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
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

const chapter = (id: string, title: string, volume = "", wordCount = 0) => ({
  id,
  bookId: "b1",
  title,
  content: "",
  sortOrder: 0,
  wordCount,
  status: "draft",
  volume,
  kind: "章",
  extra: "",
  createdAt: 0,
  updatedAt: 0,
});

function baseProps(over: Partial<ChapterListPanelProps> = {}): ChapterListPanelProps {
  return {
    visibleChapters: [],
    chapterIndexById: new Map(),
    activeChapterId: null,
    chapterQuery: "",
    chapterSearchQuery: "",
    selectionMode: false,
    selectedChapterIds: [],
    setSelectedChapterIds: vi.fn(),
    setActiveSetting: vi.fn(),
    setActiveChapter: vi.fn(),
    dragChapterIdRef: { current: null },
    flushSave: vi.fn(async () => {}),
    setDropIndex: vi.fn(),
    reorderChapter: vi.fn(async () => {}),
    dropIndex: null,
    openDialog: vi.fn(),
    outlines: [],
    ...over,
  };
}

/** 找文本恰好等于 text 的最内层元素 */
function textEl(text: string): HTMLElement | null {
  const els = Array.from(document.body.querySelectorAll("*")) as HTMLElement[];
  return els.find((e) => e.textContent === text && e.children.length === 0) ?? null;
}

function row(id: string): HTMLElement {
  const el = document.querySelector(`[data-testid="chapter-row-${id}"]`);
  expect(el, `章行 ${id} 应渲染`).toBeTruthy();
  return el as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("写作台章列表 ChapterListPanel（React.memo 抽离 · 回归锁）", () => {
  it("导出物必须是 memo 包裹（抽离的意义所在，防退化）", () => {
    expect((ChapterListPanel as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  it("渲染全部章行 + 卷分组头", () => {
    mount(
      <ChapterListPanel
        {...baseProps({
          visibleChapters: [
            chapter("c1", "章 一", "卷一"),
            chapter("c2", "章 二", "卷一", 1200),
            chapter("c3", "章 三", ""),
          ],
          chapterIndexById: new Map([
            ["c1", 0],
            ["c2", 1],
            ["c3", 2],
          ]),
          outlines: [
            { id: "o1", title: "节拍 一", chapterId: "c2" },
          ] as unknown as ChapterListPanelProps["outlines"],
        })}
      />,
    );

    // 三行都在
    for (const id of ["c1", "c2", "c3"]) row(id);
    // 卷分组头：首行前出「卷一」组头（anyNamedVolume 命中 + 卷名变化）
    expect(textEl("卷一"), "卷分组头应渲染").toBeTruthy();
  });

  it("普通模式点行 = 切章并清设定选中", async () => {
    const props = baseProps({
      visibleChapters: [chapter("c1", "章 一"), chapter("c2", "章 二")],
      chapterIndexById: new Map([
        ["c1", 0],
        ["c2", 1],
      ]),
    });
    mount(<ChapterListPanel {...props} />);
    await click(row("c2"));
    expect(props.setActiveChapter).toHaveBeenCalledWith("c2");
    expect(props.setActiveSetting).toHaveBeenCalledWith(null);
    expect(props.openDialog).not.toHaveBeenCalled();
  });

  it("批量模式：点行 = 切换选中 updater（不切章）", async () => {
    const setSelectedChapterIds = vi.fn();
    const props = baseProps({
      selectionMode: true,
      selectedChapterIds: [],
      setSelectedChapterIds,
      visibleChapters: [chapter("c1", "章 一"), chapter("c2", "章 二")],
      chapterIndexById: new Map([
        ["c1", 0],
        ["c2", 1],
      ]),
    });
    mount(<ChapterListPanel {...props} />);
    await click(row("c1"));

    expect(props.setActiveChapter).not.toHaveBeenCalled();
    expect(setSelectedChapterIds).toHaveBeenCalledTimes(1);
    const updater = setSelectedChapterIds.mock.calls[0][0] as (ids: string[]) => string[];
    expect(updater([])).toEqual(["c1"]);
    expect(updater(["c1"])).toEqual([]);
  });

  it("章行行尾动作：移动卷 / 改名 / 删除走 openDialog 且 stopPropagation 不误触切章", async () => {
    const props = baseProps({
      visibleChapters: [chapter("c1", "章 一", "卷一")],
      chapterIndexById: new Map([["c1", 0]]),
    });
    mount(<ChapterListPanel {...props} />);

    // 行尾动作按钮默认 opacity:0，但仍在 DOM 里、可点击
    const rowEl = row("c1");
    const btns = Array.from(rowEl.querySelectorAll("button"));
    expect(btns.length).toBe(3);
    await click(btns[0]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: "move-volume", chapterId: "c1" }, "卷一");
    await click(btns[1]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: "rename-chapter", chapterId: "c1" }, "章 一");
    await click(btns[2]);
    expect(props.openDialog).toHaveBeenCalledWith({ kind: "delete-chapter", chapterId: "c1" });
    // 行尾按钮 stopPropagation：不应触发切章
    expect(props.setActiveChapter).not.toHaveBeenCalled();
  });

  it("搜索无命中 → 空态、零行渲染", () => {
    mount(
      <ChapterListPanel
        {...baseProps({ chapterQuery: "不存在的章", chapterSearchQuery: "不存在的章" })}
      />,
    );
    expect(document.querySelector('[data-testid^="chapter-row-"]')).toBeNull();
    // 空态文案渲染（searchNoMatch），非整块消失
    expect((document.body.textContent ?? "").length).toBeGreaterThan(0);
  });
});
