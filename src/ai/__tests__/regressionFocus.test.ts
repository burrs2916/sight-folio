/**
 * regressionFocus + focusPatrol「回归追责」档的回归测试。
 *
 * 这一档与其它几档有一个本质区别：**它会过期**。never / recheck 漏一轮还在原地等，
 * 而一次劣化只要撑到下一次扫描，就滚进新基线成为「一直如此」，从此没有任何视图
 * 看得见它。所以这里的每一条判定错了，代价都不是「晚一点看到」，而是「永远看不到」。
 *
 * 三类必须钉死的东西：
 *   1. 指纹口径（销账依据）—— 错了要么永久重复点名，要么永久静默；
 *   2. 只收 worsened —— 收多了每次加文件都刷一屏假警报，收少了漏掉真劣化；
 *   3. 三本账互不冲销 —— 合并会让一个既欠复核又刚变坏的文件只被看一半。
 */
import { describe, it, expect } from "vitest";
import {
  REGRESSION_INJECT_LIMIT,
  buildRegressionFeedback,
  emptyRegressionFeedback,
  needsRegressionPatrol,
  regressionDigestOf,
} from "../regressionFocus";
import {
  createFocusDispatcher,
  planFocusPatrol,
  summarizeFocusPatrol,
} from "../focusPatrol";
import { buildInsightFeedback } from "../insightFeedback";
import type {
  AiEntityChange,
  AiEntityDelta,
  AiEntityDimDelta,
  AiEntityRegressionReport,
  AiFocusDimensionHit,
  AiFocusTarget,
} from "../contextTypes";
import type { AiFocusAssignmentDto, AiInsightDto } from "../../services/tauri";

const NOW = 1_700_000_000;

function dim(
  key: string,
  from: number,
  to: number,
  direction: AiEntityDimDelta["direction"],
): AiEntityDimDelta {
  return {
    key,
    label: `维度-${key}`,
    unit: "",
    from,
    to,
    delta: to - from,
    direction,
    better: "lower",
  };
}

function delta(
  id: string,
  change: AiEntityChange,
  dims: AiEntityDimDelta[],
  over: Partial<AiEntityDelta> = {},
): AiEntityDelta {
  return {
    id,
    label: id,
    change,
    scoreFrom: 40,
    scoreTo: 60,
    scoreDelta: 20,
    rankFrom: 8,
    rankTo: 3,
    resonanceFrom: 2,
    resonanceTo: 3,
    dims,
    ...over,
  };
}

function report(entities: AiEntityDelta[], baseline = true): AiEntityRegressionReport {
  return {
    moduleId: "project-scan",
    scopeId: "analysis1",
    entityLabel: "文件",
    baseline: baseline ? { takenAt: NOW - 86400, digest: "d0" } : null,
    current: { takenAt: NOW, digest: "d1" },
    points: baseline ? 2 : 1,
    spanDays: 1,
    scoreComparable: true,
    comparableDims: ["cx"],
    blindDims: [],
    worsened: entities.filter((e) => e.change === "worsened").length,
    improved: 0,
    appeared: entities.filter((e) => e.change === "appeared").length,
    removed: 0,
    flat: 0,
    incomparable: 0,
    entities,
    verdict: "mixed",
    note: "",
  };
}

function hit(key: string, rank: number): AiFocusDimensionHit {
  return { key, label: `维度${key}`, value: 100, pct: 95, rank, unit: "", hot: true };
}

function target(filePath: string, resonance: number): AiFocusTarget {
  const keys = Array.from({ length: resonance }, (_, i) => `dim${i}`);
  const dims: Record<string, AiFocusDimensionHit> = {};
  keys.forEach((k, i) => {
    dims[k] = hit(k, resonance * 10 + i);
  });
  return { filePath, codeLines: 100, score: resonance * 10, resonance, resonantKeys: keys, dims };
}

function assignment(
  filePath: string,
  over: Partial<AiFocusAssignmentDto> = {},
): AiFocusAssignmentDto {
  return {
    moduleId: "project-scan",
    scopeId: "analysis1",
    filePath,
    runId: "arun_x",
    presetKey: "holistic-optimization",
    contextDigest: "digest-A",
    resonance: 2,
    note: "",
    assignCount: 1,
    assignedAt: NOW - 3600,
    ...over,
  };
}

