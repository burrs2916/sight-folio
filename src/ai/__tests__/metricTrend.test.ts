/**
 * 指标时间轴的判定口径。
 *
 * 这一层最容易出的错不是算错数，而是**把「这次没看」说成「变好了」**：
 * 上一次跑了 Git，这一次项目不在 Git 仓库里，churn 从 300 变 0，
 * 天真的减法会得出「变更热度大幅下降，项目趋于稳定」——一句彻头彻尾的假话，
 * 而且它长得跟真结论一模一样，人和 Agent 都不会怀疑。
 *
 * 下面的用例把这类「结构性说谎」逐条钉死。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AiContextProvider, AiMetric, AiMetricSnapshot } from "../contextTypes";

const recordMetricSnapshot = vi.fn(async (_input: any) => ["msnap_1", true] as [string, boolean]);
const listMetricSnapshots = vi.fn(async (_m: string, _s: string, _l?: number) => [] as any[]);

vi.mock("../../services/tauri", () => ({
  aiContextApi: {
    recordMetricSnapshot: (input: any) => recordMetricSnapshot(input),
    listMetricSnapshots: (m: string, s: string, l?: number) => listMetricSnapshots(m, s, l),
  },
}));

const {
  buildTrendReport,
  fingerprintMetrics,
  captureMetricSnapshot,
  loadTrendReport,
  readTrendReport,
  resetMetricTrendCache,
  parseSnapshotRow,
} = await import("../metricTrend");

const MODULE = "test-module";
const SCOPE = "analysis-trend";
const DAY = 86_400_000;

function metric(over: Partial<AiMetric> & Pick<AiMetric, "key" | "value">): AiMetric {
  return {
    label: over.key,
    unit: "个",
    better: "lower",
    ...over,
  } as AiMetric;
}

function snap(
  takenAt: number,
  metrics: AiMetric[],
  coverage: AiMetricSnapshot["coverage"] = [],
): AiMetricSnapshot {
  return {
    moduleId: MODULE,
    scopeId: SCOPE,
    digest: fingerprintMetrics(metrics, coverage),
    takenAt,
    metrics,
    coverage,
  };
}

beforeEach(() => {
  resetMetricTrendCache();
  recordMetricSnapshot.mockClear();
  listMetricSnapshots.mockClear();
  listMetricSnapshots.mockResolvedValue([]);
});

describe("可比性：盲区绝不能被算成变好", () => {
  it("维度这次没跑，归零判为不可比而不是 improved", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "churn", value: 0, dimension: "git" })], [
        { key: "git", available: false, reason: "项目不在 Git 仓库中" },
      ]),
      snap(DAY, [metric({ key: "churn", value: 300, dimension: "git" })], [
        { key: "git", available: true },
      ]),
    ];
    const report = buildTrendReport(MODULE, SCOPE, timeline);
    const churn = report.deltas.find((d) => d.key === "churn")!;

    expect(churn.direction).toBe("incomparable");
    expect(churn.reason).toContain("没看");
    expect(report.improved).toBe(0);
    // 不可比的项必须被显式计数，否则它会消失在「一切正常」里
    expect(report.incomparable).toBe(1);
    expect(report.note).toContain("盲区");
  });

  it("基线那一次是盲区，这次跑出来的数同样不可比", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "clones", value: 120, dimension: "clone" })], [
        { key: "clone", available: true },
      ]),
      snap(DAY, [metric({ key: "clones", value: 0, dimension: "clone" })], [
        { key: "clone", available: false, reason: "重复检测未运行" },
      ]),
    ];
    const churn = buildTrendReport(MODULE, SCOPE, timeline).deltas[0];
    expect(churn.direction).toBe("incomparable");
    expect(churn.reason).toContain("基线");
  });

  it("快照里压根没登记该维度，按不可用处理而不是默认可用", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "debt", value: 10, dimension: "techDebt" })], []),
      snap(DAY, [metric({ key: "debt", value: 90, dimension: "techDebt" })], []),
    ];
    expect(buildTrendReport(MODULE, SCOPE, timeline).deltas[0].direction).toBe("incomparable");
  });

  it("无维度依赖的指标永远可比", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "files", value: 120, better: "neutral" })]),
      snap(DAY, [metric({ key: "files", value: 100, better: "neutral" })]),
    ];
    expect(buildTrendReport(MODULE, SCOPE, timeline).deltas[0].direction).toBe("moved");
  });
});

describe("规模归一：项目长大不等于质量变差", () => {
  it("总量涨了但密度降了，判为改善", () => {
    const cov = [{ key: "techDebt", available: true }];
    const timeline = [
      snap(
        2 * DAY,
        [metric({ key: "debt", value: 120, dimension: "techDebt", basis: 60_000, basisUnit: "每千行" })],
        cov,
      ),
      snap(
        DAY,
        [metric({ key: "debt", value: 100, dimension: "techDebt", basis: 30_000, basisUnit: "每千行" })],
        cov,
      ),
    ];
    const d = buildTrendReport(MODULE, SCOPE, timeline).deltas[0];

    expect(d.delta).toBe(20); // 总量确实涨了 20
    expect(d.fromDensity).toBeCloseTo(3.3333, 3);
    expect(d.toDensity).toBe(2);
    expect(d.direction).toBe("improved"); // 但密度从 3.33 降到 2.0
    expect(d.basisUnit).toBe("每千行");
  });

  it("没有基数的指标退回总量口径，不凭空造密度", () => {
    const cov = [{ key: "techDebt", available: true }];
    const timeline = [
      snap(2 * DAY, [metric({ key: "debt", value: 120, dimension: "techDebt" })], cov),
      snap(DAY, [metric({ key: "debt", value: 100, dimension: "techDebt" })], cov),
    ];
    const d = buildTrendReport(MODULE, SCOPE, timeline).deltas[0];
    expect(d.fromDensity).toBeUndefined();
    expect(d.direction).toBe("worsened");
  });
});

describe("总判定：既不被噪声翻盘，也不掩盖真事件", () => {
  const cov = [{ key: "x", available: true }];

  it("300 条里多了 1 条，如实记 worsened 但不把整体判成恶化", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "debt", value: 301, dimension: "x" })], cov),
      snap(DAY, [metric({ key: "debt", value: 300, dimension: "x" })], cov),
    ];
    const report = buildTrendReport(MODULE, SCOPE, timeline);
    expect(report.worsened).toBe(1); // 明细如实
    expect(report.verdict).toBe("flat"); // 总判定不被 0.33% 抖动带走
  });

  it("从 0 变成非 0 永远算材料性变化，哪怕只有 1 条", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "cycles", value: 1, dimension: "x" })], cov),
      snap(DAY, [metric({ key: "cycles", value: 0, dimension: "x" })], cov),
    ];
    const report = buildTrendReport(MODULE, SCOPE, timeline);
    expect(report.deltas[0].pct).toBeNull();
    expect(report.verdict).toBe("regressing");
  });

  it("有升有降判 mixed，不擅自替用户下总结论", () => {
    const timeline = [
      snap(
        2 * DAY,
        [metric({ key: "debt", value: 50, dimension: "x" }), metric({ key: "clones", value: 400, dimension: "x" })],
        cov,
      ),
      snap(
        DAY,
        [metric({ key: "debt", value: 100, dimension: "x" }), metric({ key: "clones", value: 200, dimension: "x" })],
        cov,
      ),
    ];
    expect(buildTrendReport(MODULE, SCOPE, timeline).verdict).toBe("mixed");
  });

  it("中性指标变化只报 moved，不参与好坏判定", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "files", value: 900, better: "neutral" })]),
      snap(DAY, [metric({ key: "files", value: 500, better: "neutral" })]),
    ];
    const report = buildTrendReport(MODULE, SCOPE, timeline);
    expect(report.deltas[0].direction).toBe("moved");
    expect(report.verdict).toBe("flat");
  });
});

describe("边界：第一次扫描要如实说「还没有历史」", () => {
  it("只有一个点时 verdict 是 insufficient，不是 flat", () => {
    const report = buildTrendReport(MODULE, SCOPE, [snap(DAY, [metric({ key: "debt", value: 10 })])]);
    expect(report.verdict).toBe("insufficient");
    expect(report.baseline).toBeNull();
    expect(report.current).not.toBeNull();
    expect(report.note).toContain("第一次");
  });

  it("基线里没有的新指标判不可比，不冒充「一直是这个数」", () => {
    const timeline = [
      snap(2 * DAY, [metric({ key: "debt", value: 10 }), metric({ key: "dataflow", value: 7 })]),
      snap(DAY, [metric({ key: "debt", value: 10 })]),
    ];
    const nova = buildTrendReport(MODULE, SCOPE, timeline).deltas.find((d) => d.key === "dataflow")!;
    expect(nova.direction).toBe("incomparable");
    expect(nova.reason).toContain("后来才有");
  });

  it("baseline=oldest 时跟最早的点比，回答「这一阶段整体如何」", () => {
    const cov = [{ key: "x", available: true }];
    const timeline = [
      snap(3 * DAY, [metric({ key: "debt", value: 60, dimension: "x" })], cov),
      snap(2 * DAY, [metric({ key: "debt", value: 90, dimension: "x" })], cov),
      snap(DAY, [metric({ key: "debt", value: 120, dimension: "x" })], cov),
    ];
    expect(buildTrendReport(MODULE, SCOPE, timeline, { baseline: "oldest" }).deltas[0].from).toBe(120);
    expect(buildTrendReport(MODULE, SCOPE, timeline).deltas[0].from).toBe(90);
  });
});

describe("指纹", () => {
  it("同一组数值必同指纹，浮点尾数抖动不造出新点", () => {
    const a = fingerprintMetrics([metric({ key: "avg", value: 3.141592653 })], []);
    const b = fingerprintMetrics([metric({ key: "avg", value: 3.14159265358 })], []);
    expect(a).toBe(b);
  });

  it("覆盖面变化必须换指纹：断过一次采不能被抹平", () => {
    const m = [metric({ key: "churn", value: 0, dimension: "git" })];
    const withGit = fingerprintMetrics(m, [{ key: "git", available: true }]);
    const noGit = fingerprintMetrics(m, [{ key: "git", available: false }]);
    expect(withGit).not.toBe(noGit);
  });

  it("指标顺序不影响指纹", () => {
    const x = metric({ key: "a", value: 1 });
    const y = metric({ key: "b", value: 2 });
    expect(fingerprintMetrics([x, y], [])).toBe(fingerprintMetrics([y, x], []));
  });
});

describe("采集链路", () => {
  const provider: AiContextProvider = {
    moduleId: MODULE,
    label: "测试",
    description: "",
    isAvailable: () => true,
    buildPack: () => null,
    collectMetrics: () => ({
      moduleId: MODULE,
      scopeId: SCOPE,
      digest: "",
      takenAt: 0,
      metrics: [metric({ key: "debt", value: 100, dimension: "x" })],
      coverage: [{ key: "x", available: true }],
    }),
  };

  function row(firstAt: number, value: number) {
    return {
      id: `r${firstAt}`,
      moduleId: MODULE,
      scopeId: SCOPE,
      digest: `d${value}`,
      triggerKind: "full-scan",
      metricsJson: JSON.stringify([metric({ key: "debt", value, dimension: "x" })]),
      coverageJson: JSON.stringify([{ key: "x", available: true }]),
      firstAt,
      lastAt: firstAt,
      seenCount: 1,
    };
  }

  it("模块没实现 collectMetrics 时整条链路静默跳过", async () => {
    const bare: AiContextProvider = { ...provider, collectMetrics: undefined };
    expect(await captureMetricSnapshot(bare, SCOPE)).toBeNull();
    expect(recordMetricSnapshot).not.toHaveBeenCalled();
  });

  it("采集后趋势可被 buildPack 同步读到", async () => {
    listMetricSnapshots.mockResolvedValue([row(2000, 100), row(1000, 200)]);
    const report = await captureMetricSnapshot(provider, SCOPE, { triggerKind: "full-scan" });

    expect(recordMetricSnapshot).toHaveBeenCalledTimes(1);
    expect(recordMetricSnapshot.mock.calls[0][0]).toMatchObject({ triggerKind: "full-scan" });
    expect(report?.verdict).toBe("improving");
    expect(readTrendReport(MODULE, SCOPE)?.verdict).toBe("improving");
  });

  it("落库失败被吞掉，绝不打断扫描收尾", async () => {
    recordMetricSnapshot.mockRejectedValueOnce(new Error("db locked"));
    await expect(captureMetricSnapshot(provider, SCOPE)).resolves.toBeNull();
  });

  it("打开面板只读不写，不在时间轴上留伪造的观测点", async () => {
    listMetricSnapshots.mockResolvedValue([row(2000, 100), row(1000, 200)]);
    const report = await loadTrendReport(MODULE, SCOPE);
    expect(report?.points).toBe(2);
    expect(recordMetricSnapshot).not.toHaveBeenCalled();
  });

  it("损坏的历史行被跳过，不让整条趋势崩掉", () => {
    expect(parseSnapshotRow({ ...row(1000, 1), metricsJson: "{oops" } as any)).toBeNull();
    expect(parseSnapshotRow(row(1000, 1) as any)?.metrics[0].value).toBe(1);
  });
});
