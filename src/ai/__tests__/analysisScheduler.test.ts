/**
 * 补跑调度的判定回归测试。
 *
 * 这套判定有两个方向的失败，代价完全不对称：
 *   · 判漏（该补没补）→ 自动化悄悄停摆，用户以为它在跑，其实好几天没动过；
 *   · 判多（不该补却补）→ 每几分钟发起一轮真实对话，token 在后台烧光。
 * 两者都不会报错、都不会有人当场发现，所以每条分支都必须被用例钉死。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AiAutoAnalysisRule, AiAutoAnalysisRun } from "../../services/tauri";

let rulesFixture: AiAutoAnalysisRule[] = [];
let latestFixture: AiAutoAnalysisRun[] = [];
let coverageRunsFixture: AiAutoAnalysisRun[] = [];
let assignmentsFixture: unknown[] = [];
/** 探测类调用计数：用来证明「便宜的心跳没有偷偷变贵」 */
const probeCalls = { coverage: 0, assignments: 0 };

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    listAutoAnalysisRules: async () => rulesFixture,
    listLatestRunPerRule: async () => latestFixture,
    listAnalysisCoverage: async () => {
      probeCalls.coverage += 1;
      return coverageRunsFixture;
    },
    listFocusAssignments: async () => {
      probeCalls.assignments += 1;
      return assignmentsFixture;
    },
    recordAutoAnalysisRun: vi.fn(async () => undefined),
    finishAutoAnalysisRun: vi.fn(async () => undefined),
  },
  agentApi: {},
}));

const {
  shouldBackfill,
  surveyBackfills,
  gapProbeEligible,
  GAP_BACKFILL_FLOOR_SEC,
  RETRY_BACKOFF_SEC,
  STALE_PENDING_SEC,
  startAnalysisScheduler,
  stopAnalysisScheduler,
  getSchedulerStatus,
  DEFAULT_TICK_MS,
} = await import("../analysisScheduler");
const { aiContextRegistry } = await import("../contextRegistry");

const NOW = 1_700_000_000;

function makeRule(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
  return {
    id: "rule1",
    enabled: true,
    moduleId: "project-scan",
    scopeId: null,
    agentId: "agent_user_picked",
    presetKey: "__rotate__",
    triggerOn: "full-scan",
    cooldownMinutes: 30,
    skipIfUnchanged: true,
    lastRunAt: 0,
    lastDigest: "",
    lastConversationId: null,
    ...over,
  };
}

function makeRun(over: Partial<AiAutoAnalysisRun> = {}): AiAutoAnalysisRun {
  return {
    id: "run1",
    ruleId: "rule1",
    moduleId: "project-scan",
    scopeId: "analysis1",
    agentId: "agent_user_picked",
    presetKey: "holistic-optimization",
    packId: "analysis1:project-scan",
    conversationId: "conv1",
    triggerKind: "full-scan",
    status: "triggered",
    detail: "",
    contextDigest: "digest-A",
    reason: "ok",
    outcome: "completed",
    insightCount: 3,
    finishedAt: NOW - 100,
    createdAt: NOW - 200,
    ...over,
  };
}

