/**
 * 扫描侧实体切面 —— 守的是「文件级回归」这条链路上最容易悄悄失真的四个地方。
 *
 * 这一层看着只是「把风险榜存下来」，但它决定了下游所有回归结论的可信度：
 *   · 主键选错（用 file_id 而非 relPath）→ 每一轮所有文件都被判成「新进榜 + 已删除」；
 *   · 覆盖面口径选错（照搬打分的可用性）→ 「技术债被清空」会被报成「该维度不可比」；
 *   · 分数基准漂移（归一分母悄悄变）→ 代码一行没动，全项目分数集体上浮；
 *   · 存活名单算错 → 删掉一个遗留文件就能刷出一条漂亮的改善曲线。
 *
 * 每条用例都对应上面某一种「算错了不会报错、只会给出好看且错误的结论」的情形。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiEntityRegressionReport } from "../contextTypes";
import type { ScanSnapshot } from "../providers/scanSections";

const hoisted = vi.hoisted(() => ({
  report: null as AiEntityRegressionReport | null,
}));

vi.mock("../entityRegression", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../entityRegression")>();
  return {
    ...actual,
    readEntityRegression: () => hoisted.report,
  };
});

const { buildRegressionSection, collectScanEntities, ENTITY_TOP_N } = await import(
  "../providers/scanEntities"
);
const { computeRiskCorrelation } = await import("../providers/riskCorrelation");

function snapshot(over: Partial<ScanSnapshot> = {}): ScanSnapshot {
  return {
    files: [],
    modules: [],
    dependencies: [],
    layers: [],
    findings: [],
    symbols: [],
    symbolRefs: [],
    patternHits: [],
    metrics: [],
    techDebt: [],
    clones: [],
    deadSymbols: [],
    gitChurn: [],
    callEdges: [],
    callGraphSummary: null,
    changeCoupling: [],
    dataFlowSummary: null,
    ...over,
  } as ScanSnapshot;
}

const file = (relPath: string, lineCount = 100) =>
  ({
    // id 与 relPath 刻意长得完全不一样：主键选错时用例会立刻炸
    id: `fid-${Math.random().toString(36).slice(2)}`,
    relPath,
    name: relPath.split("/").pop(),
    language: "typescript",
    isDirectory: false,
    lineCount,
  }) as never;

const metric = (filePath: string, cc: number) =>
  ({
    id: `m-${filePath}`,
    filePath,
    fileId: `f-${filePath}`,
    totalLines: 100,
    codeLines: 90,
    cyclomaticComplexity: cc,
    maxFunctionCc: cc,
    complexityLevel: "high",
    engine: "ast",
    maxNesting: 3,
    functionCount: 5,
    hotFunction: "run",
    magicNumberCount: 0,
  }) as never;

const debt = (filePath: string, severity = "warning") =>
  ({
    id: `d-${filePath}-${Math.random()}`,
    filePath,
    fileId: `f-${filePath}`,
    lineNo: 1,
    marker: "FIXME",
    severity,
    snippet: "x",
  }) as never;

const churn = (filePath: string, commitCount: number) =>
  ({
    id: `g-${filePath}`,
    filePath,
    fileId: `f-${filePath}`,
    commitCount,
    addedLines: 10,
    deletedLines: 5,
    authorCount: 2,
    churnScore: commitCount,
    hotspotLevel: "high",
  }) as never;

/** N 个复杂度递减的文件，用来造一张确定顺序的榜 */
function ladder(n: number): ScanSnapshot {
  const files = Array.from({ length: n }, (_, i) => file(`src/f${String(i).padStart(2, "0")}.ts`));
  const metrics = Array.from({ length: n }, (_, i) =>
    metric(`src/f${String(i).padStart(2, "0")}.ts`, (n - i) * 3),
  );
  return snapshot({ files, metrics });
}

beforeEach(() => {
  hoisted.report = null;
});

