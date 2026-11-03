/**
 * 上下文包落库入口的行为约束。
 *
 * 这里守的是一条**曾经真实发生过的数据损坏**：
 * 「发起分析」按预设裁剪分节后整包写库，而后端 save_pack 的语义是先清空该包的
 * 全部分节再写入——于是每分析一次，库里就少掉一批分节；更隐蔽的是内存里的分节戳
 * 仍然记着它们「已存在且未变」，之后的增量重扫算出 changed 为空、走部分写，
 * 被删掉的分节**永远补不回来**。用户看到的只是「Agent 说没有这方面的数据」。
 *
 * 所以下面的用例围绕三件事：落库永远是全集、增量只写变化节、缓存由单一入口维护。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AiContextPack, AiContextProvider, AiContextSection } from '../contextTypes';
import { AI_CONTEXT_SCHEMA_VERSION } from '../contextTypes';
import { stampSections, packDigestFromSections } from '../sectionDiff';

const saveAiContextPack = vi.fn(async (pack: AiContextPack) => `${pack.scopeId}:${pack.moduleId}`);
const saveAiContextSections = vi.fn(async (_pack: AiContextPack, keys: string[]) => keys.length);
const listAiContextSectionStamps = vi.fn(async () => [] as any[]);
const listAiInsights = vi.fn(async () => [] as any[]);
// 容量闸（第 42 轮）在每次成功落库后后台触发一次配额回收：本套用例只有一两个包、
// 永远够不到上限，给空表桩即可；配额本身的用例在 round42 锁测里独立断言。
const listAiContextPacks = vi.fn(async () => [] as any[]);
const deleteAiContextPack = vi.fn(async (_id: string) => {});

vi.mock('../../services/tauri', () => ({
  aiContextApi: {
    saveAiContextPack: (p: AiContextPack) => saveAiContextPack(p),
    saveAiContextSections: (p: AiContextPack, keys: string[]) => saveAiContextSections(p, keys),
    listAiContextSectionStamps: () => listAiContextSectionStamps(),
    listAiInsights: () => listAiInsights(),
    listAiContextPacks: () => listAiContextPacks(),
    deleteAiContextPack: (id: string) => deleteAiContextPack(id),
  },
}));

const { persistModuleContext, resetContextPersistCache, contextPackId } = await import('../contextPersist');
const { INSIGHT_LEDGER_KEY, invalidateInsightFeedback } = await import('../insightFeedback');

const SCOPE = 'analysis-persist-test';

/** 分节正文由外部可变的 map 决定，便于用例模拟「只有某一节变了」 */
const bodies: Record<string, string> = { overview: 'v1', hotspots: 'v1', techDebt: 'v1' };

/** 记录每次 buildPack 收到的参数：用来断言「落库永远不裁剪」 */
const buildCalls: Array<{ sectionKeys?: string[]; hasPrevious: boolean }> = [];

const provider: AiContextProvider = {
  moduleId: 'test-module',
  label: '测试模块',
  description: '',
  isAvailable: () => true,
  buildPack: (scopeId, options) => {
    buildCalls.push({
      sectionKeys: options?.sectionKeys,
      hasPrevious: !!options?.previousSections,
    });
    // 原料分节：digest/updatedAt 占位，真实值由 stampSections 填
    const raw: AiContextSection[] = Object.keys(bodies).map((key, i) => ({
      key,
      title: key,
      summary: `${key} 摘要`,
      content: bodies[key],
      tokenEstimate: 10 + i,
      priority: i,
      digest: '',
      updatedAt: 0,
    }));
    const now = options?.now ?? 1_700_000_000_000;
    const { sections, changed, unchanged } = stampSections(raw, options?.previousSections, now);
    return {
      moduleId: 'test-module',
      scopeId,
      scopeLabel: scopeId,
      schemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      generatedAt: now,
      sections,
      tokenEstimate: sections.reduce((s, x) => s + x.tokenEstimate, 0),
      digest: packDigestFromSections(scopeId, AI_CONTEXT_SCHEMA_VERSION, sections),
      truncatedSections: [],
      changedSections: changed,
      unchangedSections: unchanged,
    };
  },
  presets: [],
};

