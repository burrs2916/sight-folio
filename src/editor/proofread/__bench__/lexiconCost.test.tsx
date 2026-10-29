// 校对词库的扫描成本基准（批次③ 增-6 的收尾）。
//
// 为什么要有这个文件：词库变成可写之后，扫描成本就从"实现细节"变成了**产品边界**——
// 引擎是逐词 `text.indexOf(word)` 全文扫描，复杂度 ≈ 词数 × 文本长度，且挂在输入路径上
// （防抖 1.2s 后重跑整章）。作者能自己加词条，就等于能把这条路径的成本推高到他自己机器上，
// 而"感觉变慢但说不清多慢"是不能拿去做决策的。这里把量出来。
//
// 运行：npx vitest run src/editor/proofread/__bench__/lexiconCost.test.tsx
//
// 断言策略（重要）：**不断言绝对毫秒数**。CI 机器抖动、后台负载都能让绝对值翻几倍，
// 那种断言只会训练出"红了就 skip"的习惯。这里断言两件不会假失败的事：
//  ① 耗时随词条数、随文本长度单调递增 —— 这是"没有隐藏上限"的复杂度证据；
//  ② 内置规模下留一个宽松到荒谬的上界 —— 平时永不触发，只用来抓 10× 级的真实退化。
import { describe, expect, it, vi } from 'vitest';
import { mergeLexicon, type CustomLexicon } from '../lexiconStore';
import { runProofread } from '../proofreadEngine';
import { TYPO_PHRASES, type TypoPhrase } from '../typoPhrases';
import { REDUNDANT_PHRASES } from '../redundantPhrases';
import { SENSITIVE_WORDS_SORTED } from '../sensitiveWords';

// lexiconStore 会 import 全局 KV；基准不碰存储，mock 掉以免拖进 Tauri 运行时
vi.mock('../../../services/tauri', () => ({
  settingsApi: {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
  },
}));

/** 一段正常中文叙述：既有正常字序，也不会意外命中造出来的词形 */
const SEED =
  '夜色像潮水一样漫过屋檐，沈砚握着剑站在瓦上，听见风里有极细的裂响。' +
  '他想起雪地里那行脚印，想起师父说过的那句话，指节一点点收紧。';

function chapterChars(n: number): string {
  let s = '';
  while (s.length < n) s += SEED;
  return s.slice(0, n);
}

/**
 * 构造**绝不会命中**的词形。
 * 测成本要用全 miss 的词：命中的那条路径会 push issue、拼 excerpt，测出来的是
 * "扫描 + 产出"的混合成本，而不是扫描本身。而且真实场景里作者加的词大多在正文里
 * 只出现零次或几次。
 */
function missingTerms(n: number): TypoPhrase[] {
  const out: TypoPhrase[] = [];
  for (let i = 0; i < n; i++) out.push({ wrong: `硸硹${i}硺`, right: '替换' });
  return out;
}

const BUILTIN: CustomLexicon = {
  typos: TYPO_PHRASES,
  sensitive: SENSITIVE_WORDS_SORTED,
  redundant: REDUNDANT_PHRASES,
  ignored: [],
};
const EMPTY: CustomLexicon = { typos: [], sensitive: [], redundant: [], ignored: [] };

