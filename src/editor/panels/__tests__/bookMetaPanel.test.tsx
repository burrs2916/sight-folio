// 书属性卡（封面）回归锁（2026-09-14）
//
// 封面落点：右栏「详情」tab 无选中分支。数据零迁移：assets/writing/covers-{bookId}/
// 有文件=有封面，一书一图（新图落盘成功后清旧图）。
// 这条测试锁死：空态/上传/更换清旧图/清除确认 四条链路。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  writing: {
    books: [
      { id: "b1", title: "长夜", description: "一个关于灯的故事", genre: "novel", medium: "serial", status: "draft", dailyGoal: 0, cover_color: "#4A338F" },
    ] as any[],
    loadBooks: vi.fn(async () => {}),
    renameBook: vi.fn(async () => {}),
    setBookMeta: vi.fn(async () => {}),
    setDailyGoal: vi.fn(async () => {}),
    setBookGoal: vi.fn(async () => {}),
  },
  toast: { showToast: vi.fn() },
  assetApi: {
    list: vi.fn(async () => [] as any[]),
    save: vi.fn(async () => ({ name: "cover-new.png", path: "/assets/writing/covers-b1/2-cover-new.png" })),
    remove: vi.fn(async () => true),
    thumbnail: vi.fn(async () => "data:image/png;base64,thumb"),
  },
  writingApi: { listChapters: vi.fn(async () => [] as any[]) },
  writingStatsApi: { listDailyStats: vi.fn(async () => [] as any[]) },
}));

vi.mock("../../../store/writingStore", () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.toast), {
    getState: () => h.toast,
  }),
}));
vi.mock("../../../services/tauri", async (importOriginal) => {
  // 保留真实 parseBookGoal / isChapterDeleted（纯函数），仅替换数据 IO 三件套
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assetApi: h.assetApi, writingApi: h.writingApi, writingStatsApi: h.writingStatsApi };
});

import { BookMetaPanel } from "../BookMetaPanel";

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

/** mount 后 flush 微任务（封面 list/thumbnail 是异步的，首帧在 loading 态） */
async function flush() {
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assetApi.list.mockResolvedValue([]);
  // jsdom 的 File 可能没有 arrayBuffer，补一个最小实现
  if (!(File.prototype as any).arrayBuffer) {
    (File.prototype as any).arrayBuffer = function () {
      return Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
    };
  }
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
});

function buttonOf(text: string): HTMLButtonElement | null {
  return (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).find(
    (b) => (b.textContent ?? "").includes(text)
  ) ?? null;
}

