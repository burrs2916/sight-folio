// 自定义校对词库测试（批次③ 增-6）。
//
// 锁的是**合并规则**这些行为契约，不是"能不能打开界面"：
//  - 作者写的同名词形必须压过内置（否则内置表成了不可协商的权威，只能整条 ignore）
//  - 白名单要同时过滤内置与自定义（只对一半就失去意义）
//  - 敏感词合并后必须按词长降序（内置那份 SORTED 就是长词优先；自定义短词插队会让
//    它抢在内置长词前面命中同一区间，而这种 bug 在"看起来能用"的状态下最容易埋进去）
//  - 畸形条目绝不能进引擎：`text.indexOf(undefined)` 会去匹配字符串 "undefined"，凭空造误报
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_COUNTS,
  EMPTY_LEXICON,
  countCustomEntries,
  mergeLexicon,
  normalizeLexicon,
  resolveLexicon,
  saveCustomLexicon,
  type CustomLexicon,
} from '../lexiconStore';
import { runProofread } from '../proofreadEngine';
import { TYPO_PHRASES } from '../typoPhrases';

const kv = new Map<string, string>();
vi.mock('../../../services/tauri', () => ({
  settingsApi: {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: string) => {
      kv.set(key, value);
    },
    delete: async (key: string) => {
      kv.delete(key);
    },
  },
}));

const base: CustomLexicon = { typos: [], sensitive: [], redundant: [], ignored: [] };

describe('normalizeLexicon', () => {
  it('去空白并按词形去重，后写的覆盖先写的', () => {
    const out = normalizeLexicon({
      typos: [
        { wrong: ' 坐落 ', right: ' 坐落 ' },
        { wrong: '坐落', right: '作落' },
      ],
      ignored: [' 在在 ', '在在', ' 拜覆 '],
    });
    expect(out.typos).toEqual([{ wrong: '坐落', right: '作落' }]);
    expect(out.ignored).toEqual(['在在', '拜覆']);
  });

  it('空词形与缺字段的条目一律丢弃，绝不产出 undefined 词形', () => {
    const out = normalizeLexicon({
      typos: [{ wrong: '', right: 'x' }, { wrong: '有词' }, { right: '漏了词' }, null, 42],
      sensitive: [{ word: '  ' }, { word: '有效', level: 'block' }],
    });
    expect(out.typos).toEqual([]);
    // 少一个字段也不能留：`text.indexOf(undefined)` 会去匹配字符串 "undefined"
    expect(out.sensitive).toEqual([{ word: '有效', level: 'block' }]);
  });

  it('敏感词级别只认 block，其余归 warning（防止写个错值就让误报升级）', () => {
    expect(normalizeLexicon({ sensitive: [{ word: '甲', level: '灾难级' }] }).sensitive).toEqual([
      { word: '甲', level: 'warning' },
    ]);
  });

  it('整体不是对象也不炸', () => {
    for (const bad of [null, undefined, 'json', 7, []]) {
      expect(() => normalizeLexicon(bad)).not.toThrow();
    }
  });

  /** EMPTY_LEXICON 是导出常量，被 mutate 会污染全局"空词库" */
  it('不会把导出常量交出去当实例用', () => {
    const a = normalizeLexicon(null);
    a.ignored.push('临时');
    expect(EMPTY_LEXICON.ignored).toEqual([]);
  });
});

describe('mergeLexicon', () => {
  const builtin: CustomLexicon = {
    typos: [
      { wrong: '甲错', right: '甲对' },
      { wrong: '乙错', right: '乙对' },
    ],
    sensitive: [
      { word: '长短语命中', level: 'block' },
      { word: '短', level: 'warning' },
    ],
    redundant: [{ wrong: '冗余甲', right: '冗余' }],
    ignored: [],
  };

  it('作者的同名词形压过内置', () => {
    const merged = mergeLexicon(builtin, { ...base, typos: [{ wrong: '甲错', right: '我偏要用这个' }] });
    expect(merged.typos.find((x) => x.wrong === '甲错')?.right).toBe('我偏要用这个');
    // 没被点名的内置条目必须原样还在
    expect(merged.typos.find((x) => x.wrong === '乙错')?.right).toBe('乙对');
  });

  it('白名单同时屏蔽内置与自定义', () => {
    const merged = mergeLexicon(
      { ...builtin, ignored: ['乙错'] },
      { ...base, typos: [{ wrong: '丙错', right: '丙对' }], ignored: ['丙错'] },
    );
    expect(merged.typos.map((x) => x.wrong)).toEqual(['甲错']);
  });

  /** 这条是本次最容易写错、又最不影响"看起来能用"的地方 */
  it('敏感词合并后仍按词长降序，自定义短词不得插到内置长词前面', () => {
    const merged = mergeLexicon(builtin, { ...base, sensitive: [{ word: '新作', level: 'block' }] });
    const lengths = merged.sensitive.map((x) => x.word.length);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
    expect(merged.sensitive[0].word).toBe('长短语命中');
  });

  it('不动传入的对象', () => {
    const b = { ...base, typos: [{ wrong: 'x', right: 'y' }] };
    mergeLexicon({ ...builtin, typos: [...builtin.typos] }, b);
    expect(b.typos).toEqual([{ wrong: 'x', right: 'y' }]);
  });
});