describe("regressionDigestOf · 销账指纹的口径", () => {
  it("只由恶化维度的 from>to 决定，与维度顺序无关", () => {
    const a = delta("a.ts", "worsened", [
      dim("cx", 20, 38, "worsened"),
      dim("churn", 3, 9, "worsened"),
    ]);
    const b = delta("a.ts", "worsened", [
      dim("churn", 3, 9, "worsened"),
      dim("cx", 20, 38, "worsened"),
    ]);
    expect(regressionDigestOf(a)).toBe(regressionDigestOf(b));
  });

  it("改善维度不进指纹：顺手删掉几行重复不该让同一笔恶化重新排队", () => {
    const before = delta("a.ts", "worsened", [dim("cx", 20, 38, "worsened")]);
    const after = delta("a.ts", "worsened", [
      dim("cx", 20, 38, "worsened"),
      dim("dup", 50, 10, "improved"),
    ]);
    expect(regressionDigestOf(after)).toBe(regressionDigestOf(before));
  });

  it("同一维继续变坏（38 → 60）是一笔新的回归，指纹必须变", () => {
    const first = delta("a.ts", "worsened", [dim("cx", 20, 38, "worsened")]);
    const worse = delta("a.ts", "worsened", [dim("cx", 38, 60, "worsened")]);
    expect(regressionDigestOf(worse)).not.toBe(regressionDigestOf(first));
  });

  it("不同文件的同样劣化不共用指纹", () => {
    const a = delta("a.ts", "worsened", [dim("cx", 20, 38, "worsened")]);
    const b = delta("b.ts", "worsened", [dim("cx", 20, 38, "worsened")]);
    expect(regressionDigestOf(a)).not.toBe(regressionDigestOf(b));
  });
});

describe("buildRegressionFeedback · 收哪些、不收哪些", () => {
  it("没有基线（只有一个时间点）判 available=false，整条链路退回上线前行为", () => {
    const fb = buildRegressionFeedback(report([], false));
    expect(fb.available).toBe(false);
    expect(fb.byFile.size).toBe(0);
    expect(buildRegressionFeedback(null).available).toBe(false);
  });

  it("只收 worsened —— appeared/improved/flat 一律不收", () => {
    const fb = buildRegressionFeedback(
      report([
        delta("bad.ts", "worsened", [dim("cx", 20, 38, "worsened")]),
        delta("new.ts", "appeared", [], { scoreFrom: null, rankFrom: null }),
        delta("good.ts", "improved", [dim("cx", 38, 20, "improved")]),
        delta("same.ts", "flat", [dim("cx", 20, 20, "flat")]),
      ]),
    );
    expect(fb.available).toBe(true);
    expect([...fb.byFile.keys()]).toEqual(["bad.ts"]);
  });

  it("点名理由写清主因维度「从多少到多少、涨了百分之几」", () => {
    const fb = buildRegressionFeedback(
      report([
        delta(
          "bad.ts",
          "worsened",
          [dim("cx", 20, 38, "worsened"), dim("churn", 3, 6, "worsened")],
          { driver: "cx" },
        ),
      ]),
    );
    const sig = fb.byFile.get("bad.ts")!;
    expect(sig.note).toContain("20");
    expect(sig.note).toContain("38");
    expect(sig.note).toContain("+90%");
    expect(sig.note).toContain("另有 1 维");
    expect(sig.driverLabel).toBe("维度-cx");
    // 排序权重是相对幅度而非综合分：综合分会因别的文件重算而漂移
    expect(sig.weight).toBeCloseTo(90, 0);
  });
});

describe("needsRegressionPatrol · 空串判欠", () => {
  const sig = buildRegressionFeedback(
    report([delta("a.ts", "worsened", [dim("cx", 20, 38, "worsened")])]),
  ).byFile.get("a.ts")!;

  it("没有信号时永远不欠", () => {
    expect(needsRegressionPatrol(undefined, "whatever")).toBe(false);
  });

  it("台账为空串（历史行 / 从未记账）判欠：宁可多看一次", () => {
    expect(needsRegressionPatrol(sig, "")).toBe(true);
    expect(needsRegressionPatrol(sig, undefined)).toBe(true);
  });

  it("台账等于本次指纹判已销账，不再重复点名", () => {
    expect(needsRegressionPatrol(sig, sig.digest)).toBe(false);
  });

  it("台账是上一次劣化的指纹时判欠（文件又变坏了一次）", () => {
    expect(needsRegressionPatrol(sig, "deadbeef")).toBe(true);
  });
});