describe("shouldBackfill", () => {
  it("规则停用时永不欠账——停用是用户的明确意愿，补跑不能绕过它", () => {
    expect(shouldBackfill(makeRule({ enabled: false }), undefined, NOW).owed).toBe(false);
  });

  it("规则从未跑过时欠一轮：这正是「建好规则后再没扫描过」的典型停摆", () => {
    const v = shouldBackfill(makeRule(), undefined, NOW);
    expect(v.owed).toBe(true);
    expect(v.reason).toBe("never-run");
  });

  it("上一轮因冷却跳过 → 欠账（冷却结束后原本没有任何人来接续）", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "skipped", reason: "cooling", outcome: "" }),
      NOW,
    );
    expect(v.owed).toBe(true);
    expect(v.reason).toBe("recoverable-skip");
  });

  it("上一轮因 Agent 忙碌跳过 → 欠账", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "skipped", reason: "busy", outcome: "" }),
      NOW,
    );
    expect(v.owed).toBe(true);
    expect(v.reason).toBe("recoverable-skip");
  });

  it("因内容未变化跳过不算欠账——补跑它只会拿同一份数据再烧一次 token", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "skipped", reason: "unchanged", outcome: "" }),
      NOW,
    );
    expect(v.owed).toBe(false);
  });

  it("因触发时机不匹配跳过不算欠账——那是规则设计如此，不是意外", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "skipped", reason: "trigger-mismatch", outcome: "" }),
      NOW,
    );
    expect(v.owed).toBe(false);
  });

  it("发起失败后先退避再重试：退避窗内不重试", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "failed", outcome: "", createdAt: NOW - RETRY_BACKOFF_SEC + 60 }),
      NOW,
    );
    expect(v.owed).toBe(false);
  });

  it("发起失败且已过退避窗 → 重试", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ status: "failed", outcome: "", createdAt: NOW - RETRY_BACKOFF_SEC - 1 }),
      NOW,
    );
    expect(v.owed).toBe(true);
    expect(v.reason).toBe("failed-retry");
  });

  it("对话中途报错（outcome=error）同样要退避后重试，而不是当场再撞一次", () => {
    const inWindow = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "error", createdAt: NOW - 60 }),
      NOW,
    );
    expect(inWindow.owed).toBe(false);

    const afterWindow = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "error", createdAt: NOW - RETRY_BACKOFF_SEC - 1 }),
      NOW,
    );
    expect(afterWindow.owed).toBe(true);
    expect(afterWindow.reason).toBe("errored-retry");
  });

  it("pending 未超时不打扰——Agent 可能正在认真思考一个长任务", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "pending", finishedAt: 0, createdAt: NOW - 60 }),
      NOW,
    );
    expect(v.owed).toBe(false);
  });

  it("pending 超时视为中断（多半是应用被关掉），重新发起", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "pending", finishedAt: 0, createdAt: NOW - STALE_PENDING_SEC - 1 }),
      NOW,
    );
    expect(v.owed).toBe(true);
    expect(v.reason).toBe("stale-pending");
  });

  it("已清算成 interrupted 的中断轮次直接判欠账、且不再叠退避——「关窗口」极常见，不应多等一轮", () => {
    // 刚被清算器落定的轮次：它能被标成 interrupted，就说明早已过了判定窗口。
    // 这里再叠一层 RETRY_BACKOFF 退避，等于「关掉应用」这件极常见的事还要额外多等 15 分钟。
    const justNow = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "interrupted", finishedAt: 0, createdAt: NOW - 1 }),
      NOW,
    );
    expect(justNow.owed).toBe(true);
    expect(justNow.reason).toBe("stale-pending");

    // 退避窗内也照判——interrrupted 与 error 死法不同，不该继承 error 的退避逻辑
    const inBackoff = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "interrupted", finishedAt: 0, createdAt: NOW - RETRY_BACKOFF_SEC + 60 }),
      NOW,
    );
    expect(inBackoff.owed).toBe(true);
    expect(inBackoff.reason).toBe("stale-pending");
  });

  it("已完成不欠账", () => {
    expect(shouldBackfill(makeRule(), makeRun({ outcome: "completed" }), NOW).owed).toBe(false);
  });

  it("跑完但没产出洞察也算了结——反复重跑不会让 Agent 忽然有话说", () => {
    expect(shouldBackfill(makeRule(), makeRun({ outcome: "no-output" }), NOW).owed).toBe(false);
  });

  it("回执特性之前的历史轨迹（outcome 空串）按已了结处理，不能升级后把老账全补一遍", () => {
    const v = shouldBackfill(
      makeRule(),
      makeRun({ outcome: "", finishedAt: 0, createdAt: NOW - 86400 }),
      NOW,
    );
    expect(v.owed).toBe(false);
  });
});

describe("surveyBackfills", () => {
  beforeEach(() => {
    rulesFixture = [];
    latestFixture = [];
  });

  it("把规则与「每规则最近一条轨迹」对齐后逐条判定", async () => {
    rulesFixture = [makeRule({ id: "r1" }), makeRule({ id: "r2" })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    // r1 已完成不欠；r2 从未跑过欠一轮
    expect(survey.owed.map((o) => o.ruleId)).toEqual(["r2"]);
    expect(survey.owed[0].reason).toBe("never-run");
  });

  it("绑定了别的作用域的规则不参与本作用域巡检", async () => {
    rulesFixture = [makeRule({ id: "r1", scopeId: "other-analysis" })];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(0);
  });

  it("scopeId 为空的规则对所有作用域生效", async () => {
    rulesFixture = [makeRule({ id: "r1", scopeId: null })];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed.map((o) => o.ruleId)).toEqual(["r1"]);
  });

  it("全部已了结时返回空欠账——这是绝大多数心跳应有的结果，不该有任何副作用", async () => {
    rulesFixture = [makeRule({ id: "r1" }), makeRule({ id: "r2" })];
    latestFixture = [
      makeRun({ ruleId: "r1", outcome: "completed" }),
      makeRun({ ruleId: "r2", outcome: "no-output" }),
    ];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(0);
  });
});