describe('端到端：自定义词条真的会改变检测结果', () => {
  it('自定义错词能被检出，内置错词不受影响', () => {
    const lex = mergeLexicon(
      { typos: TYPO_PHRASES, sensitive: [], redundant: [], ignored: [] },
      { ...base, typos: [{ wrong: '拜覆', right: '拜复' }] },
    );
    const hits = runProofread('他去拜覆了，的的确实在这里。', lex);
    expect(hits.some((h) => h.kind === 'typo' && h.excerpt.includes('拜覆'))).toBe(true);
    expect(hits.some((h) => h.kind === 'typo' && h.excerpt.includes('的的'))).toBe(true);
  });

  /** 「误报比漏报更严重」的可执行版本：误伤专有名词时作者有关掉的口子 */
  it('进了白名单的内置词形不再报，但其它内置词照常报', () => {
    const lex = mergeLexicon(
      { typos: TYPO_PHRASES, sensitive: [], redundant: [], ignored: [] },
      { ...base, ignored: ['在在'] },
    );
    const hits = runProofread('在在来了，的的确实如此。', lex);
    expect(hits.some((h) => h.kind === 'typo' && h.excerpt.includes('在在'))).toBe(false);
    expect(hits.some((h) => h.kind === 'typo' && h.excerpt.includes('的的'))).toBe(true);
  });

  it('不传词库时用内置口径，行为与改造前一致', () => {
    const hits = runProofread('的的确实');
    expect(hits.some((h) => h.kind === 'typo' && h.excerpt.includes('的的'))).toBe(true);
  });
});

describe('存取', () => {
  beforeEach(() => {
    kv.clear();
  });

  it('保存会规范化，读回的是规范化结果', async () => {
    const saved = await saveCustomLexicon({
      typos: [{ wrong: ' 甲 ', right: ' 乙 ' }],
      sensitive: [],
      redundant: [],
      ignored: [' 甲 ', '甲'],
    });
    expect(saved.typos).toEqual([{ wrong: '甲', right: '乙' }]);
    expect(saved.ignored).toEqual(['甲']);
    expect(kv.size).toBe(1);
    expect(JSON.parse(kv.get('proofread.customLexicon') ?? '{}').typos).toEqual([
      { wrong: '甲', right: '乙' },
    ]);
  });

  it('resolveLexicon 在保存后立刻反映新词条，不必重启', async () => {
    await saveCustomLexicon({
      typos: [{ wrong: '新词形', right: '正确形' }],
      sensitive: [],
      redundant: [],
      ignored: [],
    });
    expect(resolveLexicon().typos.some((x) => x.wrong === '新词形')).toBe(true);
    expect(runProofread('这里有新词形').some((h) => h.kind === 'typo')).toBe(true);
    // 清掉后不该残留
    await saveCustomLexicon({ typos: [], sensitive: [], redundant: [], ignored: [] });
    expect(resolveLexicon().typos.some((x) => x.wrong === '新词形')).toBe(false);
  });

  it('内置条数暴露给 UI，供「内置 N 条」显示', () => {
    expect(BUILTIN_COUNTS.typos).toBe(TYPO_PHRASES.length);
    expect(BUILTIN_COUNTS.sensitive).toBeGreaterThan(0);
  });

  it('计数函数把四类加总（入口角标用）', () => {
    expect(
      countCustomEntries({
        typos: [{ wrong: 'a', right: 'b' }],
        sensitive: [{ word: 'c', level: 'block' }],
        redundant: [],
        ignored: ['d', 'e'],
      }),
    ).toBe(4);
  });
});
