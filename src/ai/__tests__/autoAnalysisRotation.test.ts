/**
 * planRotation —— 「这一轮该分析哪个维度」的决策回归。
 *
 * 轮转要解决的实际问题是：用户不该为了让 Agent 把项目各个方面都看一遍，
 * 手工建 N 条规则、再各自配好错开的冷却。一条规则跑上几轮，覆盖自然铺开。
 *
 * 这里钉住三件事：
 *   · 用户显式选定的维度**永远优先**，自动推断不得越权；
 *   · 从未分析过的维度排在「数据已变」前面（先补白，再复看）；
 *   · 台账查询失败不阻断分析——观测手段的故障不该让主流程停摆。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AiAutoAnalysisRule, AiAutoAnalysisRun } from "../../services/tauri";
import type { AiAnalysisPreset, AiContextProvider } from "../contextTypes";
import { pickLang } from "../../i18n";

const listAnalysisCoverage = vi.fn(async (): Promise<AiAutoAnalysisRun[]> => []);

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    listAnalysisCoverage: () => listAnalysisCoverage(),
    recordAutoAnalysisRun: vi.fn(async () => undefined),
  },
  agentApi: {},
}));

const { planRotation, PRESET_ROTATE } = await import("../autoAnalysisOrchestrator");
const { aiContextRegistry } = await import("../contextRegistry");

const MODULE = "rotation-test-module";
const SCOPE = "analysis-1";
const NOW = 1_700_000_000;

/** 只有 presets 是本用例关心的，其余按协议填最小实现 */
const PRESETS: AiAnalysisPreset[] = [
  { key: "p-arch", title: { "zh-CN": "架构体检", "en-US": "Architecture Check" }, description: { "zh-CN": "", "en-US": "" }, prompt: { "zh-CN": "", "en-US": "" }, sectionKeys: ["overview"] },
  { key: "p-debt", title: { "zh-CN": "技术债清理", "en-US": "Tech Debt Cleanup" }, description: { "zh-CN": "", "en-US": "" }, prompt: { "zh-CN": "", "en-US": "" }, sectionKeys: ["techDebt"] },
  { key: "p-risk", title: { "zh-CN": "风险排查", "en-US": "Risk Patrol" }, description: { "zh-CN": "", "en-US": "" }, prompt: { "zh-CN": "", "en-US": "" }, sectionKeys: ["hotspots"] },
];

const provider: AiContextProvider = {
  moduleId: MODULE,
  label: "轮转测试模块",
  description: "",
  isAvailable: () => true,
  buildPack: () => null,
  presets: PRESETS,
};

function rule(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
  return {
    id: "rule-rotate",
    enabled: true,
    moduleId: MODULE,
    scopeId: null,
    agentId: "agent_user_picked",
    presetKey: PRESET_ROTATE,
    triggerOn: "full-scan",
    cooldownMinutes: 30,
    skipIfUnchanged: true,
    lastRunAt: 0,
    lastDigest: "",
    lastConversationId: null,
    ...over,
  };
}

/** 造一条「某维度在某时刻、基于某份数据分析过」的历史轨迹 */
function run(presetKey: string, atSec: number, digest: string): AiAutoAnalysisRun {
  return {
    id: `run-${presetKey}-${atSec}`,
    ruleId: "rule-rotate",
    moduleId: MODULE,
    scopeId: SCOPE,
    agentId: "agent_user_picked",
    presetKey,
    packId: `${SCOPE}:${MODULE}`,
    conversationId: "conv-1",
    triggerKind: "full-scan",
    status: "triggered",
    detail: "",
    contextDigest: digest,
    createdAt: atSec,
  } as AiAutoAnalysisRun;
}

const ctx = (over: Partial<{ digest: string; nowSec: number }> = {}) => ({
  moduleId: MODULE,
  scopeId: SCOPE,
  digest: "digest-A",
  nowSec: NOW,
  ...over,
});

