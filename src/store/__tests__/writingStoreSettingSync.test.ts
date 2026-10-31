// 跨窗口「设定结构」同步（新建 / 改名 / 改副标题·简介·关系 / 删除）—— store 层定点测试（第十九轮 批次2）
//
// 缺口：设定卡（人设 + 世界观）是工作室实体卡视图 / 关系索引 / 审校报告 / 时间线归属 / 章节概览
// 登场·出场计数等 45 处消费的共同数据源，但写作台增删改设定此前完全不广播：在一边建卡 / 改名 /
// 删卡（连带解绑时间线事件、清理反向引用），工作室对应视图停在旧值。与大纲缺口同类，本轮补齐。
// 钉住：漏广播 / 误广播 / setActiveSetting 纯导航不广播 / emit 异常不断本地写入 / 接收方切书守卫 /
//   回声防护（接收重载不得回播叙事·章节·大纲）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
// 注：MapSet 插件现由 store 模块自身 enableMapSet 注册（生产同口径），测试不再自行启用——
// 「改名 / 改关系」用例正是这条隐藏 P0 的回归钉桩：若 store 漏注册，本用例会重现 Immer 报错。

const h = vi.hoisted(() => ({
  emit: vi.fn(async (..._a: unknown[]) => {}),
  saveSetting: vi.fn(async (_o: unknown) => {}),
  deleteSetting: vi.fn(async (_id: string) => {}),
  listSettings: vi.fn(async (_id: string, _kind: string) => [] as unknown[]),
  syncWritingEntityCards: vi.fn(),
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
  writingSettingsApi: { list: h.listSettings, save: h.saveSetting, delete: h.deleteSetting },
  writingOutlinesApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingStorylinesApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingTimelineApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
  writingForeshadowingsApi: { list: vi.fn(async () => []), save: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
  // 软删辅助纯函数（store 直接 import）
  isChapterDeleted: () => false,
  chapterDeletedAt: () => 0,
  withChapterDeletedAt: (ch: Record<string, unknown>) => ch,
}));
vi.mock('../editorStore', () => ({ useEditorStore: { getState: () => ({ syncWritingEntityCards: h.syncWritingEntityCards }) } }));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  useWritingStore,
  WRITING_SETTING_CHANGED_EVENT,
  WRITING_NARRATIVE_CHANGED_EVENT,
  WRITING_CHAPTER_STRUCT_CHANGED_EVENT,
  WRITING_OUTLINE_CHANGED_EVENT,
} from '../writingStore';

const set = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, bookId: 'b1', kind: 'character', name: id, subtitle: '', description: '',
     extra: '{}', sortOrder: 1, createdAt: 1000, updatedAt: 1000, ...over }) as never;

const settingEvents = () => h.emit.mock.calls.filter((c) => c[0] === WRITING_SETTING_CHANGED_EVENT);

