/**
 * ㉴（轮 35 · AU-1）产品内自动化认体裁——「表外项不跑且要说」的护栏套。
 *
 * 病灶（v3 §6-A / 提示词按题材分层 刀4）：analysisScheduler / autoAnalysisOrchestrator /
 * AutoAnalysisPanel 三件 genre 命中全 0，给诗集自动跑「人设一致性 / 情节与节奏」= 满屏无意义产出；
 * 而「跳过了什么」没人说话，作者以为跑了。
 *
 * 锁的家族（每把对应一条已付过学费的规矩）：
 *  ① 表形：pack.automation 五体裁齐、meaningful ∪ meaningless 恰好盖住写作域六张预设卡
 *     （新增预设不登记 = 红——「预设表 ↔ 自动化项」同源，同「页签表 ↔ 创建闸口」一族）；
 *  ② 推导锁：每一格 meaningless 都必须能从 writingSchema 既有判据复算出来
 *     （hiddenViewKindsForGenre / outlierMeaninglessForGenre / characterCardsOptionalForGenre）
 *     ——表与判据漂开 = 红，堵「第二张真源」；
 *  ③ 闸门：evaluateAutoRule 的 genre-irrelevant 分支（点名锁表外项拦、轮转部分裁不拦、
 *     整池裁光拦、无申报逐字节旧观）+ 排在 trigger-mismatch **之前**（真因不许被盖住）；
 *  ④ 轮转池与心跳探针：被裁维度不选、不计「从未分析」欠账（否则心跳永远追补不上的洞）；
 *  ⑤ 台账：genre-blocked 只顶替 never（有运行记录 ⇒ 记录照旧，数据不隐身），
 *     pickNextPreset 永不点名，summarizeCoverage 不把它算进 stale；
 *  ⑥ 接线（AU-7 ⑨「算好了要接到行上」）：provider 按本书体裁报单 + 面板把名单真传给台账。
 *
 * novel / 未设体裁 / 无钩子模块（代码扫描域）= 全部照旧跑，是本套的零回归对照线。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiAutoAnalysisRule, AiAutoAnalysisRun } from '../../services/tauri';

const { writingStore } = vi.hoisted(() => ({ writingStore: { state: { books: [] as unknown[] } } }));
vi.mock('../../store/writingStore', () => ({
  useWritingStore: { getState: () => writingStore.state },
}));

const { t } = vi.hoisted(() => ({ t: (key: string, params?: Record<string, unknown>) => `TR:${key}:${params ? JSON.stringify(params) : ''}` }));
vi.mock('../../i18n', () => ({
  t,
  pickLang: (v: { 'zh-CN': string }) => v['zh-CN'],
  getLang: () => 'zh-CN',
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { evaluateAutoRule, planRotation, PRESET_ROTATE, automationBlocklistFor } = await import('../autoAnalysisOrchestrator');
const { probeCoverageGaps } = await import('../analysisScheduler');
const { GENRE_PROMPT_PACKS, genrePromptPack } = await import('../genrePromptPack');
const { aiContextRegistry } = await import('../contextRegistry');
const { writingContextProvider, WRITING_MODULE_ID } = await import('../providers/writingContextProvider');
const { buildAnalysisCoverage, pickNextPreset, summarizeCoverage } = await import('../analysisCoverage');
const {
  hiddenViewKindsForGenre,
  outlierMeaninglessForGenre,
  characterCardsOptionalForGenre,
} = await import('../../utils/writingSchema');

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/** 写作域六张自动化卡（与 writingContextProvider.presets 对齐；① 的一致性锁保证这里不漂） */
const ALL_ITEMS = [
  'character-consistency',
  'plot-review',
  'emotional-intensity',
  'ai-flavor',
  'pacing-tension',
  'logical-continuity',
] as const;