describe("planRotation", () => {
  beforeEach(() => {
    listAnalysisCoverage.mockReset();
    listAnalysisCoverage.mockResolvedValue([]);
    // 先注销再注册：注册表是单例，重复注册会打告警污染用例输出
    aiContextRegistry.unregister(MODULE);
    aiContextRegistry.register(provider);
  });

  it("规则锁定了维度时原样照办，连台账都不查（用户的选择优先于自动推断）", async () => {
    const plan = await planRotation(rule({ presetKey: "p-debt" }), ctx());
    expect(plan.presetKey).toBe("p-debt");
    expect(plan.hasUncovered).toBe(false);
    expect(listAnalysisCoverage).not.toHaveBeenCalled();
  });

  it("历史规则的空预设保持原语义（交给 runner 兜底取第一个）", async () => {
    const plan = await planRotation(rule({ presetKey: "" }), ctx());
    expect(plan.presetKey).toBeUndefined();
    expect(listAnalysisCoverage).not.toHaveBeenCalled();
  });

  it("首轮无任何历史时挑第一个维度，并标记仍有未覆盖的方面", async () => {
    const plan = await planRotation(rule(), ctx());
    expect(plan.presetKey).toBe("p-arch");
    expect(plan.hasUncovered).toBe(true);
    expect(plan.note).toContain(pickLang(PRESETS[0].title));
  });

  it("已分析过的维度让位给从未分析过的（这才叫轮转）", async () => {
    listAnalysisCoverage.mockResolvedValue([run("p-arch", NOW - 60, "digest-A")]);
    const plan = await planRotation(rule(), ctx());
    expect(plan.presetKey).toBe("p-debt");
    expect(plan.hasUncovered).toBe(true);
  });

  it("全部覆盖过之后 hasUncovered 转 false —— 指纹去重从此重新生效", async () => {
    listAnalysisCoverage.mockResolvedValue([
      run("p-arch", NOW - 300, "digest-A"),
      run("p-debt", NOW - 200, "digest-A"),
      run("p-risk", NOW - 100, "digest-A"),
    ]);
    const plan = await planRotation(rule(), ctx());
    expect(plan.hasUncovered).toBe(false);
    // 数据没变、都看过 → 复看最久没看的那个，而不是死盯第一个
    expect(plan.presetKey).toBe("p-arch");
    expect(plan.note).toContain(pickLang(PRESETS[0].title));
  });

  it("数据变了的维度优先于仍新鲜的维度", async () => {
    listAnalysisCoverage.mockResolvedValue([
      run("p-arch", NOW - 300, "digest-OLD"), // 基于旧数据看的 → 结论可能已过期
      run("p-debt", NOW - 200, "digest-A"),
      run("p-risk", NOW - 100, "digest-A"),
    ]);
    const plan = await planRotation(rule(), ctx({ digest: "digest-A" }));
    expect(plan.presetKey).toBe("p-arch");
    expect(plan.hasUncovered).toBe(false);
  });

  it("台账查询失败时退回默认预设，不阻断本轮分析", async () => {
    listAnalysisCoverage.mockRejectedValue(new Error("db locked"));
    const plan = await planRotation(rule(), ctx());
    expect(plan.presetKey).toBeUndefined();
    expect(plan.hasUncovered).toBe(false);
  });

  it("模块没有注册任何预设时安全退化", async () => {
    aiContextRegistry.unregister(MODULE);
    aiContextRegistry.register({ ...provider, presets: [] });
    const plan = await planRotation(rule(), ctx());
    expect(plan.presetKey).toBeUndefined();
    expect(plan.hasUncovered).toBe(false);
  });

  it("模块根本没注册时也不抛错（规则可能指向已卸载的模块）", async () => {
    aiContextRegistry.unregister(MODULE);
    const plan = await planRotation(rule(), ctx());
    expect(plan.presetKey).toBeUndefined();
  });
});
