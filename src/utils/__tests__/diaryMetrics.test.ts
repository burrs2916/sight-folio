/**
 * ㉖ 日记读数的锁（2026-11-10）。
 *
 * 钉住四件事，按"最容易骗人"排序：
 *  1. **时区/DST**：天数差走日历日序号；同一个本地日的 00:01 与 23:59 必须给出一样的读数
 *     （㉕ 那次 `toISOString()` 把晚上写日记记到昨天，就是这一类错）；
 *  2. **不越界解释**：只在首末条目之间数缺口，末条之后到今天不算空档；
 *     连续天数锚在"最后一条记录"上，不替作者判"今天该不该写"；
 *  3. **不撒谎**：没标日期的条目必须报出条数；一条日期都没有时不许出现任何"连续 N 天"；
 *  4. **零回归**：没有 entryDate 的书（= 现在全部非日记书），语料那张表与改造前逐字节相同。
 */
import { describe, it, expect } from 'vitest';
import {
  computeDiaryPeopleFrequency,
  computeDiaryRhythm,
  dateOrdinal,
  diaryRecords,
} from '../diaryMetrics';
import { buildChapterIndexCorpus, buildStatsCorpus } from '../writingCorpus';
import { hasTodayEntryMode, writesByDateForGenre } from '../writingSchema';
import type { WritingChapter } from '../../services/writing';

function chapter(partial: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id: 'c1',
    bookId: 'b1',
    title: '条目',
    content: '',
    sortOrder: 0,
    wordCount: 100,
    status: 'draft',
    volume: '',
    parentId: null,
    kind: '天',
    storylineId: null,
    extra: '{}',
    deletedAt: undefined,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as WritingChapter;
}

/** 带日历日的条目 */
const at = (id: string, date: string, over: Partial<WritingChapter> = {}): WritingChapter =>
  chapter({ id, extra: JSON.stringify({ entryDate: date }), ...over });

/** 没写日期的条目（㉕ 之后仍有一大批：用「＋」或拖货架建的） */
const nodate = (id: string, over: Partial<WritingChapter> = {}): WritingChapter => chapter({ id, ...over });

const localDay = (y: number, m: number, d: number, hour = 12) => new Date(y, m - 1, d, hour, 0, 0);

describe('dateOrdinal —— 天数差只认日历', () => {
  it('相邻两天差 1（含跨月 / 跨年 / 美国夏令时切换那几天）', () => {
    const gap = (a: string, b: string) => (dateOrdinal(a) ?? -9999) - (dateOrdinal(b) ?? -9999);
    expect(gap('2026-03-09', '2026-03-08')).toBe(1);
    expect(gap('2026-03-10', '2026-03-09')).toBe(1);
    expect(gap('2027-01-01', '2026-12-31')).toBe(1);
    expect(gap('2026-03-01', '2026-02-28')).toBe(1);
    // 闰年：2028-02-29 存在，2 月有 29 天
    expect(gap('2028-03-01', '2028-02-28')).toBe(2);
  });

  it('不存在的日期 / 脏串 → null（绝不归一化成"差不多那天"）', () => {
    expect(dateOrdinal('2026-02-30')).toBeNull();
    expect(dateOrdinal('2026-13-01')).toBeNull();
    expect(dateOrdinal('2026-1-2')).toBeNull();
    expect(dateOrdinal('')).toBeNull();
    expect(dateOrdinal('昨天')).toBeNull();
  });
});