const makeRule = (over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule => ({
  id: 'r1',
  enabled: true,
  moduleId: 'writing-book',
  scopeId: 'bk1',
  agentId: 'a1',
  presetKey: '',
  triggerOn: 'any-scan',
  cooldownMinutes: 0,
  skipIfUnchanged: false,
  lastRunAt: 0,
  lastDigest: '',
  ...over,
} as AiAutoAnalysisRule);

const cleanEvalCtx = () => ({
  moduleId: 'writing-book',
  scopeId: 'bk1',
  trigger: 'full-scan' as const,
  digest: 'd1',
  nowSec: 1_700_000_000,
});

/* ── ① 表形与穷尽 ─────────────────────────────────────────────────────────── */
describe('㉴ AU-1 automation 槽表形', () => {
  it('五体裁格齐；meaningful ∪ meaningless 恰好盖住写作域六卡且不重不漏', () => {
    for (const genre of ['novel', 'essay', 'poetry', 'script', 'diary'] as const) {
      const a = GENRE_PROMPT_PACKS[genre].automation;
      const union = [...a.meaningful, ...a.meaningless];
      expect([...union].sort(), `${genre} 覆盖漂移`).toEqual([...ALL_ITEMS].sort());
      expect(new Set(union).size, `${genre} 一项两表都出现`).toBe(ALL_ITEMS.length);
    }
  });

  it('写作域预设表 ↔ 自动化项表同源：provider 的每张卡都在白名单宇宙里', () => {
    const presetKeys = (writingContextProvider.presets ?? []).map((p) => p.key).sort();
    expect(presetKeys, '预设改名/增删而 pack 侧未同轮登记 = 静默失管').toEqual([...ALL_ITEMS].sort());
  });
});

/* ── ② 推导锁：表每一格都能从 schema 判据复算 ─────────────────────────────── */
describe('㉴ AU-1 裁剪理由派生自 writingSchema（禁第二把尺子）', () => {
  it('character-consistency 表外 ⟺ characterCardsOptionalForGenre', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary', '', 'diirt']) {
      const blocked = genrePromptPack(g).automation.meaningless.includes('character-consistency');
      expect(blocked, g).toBe(characterCardsOptionalForGenre(g));
    }
  });

  it('plot-review / logical-continuity 表外 ⟺ 伏笔栏整裁（hiddenViewKindsForGenre）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary', '', 'diirt']) {
      const foreshadowGone = hiddenViewKindsForGenre(g).includes('foreshadowing');
      const d = genrePromptPack(g).automation;
      expect(d.meaningless.includes('plot-review'), g).toBe(foreshadowGone);
      expect(d.meaningless.includes('logical-continuity'), g).toBe(foreshadowGone);
    }
  });

  it('pacing-tension 表外 ⟺ outlierMeaninglessForGenre（剧本的场次体量是真信号，保留）', () => {
    for (const g of ['novel', 'essay', 'poetry', 'script', 'diary', '', 'diirt']) {
      const blocked = genrePromptPack(g).automation.meaningless.includes('pacing-tension');
      expect(blocked, g).toBe(outlierMeaninglessForGenre(g));
    }
  });

  it('剧本整卡级零裁剪：伏笔/剧情线/时间线是戏剧本体（⑮-2 那张表）；小说全跑逐字旧观', () => {
    expect(GENRE_PROMPT_PACKS.script.automation.meaningless).toEqual([]);
    expect(GENRE_PROMPT_PACKS.novel.automation.meaningless).toEqual([]);
    // 未设/脏体裁 → novel 支（P1 在册）：自动化零裁剪 = 与改造前逐字等价
    expect(genrePromptPack('').automation.meaningless).toEqual([]);
    expect(genrePromptPack('poem').automation.meaningless).toEqual([]);
  });
});

