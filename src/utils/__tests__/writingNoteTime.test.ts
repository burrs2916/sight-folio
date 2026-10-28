// 笔记相对时间分档 · 单元测试
// 覆盖五个分档边界：justNow(<60s) / minutes(<1h) / hours(<24h) / yesterday(<48h) / days(>=48h)
import { describe, it, expect } from 'vitest';
import { noteAgeBucket } from '../writingNoteTime';

const NOW = 1_700_000_000;

describe('noteAgeBucket（笔记相对时间分档）', () => {
  it('60 秒内为 justNow', () => {
    expect(noteAgeBucket(NOW, NOW)).toEqual({ kind: 'justNow', value: 0 });
    expect(noteAgeBucket(NOW - 59, NOW)).toEqual({ kind: 'justNow', value: 0 });
  });

  it('1 小时内为 minutes', () => {
    expect(noteAgeBucket(NOW - 60, NOW)).toEqual({ kind: 'minutes', value: 1 });
    expect(noteAgeBucket(NOW - 3599, NOW)).toEqual({ kind: 'minutes', value: 59 });
  });

  it('24 小时内为 hours', () => {
    expect(noteAgeBucket(NOW - 3600, NOW)).toEqual({ kind: 'hours', value: 1 });
    expect(noteAgeBucket(NOW - 86399, NOW)).toEqual({ kind: 'hours', value: 23 });
  });

  it('昨天（24~48 小时）为 yesterday', () => {
    expect(noteAgeBucket(NOW - 86400, NOW)).toEqual({ kind: 'yesterday', value: 0 });
    expect(noteAgeBucket(NOW - 172799, NOW)).toEqual({ kind: 'yesterday', value: 0 });
  });

  it('达到/超过 48 小时为 days（按整天向下取整）', () => {
    expect(noteAgeBucket(NOW - 172800, NOW)).toEqual({ kind: 'days', value: 2 });
    expect(noteAgeBucket(NOW - 172801, NOW)).toEqual({ kind: 'days', value: 2 });
    expect(noteAgeBucket(NOW - 200000, NOW)).toEqual({ kind: 'days', value: 2 });
    expect(noteAgeBucket(NOW - 172800 - 1, NOW)).toEqual({ kind: 'days', value: 2 });
  });

  it('未来时间戳不产生负值，按 justNow 处理', () => {
    expect(noteAgeBucket(NOW + 60, NOW)).toEqual({ kind: 'justNow', value: 0 });
  });
});
