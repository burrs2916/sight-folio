// 大纲树缩进回归锁（2026-09-14）
//
// 用户连续多轮反馈「卷下面的章没有缩进」。取证结论：源码/构建产物都含缩进，
// 运行实例不生效是 WKWebView 缓存旧模块（已在 vite.config 加 no-store 掐死）。
// 这份测试锁的是**代码本身**的渲染契约，防止以后真把缩进改坏还查不出来：
//   ① 章（depth 1）内层行 padding-left = 28px（INDENT_BASE 8 + INDENT_STEP 20）
//   ② 卷（depth 0）内层行 padding-left = 8px
//   ③ 章 行的包裹层里有 2 条绝对定位引导线（竖线 + elbow 横钩）
//   ④ 点卷行的「+ 子级」→ createChildNode 收到的第一个参数是**卷的 id**
//      （parentId 链路 = 缩进的数据源头，断在这上面树永远是平的）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
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
    // StorylineSection（剧情线实体区）新增订阅 + 动作，mock 须一并供给
    storylines: [] as any[],
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
  openChapterCarrierView: vi.fn(),
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../utils/studioBook', () => ({
  openChapterCarrierView: h.openChapterCarrierView,
}));

import { StorylinePane } from '../writingPanes';

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

const chapter = (id: string, title: string, kind: string, parentId: string | null) => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder: 0,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId,
  kind,
  createdAt: 0,
  updatedAt: 0,
});

/** 找标题为 title 的节点行（行 div = input 的直接父层，padding 就在这层） */
function rowOf(title: string): HTMLElement | null {
  const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement>('input'));
  const inp = inputs.find((i) => i.value === title);
  return inp ? (inp.parentElement as HTMLElement) : null;
}

describe('大纲树 · 卷→子级 按树形缩进（回归锁）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writing.activeBookId = 'b1';
    h.writing.books = [{ id: 'b1', title: '长夜', genre: 'novel' }];
    // 与用户真库同构：卷 1 是根，章 1 挂在卷 1 下（= 在卷上行点「+ 子级」的结果）
    h.writing.chapters = [chapter('v1', '卷 1', '卷', null), chapter('c1', '章 1', '章', 'v1')];
    h.writing.outlines = [];
    h.writing.settings = [];
  });

  it('章（depth 1）内层行 padding-left = 28px —— 缩进的本体就是这条 padding', () => {
    mount(<StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={[]} settings={[]} />);
    const row = rowOf('章 1');
    expect(row, '章 1 行没渲染出来').toBeTruthy();
    expect(row!.style.padding, `章 1 行没有缩进 padding（实际="${row!.style.padding}"）`).toBe('3px 4px 3px 28px');
  });

  it('卷（depth 0）内层行 padding-left = 8px（根节点保持基准位）', () => {
    mount(<StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={[]} settings={[]} />);
    const row = rowOf('卷 1');
    expect(row, '卷 1 行没渲染出来').toBeTruthy();
    expect(row!.style.padding).toBe('3px 4px 3px 8px');
  });

  it('章 行的包裹层有竖向引导线 + elbow 横钩（从属关系画成可见分支）', () => {
    mount(<StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={[]} settings={[]} />);
    const row = rowOf('章 1')!;
    const wrapper = row.parentElement!;
    const guides = Array.from(wrapper.children).filter((el) => (el as HTMLElement).style.position === 'absolute');
    expect(guides.length, '章 1 行缺引导线（竖线+横钩应各一条）').toBe(2);
  });

  it('点卷行的「+ 子级」→ createChildNode 第一参数是卷 id（parentId 链路 = 缩进的数据源头）', async () => {
    mount(<StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={[]} settings={[]} />);
    const row = rowOf('卷 1')!;
    const addBtn = Array.from(row.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '+ 子级');
    expect(addBtn, '卷行缺「+ 子级」按钮').toBeTruthy();
    await act(async () => {
      addBtn!.click();
    });
    expect(h.writing.createChildNode).toHaveBeenCalledTimes(1);
    expect(h.writing.createChildNode.mock.calls[0][0], '「+ 子级」没有把卷 id 当 parentId 传下去').toBe('v1');
  });

  it('根上的章（parent_id=NULL）不缩进 —— 数据是平的就不该假装有层级', () => {
    h.writing.chapters = [chapter('c9', '章 9', '章', null)];
    mount(<StorylinePane accent="#4A338F" chapters={h.writing.chapters} outlines={[]} settings={[]} />);
    const row = rowOf('章 9');
    expect(row!.style.padding).toBe('3px 4px 3px 8px');
  });
});
