// 窄栏数字写法的回归锁（纯函数）。
//
// 钉的是什么：洞察卡的 KPI 是"一行三格"，外层容器 overflowX:hidden。
// 大体量书籍的总字数（一千二百万）是**不可折行**的内容，以前直接写全量分组数字，
// 会把 grid 轨道顶开 → 被裁 → 数字看不见、卡片还歪。
// 所以规则：装得下写准数（不许提前丢精度），装不下写紧凑形态并把准数留在 exact 里。
import { describe, expect, it } from 'vitest';
import { WIDE_COUNT_CHARS, cellCount } from '../countFormat';

describe('cellCount', () => {
  it('短数字必须还是准数：不许为了整齐提前丢精度', () => {
    expect(cellCount(3600, 'zh-CN')).toEqual({ text: '3,600', exact: null });
    expect(cellCount(12, 'zh-CN')).toEqual({ text: '12', exact: null });
    // 7 个字符仍算"装得下"（阈值边界）
    expect(cellCount(999999, 'zh-CN')).toEqual({ text: '999,999', exact: null });
  });

  it('超长的写紧凑形态，准数留在 exact（放 title）', () => {
    // 本机实测 ICU 形态：zh 用「万」，en 用 M
    expect(cellCount(1234567, 'zh-CN')).toEqual({ text: '123.5万', exact: '1,234,567' });
    expect(cellCount(12345678, 'zh-CN')).toEqual({ text: '1234.6万', exact: '12,345,678' });
    expect(cellCount(1234567, 'en-US')).toEqual({ text: '1.2M', exact: '1,234,567' });
  });

  it('脏输入不许变成 undefined / NaN', () => {
    expect(cellCount(0, 'zh-CN').text).toBe('0');
    expect(cellCount(-5, 'zh-CN').text).toBe('0');
    expect(cellCount(Number.NaN, 'zh-CN').text).toBe('0');
    expect(cellCount(Number.POSITIVE_INFINITY, 'zh-CN').text).toBe('0');
    expect(cellCount(1234.6, 'zh-CN').text).toBe('1,235'); // 四舍五入到整，不出现小数点
  });

  it('不传语言时跟界面语言走（默认参数不许抛）', () => {
    expect(() => cellCount(12345678)).not.toThrow();
    expect(cellCount(12345678).text.length).toBeLessThanOrEqual(WIDE_COUNT_CHARS);
  });

  it('紧凑形态一定比全量短：否则等于白折腾一场', () => {
    for (const n of [1234567, 12345678, 87654321, 999999999]) {
      const r = cellCount(n, 'zh-CN');
      expect(r.text.length).toBeLessThan((r.exact ?? r.text).length);
    }
  });
});
