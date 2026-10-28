// 一致性组规则单测（批次② 增-4）——跨章人物账本：设定卡 vs 正文提及。
//
// 这些规则的风险不是"漏报"而是**误报**：报假问题会让作者不再相信体检。
// 所以除了正向命中，这里重点锁反向边界：单字名不参评、整本未写不算死设定、
// 短书不报断档、疑似别名不再重复报"没出场"、不传 settings 时整组静默。
import { describe, it, expect } from 'vitest';
import {
  buildProofreadReport,
  computeSettingAppearances,
  consistencyFindings,
  normalizeSettingName,
  settingMentionTerms,
} from '../writingProofread';
import type { WritingChapter } from '../../services/tauri';

type Setting = { id: string; name: string; extra: string };

const ch = (id: string, content = '', sortOrder = 0): WritingChapter =>
  ({
    id,
    bookId: 'b1',
    title: id,
    content,
    sortOrder,
    wordCount: content.length,
    status: 'draft',
    volume: '',
    kind: '章',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as WritingChapter;

const st = (id: string, name: string, extra = '{}'): Setting => ({ id, name, extra });

/** 造 N 章有正文的章（默认内容为无关字，不会误命中设定名） */
function many(n: number, patch: Record<number, string> = {}): WritingChapter[] {
  return Array.from({ length: n }, (_, i) => ch(`c${i}`, patch[i] ?? `第${i}章的普通正文内容。`, i));
}

describe('normalizeSettingName', () => {
  it('剥空白/书名号/间隔号，用于判定同一人', () => {
    expect(normalizeSettingName('《沈 砚·青冥》')).toBe('沈砚青冥');
    expect(normalizeSettingName(' 沈砚 ')).toBe('沈砚');
    expect(normalizeSettingName('')).toBe('');
  });
});

describe('settingMentionTerms', () => {
  it('卡名 ∪ extra.aliases；长度 < 2 的写法剔除', () => {
    expect(settingMentionTerms({ name: '沈砚', extra: '{"aliases":["沈公子","砚"]}' })).toEqual(['沈砚', '沈公子']);
  });

  it('extra 是脏数据时按无别名处理，绝不抛', () => {
    expect(settingMentionTerms({ name: '沈砚', extra: 'not-json' })).toEqual(['沈砚']);
    expect(settingMentionTerms({ name: '沈砚', extra: '' })).toEqual(['沈砚']);
    expect(settingMentionTerms({ name: '墨', extra: '{}' })).toEqual([]);
  });
});

describe('computeSettingAppearances', () => {
  it('跨章求和，别名同样计入，并按章序列出出场章', () => {
    const chapters = [ch('c1', '沈砚推门进来。', 0), ch('c2', '谁也没说话。', 1), ch('c3', '沈砚与沈公子对坐。', 2)];
    const [row] = computeSettingAppearances(chapters, [st('s1', '沈砚', '{"aliases":["沈公子"]}')]);
    expect(row?.total).toBe(3);
    expect(row?.chapterIds).toEqual(['c1', 'c3']);
    expect(row?.neverMentioned).toBe(false);
  });

  it('整本还没有正文时不得判成"全部缺席"（否则新书一打开就满屏假问题）', () => {
    const rows = computeSettingAppearances([ch('c1', '', 0), ch('c2', '   ', 1)], [st('s1', '沈砚')]);
    expect(rows[0]?.total).toBe(0);
    expect(rows[0]?.neverMentioned).toBe(false);
  });

  it('最长断档按章序计算', () => {
    const chapters = [
      ch('c0', '沈砚出场', 0),
      ch('c1', '路人正文', 1),
      ch('c2', '路人正文', 2),
      ch('c3', '沈砚再现', 3),
    ];
    const [row] = computeSettingAppearances(chapters, [st('s1', '沈砚')]);
    expect(row?.maxGap).toBe(2);
  });
});

describe('consistencyFindings', () => {
  it('归一化后重名的两张卡 → block 级发现', () => {
    const issues = consistencyFindings([ch('c1', '正文里没有名字出现。', 0)], [st('s1', '沈砚'), st('s2', '沈 砚')]);
    const dup = issues.find((i) => i.messageKey === 'DuplicateSettingName');
    expect(dup?.severity).toBe('block');
    expect(dup?.group).toBe('consistency');
    expect(dup?.args?.names).toContain('沈砚');
  });

  it('零提及设定 → 死设定告警（不依赖手动解析全书）', () => {
    const issues = consistencyFindings([ch('c1', '他一个人走进了雨里。', 0)], [st('s9', '青冥剑宗')]);
    const dead = issues.find((i) => i.messageKey === 'ZeroMentionSetting');
    expect(dead?.args?.name).toBe('青冥剑宗');
    // 点行必须能落到那张卡上，而不是泛泛的「人物页签」
    expect(dead?.target).toEqual({ type: 'setting', id: 's9' });
  });

  it('零提及且构成前缀关系 → 改报"疑似别名未登记"，且不再重复报死设定', () => {
    const issues = consistencyFindings(
      [ch('c1', '沈砚在窗前坐着。', 0), ch('c2', '沈砚离开了。', 1)],
      [st('s1', '沈砚'), st('s2', '沈砚青冥')],
    );
    const alias = issues.find((i) => i.messageKey === 'SuspectedUnregisteredAlias');
    expect(alias?.args?.name).toBe('沈砚青冥');
    expect(alias?.args?.other).toBe('沈砚');
    // 互斥：同一张卡不能被报两次
    expect(issues.some((i) => i.messageKey === 'ZeroMentionSetting' && i.args?.name === '沈砚青冥')).toBe(false);
  });

  it('断档 ≥ 30 章且全书 ≥ 40 章才报长期失踪', () => {
    const long = many(45, { 0: '沈砚出场。', 40: '沈砚回归。' });
    const issues = consistencyFindings(long, [st('s1', '沈砚')]);
    const absent = issues.find((i) => i.messageKey === 'SettingLongAbsent');
    expect(absent?.args?.gap).toBe(39);

    // 同样的相对结构，但书太短 → 不报（短书报断档纯属噪音）
    const short = many(12, { 0: '沈砚出场。', 10: '沈砚再现。' });
    expect(
      consistencyFindings(short, [st('s1', '沈砚')]).some((i) => i.messageKey === 'SettingLongAbsent'),
    ).toBe(false);
  });

  it('断档 48 章要报；每章都出场的不报', () => {
    const issues = consistencyFindings(many(50, { 0: '沈砚在。', 49: '沈砚还在。' }), [st('s1', '沈砚')]);
    expect(issues.some((i) => i.messageKey === 'SettingLongAbsent')).toBe(true); // 中间 48 章无人，确实失踪
    const continuous = consistencyFindings(
      Array.from({ length: 50 }, (_, i) => ch(`c${i}`, `沈砚于第${i}章。`, i)),
      [st('s1', '沈砚')],
    );
    expect(continuous.some((i) => i.messageKey === 'SettingLongAbsent')).toBe(false);
  });

  it('没有设定卡时整组静默', () => {
    expect(consistencyFindings([ch('c1', '正文')], [])).toEqual([]);
  });
});

describe('buildProofreadReport 一致性接入', () => {
  const chapters = [ch('c1', '他走进雨里。', 0)];

  it('不传 settings → consistency 计数为 0（老调用点向后兼容，不会突然多出发现）', () => {
    const r = buildProofreadReport(chapters, [], [], [], []);
    expect(r.counts.consistency).toBe(0);
    expect(r.issues.some((i) => i.group === 'consistency')).toBe(false);
  });

  it('传 settings → consistency 计数与 issues 一致', () => {
    const r = buildProofreadReport(chapters, [], [], [], [], [st('s1', '青冥剑宗')]);
    expect(r.counts.consistency).toBeGreaterThan(0);
    expect(r.issues.filter((i) => i.group === 'consistency')).toHaveLength(r.counts.consistency);
  });

  it('空剧情线：一条报线名，多条报计数，挂满事件则不报', () => {
    const one = buildProofreadReport(chapters, [], [], [], [{ id: 'l1', name: '复仇线' }]);
    expect(one.issues.some((i) => i.messageKey === 'StorylineEmptyOne' && i.args?.name === '复仇线')).toBe(true);

    const two = buildProofreadReport(chapters, [], [], [], [{ id: 'l1' }, { id: 'l2' }]);
    const row = two.issues.find((i) => i.messageKey === 'StorylineEmptyRow');
    expect(row?.args?.n).toBe(2);

    const events = [{ id: 'e1', bookId: 'b1', at: '', event: 'x', chapterId: null, storylineId: 'l1', extra: '{}' }];
    const used = buildProofreadReport(chapters, [], events as never, [], [{ id: 'l1', name: '复仇线' }]);
    expect(used.issues.some((i) => i.messageKey.startsWith('StorylineEmpty'))).toBe(false);
  });
});
