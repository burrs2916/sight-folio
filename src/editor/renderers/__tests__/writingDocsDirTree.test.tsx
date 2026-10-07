// 正文页签「章节目录」（☰）树形下拉回归锁（2026-09-28）
//
// 事故：用户指出正文 tabs 里「选择文字的目录和章节」层级不对——子节点没有挂在父节点下。
// 取证根因：WritingDocsRenderer 的 dirRows 只按 sortOrder 平铺、按旧字段 volume 分组渲染，
// 从未用 parentId 建树，而数据模型早已是 parentId + kind 树（见 services/writing.ts）。
// 修法：dirRows 改为 utils/writingTree.buildTree 树形 + treeRowIndent 深度缩进（与左栏目录树/
// 写作台章节树同一口径），仅旧模型书（全书无 parentId）保留 volume 分组头（对齐 ChapterTreePanel
// 的 legacyOnly 逻辑，旧书外观与改动前逐字一致）。
// 这份测试锁的是目录下拉的渲染契约：
//   ① 卷（depth 0）行 padding-left = 8px、章（depth 1）= 28px、节（depth 2）= 48px
//   ② 子章节紧随父章节渲染（不会因 sortOrder 交错被平铺到别的卷下）
//   ③ 旧模型书（无 parentId）保留 volume 分组头、行不缩进
//   ④ 搜索命中子章节时保留其祖先链（父级仍可见、缩进不塌）
//   ⑤ 点选目录行 → openTab(componentId, chapterId, title)
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
    loadBooks: vi.fn(async () => {}),
    setActiveBook: vi.fn(async () => {}),
    createChapter: vi.fn(async () => null),
    createChildNode: vi.fn(async () => null),
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
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
  docs: {
    tabs: {} as Record<string, any[]>,
    activeTab: {} as Record<string, string>,
    openTab: vi.fn(),
    closeTab: vi.fn(),
    closeTo: vi.fn(),
    setActive: vi.fn(),
    setActiveChapterForBook: vi.fn(),
  },
  openWritingDesk: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/writingDocsStore', () => ({
  useWritingDocsStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.docs), {
    getState: () => h.docs,
  }),
}));
vi.mock('../../../utils/logger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() };
  return { logger, default: logger };
});
vi.mock('../../../utils/writingDeskWindow', () => ({
  openWritingDesk: h.openWritingDesk,
}));
// 正文编辑器与章统筹面板是重组件；本测试只观测目录下拉，activeEntry 恒空（mock openTab
// 不真正写 tabs），正文区走空态分支不渲染它们 —— mock 成无渲染占位防模块副作用。
vi.mock('../WritingChapterEditor', () => ({
  WritingChapterEditor: () => null,
  COLOR_CHAPTER: '#8b5cf6',
  SAVE_DEBOUNCE_MS: 800,
}));
vi.mock('../../panels/ChapterOverviewPanel', () => ({
  ChapterOverviewPanel: () => null,
}));

import { WritingDocsRenderer } from '../WritingDocsRenderer';

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

const chapter = (id: string, title: string, kind: string, parentId: string | null, sortOrder = 0, volume = '') => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder,
  wordCount: 0,
  status: 'draft',
  volume,
  parentId,
  kind,
  createdAt: 0,
  updatedAt: 0,
});

const DOC_PROPS = {
  config: { filePath: 'writing://b1/' },
  componentId: 'doc-1',
  mode: 'edit' as const,
};

/** 点 ☰ 按钮打开目录下拉（title 文案随语言变，按符号定位最稳） */
function openDir() {
  const btn = Array.from(document.body.querySelectorAll<HTMLElement>('span')).find(
    (s) => (s.textContent ?? '').trim() === '☰',
  );
  expect(btn, '☰ 章节目录按钮未渲染').toBeTruthy();
  act(() => {
    btn!.click();
  });
}

/** 找目录行（data-testid="dir-row-{id}"）里带 title 的行 span（paddingLeft 就在这层；
 *  volume 分组头 span 无 title，天然排除） */
function dirRow(id: string): HTMLElement | null {
  const row = document.body.querySelector<HTMLElement>(`[data-testid="dir-row-${id}"]`);
  if (!row) return null;
  return row.querySelector<HTMLElement>('span[title]');
}

/** 目录下拉内所有行标题（按 DOM 顺序） */
function dirRowTitles(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid^="dir-row-"]'))
    .map((row) => row.querySelector<HTMLElement>('span[title]')?.getAttribute('title') ?? '')
    .filter((t) => t !== '');
}

