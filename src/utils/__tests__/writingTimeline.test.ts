// 时间线纯函数口径测试（utils/writingTimeline）：
//   - isComplete：完整事件判定（at 与 event 双非空）
//   - deriveLinesFromEvents：剧情线挂线去重清单（章统筹「本章剧情线」/ 设定右栏共用）
//   - buildChapterLanes / computeCoverage / computeTimelineConflicts / beatEventText / beatImported
// 这些是章统筹面板与时间线视图共用的同一份口径，分裂会导致两处显示不一致。
import { describe, it, expect } from 'vitest';
import {
  isComplete,
  deriveLinesFromEvents,
  buildChapterLanes,
  computeCoverage,
  computeTimelineConflicts,
  beatEventText,
  beatImported,
  pureInt,
  buildStorylineChapterMatrix,
  compareByAt,
} from '../writingTimeline';
import type { WritingChapter, WritingTimelineEvent } from '../../services/tauri';

const ev = (id: string, over: Partial<WritingTimelineEvent> = {}): WritingTimelineEvent =>
  ({
    id,
    bookId: 'b1',
    settingId: null,
    at: '1',
    event: `事件${id}`,
    chapterId: null,
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as WritingTimelineEvent;

const ch = (id: string, sortOrder = 0, kind = '章', volume = ''): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: `第${id}章`,
    content: '',
    sortOrder,
    wordCount: 0,
    status: 'draft',
    volume,
    parentId: null,
    kind,
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

describe('isComplete —— 完整事件判定', () => {
  it('at 与 event 双非空才是完整事件', () => {
    expect(isComplete(ev('e1', { at: '3', event: 'x' }))).toBe(true);
    expect(isComplete(ev('e2', { at: '  ', event: 'x' }))).toBe(false);
    expect(isComplete(ev('e3', { at: '3', event: '  ' }))).toBe(false);
    expect(isComplete(ev('e4', { at: '', event: '' }))).toBe(false);
  });
});

describe('deriveLinesFromEvents —— 剧情线挂线去重', () => {
  it('只统计真实挂线事件，未挂线不计；按传入线序返回', () => {
    const lines = [
      { id: 'L1', name: '主暗线' },
      { id: 'L2', name: '爱情线' },
      { id: 'L3', name: '无事件线' },
    ] as { id: string; name: string }[];
    const events = [
      ev('e1', { storylineId: 'L1' }),
      ev('e2', { storylineId: 'L1' }),
      ev('e3', { storylineId: null }),
      ev('e4', { storylineId: 'L2' }),
    ];
    const out = deriveLinesFromEvents(events, lines);
    expect(out).toEqual([
      { storyline: lines[0], count: 2 },
      { storyline: lines[1], count: 1 },
    ]);
  });

  it('事件集为空或全未挂线时返回空数组', () => {
    expect(deriveLinesFromEvents([], [{ id: 'L1', name: 'x' }] as { id: string; name: string }[])).toEqual([]);
    expect(
      deriveLinesFromEvents([ev('e1', { storylineId: null })], [{ id: 'L1', name: 'x' }] as {
        id: string;
        name: string;
      }[]),
    ).toEqual([]);
  });
});

describe('buildChapterLanes —— 章节级轨道', () => {
  it('每章一组绑定事件；未绑章事件收进末尾组', () => {
    const chapters = [ch('c1', 2), ch('c2', 1)];
    const events = [
      ev('e1', { chapterId: 'c2', at: '2' }),
      ev('e2', { chapterId: 'c1', at: '1' }),
      ev('e3', { chapterId: null }),
    ];
    const lanes = buildChapterLanes(chapters, events, { unbound: '未绑章', untitled: '未命名' }, undefined);
    expect(lanes.map((l) => l.id)).toEqual(['c2', 'c1', '__unbound__']);
    expect(lanes[0].events.map((e) => e.id)).toEqual(['e1']);
    expect(lanes[2].events.map((e) => e.id)).toEqual(['e3']);
  });

  it('无未绑事件时末尾不追加未绑章组', () => {
    const lanes = buildChapterLanes([ch('c1')], [ev('e1', { chapterId: 'c1' })], {
      unbound: '未绑章',
      untitled: '未命名',
    });
    expect(lanes.map((l) => l.id)).toEqual(['c1']);
  });

  it('groupByVolume=true：按卷聚合为折叠节点，默认收拢；展开后可见内部章节轨道', () => {
    const chapters = [ch('c1', 1, '章', '卷一'), ch('c2', 2, '章', '卷一'), ch('c3', 3, '章', '卷二')];
    const events = [
      ev('e1', { chapterId: 'c1', at: '1' }),
      ev('e2', { chapterId: 'c2', at: '2' }),
      ev('e3', { chapterId: 'c3', at: '3' }),
      ev('e4', { chapterId: null }),
    ];
    const lanes = buildChapterLanes(
      chapters,
      events,
      { unbound: '未绑章', untitled: '未命名' },
      { groupByVolume: true },
    );
    // 卷一、卷二、未绑章
    expect(lanes.map((l) => l.id)).toEqual(['__vol__卷一', '__vol__卷二', '__unbound__']);
    // 卷一聚合事件 = c1 + c2
    const vol1 = lanes.find((l) => l.id === '__vol__卷一');
    expect(vol1?.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(vol1?.group?.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
    // 卷二聚合事件 = c3
    const vol2 = lanes.find((l) => l.id === '__vol__卷二');
    expect(vol2?.events.map((e) => e.id)).toEqual(['e3']);
    // 未绑章在末尾
    expect(lanes[lanes.length - 1].id).toBe('__unbound__');
  });

  it('groupByVolume=true：未分卷章节归入「未分类」卷', () => {
    const chapters = [ch('c1', 1, '章', ''), ch('c2', 2, '章', '卷一')];
    const events = [ev('e1', { chapterId: 'c1', at: '1' }), ev('e2', { chapterId: 'c2', at: '2' })];
    const lanes = buildChapterLanes(
      chapters,
      events,
      { unbound: '未绑章', untitled: '未命名' },
      { groupByVolume: true },
    );
    expect(lanes.map((l) => l.id)).toEqual(['__vol____none__', '__vol__卷一']);
    const uncategorized = lanes.find((l) => l.id === '__vol____none__');
    expect(uncategorized?.name).toBe('未命名'); // labels.untitled
    expect(uncategorized?.group?.chapters.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('computeCoverage —— 章节锚定覆盖率', () => {
  it('统计已锚定章数与未绑事件数', () => {
    const stats = computeCoverage(
      [ch('c1'), ch('c2'), ch('c3')],
      [ev('e1', { chapterId: 'c1' }), ev('e2', { chapterId: 'c2' }), ev('e3', { chapterId: null })],
    );
    expect(stats).toEqual({ totalChapters: 3, anchoredChapterCount: 2, unboundEventCount: 1 });
  });
});

describe('computeTimelineConflicts —— 冲突软提示', () => {
  it('book 视图按设定分轨：同设定同 at 标冲突', () => {
    const events = [
      ev('e1', { settingId: 's1', at: '5' }),
      ev('e2', { settingId: 's1', at: '5' }),
      ev('e3', { settingId: 's2', at: '5' }),
    ];
    expect(computeTimelineConflicts(events, { view: 'book' })).toEqual(new Set(['e1', 'e2']));
  });

  it('chapter 视图跨章时间倒挂：早读章时点晚于晚读章标黄', () => {
    const events = [ev('e1', { chapterId: 'c1', at: '9' }), ev('e2', { chapterId: 'c2', at: '2' })];
    const chapters = [ch('c1', 1), ch('c2', 2)];
    expect(computeTimelineConflicts(events, { view: 'chapter', chapters })).toEqual(new Set(['e1', 'e2']));
  });

  it('storyline 视图按线分轨：同线同 at 标冲突', () => {
    const events = [
      ev('e1', { storylineId: 'L1', at: '3' }),
      ev('e2', { storylineId: 'L1', at: '3' }),
      ev('e3', { storylineId: 'L2', at: '3' }),
    ];
    expect(computeTimelineConflicts(events, { view: 'storyline' })).toEqual(new Set(['e1', 'e2']));
  });

  it('草稿事件（不完整）不参与冲突检测', () => {
    const events = [ev('e1', { at: '' }), ev('e2', { at: '' })];
    expect(computeTimelineConflicts(events, { view: 'book' })).toEqual(new Set());
  });
});

describe('beatEventText / beatImported —— 大纲节拍 ↔ 时间线导入', () => {
  it('标题与摘要合并为「标题：摘要」', () => {
    expect(beatEventText({ title: '决战', summary: '双方对峙' })).toBe('决战：双方对峙');
    expect(beatEventText({ title: '决战', summary: '' })).toBe('决战');
    expect(beatEventText({})).toBe('');
  });

  it('beatImported 全文精确匹配查重', () => {
    const events = [ev('e1', { event: '决战：双方对峙' })];
    expect(beatImported(events, '决战：双方对峙')).toBe(true);
    expect(beatImported(events, '决战')).toBe(false);
    expect(beatImported(events, '')).toBe(false);
  });
});

describe('pureInt —— 纯整数时间点解析', () => {
  it('整体为整数才解析；混合单位返回 null', () => {
    expect(pureInt('3')).toBe(3);
    expect(pureInt(' 2024 ')).toBe(2024);
    expect(pureInt('第3年')).toBeNull();
    expect(pureInt('')).toBeNull();
  });
});

describe('buildStorylineChapterMatrix —— 剧情 P2 线×章交织矩阵', () => {
  const lines = [{ id: 'L1' }, { id: 'L2' }];
  const chapters = [ch('c2', 2), ch('c1', 1), ch('c3', 3)]; // 乱序传入，验证按 sortOrder 重排

  it('章列按 sortOrder 排序；每线一行，格 = 该线绑章完整事件数', () => {
    const m = buildStorylineChapterMatrix(
      lines,
      [
        ev('e1', { storylineId: 'L1', chapterId: 'c1' }),
        ev('e2', { storylineId: 'L1', chapterId: 'c1' }),
        ev('e3', { storylineId: 'L2', chapterId: 'c3' }),
      ],
      chapters,
    );
    expect(m.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']); // sortOrder 1,2,3
    expect(m.rows.map((r) => r.storylineId)).toEqual(['L1', 'L2']);
    expect(m.rows[0].counts.get('c1')).toBe(2);
    expect(m.rows[0].counts.get('c3')).toBeUndefined();
    expect(m.rows[1].counts.get('c3')).toBe(1);
    expect(m.rows[0].events.get('c1')?.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('未绑章事件不进格只计数；未挂线事件归 null 行置尾（非空才生成）', () => {
    const m = buildStorylineChapterMatrix(
      lines,
      [
        ev('e1', { storylineId: 'L1' }),
        ev('e2', { storylineId: null, chapterId: 'c1' }),
        ev('e3', { storylineId: 'L1', chapterId: 'c2' }),
      ],
      chapters,
    );
    expect(m.rows.map((r) => r.storylineId)).toEqual(['L1', 'L2', null]);
    expect(m.rows[0].unboundCount).toBe(1); // e1 无绑章
    expect(m.rows[0].counts.get('c2')).toBe(1);
    expect(m.rows[2].counts.get('c1')).toBe(1);
  });

  it('草稿（at/event 不全）不进矩阵；空线也出列（规划空缺提示）', () => {
    const m = buildStorylineChapterMatrix(lines, [ev('e1', { storylineId: 'L1', at: '', event: '' })], chapters);
    expect(m.rows.map((r) => r.storylineId)).toEqual(['L1', 'L2']); // 空线 L2 也出列
    expect(m.rows[0].total).toBe(0); // 草稿被 isComplete 口径排除
    expect(m.rows.some((r) => r.storylineId === null)).toBe(false); // 无未挂线事件 → 不生成 null 行
  });
});

describe('compareByAt —— 事件 at 排序唯一口径', () => {
  it('纯数字 at 用数值感知排序（"3" < "10"，不等长前缀正确归位）', () => {
    const list = ['10', '3', '1', '2'];
    expect([...list].sort(compareByAt)).toEqual(['1', '2', '3', '10']);
  });

  it('空 at 排后（与「待补全殿后」分组语义一致）', () => {
    const list = ['', '3', '  ', null, '1'];
    expect([...list].sort(compareByAt)).toEqual(['1', '3', '', '  ', null]);
    expect(compareByAt(undefined, undefined)).toBe(0);
  });

  it('trim 后参与比较（前后空白不改变排序）', () => {
    expect(compareByAt(' 2 ', '1')).toBeGreaterThan(0);
    expect(compareByAt(' 2 ', null)).toBeLessThan(0);
  });
});
