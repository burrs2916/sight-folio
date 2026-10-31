// utils/writingStats 单测：KPI / 卷分布 / 章节体量离群 / 日更快照差分
// 锁死口径（pane、右栏总览卡、AI 语料三处共用这一份，口径错即三处同错）。
// 2026-09-28：新增树模型卷归属用例——新结构树（parentId + kind）下章挂在卷节点下，
// volume 字段恒为 ''，卷归属按树解析（回归「统计显示未分卷」bug）。
import { describe, it, expect } from 'vitest';
import {
  buildChapterWordRows,
  buildVolumeRows,
  chapterOutlier,
  computeWritingKpis,
  diffDailyStats,
  goalProgress,
  localDay,
  resolveVolumeResolver,
  volumeNameOf,
  contentChapters,
  deriveBookGoalProgress,
  inputToDeadline,
  deadlineToInput,
  resolveBookGoalInput,
} from '../writingStats';
import type { WritingChapter, WritingDailyStat, WritingSetting } from '../../services/tauri';

const ch = (o: Partial<WritingChapter> & { id: string }): WritingChapter =>
  ({
    bookId: 'b1',
    title: o.id,
    content: '',
    sortOrder: 0,
    wordCount: 0,
    status: 'draft',
    volume: '',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
    ...o,
  }) as WritingChapter;