/* ── ③ evaluateAutoRule 的 genre-irrelevant 分支 ─────────────────────────── */
describe('㉴ AU-1 闸门：表外项不跑', () => {
  const blocked = [
    { key: 'character-consistency', label: '人设一致性检查' },
    { key: 'plot-review', label: '情节与节奏审视' },
    { key: 'pacing-tension', label: '节奏与张力审校' },
    { key: 'logical-continuity', label: '逻辑连续性审校' },
  ];

  it('点名锁到表外卡 → skipped(genre-irrelevant)，detail 说得出卡名', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: 'character-consistency' }), {
      ...cleanEvalCtx(),
      genreBlockedPresets: blocked,
    });
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe('genre-irrelevant');
    expect(d.detail).toContain('人设一致性检查');
  });

  it('点名锁到表内卡 → 不拦（情感浓度对诗集照跑）', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: 'emotional-intensity' }), {
      ...cleanEvalCtx(),
      genreBlockedPresets: blocked,
    });
    expect(d.shouldRun).toBe(true);
  });

  it('轮转 + 部分裁剪 → 不拦（池里还有能跑的卡，轮转自己会挑）', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: PRESET_ROTATE }), {
      ...cleanEvalCtx(),
      genreBlockedPresets: blocked,
      genreBlockedAll: false,
    });
    expect(d.shouldRun).toBe(true);
  });

  it('轮转 + 整池裁光 → skipped，detail 说明「本轮不跑」而不是永远领不到卡的 ok', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: PRESET_ROTATE }), {
      ...cleanEvalCtx(),
      genreBlockedPresets: blocked,
      genreBlockedAll: true,
    });
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe('genre-irrelevant');
    expect(d.detail).toContain('genreIrrelevantAll');
  });

  it('零申报（代码扫描域/小说书）→ 判定逐字节旧观（零回归对照）', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: 'character-consistency' }), cleanEvalCtx());
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe('ok');
  });

  it('排在 trigger-mismatch 之前：增量撞上表外卡时报「按体裁」而不是「触发不符」', () => {
    const d = evaluateAutoRule(makeRule({ presetKey: 'plot-review', triggerOn: 'full-scan' }), {
      ...cleanEvalCtx(),
      trigger: 'incremental',
      genreBlockedPresets: blocked,
    });
    expect(d.reason).toBe('genre-irrelevant');
  });
});

/* ── ④ 轮转池与心跳探针：被裁维度不选、也不计欠账 ─────────────────────────── */
const fakePresets = ALL_ITEMS.map((k) => ({
  key: k,
  title: { 'zh-CN': `卡-${k}`, 'en-US': k },
  description: { 'zh-CN': 'd', 'en-US': 'd' },
  prompt: { 'zh-CN': 'p', 'en-US': 'p' },
}));

const fakeProvider = (blocklist?: (scopeId: string) => string[]) => ({
  moduleId: WRITING_MODULE_ID,
  label: 'x',
  description: 'x',
  isAvailable: () => true,
  buildPack: () => null,
  presets: fakePresets,
  ...(blocklist ? { automationBlocklist: blocklist } : {}),
});