describe("collectScanEntities · 榜单本身", () => {
  it("榜单按 Top-N 截断，门槛取末位分数，总数记全量", () => {
    const s = ladder(ENTITY_TOP_N + 8);
    const snap = collectScanEntities(s, "scope-1")!;

    expect(snap.entities).toHaveLength(ENTITY_TOP_N);
    expect(snap.total).toBe(ENTITY_TOP_N + 8);
    // 门槛就是末位分数：没有它，通用层无法区分「修好了」与「被挤下榜」
    expect(snap.cutoff).toBe(snap.entities[snap.entities.length - 1].score);
    expect(snap.entities.map((e) => e.rank)).toEqual(
      Array.from({ length: ENTITY_TOP_N }, (_, i) => i + 1),
    );
    // 榜内单调不增：门槛才有意义
    for (let i = 1; i < snap.entities.length; i += 1) {
      expect(snap.entities[i].score).toBeLessThanOrEqual(snap.entities[i - 1].score);
    }
  });

  it("实体主键用 files 表的 relPath，不用每次扫描都会重生成的 file_id", () => {
    const s = ladder(3);
    const snap = collectScanEntities(s, "scope-1")!;
    expect(snap.entities.map((e) => e.id)).toEqual([
      "src/f00.ts",
      "src/f01.ts",
      "src/f02.ts",
    ]);
    // 反向确认：任何一个 id 都不该长得像 file_id
    for (const e of snap.entities) expect(e.id.startsWith("fid-")).toBe(false);
  });

  it("零信号项目不建榜（返回 null），不给下游留一张空榜去对比", () => {
    expect(collectScanEntities(snapshot(), "scope-1")).toBeNull();
    expect(collectScanEntities(snapshot({ files: [file("a.ts")] }), "scope-1")).toBeNull();
  });

  it("实体带上规模基数，便于分辨「变坏」是不是仅仅因为文件变大了", () => {
    const s = snapshot({ files: [file("a.ts", 820)], metrics: [metric("a.ts", 40)] });
    expect(collectScanEntities(s, "scope-1")!.entities[0].size).toBe(820);
  });
});

describe("collectScanEntities · 覆盖面口径", () => {
  it("阶段跑了但一条都没查到 = 可用（查了确实没有），不是盲区", () => {
    // 技术债标记是纯文本匹配，任何语言都能跑；0 条是结论不是空白
    const s = ladder(4);
    const snap = collectScanEntities(s, "scope-1")!;
    const techDebt = snap.coverage.find((c) => c.key === "techDebt")!;

    expect(techDebt.available).toBe(true);
    // 而打分层因为「没有非零取值」把它排除了——两套口径本就不同，
    // 照搬打分层的可用性会把「技术债被清空」报成「不可比」。
    const scored = computeRiskCorrelation(s);
    expect(scored.dimensions.some((d) => d.key === "techDebt")).toBe(false);
  });

  it("阶段真的没跑 = 盲区，且带上原因", () => {
    const s = ladder(4); // 无 gitChurn
    const snap = collectScanEntities(s, "scope-1")!;
    const git = snap.coverage.find((c) => c.key === "churn")!;

    expect(git.available).toBe(false);
    expect(git.reason).toBeTruthy();
  });

  it("Git 跑过之后变更频率维度转为可用", () => {
    const base = ladder(4);
    const s = snapshot({
      ...base,
      gitChurn: [churn("src/f00.ts", 30), churn("src/f01.ts", 5)],
    });
    expect(collectScanEntities(s, "scope-1")!.coverage.find((c) => c.key === "churn")!.available).toBe(
      true,
    );
  });
});

describe("collectScanEntities · 分数基准", () => {
  it("某一维全项目归零而退出打分时，分数仍落在覆盖面声明的同一把尺子上", () => {
    const files = [file("a.ts"), file("b.ts")];
    const metrics = [metric("a.ts", 40), metric("b.ts", 20)];
    // 唯一差别：b.ts 上有没有一处技术债。两边的**阶段可用性完全相同**
    // （技术债阶段都跑了），所以通用层会判定「综合分可比」——
    // 那么分数就必须真的可比。
    const withDebt = snapshot({ files, metrics, techDebt: [debt("b.ts")] });
    const noDebt = snapshot({ files, metrics });

    const covA = collectScanEntities(withDebt, "s")!.coverage;
    const covB = collectScanEntities(noDebt, "s")!.coverage;
    expect(covA).toEqual(covB);

    // 打分层的原始分已经漂了：归一分母从「复杂度+技术债」缩成「复杂度」
    const rawA = computeRiskCorrelation(withDebt).files.find((f) => f.filePath === "a.ts")!.score;
    const rawB = computeRiskCorrelation(noDebt).files.find((f) => f.filePath === "a.ts")!.score;
    expect(Math.abs(rawA - rawB)).toBeGreaterThan(5);

    // 换算之后不再漂：a.ts 自己身上什么都没发生，分数就不该动
    const eA = collectScanEntities(withDebt, "s")!.entities.find((e) => e.id === "a.ts")!.score;
    const eB = collectScanEntities(noDebt, "s")!.entities.find((e) => e.id === "a.ts")!.score;
    expect(Math.abs(eA - eB)).toBeLessThanOrEqual(0.2);
  });

  it("换算是恒等变换：不改名次，也不改共振维度数", () => {
    const s = ladder(6);
    const raw = computeRiskCorrelation(s).files.slice(0, 6);
    const snap = collectScanEntities(s, "s")!;
    expect(snap.entities.map((e) => e.id)).toEqual(raw.map((f) => f.filePath));
    expect(snap.entities.map((e) => e.resonance)).toEqual(raw.map((f) => f.resonance));
  });
});

