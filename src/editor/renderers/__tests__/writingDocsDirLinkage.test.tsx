// 正文页签「章节目录」点选联动回归锁（2026-09-28）
//
// 事故续报：目录树层级已修（writingDocsDirTree.test.tsx），但用户在真实应用中
// 点选目录行后正文/页签没有切换——快照里正文仍停在「章 1」。
// dirTree 测试把 writingDocsStore 整体 mock 掉（openTab: vi.fn()），只证明
// 「行点击 → openTab 被调用」，不覆盖「openTab → 页签激活 → 正文/右栏联动」。
// 本文件用**真实 writingDocsStore**（仅 mock writingStore/编辑器子组件），
// 锁住完整链路：点目录行 → store.tabs/activeTab 变化 → WritingChapterEditor
// 与 ChapterOverviewPanel 收到新 chapterId。
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
    storylines: [] as any[],
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    loadBooks: vi.fn(async () => {}),
    setActiveBook: vi.fn(async () => {}),
    createChapter: vi.fn(async () => null),
    createOutline: vi.fn(async () => null),
    updateOutline: vi.fn(async () => {}),
    deleteOutline: vi.fn(async () => {}),
    createSetting: vi.fn(async () => null),
    updateSetting: vi.fn(async () => {}),
    deleteSetting: vi.fn(async () => {}),
    createTimelineEvent: vi.fn(async () => null),
    setChapterCover: vi.fn(async () => {}),
    saveChapterContent: vi.fn(async () => {}),
  },
  editor: {
    views: [] as any[],
    activeViewId: 'v1',
    previewMode: false,
  },
  openWritingDesk: vi.fn(),
  loggerWarn: vi.fn(),
  // 捕获子组件收到的 chapterId（真实 store 联动是否传到正文/右栏）
  captured: { editor: null as string | null, overview: null as string | null },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../utils/logger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() };
  return { logger, default: logger };
});
vi.mock('../../../utils/writingDeskWindow', () => ({
  openWritingDesk: h.openWritingDesk,
}));
vi.mock('../WritingChapterEditor', () => ({
  WritingChapterEditor: (props: { chapterId: string }) => {
    h.captured.editor = props.chapterId;
    return null;
  },
  COLOR_CHAPTER: '#8b5cf6',
  SAVE_DEBOUNCE_MS: 800,
}));
vi.mock('../../panels/ChapterOverviewPanel', () => ({
  ChapterOverviewPanel: (props: { chapterId: string | null }) => {
    h.captured.overview = props.chapterId;
    return null;
  },
}));

// 真实 store（zustand），不 mock —— 这是本测试与 dirTree 测试的本质区别
import { useWritingDocsStore } from '../../../store/writingDocsStore';
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

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.activeBookId = 'b1';
  h.writing.books = [{ id: 'b1', title: '长夜', genre: 'novel' }];
  h.captured.editor = null;
  h.captured.overview = null;
  useWritingDocsStore.setState({ tabs: {}, activeTab: {}, activeChapterByBook: {} });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  useWritingDocsStore.setState({ tabs: {}, activeTab: {}, activeChapterByBook: {} });
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

const DOC_PROPS = {
  config: { filePath: 'writing://b1/' },
  componentId: 'doc-1',
  mode: 'edit' as const,
};

function openDir() {
  const btn = Array.from(document.body.querySelectorAll<HTMLElement>('span')).find(
    (s) => (s.textContent ?? '').trim() === '☰',
  );
  expect(btn, '☰ 章节目录按钮未渲染').toBeTruthy();
  act(() => {
    btn!.click();
  });
}

function dirRow(id: string): HTMLElement | null {
  const row = document.body.querySelector<HTMLElement>(`[data-testid="dir-row-${id}"]`);
  if (!row) return null;
  return row.querySelector<HTMLElement>('span[title]');
}