describe('㉴ AU-1 轮转池与探针', () => {
  afterEach(() => {
    aiContextRegistry.unregister(WRITING_MODULE_ID);
    coverageFixture = [];
  });

  it('planRotation：被裁的 never 卡永不出票、也不计「还有空白」；票只落在可跑池', async () => {
    const blocked = ['character-consistency', 'plot-review', 'pacing-tension', 'logical-continuity'];
    aiContextRegistry.register(fakeProvider(() => blocked) as never);
    // 台账里只给**可跑的两张**记上「已覆盖且指纹一致」：
    // 若池没裁干净，被裁四张的 never 会把 hasUncovered 顶成真——那正是假欠账的形状。
    coverageFixture = ['emotional-intensity', 'ai-flavor'].map(runRow);
    const plan = await planRotation(
      makeRule({ presetKey: PRESET_ROTATE }),
      { moduleId: WRITING_MODULE_ID, scopeId: 'bk1', digest: 'd1', nowSec: 1_700_000_000 },
      blocked,
    );
    expect(plan.hasUncovered, '被裁维度的 never 泄漏成了欠账').toBe(false);
    expect(['emotional-intensity', 'ai-flavor']).toContain(plan.presetKey);
  });

  it('老空串规则：「取第一个预设」取到的是本书跑得动的第一张卡', async () => {
    aiContextRegistry.register(fakeProvider() as never);
    const plan = await planRotation(makeRule({ presetKey: '' }), {
      moduleId: WRITING_MODULE_ID,
      scopeId: 'bk1',
      digest: 'd1',
      nowSec: 1_700_000_000,
    }, ['character-consistency']);
    expect(plan.presetKey).toBe('plot-review');
  });

  it('automationBlocklistFor：无钩子 = 空名单；抛错 = 空名单（宁多跑不静默少跑）', () => {
    aiContextRegistry.register(fakeProvider() as never);
    expect(automationBlocklistFor(WRITING_MODULE_ID, 'bk1')).toEqual([]);
    aiContextRegistry.unregister(WRITING_MODULE_ID);
    aiContextRegistry.register(fakeProvider(() => {
      throw new Error('boom');
    }) as never);
    expect(automationBlocklistFor(WRITING_MODULE_ID, 'bk1')).toEqual([]);
  });

  it('probeCoverageGaps：被裁维度从未跑过 ≠ gap 欠账；表内维度 never 仍报', async () => {
    const blocked = ['character-consistency', 'plot-review', 'pacing-tension', 'logical-continuity'];
    aiContextRegistry.register(fakeProvider(() => blocked) as never);
    const rotateRule = makeRule({ presetKey: PRESET_ROTATE, lastRunAt: 1_700_000_000 - 60 * 60 * 3 });
    const gaps = await probeCoverageGaps(WRITING_MODULE_ID, 'bk1', [rotateRule], 1_700_000_000);
    // 可跑的两张也没跑过 → 仍然报 hasUncoveredDimension=true（真空白不能被白名单吞掉）
    expect(gaps.hasUncoveredDimension).toBe(true);
    // 把可跑的两张标成已覆盖后，被裁四张的 never 不得再让心跳起念想
    coverageFixture = fakePresets
      .filter((p) => !blocked.includes(p.key))
      .map((p) => runRow(p.key));
    const gaps2 = await probeCoverageGaps(WRITING_MODULE_ID, 'bk1', [rotateRule], 1_700_000_000);
    expect(gaps2.hasUncoveredDimension).toBe(false);
  });

  it('零回归对照：无钩子模块（代码扫描域）的探针逐字节旧观——全部 never 照报', async () => {
    aiContextRegistry.register({ ...fakeProvider(), moduleId: 'fake-scan' } as never);
    const rotateRule = makeRule({ moduleId: 'fake-scan', scopeId: 'sc1', presetKey: PRESET_ROTATE, lastRunAt: 1_700_000_000 - 60 * 60 * 3 });
    const gaps = await probeCoverageGaps('fake-scan', 'sc1', [rotateRule], 1_700_000_000);
    expect(gaps.hasUncoveredDimension).toBe(true);
    aiContextRegistry.unregister('fake-scan');
  });
});

let coverageFixture: unknown[] = [];
vi.mock('../../services/tauri', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    aiContextApi: {
      ...(actual as { aiContextApi: Record<string, unknown> }).aiContextApi,
      listAnalysisCoverage: async () => coverageFixture,
      listFocusAssignments: async () => [],
    },
  };
});

/* ── ⑤ 覆盖台账：genre-blocked 的形状与牙 ─────────────────────────────────── */
const preset = (k: string) => ({
  key: k,
  title: { 'zh-CN': k, 'en-US': k },
  description: { 'zh-CN': 'd', 'en-US': 'd' },
  prompt: { 'zh-CN': 'p', 'en-US': 'p' },
});
const runRow = (presetKey: string): AiAutoAnalysisRun => ({
  id: `run-${presetKey}`,
  ruleId: 'r1',
  moduleId: WRITING_MODULE_ID,
  scopeId: 'bk1',
  agentId: 'a1',
  presetKey,
  packId: 'pk',
  conversationId: null,
  triggerKind: 'full-scan',
  status: 'triggered',
  detail: '',
  reason: 'ok',
  outcome: '',
  contextDigest: 'd1',
  createdAt: 1_699_999_000,
});

