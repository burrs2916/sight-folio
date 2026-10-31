// 跨窗口「书元信息」同步（书名 / 简介 / 体裁·载体 / 连载·完结 / 日更目标 / 全书目标）—— store 层定点测试
//
// 缺口：写作台与工作室（场景画布）各持一份 writingStore。在一边「规划本书」调了截稿日 /
// 日更目标 / 全书目标，另一边仍显示旧值——作者基于两份矛盾的目标 / 节奏预测做决策。这是
// 第十五轮已确认、当时定为「中低优先」的遗留隐患，本轮（第十七轮）补齐。
//
// 实现是「4 个书级 setter 显式 emit + 接收方整表重载书架」。钉住三种失败模式：
//   漏广播（改了不吭声）、误广播（书不存在也广播）、回声（远端并进来又广播回去）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._args: unknown[]) => {}),
  listBooks: vi.fn(async () => [] as unknown[]),
  saveBook: vi.fn(async (b: unknown) => b),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: { listBooks: h.listBooks, saveBook: h.saveBook, saveChapterContent: vi.fn(async () => {}) },
  writingOutlinesApi: {},
  writingSettingsApi: {},
  writingStorylinesApi: { list: vi.fn(async () => []) },
  writingForeshadowingsApi: { list: vi.fn(async () => []) },
  writingTimelineApi: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn() },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
}));
vi.mock('../editorStore', () => ({
  useEditorStore: { getState: () => ({ syncWritingEntityCards: vi.fn() }) },
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  useWritingStore,
  WRITING_BOOK_META_CHANGED_EVENT,
  WRITING_NARRATIVE_CHANGED_EVENT,
} from '../writingStore';

const book = (over: Record<string, unknown> = {}) =>
  ({
    id: 'b1',
    title: '旧名',
    genre: 'novel',
    medium: 'web',
    description: '',
    status: 'draft',
    dailyGoal: 0,
    extra: '',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }) as never;

const emitted = (n = 0) => h.emit.mock.calls[n] as [string, { bookId: string | null }];

describe('书元信息变更跨窗口广播', () => {
  beforeEach(() => {
    useWritingStore.setState({ activeBookId: 'b1', books: [book()] });
    h.emit.mockClear();
    h.saveBook.mockClear();
    h.listBooks.mockClear();
  });

  it('改日更目标 → 广播 book-meta-changed，带该书 id', async () => {
    await useWritingStore.getState().setDailyGoal('b1', 2000);
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()[0]).toBe(WRITING_BOOK_META_CHANGED_EVENT);
    expect(emitted()[1].bookId).toBe('b1');
  });

  it('改书元信息（简介 / 状态 / 体裁）→ 广播一次', async () => {
    await useWritingStore.getState().setBookMeta('b1', { description: '新简介', status: 'finished' });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()[0]).toBe(WRITING_BOOK_META_CHANGED_EVENT);
  });

  it('改名 → 广播', async () => {
    await useWritingStore.getState().renameBook('b1', '新书名');
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()[1].bookId).toBe('b1');
  });

  it('全书目标（截稿 / 总字数）→ 广播', async () => {
    await useWritingStore.getState().setBookGoal('b1', { targetWords: 100000, targetChapters: 40, deadline: 1 });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()[0]).toBe(WRITING_BOOK_META_CHANGED_EVENT);
  });

  it('书不存在 → 不落库不广播（避免无效噪音）', async () => {
    await useWritingStore.getState().setDailyGoal('nope', 1000);
    expect(h.saveBook).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('广播异常绝不能打断本地写入：emit 同步抛出时 store 仍落库', async () => {
    h.emit.mockImplementationOnce(() => {
      throw new Error('event 模块不可用');
    });
    await expect(useWritingStore.getState().setDailyGoal('b1', 3000)).resolves.toBeUndefined();
    expect(useWritingStore.getState().books[0]?.dailyGoal).toBe(3000);
  });

  it('接收方：本窗口已加载该书 → 整表重载书架（拉最新元信息）', async () => {
    h.listBooks.mockResolvedValueOnce([book({ dailyGoal: 5000, extra: '{"targetWords":999}' })] as never);
    await useWritingStore.getState().applyExternalBookMetaChange({ bookId: 'b1' });
    expect(h.listBooks).toHaveBeenCalledTimes(1);
    expect(useWritingStore.getState().books[0]?.dailyGoal).toBe(5000);
  });

  it('接收方：本窗口没这本书 → 忽略，不重载（下次 loadBooks 自然拿到新值）', async () => {
    await useWritingStore.getState().applyExternalBookMetaChange({ bookId: 'other' });
    expect(h.listBooks).not.toHaveBeenCalled();
  });

  it('回声防护：接收侧重载换 books 引用不得触发叙事广播（两事件互不串）', async () => {
    h.listBooks.mockResolvedValueOnce([book({ dailyGoal: 5000 })] as never);
    h.emit.mockClear();
    await useWritingStore.getState().applyExternalBookMetaChange({ bookId: 'b1' });
    const narrative = h.emit.mock.calls.filter((c) => c[0] === WRITING_NARRATIVE_CHANGED_EVENT);
    expect(narrative).toHaveLength(0);
  });
});
