// 写作台排版档位（P3/P4）：字体维度（中文 + 英文分离）+ 书级覆盖读数回归锁（批次⑤/⑦）
//
// 锁死：
// ① DEFAULT 含 fontFamily/latinFontFamily（跟随系统），未配置时 load 回落默认；
// ② 书级覆盖里的脏值只丢那一个字段（未知字体 key 丢掉 → 该项回落 system），其余字段不受影响；
// ③ 覆盖表 → load 往返保留所选字体（中英文各自独立）；
// ④ fontFamilyStack/LATIN_FONT_OPTIONS/latinFontStack：key → CSS 字体栈映射完整、system 为空串；
// ⑤ resolveBodyFont：中英字体分离组合，全 system 为 '', 仅英文补中文回退栈；
// ⑥ 第三十轮 P1：书级覆盖的落点换成设置库，本模块只读 store 推进来的模块级读数 ——
//    渲染路径不再碰 localStorage；老 localStorage 只作为**一次性迁移来源**，脏数据不迁进来。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_TYPOGRAPHY,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_PRESETS,
  LATIN_FONT_OPTIONS,
  LEGACY_BOOK_TYPOGRAPHY_PREFIX,
  collectLegacyBookTypographyOverrides,
  fontFamilyStack,
  latinFontStack,
  normalizeBookOverride,
  resolveBodyFont,
  setBookTypographyOverrides,
  loadTypography,
  type BookTypography,
} from '../typography';

const KEY = `${LEGACY_BOOK_TYPOGRAPHY_PREFIX}book_1`;

beforeEach(() => {
  localStorage.clear();
  // 模块级读数会跨用例留着（它是给渲染路径同步读的），每个用例都从空表起
  setBookTypographyOverrides({});
});

