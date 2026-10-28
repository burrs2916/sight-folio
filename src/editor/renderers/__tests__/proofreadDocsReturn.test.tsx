// 正文容器「返回校对」入口 + 跳转锚点下传（T3 链路②回归锁）
//
// 契约（写死，防回归）：
//   ① proofreadReturnCtx 非空（= 由校对页签跳转而来）→ 页签栏渲染「← 返回校对」按钮；
//      点击 → openTypedCarrierView(genre,'proofread') 切回校对页签；
//   ② proofreadReturnCtx 为空 → 不渲染返回按钮（不影响既有写作台入口）；
//   ③ proofreadJumpAnchor.chapterId === 当前激活页签章 → WritingChapterEditor
//      收到 jumpAnchor=具体锚点；不匹配 → 收 null（锚点是「章级」的，不跨章误滚）；
//   ④ 编辑器消费锚点（onJumpAnchorConsumed）→ setProofreadJumpAnchor(null) 清空，
//      防二次跳同章同锚点被去重吞掉。
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
    proofreadReturnCtx: null as { group: string; sev: string; sort: string; scrollTop: number } | null,
    proofreadJumpAnchor: null as { chapterId: string; anchor: string } | null,
    setProofreadJumpAnchor: vi.fn(),
  },
  openTypedCarrierView: vi.fn(),
  openWritingDesk: vi.fn(),
  loggerWarn: vi.fn(),
  // 捕获子组件收到的 chapterId / jumpAnchor（存储联动是否传到正文）
  captured: { editor: null as string | null, overview: null as string | null, jumpAnchor: null as string | null },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.editor), {
    getState: () => h.editor,
  }),
}));
vi.mock('../../../utils/logger', () => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() };
  return { logger, default: logger };
});
vi.mock('../../../utils/writingDeskWindow', () => ({
  openWritingDesk: h.openWritingDesk,
}));
vi.mock('../../../utils/studioBook', () => ({
  openTypedCarrierView: h.openTypedCarrierView,
}));
vi.mock('../WritingChapterEditor', () => ({
  WritingChapterEditor: (props: {
    chapterId: string;
    jumpAnchor?: string | null;
    onJumpAnchorConsumed?: () => void;
  }) => {
    h.captured.editor = props.chapterId;
    h.captured.jumpAnchor = props.jumpAnchor ?? null;
    // 模拟编辑器定位语义：仅收到有效锚点才执行定位并消费（jumpAnchor=null 不消费）
    if (props.jumpAnchor) props.onJumpAnchorConsumed?.();
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
  h.editor.proofreadReturnCtx = null;
  h.editor.proofreadJumpAnchor = null;
  h.captured.editor = null;
  h.captured.overview = null;
  h.captured.jumpAnchor = null;
  useWritingDocsStore.setState({ tabs: {}, activeTab: {}, activeChapterByBook: {} });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host = null;
  document.body.innerHTML = '';
  useWritingDocsStore.setState({ tabs: {}, activeTab: {}, activeChapterByBook: {} });
});

const DOC_PROPS = {
  config: { filePath: 'writing://b1/' },
  componentId: 'doc-1',
  mode: 'edit' as const,
};

const chapter = (id: string, title: string, parentId: string | null = null, sortOrder = 0) => ({
  id,
  bookId: 'b1',
  title,
  content: '',
  sortOrder,
  wordCount: 0,
  status: 'draft',
  volume: '',
  parentId,
  kind: '章',
  createdAt: 0,
  updatedAt: 0,
});

describe('正文页签栏 · 返回校对入口与跳转锚点下传（T3 链路②）', () => {
  it('从校对跳转而来（proofreadReturnCtx 非空）：渲染返回按钮，点击切回校对页签', () => {
    h.writing.chapters = [chapter('c1', '第一章')];
    h.editor.proofreadReturnCtx = { group: 'chapter-text', sev: 'all', sort: 'default', scrollTop: 0 };
    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    // 首开会话恢复：第一章自动激活
    expect(h.captured.editor).toBe('c1');

    const btn = [...(host!.querySelectorAll('span') ?? [])].find((s) => (s.textContent ?? '').trim() === '← 返回校对');
    expect(btn, '应有「返回校对」按钮').toBeTruthy();
    expect(btn!.getAttribute('title')).toBe('返回校对');
    act(() => {
      btn!.click();
    });
    // genre 取自书籍（books[0].genre='novel'），切回校对页签
    expect(h.openTypedCarrierView).toHaveBeenCalledWith('novel', 'proofread');
  });

  it('非校对跳转（proofreadReturnCtx 为空）：不渲染返回按钮，锚点透明下传 null', () => {
    h.writing.chapters = [chapter('c1', '第一章')];
    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    const btn = [...(host!.querySelectorAll('span') ?? [])].find((s) => (s.textContent ?? '').trim() === '← 返回校对');
    expect(btn, '无返回上下文时不应渲染返回按钮').toBeFalsy();
    expect(h.openTypedCarrierView).not.toHaveBeenCalled();
    expect(h.captured.jumpAnchor).toBeNull();
  });

  it('跳转锚点章与激活章匹配：WritingChapterEditor 收到具体锚点', () => {
    h.writing.chapters = [chapter('c1', '第一章')];
    // 校对点行 → 锚点针对 c1；首开会话恢复激活的正是 c1
    h.editor.proofreadJumpAnchor = { chapterId: 'c1', anchor: '。。' };
    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    expect(h.captured.editor).toBe('c1');
    expect(h.captured.jumpAnchor).toBe('。。');
    // 编辑器消费锚点 → 立即清空（防二次跳同章同锚点被去重吞掉）
    expect(h.editor.setProofreadJumpAnchor).toHaveBeenCalledWith(null);
  });

  it('跳转锚点章与激活章不匹配：锚点不下传（章级锚点不跨章误滚）', () => {
    h.writing.chapters = [chapter('c1', '第一章'), chapter('c2', '第二章')];
    // 首开会话自动激活第一章 c1；锚点针对 c2 —— 不应下传
    h.editor.proofreadJumpAnchor = { chapterId: 'c2', anchor: '。。' };
    mount(<WritingDocsRenderer {...DOC_PROPS} />);

    expect(h.captured.editor).toBe('c1');
    expect(h.captured.jumpAnchor).toBeNull();
    expect(h.editor.setProofreadJumpAnchor).not.toHaveBeenCalled();
  });
});
