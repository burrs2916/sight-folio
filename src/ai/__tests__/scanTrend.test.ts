/**
 * 扫描侧指标提取的不变量。
 *
 * 这一层最隐蔽的失效方式是**声明与登记对不上**：某个指标写了
 * `dimension: "cloneDetect"`，而覆盖度体检里那个阶段叫 `clones`。
 * 代码能编译、测试能跑、界面也正常——只是这个指标从此**永远**判为不可比，
 * 而「不可比」这三个字在一堆正常数字里毫不起眼，可能几个月都没人发现。
 * 所以第一条用例专门把「每个指标的 dimension 都必须在 coverage 里存在」钉死。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { collectScanMetrics, buildTrendSection } from "../providers/scanTrend";
import { buildStageCoverage } from "../providers/scanCoverage";
import { resetMetricTrendCache } from "../metricTrend";
import type { ScanSnapshot } from "../providers/scanSections";

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

const file = (relPath: string) =>
  ({ id: `f-${relPath}`, relPath, name: relPath, language: "typescript", isDirectory: false, lineCount: 100 }) as never;

const metric = (filePath: string, cc: number, level = "high", codeLines = 900, commentLines = 100) =>
  ({
    id: `m-${filePath}`,
    filePath,
    fileId: `f-${filePath}`,
    totalLines: codeLines + commentLines,
    codeLines,
    commentLines,
    blankLines: 0,
    cyclomaticComplexity: cc,
    complexityLevel: level,
    engine: "ast",
    maxNesting: 3,
    functionCount: 5,
    maxFunctionCc: cc,
    hotFunction: "run",
    magicNumberCount: 0,
  }) as never;

const churn = (filePath: string, level = "extreme") =>
  ({
    id: `g-${filePath}`,
    filePath,
    fileId: `f-${filePath}`,
    commitCount: 40,
    addedLines: 100,
    deletedLines: 50,
    authorCount: 3,
    churnScore: 40,
    hotspotLevel: level,
  }) as never;

const clone = (filePath: string, lineCount: number) =>
  ({
    id: `c-${filePath}-${lineCount}`,
    groupId: "g1",
    filePath,
    fileId: `f-${filePath}`,
    startLine: 1,
    endLine: lineCount,
    lineCount,
    groupSize: 2,
    snippet: "x",
    language: "typescript",
    cloneType: "type1",
  }) as never;

const SCOPE = "analysis-scan-trend";

function fullSnapshot(): ScanSnapshot {
  return snapshot({
    files: [file("src/a.ts"), file("src/b.ts")],
    metrics: [metric("src/a.ts", 40), metric("src/b.ts", 10, "low")],
    findings: [
      { id: "1", severity: "error", message: "m" } as never,
      { id: "2", severity: "info", message: "m" } as never,
    ],
    techDebt: [{ id: "t1", filePath: "src/a.ts", lineNo: 3, marker: "TODO" } as never],
    clones: [clone("src/a.ts", 30), clone("src/b.ts", 30)],
    gitChurn: [churn("src/a.ts")],
    symbols: [{ id: "s1", filePath: "src/a.ts", name: "run", kind: "function" } as never],
    symbolRefs: [{ symbolId: "s1", filePath: "src/b.ts" } as never],
    deadSymbols: [],
    changeCoupling: [
      { id: "cc1", fileAPath: "src/a.ts", fileBPath: "src/b.ts", couplingKind: "hidden", riskLevel: "high" } as never,
    ],
  });
}

beforeEach(() => resetMetricTrendCache());

describe("指标与覆盖度必须严丝合缝", () => {
  it("每个指标声明的 dimension 都能在覆盖度体检里找到", () => {
    const s = fullSnapshot();
    const stageKeys = new Set(buildStageCoverage(s).map((st) => st.key));
    const missing = collectScanMetrics(s, SCOPE)
      .metrics.map((m) => m.dimension)
      .filter((d): d is string => !!d)
      .filter((d) => !stageKeys.has(d));

    // 写错一个字母，这个指标就会永远躺在「不可比」里而没人发现
    expect(missing).toEqual([]);
  });

  it("快照自带的 coverage 与体检结论逐条一致，不另起一套口径", () => {
    const s = fullSnapshot();
    const stages = buildStageCoverage(s);
    const cov = new Map(collectScanMetrics(s, SCOPE).coverage.map((c) => [c.key, c.available]));

    for (const st of stages) {
      expect(cov.get(st.key)).toBe(st.quality.status !== "unavailable");
    }
  });

  it("没有 Git 时 git 维度登记为不可用，churn 类指标据此判不可比", () => {
    const s = snapshot({ files: [file("src/a.ts")], metrics: [metric("src/a.ts", 5, "low")] });
    const cov = collectScanMetrics(s, SCOPE).coverage.find((c) => c.key === "git")!;
    expect(cov.available).toBe(false);
    expect(cov.reason).toContain("Git");
  });

  it("「查了确实没有」的维度算可用——0 条技术债是结论，不是盲区", () => {
    const s = snapshot({ files: [file("src/a.ts")], metrics: [metric("src/a.ts", 5, "low")], techDebt: [] });
    expect(collectScanMetrics(s, SCOPE).coverage.find((c) => c.key === "techDebt")?.available).toBe(true);
  });
});

describe("指标口径", () => {
  it("重复代码按行数计量，不按条数（几十条 3 行片段不该压过一段 200 行复制）", () => {
    const s = fullSnapshot();
    const m = collectScanMetrics(s, SCOPE).metrics.find((x) => x.key === "cloneLines")!;
    expect(m.value).toBe(60);
    expect(m.unit).toBe("行");
  });

  it("变更热点判中性：改得勤可能只是主战场，不该被鼓励「少写代码」", () => {
    const m = collectScanMetrics(fullSnapshot(), SCOPE).metrics.find((x) => x.key === "churnHotspots")!;
    expect(m.better).toBe("neutral");
  });

  it("代码行为 0 时不给 basis，避免密度被算成 Infinity", () => {
    const s = snapshot({ files: [file("src/a.ts")] }); // 没有 metrics → codeLines = 0
    const m = collectScanMetrics(s, SCOPE).metrics.find((x) => x.key === "techDebt")!;
    expect(m.basis).toBeUndefined();
  });

  it("规模类指标带上基数，让「项目长大」与「质量变差」分得开", () => {
    const byKey = new Map(collectScanMetrics(fullSnapshot(), SCOPE).metrics.map((m) => [m.key, m]));
    expect(byKey.get("techDebt")?.basis).toBe(1800); // 两个文件各 900 行
    expect(byKey.get("techDebt")?.basisUnit).toBe("每千行");
    expect(byKey.get("highComplexityFiles")?.basis).toBe(2);
  });

  it("刻意不收「多维共振文件数」：它的分母会随可用维度静默漂移", () => {
    const keys = collectScanMetrics(fullSnapshot(), SCOPE).metrics.map((m) => m.key);
    expect(keys).not.toContain("resonantFiles");
  });
});

describe("趋势分节", () => {
  it("没有历史时判 unavailable，措辞绝不能暗示「没有变化」", () => {
    const section = buildTrendSection(fullSnapshot(), SCOPE);

    expect(section.key).toBe("trend");
    expect(section.dataQuality?.status).toBe("unavailable");
    expect(section.dataQuality?.caveat).toContain("没有变化");
    expect(section.content).toContain("尚无可比的历史基线");
    // 首次也要把当前数值列出来，否则用户不知道基线到底记了什么
    expect(section.content).toContain("技术债标记");
  });

  it("首次基线分节仍占 priority 1，不会被预算悄悄裁掉", () => {
    expect(buildTrendSection(fullSnapshot(), SCOPE).priority).toBe(1);
  });
});