describe('computeDiaryRhythm —— 连续 / 空档 / 重复 / 未标日期', () => {
  it('同一个本地日的 00:01 与 23:59，读数必须一模一样（UTC 口径在这里会差一天）', () => {
    // 最后一篇记在 11-08：正确答案是"距上次 2 天"。
    // 为什么不用"今天也记过"那一组来验：daysSinceLast 有 max(0,·) 兜底，
    // UTC 口径在"最后一条就是今天"时会被兜底吃掉、看不出破绽（反向验证第一轮就是这么漏的）。
    const rows = [at('a', '2026-11-07'), at('b', '2026-11-08')];
    const early = computeDiaryRhythm(rows, localDay(2026, 11, 10, 0));
    const late = computeDiaryRhythm(rows, localDay(2026, 11, 10, 23));
    expect(early).toEqual(late);
    expect(early.daysSinceLast).toBe(2);
    expect(early.currentStreak).toBe(2);
  });

  it('连续跨月 / 跨年：连着记就是一天不差', () => {
    const rows = [
      at('a', '2026-12-30'),
      at('b', '2026-12-31'),
      at('c', '2027-01-01'),
      at('d', '2027-01-02'),
    ];
    const r = computeDiaryRhythm(rows, localDay(2027, 1, 2));
    expect(r.currentStreak).toBe(4);
    expect(r.longestStreak).toBe(4);
    expect(r.firstDate).toBe('2026-12-30');
    expect(r.lastDate).toBe('2027-01-02');
    expect(r.gapDays).toBe(0);
    expect(r.gaps).toEqual([]);
  });

  it('只在首末之间数缺口：末条之后到今天不算空档', () => {
    const r = computeDiaryRhythm([at('a', '2026-01-01'), at('b', '2026-01-11')], localDay(2026, 6, 1));
    expect(r.gapDays).toBe(9);
    expect(r.gaps).toEqual([{ from: '2026-01-02', to: '2026-01-10', days: 9 }]);
    // 距上次记录是另一个数，别和空档混成一个概念
    expect(r.daysSinceLast).toBe((dateOrdinal('2026-06-01') ?? 0) - (dateOrdinal('2026-01-11') ?? 0));
  });

  it('多段空档：按天数降序取最长的前几段，同天数按时间先后', () => {
    const rows = [
      at('a', '2026-01-01'),
      at('b', '2026-01-03'), // 空 1 天
      at('c', '2026-01-13'), // 空 9 天
      at('d', '2026-01-16'), // 空 2 天
      at('e', '2026-01-20'), // 空 3 天
    ];
    const r = computeDiaryRhythm(rows, localDay(2026, 1, 20));
    expect(r.gaps.map((g) => g.days)).toEqual([9, 3, 2]);
    expect(r.gapDays).toBe(15);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
  });

  it('连续天数锚在"最后一条记录"，不替作者判今天该不该写', () => {
    const rows = [at('a', '2026-01-01'), at('b', '2026-01-02'), at('c', '2026-01-03')];
    const r = computeDiaryRhythm(rows, localDay(2026, 5, 1));
    expect(r.currentStreak).toBe(3);
    expect(r.daysSinceLast).toBeGreaterThan(100);
    // 今天没写 = daysSinceLast 说事实，界面自己决定怎么提醒
  });

  it('昨天记过：daysSinceLast = 1；今天也记过：= 0', () => {
    const yesterday = computeDiaryRhythm([at('a', '2026-11-09')], localDay(2026, 11, 10));
    expect(yesterday.daysSinceLast).toBe(1);
    expect(yesterday.currentStreak).toBe(1);
    const today = computeDiaryRhythm([at('a', '2026-11-10')], localDay(2026, 11, 10));
    expect(today.daysSinceLast).toBe(0);
  });

  it('同一天写两条：算一天两条，并进 duplicates（㉒ 的欠条，㉕ 有了日期才能还）', () => {
    const r = computeDiaryRhythm([at('a', '2026-11-10'), at('b', '2026-11-10'), at('c', '2026-11-09')], localDay(2026, 11, 10));
    expect(r.entries).toBe(3);
    expect(r.distinctDates).toBe(2);
    expect(r.currentStreak).toBe(2);
    expect(r.duplicates).toEqual([{ date: '2026-11-10', count: 2 }]);
  });

  it('乱序输入不影响任何读数', () => {
    const a = computeDiaryRhythm([at('x', '2026-11-01'), at('y', '2026-11-02'), at('z', '2026-11-03')], localDay(2026, 11, 3));
    const b = computeDiaryRhythm([at('z', '2026-11-03'), at('x', '2026-11-01'), at('y', '2026-11-02')], localDay(2026, 11, 3));
    expect(b).toEqual(a);
  });

  it('脏日期 / 没日期 = 未标日期，不猜、不崩、且必须报数', () => {
    const rows = [
      at('a', '2026-11-10'),
      nodate('b'),
      chapter({ id: 'c', extra: JSON.stringify({ entryDate: '2026-1-2' }) }),
      chapter({ id: 'd', extra: 'not-json' }),
      chapter({ id: 'e', extra: '{"entryDate":123}' }),
    ];
    const r = computeDiaryRhythm(rows, localDay(2026, 11, 10));
    expect(r.entries).toBe(1);
    expect(r.distinctDates).toBe(1);
    expect(r.undatedCount).toBe(4);
    expect(r.currentStreak).toBe(1);
  });

  it('回收站里的条目不参与任何读数（含 undatedCount）', () => {
    const rows = [at('a', '2026-11-10'), nodate('b', { deletedAt: 1762000000 }), chapter({ id: 'c', extra: '{"deletedAt":1}' })];
    const { dated, undatedCount, trashedCount } = diaryRecords(rows);
    expect(dated.map((x) => x.chapterId)).toEqual(['a']);
    expect(undatedCount).toBe(0);
    expect(trashedCount).toBe(2);
    const r = computeDiaryRhythm(rows, localDay(2026, 11, 10));
    expect(r.entries).toBe(1);
    expect(r.undatedCount).toBe(0);
  });

  it('一条日期都没有：全是 0，daysSinceLast = -1（界面据此显示"还没开始"而不是"连续 0 天"）', () => {
    const r = computeDiaryRhythm([nodate('a'), nodate('b')], localDay(2026, 11, 10));
    expect(r).toMatchObject({ entries: 0, distinctDates: 0, currentStreak: 0, longestStreak: 0, daysSinceLast: -1, gapDays: 0, undatedCount: 2 });
    expect(r.firstDate).toBe('');
    expect(r.lastDate).toBe('');
    expect(computeDiaryRhythm([], localDay(2026, 11, 10))).toMatchObject({ entries: 0, daysSinceLast: -1 });
  });

  it('记到未来的日期：不产生负数"距上次记录"（按 0 处理，事实由 lastDate 自己说）', () => {
    const r = computeDiaryRhythm([at('a', '2027-05-01')], localDay(2026, 11, 10));
    expect(r.daysSinceLast).toBe(0);
    expect(r.lastDate).toBe('2027-05-01');
  });
});

