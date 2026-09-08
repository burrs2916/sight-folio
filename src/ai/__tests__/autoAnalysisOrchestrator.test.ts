/**
 * 自动分析编排的判定逻辑回归测试。
 *
 * 这套闸门（触发时机 / 冷却 / 指纹去重）是「自动」与「失控」之间唯一的分界线：
 * 判错一次不是功能不可用，而是用户的 token 在后台被反复烧掉，且没人会立刻发现。
 * 所以每条分支都要有用例钉住。
 */
import { describe, it, expect } from "vitest";
import {
  evaluateAutoRule,
  isRotatingRule,
  PRESET_ROTATE,
  TRIGGER_ON_ANY,
  TRIGGER_ON_FULL,
  type AutoRuleEvalContext,
} from "../autoAnalysisOrchestrator";
import type { AiAutoAnalysisRule } from "../../services/tauri";

const NOW = 1_700_000_000;

function makeRule(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
  return {
    id: "rule1",
    enabled: true,
    moduleId: "project-scan",
    scopeId: null,
    agentId: "agent_user_picked",
    presetKey: "holistic-optimization",
    triggerOn: TRIGGER_ON_FULL,
    cooldownMinutes: 30,
    skipIfUnchanged: true,
    lastRunAt: 0,
    lastDigest: "",
    lastConversationId: null,
    ...over,
  };
}

function makeCtx(over: Partial<AutoRuleEvalContext> = {}): AutoRuleEvalContext {
  return {
    moduleId: "project-scan",
    scopeId: "analysis1",
    trigger: "full-scan",
    digest: "digest-A",
    nowSec: NOW,
    ...over,
  };
}

/** 轮转规则构造器：供轮转补齐与焦点补齐两组用例共用 */
function rotating(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
  return makeRule({
    presetKey: PRESET_ROTATE,
    lastRunAt: NOW - 60 * 60, // 冷却早已过
    lastDigest: "digest-A",
    ...over,
  });
}