// ─── 补齐类欠账（gap-backlog）───
//
// 这一组守的是自动化里最反直觉的一条：项目**越稳定**，补齐机制越容易停摆。
// rotate-gap / focus-gap 都只写在 evaluateAutoRule 里，而它只有在一次扫描落库时
// 才会被调用；项目进入维护期不再重扫，剩下的维度和共振文件就永远是空白。

/** 造一个带焦点目标的假供给者：模块无关链路的最小实现 */
function fakeProvider(over: { focusPaths?: string[]; presetKeys?: string[] } = {}) {
  const focusPaths = over.focusPaths ?? ["src/hot.ts"];
  const presetKeys = over.presetKeys ?? ["p1", "p2"];
  return {
    moduleId: "project-scan",
    label: "假模块",
    description: "",
    isAvailable: () => true,
    buildPack: () => null,
    presets: presetKeys.map((k) => ({
      key: k,
      title: k,
      description: "",
      sectionKeys: [],
      prompt: "",
    })),
    describeFocus: () => ({
      title: "",
      summary: "",
      generatedAt: NOW,
      usableDims: [],
      blindDims: [],
      cooccurrence: [],
      targets: focusPaths.map((p, i) => ({
        filePath: p,
        codeLines: 100,
        score: 90 - i,
        resonance: 3,
        resonantKeys: ["a", "b", "c"],
        dims: {},
      })),
    }),
  };
}

describe("gapProbeEligible · 探测成本预筛（不是闸门，是钱包）", () => {
  it("从未跑过的规则不参与探测——never-run 在便宜阶段已经报过账了", () => {
    expect(gapProbeEligible(makeRule({ lastRunAt: 0 }), NOW)).toBe(false);
  });

  it("停用的规则不参与探测", () => {
    expect(gapProbeEligible(makeRule({ enabled: false, lastRunAt: NOW - 99999 }), NOW)).toBe(false);
  });

  it("冷却填 0 也拦得住：补齐地板是系统自己的额度，不借用户的冷却", () => {
    // 这是防失控最关键的一条。冷却填 0 的规则不少见（图省事），
    // 若补齐类欠账跟着冷却走，心跳会每 5 分钟发起一轮真实对话。
    const rule = makeRule({ cooldownMinutes: 0, lastRunAt: NOW - 40 * 60 });
    expect(gapProbeEligible(rule, NOW)).toBe(false);
    expect(gapProbeEligible(rule, NOW + GAP_BACKFILL_FLOOR_SEC)).toBe(true);
  });

  it("用户设的冷却比地板长时以冷却为准", () => {
    const rule = makeRule({ cooldownMinutes: 24 * 60, lastRunAt: NOW - 2 * 60 * 60 });
    expect(gapProbeEligible(rule, NOW)).toBe(false);
  });
});

