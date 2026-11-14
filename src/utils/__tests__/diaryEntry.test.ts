/**
 * ㉕ 日记「哪天」的锁（2026-11-10）。
 *
 * 这三条最容易坏、也最值得钉：
 *  1. **本地日期**：`toISOString()` 是 UTC，晚上写日记会记到昨天去；
 *  2. **合并写回**：`extra` 里住着回收站的 `deletedAt` 和章头图，写日期把它们冲掉就是造 bug；
 *  3. **非日记体裁的输出逐字不变**：树行尾注现在是"过滤空串再 join"，
 *     机制上多写一个分隔符都不会被肉眼发现，只能靠断言。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import {
  DIARY_DATE_RE,
  diaryDateParts,
  diaryDateShort,
  diaryEntryTitle,
  findEntryByDate,
  isDiaryDateKey,
  parseDiaryDate,
  todayDateKey,
  writeDiaryDate,
} from '../diaryEntry';
import { hasTodayEntryMode, genreDef } from '../writingSchema';
import { setLang, t } from '../../i18n';
import type { WritingChapter } from '../../services/writing';

function chapter(partial: Partial<WritingChapter> = {}): WritingChapter {
  return {
    id: 'c1',
    bookId: 'b1',
    title: '第 1 天',
    content: '',
    sortOrder: 0,
    wordCount: 0,
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

describe('㉕ 本地日期口径', () => {
  // 这组用例的靶心是「东八区深夜」相对「UTC 昨天」的差，天然要求运行环境是 UTC+8。
  // 本地 Mac 默认东八区能过，但 GitHub runner 默认 UTC 会翻车——所以这里显式钉死时区，
  // 让锁在任何机器/任何 CI 上都按设计意图（东八区）出结果，而不是依赖外部环境。
  let prevTz: string | undefined;
  beforeAll(() => {
    prevTz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
  });
  afterAll(() => {
    process.env.TZ = prevTz;
  });

  it('深夜算今天，不算昨天（这是 UTC 口径最容易翻车的一刻）', () => {
    // 2026-11-11 00:30 (+08:00) → 本地是 11-11，但 UTC 还是 11-10
    const late = new Date('2026-11-11T00:30:00+08:00');
    expect(todayDateKey(late)).toBe('2026-11-11');
    // 反面证据：同这一刻用 UTC 口径会得到 11-10 —— 那正是这条锁存在的理由
    expect(late.toISOString().slice(0, 10)).toBe('2026-11-10');
    // 2026-11-10 23:30 (+08:00) → 本地 11-10，UTC 已是 11-10 15:30（同一天，反向也要对）
    const night = new Date('2026-11-10T23:30:00+08:00');
    expect(todayDateKey(night)).toBe('2026-11-10');
  });

  it('月/日补零，串形状唯一', () => {
    expect(todayDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(DIARY_DATE_RE.test('2026-1-5')).toBe(false);
  });
});

describe('㉕ extra 读写', () => {
  it('解析：合法值取回、脏值与缺字段一律空串', () => {
    expect(parseDiaryDate('{"entryDate":"2026-11-10"}')).toBe('2026-11-10');
    expect(parseDiaryDate('{}')).toBe('');
    expect(parseDiaryDate('')).toBe('');
    expect(parseDiaryDate('不是 JSON')).toBe('');
    expect(parseDiaryDate('{"entryDate":"11/10"}')).toBe('');
    expect(parseDiaryDate('{"entryDate":20261110}')).toBe('');
    expect(parseDiaryDate(undefined)).toBe('');
  });

  it('合并写回：不许冲掉 deletedAt 与章头图（extra 是共用的）', () => {
    const merged = writeDiaryDate('{"deletedAt":0,"cover":"a.png"}', '2026-11-10');
    const obj = JSON.parse(merged);
    expect(obj.entryDate).toBe('2026-11-10');
    expect(obj.cover).toBe('a.png');
    expect('deletedAt' in obj).toBe(true);
    // 传非法日期 = 取消标记，且仍然不碰别的键
    const cleared = JSON.parse(writeDiaryDate(merged, '11/10'));
    expect('entryDate' in cleared).toBe(false);
    expect(cleared.cover).toBe('a.png');
    // 空 extra 也要能写
    expect(JSON.parse(writeDiaryDate(undefined, '2026-11-10')).entryDate).toBe('2026-11-10');
  });

  it('坏 extra 不能抛异常（脏数据不许崩渲染）', () => {
    expect(() => writeDiaryDate('[[[', '2026-11-10')).not.toThrow();
    expect(JSON.parse(writeDiaryDate('[[[', '2026-11-10')).entryDate).toBe('2026-11-10');
  });
});

describe('㉕ 日期显示与"那一天已有条目"', () => {
  afterEach(() => setLang('zh-CN'));

  it('中文标题是「2026年11月10日」，短日期是 11/10；英文换形', () => {
    setLang('zh-CN');
    expect(diaryEntryTitle('2026-11-10')).toBe('2026年11月10日');
    expect(diaryDateShort('2026-11-10')).toBe('11/10');
    expect(diaryDateShort('')).toBe('');
    expect(diaryEntryTitle('')).toBe('');
    setLang('en-US');
    expect(diaryEntryTitle('2026-11-10')).toBe('11/10/2026');
    expect(diaryDateParts('2026-11-10')).toEqual({ y: 2026, m: 11, d: 10 });
  });

  it('找当天条目：跳过回收站里的那些', () => {
    const today = chapter({ id: 'a', extra: '{"entryDate":"2026-11-10"}' });
    const stale = chapter({ id: 'b', extra: '{"entryDate":"2026-11-09"}' });
    const deleted = chapter({ id: 'c', extra: '{"entryDate":"2026-11-08","deletedAt":1730000000}' });
    const list = [stale, deleted, today];
    expect(findEntryByDate(list, '2026-11-10')?.id).toBe('a');
    expect(findEntryByDate(list, '2026-11-09')?.id).toBe('b');
    expect(findEntryByDate(list, '2026-11-08'), '回收站里的条目不算"那一天已有"').toBeUndefined();
    expect(findEntryByDate(list, '乱码')).toBeUndefined();
    expect(findEntryByDate([], '2026-11-10')).toBeUndefined();
  });
});

describe('㉕ 体裁判据与接线', () => {
  it('hasTodayEntryMode 只认 diary（组件里不许出现 genre 字面量）', () => {
    expect(hasTodayEntryMode('diary')).toBe(true);
    for (const g of ['novel', 'essay', 'poetry', 'script', '', 'Diary']) {
      expect(hasTodayEntryMode(g), g).toBe(false);
    }
    expect(genreDef('diary')?.ready).toBe(true);
  });

  it('建条目时 extra 走"不传=逐字不变"的路（其余体裁零回归）', () => {
    const s = readFileSync('src/store/writingStore.ts', 'utf-8');
    expect(s).toContain("createChapter: async (title: string, extra?: string) => {");
    expect(s).toContain("extra: extra ?? '{}',");
  });

  it('「今天」按钮挂在写作台且只由判据控制；树行尾注用过滤后 join（非日记体裁不多分隔符）', () => {
    const page = readFileSync('src/pages/WritingPage.tsx', 'utf-8');
    expect(page).toContain("{hasTodayEntryMode(activeBook?.genre ?? '') && (");
    expect(page).toContain('onClick={openOrCreateTodayEntry}');
    expect(page).not.toContain("activeBook?.genre === 'diary'");
    const tree = readFileSync('src/pages/ChapterTreePanel.tsx', 'utf-8');
    expect(tree).toContain('.filter(Boolean)');
    expect(tree).toContain("diaryDateShort(parseDiaryDate(ch.extra))");
  });

  it('双语都在（todayTip/todayTitle/todayCreated/todayOpened/dateShort）', () => {
    const zh = JSON.parse(readFileSync('src/i18n/zh-CN.json', 'utf-8'));
    const en = JSON.parse(readFileSync('src/i18n/en-US.json', 'utf-8'));
    for (const k of ['todayTip', 'todayTitle', 'todayCreated', 'todayOpened', 'dateShort']) {
      expect(typeof zh.writing.diary[k], `zh 缺 ${k}`).toBe('string');
      expect(typeof en.writing.diary[k], `en 缺 ${k}`).toBe('string');
    }
    setLang('zh-CN');
    expect(t('writing.diary.todayTitle', { y: 2026, m: 11, d: 10 })).toBe('2026年11月10日');
  });
});

describe('isDiaryDateKey（㉘ 补的口）：形状对不等于这一天真的存在', () => {
  it('真实存在的天才算数（含闰日）', () => {
    for (const v of ['2026-11-10', '2028-02-29', '2026-02-28', '2026-12-31']) {
      expect(isDiaryDateKey(v), v).toBe(true);
    }
  });

  it('不存在的一天 / 没补零 / 带尾巴 / 非字符串 一律不算', () => {
    for (const v of ['2026-11-31', '2026-02-30', '2026-13-01', '2026-1-2', '', '昨天', '2026-11-10T00:00:00']) {
      expect(isDiaryDateKey(v), v).toBe(false);
    }
    expect(isDiaryDateKey(20261110)).toBe(false);
    expect(isDiaryDateKey(undefined)).toBe(false);
    expect(isDiaryDateKey(null)).toBe(false);
  });

  it('读写两侧都吃这一条判据：不存在的日子既读不出来也存不进去', () => {
    expect(parseDiaryDate(JSON.stringify({ entryDate: '2026-11-31' }))).toBe('');
    expect(writeDiaryDate(JSON.stringify({ entryDate: '2026-11-10' }), '2026-11-31')).toBe('{}');
    // 合法值照旧合并写，不认识的键留着
    expect(writeDiaryDate(JSON.stringify({ coverImage: 'a.png' }), '2026-11-10')).toBe(
      '{"coverImage":"a.png","entryDate":"2026-11-10"}',
    );
  });
});