beforeEach(() => {
  resetContextPersistCache();
  // 回流缓存是跨用例的模块级状态：不清会让上一条用例的洞察泄漏到下一条，
  // 表现为「单跑通过、全量跑失败」这类最难查的用例耦合。
  invalidateInsightFeedback();
  saveAiContextPack.mockClear();
  saveAiContextSections.mockClear();
  listAiContextSectionStamps.mockClear();
  listAiInsights.mockClear();
  listAiInsights.mockResolvedValue([]);
  buildCalls.length = 0;
  bodies.overview = 'v1';
  bodies.hotspots = 'v1';
  bodies.techDebt = 'v1';
});

describe('persistModuleContext', () => {
  it('首次落库走整包写，且写入的是全部分节', async () => {
    const res = await persistModuleContext(provider, SCOPE);
    expect(res?.mode).toBe('full');
    expect(saveAiContextPack).toHaveBeenCalledTimes(1);
    const written = saveAiContextPack.mock.calls[0][0];
    // 账本是通用派生分节，由落库入口统一挂上——模块 provider 对它一无所知
    expect(written.sections.map((s) => s.key).sort()).toEqual([INSIGHT_LEDGER_KEY, 'hotspots', 'overview', 'techDebt']);
    expect(res?.packId).toBe(contextPackId('test-module', SCOPE));
  });

  it('内容完全没变时跳过写库——白写一次不仅浪费 IO，还会刷新 updatedAt 抹掉增量信号', async () => {
    await persistModuleContext(provider, SCOPE);
    saveAiContextPack.mockClear();
    const res = await persistModuleContext(provider, SCOPE);
    expect(res?.mode).toBe('skip');
    expect(res?.changed).toBe(false);
    expect(saveAiContextPack).not.toHaveBeenCalled();
    expect(saveAiContextSections).not.toHaveBeenCalled();
  });

  it('只有一节变化时走部分写，且只重写那一节', async () => {
    await persistModuleContext(provider, SCOPE);
    bodies.hotspots = 'v2';
    const res = await persistModuleContext(provider, SCOPE);
    expect(res?.mode).toBe('partial');
    expect(saveAiContextSections).toHaveBeenCalledTimes(1);
    expect(saveAiContextSections.mock.calls[0][1]).toEqual(['hotspots']);
  });

  it('绝不按 sectionKeys 裁剪落库——库里必须始终是全集', async () => {
    await persistModuleContext(provider, SCOPE);
    bodies.overview = 'v9';
    await persistModuleContext(provider, SCOPE);
    expect(buildCalls.every((c) => c.sectionKeys === undefined)).toBe(true);
  });

  it('第二次构建会带上历史分节戳，未变的节才能继承旧 updatedAt', async () => {
    await persistModuleContext(provider, SCOPE);
    await persistModuleContext(provider, SCOPE);
    expect(buildCalls[0].hasPrevious).toBe(false);
    expect(buildCalls[1].hasPrevious).toBe(true);
  });

  it('缓存清空后从库里水合戳，而不是把「没查过」当成「没有历史」整包重写', async () => {
    await persistModuleContext(provider, SCOPE);
    const first = saveAiContextPack.mock.calls[0][0];
    resetContextPersistCache();
    listAiContextSectionStamps.mockResolvedValueOnce(
      first.sections.map((s) => ({
        sectionKey: s.key,
        digest: s.digest,
        updatedAt: s.updatedAt,
        tokenEstimate: s.tokenEstimate,
      })),
    );
    saveAiContextPack.mockClear();
    const res = await persistModuleContext(provider, SCOPE);
    expect(res?.mode).toBe('skip');
    expect(saveAiContextPack).not.toHaveBeenCalled();
  });

  it('取戳失败不阻断，退化为整包重写', async () => {
    listAiContextSectionStamps.mockRejectedValueOnce(new Error('db locked'));
    const res = await persistModuleContext(provider, SCOPE);
    expect(res?.mode).toBe('full');
  });

  it('forceFull 时无视增量判定整包重写（修复用途）', async () => {
    await persistModuleContext(provider, SCOPE);
    saveAiContextPack.mockClear();
    const res = await persistModuleContext(provider, SCOPE, { forceFull: true });
    expect(res?.mode).toBe('full');
    expect(saveAiContextPack).toHaveBeenCalledTimes(1);
  });

  it('provider 无数据时返回 null，不写库', async () => {
    const empty: AiContextProvider = { ...provider, buildPack: () => null };
    const res = await persistModuleContext(empty, SCOPE);
    expect(res).toBeNull();
    expect(saveAiContextPack).not.toHaveBeenCalled();
  });
});

