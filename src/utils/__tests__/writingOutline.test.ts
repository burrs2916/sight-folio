// 大纲口径纯函数测试：这里守的是「写作台与工作室右栏读到同一条大纲」
//
// 一旦两处口径分了叉，同一章在写作台和工作室右栏会显示不同的大纲，
// 而它们读的是同一张 writing_outlines 表 —— 这种不一致最难查，所以锁成测试。
import { describe, it, expect } from 'vitest';
import {
  beatForChapter,
  beatsOfChapter,
  importedBeatIdsOfChapter,
  looseBeats,
  volumeAccount,
  parseBeatExtra,
  castOfChapter,
  scenesOfChapter,
  chaptersOfSetting,
  chapterPath,
  settingUsage,
  relatedSettingsOf,
  relationTargetName,
  subtreeAccount,
  parseChapterCover,
} from '../writingOutline';
import type { WritingChapter, WritingOutline, WritingSetting, WritingRelation } from '../../services/tauri';

/** 带 extra 的节拍（挂载测试用） */
function beatEx(id: string, chapterId: string | null, sortOrder: number, extra: unknown): WritingOutline {
  return { ...beat(id, chapterId, sortOrder), extra: typeof extra === 'string' ? extra : JSON.stringify(extra) };
}

/** 结构树节点（parentId/kind 可控，供 chapterPath 用） */
function node(id: string, parentId: string | null, kind: string, sortOrder = 0): WritingChapter {
  return { ...ch(id, '', 0), parentId, kind, sortOrder };
}

function beat(id: string, chapterId: string | null, sortOrder: number): WritingOutline {
  return {
    id,
    bookId: 'b1',
    title: `节拍${id}`,
    summary: '',
    chapterId,
    extra: '{}',
    sortOrder,
    createdAt: 0,
    updatedAt: 0,
  };
}

