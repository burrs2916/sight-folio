import { describe, it, expect, vi, beforeEach } from "vitest";

// W-2：buildContextBlock 的书名注入须带上当前书的内部 id，
// 让 read_chapter / list_chapters / write_chapter 等工具走 resolve_book_ref 的 id 优先分支，
// 同名 / 改名的书不再靠标题模糊命中而打错书。
const { getState } = vi.hoisted(() => ({ getState: vi.fn() }));
vi.mock("../../../store/writingStore", () => ({
  useWritingStore: { getState },
}));

import { buildContextBlock, resolveBookId } from "../workbenchContext";
import type { WorkbenchContext } from "../workbenchContext";

const base = (partial: Partial<WorkbenchContext>): WorkbenchContext => ({
  activeFile: null,
  selection: null,
  mode: "ask",
  facts: null,
  attachments: [],
  ...partial,
});

beforeEach(() => {
  getState.mockReset();
});

describe("resolveBookId（W-2）", () => {
  it("先按书名精确认书，返回其 id", () => {
    getState.mockReturnValue({
      books: [{ id: "book_1", title: "长夜" }, { id: "book_2", title: "长夜难明" }],
      activeBookId: "book_2",
    });
    expect(resolveBookId({ bookTitle: "长夜" })).toBe("book_1");
  });

  it("同名书名精确匹配优先于激活书（避免打错同名书）", () => {
    getState.mockReturnValue({
      books: [{ id: "book_1", title: "长夜" }, { id: "book_2", title: "长夜" }],
      activeBookId: null,
    });
    // find 取首个匹配；书名相同则退回首条，仍是有 id 的真实书而非靠模糊命中
    expect(resolveBookId({ bookTitle: "长夜" })).toBe("book_1");
  });

  it("认不到书名时退回激活书 id", () => {
    getState.mockReturnValue({
      books: [{ id: "book_2", title: "长夜难明" }],
      activeBookId: "book_2",
    });
    expect(resolveBookId({ bookTitle: "不存在的书" })).toBe("book_2");
  });

  it("无任何可解析来源时返回 null（不注脏值）", () => {
    getState.mockReturnValue({ books: [], activeBookId: null });
    expect(resolveBookId({ bookTitle: "无" })).toBeNull();
  });
});

describe("buildContextBlock 创作上下文带 book id（W-2）", () => {
  it("书场景能解析到 id：注入块同时含书名与 (id=…)", () => {
    getState.mockReturnValue({
      books: [{ id: "book_9", title: "长夜" }],
      activeBookId: "book_9",
    });
    const out = buildContextBlock(base({ bookTitle: "长夜", bookTopic: "worldview" }), true);
    expect(out).toContain("长夜");
    expect(out).toContain("(id=book_9)");
  });

  it("解析不到 id：退回仅书名，不出现 (id=", () => {
    getState.mockReturnValue({ books: [], activeBookId: null });
    const out = buildContextBlock(base({ bookTitle: "孤本", bookTopic: "worldview" }), true);
    expect(out).toContain("孤本");
    expect(out).not.toContain("(id=");
  });
});
