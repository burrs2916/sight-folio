// 「要素」出口按钮 no-op 回归锁（2026-09-14）
//
// 事故：用户指出「要素」里的「打开大纲」按钮没有用。
// 根因：Inspector 的 kind 来自 SceneEditor 的 **activeViewKind**（当前视图），
// openTypedCarrierView 又是幂等的（命中已有视图就 switchView）——
// 所以站在大纲视图上没选中任何东西时，「打开大纲」指向的就是你脚下的视图，
// 点击 = switchView 到自己 = 纯 no-op。用户口径：这种废按钮不该渲染。
// 修法：paneExit 闸——出口目标 == 当前视图 → 不渲染；真跳转（正文/只读板 → 大纲等）保留。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  writing: {
    books: [{ id: 'b1', title: '长夜', genre: 'novel' }],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    activeBookId: 'b1' as string | null,
    // P1.5 章反向时间线入口：面板新增订阅 + 补齐加载，mock 须一并供给
    timelineEvents: [] as any[],
    // 剧情线联动（派生三刀）：SettingTimelineSection/主组件新增 storylines 订阅
    storylines: [] as any[],
    // 伏笔联动：主组件新增 foreshadowings 订阅
    foreshadowings: [] as any[],
    loadBooks: vi.fn(async () => {}),
    loadTimelineEvents: vi.fn(async () => {}),
    setActiveBook: vi.fn(async () => {}),
    loadStorylines: vi.fn(async () => {}),
    loadForeshadowings: vi.fn(async () => {}),
  },
  openTypedCarrierView: vi.fn(),
  openChapterCarrierView: vi.fn(),
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../utils/studioBook', () => ({
  openTypedCarrierView: h.openTypedCarrierView,
  openChapterCarrierView: h.openChapterCarrierView,
}));

import { WritingInspectorPanel } from '../WritingInspectorPanel';

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

function buttonLabels(): string[] {
  return Array.from(document.body.querySelectorAll('button')).map((b) => b.textContent ?? '');
}

// 题材维度跳转入口的文案随 UI 语言变化（zh=大纲 / en=Outline），用无关子串匹配避免绑定某语言。
function isCatalogNav(text: string): boolean {
  return text.includes('大纲') || text.includes('Outline');
}

// 到全书总览编辑面的出口按钮文案 = openTpl("打开{name}", name=总览/Overview)。
function isOverviewNav(text: string): boolean {
  return text.includes('总览') || text.includes('Overview');
}

describe('「要素」出口按钮：指向当前视图的不渲染（回归锁）', () => {
  it('站在大纲视图（kind=catalog）且无选中：不得出现「打开大纲」废按钮', () => {
    mount(<WritingInspectorPanel kind="catalog" bookId="b1" entity={null} />);
    const hits = buttonLabels().filter((s) => s.includes('打开大纲'));
    expect(hits, `不该渲染 no-op 出口：${JSON.stringify(hits)}`).toEqual([]);
  });

  it('站在正文容器（kind=writing）且无选中：右栏不再整块回总览，只给点选引导 + 到全书总览编辑面的出口（2026-09-28 收口）', () => {
    mount(<WritingInspectorPanel kind="writing" bookId="b1" entity={null} />);
    // 旧行为：右栏无选中态整块渲染全书总览仪表盘（九大题材导航 chip, role=button）；
    // P1.5 收口后总览仪表盘只在 L2「overview」页签编辑面一份，右栏无选中态改为轻量引导。
    const navTexts = Array.from(document.body.querySelectorAll('[role="button"]')).map((b) => b.textContent ?? '');
    expect(
      navTexts.some((s) => isCatalogNav(s)),
      '右栏无选中态不应再整块渲染总览仪表盘',
    ).toBe(false);
    // 新行为：点选提示 + 到「总览」编辑面的出口按钮。
    expect(
      buttonLabels().some((s) => isOverviewNav(s)),
      '应提供到全书总览编辑面的出口',
    ).toBe(true);
  });

  it('点击「打开总览」出口 → openTypedCarrierView(genre, overview)', async () => {
    mount(<WritingInspectorPanel kind="writing" bookId="b1" entity={null} />);
    const btn = Array.from(document.body.querySelectorAll('button')).find((b) => isOverviewNav(b.textContent ?? ''));
    expect(btn, '应存在到总览编辑面的出口按钮').toBeTruthy();
    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('novel', 'overview');
  });
});
