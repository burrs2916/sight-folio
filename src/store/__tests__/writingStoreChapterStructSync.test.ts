// 跨窗口「章节结构」同步（新建 / 改名 / 状态 / 删除 等）—— store 层定点测试（第十八轮 批次2）
//
// 缺口：写正文有 content-saved 就地并入，但章节的结构性操作（增 / 删 / 改集合）此前完全没广播：
// 写作台建一章 / 删一章，工作室左栏目录树、catalog、规划本书面板的章节数 / 体量 / 节奏预测停旧值。
// 这是第十七轮已确认、当时定为「中低优先」的遗留，本轮按功能优先补齐。
// 实现：各章节结构 action 显式 emit + 接收方整表重载章节。钉住：漏广播 / 误广播 / 回声 / emit 异常不断本地写入。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._a: unknown[]) => {}),
  saveChapter: vi.fn(async (_c: unknown) => {}),
  renameChapter: vi.fn(async (_id: string, _t: string) => {}),
  deleteChapter: vi.fn(async (_id: string) => {}),
  listChapters: vi.fn(async (_id: string) => [] as unknown[]),
  saveOutline: vi.fn(async (_o: unknown) => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: {
    listBooks: vi.fn(async () => [{ id: 'b1', genre: 'novel' }]),
    saveBook: vi.fn(async (b: unknown) => b),
    deleteBook: vi.fn(async () => {}),
    listChapters: h.listChapters,
    saveChapter: h.saveChapter,
    deleteChapter: h.deleteChapter,
    renameChapter: h.renameChapter,
    saveChapterContent: vi.fn(async () => {}),
  },
  // 软删辅助纯函数（store 直接 import）
  parseChapterExtra: (e: string) => { try { return JSON.parse(e || '{}'); } catch { return {}; } },
  chapterDeletedAt: (ch: { deletedAt?: number; extra?: string }) => {
    const p = ch.extra ? JSON.parse(ch.extra || '{}') : {};
    const t = ch.deletedAt ?? (p && typeof p === 'object' ? p.deletedAt : undefined);
    return typeof t === 'number' && t > 0 ? t : 0;
  },
  isChapterDeleted: (ch: { deletedAt?: number; extra?: string }) => {
    const p = ch.extra ? JSON.parse(ch.extra || '{}') : {};
    const t = ch.deletedAt ?? (p && typeof p === 'object' ? p.deletedAt : undefined);
    return typeof t === 'number' && t > 0;
  },
  withChapterDeletedAt: (ch: Record<string, unknown>, deletedAt: number) => ({
    ...ch, deletedAt, extra: JSON.stringify({ ...(JSON.parse((ch.extra as string) || '{}')), deletedAt }),
  }),
  writingSettingsApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingOutlinesApi: { list: vi.fn(async () => []), save: h.saveOutline, delete: vi.fn(async () => {}) },
  writingStorylinesApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingTimelineApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
  writingForeshadowingsApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
}));
vi.mock('../editorStore', () => ({ useEditorStore: { getState: () => ({ syncWritingEntityCards: vi.fn() }) } }));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useWritingStore, WRITING_CHAPTER_STRUCT_CHANGED_EVENT, WRITING_NARRATIVE_CHANGED_EVENT } from '../writingStore';

const chap = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, bookId: 'b1', title: id, content: '', sortOrder: 1, wordCount: 100, status: 'draft',
     volume: '', parentId: null, kind: '章', extra: '{}', createdAt: 1000, updatedAt: 1000, ...over }) as never;

const emitted = (n = 0) => h.emit.mock.calls[n] as [string, { bookId: string | null }];

describe('章节结构变更跨窗口广播', () => {
  beforeEach(() => {
    useWritingStore.setState({ activeBookId: 'b1', books: [{ id: 'b1', genre: 'novel' } as never], chapters: [chap('c1'), chap('c2', { sortOrder: 2 })], deletedChapters: [], outlines: [] });
    h.emit.mockClear(); h.saveChapter.mockClear(); h.renameChapter.mockClear();
    h.deleteChapter.mockClear(); h.listChapters.mockClear();
  });

  it('新建章 → 广播 struct-changed，带该书 id', async () => {
    await useWritingStore.getState().createChapter('新章');
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()[0]).toBe(WRITING_CHAPTER_STRUCT_CHANGED_EVENT);
    expect(emitted()[1].bookId).toBe('b1');
  });

  it('改名 → 广播', async () => {
    await useWritingStore.getState().renameChapter('c1', '改名');
    expect(h.emit.mock.calls.some((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toBe(true);
  });

  it('改状态 → 广播', async () => {
    await useWritingStore.getState().setChapterStatus('c1', 'finished');
    expect(emitted()[0]).toBe(WRITING_CHAPTER_STRUCT_CHANGED_EVENT);
  });

  it('软删章 → 广播（章节集合变化，接收方需重载）', async () => {
    await useWritingStore.getState().deleteChapter('c1');
    expect(h.emit.mock.calls.some((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toBe(true);
  });

  it('emit 同步抛异常绝不断本地写入：createChapter 仍入本地态', async () => {
    h.emit.mockImplementationOnce(() => { throw new Error('event 模块不可用'); });
    const c = await useWritingStore.getState().createChapter('容错章');
    expect(c).not.toBeNull();
    expect(useWritingStore.getState().chapters.length).toBe(3);
  });

  it('接收方：activeBookId === 变更书 → 重载章节', async () => {
    h.listChapters.mockResolvedValueOnce([chap('c1'), chap('c2', { sortOrder: 2 }), chap('c3', { sortOrder: 3 })] as never);
    await useWritingStore.getState().applyExternalChapterStructChange({ bookId: 'b1' });
    expect(h.listChapters).toHaveBeenCalledTimes(1);
    expect(useWritingStore.getState().chapters.length).toBe(3);
  });

  it('接收方：本窗口没在看这本书 → 忽略，不重载', async () => {
    useWritingStore.setState({ activeBookId: 'other' });
    await useWritingStore.getState().applyExternalChapterStructChange({ bookId: 'b1' });
    expect(h.listChapters).not.toHaveBeenCalled();
  });

  it('回声防护：接收方重载换 chapters 引用不得触发叙事广播', async () => {
    h.listChapters.mockResolvedValueOnce([chap('c1')] as never);
    h.emit.mockClear();
    await useWritingStore.getState().applyExternalChapterStructChange({ bookId: 'b1' });
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_NARRATIVE_CHANGED_EVENT)).toHaveLength(0);
  });
});
