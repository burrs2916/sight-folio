// AI 助手空态 · 当前书籍洞察摘要（T5 回归锁）
//
// 背景：/ai 全页助手空态右侧此前只有代码分析洞察（scope=activeAnalysisId），
// 与写作场景脱节。WritingBookInsights 在「有激活书籍」时替代它，展示当前书的
// 大纲评估/人物关系/续写历史，统一复用 buildBookOverview 口径（零重算）。
//
// 这条测试锁死：
// ① 无激活书籍 → 不渲染（空态回退 AiInsightsPanel 由上层处理）；
// ② 有激活书籍 → 渲染书名、大纲评估（KPI/进度/卷分布）、人物关系 chips、
//    续写历史（最近 3 章 + 相关对话数）；
// ③ 有风险预警（时间线冲突/伏笔逾期/孤立设定/校对问题）→ 渲染「风险预警」行；
// ④ 无章节正文时给出引导文案，不抛错。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { useWritingStore } from '../../store/writingStore';
import { useAgentStore } from '../../store/agentStore';
import { WritingBookInsights } from '../WritingBookInsights';
import type { WritingBook, WritingChapter, WritingSetting } from '../../services/writing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
async function mountAsync(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(ui);
  });
}

const noopLoad = () => Promise.resolve();

const book: WritingBook = {
  id: 'book_1',
  title: '星海回声',
  description: null,
  genre: '',
  medium: 'serial',
  status: 'active',
  coverColor: '#4f46e5',
  dailyGoal: 0,
  extra: '{}',
  createdAt: 1700000000,
  updatedAt: 1700002000,
};

const chapters: WritingChapter[] = [
  {
    id: 'ch_1',
    bookId: 'book_1',
    title: '第一章 启航',
    content: '<p>正文</p>',
    sortOrder: 1,
    wordCount: 1200,
    status: 'completed',
    volume: '第一卷',
    parentId: null,
    kind: 'chapter',
    storylineId: null,
    extra: '{}',
    createdAt: 1700000000,
    updatedAt: 1700000000,
  },
  {
    id: 'ch_2',
    bookId: 'book_1',
    title: '第二章 暗流',
    content: '<p>正文</p>',
    sortOrder: 2,
    wordCount: 2400,
    status: 'draft',
    volume: '第一卷',
    parentId: null,
    kind: 'chapter',
    storylineId: null,
    extra: '{}',
    createdAt: 1700000100,
    updatedAt: 1700001000,
  },
  {
    id: 'ch_3',
    bookId: 'book_1',
    title: '第三章 异乡',
    content: '',
    sortOrder: 3,
    wordCount: 0,
    status: 'draft',
    volume: '第二卷',
    parentId: null,
    kind: 'chapter',
    storylineId: null,
    extra: '{}',
    createdAt: 1700000200,
    updatedAt: 1700000300,
  },
];

const setting = (over: Partial<WritingSetting>): WritingSetting => ({
  id: 's_1',
  bookId: 'book_1',
  kind: 'character',
  name: '林澈',
  subtitle: '主角',
  description: '前哨站工程师',
  extra: JSON.stringify({
    profile: { appearance: '', personality: '', motivation: '', catchphrase: '' },
    relations: [
      { targetId: 's_2', type: '敌对' },
      { targetId: 's_3', type: '导师' },
    ],
  }),
  sortOrder: 1,
  createdAt: 1700000000,
  updatedAt: 1700000000,
  ...over,
});

