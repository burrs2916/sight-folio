// 伏笔纯函数口径测试（utils/writingForeshadowing）：
//   - foreshadowingsPlantedIn / foreshadowingsPayableIn：章统筹「本章伏笔」埋设/回收双归类
//   - foreshadowStatusColor / foreshadowStatusLabelKey：状态展示口径
//   - sortForeshadowings / isOverdue / foreshadowingCastOf：列表序、跨章逾期预警、牵涉人物
// 这些口径被章统筹面板、伏笔页签、右栏编辑卡共用，分裂会导致同一伏笔多处显示不一致。
import { describe, it, expect } from 'vitest';
import {
  foreshadowingsPlantedIn,
  foreshadowingsPayableIn,
  foreshadowStatusColor,
  foreshadowStatusLabelKey,
  foreshadowStatusOrder,
  sortForeshadowings,
  isOverdue,
  foreshadowingCastOf,
  relatedForeshadowings,
  foreshadowingsOfLine,
} from '../writingForeshadowing';
import type { WritingChapter, WritingForeshadowing, WritingOutline } from '../../services/tauri';

const fs = (id: string, over: Partial<WritingForeshadowing> = {}): WritingForeshadowing =>
  ({
    id,
    bookId: 'b1',
    title: `伏笔${id}`,
    description: '',
    plantChapterId: 'c1',
    payoffChapterId: null,
    status: 'pending',
    storylineId: null,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as WritingForeshadowing;

const ch = (id: string, sortOrder = 0): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: `第${id}章`,
    content: '',
    sortOrder,
    wordCount: 0,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const beat = (id: string, chapterId: string | null): WritingOutline =>
  ({
    id,
    bookId: 'b1',
    title: `节拍${id}`,
    summary: '',
    chapterId,
    extra: '{}',
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  }) as WritingOutline;

describe('foreshadowingsPlantedIn / PayableIn —— 本章伏笔双归类', () => {
  it('埋设于本章的伏笔（任何状态）都算 planted', () => {
    const items = [
      fs('f1', { plantChapterId: 'c1', status: 'paidoff' }),
      fs('f2', { plantChapterId: 'c2' }),
      fs('f3', { plantChapterId: null }),
    ];
    expect(foreshadowingsPlantedIn(items, 'c1').map((f) => f.id)).toEqual(['f1']);
  });

  it('计划回收于本章的伏笔才算 payable', () => {
    const items = [
      fs('f1', { payoffChapterId: 'c2', status: 'pending' }),
      fs('f2', { payoffChapterId: 'c2', status: 'paidoff' }),
      fs('f3', { payoffChapterId: null }),
    ];
    expect(foreshadowingsPayableIn(items, 'c2').map((f) => f.id)).toEqual(['f1', 'f2']);
  });
});

describe('foreshadowStatusColor / LabelKey / Order —— 状态展示口径', () => {
  it('pending 琥珀、paidoff 绿、abandoned 灰', () => {
    expect(foreshadowStatusColor('pending')).toBe('#b45309');
    expect(foreshadowStatusColor('paidoff')).toBe('#2e7d32');
    expect(foreshadowStatusColor('abandoned')).toBe('#9e9e9e');
    expect(foreshadowStatusColor('unknown')).toBe('#9e9e9e');
  });

  it('标签 key 与状态一一对应', () => {
    expect(foreshadowStatusLabelKey('pending')).toBe('writing.foreshadowStatusPending');
    expect(foreshadowStatusLabelKey('paidoff')).toBe('writing.foreshadowStatusPaidoff');
    expect(foreshadowStatusLabelKey('abandoned')).toBe('writing.foreshadowStatusAbandoned');
  });

  it('待回收排最前（创作者最关心）', () => {
    expect(foreshadowStatusOrder('pending')).toBe(0);
    expect(foreshadowStatusOrder('paidoff')).toBe(1);
    expect(foreshadowStatusOrder('abandoned')).toBe(2);
  });
});

describe('sortForeshadowings —— 列表排序', () => {
  it('按 状态序 → 埋设章序 → 创建序 排序', () => {
    const items = [
      fs('late-plant', { plantChapterId: 'c2', payoffChapterId: null, status: 'pending', createdAt: 1 }),
      fs('early-plant', { plantChapterId: 'c1', payoffChapterId: null, status: 'pending', createdAt: 9 }),
      fs('paidoff-late', { plantChapterId: 'c3', status: 'paidoff', createdAt: 2 }),
    ];
    const chapters = [ch('c1', 1), ch('c2', 2), ch('c3', 3)];
    expect(sortForeshadowings(items, chapters).map((f) => f.id)).toEqual(['early-plant', 'late-plant', 'paidoff-late']);
  });
});

describe('isOverdue —— 跨章逾期预警', () => {
  it('回收章早于埋设章且仍 pending 才预警', () => {
    const chapters = [ch('c1', 1), ch('c2', 2)];
    expect(isOverdue(fs('f1', { status: 'pending', plantChapterId: 'c2', payoffChapterId: 'c1' }), chapters)).toBe(
      true,
    );
    expect(isOverdue(fs('f2', { status: 'pending', plantChapterId: 'c1', payoffChapterId: 'c2' }), chapters)).toBe(
      false,
    );
    expect(isOverdue(fs('f3', { status: 'paidoff', plantChapterId: 'c2', payoffChapterId: 'c1' }), chapters)).toBe(
      false,
    );
    expect(isOverdue(fs('f4', { status: 'pending', plantChapterId: 'c2', payoffChapterId: null }), chapters)).toBe(
      false,
    );
    expect(isOverdue(fs('f5', { status: 'pending', plantChapterId: 'c1', payoffChapterId: 'cX' }), chapters)).toBe(
      false,
    );
  });
});

describe('foreshadowingCastOf —— 伏笔牵涉人物（零模型派生）', () => {
  it('埋设与回收两章 cast 并集，去重、滤孤儿、名字缺失回退 id', () => {
    // extra.cast 挂载人物 id，与 writingOutline.parseBeatExtra 同构；foreshadowingCastOf
    // 内部走真实 castOfChapter 派生（与编辑区同一份口径），这里只校验其行为
    const withCast = (id: string, chapterId: string | null, cast: string[]): WritingOutline => ({
      ...beat(id, chapterId),
      extra: JSON.stringify({ cast }),
    });
    const outlines = [
      withCast('o1', 'c1', ['s1', 's2']),
      withCast('o2', 'c2', ['s1', 's3']),
      withCast('o3', 'c9', ['s9']), // 不相关章，不应计入
    ];
    const f = fs('f1', { plantChapterId: 'c1', payoffChapterId: 'c2' });
    const settings = [
      { id: 's1', name: '阿明' },
      { id: 's2', name: null },
      // s3 无对应设定记录 → 孤儿，应被过滤
    ];
    const out = foreshadowingCastOf(f, outlines, settings);
    expect(out).toEqual([
      { id: 's1', name: '阿明' },
      { id: 's2', name: 's2' },
    ]);
    expect(out.some((x) => x.id === 's3')).toBe(false);
  });

  it('任一挂载章为空时只取另一章的 cast', () => {
    const outlines = [
      {
        ...beat('o1', 'c1'),
        extra: JSON.stringify({ cast: ['s1'] }),
      } as WritingOutline,
    ];
    const f = fs('f1', { plantChapterId: 'c1', payoffChapterId: null });
    expect(foreshadowingCastOf(f, outlines, [{ id: 's1', name: '阿明' }])).toEqual([{ id: 's1', name: '阿明' }]);
  });
});

describe('relatedForeshadowings —— 伏笔 P2 人物右栏反向派生', () => {
  const withCast = (id: string, chapterId: string | null, cast: string[]): WritingOutline => ({
    ...beat(id, chapterId),
    extra: JSON.stringify({ cast }),
  });
  const settings = [
    { id: 's1', name: '阿明' },
    { id: 's2', name: '阿花' },
  ];
  const outlines = [withCast('o1', 'c1', ['s1']), withCast('o2', 'c2', ['s2'])];

  it('反查 plant/payoff 两章 cast 含该设定的伏笔（与正向 foreshadowingCastOf 同口径）', () => {
    const items = [
      fs('f1', { plantChapterId: 'c1' }),                 // 埋设章出场 s1 → 相关
      fs('f2', { plantChapterId: 'c1', payoffChapterId: 'c2' }), // 两章都含 → 相关（去重只算一次）
      fs('f3', { plantChapterId: 'c2' }),                 // 只出场 s2 → 不相关
    ];
    expect(relatedForeshadowings('s1', items, outlines, settings).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(relatedForeshadowings('s2', items, outlines, settings).map((f) => f.id)).toEqual(['f2', 'f3']);
  });

  it('无绑定章的伏笔永不相关；无关设定返回空数组', () => {
    const items = [fs('f1', { plantChapterId: null, payoffChapterId: null })];
    expect(relatedForeshadowings('s1', items, outlines, settings)).toEqual([]);
    expect(relatedForeshadowings('s9', [fs('f1')], outlines, settings)).toEqual([]);
  });
});

describe('foreshadowingsOfLine —— 剧情 P2-A 本线伏笔（骨架互联补缺）', () => {
  it('只取显式挂线伏笔；storylineId=null 的未挂线不算任何线', () => {
    const items = [
      fs('f1', { storylineId: 'L1' }),
      fs('f2', { storylineId: 'L1' }),
      fs('f3', { storylineId: 'L2' }),
      fs('f4', { storylineId: null }),
    ];
    expect(foreshadowingsOfLine('L1', items).map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(foreshadowingsOfLine('L9', items)).toEqual([]);
  });
});
