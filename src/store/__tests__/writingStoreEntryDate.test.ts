/**
 * ㉘ 日记条目补日期：store 落账的锁（欠账 S22）。
 *
 * 这个动作唯一的要害是 **合并写**：`writing_chapters.extra` 里同时住着
 * 章头图 `coverImage`、诗歌形式 `poemForm`、回收站 `deletedAt`。
 * 写日期若整块覆盖，就是"作者补了个日期，封面图和软删标记一起没了"。
 * 所以这里钉的是**别人的键一个不丢**，而不是"日期写进去了"这种废话。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._args: unknown[]) => {}),
  listBooks: vi.fn(async () => [] as unknown[]),
  saveBook: vi.fn(async (b: unknown) => b),
  saveChapter: vi.fn(async (c: unknown) => c),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: {
    listBooks: h.listBooks,
    saveBook: h.saveBook,
    saveChapter: h.saveChapter,
    saveChapterContent: vi.fn(async () => {}),
    listChapters: vi.fn(async () => []),
  },
  writingOutlinesApi: {},
  writingSettingsApi: {},
  writingStorylinesApi: { list: vi.fn(async () => []) },
  writingForeshadowingsApi: { list: vi.fn(async () => []) },
  writingTimelineApi: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn() },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
  isChapterDeleted: (c: { deletedAt?: number }) => (c.deletedAt ?? 0) > 0,
  chapterDeletedAt: (c: { deletedAt?: number }) => c.deletedAt ?? 0,
  withChapterDeletedAt: (c: { extra?: string }, ts: number) => ({ ...c, deletedAt: ts }),
}));
vi.mock('../editorStore', () => ({
  useEditorStore: { getState: () => ({ syncWritingEntityCards: vi.fn() }) },
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useWritingStore } from '../writingStore';
import { parseChapterExtra } from '../../services/writing';
import type { WritingChapter } from '../../services/writing';

const chapter = (over: Partial<WritingChapter> = {}): WritingChapter =>
  ({
    id: 'c1',
    bookId: 'b1',
    title: '第 1 天',
    content: '<p>原文</p>',
    sortOrder: 0,
    wordCount: 12,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '天',
    storylineId: null,
    extra: '{}',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }) as WritingChapter;

const seed = (extra: string) => useWritingStore.setState({ chapters: [chapter({ extra })], deletedChapters: [] });
const savedRow = (): WritingChapter => h.saveChapter.mock.calls[0][0] as WritingChapter;

describe('setChapterEntryDate（㉘）—— 要害是"合并写"，别人的键一个不丢', () => {
  beforeEach(() => {
    h.saveChapter.mockClear();
    h.saveChapter.mockImplementation(async (c: unknown) => c);
  });

  it('写日期不冲掉同住 extra 的封面 / 诗体 / 未知键，也不动正文与标题', async () => {
    seed(JSON.stringify({ coverImage: 'assets/a.png', poemForm: 'wujue', mine: 1 }));
    await useWritingStore.getState().setChapterEntryDate('c1', '2026-11-10');
    expect(h.saveChapter).toHaveBeenCalledTimes(1);
    const row = savedRow();
    expect(parseChapterExtra(row.extra)).toEqual({
      coverImage: 'assets/a.png',
      poemForm: 'wujue',
      mine: 1,
      entryDate: '2026-11-10',
    });
    expect(row.content).toBe('<p>原文</p>');
    expect(row.title).toBe('第 1 天');
    expect(row.kind).toBe('天');
    expect(row.updatedAt).toBeGreaterThanOrEqual(1000);
    // store 只就地换这一行（整表重载会把作者正在编辑的其它章刷掉）
    expect(useWritingStore.getState().chapters).toHaveLength(1);
    expect(parseChapterExtra(useWritingStore.getState().chapters[0].extra).entryDate).toBe('2026-11-10');
  });

  it('回收站标记（deletedAt）也住在 extra：补日期不许把人从回收站里捞出来', async () => {
    seed(JSON.stringify({ deletedAt: 1762000000 }));
    await useWritingStore.getState().setChapterEntryDate('c1', '2026-11-10');
    const extra = parseChapterExtra(savedRow().extra);
    expect(extra.deletedAt).toBe(1762000000);
    expect(extra.entryDate).toBe('2026-11-10');
  });

  it('清空 = 删 key，不是写空串（空串会被下一次读成"有日期"）', async () => {
    seed(JSON.stringify({ entryDate: '2026-11-10', coverImage: 'assets/a.png' }));
    await useWritingStore.getState().setChapterEntryDate('c1', '');
    const extra = parseChapterExtra(savedRow().extra);
    expect('entryDate' in extra).toBe(false);
    expect(extra.coverImage).toBe('assets/a.png');
  });

  it('坏日期串落到 store 也是删 key（形状的唯一真源在 diaryEntry，UI 那层只是少发一次写）', async () => {
    seed(JSON.stringify({ entryDate: '2026-11-10' }));
    await useWritingStore.getState().setChapterEntryDate('c1', '2026-11-31');
    expect('entryDate' in parseChapterExtra(savedRow().extra)).toBe(false);
  });

  it('脏 extra（坏 JSON）不崩，写出来仍是合法 JSON 且带上日期', async () => {
    seed('not-json');
    await useWritingStore.getState().setChapterEntryDate('c1', '2026-11-10');
    expect(parseChapterExtra(savedRow().extra).entryDate).toBe('2026-11-10');
  });

  it('查无此章：一次库都不写（不许凭空造一行）', async () => {
    seed('{}');
    await useWritingStore.getState().setChapterEntryDate('missing', '2026-11-10');
    expect(h.saveChapter).not.toHaveBeenCalled();
  });
});
