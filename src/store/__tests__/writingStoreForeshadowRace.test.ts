// 批次1（第十八轮）：loadForeshadowings 陈旧书守卫回归
// 此前 loadForeshadowings 是唯一一个「无条件写入 s.foreshadowings」的按书装载器，
// 与 loadTimelineEvents/loadStorylines/loadChapters/loadSettings/loadOutlines/loadDailyStats
// 全部带 `if (s.activeBookId === bookId)` 守卫不一致。快速切书竞态下，A 书伏笔请求可能在
// 切到 B（表已清空）之后才返回，无守卫会把 A 书伏笔写进当前表 → B 书跨书串数据。
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/tauri', () => ({
  writingApi: {
    listBooks: vi.fn(async () => []),
    saveBook: vi.fn(async () => {}),
    deleteBook: vi.fn(async () => {}),
    listChapters: vi.fn(async () => []),
    saveChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
  },
  parseChapterExtra: (extra: string) => { try { return JSON.parse(extra || '{}'); } catch { return {}; } },
  chapterDeletedAt: (ch: { extra?: string }) => { try { return JSON.parse(ch.extra || '{}').deletedAt ?? 0; } catch { return 0; } },
  isChapterDeleted: () => false,
  withChapterDeletedAt: (ch: unknown) => ch,
  writingSettingsApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingOutlinesApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingStorylinesApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingTimelineApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
  writingForeshadowingsApi: { list: vi.fn(), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  saveTextFile: vi.fn(async () => {}),
  saveWritingEpub: vi.fn(async () => {}),
}));

import { writingForeshadowingsApi } from '../../services/tauri';
import { useWritingStore } from '../writingStore';

const A = 'book_A';
const B = 'book_B';

function fs(id: string, bookId: string, title: string) {
  return { id, bookId, title, description: '', plantChapterId: null, payoffChapterId: null, status: 'pending', storylineId: null, sortOrder: 1, createdAt: 1, updatedAt: 1 };
}

describe('writingStore.loadForeshadowings 陈旧书守卫', () => {
  beforeEach(() => {
    vi.mocked(writingForeshadowingsApi.list).mockReset();
    useWritingStore.setState({ books: [], activeBookId: A, foreshadowings: [] });
  });

  it('当前书未变 → 正常写入伏笔', async () => {
    vi.mocked(writingForeshadowingsApi.list).mockResolvedValue([fs('f1', A, '怀表')] as never);
    await useWritingStore.getState().loadForeshadowings();
    expect(useWritingStore.getState().foreshadowings.map((f) => f.id)).toEqual(['f1']);
  });

  it('请求在途期间切到 B（表已清空）→ A 书响应不得写回，保住 B 书空表（防跨书串数据）', async () => {
    let resolveA!: (v: unknown) => void;
    vi.mocked(writingForeshadowingsApi.list).mockReturnValue(new Promise((r) => { resolveA = r; }) as never);
    const p = useWritingStore.getState().loadForeshadowings();
    // 模拟 setActiveBook 切书：改 activeBookId 并清空伏笔表
    useWritingStore.setState({ activeBookId: B, foreshadowings: [] });
    // A 书请求此刻才返回旧数据
    resolveA([fs('f1', A, '怀表')]);
    await p;
    // 有守卫 → A 数据被丢弃，B 书表保持空（不应被 f1 污染）
    expect(useWritingStore.getState().foreshadowings).toEqual([]);
  });
});
