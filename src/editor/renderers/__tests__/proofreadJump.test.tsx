// T4·链路①③：校对行定位跳转 + 返回恢复浏览态（组件级契约锁）
//
// ① 文本类聚合行（带 locator 锚点）点即跳：保存返回上下文（组/过滤/排序/滚动位置）
//    → 写入跳转锚点（editorStore）→ openChapterCarrierView 打开正文容器章页签；
//    无锚点的聚合行（结构类，如连续空行）只跳章、不写锚点；
// ③ 从正文容器「返回校对」切回时：activeGroup/sevFilter/sortMode 从返回上下文
//    恢复（useState 初值）、列表滚动位置恢复（80ms 后回写）、消费后立即清空防重复。
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
    saveChapterContent: vi.fn(async () => {}),
  },
  openChapterCarrierView: vi.fn(),
  openTypedCarrierView: vi.fn(),
  es: {
    proofreadFocusKey: null as string | null,
    setProofreadFocusKey: vi.fn(),
    proofreadReturnCtx: null as {
      group: string;
      sev: string;
      sort: string;
      scrollTop: number;
    } | null,
    // 模拟真实 store 行为：设置值并回写源对象（消费清空可观察到）
    setProofreadReturnCtx: vi.fn((v: unknown) => {
      h.es.proofreadReturnCtx = (v ?? null) as never;
    }) as unknown as (v: unknown) => void,
    proofreadJumpAnchor: null as { chapterId: string; anchor: string } | null,
    setProofreadJumpAnchor: vi.fn(),
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
  h.es.proofreadReturnCtx = null;
  h.es.proofreadJumpAnchor = null;
});

afterEach(() => {
  unmount();
});

describe('链路①：校对行定位跳转', () => {
  it('文本类聚合行（带锚点）：保存返回上下文 + 写入跳转锚点 + 打开章页签', () => {
    // 重复标点「。。」是文本类检查，chapterTextIssues 携带首个命中片段作锚点
    h.writing.chapters = [ch('ch1', '第1章 出发', '<p>他说好。。然后走了。</p>', 11, 'draft')];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);

    // 找到重复标点行：行 id 为 proofread-row-<chapterId>:RepeatPunct，行内首个 button 是主跳转按钮
    const row = [...host!.querySelectorAll<HTMLDivElement>('[id^="proofread-row-"]')].find((d) =>
      d.id.includes(':RepeatPunct'),
    );
    expect(row, '重复标点聚合行应渲染').toBeTruthy();
    const jumpBtn = row!.querySelector<HTMLButtonElement>('button');
    expect(jumpBtn, '行内应有主跳转按钮').toBeTruthy();

    act(() => {
      jumpBtn!.click();
    });

    // ① 返回上下文：当前组/过滤/排序 + 滚动位置（未滚动 = 0）
    expect(h.es.setProofreadReturnCtx).toHaveBeenCalledWith({
      group: 'chapter-text',
      sev: 'all',
      sort: 'default',
      scrollTop: 0,
    });
    // ② 跳转锚点：文本类聚合行携带首个命中片段
    expect(h.es.setProofreadJumpAnchor).toHaveBeenCalledWith({ chapterId: 'ch1', anchor: '。。' });
    // ③ 打开正文容器章页签（title 取章标题，genre 取书籍 genre）
    expect(h.openChapterCarrierView).toHaveBeenCalledWith('ch1', '第1章 出发', 'novel', 'B1');
  });

  it('结构类聚合行（无锚点，连续空行）：只跳章、不写跳转锚点', () => {
    // 连续空行（BlankLines）不携带 locator —— 只打开章页签、不滚动高亮
    h.writing.chapters = [ch('ch1', '第1章 出发', '<p>第一段</p>\n\n\n<p>第二段</p>', 10, 'draft')];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);

    const row = [...host!.querySelectorAll<HTMLDivElement>('[id^="proofread-row-"]')].find((d) =>
      d.id.includes(':BlankLines'),
    );
    expect(row, '连续空行聚合行应渲染').toBeTruthy();
    const jumpBtn = row!.querySelector<HTMLButtonElement>('button');
    act(() => {
      jumpBtn!.click();
    });

    expect(h.es.setProofreadJumpAnchor).not.toHaveBeenCalled();
    expect(h.openChapterCarrierView).toHaveBeenCalledWith('ch1', '第1章 出发', 'novel', 'B1');
  });
});