describe("collectScanEntities · 存活名单", () => {
  it("只把「上一张榜里此刻仍在 files 表」的路径记为存活", () => {
    const s = ladder(3);
    const snap = collectScanEntities(s, "scope-1", [
      "src/f00.ts",
      "src/deleted.ts",
      "src/f02.ts",
    ])!;
    expect(snap.survivedIds).toEqual(["src/f00.ts", "src/f02.ts"]);
  });

  it("首轮没有上一张榜时存活名单为空数组，而不是 undefined", () => {
    expect(collectScanEntities(ladder(3), "scope-1")!.survivedIds).toEqual([]);
  });
});

describe("collectScanEntities · 维度字典", () => {
  it("变更频率与被引用面判中性：改得勤、被引用多本身不是缺陷", () => {
    const dims = collectScanEntities(ladder(3), "s")!.dimensions!;
    const by = new Map(dims.map((d) => [d.key, d]));

    expect(by.get("churn")!.better).toBe("neutral");
    expect(by.get("fanIn")!.better).toBe("neutral");
    expect(by.get("complexity")!.better).toBe("lower");
    expect(by.get("techDebt")!.better).toBe("lower");
  });

  it("每个维度都带抖动下限，且圈复杂度的下限大于 1（±1 多半是解析口径差异）", () => {
    const dims = collectScanEntities(ladder(3), "s")!.dimensions!;
    expect(dims).toHaveLength(8);
    for (const d of dims) {
      expect(typeof d.minDelta).toBe("number");
      expect(d.label).toBeTruthy();
    }
    expect(dims.find((d) => d.key === "complexity")!.minDelta).toBeGreaterThan(1);
  });

  it("维度字典覆盖了覆盖面里出现的每一个 key（否则渲染侧只能显示裸 key）", () => {
    const snap = collectScanEntities(ladder(3), "s")!;
    const dimKeys = new Set(snap.dimensions!.map((d) => d.key));
    for (const c of snap.coverage) expect(dimKeys.has(c.key)).toBe(true);
  });
});

// ────────────────────────────── 分节 ──────────────────────────────