describe('㉴ AU-1 台账 genre-blocked', () => {
  it('被裁且从未跑过 = genre-blocked（不是 never 红灯）；detail 说得出原因', () => {
    const rows = buildAnalysisCoverage([preset('character-consistency'), preset('emotional-intensity')], [], {
      blockedKeys: ['character-consistency'],
      nowSec: 1_700_000_000,
    });
    expect(rows[0].state).toBe('genre-blocked');
    expect(rows[0].detail).toContain('genreBlocked');
    expect(rows[1].state).toBe('never');
  });

  it('被裁但**跑过** → 记录照旧（数据不因裁页签而隐身——页签护栏的台账版）', () => {
    const rows = buildAnalysisCoverage([preset('character-consistency')], [runRow('character-consistency')], {
      blockedKeys: ['character-consistency'],
      currentDigest: 'd1',
      nowSec: 1_700_000_000,
    });
    expect(rows[0].state).not.toBe('genre-blocked');
    expect(rows[0].lastRunAt).toBe(1_699_999_000);
  });

  it('pickNextPreset 两档都不点 genre-blocked 的名（includeFresh 也不行）', () => {
    const rows = buildAnalysisCoverage(
      [preset('character-consistency')],
      [],
      { blockedKeys: ['character-consistency'], nowSec: 1_700_000_000 },
    );
    expect(pickNextPreset(rows)).toBeUndefined();
    expect(pickNextPreset(rows, { includeFresh: true })).toBeUndefined();
  });

  it('summarizeCoverage：blocked 单独成数，不许被减法算进 stale', () => {
    const rows = buildAnalysisCoverage(
      [preset('character-consistency'), preset('plot-review'), preset('ai-flavor')],
      [],
      { blockedKeys: ['character-consistency', 'plot-review'], nowSec: 1_700_000_000 },
    );
    const s = summarizeCoverage(rows);
    // 三张卡：两张被裁（blocked）+ 一张没跑过的 ai-flavor（真 never）——stale 的差值必须是 0，
    // 改造前 blocked 会被减法凑进 stale（3-1-0-0=2 张假「已过期」），这张锁的就是那个形状。
    expect(s).toMatchObject({ total: 3, never: 1, blocked: 2, stale: 0, fresh: 0 });
  });

  it('零回归对照：不传 blockedKeys 时台账逐字节旧观', () => {
    const rows = buildAnalysisCoverage([preset('ai-flavor'), preset('plot-review')], [], { nowSec: 1_700_000_000 });
    expect(rows.map((r) => r.state)).toEqual(['never', 'never']);
    expect(rows[0].detail).toBe('TR:aiPanel.coverageDetail.never:');
  });
});

/* ── ⑥ 接线：provider 按本书体裁报单 + 面板把名单真传给台账 ────────────────── */
describe('㉴ AU-1 接线（AU-7 ⑨：算好了必须接到行上）', () => {
  const setBook = (genre?: string) => {
    writingStore.state = { books: genre === undefined ? [] : [{ id: 'bk1', title: 'T', genre }] };
  };

  beforeEach(() => setBook());

  it('诗集书 → 四卡表外；小说/未设 → 空名单；书读不到 → 空名单（宁多跑）', () => {
    setBook('poetry');
    expect([...writingContextProvider.automationBlocklist!('bk1')].sort()).toEqual(
      ['character-consistency', 'logical-continuity', 'pacing-tension', 'plot-review'],
    );
    setBook('novel');
    expect(writingContextProvider.automationBlocklist!('bk1')).toEqual([]);
    setBook(undefined); // 未设体裁的旧书
    expect(writingContextProvider.automationBlocklist!('bk1')).toEqual([]);
    expect(writingContextProvider.automationBlocklist!('ghost')).toEqual([]);
  });

  it('面板把名单真传进 buildAnalysisCoverage（不是算完就丢）', () => {
    const src = read('src/ai/AutoAnalysisPanel.tsx');
    expect(src).toMatch(/blockedKeys\s*=\s*automationBlocklistFor\(moduleId,\s*scopeId\)/);
    expect(src).toMatch(/buildAnalysisCoverage\(presets,\s*runsForScope,\s*\{\s*currentDigest,\s*blockedKeys\s*\}\)/);
  });

  it('调度探针与编排共用同一枚入口（禁第二张表）', () => {
    const sched = read('src/ai/analysisScheduler.ts');
    expect(sched).toMatch(/automationBlocklistFor\(moduleId,\s*scopeId\)/);
    expect(sched).toMatch(/!blockedKeys\.includes\(p\.key\)/);
  });
});