describe('链路③：返回后恢复浏览态并消费清空', () => {
  it('恢复 组/严重性过滤/排序 与列表滚动位置，消费后清空返回上下文', async () => {
    h.writing.chapters = [ch('ch1', '第1章 出发', '<p>他说好。。然后走了。</p>', 11, 'draft')];
    // 模拟「跳正文前写入返回上下文」：组=伏笔（非默认）、过滤=警告、排序=按严重性、滚动位置 120
    h.es.proofreadReturnCtx = { group: 'foreshadow', sev: 'warning', sort: 'severity', scrollTop: 120 };

    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);

    // ① 组恢复为伏笔：组导航中 active（boxShadow 含 inset 强调）的那一项
    const groupBtns = [...host!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => (b.getAttribute('title') ?? '') === '切换体检维度',
    );
    const activeGroupBtn = groupBtns.find((b) => (b.style.boxShadow ?? '').includes('inset'));
    expect(activeGroupBtn, '应有激活的组按钮').toBeTruthy();
    expect(activeGroupBtn!.textContent).toContain('伏笔');
    // ② 严重性过滤恢复为「警告」
    const filterBtns = [...host!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => (b.getAttribute('title') ?? '') === '按优先级过滤（严重=必须处理 / 警告=建议处理）',
    );
    const activeFilterBtn = filterBtns.find((b) => b.style.fontWeight === '700');
    expect(activeFilterBtn, '应有激活的过滤按钮').toBeTruthy();
    expect(activeFilterBtn!.textContent).toBe('警告');
    // ③ 排序恢复为「按严重性」
    const sortBtns = [...host!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => (b.getAttribute('title') ?? '') === '排序发现（按严重性优先推荐）',
    );
    const activeSortBtn = sortBtns.find((b) => b.style.fontWeight === '700');
    expect(activeSortBtn, '应有激活的排序按钮').toBeTruthy();
    expect(activeSortBtn!.textContent).toBe('按严重性');
    // ④ 消费清空：挂载恢复后立即清除返回上下文（防重复恢复）
    expect(h.es.proofreadReturnCtx).toBeNull();
    // ⑤ 滚动位置恢复（80ms 后回写列表容器；setProofreadReturnCtx 同步回写源对象，
    //    触发 effect 重跑 —— 回归锁：若恢复定时器挂在 effect cleanup 上会被清掉，此处必挂）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    const listEl = [...host!.querySelectorAll<HTMLDivElement>('div')].find(
      // listRef：overflowY auto + 内容区 padding（区别于左侧组导航的 overflowY auto 无 padding）
      (d) => d.style.overflowY === 'auto' && (d.style.padding ?? '') !== '',
    );
    expect(listEl, '列表滚动容器应存在').toBeTruthy();
    expect(listEl!.scrollTop).toBe(120);
  });

  it('无返回上下文时：默认组/过滤/排序，不消费、不恢复', async () => {
    h.writing.chapters = [ch('ch1', '第1章 出发', '<p>他说好。。然后走了。</p>', 11, 'draft')];
    mount(<ProofreadPane accent="#c2185b" bookId="B1" />);

    const groupBtns = [...host!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => (b.getAttribute('title') ?? '') === '切换体检维度',
    );
    const activeGroupBtn = groupBtns.find((b) => (b.style.boxShadow ?? '').includes('inset'));
    expect(activeGroupBtn!.textContent).toContain('章文本');
    expect(h.es.proofreadReturnCtx).toBeNull();
    expect(h.es.setProofreadReturnCtx).not.toHaveBeenCalled();
  });
});
