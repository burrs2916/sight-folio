// 正文页签「章节目录」点选 → **真实 WritingChapterEditor 装载** 端到端回归锁（2026-09-28）
//
// 事故续报第三层：dirLinkage 测试用真实 store + 探针子组件证明「点目录行 → 正文/右栏
// 收到新 chapterId」，但 WritingChapterEditor 被 mock，未验证真实 TipTap 编辑器是否
// 把内容真正装载到正文区、空章占位是否随新章出现/消失。本文件**不 mock
// WritingChapterEditor**（真实 useEditor + StarterKit + Placeholder + WritingImage），
// 只 mock writingStore 数据 / 底层 tauri 依赖，锁住：「点目录行 → 真实正文内容切换」。
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
    loadStorylines: vi.fn(async () => {}),
    createStoryline: vi.fn(async () => null),
    updateStoryline: vi.fn(async () => {}),
    deleteStoryline: vi.fn(async () => {}),
  },
  openWritingDesk: vi.fn(),
  loggerWarn: vi.fn(),
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
// WritingImage 依赖 tauri API/素材服务：测试只验正文装载，asset 能力保持 no-op
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (s: string) => s }));
vi.mock('../../../services/tauri', () => ({
  assetApi: {
    resolveAssetRef: async (rel: string) => rel,
    listAssets: async () => [],
    importAsAsset: async () => null,
  },
}));

// 真实 store（zustand）—— 不 mock
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
  h.writing.chapters = [
    {
      id: 'c1',
      bookId: 'b1',
      title: '章 1',
      content: '<p>第一章正文落笔</p>',
      sortOrder: 0,
      wordCount: 0,
      status: 'draft',
      volume: '',
      parentId: null,
      kind: '章',
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'c2',
      bookId: 'b1',
      title: '章 2',
      content: '<p>第二章正文登场</p>',
      sortOrder: 1,
      wordCount: 0,
      status: 'draft',
      volume: '',
      parentId: null,
      kind: '章',
      createdAt: 0,
      updatedAt: 0,
    },
  ];
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

/** 点开目录下拉并点击指定章节行（真实 DOM 事件） */
async function pickDirRow(chapterId: string) {
  const dirBtn = Array.from(host!.querySelectorAll('span[title]')).find((el) => el.textContent === '☰') as
    | HTMLElement
    | undefined;
  expect(dirBtn).toBeTruthy();
  if (!dirBtn) throw new Error('目录按钮未找到');
  act(() => {
    dirBtn.click();
  });
  const row = host!.querySelector(`[data-testid="dir-row-${chapterId}"] span[title]`) as HTMLElement;
  expect(row).toBeTruthy();
  if (!row) throw new Error(`目录行 ${chapterId} 未找到`);
  act(() => {
    row.click();
  });
  // 等待 store 更新 + 真实 TipTap 装载（editor 挂载/内容切换都在 effect 中）
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** 正文区真实渲染的文本（ProseMirror 文本层）；空章占位取 overlay 文案 */
function bodyText(): string {
  return host!.querySelector('.tiptap.ProseMirror')?.textContent ?? '';
}

describe('writingDocs 目录点选 → 真实正文装载', () => {
  it('点目录行章 2：真实编辑器把内容从章 1 切到章 2', async () => {
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    // 首开会话恢复自动打开章 1（真实 store 唯一入口）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(bodyText()).toContain('第一章正文落笔');

    await pickDirRow('c2');
    expect(bodyText()).toContain('第二章正文登场');
    expect(bodyText()).not.toContain('第一章正文落笔');
    // store 侧断言：页签确实切到 c2 且激活
    const st = useWritingDocsStore.getState();
    expect(st.tabs['doc-1'].map((t: any) => t.chapterId)).toEqual(['c1', 'c2']);
    expect(st.activeTab['doc-1']).toBe(st.tabs['doc-1'][1].tabId);
  });

  it('再点回章 1：正文回到章 1 内容（去重置语义、随时可回）', async () => {
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await pickDirRow('c2');
    expect(bodyText()).toContain('第二章正文登场');

    await pickDirRow('c1');
    expect(bodyText()).toContain('第一章正文落笔');
    expect(bodyText()).not.toContain('第二章正文登场');
  });

  it('跨窗口同步：写作台落库合并新 content 后，已打开的只读正文页自动重装新正文', async () => {
    mount(<WritingDocsRenderer {...DOC_PROPS} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(bodyText()).toContain('第一章正文落笔');

    // 模拟主窗口收到 writing-content-saved → applyExternalChapterContent：
    // h.writing.chapters 中章 1 的 content 被就地并入（独立窗口事件同步的读侧落点）
    act(() => {
      h.writing.chapters = h.writing.chapters.map((c) =>
        c.id === 'c1' ? { ...c, content: '<p>写作台新写入的正文</p>', wordCount: 9 } : c,
      );
      // 触发一次真实 store 状态变化：等价于外部同步驱动主窗口重渲染
      // （mock 的 useWritingStore 无常驻订阅，用 writingDocsStore 引用变化驱动 WEC 重读 chapters）
      const st = useWritingDocsStore.getState();
      useWritingDocsStore.setState({
        tabs: { ...st.tabs, [st.activeTab ? 'doc-1' : 'doc-1']: [...(st.tabs['doc-1'] ?? [])] },
      });
    });
    // 装载 effect 依赖 chapter 引用，重渲染后 chapters.find 返回并入后的新对象 → 重装正文
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(bodyText()).toContain('写作台新写入的正文');
    expect(bodyText()).not.toContain('第一章正文落笔');
  });
});