/** 亚毫秒必须用 µs 说出来。压成 `0.00ms` 会把一个真实存在的结论伪装成"快到没有" */
function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(1)}µs` : `${ms.toFixed(2)}ms`;
}

function bench(label: string, fn: () => unknown, rounds = 5): number {
  fn(); // 预热：首轮含 JIT 与内联缓存冷启动，计入会系统性高估
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }

  console.log(`[bench] ${label}: ${fmt(best)}`);
  return best;
}

/**
 * **首字分散**的词形。
 *
 * 造对比用的词时必须让首字分散：真实词库的中文首字分布很广，而若所有候选都以同一个字开头，
 * 正则引擎只要找不到那个字就能整趟跳过，测出来的是"引擎运气好"，不是实现的真实成本。
 */
const HEADS = '一二三四五六七八九十上下左右中内外年月日天地山水火木金土石革糸言谷';
function scatteredTerms(n: number): TypoPhrase[] {
  const out: TypoPhrase[] = [];
  for (let i = 0; i < n; i++) {
    const h = HEADS[i % HEADS.length];
    const t = HEADS[(i * 7 + 3) % HEADS.length];
    out.push({ wrong: `${h}${t}${i}硸`, right: '替换' });
  }
  return out;
}

describe('校对词库扫描成本', { timeout: 120_000 }, () => {
  const TEXT_5K = chapterChars(5_000);
  const TEXT_20K = chapterChars(20_000);
  const TEXT_50K = chapterChars(50_000);

  it('内置规模基线：一整章 / 二十章 / 五十字章节一次性扫完的耗时', () => {
    const builtinTypos = BUILTIN.typos.length + BUILTIN.sensitive.length + BUILTIN.redundant.length;
    console.log(`[bench] 内置词条合计: ${builtinTypos} 条`);
    const m5 = bench('内置词库 × 5,000 字', () => runProofread(TEXT_5K, mergeLexicon(BUILTIN, EMPTY)));
    const m20 = bench('内置词库 × 20,000 字', () => runProofread(TEXT_20K, mergeLexicon(BUILTIN, EMPTY)));
    const m50 = bench('内置词库 × 50,000 字', () => runProofread(TEXT_50K, mergeLexicon(BUILTIN, EMPTY)));

    // 复杂度证据：不是"有缓存所以长度无关"
    expect(m20).toBeGreaterThan(m5);
    expect(m50).toBeGreaterThan(m20);

    // 内置规模的宽松上界：一万字一章、连扫五次也远不到 3 秒
    expect(m50).toBeLessThan(3_000);
  });

  it('作者自定义词条的规模效应：200 / 1,000 / 3,000 / 6,000 条', () => {
    const sizes = [200, 1_000, 3_000, 6_000];
    const results: Array<{ n: number; ms: number }> = [];
    for (const n of sizes) {
      const custom: CustomLexicon = { ...EMPTY, typos: missingTerms(n) };
      const lex = mergeLexicon(BUILTIN, custom);
      const ms = bench(`5,000 字 + ${n} 条自定义（全 miss）`, () => runProofread(TEXT_5K, lex));
      results.push({ n, ms });
    }
    // 只锁「成本随词数增长」这一条，用首尾对比 + 大余量。
    // 不再做相邻档严格递增：词数 200→1,000 的耗时差只有零点几毫秒，机器一忙就会倒挂
    // （实测过 3,000 条"快过"1,000 条），那种断言只会训练出"红了就 skip"。
    // 真回归照样抓得住：词库规模差 30 倍，任何数量级退化都远超这个余量。
    expect(results[results.length - 1].ms).toBeGreaterThan(results[0].ms * 1.5);
    const perTerm = results.map((r) => (r.ms / r.n) * 1000);
  
    console.log(
      `[bench] 每条词条每千字成本（µs/千词·条）: ${results
        .map((r, i) => `${r.n}条=${perTerm[i].toFixed(1)}`)
        .join('  ')}`,
    );
  });

  /**
   * 找"输入路径还能不能扛"的量级：50,000 字（约十万字长篇里连续几章的规模）
   * 配上大词库时的真实耗时。这个组合是最容易踩到的坏情况——一章粘了超长文本 + 词库膨胀。
   */
  it('最坏组合：超长章节叠加大词库', () => {
    const custom: CustomLexicon = { ...EMPTY, typos: missingTerms(1_000) };
    const lex = mergeLexicon(BUILTIN, custom);
    const ms = bench('50,000 字 + 1,000 条自定义', () => runProofread(TEXT_50K, lex));
    // 防抖 1.2s 之后跑；这里给一个宽松到荒谬的上界，只抓数量级退化
    expect(ms).toBeLessThan(20_000);
  });

  /**
   * 替代实现值不值得做：把整张词表并成一个正则去扫。
   * 只测成本，不代表可以直接换——合并正则会丢掉"哪个词命中、建议改成什么"的对应关系，
   * 且词形里的正则元字符必须转义。要真换得先把正确性设计补齐。
   */
  it('对比：同一张 3,000 条词表（首字分散），逐词 indexOf vs 合并单正则', () => {
    const terms = scatteredTerms(3_000);
    const text = TEXT_20K;
    const perWord = bench(
      '逐词 indexOf × 3,000 条 × 20,000 字',
      () => {
        for (const t of terms) {
          let pos = text.indexOf(t.wrong);
          while (pos !== -1) pos = text.indexOf(t.wrong, pos + 1);
        }
      },
      10,
    );
    const escaped = terms.map((t) => t.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(escaped.join('|'), 'g');
    // 轮次给足：单次是亚毫秒量级，5 轮会被计时器分辨率吞掉
    const oneRegex = bench(
      '合并正则 × 3,000 条 × 20,000 字（不含正则构建）',
      () => {
        re.lastIndex = 0;
        let m = re.exec(text);
        while (m) m = re.exec(text);
      },
      200,
    );
    const buildOnly = bench('仅构建该正则一次（词库变更时才付的代价）', () => {
      const t = terms.map((x) => x.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return new RegExp(t.join('|'), 'g');
    }, 20);

    console.log(
      `[bench] 扫描比值 合并正则/逐词indexOf = ${((oneRegex / perWord) * 100).toFixed(2)}%` +
        `；正则构建 ${fmt(buildOnly)} 只在词库变更时付，扫描每次都要付`,
    );
    expect(perWord).toBeGreaterThan(0);
    expect(oneRegex).toBeGreaterThan(0);
  });
});
