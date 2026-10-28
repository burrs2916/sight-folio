// 灵感念头池树形回归锁（2026-10-12，第 2 版）
//
// 用户反馈「灵感页签念头池没按树展开」「我们大纲是怎么样的，这里的树就是怎么样的」。
// 取证结论：念头是无层级的松散 WritingOutline（无 parentId），树形只能来自「念头 →
// chapterId 绑定章节 → 章节树 buildTree」；而「树」= 大纲页签章节树的同构呈现。
// 因此灵感池树形与大纲共享两件事：
//   A. 顺序：念头按「绑定章节在章节树先序遍历的位次」重排（forestPreorderIndex），
//      不再按 outline 的 sortOrder 平铺；未绑定 / 章节查不到的游离念头排最前（基准 0）。
//   B. 几何：每条念头渲染与 NodeRow 同款的祖先竖线 + 末层 elbow 引导线，
//      行左内边距 = treeRowIndent(depth)（根层 8px，每深一层 +20px）。
// 本测试锁的是**代码本身**的渲染契约，防止以后把树形改坏还查不出来：
//   ① 绑定根章节（depth 0）的念头行 padding-left = 8px（INDENT_BASE）
//   ② 绑定子章节（depth 1）的念头行 padding-left = 28px（INDENT_BASE + INDENT_STEP）
//   ③ 未绑定章节（chapterId=null）与章节查不到的念头 → 基准 0（不缩进），且排最前
//   ④ 多条念头 → 按绑定章节的章节树先序重排（与大纲页签同一棵树的遍历顺序）
//   ⑤ depth ≥ 1 的念头行带祖先竖线 + elbow 引导线（与 NodeRow 同款分支画法）
//   ⑥ 点念头行 → selectInspiration 携带念头 id（选中/写入链路不因树形化改变）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  editor: {
    selectedInspirationId: null as string | null,
    selectInspiration: vi.fn(),
  },
  writing: {
    books: [] as any[],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    activeBookId: 'b1' as string | null,
    collapsedNodeIds: [] as string[],
    toggleNodeCollapse: vi.fn(),
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
    storylines: [] as any[],
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
  openChapterCarrierView: vi.fn(),
  openWritingDesk: vi.fn(async () => null),
}));

vi.mock('../../../store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.editor), {
    getState: () => h.editor,
  }),
}));
vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../utils/studioBook', () => ({
  openChapterCarrierView: h.openChapterCarrierView,
}));
vi.mock('../../../utils/writingDeskWindow', () => ({
  openWritingDesk: h.openWritingDesk,
}));

import { InspirationsPane } from '../writingPanes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(ui);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
});

const chapter = (id: string, title: string, kind: string, parentId: string | null, sortOrder = 0) => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId,
  kind,
  createdAt: 0,
  updatedAt: 0,
});

