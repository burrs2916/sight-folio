// 时间线冲突详情（utils/writingTimeline.collectTimelineConflicts）。
//
// 冲突是全书体检里唯一的 block 级发现。以前报告一行只写「时间线冲突：某事件名」，
// 作者既不知道和谁撞、也不知道撞在哪个时点，跳过去还得自己找一遍——block 级发现
// 不该长这样。这里锁两件事：详情给得出来，且投影出去仍是原来那份判定（画布标黄
// 与报告必须同源，见 writingTimeline 里的注释）。
import { describe, it, expect } from 'vitest';
import { collectTimelineConflicts, computeTimelineConflicts } from '../writingTimeline';
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