describe("evaluateAutoRule", () => {
  it("首次全量扫描且规则启用时应触发", () => {
    const d = evaluateAutoRule(makeRule(), makeCtx());
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("ok");
  });

  it("规则停用时不触发", () => {
    const d = evaluateAutoRule(makeRule({ enabled: false }), makeCtx());
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("模块不匹配时不触发（未来多模块共用同一张规则表的隔离保证）", () => {
    const d = evaluateAutoRule(makeRule({ moduleId: "canvas" }), makeCtx());
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("module-mismatch");
  });

  it("规则绑定了别的作用域时不触发", () => {
    const d = evaluateAutoRule(makeRule({ scopeId: "analysis-other" }), makeCtx());
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("scope-mismatch");
  });

  it("scopeId 为空表示对该模块所有作用域生效", () => {
    const d = evaluateAutoRule(makeRule({ scopeId: null }), makeCtx({ scopeId: "any-analysis" }));
    expect(d.shouldRun).toBe(true);
  });

  it("「仅全量」规则遇到增量重扫应跳过——否则改一个文件就触发一轮全量解读", () => {
    const d = evaluateAutoRule(
      makeRule({ triggerOn: TRIGGER_ON_FULL }),
      makeCtx({ trigger: "incremental" }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("trigger-mismatch");
  });

  it("「含增量」规则在增量重扫时应触发", () => {
    const d = evaluateAutoRule(
      makeRule({ triggerOn: TRIGGER_ON_ANY }),
      makeCtx({ trigger: "incremental" }),
    );
    expect(d.shouldRun).toBe(true);
  });

  it("冷却窗口内跳过，并在说明里给出剩余分钟数", () => {
    // 10 分钟前跑过，窗口 30 分钟 → 还需约 20 分钟
    const d = evaluateAutoRule(
      makeRule({ lastRunAt: NOW - 10 * 60, lastDigest: "digest-OLD" }),
      makeCtx(),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("cooling");
    expect(d.detail).toContain("20");
  });

  it("冷却窗口已过则放行", () => {
    const d = evaluateAutoRule(
      makeRule({ lastRunAt: NOW - 31 * 60, lastDigest: "digest-OLD" }),
      makeCtx(),
    );
    expect(d.shouldRun).toBe(true);
  });

  it("冷却设为 0 表示不限流", () => {
    const d = evaluateAutoRule(
      makeRule({ cooldownMinutes: 0, lastRunAt: NOW - 5, lastDigest: "digest-OLD" }),
      makeCtx(),
    );
    expect(d.shouldRun).toBe(true);
  });

  it("指纹一致时跳过（同样的数据不重复烧 AI）", () => {
    const d = evaluateAutoRule(
      makeRule({ lastRunAt: NOW - 60 * 60, lastDigest: "digest-A" }),
      makeCtx({ digest: "digest-A" }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("指纹变化时触发", () => {
    const d = evaluateAutoRule(
      makeRule({ lastRunAt: NOW - 60 * 60, lastDigest: "digest-A" }),
      makeCtx({ digest: "digest-B" }),
    );
    expect(d.shouldRun).toBe(true);
  });

  it("关闭去重后即便指纹一致也触发（用户显式要求每次都分析）", () => {
    const d = evaluateAutoRule(
      makeRule({ skipIfUnchanged: false, lastRunAt: NOW - 60 * 60, lastDigest: "digest-A" }),
      makeCtx({ digest: "digest-A" }),
    );
    expect(d.shouldRun).toBe(true);
  });

  it("新建规则即便内容指纹与上次持久化相同也应首次触发（lastDigest 为空）", () => {
    // 场景：用户刚配好规则，项目没改动，下一次扫描内容 digest 与之前一致。
    // 若拿「上下文包是否变化」当闸门，这条规则将永远等不到第一次运行。
    const d = evaluateAutoRule(makeRule({ lastDigest: "", lastRunAt: 0 }), makeCtx());
    expect(d.shouldRun).toBe(true);
  });

  it("闸门优先级：冷却先于指纹判定（两者同时命中时报冷却，说明更贴近用户直觉）", () => {
    const d = evaluateAutoRule(
      makeRule({ lastRunAt: NOW - 60, lastDigest: "digest-A" }),
      makeCtx({ digest: "digest-A" }),
    );
    expect(d.reason).toBe("cooling");
  });
});

/**
 * 轮转补齐的例外分支。
 *
 * 这里钉住的是一个很容易被「优化」掉的结论：指纹去重与维度轮转天然冲突。
 * 去重的假设是「同样的数据 → 同样的结论」，但轮转下一轮问的是**另一个问题**，
 * 结论必然不同。若不开这个口子，项目一旦稳定不动，除第一个维度外的所有方面
 * 将永远得不到分析——轮转功能等于没写。
 *
 * 同时也钉住这个口子的边界：它只压过「指纹」，不压过停用 / 冷却 / 触发时机，
 * 否则就从「补齐缺口」退化成「无限烧 token」。
 */
describe("evaluateAutoRule · 轮转补齐", () => {
  it("轮转哨兵能被识别，普通预设不会被误判为轮转", () => {
    expect(isRotatingRule(rotating())).toBe(true);
    expect(isRotatingRule(makeRule({ presetKey: "holistic-optimization" }))).toBe(false);
  });

  it("内容未变但仍有维度从未分析过时，轮转规则照常触发", () => {
    const d = evaluateAutoRule(
      rotating(),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("rotate-gap");
    expect(d.detail).toContain("补齐");
  });

  it("所有维度都覆盖过之后，轮转规则回到正常的指纹去重", () => {
    const d = evaluateAutoRule(
      rotating(),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: false }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("缺口信息缺省时按「无缺口」处理，不能默认放行", () => {
    // 调用方忘了传 hasUncoveredDimension 时，宁可少跑一轮，也不能默认烧 token。
    const d = evaluateAutoRule(rotating(), makeCtx({ digest: "digest-A" }));
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("锁定单一维度的规则不享受这个例外", () => {
    const d = evaluateAutoRule(
      rotating({ presetKey: "holistic-optimization" }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("补齐例外不能越过冷却闸门", () => {
    const d = evaluateAutoRule(
      rotating({ lastRunAt: NOW - 5 * 60 }), // 窗口 30 分钟，才过 5 分钟
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("cooling");
  });

  it("停用的轮转规则不会因为有缺口就复活", () => {
    const d = evaluateAutoRule(
      rotating({ enabled: false }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("「仅全量」的轮转规则遇到增量重扫仍然跳过", () => {
    const d = evaluateAutoRule(
      rotating({ triggerOn: TRIGGER_ON_FULL }),
      makeCtx({ trigger: "incremental", digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("trigger-mismatch");
  });

  it("关闭去重的轮转规则走常规放行路径（reason 仍是 ok，不该被误标成补齐）", () => {
    const d = evaluateAutoRule(
      rotating({ skipIfUnchanged: false }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("ok");
  });
});

/**
 * 焦点目标补齐（focus-gap）的例外分支。
 *
 * 与 rotate-gap 同源、但更普适：指纹去重假设「同样的数据 → 同样的结论」，可那只在
 * **看的对象是同一个**时才成立。共振榜第一名在单个维度的 Top-N 里从不露面，
 * 全靠 Agent 自己挑对象，它几乎必然永远只挑那几个显眼大文件——于是头号重构目标
 * 从头到尾无人碰，自动化却一路绿灯。
 *
 * 这一条例外对**所有规则**生效（不只是轮转），但同样不压过停用 / 冷却 / 触发时机，
 * 收敛性由派单台账（点名即销账、目标总数有限）与冷却闸门共同保证。
 */
describe("evaluateAutoRule · 焦点目标补齐", () => {
  function focusRule(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
    return makeRule({
      presetKey: "holistic-optimization", // 非轮转规则，证明 focus-gap 不只服务轮转
      lastRunAt: NOW - 60 * 60, // 冷却早已过
      lastDigest: "digest-A",
      ...over,
    });
  }

  it("内容未变但共振榜上仍有文件从未巡查时，普通规则也照常触发", () => {
    const d = evaluateAutoRule(
      focusRule(),
      makeCtx({ digest: "digest-A", hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("focus-gap");
    expect(d.detail).toContain("点名");
  });

  it("没有未巡查焦点时回到正常指纹去重", () => {
    const d = evaluateAutoRule(
      focusRule(),
      makeCtx({ digest: "digest-A", hasUnpatrolledFocus: false }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("缺口信息缺省时按「无缺口」处理，不能默认放行", () => {
    // 调用方忘了传 hasUnpatrolledFocus 时，宁可少跑一轮，也不能默认烧 token。
    const d = evaluateAutoRule(focusRule(), makeCtx({ digest: "digest-A" }));
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });

  it("补齐例外不能越过冷却闸门", () => {
    const d = evaluateAutoRule(
      focusRule({ lastRunAt: NOW - 5 * 60 }),
      makeCtx({ digest: "digest-A", hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("cooling");
  });

  it("停用的规则不会因为有未巡查焦点就复活", () => {
    const d = evaluateAutoRule(
      focusRule({ enabled: false }),
      makeCtx({ digest: "digest-A", hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("disabled");
  });

  it("「仅全量」规则遇到增量重扫仍然跳过（焦点补齐不绕过触发时机）", () => {
    const d = evaluateAutoRule(
      focusRule({ triggerOn: TRIGGER_ON_FULL }),
      makeCtx({ trigger: "incremental", digest: "digest-A", hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("trigger-mismatch");
  });

  it("轮转规则同时有维度缺口与焦点缺口时，维度补齐优先（reason 仍为 rotate-gap）", () => {
    // 缺口维度比缺口文件更严重：先补粗粒度的「方面」，再补细粒度的「对象」。
    const d = evaluateAutoRule(
      rotating({ lastDigest: "digest-A", lastRunAt: NOW - 60 * 60 }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true, hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("rotate-gap");
  });

  it("轮转规则已有维度覆盖、但仍有未巡查焦点时，由 focus-gap 兜底触发", () => {
    const d = evaluateAutoRule(
      rotating({ lastDigest: "digest-A", lastRunAt: NOW - 60 * 60 }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: false, hasUnpatrolledFocus: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("focus-gap");
  });
});

/**
 * 回归追责（regression-gap）的例外分支。
 *
 * 它与其余三个例外的排序依据不是「谁更重要」，而是「这一轮不跑会**永久损失**什么」：
 *   · rotate-gap / focus-gap 补的是空白，空白不会跑掉，这轮不补下轮还在；
 *   · recheck-gap 拖着只是更贵，结论还在库里等；
 *   · 而一次劣化只要撑到下一次扫描就滚进新基线，从此没有任何视图看得见它。
 * 所以它排在 focus / recheck 之前，却仍让 rotate-gap 先走——轮转空白粒度最粗、
 * 预设数量有限、几轮就能收敛完，让它先走的代价是有界的。
 */
describe("evaluateAutoRule · 回归追责补齐", () => {
  function plainRule(over: Partial<AiAutoAnalysisRule> = {}): AiAutoAnalysisRule {
    return makeRule({
      presetKey: "holistic-optimization", // 非轮转规则：证明追责不只服务轮转
      lastRunAt: NOW - 60 * 60,
      lastDigest: "digest-A",
      ...over,
    });
  }

  it("内容未变但有文件相对上一次扫描变坏时，普通规则也照常触发", () => {
    const d = evaluateAutoRule(
      plainRule(),
      makeCtx({ digest: "digest-A", hasRegressedFocus: true }),
    );
    expect(d.shouldRun).toBe(true);
    expect(d.reason).toBe("regression-gap");
    expect(d.detail).toContain("变坏");
  });

  it("同时有焦点空白与回归欠账时，追责优先（空白不会跑掉，劣化会）", () => {
    const d = evaluateAutoRule(
      plainRule(),
      makeCtx({ digest: "digest-A", hasRegressedFocus: true, hasUnpatrolledFocus: true }),
    );
    expect(d.reason).toBe("regression-gap");
  });

  it("同时有回归欠账与待复核时，追责优先（复核漏一轮还有下一轮）", () => {
    const d = evaluateAutoRule(
      plainRule(),
      makeCtx({ digest: "digest-A", hasRegressedFocus: true, hasPendingRecheck: true }),
    );
    expect(d.reason).toBe("regression-gap");
  });

  it("轮转规则的维度空白仍排在追责之前（粒度最粗且几轮就收敛）", () => {
    const d = evaluateAutoRule(
      rotating({ lastDigest: "digest-A", lastRunAt: NOW - 60 * 60 }),
      makeCtx({ digest: "digest-A", hasUncoveredDimension: true, hasRegressedFocus: true }),
    );
    expect(d.reason).toBe("rotate-gap");
  });

  it("追责例外不压过停用 / 冷却 / 触发时机这三道硬闸门", () => {
    expect(
      evaluateAutoRule(
        plainRule({ enabled: false }),
        makeCtx({ digest: "digest-A", hasRegressedFocus: true }),
      ).reason,
    ).toBe("disabled");
    expect(
      evaluateAutoRule(
        plainRule({ lastRunAt: NOW - 5 * 60 }),
        makeCtx({ digest: "digest-A", hasRegressedFocus: true }),
      ).reason,
    ).toBe("cooling");
    expect(
      evaluateAutoRule(
        plainRule({ triggerOn: TRIGGER_ON_FULL }),
        makeCtx({ trigger: "incremental", digest: "digest-A", hasRegressedFocus: true }),
      ).reason,
    ).toBe("trigger-mismatch");
  });

  it("缺省时按「没有回归」处理，不能默认放行", () => {
    const d = evaluateAutoRule(plainRule(), makeCtx({ digest: "digest-A" }));
    expect(d.shouldRun).toBe(false);
    expect(d.reason).toBe("unchanged");
  });
});