const setting = (id: string): WritingSetting =>
  ({
    id,
    bookId: 'b1',
    name: id,
    kind: 'character',
    content: '{}',
    extra: '{}',
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as WritingSetting;

describe('computeWritingKpis', () => {
  it('汇总总字数/章节数/卷数/设定数/章均（未分卷不算卷）', () => {
    const chapters = [
      ch({ id: 'c1', wordCount: 1000, volume: '第一卷' }),
      ch({ id: 'c2', wordCount: 2000, volume: '第一卷' }),
      ch({ id: 'c3', wordCount: 3000, volume: '' }),
    ];
    const kpis = computeWritingKpis(chapters, [setting('s1'), setting('s2')]);
    expect(kpis.totalWords).toBe(6000);
    expect(kpis.chapterCount).toBe(3);
    expect(kpis.volumeCount).toBe(1); // 空卷名不是一卷
    expect(kpis.settingCount).toBe(2);
    expect(kpis.avgWords).toBe(2000);
    expect(kpis.maxChapterWords).toBe(3000);
  });

  it('空书全 0 不炸', () => {
    const kpis = computeWritingKpis([], []);
    expect(kpis.totalWords).toBe(0);
    expect(kpis.avgWords).toBe(0);
    expect(kpis.maxVolumeWords).toBe(0);
  });
});

describe('buildVolumeRows', () => {
  it('按首次出现顺序归组，完稿计数', () => {
    const chapters = [
      ch({ id: 'c1', wordCount: 100, volume: '卷二', status: 'finished' }),
      ch({ id: 'c2', wordCount: 200, volume: '卷一' }),
      ch({ id: 'c3', wordCount: 300, volume: '卷二' }),
    ];
    const rows = buildVolumeRows(chapters);
    expect(rows.map((r) => r.volume)).toEqual(['卷二', '卷一']); // 首现顺序
    expect(rows[0]).toMatchObject({ chapters: 2, words: 400, finished: 1 });
    expect(rows[0].chapterIds).toEqual(['c1', 'c3']);
  });

  it('回归：树模型（parentId + kind）下章归其卷标题组，卷节点不算章', () => {
    // 与真实 DB 形态一致：卷节点 kind='卷'/volume=''，章挂卷下（parentId），volume=''
    const chapters = [
      ch({ id: 'v1', title: '卷一', kind: '卷' }),
      ch({ id: 'c1', title: '第一章', parentId: 'v1' }),
      ch({ id: 'c2', title: '第二章', parentId: 'v1', wordCount: 100 }),
      ch({ id: 'v2', title: '卷二', kind: '卷' }),
      ch({ id: 'c3', title: '第三章', parentId: 'v2', wordCount: 200, status: 'finished' }),
    ];
    const rows = buildVolumeRows(chapters);
    expect(rows.map((r) => r.volume)).toEqual(['卷一', '卷二']);
    expect(rows[0]).toMatchObject({ chapters: 2, words: 100, finished: 0 });
    expect(rows[1]).toMatchObject({ chapters: 1, words: 200, finished: 1 });
    expect(rows[0].chapterIds).toEqual(['c1', 'c2']);
  });

  it('树模型：挂在根下的章仍归未分卷', () => {
    const chapters = [
      ch({ id: 'v1', title: '卷一', kind: '卷' }),
      ch({ id: 'c1', title: '第一章', parentId: 'v1' }),
      ch({ id: 'c2', title: '散章' }),
    ];
    const rows = buildVolumeRows(chapters);
    expect(rows.map((r) => r.volume)).toEqual(['卷一', '']);
    expect(rows[1].chapters).toBe(1);
  });
});

describe('树模型卷解析原语（resolveVolumeResolver / volumeNameOf / contentChapters）', () => {
  it('旧模型书（无 parentId）回退 volume 字段', () => {
    const chapters = [ch({ id: 'c1', volume: '第一卷' }), ch({ id: 'c2', volume: '' })];
    const r = resolveVolumeResolver(chapters);
    expect(r.legacy).toBe(true);
    expect(volumeNameOf(r, chapters[0])).toBe('第一卷');
    expect(volumeNameOf(r, chapters[1])).toBe('');
    expect(contentChapters(r, chapters)).toHaveLength(2); // 旧模型全部是章
  });

  it('新模型书：沿 parentId 找最近卷级祖先，卷节点过滤为结构节点', () => {
    const chapters = [ch({ id: 'v1', title: '卷一', kind: '卷' }), ch({ id: 'c1', title: '第一章', parentId: 'v1' })];
    const r = resolveVolumeResolver(chapters);
    expect(r.legacy).toBe(false);
    expect(volumeNameOf(r, chapters[1])).toBe('卷一');
    expect(volumeNameOf(r, chapters[0])).toBe(''); // 卷节点自身无卷归属
    const content = contentChapters(r, chapters);
    expect(content.map((c) => c.id)).toEqual(['c1']); // 卷节点不算内容章
  });
});

describe('computeWritingKpis（树模型）', () => {
  it('卷节点不算章节数；卷数按树归属去重（未分卷不算卷）', () => {
    const chapters = [
      ch({ id: 'v1', title: '卷一', kind: '卷' }),
      ch({ id: 'c1', title: '第一章', parentId: 'v1', wordCount: 1000 }),
      ch({ id: 'c2', title: '第二章', parentId: 'v1', wordCount: 2000 }),
      ch({ id: 'v2', title: '卷二', kind: '卷' }),
      ch({ id: 'c3', title: '散章', wordCount: 500 }),
    ];
    const kpis = computeWritingKpis(chapters, [setting('s1')]);
    expect(kpis.chapterCount).toBe(3); // 两个卷节点 + 3 章 → 只数 3 章
    expect(kpis.volumeCount).toBe(1); // 卷一有章、卷二空 → 只数「真有章的卷」
    expect(kpis.totalWords).toBe(3500);
    expect(kpis.avgWords).toBe(Math.round(3500 / 3));
  });
});

describe('buildChapterWordRows（树模型）', () => {
  it('卷节点不进排行，volume 列显示树归属卷名', () => {
    const chapters = [
      ch({ id: 'v1', title: '卷一', kind: '卷' }),
      ch({ id: 'c1', title: '第一章', parentId: 'v1', wordCount: 500, sortOrder: 1 }),
      ch({ id: 'c2', title: '第二章', parentId: 'v1', wordCount: 1500, sortOrder: 2 }),
    ];
    const rows = buildChapterWordRows(chapters);
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2']); // 无卷节点行
    expect(rows.every((r) => r.volume === '卷一')).toBe(true);
  });
});

describe('chapterOutlier / buildChapterWordRows', () => {
  it('超长 = >2×章均；偏短 = <0.3×章均且章数≥3', () => {
    // 章均 2000：4000 不算超长（边界），4001 超长；500 偏短，600 不算
    expect(chapterOutlier(4000, 2000, 5)).toBeNull();
    expect(chapterOutlier(4001, 2000, 5)).toBe('long');
    expect(chapterOutlier(500, 2000, 5)).toBe('short');
    expect(chapterOutlier(600, 2000, 5)).toBeNull();
    // 0 字章不标偏短（空章是章账的事，不是体量离群）
    expect(chapterOutlier(0, 2000, 5)).toBeNull();
    // 1~2 章的书不标偏短（短篇常态）
    expect(chapterOutlier(100, 2000, 2)).toBeNull();
  });

  it('buildChapterWordRows 保持章序并带离群标注', () => {
    const chapters = [
      ch({ id: 'c1', title: '第一章', wordCount: 1000, sortOrder: 1 }),
      ch({ id: 'c2', title: '第二章', wordCount: 9000, sortOrder: 2 }),
      ch({ id: 'c3', title: '第三章', wordCount: 1000, sortOrder: 3 }),
    ];
    // 章均 ≈ 3667：9000 > 2× → long；1000 < 0.3× → short
    const rows = buildChapterWordRows(chapters);
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
    expect(rows[0].outlier).toBe('short');
    expect(rows[1].outlier).toBe('long');
    expect(rows[2].outlier).toBe('short');
  });
});

describe('diffDailyStats', () => {
  it('快照差分出每日新增；缺快照沿用最近已知总量（不归零）', () => {
    const today = new Date(2026, 8, 20); // 本地 2026-09-20
    const stats: WritingDailyStat[] = [
      { day: localDay(new Date(2026, 8, 18)), wordCount: 1000 },
      { day: localDay(new Date(2026, 8, 20)), wordCount: 2500 },
      // 09-19 缺快照
    ];
    const deltas = diffDailyStats(stats, today);
    expect(deltas).toHaveLength(30);
    // 末三位：09-18 前基线之后…直接按 day 查
    const byDay = new Map(deltas.map((d) => [d.day, d.delta]));
    expect(byDay.get('2026-09-19')).toBe(0); // 缺快照 → 总量没变
    expect(byDay.get('2026-09-20')).toBe(1500); // 2500 - 1000
  });

  it('负差分钳为 0（防回退噪声）', () => {
    const today = new Date(2026, 8, 20);
    const stats: WritingDailyStat[] = [
      { day: localDay(new Date(2026, 8, 19)), wordCount: 2000 },
      { day: localDay(new Date(2026, 8, 20)), wordCount: 500 }, // 异常回退
    ];
    const deltas = diffDailyStats(stats, today);
    expect(deltas[deltas.length - 1]?.delta).toBe(0);
  });
});

describe('goalProgress（批次④ T6 底栏进度可视化口径）', () => {
  it('进度百分比四舍五入、上限 100；未达标给出剩余字数', () => {
    expect(goalProgress(500, 1000)).toEqual({ pct: 50, remain: 500, hit: false });
    expect(goalProgress(1234, 1000)).toEqual({ pct: 100, remain: 0, hit: true });
    expect(goalProgress(1050, 1000)).toEqual({ pct: 100, remain: 0, hit: true });
  });

  it('负 delta 钳为 0；goal ≤ 0 视为未设目标返回 null', () => {
    expect(goalProgress(-50, 1000)).toEqual({ pct: 0, remain: 1000, hit: false });
    expect(goalProgress(500, 0)).toBeNull();
    expect(goalProgress(500, -10)).toBeNull();
  });

  it('达标瞬间：余量为 0、百分比封顶', () => {
    expect(goalProgress(1000, 1000)).toEqual({ pct: 100, remain: 0, hit: true });
  });
});

describe('全书目标派生（工作室/写作台共用单一权威）', () => {
  const TODAY = new Date(2026, 9, 31); // 本地 2026-10-31
  const secOf = (y: number, mo: number, d: number) => Math.floor(new Date(y, mo - 1, d).getTime() / 1000);

  it('未设任何目标：word/chapter 均 null、daysLeft null（不画进度条）', () => {
    const p = deriveBookGoalProgress({ targetWords: 0, targetChapters: 0, deadline: 0 }, 5000, 10, TODAY);
    expect(p).toEqual({ word: null, chapter: null, daysLeft: null });
  });

  it('总字数达成率四舍五入、封顶 100、达标 hit', () => {
    const p = deriveBookGoalProgress({ targetWords: 10000, targetChapters: 0, deadline: 0 }, 3333, 0, TODAY);
    expect(p.word).toEqual({ pct: 33, hit: false, target: 10000, actual: 3333 });
    const hit = deriveBookGoalProgress({ targetWords: 10000, targetChapters: 0, deadline: 0 }, 25000, 0, TODAY);
    expect(hit.word).toMatchObject({ pct: 100, hit: true });
  });

  it('负数实际量按 0 截断（脏数据不致负进度）', () => {
    const p = deriveBookGoalProgress({ targetWords: 100, targetChapters: 5, deadline: 0 }, -50, -2, TODAY);
    expect(p.word).toMatchObject({ pct: 0, actual: 0, hit: false });
    expect(p.chapter).toMatchObject({ pct: 0, actual: 0 });
  });

  it('章节数达成率独立于字数目标（只设其一时另一项 null）', () => {
    const p = deriveBookGoalProgress({ targetWords: 0, targetChapters: 8, deadline: 0 }, 0, 6, TODAY);
    expect(p.word).toBeNull();
    expect(p.chapter).toMatchObject({ pct: 75, hit: false });
  });

  it('剩余天数：截止日当天=0，未来=正，过期=负', () => {
    expect(deriveBookGoalProgress({ targetWords: 0, targetChapters: 0, deadline: secOf(2026, 10, 31) }, 0, 0, TODAY).daysLeft).toBe(0);
    expect(deriveBookGoalProgress({ targetWords: 0, targetChapters: 0, deadline: secOf(2026, 11, 10) }, 0, 0, TODAY).daysLeft).toBe(10);
    expect(deriveBookGoalProgress({ targetWords: 0, targetChapters: 0, deadline: secOf(2026, 10, 25) }, 0, 0, TODAY).daysLeft).toBe(-6);
  });

  it('inputToDeadline ↔ deadlineToInput 往返一致（本地零点口径）', () => {
    expect(deadlineToInput(0)).toBe('');
    expect(deadlineToInput(secOf(2026, 11, 10))).toBe('2026-11-10');
    expect(inputToDeadline('2026-11-10')).toBe(secOf(2026, 11, 10));
    expect(inputToDeadline('')).toBe(0);
    expect(inputToDeadline('bad-date')).toBe(0);
    expect(inputToDeadline('2026-13-40')).not.toBe(0); // 仍解析（跨月溢出为合法时间戳），不归 0
  });

  it('resolveBookGoalInput：非法/空字段归 0，与写作台提交同口径', () => {
    expect(resolveBookGoalInput('120000', '24', '2026-12-31')).toEqual({
      targetWords: 120000,
      targetChapters: 24,
      deadline: secOf(2026, 12, 31),
    });
    expect(resolveBookGoalInput('', 'abc', '')).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
    expect(resolveBookGoalInput('-5', '0', '')).toEqual({ targetWords: 0, targetChapters: 0, deadline: 0 });
  });
});