function makeReport(over: Partial<AiEntityRegressionReport> = {}): AiEntityRegressionReport {
  return {
    moduleId: "project-scan",
    scopeId: "s",
    entityLabel: "文件",
    baseline: { takenAt: 1_700_000_000_000, digest: "aaa" },
    current: { takenAt: 1_700_086_400_000, digest: "bbb" },
    points: 2,
    spanDays: 1,
    scoreComparable: true,
    comparableDims: ["complexity", "techDebt"],
    blindDims: [],
    worsened: 1,
    improved: 1,
    appeared: 1,
    removed: 1,
    flat: 12,
    incomparable: 0,
    entities: [
      {
        id: "src/core/engine.ts",
        label: "src/core/engine.ts",
        change: "worsened",
        scoreFrom: 60,
        scoreTo: 78,
        scoreDelta: 18,
        rankFrom: 6,
        rankTo: 2,
        resonanceFrom: 2,
        resonanceTo: 4,
        dims: [
          {
            key: "complexity",
            label: "复杂度",
            unit: "CC",
            from: 30,
            to: 62,
            delta: 32,
            direction: "worsened",
            better: "lower",
          },
        ],
        driver: "complexity",
      },
      {
        id: "src/new/feature.ts",
        label: "src/new/feature.ts",
        change: "appeared",
        scoreFrom: null,
        scoreTo: 40,
        scoreDelta: null,
        rankFrom: null,
        rankTo: 11,
        resonanceFrom: null,
        resonanceTo: 1,
        dims: [],
        reason: "上一轮榜单里没有它（新文件，或风险信号从无到有）",
      },
      {
        id: "src/legacy/gone.ts",
        label: "src/legacy/gone.ts",
        change: "removed",
        scoreFrom: 55,
        scoreTo: null,
        scoreDelta: null,
        rankFrom: 8,
        rankTo: null,
        resonanceFrom: 2,
        resonanceTo: null,
        dims: [],
        reason: "该实体已不存在（文件被删除或改名）——这不是质量改善",
      },
      {
        id: "src/util/fixed.ts",
        label: "src/util/fixed.ts",
        change: "improved",
        scoreFrom: 52,
        scoreTo: 30,
        scoreDelta: -22,
        approx: true,
        rankFrom: 9,
        rankTo: null,
        resonanceFrom: 2,
        resonanceTo: null,
        dims: [],
        reason: "按旧分数本应在榜（门槛 30），缺席说明分数已降至门槛以下",
      },
    ],
    verdict: "mixed",
    note: "较上一榜单（间隔 1 天）；1 个文件变坏（src/core/engine.ts 的复杂度 30 → 62CC）；1 个改善。",
    ...over,
  };
}

describe("buildRegressionSection", () => {
  it("首次建榜时明说「没有历史」，而不是沉默成「没有变化」", () => {
    hoisted.report = null;
    const section = buildRegressionSection(ladder(5), "s");

    expect(section.dataQuality?.status).toBe("unavailable");
    expect(section.content).toContain("尚无可比的历史榜单");
    expect(section.content).toContain("请勿把「无历史」当成「无变化」");
    // 基线榜要原样交出去：Agent 至少知道下一轮会拿什么来比
    expect(section.content).toContain("src/f00.ts");
  });

  it("有基线时逐文件列出变化，恶化排在最前", () => {
    hoisted.report = makeReport();
    const section = buildRegressionSection(ladder(5), "s");

    expect(section.dataQuality?.status).toBe("ok");
    expect(section.content).toContain("src/core/engine.ts");
    // 主因维度加粗，且给出原始维度值的变化——不是只给一个综合分
    expect(section.content).toContain("**复杂度** 30→62CC");
    expect(section.summary).toContain("1 个文件恶化");
  });

  it("新进榜与已删除都单独成类，绝不被算进恶化或改善", () => {
    hoisted.report = makeReport();
    const section = buildRegressionSection(ladder(5), "s");

    expect(section.content).toContain("新进榜");
    expect(section.content).toContain("已删除");
    expect(section.content).toContain("「新进榜」**不是**恶化");
    expect(section.content).toContain("「已删除」**不计入**改善");

    // facts 里点名的只能是真正恶化的那一个
    const facts = section.facts as { topWorsened: Array<{ id: string }> };
    expect(facts.topWorsened.map((x) => x.id)).toEqual(["src/core/engine.ts"]);
  });

  it("跌出榜单的推断上界显式标 ≤，不冒充实测值", () => {
    hoisted.report = makeReport();
    const section = buildRegressionSection(ladder(5), "s");
    expect(section.content).toContain("≤30");
    expect(section.content).toContain("推断上界");
  });

  it("可用维度集合变了就直接宣布综合分不可比，并降级为部分可信", () => {
    hoisted.report = makeReport({
      scoreComparable: false,
      blindDims: [{ key: "churn", label: "变更频率", reason: "本次未运行该维度" }],
    });
    const section = buildRegressionSection(ladder(5), "s");

    expect(section.dataQuality?.status).toBe("partial");
    expect(section.content).toContain("综合分不可比");
    expect(section.content).toContain("变更频率");
    expect(section.content).toContain("不得当作「没有变化」");
  });

  it("两端没有共同可用维度时整节判不可用，避免 Agent 拿它下结论", () => {
    hoisted.report = makeReport({ comparableDims: [], blindDims: [], scoreComparable: false });
    const section = buildRegressionSection(ladder(5), "s");
    expect(section.dataQuality?.status).toBe("unavailable");
  });
});
