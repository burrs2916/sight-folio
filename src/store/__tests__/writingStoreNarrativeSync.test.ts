// 跨窗口叙事数据同步（时间线 / 伏笔 / 剧情线）—— store 层定点测试
//
// 缺口：这三张表是全书体检的数据源，而写作台与场景画布各持一份 store。在写作台改了伏笔
// 回收章、或推演了时间线序号，画布那边仍显示旧值。作者看到两个界面不一致，就会开始怀疑
// 所有体检结论——包括那些本来是对的。
//
// 实现是"订阅 store，按数组引用变化广播"，所以这里必须钉住它的三种失败模式：
//   漏广播（写了不吭声）、误广播（改了无关数据也吭声）、回声（把远端并进来又广播回去）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  // 带 rest 参数声明：否则 mock.calls 类型是 [][]，取不到 emit 的入参
  emit: vi.fn(async (..._args: unknown[]) => {}),
  listTimeline: vi.fn(async () => [] as unknown[]),
  listForeshadowings: vi.fn(async () => [] as unknown[]),
  listStorylines: vi.fn(async () => [] as unknown[]),
  saveTimeline: vi.fn(async (e: unknown) => e),
  deleteTimeline: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({ emit: h.emit }));
vi.mock('../../services/tauri', () => ({
  writingApi: { saveChapterContent: vi.fn(async () => {}), saveBook: vi.fn(async () => {}) },
  writingOutlinesApi: {},
  writingSettingsApi: {},
  writingStorylinesApi: { list: h.listStorylines },
  writingForeshadowingsApi: { list: h.listForeshadowings },
  writingTimelineApi: { list: h.listTimeline, save: h.saveTimeline, delete: h.deleteTimeline },
  writingStatsApi: { listDailyStats: vi.fn(async () => []) },
}));
vi.mock('../editorStore', () => ({
  useEditorStore: { getState: () => ({ syncWritingEntityCards: vi.fn() }) },
}));
vi.mock('../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { useWritingStore, WRITING_NARRATIVE_CHANGED_EVENT } from '../writingStore';

const timelineRow = (id: string) =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at: '第1年',
    event: `事件${id}`,
    chapterId: null,
    storylineId: null,
    timeKey: null,
    sortOrder: 0,
    createdAt: 1000,
    updatedAt: 1000,
  }) as never;

/**
 * 订阅者是同步触发的，所以每次 setState 之后都要清掉那次自造的广播再看断言。
 *
 * 三个 list mock 也必须一起清：本文件一半的断言是"**不该**被调用"，而 mock 是模块级的，
 * 上一个用例留下的调用会让这种断言假通过或假失败（实测被上一个用例的 'b1' 污染过一次）。
 */
const reset = () => {
  useWritingStore.setState({
    activeBookId: 'b1',
    chapters: [],
    timelineEvents: [],
    foreshadowings: [],
    storylines: [],
  });
  h.emit.mockClear();
  h.listTimeline.mockClear();
  h.listForeshadowings.mockClear();
  h.listStorylines.mockClear();
};

/** 取第 n 次广播的载荷（emit 的第二个参数）；直接索引进 mock.calls 会撞上可空检查 */
const emitted = (n = 0) =>
  h.emit.mock.calls[n]?.[1] as { bookId: string | null; groups: string[] };

describe('叙事数据变更广播', () => {
  beforeEach(reset);

  it('改伏笔表 → 广播 foreshadowing，带上当前书 id', () => {
    useWritingStore.setState({ foreshadowings: [{ id: 'f1' } as never] });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(h.emit.mock.calls[0]?.[0]).toBe(WRITING_NARRATIVE_CHANGED_EVENT);
    expect(emitted()).toEqual({ bookId: 'b1', groups: ['foreshadowing'] });
  });

  it('三张表同时变（如删书重开）→ 只广播一次，带上三个分组', () => {
    useWritingStore.setState({
      timelineEvents: [timelineRow('e1')],
      foreshadowings: [{ id: 'f1' } as never],
      storylines: [{ id: 's1' } as never],
    });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted().groups).toEqual(['timeline', 'foreshadowing', 'storyline']);
  });

  it('改无关数据（章节、统计）→ 一个字都不广播', () => {
    // 高频 set()（正文编辑）若被误广播，另一窗口会不停重载这三张表
    useWritingStore.setState({ chapters: [{ id: 'c1' } as never], dailyStats: [] as never });
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('没打开任何书时不广播（另一端无从重载）', () => {
    useWritingStore.setState({ activeBookId: null });
    h.emit.mockClear();
    useWritingStore.setState({ timelineEvents: [timelineRow('e1')] } as never);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('走真实写动作也覆盖得到（这是选订阅者而非逐个动作埋点的全部理由）', async () => {
    useWritingStore.setState({ timelineEvents: [timelineRow('e1')] });
    h.emit.mockClear();
    await useWritingStore.getState().updateTimelineEvent('e1', { at: '第9年' });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted()).toEqual({ bookId: 'b1', groups: ['timeline'] });
  });

  it('删除写动作同样覆盖', async () => {
    useWritingStore.setState({ timelineEvents: [timelineRow('e1')] });
    h.emit.mockClear();
    await useWritingStore.getState().deleteTimelineEvent('e1');
    expect(h.emit).toHaveBeenCalledTimes(1);
  });
});

describe('接收端并入远端变更', () => {
  beforeEach(reset);

  it('只重载受影响的分组', async () => {
    await useWritingStore
      .getState()
      .applyExternalNarrativeChange({ bookId: 'b1', groups: ['foreshadowing'] });
    expect(h.listForeshadowings).toHaveBeenCalledWith('b1');
    expect(h.listTimeline).not.toHaveBeenCalled();
    expect(h.listStorylines).not.toHaveBeenCalled();
  });

  it('**不回声**：并进来的数据不得再广播出去（否则两窗口无限互相通知）', async () => {
    h.listTimeline.mockResolvedValueOnce([timelineRow('e1')]);
    await useWritingStore
      .getState()
      .applyExternalNarrativeChange({ bookId: 'b1', groups: ['timeline'] });
    // 抑制解除留了一个宏任务边界，这里跨一拍再断言
    await new Promise((r) => setTimeout(r, 0));
    expect(h.emit).not.toHaveBeenCalled();
    expect(useWritingStore.getState().timelineEvents.map((e) => e.id)).toEqual(['e1']);
  });

  it('不是当前打开的书 → 不动本地数据（下次加载自然拿到）', async () => {
    await useWritingStore
      .getState()
      .applyExternalNarrativeChange({ bookId: 'other', groups: ['timeline'] });
    expect(h.listTimeline).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('解除抑制后的本地修改照常广播（抑制不是一次性开关）', async () => {
    await useWritingStore
      .getState()
      .applyExternalNarrativeChange({ bookId: 'b1', groups: ['timeline'] });
    await new Promise((r) => setTimeout(r, 0));
    h.emit.mockClear();
    useWritingStore.setState({ storylines: [{ id: 's1' } as never] });
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(emitted().groups).toEqual(['storyline']);
  });
});