describe("planFocusPatrol · regressed 档的接入", () => {
  const regression = buildRegressionFeedback(
    report([delta("a.ts", "worsened", [dim("cx", 20, 38, "worsened")], { driver: "cx" })]),
  );

  it("派过单、指纹一致，但这一轮变坏了 —— 判 regressed 而不是 patrolled", () => {
    const plan = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
      regression,
    });
    const row = plan.rows.find((r) => r.filePath === "a.ts")!;
    expect(row.state).toBe("regressed");
    expect(row.regressionDigest).toBe(regression.byFile.get("a.ts")!.digest);
    expect(plan.hasRegressed).toBe(true);
  });

  it("已追责过（台账指纹一致）就退回 patrolled，不重复烧钱", () => {
    const digest = regression.byFile.get("a.ts")!.digest;
    const plan = planFocusPatrol(
      [target("a.ts", 3)],
      [assignment("a.ts", { regressionDigest: digest })],
      { currentDigest: "digest-A", nowSec: NOW, regression },
    );
    expect(plan.rows[0].state).toBe("patrolled");
    expect(plan.hasRegressed).toBe(false);
  });

  it("不传 regression 时判定与本特性上线前逐字节一致", () => {
    const withOut = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
    });
    expect(withOut.rows[0].state).toBe("patrolled");
    expect(withOut.hasRegressed).toBe(false);
    // available=false 的信号同样静默
    const off = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
      regression: emptyRegressionFeedback(false),
    });
    expect(off.rows[0].state).toBe("patrolled");
  });

  it("回归说明会拼进点名理由，即使该文件最终判在 recheck 档", () => {
    const insights: AiInsightDto[] = [
      {
        id: "i1",
        packId: "analysis1:project-scan",
        analysisId: "analysis1",
        agentId: "agent1",
        kind: "risk",
        title: "循环依赖",
        body: "",
        severity: "critical",
        refs: ["a.ts:10"],
        freshness: "stale",
        changedRefs: ["a.ts"],
        evidenceDigest: "ev-new",
        status: "open",
      },
    ];
    const feedback = buildInsightFeedback(insights, { available: true });
    const plan = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
      feedback,
      regression,
    });
    const row = plan.rows[0];
    expect(row.state).toBe("recheck");
    // 两本账都要落，否则回归账永远挂着、下一轮把同一个文件再点一次名。
    // evidenceDigest 是该文件所有 open 结论现状的**聚合**（不是某一条的原值），
    // 取自 insightFeedback，这里断言的是「原样透传、没有被回归档串味」。
    expect(row.evidenceDigest).toBe(feedback.byFile.get("a.ts")!.evidenceDigest);
    expect(row.evidenceDigest).not.toBe("");
    expect(row.regressionDigest).toBe(regression.byFile.get("a.ts")!.digest);
    // 三本账互不冲销的最直白体现：两个指纹必须是两个不同的值
    expect(row.evidenceDigest).not.toBe(row.regressionDigest);
    expect(row.note).toContain("本轮变坏");
    expect(plan.queue[0].regressionDigest).toBe(row.regressionDigest);
    expect(plan.queue[0].evidenceDigest).toBe(row.evidenceDigest);
  });

  it("队列次序：failed > recheck > regressed > never", () => {
    const insights: AiInsightDto[] = [
      {
        id: "i1",
        packId: "analysis1:project-scan",
        analysisId: "analysis1",
        agentId: "agent1",
        kind: "risk",
        title: "x",
        body: "",
        severity: "high",
        refs: ["rc.ts:1"],
        freshness: "stale",
        changedRefs: ["rc.ts"],
        evidenceDigest: "ev1",
        status: "open",
      },
    ];
    const reg = buildRegressionFeedback(
      report([delta("rg.ts", "worsened", [dim("cx", 10, 30, "worsened")])]),
    );
    const plan = planFocusPatrol(
      [target("fa.ts", 4), target("rc.ts", 3), target("rg.ts", 3), target("nv.ts", 5)],
      [
        assignment("fa.ts", { outcome: "error" }),
        assignment("rc.ts"),
        assignment("rg.ts"),
      ],
      {
        currentDigest: "digest-A",
        nowSec: NOW,
        feedback: buildInsightFeedback(insights, { available: true }),
        regression: reg,
      },
    );
    expect(plan.queue.map((q) => q.filePath)).toEqual(["fa.ts", "rc.ts", "rg.ts", "nv.ts"]);
    // nv.ts 共振 5 维、分数最高，仍排在只有 3 维的 rg.ts 之后 ——
    // 档位优先级压过静态分，因为回归会过期而空白不会。
    expect(plan.queue[2].state).toBe("regressed");
    expect(plan.queue[3].state).toBe("never");
  });

  it("回归档内部按劣化幅度排，不按共振分排", () => {
    const reg = buildRegressionFeedback(
      report([
        delta("mild.ts", "worsened", [dim("cx", 88, 92, "worsened")]),
        delta("sharp.ts", "worsened", [dim("cx", 20, 38, "worsened")]),
      ]),
    );
    const plan = planFocusPatrol(
      [target("mild.ts", 5), target("sharp.ts", 2)],
      [assignment("mild.ts"), assignment("sharp.ts")],
      { currentDigest: "digest-A", nowSec: NOW, regression: reg },
    );
    // mild.ts 共振 5 维、分数 50，sharp.ts 只有 2 维；但 +90% 比 +5% 更该先看：
    // 那份糟糕是历史遗留，这份是这次改动造成的，现在回滚成本最低。
    expect(plan.queue.map((q) => q.filePath)).toEqual(["sharp.ts", "mild.ts"]);
  });

  it("共振门槛对回归目标破格：1 维但刚劣化 60% 也要进队列", () => {
    const reg = buildRegressionFeedback(
      report([delta("lonely.ts", "worsened", [dim("cx", 10, 16, "worsened")])]),
    );
    const plan = planFocusPatrol([target("lonely.ts", 1)], [], {
      nowSec: NOW,
      regression: reg,
      minResonance: 2,
    });
    expect(plan.rows.map((r) => r.filePath)).toEqual(["lonely.ts"]);
    expect(plan.rows[0].state).toBe("regressed");
  });

  it("榜外劣化文件会被注入队列，但封顶在 REGRESSION_INJECT_LIMIT", () => {
    const many = Array.from({ length: REGRESSION_INJECT_LIMIT + 3 }, (_, i) =>
      // 幅度递减，确保注入的是最厉害的那几个
      delta(`out${i}.ts`, "worsened", [dim("cx", 100, 100 + (20 - i), "worsened")]),
    );
    const reg = buildRegressionFeedback(report(many));
    const plan = planFocusPatrol([target("onboard.ts", 3)], [], { nowSec: NOW, regression: reg });
    const injected = plan.rows.filter((r) => r.filePath.startsWith("out"));
    expect(injected).toHaveLength(REGRESSION_INJECT_LIMIT);
    // 按劣化幅度取前几名：out0 幅度最大，必须在内；末尾几个留给下一轮
    expect(injected.map((r) => r.filePath)).toContain("out0.ts");
    expect(injected.map((r) => r.filePath)).not.toContain(
      `out${REGRESSION_INJECT_LIMIT + 2}.ts`,
    );
  });

  it("共振榜为空但有榜外劣化时，仍能排出队列", () => {
    const reg = buildRegressionFeedback(
      report([delta("ghost.ts", "worsened", [dim("cx", 10, 30, "worsened")])]),
    );
    const plan = planFocusPatrol([], [], { nowSec: NOW, regression: reg });
    expect(plan.queue.map((q) => q.filePath)).toEqual(["ghost.ts"]);
    expect(plan.hasRegressed).toBe(true);
  });

  it("失败重派仍压过回归：那一档带着重试封顶，是配置坏掉时唯一的刹车", () => {
    const reg = buildRegressionFeedback(
      report([delta("a.ts", "worsened", [dim("cx", 10, 30, "worsened")])]),
    );
    const plan = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts", { outcome: "error" })], {
      currentDigest: "digest-A",
      nowSec: NOW,
      regression: reg,
    });
    expect(plan.rows[0].state).toBe("failed");
    expect(plan.hasRegressed).toBe(false);
  });
});