describe("书属性卡 · 封面管理（回归锁）", () => {
  it("无封面：显示书名/简介 + 占位 + 「设封面」按钮", async () => {
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    // 第十四轮：书名 / 简介升级为就地编辑控件（受控 input/textarea，value 不进 textContent），
    // 封面占位文案仍是普通节点可 textContent 断言。
    const titleInput = document.querySelector('input') as HTMLInputElement | null;
    const descArea = document.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(titleInput?.value).toBe("长夜");
    expect(descArea?.value).toBe("一个关于灯的故事");
    expect(document.body.textContent).toContain("还没有封面");
    expect(buttonOf("设封面")).toBeTruthy();
    expect(buttonOf("清除封面")).toBeNull();
    // 编辑面在位：体裁·载体 / 创作状态 / 日更目标 三段小标题可见
    expect(document.body.textContent).toContain("体裁 · 载体");
    expect(document.body.textContent).toContain("创作状态");
    expect(document.body.textContent).toContain("日更目标");
  });

  it("有封面：缩略图渲染 + 「更换/清除」；清除经确认后 remove 并回到空态", async () => {
    h.assetApi.list.mockResolvedValue([
      { name: "1-old.png", path: "/assets/writing/covers-b1/1-old.png" },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();

    expect(h.assetApi.thumbnail).toHaveBeenCalledWith("/assets/writing/covers-b1/1-old.png", 480);
    expect(document.querySelector("img")).toBeTruthy();
    expect(buttonOf("更换封面")).toBeTruthy();
    expect(buttonOf("清除封面")).toBeTruthy();

    await act(async () => {
      buttonOf("清除封面")!.click();
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(h.assetApi.remove).toHaveBeenCalledWith("/assets/writing/covers-b1/1-old.png");
    expect(buttonOf("设封面"), "清除后回到空态按钮").toBeTruthy();
  });

  it("上传：save 走 covers-{bookId} 分类；替换时旧图被清；成功出 toast", async () => {
    h.assetApi.list.mockResolvedValue([
      { name: "1-old.png", path: "/assets/writing/covers-b1/1-old.png" },
    ]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();

    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(["x"], "new.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(h.assetApi.save).toHaveBeenCalledWith("writing", "covers-b1", "new.png", expect.any(Uint8Array));
    // 一书一封面：新图落盘后旧图被清
    expect(h.assetApi.remove).toHaveBeenCalledWith("/assets/writing/covers-b1/1-old.png");
    expect(h.toast.showToast).toHaveBeenCalledWith("封面已更新", "success");
  });
});

// ─── 全书目标 + 达成进度（第十五轮 · 工作室补齐，服务创作者规划本书）───
function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, val: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fieldByLabel(label: string): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
  return (
    inputs.find((i) => {
      const wrap = i.closest("div");
      const lbl = wrap?.parentElement?.querySelector("label")?.textContent ?? "";
      return lbl.includes(label);
    }) ?? null
  );
}

describe("书属性卡 · 全书目标 + 达成进度（回归锁）", () => {
  it("未设全书目标：三个编辑入口在位 + 未设提示，不画进度条", async () => {
    h.writing.books[0].extra = "";
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    expect(document.body.textContent).toContain("全书目标");
    expect(fieldByLabel("总字数")).toBeTruthy();
    expect(fieldByLabel("章节数")).toBeTruthy();
    expect(document.body.querySelector('input[type="date"]')).toBeTruthy();
    // 未设目标 → 展示未设提示（非进度条）
    expect(document.body.textContent).toContain("还未设定总字数目标");
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("设目标 + 有体量：达成率进度条按本卡 bookId 章节实派生（跨书不错位）", async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 10000, targetChapters: 10, deadline: 0 });
    // 本卡 bookId 直查：5 活跃章 + 1 软删章（应被过滤，不计入分母/章数）
    h.writingApi.listChapters.mockResolvedValue([
      { id: "c1", bookId: "b1", wordCount: 1000 },
      { id: "c2", bookId: "b1", wordCount: 1200 },
      { id: "c3", bookId: "b1", wordCount: 800 },
      { id: "c4", bookId: "b1", wordCount: 1000 },
      { id: "c5", bookId: "b1", wordCount: 1000 },
      { id: "c6", bookId: "b1", wordCount: 99999, extra: JSON.stringify({ deletedAt: 1700000000 }) },
    ]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]); // 无快照 → 退回章实时和（5000）
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const bars = document.querySelectorAll('[role="progressbar"]');
    expect(bars.length).toBe(2); // 字数 + 章节两条
    // 软删章不计入：当前小结应显示 5 章、5000 字（非 6 章 / 104999 字）
    expect(document.body.textContent).toContain("当前 5 章 · 5,000 字");
    // 5000/10000=50%、5/10=50%
    expect(document.body.textContent).toContain("50%");
  });

  it("日快照优先于章实时和（贴近落库口径）", async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 10000, targetChapters: 0, deadline: 0 });
    h.writingApi.listChapters.mockResolvedValue([{ id: "c1", bookId: "b1", wordCount: 100 }]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([
      { day: "2026-10-30", wordCount: 6400 },
      { day: "2026-10-31", wordCount: 8000 },
    ]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    // 用最近快照 8000 而非章和 100 → 80%
    expect(document.body.textContent).toContain("80%");
    expect(document.body.textContent).toContain("当前 1 章 · 8,000 字");
  });

  it("提交总字数：仅改该字段，其余沿用当前目标（无覆盖清零）", async () => {
    const DEADLINE = Math.floor(new Date(2026, 11, 31).getTime() / 1000); // 本地零点，往返一致
    h.writing.books[0].extra = JSON.stringify({ targetWords: 5000, targetChapters: 12, deadline: DEADLINE });
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const wordsInput = fieldByLabel("总字数")!;
    setInputValue(wordsInput, "120000");
    act(() => {
      // React onBlur 经 focusout 冒泡实现，blur 事件不会触发
      wordsInput.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(h.writing.setBookGoal).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ targetWords: 120000, targetChapters: 12, deadline: DEADLINE })
    );
  });

  it("截止日期提交：YYYY-MM-DD → 本地当日零点 Unix 秒（与写作台同一换算）", async () => {
    h.writing.books[0].extra = "";
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    setInputValue(dateInput, "2026-12-31");
    act(() => {
      dateInput.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    const expected = Math.floor(new Date(2026, 11, 31).getTime() / 1000);
    expect(h.writing.setBookGoal).toHaveBeenCalledWith("b1", expect.objectContaining({ deadline: expected }));
  });

  it("未改动提交不落库（脏值回退，不触发 setBookGoal）", async () => {
    h.writing.books[0].extra = JSON.stringify({ targetWords: 5000, targetChapters: 0, deadline: 0 });
    h.writingApi.listChapters.mockResolvedValue([]);
    h.writingStatsApi.listDailyStats.mockResolvedValue([]);
    mount(<BookMetaPanel bookId="b1" />);
    await flush();
    const wordsInput = fieldByLabel("总字数")!;
    setInputValue(wordsInput, "5000"); // 与原值同
    act(() => {
      wordsInput.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    expect(h.writing.setBookGoal).not.toHaveBeenCalled();
  });
});
