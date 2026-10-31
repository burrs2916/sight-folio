// 跨窗口「大纲结构」同步（新建 / 改内容 / 改挂载章 / 改封面 / 删除 / 重排）—— store 层定点测试（第十九轮 批次1）
//
// 缺口：大纲是工作室多视图（灵感面板 / 章节概览计数 / 审校报告 / 伏笔人设关联 / 剧情线联动）的共同
// 数据源，但写作台增删改大纲此前完全不广播：在一边挂一个灵感 / 节拍，工作室对应视图停在旧值——作者
// 基于两份不一致的大纲账做决策。这是第十八轮已确认、当时定为「中低优先」的遗留，本轮按功能优先补齐
// （与第十七轮书元、第十八轮章节结构同款「低频显式 emit + 接收方整表重载」范式）。
// 钉住：漏广播 / 误广播 / 回声 / emit 异常不断本地写入 / 接收方切书守卫。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._a: unknown[]) => {}),
  saveOutline: vi.fn(async (_o: unknown) => {}),
  deleteOutline: vi.fn(async (_id: string) => {}),
  listOutlines: vi.fn(async (_id: string) => [] as unknown[]),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: {
    listBooks: vi.fn(async () => [{ id: 'b1', genre: 'novel' }]),
    saveBook: vi.fn(async (b: unknown) => b),
    deleteBook: vi.fn(async () => {}),
    listChapters: vi.fn(async () => [] as unknown[]),
    saveChapter: vi.fn(async () => {}),
    deleteChapter: vi.fn(async () => {}),
    renameChapter: vi.fn(async () => {}),
    saveChapterContent: vi.fn(async () => {}),
  },
  writingSettingsApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingOutlinesApi: { list: h.listOutlines, save: h.saveOutline, delete: h.deleteOutline },
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

import {
  useWritingStore,
  WRITING_OUTLINE_CHANGED_EVENT,
  WRITING_NARRATIVE_CHANGED_EVENT,
  WRITING_CHAPTER_STRUCT_CHANGED_EVENT,
} from '../writingStore';

const out = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, bookId: 'b1', title: id, summary: '', chapterId: null, extra: '{}',
     sortOrder: 1, createdAt: 1000, updatedAt: 1000, ...over }) as never;

const outlineEvents = () => h.emit.mock.calls.filter((c) => c[0] === WRITING_OUTLINE_CHANGED_EVENT);

describe('大纲结构变更跨窗口广播', () => {
  beforeEach(() => {
    useWritingStore.setState({
      activeBookId: 'b1',
      books: [{ id: 'b1', genre: 'novel' } as never],
      outlines: [out('o1'), out('o2', { sortOrder: 2 }), out('o3', { sortOrder: 3 })],
      timelineEvents: [],
      foreshadowings: [],
      storylines: [],
      chapters: [],
    });
    h.emit.mockClear(); h.saveOutline.mockClear(); h.deleteOutline.mockClear(); h.listOutlines.mockClear();
  });

  it('新建大纲 → 广播 outline-changed，带该书 id', async () => {
    await useWritingStore.getState().createOutline('新灵感');
    const ev = outlineEvents();
    expect(ev).toHaveLength(1);
    expect((ev[0] as [string, { bookId: string }])[1].bookId).toBe('b1');
  });

  it('改标题 / 改挂载章 / 改封面 → 各广播一次，带该书 id', async () => {
    await useWritingStore.getState().updateOutline('o1', { title: '改名' });
    expect(outlineEvents()).toHaveLength(1);
    expect((outlineEvents()[0] as [string, { bookId: string }])[1].bookId).toBe('b1');

    h.emit.mockClear();
    await useWritingStore.getState().updateOutline('o2', { chapterId: 'cX' });
    expect(outlineEvents()).toHaveLength(1);

    h.emit.mockClear();
    await useWritingStore.getState().setOutlineCover('o3', 'res://cover/1');
    expect(outlineEvents()).toHaveLength(1);
  });

  it('删除大纲 → 广播（大纲集合变化，接收方需重载）', async () => {
    await useWritingStore.getState().deleteOutline('o1');
    expect(outlineEvents()).toHaveLength(1);
    expect(useWritingStore.getState().outlines.length).toBe(2);
  });

  it('重排大纲 → 广播（顺序变化）；target === from 不动 → 不广播', async () => {
    await useWritingStore.getState().reorderOutline('o1', 2);
    expect(outlineEvents()).toHaveLength(1);

    h.emit.mockClear();
    await useWritingStore.getState().reorderOutline('o2', 0); // o2 在 index 0，目标 0 → 提前返回
    expect(outlineEvents()).toHaveLength(0);
  });

  it('大纲写动作不得触发章节结构 / 叙事广播（无跨类回声）', async () => {
    await useWritingStore.getState().createOutline('干净新建');
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toHaveLength(0);
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_NARRATIVE_CHANGED_EVENT)).toHaveLength(0);
  });

  it('emit 同步抛异常绝不断本地写入：createOutline 仍入本地态', async () => {
    h.emit.mockImplementationOnce(() => { throw new Error('event 模块不可用'); });
    const created = await useWritingStore.getState().createOutline('容错灵感');
    expect(created).not.toBeNull();
    expect(useWritingStore.getState().outlines.length).toBe(4);
  });

  it('emit 异步拒绝也不打断本地写入（不冒泡为 unhandled）', async () => {
    h.emit.mockImplementationOnce(() => Promise.reject(new Error('rejected')));
    const created = await useWritingStore.getState().createOutline('拒绝容错');
    expect(created).not.toBeNull();
    expect(useWritingStore.getState().outlines.length).toBe(4);
  });

  it('接收方：activeBookId === 变更书 → 重载大纲', async () => {
    h.listOutlines.mockResolvedValueOnce([out('o1'), out('o9', { sortOrder: 2 })] as never);
    await useWritingStore.getState().applyExternalOutlineChange({ bookId: 'b1' });
    expect(h.listOutlines).toHaveBeenCalledTimes(1);
    expect(useWritingStore.getState().outlines.length).toBe(2);
    expect(useWritingStore.getState().outlines.map((o) => o.id)).toEqual(['o1', 'o9']);
  });

  it('接收方：本窗口没在看这本书 → 忽略，不重载', async () => {
    useWritingStore.setState({ activeBookId: 'other' });
    await useWritingStore.getState().applyExternalOutlineChange({ bookId: 'b1' });
    expect(h.listOutlines).not.toHaveBeenCalled();
  });

  it('接收方：bookId 为空 → 不重载', async () => {
    await useWritingStore.getState().applyExternalOutlineChange({ bookId: null });
    expect(h.listOutlines).not.toHaveBeenCalled();
  });

  it('回声防护：接收方重载换 outlines 引用不得触发叙事 / 章节结构广播', async () => {
    h.listOutlines.mockResolvedValueOnce([out('o1')] as never);
    h.emit.mockClear();
    await useWritingStore.getState().applyExternalOutlineChange({ bookId: 'b1' });
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_NARRATIVE_CHANGED_EVENT)).toHaveLength(0);
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toHaveLength(0);
  });

  it('接收方重载失败只记日志，不抛出（不打断窗口其它逻辑）', async () => {
    h.listOutlines.mockRejectedValueOnce(new Error('api 抖动'));
    await expect(useWritingStore.getState().applyExternalOutlineChange({ bookId: 'b1' })).resolves.toBeUndefined();
  });
});