function ch(id: string, volume: string, wordCount: number, status = 'draft'): WritingChapter {
  return {
    id,
    bookId: 'b1',
    title: `第${id}章`,
    content: '',
    sortOrder: 0,
    wordCount,
    status,
    volume,
    parentId: null,
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('beatForChapter', () => {
  it('按章取节拍', () => {
    const outlines = [beat('o1', null, 1), beat('o2', 'c1', 2), beat('o3', 'c2', 3)];
    expect(beatForChapter(outlines, 'c1')!.id).toBe('o2');
    expect(beatForChapter(outlines, 'c2')!.id).toBe('o3');
  });

  it('没有绑定的章返回 null（右栏据此显示「还没大纲」而不是空白）', () => {
    expect(beatForChapter([beat('o1', 'c1', 1)], 'c9')).toBeNull();
  });

  it('chapterId 为空时返回 null，不会误取到未落章的节拍', () => {
    expect(beatForChapter([beat('o1', null, 1)], '')).toBeNull();
  });

  it('一章被多条节拍绑定时取 sortOrder 最小的那条，且与数组顺序无关', () => {
    const a = [beat('late', 'c1', 9), beat('early', 'c1', 2)];
    expect(beatForChapter(a, 'c1')!.id).toBe('early');
    const b = [beat('early', 'c1', 2), beat('late', 'c1', 9)];
    expect(beatForChapter(b, 'c1')!.id).toBe('early');
  });
});

describe('looseBeats', () => {
  it('只留未落章的节拍，并按 sortOrder 排（先规划的先显示）', () => {
    const outlines = [beat('a', 'c1', 5), beat('b', null, 3), beat('c', null, 1)];
    expect(looseBeats(outlines).map((o) => o.id)).toEqual(['c', 'b']);
  });

  it('不修改入参（纯函数）', () => {
    const outlines = [beat('a', null, 2), beat('b', null, 1)];
    looseBeats(outlines);
    expect(outlines.map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('volumeAccount', () => {
  it('按卷名聚合章列表 / 字数 / 完稿数', () => {
    const chapters = [ch('1', '卷一', 100), ch('2', '卷一', 200, 'finished'), ch('3', '卷二', 50)];
    const r = volumeAccount(chapters, '卷一');
    expect(r.rows.map((c) => c.id)).toEqual(['1', '2']);
    expect(r.words).toBe(300);
    expect(r.finished).toBe(1);
  });

  it("未分卷（'' 卷名）自成一组，不会被算进任何命名卷", () => {
    const chapters = [ch('1', '', 10), ch('2', '卷一', 20)];
    expect(volumeAccount(chapters, '卷一').rows.map((c) => c.id)).toEqual(['2']);
    expect(volumeAccount(chapters, '').rows.map((c) => c.id)).toEqual(['1']);
  });

  it('空卷返回空账而不是崩溃', () => {
    const r = volumeAccount([], '卷一');
    expect(r).toEqual({ rows: [], words: 0, finished: 0 });
  });
});

describe('parseBeatExtra（宽容解析，全项目唯一入口）', () => {
  it('正常对象解析出 cast/scenes/status', () => {
    expect(parseBeatExtra('{"cast":["a"],"scenes":["s"],"status":"written"}')).toEqual({
      cast: ['a'],
      scenes: ['s'],
      status: 'written',
    });
  });

  it('坏 JSON / 空串 / 数组 / 字面量 一律当空挂载，绝不抛错', () => {
    expect(parseBeatExtra('{坏')).toEqual({});
    expect(parseBeatExtra('')).toEqual({});
    expect(parseBeatExtra('[1,2]')).toEqual({});
    expect(parseBeatExtra('null')).toEqual({});
    expect(parseBeatExtra('42')).toEqual({});
  });
});

describe('importedBeatIdsOfChapter（章详情「已导入」置灰判定，数据即真相）', () => {
  const ev = (chapterId: string | null, outlineId: string | null) => ({ chapterId, outlineId });

  it('本章时间线里有同 outlineId 事件 → 该节拍判为已导入', () => {
    const set = importedBeatIdsOfChapter([ev('c1', 'o1'), ev('c1', 'o2')], 'c1');
    expect(set.has('o1')).toBe(true);
    expect(set.has('o2')).toBe(true);
  });

  it('只看本章的事件——别章导过同一节拍不算本章已导入', () => {
    const set = importedBeatIdsOfChapter([ev('c2', 'o1')], 'c1');
    expect(set.has('o1')).toBe(false);
  });

  it('无 outlineId 的普通时间线事件忽略（它们不是节拍导入的）', () => {
    const set = importedBeatIdsOfChapter([ev('c1', null)], 'c1');
    expect(set.size).toBe(0);
  });

  it('空 chapterId → 空集合（未选章时面板不炸、不误置灰）', () => {
    expect(importedBeatIdsOfChapter([ev('c1', 'o1')], '').size).toBe(0);
  });
});

describe('beatsOfChapter（章详情列本章节拍清单，导出口径）', () => {
  it('取该章全部节拍（可多条），不碰其它章/未落章节拍', () => {
    const outlines = [beat('o1', 'c1', 0), beat('o2', 'c1', 1), beat('o3', 'c2', 0), beat('o4', null, 0)];
    expect(beatsOfChapter(outlines, 'c1').map((o) => o.id)).toEqual(['o1', 'o2']);
  });

  it('空 chapterId → 空数组（未选章时面板不炸）', () => {
    expect(beatsOfChapter([beat('o1', 'c1', 0)], '')).toEqual([]);
  });

  it('顺序契约：按传入数组原序返回，绝不内部 sort——' +
     'castOfChapter/scenesOfChapter 的「去重保序」依赖它不得被改动', () => {
    const outlines = [beat('oB', 'c1', 5), beat('oA', 'c1', 1)];
    // 原序是 [oB, oA]（sortOrder 5,1）；若哪天有人给 beatsOfChapter 加 .sort 这条会红，
    // 连带 castOfChapter 的保序语义被静默改变——所以在这里钉住。
    expect(beatsOfChapter(outlines, 'c1').map((o) => o.id)).toEqual(['oB', 'oA']);
  });
});

describe('castOfChapter / scenesOfChapter（本章挂载，读真数据）', () => {
  it('汇总本章多条节拍挂的人物，去重保序', () => {
    const outlines = [
      beatEx('o1', 'c1', 1, { cast: ['p1', 'p2'] }),
      beatEx('o2', 'c1', 2, { cast: ['p2', 'p3'] }),
      beatEx('o3', 'c2', 3, { cast: ['p9'] }),
    ];
    expect(castOfChapter(outlines, 'c1')).toEqual(['p1', 'p2', 'p3']);
    expect(castOfChapter(outlines, 'c2')).toEqual(['p9']);
  });

  it('场景走 scenes 字段，与 cast 不串（反之亦然）', () => {
    const outlines = [beatEx('o1', 'c1', 1, { cast: ['p1'], scenes: ['s1', 's2'] })];
    expect(scenesOfChapter(outlines, 'c1')).toEqual(['s1', 's2']);
    expect(castOfChapter(outlines, 'c1')).toEqual(['p1']);
  });

  it('非字符串 id / 空串 / 坏 extra 全被过滤', () => {
    const outlines = [beatEx('o1', 'c1', 1, { cast: ['p1', '', 7, null] }), beatEx('o2', 'c1', 2, '{坏')];
    expect(castOfChapter(outlines, 'c1')).toEqual(['p1']);
  });
});

describe('chaptersOfSetting（人物出场章 / 场景关联章真数据口径）', () => {
  it('人物读 cast：返回挂过它的章，按 sortOrder 排', () => {
    const outlines = [
      beatEx('o1', 'c1', 1, { cast: ['p1'] }),
      beatEx('o2', 'c2', 2, { cast: ['p1'] }),
      beatEx('o3', 'c3', 3, { cast: ['p2'] }),
    ];
    const chapters = [
      { ...node('c1', null, '章'), sortOrder: 5 },
      node('c2', null, '章', 2),
      node('c3', null, '章', 1),
    ];
    expect(chaptersOfSetting(outlines, chapters, 'p1', 'character').map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('世界观读 scenes：同一 id 在 cast 里出现不算数', () => {
    const outlines = [beatEx('o1', 'c1', 1, { cast: ['x1'] }), beatEx('o2', 'c2', 2, { scenes: ['x1'] })];
    const chapters = [node('c1', null, '章', 1), node('c2', null, '章', 2)];
    expect(chaptersOfSetting(outlines, chapters, 'x1', 'worldbuilding').map((c) => c.id)).toEqual(['c2']);
  });

  it('空 settingId 返回空（不误扫全表）', () => {
    expect(
      chaptersOfSetting([beatEx('o1', 'c1', 1, { cast: ['p1'] })], [node('c1', null, '章')], '', 'character'),
    ).toEqual([]);
  });
});

describe('chapterPath（结构树面包屑，防环断链）', () => {
  it('根 → 自身：部 › 卷 › 章', () => {
    const chapters = [node('root', null, '部'), node('v1', 'root', '卷'), node('c1', 'v1', '章')];
    expect(chapterPath(chapters, 'c1').map((c) => c.id)).toEqual(['root', 'v1', 'c1']);
  });

  it('找不到 / 空 id 返回 []', () => {
    expect(chapterPath([node('c1', null, '章')], 'nope')).toEqual([]);
    expect(chapterPath([node('c1', null, '章')], '')).toEqual([]);
  });

  it('parentId 成环时不死循环（seen 兜底），每个 id 只出现一次', () => {
    const chapters = [node('a', 'b', '卷'), node('b', 'a', '章')];
    const path = chapterPath(chapters, 'a');
    expect(path.length).toBeLessThanOrEqual(2);
    const ids = path.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // 无重复
    expect(ids).toContain('a'); // 自身一定在路径里
  });
});

describe('settingUsage（要素清点：已挂载 / 未挂载）', () => {
  it('被任意节拍挂过的算已挂载，其余算未挂载', () => {
    const outlines = [beatEx('o1', 'c1', 1, { cast: ['p1'], scenes: ['s1'] })];
    const r = settingUsage(outlines, [{ id: 'p1' }, { id: 'p2' }, { id: 's1' }, { id: 's2' }]);
    expect(r.attached.sort()).toEqual(['p1', 's1']);
    expect(r.orphan.sort()).toEqual(['p2', 's2']);
  });

  it('无任何节拍时全部未挂载', () => {
    const r = settingUsage([], [{ id: 'p1' }]);
    expect(r).toEqual({ attached: [], orphan: ['p1'] });
  });
});

describe('subtreeAccount（树口径卷账，2026-09-14 方案 A）', () => {
  it('容器不计入：部>卷>章 的账只统计叶章', () => {
    const chapters = [
      node('bu', null, '部', 1),
      node('v1', 'bu', '卷', 2),
      { ...node('c1', 'v1', '章', 3), wordCount: 100, status: 'finished' },
      { ...node('c2', 'v1', '章', 4), wordCount: 50 },
    ];
    const r = subtreeAccount(chapters, 'bu');
    expect(r.rows.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    expect(r.words).toBe(150);
    expect(r.finished).toBe(1);
  });

  it('根自身是叶章（根级章）→ 账就是它自己', () => {
    const chapters = [{ ...node('c1', null, '章'), wordCount: 7 }];
    const r = subtreeAccount(chapters, 'c1');
    expect(r.rows.map((c) => c.id)).toEqual(['c1']);
    expect(r.words).toBe(7);
  });

  it('空 rootId 返回空账（不误扫全表）', () => {
    expect(subtreeAccount([node('c1', null, '章')], '')).toEqual({ rows: [], words: 0, finished: 0 });
  });

  it('parentId 成环不死循环（seen 兜底）', () => {
    const chapters = [node('a', 'b', '卷'), node('b', 'a', '章')];
    const r = subtreeAccount(chapters, 'a');
    expect(r.rows.length).toBeLessThanOrEqual(1);
  });
});

describe('parseChapterCover（章/卷封面唯一口径：宽容解析，绝不抛错）', () => {
  it('合法引用来回解析', () => {
    expect(parseChapterCover('{"coverImage":"assets/writing/illustrations/hi.png"}')).toBe(
      'assets/writing/illustrations/hi.png',
    );
  });

  it('缺失 / 坏 JSON / 空串一律 undefined（创作者主权：无封面≠未完成）', () => {
    expect(parseChapterCover('{}')).toBeUndefined();
    expect(parseChapterCover('{坏')).toBeUndefined();
    expect(parseChapterCover('')).toBeUndefined();
    expect(parseChapterCover(undefined)).toBeUndefined();
  });

  it('非字符串 / 空字符串 coverImage 不算封面', () => {
    expect(parseChapterCover('{"coverImage":123}')).toBeUndefined();
    expect(parseChapterCover('{"coverImage":""}')).toBeUndefined();
  });
});

describe('relatedSettingsOf（A3：反向引用返回全部而非第一条）', () => {
  /** 构造带 relations 的设定，extra 直接落 JSON（与真实存储同形态） */
  function settingWith(id: string, name: string, relations?: WritingRelation[]): WritingSetting {
    return {
      id,
      bookId: 'b1',
      kind: 'character',
      name,
      subtitle: '',
      description: '',
      extra: relations ? JSON.stringify({ relations }) : '{}',
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it('同一引用方挂多条不同 type 的关系行时全部返回（不再只取第一条）', () => {
    // A 对 X 同时有「朋友」和「战友」两条关系；C 对 X 有「对手」。
    const settings = [
      settingWith('a', 'A', [
        { targetId: 'x', target: 'X', type: '朋友' },
        { targetId: 'x', target: 'X', type: '战友' },
      ]),
      settingWith('x', 'X'),
      settingWith('c', 'C', [{ targetId: 'x', target: 'X', type: '对手' }]),
    ];
    const refs = relatedSettingsOf(settings, 'x');
    expect(refs).toHaveLength(3);
    const byId = refs.reduce<Record<string, string[]>>((acc, r) => {
      (acc[r.setting.id] ??= []).push(r.relationType);
      return acc;
    }, {});
    expect(byId.a.sort()).toEqual(['战友', '朋友']);
    expect(byId.c).toEqual(['对手']);
  });

  it('无 targetId 的空关系行 / 指向别处的行不误报', () => {
    const settings = [
      settingWith('a', 'A', [
        { target: '自由文本', type: '旁白' },
        { targetId: 'y', target: 'Y', type: '敌人' },
      ]),
      settingWith('x', 'X'),
    ];
    expect(relatedSettingsOf(settings, 'x')).toEqual([]);
  });

  it('空 targetId 直接返回空数组', () => {
    expect(relatedSettingsOf([settingWith('a', 'A')], '')).toEqual([]);
  });
});

describe('relationTargetName（A2：targetId 命中实时取名，未命中回退快照）', () => {
  function settingWith(id: string, name: string): WritingSetting {
    return {
      id,
      bookId: 'b1',
      kind: 'character',
      name,
      subtitle: '',
      description: '',
      extra: '{}',
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  it('targetId 命中返回设定当前名（改名后正/反向一致），不信任快照', () => {
    const settings = [settingWith('x', 'X 新名')];
    const rel: WritingRelation = { targetId: 'x', target: 'X 旧名', type: '师徒' };
    expect(relationTargetName(settings, rel)).toBe('X 新名');
  });

  it('targetId 未命中（已删 / 无 targetId 的自由文本旧数据）回退快照', () => {
    const settings = [settingWith('y', 'Y')];
    expect(relationTargetName(settings, { targetId: 'x', target: 'X', type: '' })).toBe('X');
    expect(relationTargetName(settings, { target: '自由文本', type: '' })).toBe('自由文本');
  });

  it('空关系 / 空 target 返回空串', () => {
    expect(relationTargetName([], undefined)).toBe('');
    expect(relationTargetName([], { target: '', type: '' })).toBe('');
  });
});