describe("surveyBackfills · 补齐类欠账", () => {
  beforeEach(() => {
    rulesFixture = [];
    latestFixture = [];
    coverageRunsFixture = [];
    assignmentsFixture = [];
    probeCalls.coverage = 0;
    probeCalls.assignments = 0;
    aiContextRegistry.register(fakeProvider() as never);
  });

  // 注册表是全局单例：不摘干净会把假供给者漏给后面的用例
  afterEach(() => {
    aiContextRegistry.unregister("project-scan");
  });

  it("稳定期没有任何中断，但共振榜上还有从未巡查的文件 → 记 gap-backlog", async () => {
    rulesFixture = [
      makeRule({ id: "r1", presetKey: "locked", lastRunAt: NOW - 3 * 60 * 60 }),
    ];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    // 覆盖台账已满（两个预设都跑过），所以维度不欠；欠的是文件
    coverageRunsFixture = [
      makeRun({ ruleId: "r1", presetKey: "p1" }),
      makeRun({ ruleId: "r1", presetKey: "p2" }),
    ];

    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(1);
    expect(survey.owed[0].reason).toBe("gap-backlog");
    expect(survey.owed[0].detail).toContain("共振榜");
  });

  it("轮转规则遇到「维度从未覆盖」时优先报维度空白——缺一整个方面比缺几个文件更严重", async () => {
    rulesFixture = [makeRule({ id: "r1", presetKey: "__rotate__", lastRunAt: NOW - 3 * 60 * 60 })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    coverageRunsFixture = []; // 两个预设都没跑过 → 有维度空白

    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed[0].reason).toBe("gap-backlog");
    expect(survey.owed[0].detail).toContain("维度");
  });

  it("锁定维度的规则不查覆盖台账——它消费不了「换个维度」这件事", async () => {
    rulesFixture = [makeRule({ id: "r1", presetKey: "locked", lastRunAt: NOW - 3 * 60 * 60 })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    await surveyBackfills("project-scan", "analysis1", NOW);
    expect(probeCalls.coverage).toBe(0);
  });

  it("已经有中断类欠账时不再探测：反正这一拍必然发起编排，探了是把同一件事算两遍", async () => {
    rulesFixture = [makeRule({ id: "r1", lastRunAt: NOW - 3 * 60 * 60 })];
    latestFixture = []; // r1 从未跑过 → never-run
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed[0].reason).toBe("never-run");
    expect(probeCalls.assignments).toBe(0);
    expect(probeCalls.coverage).toBe(0);
  });

  it("刚跑过不久（未过补齐地板）连探测都不做——这是心跳保持便宜的前提", async () => {
    rulesFixture = [makeRule({ id: "r1", cooldownMinutes: 0, lastRunAt: NOW - 60 })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(0);
    expect(probeCalls.assignments).toBe(0);
  });

  it("共振榜上的文件都派过单了就不再报欠账——派单即销账，否则永不收敛", async () => {
    rulesFixture = [makeRule({ id: "r1", presetKey: "locked", lastRunAt: NOW - 3 * 60 * 60 })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    assignmentsFixture = [
      {
        moduleId: "project-scan",
        scopeId: "analysis1",
        filePath: "src/hot.ts",
        runId: "arun_x",
        presetKey: "p1",
        contextDigest: "digest-A",
        resonance: 3,
        note: "",
        assignCount: 1,
        assignedAt: NOW - 7200,
      },
    ];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(0);
  });

  it("模块没实现 describeFocus 时静默降级，不查派单表也不报欠账", async () => {
    aiContextRegistry.register({
      moduleId: "project-scan",
      label: "无焦点模块",
      description: "",
      isAvailable: () => true,
      buildPack: () => null,
      presets: [{ key: "p1", title: { "zh-CN": "p1", "en-US": "p1" }, description: { "zh-CN": "", "en-US": "" }, sectionKeys: [], prompt: { "zh-CN": "", "en-US": "" } }],
    } as never);
    rulesFixture = [makeRule({ id: "r1", presetKey: "locked", lastRunAt: NOW - 3 * 60 * 60 })];
    latestFixture = [makeRun({ ruleId: "r1", outcome: "completed" })];
    const survey = await surveyBackfills("project-scan", "analysis1", NOW);
    expect(survey.owed).toHaveLength(0);
    expect(probeCalls.assignments).toBe(0);
  });
});

describe("startAnalysisScheduler", () => {
  beforeEach(() => {
    stopAnalysisScheduler();
    rulesFixture = [];
    latestFixture = [];
  });

  it("重复启动不会叠加定时器（切一次项目起一拍，切五次同一规则被并发补跑五次）", () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      startAnalysisScheduler({ getScopeId: () => null, immediate: false });
      startAnalysisScheduler({ getScopeId: () => null, immediate: false });
      startAnalysisScheduler({ getScopeId: () => null, immediate: false });
      // 首次启动时没有旧定时器可清；之后每次启动都必须先把上一个清掉
      expect(clearSpy).toHaveBeenCalledTimes(2);
      expect(getSchedulerStatus().running).toBe(true);
      clearSpy.mockRestore();
    } finally {
      stopAnalysisScheduler();
      vi.useRealTimers();
    }
  });

  it("间隔有下限保护，避免误配成秒级把库和 Agent 打爆", () => {
    vi.useFakeTimers();
    try {
      startAnalysisScheduler({ getScopeId: () => null, intervalMs: 1000, immediate: false });
      expect(getSchedulerStatus().intervalMs).toBeGreaterThanOrEqual(30_000);
    } finally {
      stopAnalysisScheduler();
      vi.useRealTimers();
    }
  });

  it("停止后状态归位，默认间隔为 5 分钟", () => {
    vi.useFakeTimers();
    try {
      startAnalysisScheduler({ getScopeId: () => null, immediate: false });
      expect(getSchedulerStatus().intervalMs).toBe(DEFAULT_TICK_MS);
      stopAnalysisScheduler();
      expect(getSchedulerStatus().running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