describe("createFocusDispatcher / summarizeFocusPatrol · 回归档的账要对得上", () => {
  const reg = buildRegressionFeedback(
    report([delta("a.ts", "worsened", [dim("cx", 10, 30, "worsened")])]),
  );

  it("hasRegressed 跟剩余队列走，领完就不再以 regression-gap 空跑一轮", () => {
    const plan = planFocusPatrol([target("a.ts", 3)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
      regression: reg,
    });
    const d = createFocusDispatcher(plan, 3);
    expect(d.hasRegressed()).toBe(true);
    d.take();
    expect(d.hasRegressed()).toBe(false);
  });

  it("summary 把 regressed 单列，且从 stale 的减法里扣掉", () => {
    const plan = planFocusPatrol([target("a.ts", 3), target("b.ts", 2)], [assignment("a.ts")], {
      currentDigest: "digest-A",
      nowSec: NOW,
      regression: reg,
    });
    const stat = summarizeFocusPatrol(plan.rows);
    expect(stat.regressed).toBe(1);
    expect(stat.never).toBe(1);
    // 两行分别是 regressed / never，stale 必须是 0 —— 若忘了扣，
    // 面板上「数据已变」会凭空多出一个，两个数字对不上账。
    expect(stat.stale).toBe(0);
    expect(stat.total).toBe(2);
  });
});
