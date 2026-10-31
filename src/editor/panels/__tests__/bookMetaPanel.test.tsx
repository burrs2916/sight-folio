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
  },
  toast: { showToast: vi.fn() },
  assetApi: {
    list: vi.fn(async () => [] as any[]),
    save: vi.fn(async () => ({ name: "cover-new.png", path: "/assets/writing/covers-b1/2-cover-new.png" })),
    remove: vi.fn(async () => true),
    thumbnail: vi.fn(async () => "data:image/png;base64,thumb"),
  },
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
vi.mock("../../../services/tauri", () => ({
  assetApi: h.assetApi,
}));

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
