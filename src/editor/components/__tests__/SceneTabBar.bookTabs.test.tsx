// L1 = 作品（书）页签的回归锁（2026-09-12 用户拍板语义）
//
// 这一层最容易悄悄坏掉的地方：
//   ① L1 退回「题材分组」—— 题材只有固定四项（小说/散文/诗歌/剧本），
//      于是「再拖一次小说」永远表现为复用，用户看不到新 L1（这正是改动的起因）；
//   ② 点击当前作品的页签又触发一次建书/重扫（有感的卡顿 + 无意义 IO）；
//   ③ 只剩一本作品时同样给出删除入口 —— 2026-09-19 拍板推翻旧约定（旧约定：
//      只留一本不给删防 activeSceneId 悬空；新约定：任何作品都可删，删到 0 本
//      落工作室「新建/导入」起步态，SceneEditorPage !activeScene 早退承接）。
//
// 渲染方式：本仓库的组件测试约定是 react-dom（见 previewRepro.test.tsx 的 renderToString），
// @testing-library/react 虽在 devDeps 里但它的 peer（@testing-library/dom）从未安装过、
// 也从没有测试用过 —— 为了写测试去动 lockfile 不划算，这里用 react-dom/client + react 的 act
// 自建一个最小渲染器（需要真实交互，renderToString 拿不到事件处理器）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  editor: {
    views: [] as any[],
    activeViewId: "v1",
    previewMode: false,
    switchView: vi.fn(),
    addView: vi.fn(),
    removeView: vi.fn(),
    renameView: vi.fn(),
  },
  scene: { scenes: [] as any[], activeSceneId: "wscan_b1" },
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    booksLoading: false,
    activeBookId: "b1" as string | null,
    loadBooks: vi.fn(async () => {}),
    renameBook: vi.fn(async () => {}),
    deleteBook: vi.fn(async () => {}),
  },
  toast: { showToast: vi.fn() },
  loggerWarn: vi.fn(),
  openBookInStudio: vi.fn(async () => ({})),
  createBookAutoNamed: vi.fn(async () => ({ id: "b9", title: "新建作品 9" })),
  deleteBookWithScene: vi.fn(async () => {}),
  openTypedCarrierView: vi.fn(),
  reconcileStudioPaneView: vi.fn(),
}));

vi.mock("../../../store/editorStore", () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.editor), {
    getState: () => h.editor,
  }),
}));
vi.mock("../../../store/sceneStore", () => ({
  useSceneStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.scene), {
    getState: () => h.scene,
  }),
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
// 幽灵场景要留痕（logger.warn），所以这里得能观测到它 —— 顺带把日志噪音挡掉
vi.mock("../../../utils/logger", () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() };
  return { logger, default: logger };
});
// 画像器在本文件里走不到（useActiveAnalyzer 返回 null → templates 为空），一并挡掉免拉重型依赖
vi.mock("../../../editor/analyzer", () => ({
  analyzerRegistry: { getViewTemplates: () => [] },
  useActiveAnalyzer: () => null,
}));
vi.mock("../../utils/portraits", () => ({
  portraitForTemplate: vi.fn(),
  runPortrait: vi.fn(),
}));
vi.mock("../../../utils/studioBook", () => ({
  openBookInStudio: h.openBookInStudio,
  createBookAutoNamed: h.createBookAutoNamed,
  deleteBookWithScene: h.deleteBookWithScene,
  openTypedCarrierView: h.openTypedCarrierView,
  reconcileStudioPaneView: h.reconcileStudioPaneView,
  // 与实现同源的纯解析（这一层的语义由 studioBook 自己的测试覆盖）
  parseBookIdFromRoot: (root?: string | null) =>
    root && root.startsWith("writing://") ? root.replace(/^writing:\/\//, "").replace(/\/+$/, "") : "",
}));

import { SceneTabBar } from "../SceneTabBar";
// 方案 A 后 SceneTabBar 用 useNavigate（L1 书页签直达写作台），测试挂载必须包 Router 上下文
import { MemoryRouter } from "react-router-dom";

// ─── 最小渲染器（react-dom/client + act）────────────────────────────────────
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
}