describe('typography 字体维度（批次⑤）', () => {
  it('默认排版含字体且为「跟随系统」', () => {
    expect(DEFAULT_TYPOGRAPHY.fontFamily).toBe('system');
    expect(DEFAULT_TYPOGRAPHY.latinFontFamily).toBe('system');
    expect(loadTypography('book_1').fontFamily).toBe('system');
    expect(loadTypography('book_1').latinFontFamily).toBe('system');
  });

  it('书级覆盖：脏字体 key 那一项丢掉，其余字段照常生效', () => {
    setBookTypographyOverrides({
      book_1: { fontSize: 18, fontFamily: 'bogus-font', latinFontFamily: 'nope', pageWidth: 900 },
    });
    const tp = loadTypography('book_1');
    expect(tp.fontFamily).toBe('system');
    expect(tp.latinFontFamily).toBe('system');
    expect(tp.fontSize).toBe(18);
    expect(tp.pageWidth).toBe(900);
  });

  it('覆盖 → load 往返保留所选字体（中文楷体 + 英文 Georgia）', () => {
    const tp: BookTypography = { ...DEFAULT_TYPOGRAPHY, fontFamily: 'kai', latinFontFamily: 'georgia' };
    setBookTypographyOverrides({ book_1: tp });
    const loaded = loadTypography('book_1');
    expect(loaded.fontFamily).toBe('kai');
    expect(loaded.latinFontFamily).toBe('georgia');
  });

  it('中文字体选项完整：6 个 key 互异，含全部字体族映射，system 为空串', () => {
    const keys = FONT_FAMILY_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(6);
    for (const o of FONT_FAMILY_OPTIONS) {
      expect(fontFamilyStack(o.key)).toBe(o.stack);
    }
    expect(fontFamilyStack('system')).toBe('');
    expect(fontFamilyStack('song')).toContain('Songti SC');
    expect(fontFamilyStack('kai')).toContain('Kaiti SC');
    expect(fontFamilyStack('hei')).toContain('Heiti SC');
    expect(fontFamilyStack('fangsong')).toContain('FangSong');
    expect(fontFamilyStack('yahei')).toContain('Microsoft YaHei');
    // 未知 key 静默回落空串，安全
    expect(fontFamilyStack('unknown' as never)).toBe('');
  });

  it('渲染路径不再读 localStorage：老键里留着脏 JSON，load 仍回落默认（P1 换落点的关键口径）', () => {
    localStorage.setItem(KEY, '{broken');
    expect(loadTypography('book_1')).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('老 localStorage 只作迁移来源：脏 JSON 不迁进来，合法那本原样收下', () => {
    localStorage.setItem(KEY, '{broken');
    localStorage.setItem(
      `${LEGACY_BOOK_TYPOGRAPHY_PREFIX}book_ok`,
      JSON.stringify({ ...DEFAULT_TYPOGRAPHY, fontSize: 20 }),
    );
    const migrated = collectLegacyBookTypographyOverrides();
    expect(migrated.book_1).toBeUndefined();
    expect(migrated.book_ok?.fontSize).toBe(20);
  });

  it('normalizeBookOverride：越界数字夹紧、档位外枚举整字段丢弃', () => {
    expect(
      normalizeBookOverride({ fontSize: 99, lineHeight: 9, paraSpacing: -3, paper: 'neon', pageWidth: 1234 }),
    ).toEqual({
      fontSize: 22,
      lineHeight: 2.6,
      paraSpacing: 0,
    });
    // 段距 0 是合法档位，不能因为「falsy」被丢掉
    expect(normalizeBookOverride({ paraSpacing: 0 })).toEqual({ paraSpacing: 0 });
  });

  it('工具栏字号档位：升序、均在字号安全范围（14–22）内，且包含默认 16', () => {
    expect([...FONT_SIZE_PRESETS]).toEqual([...FONT_SIZE_PRESETS].sort((a, b) => a - b));
    for (const v of FONT_SIZE_PRESETS) {
      expect(v).toBeGreaterThanOrEqual(14);
      expect(v).toBeLessThanOrEqual(22);
    }
    expect(FONT_SIZE_PRESETS).toContain(DEFAULT_TYPOGRAPHY.fontSize);
  });
});

describe('latin 字体维度（批次⑦ 中英分离）', () => {
  it('英文字体选项完整：14 项品牌 + 3 组覆盖，key 互异，system 走空串', () => {
    const keys = LATIN_FONT_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(14);
    const groups = new Set(LATIN_FONT_OPTIONS.map((o) => o.group));
    expect([...groups].sort()).toEqual(['mono', 'sans', 'serif']);
    for (const o of LATIN_FONT_OPTIONS) {
      expect(latinFontStack(o.key)).toBe(o.stack);
      // 栈不含末尾通用族：由 resolveBodyFont 统一收尾
      expect(/serif$|sans-serif$|monospace$/.test(o.stack)).toBe(false);
      expect(o.stack.length).toBeGreaterThan(0);
    }
    expect(latinFontStack('system' as never)).toBe('');
    expect(latinFontStack('bogus' as never)).toBe('');
  });

  it('resolveBodyFont：全 system 空串（调用方回退系统栈）', () => {
    expect(resolveBodyFont('system', 'system')).toBe('');
  });

  it('resolveBodyFont：仅中文 → 直接返回中文栈', () => {
    expect(resolveBodyFont('system', 'song')).toBe(fontFamilyStack('song'));
  });

  it('resolveBodyFont：仅英文 → 西文栈在前并补中文回退栈', () => {
    const r = resolveBodyFont('georgia', 'system');
    expect(r).toContain("'Georgia'");
    expect(r).toContain("'PingFang SC'");
    expect(r).toContain('sans-serif');
  });

  it('resolveBodyFont：中英都选 → latin 栈在前 + 中文栈在后', () => {
    const r = resolveBodyFont('inter', 'kai');
    expect(r.indexOf('Inter')).toBeLessThan(r.indexOf('Kaiti SC'));
    expect(r).toBe(`${latinFontStack('inter')}, ${fontFamilyStack('kai')}`);
  });

  it('loadTypography：未知 latin key 那一项丢掉，不影响中文字体与字号', () => {
    setBookTypographyOverrides({ book_1: { fontFamily: 'hei', latinFontFamily: 'comic-sans-wannabe', fontSize: 18 } });
    const tp = loadTypography('book_1');
    expect(tp.latinFontFamily).toBe('system');
    expect(tp.fontFamily).toBe('hei');
    expect(tp.fontSize).toBe(18);
  });
});