function seedStore(patch: {
  activeBookId?: string | null;
  books?: WritingBook[];
  chapters?: WritingChapter[];
  settings?: WritingSetting[];
  outlines?: unknown[];
  timelineEvents?: unknown[];
  storylines?: unknown[];
  foreshadowings?: unknown[];
  conversations?: { id: string; title: string }[];
}) {
  useWritingStore.setState({
    books: patch.books ?? [],
    chapters: patch.chapters ?? [],
    settings: patch.settings ?? [],
    outlines: patch.outlines ?? [],
    timelineEvents: patch.timelineEvents ?? [],
    storylines: patch.storylines ?? [],
    foreshadowings: patch.foreshadowings ?? [],
    activeBookId: patch.activeBookId ?? null,
    activeChapterId: null,
    booksLoading: false,
    chaptersLoading: false,
    settingsLoading: false,
    outlinesLoading: false,
    timelineLoading: false,
    storylineLoading: false,
    foreshadowingLoading: false,
    loadBooks: vi.fn(noopLoad),
    loadChapters: vi.fn(noopLoad),
    loadSettings: vi.fn(noopLoad),
    loadOutlines: vi.fn(noopLoad),
    loadTimelineEvents: vi.fn(noopLoad),
    loadStorylines: vi.fn(noopLoad),
    loadForeshadowings: vi.fn(noopLoad),
  } as never);
  useAgentStore.setState({
    conversations: (patch.conversations ?? []) as never,
  } as never);
}

function leafTexts(): string[] {
  return Array.from(document.body.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0)
    .map((e) => (e.textContent ?? '').trim());
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

describe('AI 助手空态 · 当前书籍洞察摘要（T5 回归锁）', () => {
  it('无激活书籍时返回 null（不渲染任何内容）', async () => {
    seedStore({});
    await mountAsync(<WritingBookInsights />);
    expect(document.body.textContent ?? '').toBe('');
  });

  it('有激活书籍时渲染书名与三个区块（大纲/人物/续写）', async () => {
    seedStore({
      activeBookId: 'book_1',
      books: [book],
      chapters,
      settings: [setting({}), setting({ id: 's_2', name: '秦朗', kind: 'character' })],
      conversations: [
        { id: 'c_1', title: '新建对话 · 星海回声 › 第一章 启航' },
        { id: 'c_2', title: '写代码' },
      ],
    });
    await mountAsync(<WritingBookInsights />);

    const texts = leafTexts();
    // 书名 + 三个区块标题
    expect(texts).toContain('星海回声');
    expect(texts).toContain('大纲评估');
    expect(texts).toContain('人物关系');
    expect(texts).toContain('续写历史');
    // 大纲 KPI：章节数 / 总字数 / 进度
    expect(texts).toContain('章节数');
    expect(texts).toContain('总字数');
    expect(texts).toContain('3,600');
    expect(texts).toContain('完稿 1/3 章');
    // 人物：角色 chip
    expect(texts).toContain('林澈');
    expect(texts).toContain('秦朗');
    // 续写历史：最近更新章节（ch_2 时间最新，靠前）+ 相关对话数
    expect(
      texts.some((x) => x.includes('第二章 暗流')),
      '应展示最近更新章节',
    ).toBe(true);
    expect(document.body.textContent ?? '').toContain('1 个相关对话');
  });

  it('有风险预警（时间线冲突/校对问题）时渲染预警行', async () => {
    seedStore({
      activeBookId: 'book_1',
      books: [book],
      chapters,
      settings: [],
      // 同轨冲突：同 settingId（null=全书轨）下两个事件 at 相同
      timelineEvents: [
        {
          id: 't1',
          bookId: 'book_1',
          settingId: null,
          at: '第1天',
          event: '太空站爆炸',
          chapterId: 'ch_1',
          storylineId: null,
          outlineId: null,
          sortOrder: 1,
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 't2',
          bookId: 'book_1',
          settingId: null,
          at: '第1天',
          event: '林澈颁奖',
          chapterId: 'ch_2',
          storylineId: null,
          outlineId: null,
          sortOrder: 2,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      storylines: [],
      foreshadowings: [],
      outlines: [],
    });
    await mountAsync(<WritingBookInsights />);

    expect(document.body.textContent ?? '').toContain('风险预警');
  });

  it('无章节正文时给出引导文案', async () => {
    seedStore({
      activeBookId: 'book_1',
      books: [book],
      chapters: [],
      settings: [setting({})],
    });
    await mountAsync(<WritingBookInsights />);
    const texts = leafTexts();
    expect(texts.some((x) => x.includes('还没有章节内容'))).toBe(true);
  });
});
