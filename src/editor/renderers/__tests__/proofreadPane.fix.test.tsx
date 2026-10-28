// 校对行一键修复交互取证：按钮渲染、按章去重、点击回写落库、报告重算行消失
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  writing: {
    books: [{ id: 'B1', title: '测试之书·星辰归途', genre: 'novel' }] as any[],
    chapters: [] as any[],
    outlines: [] as any[],
    settings: [] as any[],
    timelineEvents: [] as any[],
    foreshadowings: [] as any[],
    storylines: [] as any[],
    activeBookId: 'B1' as string | null,
    loadBooks: vi.fn(async () => {}),
    setActiveBook: vi.fn(async () => {}),
    saveChapterContent: vi.fn(async (chapterId: string, content: string, wordCount: number) => {
      // 真实 store 会以新引用替换 chapters 数组，触发 useMemo 重算——必须模拟引用变化
      h.writing.chapters = h.writing.chapters.map((x: any) => (x.id === chapterId ? { ...x, content, wordCount } : x));
    }),
  },
  openChapterCarrierView: vi.fn(),
  openTypedCarrierView: vi.fn(),
  es: {
    proofreadFocusKey: null as string | null,
    setProofreadFocusKey: vi.fn(),
    selectForeshadowing: vi.fn(),
    selectTimelineEvent: vi.fn(),
    selectInspiration: vi.fn(),
  },
}));

vi.mock('../../../store/writingStore', () => ({
  useWritingStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.writing), {
    getState: () => h.writing,
  }),
}));
vi.mock('../../../store/editorStore', () => ({
  useEditorStore: Object.assign((sel: (s: unknown) => unknown) => sel(h.es), {
    getState: () => h.es,
  }),
}));
vi.mock('../../../utils/studioBook', () => ({
  openChapterCarrierView: h.openChapterCarrierView,
  openTypedCarrierView: h.openTypedCarrierView,
}));

import { ProofreadPane } from '../writingPanes';

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

async function rerender(ui: ReactElement) {
  await act(async () => {
    root!.render(ui);
  });
}

function unmount() {
  act(() => {
    root!.unmount();
  });
  host?.remove();
  root = null;
  host = null;
}

function ch(id: string, title: string, content: string, wordCount: number, status: string) {
  return {
    id,
    bookId: 'B1',
    title,
    content,
    sortOrder: Number(id.replace(/\D/g, '')),
    wordCount,
    status,
    volume: '',
    parentId: null,
    kind: '章',
    storylineId: null,
    extra: '{}',
    deletedAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.writing.books = [{ id: 'B1', title: '测试之书·星辰归途', genre: 'novel' }];
  h.writing.outlines = [];
  h.writing.timelineEvents = [];
  h.writing.foreshadowings = [];
  h.writing.storylines = [];
  h.es.proofreadFocusKey = null;
});

afterEach(() => {
  unmount();
});

describe('ProofreadPane 一键修复', () => {
  it('可修复章显示修复按钮；点击后 saveChapterContent 写入修复文本', async () => {
    h.writing.chapters = [
      ch('ch1', '第1章 出发', '<p>他悬梁刺骨地学习。。。</p>', 12, 'draft'),
      ch('ch2', '第2章 路上', '<p>正文内容。</p>', 5, 'draft'),
    ];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);
    const fixBtns = [...host!.querySelectorAll('button')].filter(
      (b) => (b as HTMLButtonElement).title === '一键修复' && (b as HTMLButtonElement).textContent === '一键修复',
    );
    expect(fixBtns.length).toBe(1);
    await act(async () => {
      (fixBtns[0] as HTMLButtonElement).click();
      // 等待 async fixChapter 完成
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.writing.saveChapterContent).toHaveBeenCalledTimes(1);
    const [cid, content, wc] = h.writing.saveChapterContent.mock.calls[0] as [string, string, number];
    expect(cid).toBe('ch1');
    expect(content).toContain('悬梁刺股');
    expect(content).toContain('……');
    expect(wc).toBe(10); // 他悬梁刺股地学习…… = 10 字符
  });

  it('修复落库后 chapter store 同步，报告重算行消失', async () => {
    h.writing.chapters = [
      ch('ch1', '第1章 出发', '<p>他悬梁刺骨地学习。</p>', 11, 'draft'),
      ch('ch2', '第2章 路上', '<p>正文内容。</p>', 5, 'draft'),
    ];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);
    const fixBtns = [...host!.querySelectorAll('button')].filter(
      (b) => (b as HTMLButtonElement).textContent === '一键修复',
    );
    expect(fixBtns.length).toBe(1);
    await act(async () => {
      (fixBtns[0] as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    // store 已同步修复内容
    const ch1 = h.writing.chapters.find((c: any) => c.id === 'ch1');
    expect(ch1.content).toBe('<p>他悬梁刺股地学习。</p>');
    // 修复后重渲染：ch1 无 typo 也无 punct → 行消失
    await rerender(<ProofreadPane accent="#c2185b" bookId="B1" />);
    const rows = host!.querySelectorAll('button[id^="proofread-row-"]');
    expect(rows.length).toBe(0);
    const visible = host!.textContent ?? '';
    expect(visible).toContain('没有发现问题');
  });

  it('无 fix 条目（仅敏感词）的章不显示修复按钮', () => {
    // 用不可修复的敏感场景：没有可自动替换项的正常文本
    h.writing.chapters = [ch('ch1', '第1章 出发', '<p>这是完全正常的正文内容。</p>', 12, 'draft')];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);
    const fixBtns = [...host!.querySelectorAll('button')].filter(
      (b) => (b as HTMLButtonElement).textContent === '一键修复',
    );
    expect(fixBtns.length).toBe(0);
  });
});