/**
 * 结论账本（派生分节）挂载行为。
 *
 * 这一组用例守的是**自激循环**：账本的内容由 Agent 自己的产出决定，
 * 一旦它进入包指纹，就会形成「分析 → 存洞察 → 指纹变 → 判定内容已变化 → 再分析」
 * 的正反馈。它不报错、不崩溃，只是按小时稳定烧钱，而所有面板都是绿的。
 */
describe('persistModuleContext · 结论账本', () => {
  const insight = (over: Record<string, unknown> = {}) => ({
    id: 'ins_1',
    packId: null,
    analysisId: SCOPE,
    agentId: null,
    kind: 'risk',
    title: '循环依赖',
    body: '…',
    severity: 'high',
    refs: ['src/a.ts:10'],
    status: 'open',
    lastSeen: 1000,
    changedRefs: [] as string[],
    missingRefs: [] as string[],
    evidenceDigest: 'd1',
    ...over,
  });

  it('账本被挂进包里，且 provider 完全不知情（模块零改动即继承回流）', async () => {
    listAiInsights.mockResolvedValue([insight()]);
    const res = await persistModuleContext(provider, SCOPE);
    const ledger = res!.pack.sections.find((s) => s.key === INSIGHT_LEDGER_KEY);
    expect(ledger).toBeDefined();
    expect(ledger!.derived).toBe(true);
    expect(ledger!.content).toContain('src/a.ts');
  });

  it('洞察变化不改变包指纹——否则「存一条结论」会被当成「数据变了」，形成自激循环', async () => {
    listAiInsights.mockResolvedValue([]);
    const before = (await persistModuleContext(provider, SCOPE))!.pack.digest;

    resetContextPersistCache();
    invalidateInsightFeedback();
    listAiInsights.mockResolvedValue([insight(), insight({ id: 'ins_2', title: '上帝类' })]);
    const after = (await persistModuleContext(provider, SCOPE))!.pack.digest;

    expect(after).toBe(before);
  });

  it('只有账本变化时走部分写：库里的账本要保持新鲜，但不该整包重写', async () => {
    listAiInsights.mockResolvedValue([]);
    await persistModuleContext(provider, SCOPE);
    saveAiContextPack.mockClear();
    saveAiContextSections.mockClear();

    invalidateInsightFeedback();
    listAiInsights.mockResolvedValue([insight()]);
    const res = await persistModuleContext(provider, SCOPE);

    expect(res?.mode).toBe('partial');
    expect(saveAiContextSections.mock.calls[0][1]).toEqual([INSIGHT_LEDGER_KEY]);
    expect(saveAiContextPack).not.toHaveBeenCalled();
  });

  it('账本键计入 allKeys：否则每轮都会因「分节集合不一致」整包重写，抹掉全部增量信号', async () => {
    listAiInsights.mockResolvedValue([insight()]);
    await persistModuleContext(provider, SCOPE);
    const first = saveAiContextPack.mock.calls[0][0];

    // 模拟应用重启：缓存清空，只能从库里水合。库里是上一轮写进去的全集（含账本）
    resetContextPersistCache();
    invalidateInsightFeedback();
    listAiContextSectionStamps.mockResolvedValueOnce(
      first.sections.map((s) => ({
        sectionKey: s.key,
        digest: s.digest,
        updatedAt: s.updatedAt,
        tokenEstimate: s.tokenEstimate,
      })),
    );
    saveAiContextPack.mockClear();
    const res = await persistModuleContext(provider, SCOPE);

    expect(res?.mode).toBe('skip');
    expect(saveAiContextPack).not.toHaveBeenCalled();
  });

  it('读洞察失败时账本照挂但标记不可用——缺席会被 Agent 读成「以前没分析过」', async () => {
    listAiInsights.mockRejectedValue(new Error('db locked'));
    const res = await persistModuleContext(provider, SCOPE);
    const ledger = res!.pack.sections.find((s) => s.key === INSIGHT_LEDGER_KEY);
    expect(ledger).toBeDefined();
    expect(ledger!.dataQuality?.status).toBe('unavailable');
    expect(ledger!.content).toContain('不要据此判断');
  });
});