const outline = (id: string, title: string, chapterId: string | null) => ({
  id,
  bookId: 'b1',
  title,
  summary: '',
  chapterId,
  extra: '{}',
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** 找标题为 title 的念头行（button，padding 就在这层） */
function rowOf(title: string): HTMLButtonElement | null {
  const rows = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
  return rows.find((b) => (b.textContent ?? '').includes(title)) ?? null;
}

describe('灵感念头池 · 念头行按绑定章节树形缩进（回归锁）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writing.activeBookId = 'b1';
    h.writing.books = [{ id: 'b1', title: '长夜', genre: 'novel' }];
    // 与用户真库同构：卷 1 是根，章 1 挂在卷 1 下
    h.writing.chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    h.writing.outlines = [];
    h.writing.settings = [];
  });

  it('绑定根章节（depth 0）的念头行 padding-left = 8px —— 与章节树根层同基准', () => {
    h.writing.outlines = [outline('o1', '念头绑定卷1', 'v1')];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('念头绑定卷1');
    expect(row, '念头行没渲染出来').toBeTruthy();
    expect(row!.style.padding, `根层念头缩进应为 8px（实际="${row!.style.padding}"）`).toBe('2px 4px 2px 8px');
  });

  it('绑定子章节（depth 1）的念头行 padding-left = 28px —— 缩进的本体就是这条 padding', () => {
    h.writing.outlines = [outline('o2', '念头绑定章1', 'c1')];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('念头绑定章1');
    expect(row, '念头行没渲染出来').toBeTruthy();
    expect(row!.style.padding, `子层念头缩进应为 28px（实际="${row!.style.padding}"）`).toBe('2px 4px 2px 28px');
  });

  it('未绑定章节（chapterId=null）的念头平铺在基准位（不缩进）', () => {
    h.writing.outlines = [outline('o3', '未落章念头', null)];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('未落章念头');
    expect(row, '念头行没渲染出来').toBeTruthy();
    expect(row!.style.padding, `未绑定念头应停在基准位（实际="${row!.style.padding}"）`).toBe('2px 4px 2px 8px');
  });

  it('chapterId 指向不存在的章节 → 不缩进（防脏数据撑破树形）', () => {
    h.writing.outlines = [outline('o4', '幽灵章念头', 'ghost')];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('幽灵章念头');
    expect(row, '念头行没渲染出来').toBeTruthy();
    expect(row!.style.padding).toBe('2px 4px 2px 8px');
  });

  it('多条念头按绑定章节的章节树先序重排，未绑定游离念头排最前（与大纲同一棵树）', () => {
    // 章节树：卷 1（根）→ 章 1、章 2（子）。念头故意逆序/夹杂未绑定，验证渲染仍排成树序：
    // 游离（未绑定）×1 → 卷 1 下的念头 → 章 1 下的念头 → 章 2 下的念头。
    h.writing.chapters = [
      chapter('v1', '卷 1', '卷', null, 0),
      chapter('c1', '章 1', '章', 'v1', 0),
      chapter('c2', '章 2', '章', 'v1', 1),
    ];
    h.writing.outlines = [
      outline('o-a', '章1念头', 'c1'), // 先序 1
      outline('o-b', '卷1念头', 'v1'), // 先序 0
      outline('o-c', '游离念头', null), // 无章节 → 最前
      outline('o-d', '章2念头', 'c2'), // 先序 2
    ];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const titles = Array.from(document.body.querySelectorAll('button'))
      .map((b) => (b.textContent ?? '').replace('◆', '').trim())
      .filter((s) => s.includes('念头'));
    expect(titles, '渲染顺序应与章节树先序一致（游离在前）').toEqual(['游离念头', '卷1念头', '章1念头', '章2念头']);
  });

  it('depth ≥ 1 的念头行带祖先竖线 + elbow 引导线（与 NodeRow 同款分支画法）', () => {
    h.writing.chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    h.writing.outlines = [outline('o6', '深层念头', 'c1')];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('深层念头');
    expect(row, '念头行没渲染出来').toBeTruthy();
    // 引导线画在 button 的相对定位父容器里：depth 1 → 1 条祖先竖线 + 1 条 elbow
    const guides = Array.from(row!.parentElement!.querySelectorAll('span[style*="position: absolute"]'));
    expect(guides.length, `depth=1 应有 2 条引导线（竖线 + elbow），实际 ${guides.length}`).toBe(2);
    // 竖线贯穿行高（top:0/bottom:0），elbow 是横向短横线（height:1px）
    expect(guides[0].getAttribute('style')).toContain('bottom: 0');
    expect(guides[1].getAttribute('style')).toContain('height: 1px');
  });

  it('点念头行 → selectInspiration 携带念头 id（选中链路不因树形化改变）', () => {
    h.writing.outlines = [outline('o5', '可点念头', 'c1')];
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const row = rowOf('可点念头');
    expect(row, '念头行没渲染出来').toBeTruthy();
    act(() => {
      row!.click();
    });
    expect(h.editor.selectInspiration).toHaveBeenCalledWith('o5');
  });
});

describe('灵感念头池 · 右卡「AI 扩写」跨视图入口（O7 扩写闭环 L2 接入）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writing.activeBookId = 'b1';
    h.writing.books = [{ id: 'b1', title: '长夜', genre: 'novel' }];
    h.writing.chapters = [chapter('v1', '卷 1', '卷', null, 0), chapter('c1', '章 1', '章', 'v1', 0)];
    h.writing.outlines = [outline('o-x', '要扩写的念头', 'c1')];
    h.editor.selectedInspirationId = 'o-x';
  });

  afterEach(() => {
    h.editor.selectedInspirationId = null;
  });

  it('选中灵感 → 右卡出现「✨ AI 扩写」按钮 → 点击向写作台发起 { bookId, inspirationId }', () => {
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    // 右卡 InspirationDetail 渲染（key 重挂），分发区含 ✨ AI 扩写
    const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').includes('AI 扩写'),
    );
    expect(btn, '右卡没渲染出「AI 扩写」按钮').toBeTruthy();
    act(() => {
      btn!.click();
    });
    expect(h.openWritingDesk).toHaveBeenCalledTimes(1);
    expect(h.openWritingDesk).toHaveBeenLastCalledWith({ bookId: 'b1', inspirationId: 'o-x' });
  });

  it('未选中灵感时右卡只显示编辑提示，无「AI 扩写」按钮', () => {
    h.editor.selectedInspirationId = null;
    mount(<InspirationsPane accent="#4A338F" bookId="b1" />);
    const btns = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
    expect(btns.some((b) => (b.textContent ?? '').includes('AI 扩写'))).toBe(false);
  });
});