/** 目录下拉内所有 volume 分组头文本（按 DOM 顺序） */
function dirVolumeHeaders(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid^="dir-volume-"]')).map(
    (s) => s.textContent ?? '',
  );
}

describe('正文页签 · 章节目录树形下拉（回归锁）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.writing.activeBookId = 'b1';
    h.writing.books = [{ id: 'b1', title: '长夜', genre: 'novel' }];
    h.writing.chapters = [];
    h.docs.tabs = {};
    h.docs.activeTab = {};
  });

  it('卷→章→节 三级树：子章节缩进挂在父章节下（8/28/48px）', () => {
    h.writing.chapters = [
      chapter('v1', '卷一', '卷', null, 0),
      chapter('c1', '第一章', '章', 'v1', 1),
      chapter('s1', '第一节', '节', 'c1', 1),
    ];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    expect(dirRow('v1')!.style.paddingLeft, '卷（depth 0）应保持基准缩进').toBe('8px');
    expect(dirRow('c1')!.style.paddingLeft, '章（depth 1）应缩进一格 = 28px').toBe('28px');
    expect(dirRow('s1')!.style.paddingLeft, '节（depth 2）应缩进两格 = 48px').toBe('48px');
  });

  it('子章节紧随父章节渲染：sortOrder 交错也不会被平铺到别的卷下', () => {
    // 平铺按 sortOrder 会得到 卷A→卷B→第二卷章→第一卷章（错挂）；
    // 树形应为 卷A→第一卷章→卷B→第二卷章（第二章始终在卷B 下）。
    h.writing.chapters = [
      chapter('va', '卷A', '卷', null, 0),
      chapter('ca', '第一卷章', '章', 'va', 3),
      chapter('vb', '卷B', '卷', null, 1),
      chapter('cb', '第二卷章', '章', 'vb', 1),
    ];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    expect(dirRowTitles(), '树形先序应保持 卷A→子章→卷B→子章，子节点不跨卷错挂').toEqual([
      '卷A',
      '第一卷章',
      '卷B',
      '第二卷章',
    ]);
    expect(dirRow('ca')!.style.paddingLeft).toBe('28px');
    expect(dirRow('cb')!.style.paddingLeft).toBe('28px');
  });

  it('根上的章（parentId 为空）不缩进 —— 数据是平的就不该假装有层级', () => {
    h.writing.chapters = [chapter('c9', '章九', '章', null, 0)];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    expect(dirRow('c9')!.style.paddingLeft).toBe('8px');
  });

  it('旧模型书（全书无 parentId）：保留 volume 分组头、行不缩进（外观与改动前一致）', () => {
    h.writing.chapters = [
      chapter('c1', '第一册·章1', '章', null, 0, '第一册'),
      chapter('c2', '第二册·章1', '章', null, 1, '第二册'),
    ];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    expect(dirVolumeHeaders(), '旧模型书应渲染 volume 分组头').toEqual(['第一册', '第二册']);
    expect(dirRow('c1')!.style.paddingLeft, '旧模型书根行不缩进').toBe('8px');
    expect(dirRow('c2')!.style.paddingLeft).toBe('8px');
  });

  it('搜索命中子章节 → 保留祖先链（父级仍可见、缩进不塌），无关卷隐藏', () => {
    h.writing.chapters = [
      chapter('v1', '卷一', '卷', null, 0),
      chapter('c1', '第一章', '章', 'v1', 1),
      chapter('s1', '第一节', '节', 'c1', 1),
      chapter('v2', '卷二', '卷', null, 1),
      chapter('c2', '第九章', '章', 'v2', 1),
    ];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    const input = document.body.querySelector<HTMLInputElement>('input');
    expect(input, '目录搜索框未渲染').toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '第一节');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(dirRowTitles(), '命中节的祖先链（卷一→第一章→第一节）保留，无关卷隐藏').toEqual([
      '卷一',
      '第一章',
      '第一节',
    ]);
    expect(dirRow('c1')!.style.paddingLeft).toBe('28px');
    expect(dirRow('s1')!.style.paddingLeft).toBe('48px');
  });

  it('点选目录行 → openTab(componentId, chapterId, title) 打开正文页签', () => {
    h.writing.chapters = [chapter('v1', '卷一', '卷', null, 0), chapter('c1', '第一章', '章', 'v1', 1)];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    openDir();

    act(() => {
      dirRow('c1')!.click();
    });

    // 启动 effect 会先自动打开第一章（v1），点击章行后应再以 c1 打开页签
    expect(h.docs.openTab.mock.calls).toContainEqual(['doc-1', 'c1', '第一章']);
    expect(h.docs.openTab).toHaveBeenCalledTimes(2);
  });
});