describe('computeDiaryPeopleFrequency —— 只拼接现成的提及计数', () => {
  const shen = { id: 's1', name: '沈砚', extra: '{"aliases":["沈公子"]}' };
  const nobody = { id: 's2', name: '周砚白', extra: '{}' };

  it('同一天提到两次 = 2 次 1 天；跨两天 = 2 天', () => {
    const rows = [
      at('a', '2026-11-09', { content: '<p>上午遇见沈砚，下午沈公子又来了。</p>' }),
      at('b', '2026-11-10', { content: '<p>和沈砚散步。</p>' }),
    ];
    const r = computeDiaryPeopleFrequency(rows, [shen, nobody]);
    expect(r).toHaveLength(1); // 零提及的人不进榜（体检那边已经会报"死设定"）
    expect(r[0]).toMatchObject({ settingId: 's1', name: '沈砚', mentions: 3, days: 2 });
  });

  it('没标日期的条目：提及次数照计，天数不计（榜上不许把"不知道哪天"说成一天）', () => {
    const rows = [at('a', '2026-11-10', { content: '<p>沈砚</p>' }), nodate('b', { content: '<p>沈砚与沈砚</p>' })];
    const r = computeDiaryPeopleFrequency(rows, [shen]);
    expect(r[0]).toMatchObject({ mentions: 3, days: 1 });
  });

  it('名字太短（<2 字）不匹配；limit 生效', () => {
    const rows = [at('a', '2026-11-10', { content: '<p>雨雨雨</p>' })];
    expect(computeDiaryPeopleFrequency(rows, [{ id: 's3', name: '雨', extra: '{}' }])).toEqual([]);
    const many = [
      at('a', '2026-11-10', { content: '<p>张三 与李四 和王五 及赵六</p>' }),
    ];
    const settings = ['张三', '李四', '王五', '赵六'].map((n, i) => ({ id: `p${i}`, name: n, extra: '{}' }));
    expect(computeDiaryPeopleFrequency(many, settings, 2)).toHaveLength(2);
  });
});

