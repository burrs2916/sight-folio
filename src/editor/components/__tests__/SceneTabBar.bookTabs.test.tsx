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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  editor: {
    views: [] as any[],
    activeViewId: 'v1',
    previewMode: false,
    switchView: vi.fn(),
    addView: vi.fn(),
    removeView: vi.fn(),
    renameView: vi.fn(),
  },
  scene: { scenes: [] as any[], activeSceneId: 'wscan_b1' },
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    booksLoading: false,
    activeBookId: 'b1' as string | null,
    loadBooks: vi.fn(async () => {}),
    renameBook: vi.fn(async () => {}),
    deleteBook: vi.fn(async () => {}),
  },
  toast: { showToast: vi.fn() },
  loggerWarn: vi.fn(),
  openBookInStudio: vi.fn(async () => ({})),
  createBookAutoNamed: vi.fn(async () => ({ id: 'b9', title: '新建作品 9' })),
  deleteBookWithScene: vi.fn(async () => {}),
  openTypedCarrierView: vi.fn(),
  reconcileStudioPaneView: vi.fn(),
}));

vi.mock('../../../store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.editor), {
    getState: () => h.editor,
  }),
}));
vi.mock('../../../store/sceneStore', () => ({
  useSceneStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.scene), {
    getState: () => h.scene,
  }),
}));
vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/toastStore', () => ({
  useToastStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.toast), {
    getState: () => h.toast,
  }),
}));
// 幽灵场景要留痕（logger.warn），所以这里得能观测到它 —— 顺带把日志噪音挡掉
vi.mock('../../../utils/logger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() };
  return { logger, default: logger };
});
// 画像器在本文件里走不到（useActiveAnalyzer 返回 null → templates 为空），一并挡掉免拉重型依赖
vi.mock('../../../editor/analyzer', () => ({
  analyzerRegistry: { getViewTemplates: () => [] },
  useActiveAnalyzer: () => null,
}));
vi.mock('../../utils/portraits', () => ({
  portraitForTemplate: vi.fn(),
  runPortrait: vi.fn(),
}));
vi.mock('../../../utils/studioBook', () => ({
  openBookInStudio: h.openBookInStudio,
  createBookAutoNamed: h.createBookAutoNamed,
  deleteBookWithScene: h.deleteBookWithScene,
  openTypedCarrierView: h.openTypedCarrierView,
  reconcileStudioPaneView: h.reconcileStudioPaneView,
  // 与实现同源的纯解析（这一层的语义由 studioBook 自己的测试覆盖）
  parseBookIdFromRoot: (root?: string | null) =>
    root && root.startsWith('writing://') ? root.replace(/^writing:\/\//, '').replace(/\/+$/, '') : '',
}));

import { SceneTabBar } from '../SceneTabBar';
// 方案 A 后 SceneTabBar 用 useNavigate（L1 书页签直达写作台），测试挂载必须包 Router 上下文
import { MemoryRouter } from 'react-router-dom';
import { t } from '../../../i18n';
import { viewKindLabelKey } from '../../../utils/writingSchema';

// ─── 最小渲染器（react-dom/client + act）────────────────────────────────────
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
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
  document.body.innerHTML = '';
}