describe('设定结构变更跨窗口广播', () => {
  beforeEach(() => {
    useWritingStore.setState({
      activeBookId: 'b1',
      books: [{ id: 'b1', genre: 'novel' } as never],
      settings: [set('s1'), set('s2', { sortOrder: 2 }), set('s3', { kind: 'worldbuilding', sortOrder: 1 })],
      settingInboundIndex: new Map(),
      timelineEvents: [],
      foreshadowings: [],
      storylines: [],
      chapters: [],
      outlines: [],
      activeSettingId: null,
    });
    h.emit.mockClear(); h.saveSetting.mockClear(); h.deleteSetting.mockClear();
    h.listSettings.mockClear(); h.listSettings.mockResolvedValue([] as never); h.syncWritingEntityCards.mockClear();
  });

  it('新建设定 → 广播 setting-changed，带该书 id', async () => {
    await useWritingStore.getState().createSetting('character', '新人设');
    const ev = settingEvents();
    expect(ev).toHaveLength(1);
    expect((ev[0] as [string, { bookId: string }])[1].bookId).toBe('b1');
  });

  it('改名 / 改关系 → 各广播一次，带该书 id', async () => {
    await useWritingStore.getState().updateSetting('s1', { name: '改名' });
    expect(settingEvents()).toHaveLength(1);
    expect((settingEvents()[0] as [string, { bookId: string }])[1].bookId).toBe('b1');

    h.emit.mockClear();
    await useWritingStore.getState().updateSetting('s2', { extra: '{"relations":[{"targetId":"s1"}]}' });
    expect(settingEvents()).toHaveLength(1);
  });

  it('删除设定 → 广播（设定集合变化 + 解绑时间线事件，接收方需重载）', async () => {
    await useWritingStore.getState().deleteSetting('s1');
    expect(settingEvents()).toHaveLength(1);
    expect(useWritingStore.getState().settings.length).toBe(2);
  });

  it('setActiveSetting 是纯导航态 → 不广播', async () => {
    useWritingStore.getState().setActiveSetting('s2');
    expect(settingEvents()).toHaveLength(0);
  });

  it('设定写动作不得触发章节结构 / 大纲广播（无跨类回声）', async () => {
    await useWritingStore.getState().createSetting('character', '干净新建');
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toHaveLength(0);
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_OUTLINE_CHANGED_EVENT)).toHaveLength(0);
  });

  it('emit 同步抛异常绝不断本地写入：createSetting 仍入本地态', async () => {
    h.emit.mockImplementationOnce(() => { throw new Error('event 模块不可用'); });
    const created = await useWritingStore.getState().createSetting('character', '容错卡');
    expect(created).not.toBeNull();
    expect(useWritingStore.getState().settings.length).toBe(4);
  });

  it('emit 异步拒绝也不打断本地写入（不冒泡为 unhandled）', async () => {
    h.emit.mockImplementationOnce(() => Promise.reject(new Error('rejected')));
    const created = await useWritingStore.getState().createSetting('worldbuilding', '拒绝容错');
    expect(created).not.toBeNull();
    expect(useWritingStore.getState().settings.length).toBe(4);
  });

  it('接收方：activeBookId === 变更书 → 按两种 kind 重载设定', async () => {
    h.listSettings.mockResolvedValueOnce([set('s1')] as never);
    h.listSettings.mockResolvedValueOnce([set('w1', { kind: 'worldbuilding' })] as never);
    await useWritingStore.getState().applyExternalSettingChange({ bookId: 'b1' });
    // character + worldbuilding 各拉一次
    expect(h.listSettings).toHaveBeenCalledTimes(2);
    expect(useWritingStore.getState().settings.map((x) => x.id).sort()).toEqual(['s1', 'w1']);
  });

  it('接收方：本窗口没在看这本书 → 忽略，不重载', async () => {
    useWritingStore.setState({ activeBookId: 'other' });
    await useWritingStore.getState().applyExternalSettingChange({ bookId: 'b1' });
    expect(h.listSettings).not.toHaveBeenCalled();
  });

  it('接收方：bookId 为空 → 不重载', async () => {
    await useWritingStore.getState().applyExternalSettingChange({ bookId: null });
    expect(h.listSettings).not.toHaveBeenCalled();
  });

  it('回声防护：接收方重载换 settings 引用不得触发叙事 / 章节结构 / 大纲广播', async () => {
    h.listSettings.mockResolvedValue([set('s1')] as never);
    h.emit.mockClear();
    await useWritingStore.getState().applyExternalSettingChange({ bookId: 'b1' });
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_NARRATIVE_CHANGED_EVENT)).toHaveLength(0);
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_CHAPTER_STRUCT_CHANGED_EVENT)).toHaveLength(0);
    expect(h.emit.mock.calls.filter((c) => c[0] === WRITING_OUTLINE_CHANGED_EVENT)).toHaveLength(0);
  });

  it('接收方重载失败只记日志，不抛出（不打断窗口其它逻辑）', async () => {
    h.listSettings.mockRejectedValueOnce(new Error('api 抖动'));
    await expect(useWritingStore.getState().applyExternalSettingChange({ bookId: 'b1' })).resolves.toBeUndefined();
  });
});