describe('㉖ 体裁闸门：一份判据两种意图', () => {
  it('只有日记按日期写；未设置 / 脏值 / 大小写都不算', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', '', 'Diary', 'diaryy']) {
      expect(writesByDateForGenre(g), g).toBe(g === 'diary');
    }
  });

  it('「今天」按钮与读数共用同一条判据（写两份迟早漂）', () => {
    for (const g of ['diary', 'novel', '']) {
      expect(hasTodayEntryMode(g), g).toBe(writesByDateForGenre(g));
    }
  });
});

describe('㉖ AI 语料：第一次把日期与节奏交给模型', () => {
  const dated = [
    at('a', '2026-11-08', { title: '2026年11月8日', content: '<p>下雨</p>' }),
    at('b', '2026-11-10', { title: '2026年11月10日', content: '<p>放晴</p>' }),
  ];
  const undated = [nodate('a', { title: '第 1 天' }), nodate('b', { title: '第 2 天' })];

  it('零回归：没有 entryDate 的表，列与行与改造前逐字节相同', () => {
    const { zh, en } = buildChapterIndexCorpus(undated);
    expect(zh[0]).toBe('| 序号 | 标题 | 字数 | 状态 |');
    expect(en[0]).toBe('| # | Title | Words | Status |');
    expect(zh.join('\n')).not.toContain('日期');
    expect(en.join('\n')).not.toContain('Date');
  });

  it('有条目带日期 → 多一列「日期」，值就是 extra.entryDate（空档命令要的数）', () => {
    const { zh, en } = buildChapterIndexCorpus(dated);
    expect(zh[0]).toBe('| 序号 | 日期 | 标题 | 字数 | 状态 |');
    expect(en[0]).toBe('| # | Date | Title | Words | Status |');
    expect(zh.join('\n')).toContain('| 2026-11-08 |');
    expect(en.join('\n')).toContain('| 2026-11-10 |');
  });

  it('日记统计语料里有节奏行，且未标日期的条数一并交代', () => {
    const rows = [...dated, nodate('c', { title: '第 3 天' })];
    const { zh, en } = buildStatsCorpus('日记本', rows, [], null, 'diary');
    expect(zh).toContain('〔记录节奏〕连续 1 天');
    expect(zh).toContain('2026-11-09~2026-11-09 1 天');
    expect(zh).toContain('另有 1 条未标日期');
    expect(en).toContain('[Journal rhythm] 1-day streak');
    expect(en).toContain('1 undated entries stay out');
  });

  it('一条日期都没有时，语料不许出现"连续 N 天"，而要写不可推断', () => {
    const { zh, en } = buildStatsCorpus('日记本', undated, [], null, 'diary');
    expect(zh).toContain('暂无带日期的条目');
    expect(zh).toContain('不要凭条目序号猜日期');
    expect(zh).not.toContain('连续 0 天');
    expect(en).toContain('not inferable');
  });

  it('非日记体裁一个字节不变（节奏行只属于按日期写的体裁）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', ''] as const) {
      const { zh, en } = buildStatsCorpus('书', dated, [], null, g);
      expect(zh, g).not.toContain('记录节奏');
      expect(en, g).not.toContain('Journal rhythm');
    }
    expect(buildStatsCorpus('书', dated, [], null).zh).not.toContain('记录节奏');
  });
});