describe('正文页签 · 章节目录点选联动（真实 store）', () => {
  it('点目录行：store 新建/激活页签，正文与右栏收到新章', () => {
    h.writing.chapters = [chapter('c1', '第一章', '章', null, 0), chapter('c2', '第二章', '章', null, 1)];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    // 首开会话恢复：无页签 → 自动打开第一章
    expect(useWritingDocsStore.getState().tabs['doc-1']?.length ?? 0).toBe(1);
    const firstTab = useWritingDocsStore.getState().tabs['doc-1']![0];
    expect(firstTab.chapterId).toBe('c1');
    expect(h.captured.editor).toBe('c1');

    // 打开目录，点「第二章」
    openDir();
    act(() => {
      dirRow('c2')!.click();
    });

    // ① store 端：第二章页签已被激活（同章去重，共 2 个页签）
    const s = useWritingDocsStore.getState();
    expect(s.tabs['doc-1']!.length).toBe(2);
    const activeTab = s.tabs['doc-1']!.find((tb) => tb.chapterId === 'c2')!;
    expect(s.activeTab['doc-1']).toBe(activeTab.tabId);
    // ② UI 端：正文编辑器与右栏章面板都收到新章
    expect(h.captured.editor).toBe('c2');
    expect(h.captured.overview).toBe('c2');
  });

  it('点目录行：目标章已开页签（多开）时仅切换激活，正文跟随', () => {
    h.writing.chapters = [chapter('c1', '第一章', '章', null, 0), chapter('c2', '第二章', '章', null, 1)];
    // 预置：两章都已开页签，当前激活第一章
    useWritingDocsStore.getState().openTab('doc-1', 'c1', '第一章');
    useWritingDocsStore.getState().openTab('doc-1', 'c2', '第二章');
    useWritingDocsStore.getState().setActive('doc-1', useWritingDocsStore.getState().tabs['doc-1']![0].tabId);

    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    openDir();
    act(() => {
      dirRow('c2')!.click();
    });

    const s = useWritingDocsStore.getState();
    expect(s.tabs['doc-1']!.length, '同章去重：不应新建第三个页签').toBe(2);
    const c2Tab = s.tabs['doc-1']!.find((tb) => tb.chapterId === 'c2')!;
    expect(s.activeTab['doc-1']).toBe(c2Tab.tabId);
    expect(h.captured.editor).toBe('c2');
    expect(h.captured.overview).toBe('c2');
  });

  it('点当前激活章的目录行：不收起目录、显示「当前」徽标（点过的反馈）', () => {
    h.writing.chapters = [chapter('c1', '第一章', '章', null, 0), chapter('c2', '第二章', '章', null, 1)];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    // 首开会话恢复：当前激活 c1
    expect(useWritingDocsStore.getState().tabs['doc-1']?.[0]?.chapterId).toBe('c1');

    openDir();
    // 激活行渲染「当前」徽标
    const rowSpan = dirRow('c1');
    expect(rowSpan).toBeTruthy();
    const badge = [...(rowSpan?.querySelectorAll('span') ?? [])].find((s) => (s.textContent ?? '').trim() === '当前');
    expect(badge, '当前激活章行应渲染「当前」徽标').toBeTruthy();

    act(() => {
      rowSpan!.click();
    });

    // ① store 零变化：不新建页签、激活不变
    const s = useWritingDocsStore.getState();
    expect(s.tabs['doc-1']!.length).toBe(1);
    expect(s.activeTab['doc-1']).toBe(s.tabs['doc-1']![0].tabId);
    expect(h.captured.editor).toBe('c1');
    expect(h.captured.overview).toBe('c1');
    // ② 目录保持打开（下拉面板仍在 DOM），让「点当前章」有可见反馈
    const panelInput = document.body.querySelector<HTMLInputElement>('input[placeholder]');
    expect(panelInput, '点当前章后目录不应收起').toBeTruthy();
    // ③ 再点非当前章：正常切换并收起（原语义不受影响）
    act(() => {
      dirRow('c2')!.click();
    });
    expect(useWritingDocsStore.getState().activeTab['doc-1']).toBe(
      useWritingDocsStore.getState().tabs['doc-1']!.find((tb) => tb.chapterId === 'c2')!.tabId,
    );
    expect(h.captured.editor).toBe('c2');
    expect(document.body.querySelector('input[placeholder]'), '点其他章后目录应收起').toBeFalsy();
  });
});