/** 卸载当前树并清掉 body（Dialog/Menu 走 portal 落在 body 上，必须一起清） */
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = "";
}

/** 点击：真实 dispatch 一个 click（React 18 在容器上做事件委托，能收到） */
async function click(el: Element | null | undefined) {
  expect(el, "要点击的元素不存在").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** 纯文本叶子节点（书名 span、DialogTitle 之类都是叶子，避免匹配到整块容器） */
function byText(text: string): HTMLElement | null {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
  return all.find((el) => el.children.length === 0 && (el.textContent ?? "").trim() === text) ?? null;
}

function byAttr(attr: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[${attr}]`);
}

function buttonByText(text: string): HTMLElement | null {
  const btns = Array.from(document.body.querySelectorAll<HTMLElement>("button"));
  return btns.find((b) => (b.textContent ?? "").trim() === text) ?? null;
}

function menuItemByText(text: string): HTMLElement | null {
  const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  return items.find((el) => (el.textContent ?? "").includes(text)) ?? null;
}

// MUI 在 Tabs 的 value 失配时**不会**把任何页签标成选中，只在 console.error 里吼一声
// 「The `value` provided to the Tabs component is invalid」。
// 所以只能抓这条警告 —— 数 aria-selected 是区分不出来的（实测：回退修复后测试照样绿）。
let errSpy: ReturnType<typeof vi.spyOn>;
function tabsValueWarnings(): number {
  return errSpy.mock.calls.filter((c) =>
    String(c[0] ?? "").includes("provided to the Tabs component is invalid")
  ).length;
}

const book = (id: string, title: string, genre: string) => ({
  id,
  title,
  genre,
  medium: "",
  status: "draft",
  coverColor: "#4A338F",
  dailyGoal: 0,
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  // MUI 的 value 失配警告走 console.error —— 挡住噪音并留下可断言的痕迹
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  h.editor.views = [{ id: "v1", name: "大纲", kind: "catalog", carrierType: "novel", components: [] }];
  h.editor.activeViewId = "v1";
  h.scene.scenes = [
    { id: "wscan_b1", projectRoot: "writing://b1/", primaryLanguage: "novel-zh", name: "长夜" },
  ];
  h.scene.activeSceneId = "wscan_b1";
  h.writing.books = [book("b1", "长夜", "novel"), book("b2", "碎句集", "essay")];
  h.writing.activeBookId = "b1";
  h.writing.chapters = [{ id: "c1" }];
  h.writing.booksLoading = false;
});

afterEach(() => {
  unmount();
  errSpy.mockRestore();
});

describe("SceneTabBar · L1 = 作品页签", () => {
  it("L1 渲染的是**书名**，不是题材名（退回题材分组就是这次的原始故障）", () => {
    mount(<SceneTabBar />);
    expect(byText("长夜"), "书 b1 的页签没渲染书名").toBeTruthy();
    expect(byText("碎句集"), "书 b2 的页签没渲染书名").toBeTruthy();
    // 顶部 L1 条上不该出现题材名（题材只在「＋」菜单里出现）
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(byText("散文")).toBeNull();
  });

  it("书架为空时补一次懒加载（应用重启直接进工作室的场景）", () => {
    h.writing.books = [];
    mount(<SceneTabBar />);
    expect(h.writing.loadBooks).toHaveBeenCalledTimes(1);
  });

  it("点另一个作品的页签 → 切到那本书的支撑场景", async () => {
    mount(<SceneTabBar />);
    await click(byText("碎句集"));
    expect(h.openBookInStudio).toHaveBeenCalledTimes(1);
    expect(h.openBookInStudio).toHaveBeenCalledWith("b2", "碎句集");
  });

  it("点当前作品的页签 → 不重扫（避免切换变成有感的卡顿）", async () => {
    mount(<SceneTabBar />);
    await click(byText("长夜"));
    expect(h.openBookInStudio).not.toHaveBeenCalled();
  });

  it("多本作品：每个页签都有删除入口（删除后确认 = 放弃这本书）", () => {
    mount(<SceneTabBar />);
    expect(byAttr('data-book-delete="b1"'), "b1 页签缺删除入口").toBeTruthy();
    expect(byAttr('data-book-delete="b2"'), "b2 页签缺删除入口").toBeTruthy();
  });

  it("只剩一本作品：同样给出删除入口（2026-09-19 拍板：任何作品都可删）", () => {
    h.writing.books = [book("b1", "长夜", "novel")];
    mount(<SceneTabBar />);
    expect(byAttr('data-book-delete="b1"'), "唯一作品的页签也应有删除入口").toBeTruthy();
    expect(byText("长夜")).toBeTruthy();
  });

  it("点删除 → 弹「删除作品」确认框，且**确认前不落库**（放弃是不可恢复的）", async () => {
    mount(<SceneTabBar />);
    await click(byAttr('data-book-delete="b2"'));
    expect(byText("删除作品"), "没弹出「删除作品」确认框").toBeTruthy();
    expect(h.deleteBookWithScene).not.toHaveBeenCalled();
  });

  it("确认删除 → 走 deleteBookWithScene（书 + 支撑场景一起清）", async () => {
    mount(<SceneTabBar />);
    await click(byAttr('data-book-delete="b2"'));
    await click(buttonByText("删除"));
    expect(h.deleteBookWithScene).toHaveBeenCalledTimes(1);
    expect(h.deleteBookWithScene).toHaveBeenCalledWith("b2");
  });

  it("「＋」选题材 → 新建一本该题材的作品（不是新建题材组）", async () => {
    mount(<SceneTabBar />);
    const add = document.body.querySelector('[data-testid="AddIcon"]');
    expect(add, "没找到「＋」按钮").toBeTruthy();
    await click(add!.closest("button"));
    const essay = menuItemByText("散文");
    expect(essay, "「＋」菜单里没有散文").toBeTruthy();
    await click(essay);
    expect(h.createBookAutoNamed).toHaveBeenCalledWith("essay");
    // 新建的是「书」，不是「题材组里的视图」
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
  });

  it("双击书名 → 进入改名；确认后 renameBook 落库（书名 = L1 页签名）", async () => {
    mount(<SceneTabBar />);
    const label = byText("碎句集")!;
    await act(async () => {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const input = document.body.querySelector<HTMLInputElement>("input");
    expect(input, "双击没进改名态").toBeTruthy();
    expect(input!.value).toBe("碎句集");
  });

  // MUI 会在 Tabs 的 value 命中不了任何子 Tab 时整个组件报警告、指示条乱跑。
  // currentBookId 来自活动场景 projectRoot，books 来自书库，两者天然可能不同步：
  // 启动竞态（books 还没拉到）与幽灵场景（活动场景指向的书已被删）都会命中。
  it("活动场景指向的书不在书库里（幽灵场景）→ 不把非法值喂给 Tabs", () => {
    // 活动场景属于 b9，但书库里只有 b1 / b2
    h.scene.scenes = [
      { id: "wscan_b9", projectRoot: "writing://b9/", primaryLanguage: "novel-zh", name: "幽灵" },
    ];
    h.scene.activeSceneId = "wscan_b9";
    h.editor.views = [
      { id: "v1", name: "大纲", kind: "catalog", carrierType: "novel", components: [] },
    ];
    mount(<SceneTabBar />);
    // 两个页签照常渲染出来（导航不因高亮缺失而消失）
    expect(byText("长夜")).toBeTruthy();
    expect(byText("碎句集")).toBeTruthy();
    // 关键：不许把 b9 喂给 MUI（喂了就会吼「value ... is invalid」，页签栏指示条乱跑）
    expect(tabsValueWarnings(), "把不存在的 book id 喂给了 Tabs").toBe(0);
    // 且必须留痕（绝不静默），日志里能看出是哪个场景指向了哪本不存在的书
    expect(h.loggerWarn).toHaveBeenCalledTimes(1);
    expect(h.loggerWarn.mock.calls[0][2]).toMatchObject({ currentBookId: "b9" });
  });

  // 守的是**另一条**不变量（不是上面的 MUI value）：首帧 activeBookId 还没被 setActiveBook
  // 写进去，高亮只能从**活动场景**推。若有人把 value 改回「只读 activeBookId」，这条会红。
  it("启动竞态：书架为空 → 拉到书架后按**场景**高亮当前作品（activeBookId 未写入也不能丢高亮）", async () => {
    h.writing.books = [];
    h.writing.booksLoading = false;
    h.writing.activeBookId = null; // 首帧：还没 setActiveBook
    mount(<SceneTabBar />);
    expect(tabsValueWarnings()).toBe(0);
    expect(h.writing.loadBooks).toHaveBeenCalledTimes(1); // 空书架要补一次懒加载
    await act(async () => {
      h.writing.books = [book("b1", "长夜", "novel"), book("b2", "碎句集", "essay")];
      root!.render(<MemoryRouter><SceneTabBar /></MemoryRouter>);
    });
    const l1 = document.body.querySelectorAll('[role="tablist"]')[0];
    const selected = l1?.querySelector('[aria-selected="true"]');
    expect(selected?.textContent, "书架到位后没按活动场景高亮当前作品").toContain("长夜");
    expect(tabsValueWarnings()).toBe(0);
    // 加载完成后书架非空，不该再报幽灵场景
    expect(h.loggerWarn).not.toHaveBeenCalled();
  });

  // L2 那条 Tabs 与 L1 同一个约束。两个真实失配来源都不是「数据坏了」，
  // 而是「清场 effect 要等一帧」——首帧就会往控制台刷警告。
  it("L2：遗留视图的 kind 不在固定 11 项里（如旧的过渡 kind）→ 不产生非法 Tabs value", () => {
    h.editor.views = [
      { id: "v1", name: "全局", kind: "legacyGlobal", carrierType: "novel", components: [] },
    ];
    h.editor.activeViewId = "v1";
    mount(<SceneTabBar />);
    expect(tabsValueWarnings(), "遗留 kind 被当成了 L2 的 value").toBe(0);
  });

  it("L2：激活的是被剥掉的空壳 default → 不产生非法 Tabs value", () => {
    h.editor.views = [
      { id: "default", name: "目录树", carrierType: "novel", components: [] },
      { id: "v1", name: "大纲", kind: "catalog", carrierType: "novel", components: [] },
    ];
    h.editor.activeViewId = "default";
    mount(<SceneTabBar />);
    expect(tabsValueWarnings(), "空壳 default 被当成了 L2 的 value").toBe(0);
  });

  // 2026-09-21 实测回归：书场景停用自动铺全书总览板后，新书场景只剩 default
  // 结构壳（目录树，无 carrierType）这一只视图 —— 清场回收必须带 allowEmpty，
  // 否则被「仅剩一只不可删」保护挡住，「目录树」页签残留（书场景根本没有目录树）。
  it("L2：书场景只剩 default 结构壳 → 也被回收（allowEmpty 删到 0 只）", async () => {
    h.editor.views = [{ id: "default", name: "目录树", components: [] }];
    h.editor.activeViewId = "default";
    mount(<SceneTabBar />);
    await act(async () => {});
    expect(h.editor.removeView).toHaveBeenCalledWith("default", { allowEmpty: true });
  });
});