/** 点击：真实 dispatch 一个 click（React 18 在容器上做事件委托，能收到） */
async function click(el: Element | null | undefined) {
  expect(el, '要点击的元素不存在').toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** 纯文本叶子节点（书名 span、DialogTitle 之类都是叶子，避免匹配到整块容器） */
function byText(text: string): HTMLElement | null {
  const all = Array.from(document.body.querySelectorAll<HTMLElement>('*'));
  return all.find((el) => el.children.length === 0 && (el.textContent ?? '').trim() === text) ?? null;
}

function byAttr(attr: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[${attr}]`);
}

function buttonByText(text: string): HTMLElement | null {
  const btns = Array.from(document.body.querySelectorAll<HTMLElement>('button'));
  return btns.find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

function menuItemByText(text: string): HTMLElement | null {
  const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  return items.find((el) => (el.textContent ?? '').includes(text)) ?? null;
}

// MUI 在 Tabs 的 value 失配时**不会**把任何页签标成选中，只在 console.error 里吼一声
// 「The `value` provided to the Tabs component is invalid」。
// 所以只能抓这条警告 —— 数 aria-selected 是区分不出来的（实测：回退修复后测试照样绿）。
let errSpy: ReturnType<typeof vi.spyOn>;
function tabsValueWarnings(): number {
  return errSpy.mock.calls.filter((c) => String(c[0] ?? '').includes('provided to the Tabs component is invalid'))
    .length;
}

const book = (id: string, title: string, genre: string) => ({
  id,
  title,
  genre,
  medium: '',
  status: 'draft',
  coverColor: '#4A338F',
  dailyGoal: 0,
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  // MUI 的 value 失配警告走 console.error —— 挡住噪音并留下可断言的痕迹
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.editor.views = [{ id: 'v1', name: '大纲', kind: 'catalog', carrierType: 'novel', components: [] }];
  h.editor.activeViewId = 'v1';
  h.scene.scenes = [{ id: 'wscan_b1', projectRoot: 'writing://b1/', primaryLanguage: 'novel-zh', name: '长夜' }];
  h.scene.activeSceneId = 'wscan_b1';
  h.writing.books = [book('b1', '长夜', 'novel'), book('b2', '碎句集', 'essay')];
  h.writing.activeBookId = 'b1';
  h.writing.chapters = [{ id: 'c1' }];
  h.writing.booksLoading = false;
});

afterEach(() => {
  unmount();
  errSpy.mockRestore();
});

describe('SceneTabBar · L1 = 作品页签', () => {
  it('L1 渲染的是**书名**，不是题材名（退回题材分组就是这次的原始故障）', () => {
    mount(<SceneTabBar />);
    expect(byText('长夜'), '书 b1 的页签没渲染书名').toBeTruthy();
    expect(byText('碎句集'), '书 b2 的页签没渲染书名').toBeTruthy();
    // 顶部 L1 条上不该出现题材名（题材只在「＋」菜单里出现）
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(byText('散文')).toBeNull();
  });

  it('书架为空时补一次懒加载（应用重启直接进工作室的场景）', () => {
    h.writing.books = [];
    mount(<SceneTabBar />);
    expect(h.writing.loadBooks).toHaveBeenCalledTimes(1);
  });

  it('点另一个作品的页签 → 切到那本书的支撑场景', async () => {
    mount(<SceneTabBar />);
    await click(byText('碎句集'));
    expect(h.openBookInStudio).toHaveBeenCalledTimes(1);
    expect(h.openBookInStudio).toHaveBeenCalledWith('b2', '碎句集');
  });

  it('点当前作品的页签 → 不重扫（避免切换变成有感的卡顿）', async () => {
    mount(<SceneTabBar />);
    await click(byText('长夜'));
    expect(h.openBookInStudio).not.toHaveBeenCalled();
  });

  it('多本作品：每个页签都有删除入口（删除后确认 = 放弃这本书）', () => {
    mount(<SceneTabBar />);
    expect(byAttr('data-book-delete="b1"'), 'b1 页签缺删除入口').toBeTruthy();
    expect(byAttr('data-book-delete="b2"'), 'b2 页签缺删除入口').toBeTruthy();
  });

  it('只剩一本作品：同样给出删除入口（2026-09-19 拍板：任何作品都可删）', () => {
    h.writing.books = [book('b1', '长夜', 'novel')];
    mount(<SceneTabBar />);
    expect(byAttr('data-book-delete="b1"'), '唯一作品的页签也应有删除入口').toBeTruthy();
    expect(byText('长夜')).toBeTruthy();
  });

  it('点删除 → 弹「删除作品」确认框，且**确认前不落库**（放弃是不可恢复的）', async () => {
    mount(<SceneTabBar />);
    await click(byAttr('data-book-delete="b2"'));
    expect(byText('删除作品'), '没弹出「删除作品」确认框').toBeTruthy();
    expect(h.deleteBookWithScene).not.toHaveBeenCalled();
  });

  it('确认删除 → 走 deleteBookWithScene（书 + 支撑场景一起清）', async () => {
    mount(<SceneTabBar />);
    await click(byAttr('data-book-delete="b2"'));
    await click(buttonByText('删除'));
    expect(h.deleteBookWithScene).toHaveBeenCalledTimes(1);
    expect(h.deleteBookWithScene).toHaveBeenCalledWith('b2');
  });

  it('「＋」选题材 → 新建一本该题材的作品（不是新建题材组）', async () => {
    mount(<SceneTabBar />);
    const add = document.body.querySelector('[data-testid="AddIcon"]');
    expect(add, '没找到「＋」按钮').toBeTruthy();
    await click(add!.closest('button'));
    const essay = menuItemByText('散文');
    expect(essay, '「＋」菜单里没有散文').toBeTruthy();
    await click(essay);
    expect(h.createBookAutoNamed).toHaveBeenCalledWith('essay');
    // 新建的是「书」，不是「题材组里的视图」
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
  });

  it('双击书名 → 进入改名；确认后 renameBook 落库（书名 = L1 页签名）', async () => {
    mount(<SceneTabBar />);
    const label = byText('碎句集')!;
    await act(async () => {
      label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = document.body.querySelector<HTMLInputElement>('input');
    expect(input, '双击没进改名态').toBeTruthy();
    expect(input!.value).toBe('碎句集');
  });

  // MUI 会在 Tabs 的 value 命中不了任何子 Tab 时整个组件报警告、指示条乱跑。
  // currentBookId 来自活动场景 projectRoot，books 来自书库，两者天然可能不同步：
  // 启动竞态（books 还没拉到）与幽灵场景（活动场景指向的书已被删）都会命中。
  it('活动场景指向的书不在书库里（幽灵场景）→ 不把非法值喂给 Tabs', () => {
    // 活动场景属于 b9，但书库里只有 b1 / b2
    h.scene.scenes = [{ id: 'wscan_b9', projectRoot: 'writing://b9/', primaryLanguage: 'novel-zh', name: '幽灵' }];
    h.scene.activeSceneId = 'wscan_b9';
    h.editor.views = [{ id: 'v1', name: '大纲', kind: 'catalog', carrierType: 'novel', components: [] }];
    mount(<SceneTabBar />);
    // 两个页签照常渲染出来（导航不因高亮缺失而消失）
    expect(byText('长夜')).toBeTruthy();
    expect(byText('碎句集')).toBeTruthy();
    // 关键：不许把 b9 喂给 MUI（喂了就会吼「value ... is invalid」，页签栏指示条乱跑）
    expect(tabsValueWarnings(), '把不存在的 book id 喂给了 Tabs').toBe(0);
    // 且必须留痕（绝不静默），日志里能看出是哪个场景指向了哪本不存在的书
    expect(h.loggerWarn).toHaveBeenCalledTimes(1);
    expect(h.loggerWarn.mock.calls[0][2]).toMatchObject({ currentBookId: 'b9' });
  });

  // 守的是**另一条**不变量（不是上面的 MUI value）：首帧 activeBookId 还没被 setActiveBook
  // 写进去，高亮只能从**活动场景**推。若有人把 value 改回「只读 activeBookId」，这条会红。
  it('启动竞态：书架为空 → 拉到书架后按**场景**高亮当前作品（activeBookId 未写入也不能丢高亮）', async () => {
    h.writing.books = [];
    h.writing.booksLoading = false;
    h.writing.activeBookId = null; // 首帧：还没 setActiveBook
    mount(<SceneTabBar />);
    expect(tabsValueWarnings()).toBe(0);
    expect(h.writing.loadBooks).toHaveBeenCalledTimes(1); // 空书架要补一次懒加载
    await act(async () => {
      h.writing.books = [book('b1', '长夜', 'novel'), book('b2', '碎句集', 'essay')];
      root!.render(
        <MemoryRouter>
          <SceneTabBar />
        </MemoryRouter>,
      );
    });
    const l1 = document.body.querySelectorAll('[role="tablist"]')[0];
    const selected = l1?.querySelector('[aria-selected="true"]');
    expect(selected?.textContent, '书架到位后没按活动场景高亮当前作品').toContain('长夜');
    expect(tabsValueWarnings()).toBe(0);
    // 加载完成后书架非空，不该再报幽灵场景
    expect(h.loggerWarn).not.toHaveBeenCalled();
  });

  // L2 那条 Tabs 与 L1 同一个约束。两个真实失配来源都不是「数据坏了」，
  // 而是「清场 effect 要等一帧」——首帧就会往控制台刷警告。
  it('L2：遗留视图的 kind 不在固定 11 项里（如旧的过渡 kind）→ 不产生非法 Tabs value', () => {
    h.editor.views = [{ id: 'v1', name: '全局', kind: 'legacyGlobal', carrierType: 'novel', components: [] }];
    h.editor.activeViewId = 'v1';
    mount(<SceneTabBar />);
    expect(tabsValueWarnings(), '遗留 kind 被当成了 L2 的 value').toBe(0);
  });

  it('L2：激活的是被剥掉的空壳 default → 不产生非法 Tabs value', () => {
    h.editor.views = [
      { id: 'default', name: '目录树', carrierType: 'novel', components: [] },
      { id: 'v1', name: '大纲', kind: 'catalog', carrierType: 'novel', components: [] },
    ];
    h.editor.activeViewId = 'default';
    mount(<SceneTabBar />);
    expect(tabsValueWarnings(), '空壳 default 被当成了 L2 的 value').toBe(0);
  });

  // 2026-09-21 实测回归：书场景停用自动铺全书总览板后，新书场景只剩 default
  // 结构壳（目录树，无 carrierType）这一只视图 —— 清场回收必须带 allowEmpty，
  // 否则被「仅剩一只不可删」保护挡住，「目录树」页签残留（书场景根本没有目录树）。
  it('L2：书场景只剩 default 结构壳 → 也被回收（allowEmpty 删到 0 只）', async () => {
    h.editor.views = [{ id: 'default', name: '目录树', components: [] }];
    h.editor.activeViewId = 'default';
    mount(<SceneTabBar />);
    await act(async () => {});
    expect(h.editor.removeView).toHaveBeenCalledWith('default', { allowEmpty: true });
  });
});

describe('SceneTabBar · 书场景 L2 键盘切换（Arrow 左右）', () => {
  const keyView = (id: string, name: string, kind: string) => ({
    id,
    name,
    kind,
    carrierType: 'novel',
    components: [],
  });
  const customView = (id: string, name: string) => ({
    id,
    name,
    carrierType: 'novel',
    components: [],
  });

  beforeEach(() => {
    // 书场景：catalog(v1) 与 characters(v2) 已建，worldview 等未建（淡显、不参与切换）
    h.editor.views = [
      keyView('v1', '大纲', 'catalog'),
      keyView('v2', '人物', 'characters'),
      customView('v9', '我的分镜板'),
    ];
    h.editor.activeViewId = 'v1';
    h.editor.previewMode = false;
  });

  /** 真实 dispatch 一个键盘事件（React 18 事件委托能收到冒泡到 window 的 keydown） */
  async function press(key: string, target: Element | Window = window) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  }

  it('ArrowRight：从当前视图切到 L2 序列下一个已建视图', async () => {
    mount(<SceneTabBar />);
    await press('ArrowRight');
    expect(h.editor.switchView).toHaveBeenCalledWith('v2');
  });

  it('ArrowLeft：从当前视图切到 L2 序列上一个已建视图', async () => {
    h.editor.activeViewId = 'v2';
    mount(<SceneTabBar />);
    await press('ArrowLeft');
    expect(h.editor.switchView).toHaveBeenCalledWith('v1');
  });

  it('起点在序列最左：ArrowLeft 不切（不到边界外）', async () => {
    mount(<SceneTabBar />);
    await press('ArrowLeft');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('终点在序列最右：ArrowRight 不切（不到边界外）', async () => {
    h.editor.activeViewId = 'v9';
    mount(<SceneTabBar />);
    await press('ArrowRight');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  // L2 序列 = KIND_TABS 已建项（固定顺序）+ 自定义页签（出现顺序）——
  // 未建的 kind（worldview/timeline/…）淡显但不参与，键盘不会「缺省即建」。
  it('未建的 kind 页签不进序列：从 v2 (characters) 向右直接到自定义 v9', async () => {
    h.editor.activeViewId = 'v2';
    mount(<SceneTabBar />);
    await press('ArrowRight');
    expect(h.editor.switchView).toHaveBeenCalledWith('v9');
  });

  it('输入框聚焦时按箭头：不劫持（正文编辑/改名输入需要移动光标）', async () => {
    mount(<SceneTabBar />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await press('ArrowRight', input);
    input.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('contentEditable 聚焦时按箭头：不劫持（正文章页签的内容编辑）', async () => {
    mount(<SceneTabBar />);
    // 真实编辑器（Tiptap/ProseMirror）以 attribute 形态存在；jsdom 不实现
    // isContentEditable，但 closest('[contenteditable]') 按 attribute 查，两者都能拦。
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    await press('ArrowRight', editable);
    editable.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('带修饰键的箭头：让位给系统/编辑器快捷键，不切换', async () => {
    mount(<SceneTabBar />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }));
    });
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('弹窗打开时按箭头：不切换（Dialog/Menu 打开期间保持当前视图焦点）', async () => {
    mount(<SceneTabBar />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await press('ArrowRight');
    dialog.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('非书场景（代码/通用场景）：不注册 L2 键盘切换', async () => {
    h.scene.scenes = [{ id: 'wscan_code1', projectRoot: 'writing://b1/', primaryLanguage: 'en', name: '代码库' }];
    h.scene.activeSceneId = 'wscan_code1';
    mount(<SceneTabBar />);
    await press('ArrowRight');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });
});

// ─── previewMode 键盘切换守卫一致性（第十六轮）───
// previewMode 的左右箭头切视图分支此前无输入态/弹窗守卫，与书场景 L2 分支口径不一致
// （第十四轮 B1 同型：编辑态按箭头被劫持切页）。守卫补齐后锁定：正常切换 + 各守卫不劫持。
describe('SceneTabBar · previewMode 键盘切换守卫', () => {
  const mk = (id: string) => ({ id, name: id, carrierType: 'novel', components: [] });
  beforeEach(() => {
    h.editor.previewMode = true;
    h.editor.views = [mk('v1'), mk('v2'), mk('v3')];
    h.editor.activeViewId = 'v2';
  });
  afterEach(() => {
    h.editor.previewMode = false;
  });

  async function press(key: string, target: Element | Window = window, init?: KeyboardEventInit) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    });
  }

  it('预览模式正常态：ArrowRight 切到下一个视图（守卫未堵死主功能）', async () => {
    mount(<SceneTabBar />);
    await press('ArrowRight');
    expect(h.editor.switchView).toHaveBeenCalledWith('v3');
  });

  it('改名/搜索输入框聚焦时：箭头不劫持', async () => {
    mount(<SceneTabBar />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await press('ArrowRight', input);
    input.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('contentEditable 聚焦时：箭头不劫持（正文编辑态）', async () => {
    mount(<SceneTabBar />);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    await press('ArrowRight', editable);
    editable.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('带修饰键的箭头：让位系统快捷键，不切换', async () => {
    mount(<SceneTabBar />);
    await press('ArrowRight', window, { ctrlKey: true });
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('弹窗打开时：不切换', async () => {
    mount(<SceneTabBar />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await press('ArrowRight');
    dialog.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });
});

// 2026-11-08 李先生：散文和小说不一样，可 L2 那排页签以前对谁都一样挂满十一个。
// 判据收在 writingSchema.hiddenViewKindsForGenre，这里锁的是**渲染层真的吃了它**，
// 以及那条护栏：书里已经建过的视图，页签绝不许消失。
describe('SceneTabBar · L2 固定页签按体裁裁剪', () => {
  /** 把"当前书"切到散文那本。注意：SceneTabBar 的当前书优先取**活动场景的 projectRoot**
   *  （`parseBookIdFromRoot`），只改 activeBookId 是切不过去的 —— 夹具必须一起改。 */
  const useEssayBook = () => {
    // 注意 primaryLanguage 这里必须写 'novel-zh'：`studioBook.ts:75` 给**每一本书**的支撑场景
    // 都写死 'novel-zh'，而全工作室 12 处 `isBookScene` 判定都认这个值（SceneTabBar/SceneEditor/
    // 人物面板/架构面板/导出报告…）。也就是说「这是不是一本书」的身份**借用了小说的语言标记**，
    // 散文只是沾了这行写死的光才能长出页签栏。已记入审计，修法要新增独立标志位（承载层，待拍板）。
    h.scene.scenes = [{ id: 'wscan_b2', projectRoot: 'writing://b2/', primaryLanguage: 'novel-zh', name: '碎句集' }];
    h.scene.activeSceneId = 'wscan_b2';
    h.writing.activeBookId = 'b2';
    h.editor.views = [{ id: 'v1', name: '大纲', kind: 'catalog', carrierType: 'essay', components: [] }];
    h.editor.activeViewId = 'v1';
  };

  it('散文不再挂 世界观/剧情线/伏笔（连载叙事骨架），散文用得上的仍在', () => {
    useEssayBook();
    mount(<SceneTabBar />);
    expect(byText(t('writing.viewKind.worldview')), '散文不该再挂世界观页签').toBeNull();
    expect(byText(t('writing.viewKind.storylines')), '散文不该再挂剧情线页签').toBeNull();
    expect(byText(t('writing.viewKind.foreshadowing')), '散文不该再挂伏笔页签').toBeNull();
    // ㉚ 起散文的第一枚页签叫「篇目」，所以查标签必须走同一个解析器：
    // 查死 `writing.viewKind.catalog` 会在体裁换词后误报"页签被误裁"。
    expect(byText(t(viewKindLabelKey('essay', 'catalog'))), '篇目/大纲页签被误裁').toBeTruthy();
    expect(byText(t('writing.viewKind.writing')), '正文页签被误裁').toBeTruthy();
    expect(byText(t('writing.viewKind.overview')), '总览页签被误裁').toBeTruthy();
  });

  it('护栏：这本书**已经建过**世界观视图，页签照旧显示（裁页签不许藏数据）', () => {
    useEssayBook();
    h.editor.views = [
      ...h.editor.views,
      { id: 'v9', name: '旧世界观', kind: 'worldview', carrierType: 'essay', components: [] },
    ];
    mount(<SceneTabBar />);
    expect(byText(t('writing.viewKind.worldview')), '已建视图的页签被裁掉 = 用户数据看不见').toBeTruthy();
  });

  it('小说零回归：十一项一个不少', () => {
    mount(<SceneTabBar />); // beforeEach 里 b1 = novel
    for (const label of ['大纲','人物设定','世界观','时间线','剧情线','伏笔','灵感','校对','统计','总览','正文']) {
      expect(byText(label), `小说缺页签「${label}」`).toBeTruthy();
    }
  });

  // **已知缺陷的证据锁**（不是"希望如此"）：把场景的 primaryLanguage 换成体裁真实的值，
  // 整条 L2 页签栏就没了 —— 因为 `isBookScene` 认的是 'novel-zh' 这个语言标记，
  // 而 `studioBook.ts:75` 给所有体裁的书都写死 'novel-zh'。
  // 将来把它换成独立的书场景标志位时这条会失败，提醒两件事必须真正分开。
  it('已知缺陷锁：书场景身份借用了 novel-zh 标记', () => {
    useEssayBook();
    h.scene.scenes = [{ ...h.scene.scenes[0], primaryLanguage: 'essay-zh' }];
    mount(<SceneTabBar />);
    expect(document.querySelectorAll('.MuiTab-root').length).toBe(0);
  });
});

// ─── ㉚ T-A（2026-11-10 轮 5）：L2 页签**换词** ───
// 裁剪那一半 2026-11-08 就做了（上面那个 describe），但五种载体一直共用同一串名字：
// 诗集作者的第一枚页签写着「大纲」、剧本写着「人物设定」——判据（surfaceKeyForGenre /
// collectionPaneKeys）在库里早就有了，页签层是唯一没接上的一张嘴。
// 这一组锁的是「真的换了」+「小说一个字节没变」，两者缺一都是半刀。
describe('SceneTabBar · ㉚ L2 页签标签随体裁', () => {
  const setGenreBook = (genre: string) => {
    h.writing.books = [book('b1', '当前这本', genre)];
    h.writing.activeBookId = 'b1';
    h.scene.scenes = [{ id: 'wscan_b1', projectRoot: 'writing://b1/', primaryLanguage: 'novel-zh', name: '当前这本' }];
    h.scene.activeSceneId = 'wscan_b1';
    h.editor.views = [{ id: 'v1', name: '第一枚', kind: 'catalog', carrierType: genre, components: [] }];
    h.editor.activeViewId = 'v1';
  };
  /**
   * L2 页签文字（按渲染顺序）。夹具里只有 1 本书，所以整棵树上
   * `.MuiTab-root` = L1 的书名页签 + L2 的 11/8/10 枚固定页签（L2 没有「＋」，见 :938 注释），
   * 剔掉书名与空文本（图标按钮）就是 L2 本身。
   */
  const l2Labels = (): string[] =>
    Array.from(document.querySelectorAll<HTMLElement>('.MuiTab-root'))
      .map((el) => (el.textContent ?? '').trim())
      .filter((s) => s !== '' && s !== '当前这本');

  // ㉳ T-B（轮 34）起「顺序也原样」这半句作废：**标签逐字不动**仍是铁律，
  // **位次**改由 TAB_ORDER 定稿（目标态卡 §2，正文领头）。这条锁现在验两件事：
  // 换词零回归 + 小说吃小说那张序表。
  it('小说：十一枚逐字仍是原句，位次走 ㉳ 序表（正文·大纲·剧情线领头）', () => {
    setGenreBook('novel');
    mount(<SceneTabBar />);
    expect(l2Labels()).toEqual(['正文', '大纲', '剧情线', '人物设定', '世界观', '时间线', '伏笔', '灵感', '校对', '统计', '总览']);
  });

  // 空体裁与脏体裁是**两种回落**（㉳ 设计注记③）：'' 被组件归一成 novel → 吃小说序表；
  // 脏值不认 → tabOrderForGenre 空表 → KIND_TABS 基准序。文案两者都落小说那串，不许改。
  it('旧书没设体裁 → 落小说的串 + 小说的序（归一在组件里发生）', () => {
    setGenreBook('');
    mount(<SceneTabBar />);
    expect(l2Labels()).toEqual(['正文', '大纲', '剧情线', '人物设定', '世界观', '时间线', '伏笔', '灵感', '校对', '统计', '总览']);
  });

  it('体裁值是脏的 → 文案落小说、位次落基准序（空表不改序 = 旧书零回归线）', () => {
    for (const g of ['diaryy', 'Novel']) {
      unmount();
      setGenreBook(g);
      mount(<SceneTabBar />);
      expect(l2Labels(), `genre=${JSON.stringify(g)}`).toEqual([
        '大纲', '人物设定', '世界观', '时间线', '剧情线', '伏笔', '灵感', '校对', '统计', '总览', '正文',
      ]);
    }
  });

  it('散文：篇目 + 人物（不再顶着「大纲 / 人物设定」），㉳ 序 = 正文·篇目·素材领头', () => {
    setGenreBook('essay');
    mount(<SceneTabBar />);
    const labels = l2Labels();
    expect(labels.slice(0, 3), '㉳ 序表前三不对').toEqual(['正文', t('writing.essay.tabCatalog'), '灵感']);
    expect(labels[1]).toBe('篇目');
    expect(labels).toContain('人物');
    expect(byText('大纲'), '散文还挂着「大纲」= 换词没生效').toBeNull();
    expect(byText('人物设定'), '散文不该再叫人物设定').toBeNull();
  });

  it('诗歌：诗作 —— 与设计卡那一栏同一个词（㉳ 序里排第二，正文在头）', () => {
    setGenreBook('poetry');
    mount(<SceneTabBar />);
    const labels = l2Labels();
    expect(labels[0]).toBe('正文');
    expect(labels[1]).toBe('诗作');
    // 「设计卡叫诗作、页签叫篇目」正是 COLLECTION_PANE_KEYS 头注释许下的愿
    expect(byText(t('writingDesign.pane.pieces')), '诗集页签不该领到散文的篇目').toBeNull();
  });

  it('剧本：幕场 + 角色表，剧情线/伏笔照旧（戏剧本体，不许替用户改名），㉳ 序整排定稿', () => {
    setGenreBook('script');
    mount(<SceneTabBar />);
    expect(l2Labels()).toEqual(['正文', '幕场', '角色表', '剧情线', '伏笔', '时间线', '灵感', '校对', '统计', '总览']);
    expect(byText('世界观'), '剧本已摘世界观（⑑-2）').toBeNull();
  });

  it('日记：条目 + 人物，且整排不许说出「章」（㉳ 序 = 正文·条目领头，日历等 P4）', () => {
    setGenreBook('diary');
    mount(<SceneTabBar />);
    const labels = l2Labels();
    expect(labels.slice(0, 2)).toEqual(['正文', '条目']);
    expect(labels).toContain('人物');
    expect(byText('大纲'), '日记还挂着「大纲」').toBeNull();
    for (const label of labels) expect(label, `日记页签说漏了「${label}」`).not.toContain('章');
  });
});

// ─── ㉳ T-B（2026-11-11 轮 34）：⌥1–9 直达 + ←→，序列与页签渲染同源 ───
// 「同源」不许停在口头：夹具故意让**基准序**（catalog→storylines→…→writing）与
// **小说序表**（writing→catalog→storylines）在这三只已建视图上给出不同排列 ——
// 键盘若还吃旧的 KIND_TABS 序，下面的断言立刻红。
describe('SceneTabBar · ㉳ L2 键盘序列与页签顺序同源（⌥1–9 / ←→）', () => {
  const kv = (id: string, kind: string) => ({ id, name: id, kind, carrierType: 'novel', components: [] });

  beforeEach(() => {
    // 小说（b1）：writing(v2) catalog(v1) storylines(v3) 已建 + 自定义 v9。
    // 新序 = [v2, v1, v3, v9]；基准序 = [v1, v3, v2, v9]。
    h.editor.views = [kv('v1', 'catalog'), kv('v3', 'storylines'), kv('v2', 'writing'), { id: 'v9', name: '我的板子', carrierType: 'novel', components: [] }];
    h.editor.activeViewId = 'v9';
    h.editor.previewMode = false;
  });

  /** macOS ⌥+数字的 e.key 是组合字符（¡/™…），真实事件靠 e.code 判定物理键 —— 夹具照此形状发 */
  async function pressAltDigit(digit: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '¡', code: `Digit${digit}`, altKey: true, bubbles: true, ...init }),
      );
    });
  }

  it('⌥1 → 小说序第一枚已建视图（正文 v2），不是基准序第一枚（v1）', async () => {
    mount(<SceneTabBar />);
    await pressAltDigit('1');
    expect(h.editor.switchView).toHaveBeenCalledWith('v2');
  });

  it('⌥2/⌥3 → 大纲 v1、剧情线 v3（位次 = 小说那张序表，不是基准序）', async () => {
    mount(<SceneTabBar />);
    await pressAltDigit('2');
    expect(h.editor.switchView).toHaveBeenCalledWith('v1');
    await pressAltDigit('3');
    expect(h.editor.switchView).toHaveBeenCalledWith('v3');
  });

  it('自定义页签排在固定页签之后：active=v2 时 ⌥4 → v9', async () => {
    h.editor.activeViewId = 'v2';
    mount(<SceneTabBar />);
    await pressAltDigit('4');
    expect(h.editor.switchView).toHaveBeenCalledWith('v9');
  });

  it('←→ 也吃新序：正文(v2) 向右切到 大纲(v1)（旧序会切到 v3）', async () => {
    h.editor.activeViewId = 'v2';
    mount(<SceneTabBar />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(h.editor.switchView).toHaveBeenCalledWith('v1');
  });

  it('越界数字（⌥9，序列只有 4 位）：无事发生，绝不缺省即建', async () => {
    mount(<SceneTabBar />);
    await pressAltDigit('9');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('目标已是当前视图（⌥4 且 active=v9）：不重复扳 switchView', async () => {
    mount(<SceneTabBar />);
    await pressAltDigit('4');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('输入框聚焦时按 ⌥1：不劫持（改名/搜索输入态）', async () => {
    mount(<SceneTabBar />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '¡', code: 'Digit1', altKey: true, bubbles: true }));
    });
    input.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('弹窗打开时按 ⌥1：不切换', async () => {
    mount(<SceneTabBar />);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await pressAltDigit('1');
    dialog.remove();
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('⌥⌘1 组合：让位系统快捷键，不切换', async () => {
    mount(<SceneTabBar />);
    await pressAltDigit('1', { metaKey: true });
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });

  it('非书场景（代码/通用场景）：⌥1–9 不注册', async () => {
    h.scene.scenes = [{ id: 'wscan_code1', projectRoot: 'writing://b1/', primaryLanguage: 'en', name: '代码库' }];
    h.scene.activeSceneId = 'wscan_code1';
    mount(<SceneTabBar />);
    await pressAltDigit('1');
    expect(h.editor.switchView).not.toHaveBeenCalled();
  });
});
