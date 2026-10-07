// 跨窗口正文同步 —— store 层定点测试（2026-09-28）
//
// 事故：写作台（独立 webview/store 实例）为章 1 写了正文并落库成功，
// 但主窗口正文容器点章 1 显示「本章暂无正文」。
// 根因：写作台保存只更新了它自己窗口的 store + DB；主窗口 store 无任何
// 刷新机制，还持有写入前的旧 chapters 快照。
// 修复：saveChapterContent 落库成功后 emit WRITING_CONTENT_SAVED_EVENT；
// 每窗口 applyExternalChapterContent 把该章 content/wordCount 就地并入
// 自己 store（幂等：目标章属于当前激活书且已缓存才更新）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async () => {}),
  saveChapterContent: vi.fn(async () => {}),
  syncWritingEntityCards: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: { saveChapterContent: h.saveChapterContent, saveBook: vi.fn(async () => {}) },
  writingOutlinesApi: {},
  writingSettingsApi: {},
  writingStorylinesApi: {},
  writingForeshadowingsApi: {},
  writingTimelineApi: {},
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
}));
vi.mock('../editorStore', () => ({
  useEditorStore: {
    getState: () => ({ syncWritingEntityCards: h.syncWritingEntityCards }),
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: h.loggerWarn, error: vi.fn() },
}));

import { useWritingStore, WRITING_CONTENT_SAVED_EVENT } from '../writingStore';

const CHAPTER = {
  id: 'c1',
  bookId: 'b1',
  title: '章 1',
  content: '<p>旧正文</p>',
  sortOrder: 0,
  wordCount: 3,
  status: 'draft',
  volume: '',
  parentId: null,
  kind: '章',
  extra: '',
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useWritingStore.setState({
    books: [
      {
        id: 'b1',
        title: '长夜',
        description: null,
        genre: 'novel',
        medium: 'serial',
        status: 'active',
        coverColor: '#0e7a5f',
        dailyGoal: 0,
        extra: '{}',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeBookId: 'b1',
    chapters: [{ ...CHAPTER }],
    chaptersLoading: false,
    booksLoading: false,
  });
});

describe('writingStore 跨窗口正文同步', () => {
  it('saveChapterContent 落库成功后广播 content-saved 事件（payload 完整）', async () => {
    await useWritingStore.getState().saveChapterContent('c1', '<p>写作台新正文</p>', 6);
    expect(h.saveChapterContent).toHaveBeenCalledWith('c1', '<p>写作台新正文</p>', 6);
    expect(h.emit).toHaveBeenCalledWith(
      WRITING_CONTENT_SAVED_EVENT,
      expect.objectContaining({
        bookId: 'b1',
        chapterId: 'c1',
        content: '<p>写作台新正文</p>',
        wordCount: 6,
      }),
    );
    // 本窗口自己的 store 同步就地更新（写作台窗口自身也走这一行）
    const row = useWritingStore.getState().chapters.find((c) => c.id === 'c1')!;
    expect(row.content).toBe('<p>写作台新正文</p>');
    expect(row.wordCount).toBe(6);
  });

  it('applyExternalChapterContent：目标章属于当前激活书时就地合并 content/wordCount', () => {
    useWritingStore.getState().applyExternalChapterContent({
      bookId: 'b1',
      chapterId: 'c1',
      content: '<p>主窗口合并到的正文</p>',
      wordCount: 9,
    });
    const row = useWritingStore.getState().chapters.find((c) => c.id === 'c1')!;
    expect(row.content).toBe('<p>主窗口合并到的正文</p>');
    expect(row.wordCount).toBe(9);
    expect(row.updatedAt).toBeGreaterThan(0);
  });

  it('applyExternalChapterContent：非当前激活书的章节忽略（等待 loadChapters 全量兜底）', () => {
    useWritingStore.getState().applyExternalChapterContent({
      bookId: 'b-other',
      chapterId: 'c1',
      content: '<p>不应写入</p>',
      wordCount: 1,
    });
    const row = useWritingStore.getState().chapters.find((c) => c.id === 'c1')!;
    expect(row.content).toBe('<p>旧正文</p>');
    expect(row.wordCount).toBe(3);
  });

  it('applyExternalChapterContent：目标章不在缓存中时静默忽略', () => {
    useWritingStore.getState().applyExternalChapterContent({
      bookId: 'b1',
      chapterId: 'c-not-loaded',
      content: '<p>x</p>',
      wordCount: 1,
    });
    expect(useWritingStore.getState().chapters).toHaveLength(1);
    expect(h.loggerWarn).not.toHaveBeenCalled();
  });
});
