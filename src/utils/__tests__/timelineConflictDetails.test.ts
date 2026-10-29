// 时间线冲突详情（utils/writingTimeline.collectTimelineConflicts）。
//
// 冲突是全书体检里唯一的 block 级发现。以前报告一行只写「时间线冲突：某事件名」，
// 作者既不知道和谁撞、也不知道撞在哪个时点，跳过去还得自己找一遍——block 级发现
// 不该长这样。这里锁两件事：详情给得出来，且投影出去仍是原来那份判定（画布标黄
// 与报告必须同源，见 writingTimeline 里的注释）。
import { describe, it, expect } from 'vitest';
import {
  collectTimelineConflicts,
  computeTimelineConflicts,
  deriveTimeKeys,
  eventSortKey,
} from '../writingTimeline';
import { buildProofreadReport } from '../writingProofread';
import type { WritingTimelineEvent } from '../../services/tauri';

const ev = (id: string, at: string, settingId: string | null, chapterId: string | null = null) =>
  ({
    id,
    bookId: 'b1',
    settingId,
    at,
    event: `事件${id}`,
    chapterId,
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingTimelineEvent;

describe('collectTimelineConflicts 详情', () => {
  // 同轨（同一 settingId）at 完全相同 = 撞车。e1/e2 撞，e3 独占一个时点。
  const events = [ev('e1', '第三日', 's1'), ev('e2', '第三日', 's1'), ev('e3', '第四日', 's1')];

  it('撞上的事件带上与之相撞的另一条，而不是只给自己一个 id', () => {
    const m = collectTimelineConflicts(events, { view: 'book' });
    expect([...m.keys()].sort()).toEqual(['e1', 'e2']);
    expect(m.get('e1')).toEqual({ kind: 'sameAt', with: ['e2'] });
    expect(m.get('e2')!.with).toEqual(['e1']);
  });

  it('不把自己列进 with（否则报告会写出「与他自己撞」）', () => {
    const m = collectTimelineConflicts([ev('a', 'T', 's1'), ev('b', 'T', 's1')], { view: 'book' });
    expect(m.get('a')!.with).toEqual(['b']);
    expect(m.get('a')!.with).not.toContain('a');
  });

  it('三条撞在同一时点时，每条都看到另外两条', () => {
    const m = collectTimelineConflicts([ev('a', 'T', 's1'), ev('b', 'T', 's1'), ev('c', 'T', 's1')], {
      view: 'book',
    });
    expect(m.get('a')!.with).toEqual(['b', 'c']);
    expect(m.get('b')!.with).toEqual(['a', 'c']);
  });

  it('分轨口径不变：同 at 但不同设定不算撞（各走各的时间线）', () => {
    const m = collectTimelineConflicts([ev('a', 'T', 's1'), ev('b', 'T', 's2')], { view: 'book' });
    expect(m.size).toBe(0);
  });

  it('不完整事件（缺 at 或缺 event）不参与，与 lane 口径一致', () => {
    const blank = { ...ev('x', '第三日', 's1'), event: '  ' };
    const m = collectTimelineConflicts([ev('e1', '第三日', 's1'), blank], { view: 'book' });
    expect(m.size).toBe(0);
  });

  it('computeTimelineConflicts 只是取键投影 —— 画布标黄与报告必须同源', () => {
    const set = computeTimelineConflicts(events, { view: 'book' });
    expect([...set].sort()).toEqual([...collectTimelineConflicts(events, { view: 'book' }).keys()].sort());
  });

  it('chapter 视图的跨章倒挂：两章互指对方为相撞对象', () => {
    const chapters = [
      { id: 'c1', sortOrder: 0 },
      { id: 'c2', sortOrder: 1 },
    ] as never;
    // c1（先读）时点 10，c2（后读）时点 3 → 时间往回走
    const m = collectTimelineConflicts([ev('a', '10', null, 'c1'), ev('b', '3', null, 'c2')], {
      view: 'chapter',
      chapters,
    });
    expect(m.get('a')!.kind).toBe('reversed');
    expect(m.get('a')!.with).toEqual(['b']);
    expect(m.get('b')!.with).toEqual(['a']);
  });
});

describe('eventSortKey：可排序时点', () => {
  it('作者填了 timeKey 就用它，优先于 from-text 解析', () => {
    const e = { ...ev('a', '武德九年六月初四', 's1'), timeKey: 621 } as WritingTimelineEvent;
    expect(eventSortKey(e)).toBe(621);
  });

  it('没填 timeKey 时退回解析 at 的纯整数（老数据不留空白）', () => {
    expect(eventSortKey({ ...ev('a', '2024', 's1'), timeKey: null } as WritingTimelineEvent)).toBe(2024);
  });

  it('两者都拿不到 → null，即不参与倒挂判定', () => {
    // 这是有意的漏检：对「武德九年六月初四」这类任意历法瞎猜，会造出假的 block 级冲突
    expect(eventSortKey({ ...ev('a', '武德九年六月初四', 's1'), timeKey: null } as WritingTimelineEvent)).toBeNull();
  });
});

describe('跨章时间倒挂进得来全书报告', () => {
  const chapters = [{ id: 'c1', sortOrder: 0 }, { id: 'c2', sortOrder: 1 }] as never;

  /** 先读 c1、后读 c2，但 c2 的时点更早 —— 时间往回走。at 用任意历法文本，
   *  正是 pureInt 解析不出来的那种，只有 timeKey 能救回来 */
  const reversedEvents = [
    { ...ev('early', '武德九年六月初四', 's1', 'c1'), event: '开篇之战', timeKey: 100 },
    { ...ev('late', '武德九年五月初一', 's1', 'c2'), event: '终局之战', timeKey: 10 },
  ] as WritingTimelineEvent[];

  it('at 是任意历法文本时，只要填了 timeKey 就能检出倒挂', () => {
    const m = collectTimelineConflicts(reversedEvents, { view: 'chapter', chapters });
    expect(m.get('early')!.kind).toBe('reversed');
    expect(m.get('early')!.with).toEqual(['late']);
  });

  it('没填 timeKey 且 at 非纯整数 → 检不出来（已知漏检，不许假装在查）', () => {
    const m = collectTimelineConflicts([ev('early', '开篇之战', 's1', 'c1'), ev('late', '终局之战', 's1', 'c2')], {
      view: 'chapter',
      chapters,
    });
    expect(m.size).toBe(0);
  });

  it('时间顺序正常就不报（不误伤）', () => {
    const ok = [
      { ...ev('early', '第一战', 's1', 'c1'), timeKey: 10 },
      { ...ev('late', '第二战', 's1', 'c2'), timeKey: 100 },
    ] as WritingTimelineEvent[];
    expect(collectTimelineConflicts(ok, { view: 'chapter', chapters }).size).toBe(0);
  });

  it('体检报告：book 视图看不见的倒挂，现在会作为 block 行进报告', () => {
    const withChapters = [
      { id: 'c1', bookId: 'b1', title: '第一章', sortOrder: 0 },
      { id: 'c2', bookId: 'b1', title: '第二章', sortOrder: 1 },
    ] as never;
    const report = buildProofreadReport(withChapters, [], reversedEvents, [], [], []);
    const hit = report.issues.find((i) => i.key === 'ev:early');
    expect(hit).toBeTruthy();
    expect(hit!.group).toBe('timeline');
    expect(hit!.severity).toBe('block');
    expect(hit!.messageKey).toBe('TimelineReversedRow');
    expect(String(hit!.args?.others)).toContain('终局之战');
  });

  it('同轨撞车与倒挂同时命中时，报告用更具体的撞车说法（先到先得，不被覆盖）', () => {
    const withChapters = [
      { id: 'c1', bookId: 'b1', title: '第一章', sortOrder: 0 },
      { id: 'c2', bookId: 'b1', title: '第二章', sortOrder: 1 },
    ] as never;
    // 撞车按 at 文本判定（不是 timeKey）：a 与 b 必须写同一个 at 才算撞在同一时点
    const both = [
      { ...ev('a', '武德九年六月初四', 's1', 'c1'), timeKey: 100 },
      { ...ev('b', '武德九年六月初四', 's1', 'c1'), timeKey: 100 }, // 与 a 同轨同点 → 撞车
      { ...ev('z', '武德九年五月初一', 's1', 'c2'), timeKey: 1 }, // 与 a/b 构成倒挂
    ] as WritingTimelineEvent[];
    const report = buildProofreadReport(withChapters, [], both, [], [], []);
    expect(report.issues.find((i) => i.key === 'ev:a')!.messageKey).toBe('TimelineConflictRow');
    expect(report.issues.find((i) => i.key === 'ev:z')!.messageKey).toBe('TimelineReversedRow');
  });
});

describe('批量推演 timeKey（deriveTimeKeys）', () => {
  const evk = (id: string, at: string, timeKey: number | null = null) =>
    ({ ...ev(id, at, 's1'), timeKey }) as WritingTimelineEvent;

  it('格式统一时按现有排序口径填序号，且数字感知（第10年 排在 第3年 之后）', () => {
    const r = deriveTimeKeys([evk('a', '第3年6月'), evk('b', '第10年1月'), evk('c', '第4年2月')]);
    expect(r.kind).toBe('applied');
    if (r.kind !== 'applied') return;
    expect(r.filled).toBe(3);
    // 字典序会把「第10年」排到「第3年」前面，那样填出来的序号就是错的时间先后
    expect(r.assignments.get('a')!).toBeLessThan(r.assignments.get('c')!);
    expect(r.assignments.get('c')!).toBeLessThan(r.assignments.get('b')!);
  });

  it('留了插空余地（间隔 1000），作者之后能往中间补事件', () => {
    const r = deriveTimeKeys([evk('a', '第1年'), evk('b', '第2年')]);
    if (r.kind !== 'applied') throw new Error('应为 applied');
    expect(r.assignments.get('b')! - r.assignments.get('a')!).toBeGreaterThanOrEqual(1000);
  });

  it('作者手填过的绝不覆盖', () => {
    const r = deriveTimeKeys([evk('a', '第1年', 7), evk('b', '第2年')]);
    if (r.kind !== 'applied') throw new Error('应为 applied');
    expect(r.assignments.has('a')).toBe(false);
    expect(r.alreadySet).toBe(1);
  });

  it('格式混着来：只推最大的同格式一组，其余报成待手填（不瞎排跨格式的序）', () => {
    const r = deriveTimeKeys([
      evk('a', '第1年5月'),
      evk('b', '第2年5月'),
      evk('c', '第3年5月'),
      evk('d', '2024-06'),
    ]);
    if (r.kind !== 'applied') throw new Error('应为 applied');
    expect(r.filled).toBe(3);
    expect(r.assignments.has('d')).toBe(false);
    expect(r.needsManual).toBe(1);
  });

  it('全是纯汉字历法（无任何数字）→ 明说推不出来，而不是硬排一个序', () => {
    const r = deriveTimeKeys([evk('a', '武德九年六月初四'), evk('b', '武德九年五月初一')]);
    expect(r.kind).toBe('noDigits');
  });

  it('全部已填过 → noEvents，重复点按钮不会乱改已有数据', () => {
    expect(deriveTimeKeys([evk('a', '第1年', 1000), evk('b', '第2年', 2000)]).kind).toBe('noEvents');
  });

  it('端到端：推演之后，「时间往回走」才真的检得出来', () => {
    const chapters = [{ id: 'c1', sortOrder: 0 }, { id: 'c2', sortOrder: 1 }] as never;
    // 先读的那章写着「第10年」，后读的章写着「第2年」——纯文本时 pureInt 拿不到数
    const raw = [
      { ...ev('early', '第10年冬', 's1', 'c1') } as WritingTimelineEvent,
      { ...ev('late', '第2年春', 's1', 'c2') } as WritingTimelineEvent,
    ];
    expect(collectTimelineConflicts(raw, { view: 'chapter', chapters }).size).toBe(0); // 推演前检不出
    const r = deriveTimeKeys(raw);
    if (r.kind !== 'applied') throw new Error('应为 applied');
    const filled = raw.map((e) => ({ ...e, timeKey: r.assignments.get(e.id) ?? null }));
    const m = collectTimelineConflicts(filled as WritingTimelineEvent[], { view: 'chapter', chapters });
    expect(m.get('early')!.kind).toBe('reversed'); // 推演后即可
  });
});

describe('体检报告把冲突详情写进 block 行', () => {
  it('args 带上时点与相撞事件名，作者不必跳过去再找一遍', () => {
    const chapters = [{ id: 'c1', bookId: 'b1', title: '第一章', sortOrder: 0 }] as never;
    const report = buildProofreadReport(
      chapters,
      [],
      [ev('e1', '第三日', 's1'), ev('e2', '第三日', 's1')],
      [],
      [],
      [],
    );
    const hit = report.issues.find((i) => i.group === 'timeline' && i.key === 'ev:e1');
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('block');
    expect(hit!.args).toMatchObject({ at: '第三日' });
    expect(String(hit!.args?.others)).toContain('事件e2');
    expect(hit!.target).toEqual({ type: 'timeline-event', id: 'e1' });
  });
});

