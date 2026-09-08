/**
 * 跨维度风险交叉 —— 守的是「Top-N 截断带来的系统性失真」。
 *
 * 上下文包每节只给 Top-15。一个文件在六个维度上分别排第 18~25 名，
 * 它在整份上下文里一次都不会出现，却是全项目最该重构的目标。
 * Agent 读再多分节也救不回来——数据根本没给它。
 *
 * 下面每条用例对应一种「算错了就会让这个保护失效」的情形：
 * 排序语义、盲区维度的处置、稀疏维度的噪音、路径可用性。
 */
import { describe, it, expect } from "vitest";
import {
  buildRiskMatrixSection,
  buildScanFocusReport,
  computeRiskCorrelation,
  RISK_DIMENSIONS,
} from "../providers/riskCorrelation";
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

const file = (relPath: string, lineCount = 100) =>
  ({
    id: `f-${relPath}`,
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

const debt = (filePath: string, severity: string) =>
  ({
    id: `d-${filePath}-${Math.random()}`,
    filePath,
    fileId: `f-${filePath}`,
    lineNo: 1,
    marker: "FIXME",
    severity,
    snippet: "x",
  }) as never;

const ref = (fromFilePath: string, toFilePath: string) =>
  ({
    id: `r-${fromFilePath}-${toFilePath}`,
    fromFilePath,
    fromFileId: `f-${fromFilePath}`,
    toFilePath,
    toFileId: `f-${toFilePath}`,
    toSymbolId: null,
    symbolName: "x",
    refLine: 1,
    refText: "x",
    kind: "call",
  }) as never;

/** 15 个陪跑文件，让分位有分母可算（否则任何非零值都是 P0） */
const filler = (n = 15) => Array.from({ length: n }, (_, i) => file(`src/pad/p${i}.ts`));

describe("computeRiskCorrelation：全量交叉，而不是 Top-N 求交集", () => {
  it("每一维都排在 Top-15 之外、因而在所有分节里都不露面的文件，必须排到榜首", () => {
    // 这是整个特性存在的理由：260 个文件的项目里，quiet.ts 在四个维度上都排第 20 名——
    // 每一节的明细只列 Top-15，于是它在整份上下文里一次都不会出现；
    // 而它是唯一一个「四维同时进前 10%」的文件，真正该先动的就是它。
    const N = 260;
    const pads = Array.from({ length: N }, (_, i) => file(`src/pad/p${i}.ts`));
    const padPath = (i: number) => `src/pad/p${i}.ts`;
    // 每个维度各让 19 个陪跑文件压在 quiet 前面 → quiet 稳定排第 20。
    // 取值必须按「维度内的第 k 名」算（而不是陪跑文件的全局下标），
    // 否则换个 offset 值域就滑到 quiet 之下，压在前面的文件数会悄悄变少。
    const lead = (offset: number, top: number, step = 1) =>
      Array.from({ length: 19 }, (_, k) => ({ path: padPath(offset + k), value: top - k * step }));

    const s = snapshot({
      files: [...pads, file("src/core/quiet.ts"), file("src/gen/huge.ts")],
      metrics: [
        ...lead(0, 100).map((x) => metric(x.path, x.value)), // 100..82 > quiet 80
        metric("src/core/quiet.ts", 80),
        metric("src/gen/huge.ts", 9999), // 单维极端：自动生成的巨型文件，从不改动
      ],
      gitChurn: [
        ...lead(20, 200).map((x) => churn(x.path, x.value)), // 200..182 > quiet 170
        churn("src/core/quiet.ts", 170),
      ],
      clones: [
        ...lead(40, 300).map((x) => clone(x.path, x.value)), // 300..282 > quiet 260
        clone("src/core/quiet.ts", 260),
      ],
      techDebt: [
        ...lead(60, 30).flatMap((x) =>
          Array.from({ length: x.value }, () => debt(x.path, "info")),
        ), // 30..12 条 > quiet 10 条
        ...Array.from({ length: 10 }, () => debt("src/core/quiet.ts", "info")),
      ],
    });

    const r = computeRiskCorrelation(s);
    const quiet = r.files.find((f) => f.filePath === "src/core/quiet.ts")!;
    const huge = r.files.find((f) => f.filePath === "src/gen/huge.ts")!;

    // 前提坐实：quiet 在每一维都排在 Top-15 之外，任何单节明细都看不到它
    for (const key of ["complexity", "churn", "clones", "techDebt"]) {
      expect(quiet.dims[key].rank, `${key} 名次`).toBeGreaterThan(15);
      expect(quiet.dims[key].hot, `${key} 应判为高位`).toBe(true);
    }
    expect(quiet.resonance).toBe(4);

    // 单维极端不该霸榜：复杂度全项目第一，但只有一维报警
    expect(huge.resonance).toBe(1);
    expect(r.files[0].filePath).toBe("src/core/quiet.ts");
    expect(r.files.indexOf(quiet)).toBeLessThan(r.files.indexOf(huge));
  });

  it("盲区维度整维排除，权重重新归一 —— 绝不把「看不见」算成 0 分", () => {
    // 无 Git 历史：变更频率是盲区。若按 0 分参与，所有文件会被一起压低，
    // 排名被悄悄扭曲成「只看复杂度」，而 Agent 完全看不出来。
    const s = snapshot({
      files: [...filler(), file("src/a.ts")],
      metrics: [metric("src/a.ts", 40)],
      gitChurn: [],
    });

    const r = computeRiskCorrelation(s);
    expect(r.dimensions.map((d) => d.key)).not.toContain("churn");
    expect(r.excluded.map((d) => d.key)).toContain("churn");
    expect(r.excluded.find((d) => d.key === "churn")?.reason).toBeTruthy();

    // 剩余维度权重归一后，唯一有信号的文件不该因为「少了一维」被压分
    const a = r.files.find((f) => f.filePath === "src/a.ts")!;
    expect(a.dims.churn).toBeUndefined();
    expect(a.score).toBeGreaterThan(0);
  });

  it("稀疏维度上的一条 TODO 不算高位 —— minSignal 挡住分位的虚高", () => {
    // 全项目只有这一个文件有技术债 → 分位天然是 P100，但一条 TODO 不构成风险
    const s = snapshot({
      files: [...filler(), file("src/a.ts")],
      techDebt: [debt("src/a.ts", "info")],
    });
    const r = computeRiskCorrelation(s);
    const a = r.files.find((f) => f.filePath === "src/a.ts")!;
    expect(a.dims.techDebt.pct).toBeGreaterThanOrEqual(90);
    expect(a.dims.techDebt.hot).toBe(false);
    expect(a.resonance).toBe(0);
  });

  it("扇入按不同引用方去重 —— 同一调用方写 40 次，影响面仍是 1", () => {
    const s = snapshot({
      files: [...filler(), file("src/hub.ts"), file("src/caller.ts")],
      symbolRefs: Array.from({ length: 40 }, () => ref("src/caller.ts", "src/hub.ts")),
    });
    const r = computeRiskCorrelation(s);
    expect(r.files.find((f) => f.filePath === "src/hub.ts")!.dims.fanIn.value).toBe(1);
  });

  it("自引用不计入扇入（文件内部调用不构成外部影响面）", () => {
    const s = snapshot({
      files: [...filler(), file("src/self.ts")],
      symbolRefs: [ref("src/self.ts", "src/self.ts")],
    });
    const r = computeRiskCorrelation(s);
    expect(r.files.find((f) => f.filePath === "src/self.ts")).toBeUndefined();
  });

  it("输出路径一律来自 files 表 —— 否则 Agent 拿去写 refs 会被落库守门拒收", () => {
    // 度量/热点数据里出现了一条 files 表里没有的路径（已删除文件的陈留记录）
    const s = snapshot({
      files: [...filler(), file("src/real.ts")],
      metrics: [metric("src/real.ts", 40), metric("/abs/ghost.ts", 999)],
      gitChurn: [churn("/abs/ghost.ts", 300)],
    });
    const r = computeRiskCorrelation(s);
    const paths = r.files.map((f) => f.filePath);
    expect(paths).toContain("src/real.ts");
    expect(paths).not.toContain("/abs/ghost.ts");
  });

  it("零信号文件不进榜，榜单不被噪音稀释", () => {
    const s = snapshot({
      files: [...filler(), file("src/a.ts")],
      metrics: [metric("src/a.ts", 40)],
    });
    const r = computeRiskCorrelation(s);
    expect(r.files).toHaveLength(1);
    expect(r.scoredFiles).toBe(1);
  });

  it("维度共现统计出项目的系统性病灶（哪两类问题总同时出现）", () => {
    const hot = ["src/x.ts", "src/y.ts", "src/z.ts"];
    const s = snapshot({
      files: [...filler(), ...hot.map((p) => file(p))],
      metrics: hot.map((p) => metric(p, 50)),
      gitChurn: hot.map((p) => churn(p, 30)),
    });
    const r = computeRiskCorrelation(s);
    const pair = r.cooccurrence[0];
    expect(new Set([pair.a, pair.b])).toEqual(new Set(["complexity", "churn"]));
    expect(pair.count).toBe(3);
    expect(r.resonantFiles).toBe(3);
  });

  it("小项目兜底：文件太少时分位到不了 P90，前两名仍算高位", () => {
    const s = snapshot({
      files: [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
      metrics: [metric("src/a.ts", 40), metric("src/b.ts", 20), metric("src/c.ts", 1)],
      gitChurn: [churn("src/a.ts", 30)],
    });
    const r = computeRiskCorrelation(s);
    expect(r.files[0].filePath).toBe("src/a.ts");
    expect(r.files[0].resonance).toBe(2);
  });

  it("完全没有扫描数据时不炸也不编造", () => {
    const r = computeRiskCorrelation(snapshot());
    expect(r.files).toHaveLength(0);
    expect(r.resonantFiles).toBe(0);
    expect(r.dimensions).toHaveLength(0);
    expect(r.excluded).toHaveLength(RISK_DIMENSIONS.length);
  });
});

describe("buildRiskMatrixSection：正文要讲清「怎么用」和「哪里看不见」", () => {
  it("给出共振榜、共现表，并显式点名被排除的盲区维度", () => {
    const s = snapshot({
      files: [...filler(), file("src/a.ts"), file("src/b.ts")],
      metrics: [metric("src/a.ts", 60), metric("src/b.ts", 45)],
      clones: [clone("src/a.ts", 80)],
      // 无 Git → 变更频率与变更耦合都是盲区
    });
    const sec = buildRiskMatrixSection(s);

    expect(sec.key).toBe("riskMatrix");
    // priority 1：被 token 预算降级成摘要就等于把 Agent 赶回逐节交叉的老路
    expect(sec.priority).toBe(1);
    expect(sec.content).toContain("src/a.ts");
    expect(sec.content).toContain("维度共现");
    expect(sec.content).toContain("变更频率");
    expect(sec.content).toContain("看不见，不等于没有");
    // 必须写明这是全量交叉而非 Top-N 求交集，否则 Agent 会以为它可以自己复现
    expect(sec.content).toContain("全量数据");
  });

  it("facts 只带高位维度的原值，机读端不跟着变贵", () => {
    const s = snapshot({
      files: [...filler(), file("src/a.ts")],
      metrics: [metric("src/a.ts", 60)],
      gitChurn: [churn("src/a.ts", 40)],
    });
    const facts = buildRiskMatrixSection(s).facts as {
      topRisks: Array<{ filePath: string; hits: Record<string, number> }>;
      excludedDimensions: Array<{ key: string }>;
    };
    expect(facts.topRisks[0].filePath).toBe("src/a.ts");
    expect(Object.keys(facts.topRisks[0].hits).sort()).toEqual(["churn", "complexity"]);
    expect(facts.excludedDimensions.map((d) => d.key)).toContain("clones");
  });

  it("所有维度都是盲区时给出可读摘要，不产出空表崩溃", () => {
    const sec = buildRiskMatrixSection(snapshot({ files: [file("src/a.ts")] }));
    expect(sec.summary).toContain("参与维度 0/");
    expect(sec.content).toContain("无数据");
  });
});

describe("buildScanFocusReport：给人读的那一份，必须与 AI 的 riskMatrix 同源", () => {
  it("人和 AI 看到的是同一份榜——首位文件、名次、综合分完全一致", () => {
    // 这是「为什么要有这份人读视图」的核心断言：复用同一份 computeRiskCorrelation，
    // 绝不能各算各的。若以后有人把 buildScanFocusReport 改成独立打分，这条用例会立刻红。
    const s = snapshot({
      files: [
        ...filler(),
        file("src/core/quiet.ts"),
        file("src/gen/huge.ts"),
        file("src/normal.ts"),
      ],
      metrics: [
        metric("src/core/quiet.ts", 80),
        metric("src/gen/huge.ts", 9999),
        metric("src/normal.ts", 30),
      ],
      gitChurn: [churn("src/core/quiet.ts", 170), churn("src/gen/huge.ts", 2)],
      clones: [clone("src/core/quiet.ts", 260)],
      techDebt: Array.from({ length: 10 }, () => debt("src/core/quiet.ts", "info")),
    });

    const r = computeRiskCorrelation(s);
    const report = buildScanFocusReport(s, "analysis-1", "demo");

    // 模块/作用域信息正确回填
    expect(report.moduleId).toBe("project-scan");
    expect(report.scopeId).toBe("analysis-1");
    expect(report.scopeLabel).toBe("demo");

    // 首位文件一致：四维共振的 quiet.ts 必须同时是人和 AI 榜单的第一名
    expect(r.files[0].filePath).toBe("src/core/quiet.ts");
    expect(report.targets[0].filePath).toBe("src/core/quiet.ts");

    // 综合分与名次一一对应（同源口径，不是重新算的）
    const quietAI = r.files.find((f) => f.filePath === "src/core/quiet.ts")!;
    const quietHuman = report.targets.find((f) => f.filePath === "src/core/quiet.ts")!;
    expect(quietHuman.score).toBe(quietAI.score);
    expect(quietHuman.resonance).toBe(quietAI.resonance);
    expect(Object.keys(quietHuman.dims).sort()).toEqual(quietAI.resonantKeys.slice().sort());

    // 单维极端（huge.ts）不应霸榜，与人侧榜的排序一致
    expect(report.targets.indexOf(quietHuman)).toBeLessThan(
      report.targets.findIndex((t) => t.filePath === "src/gen/huge.ts"),
    );
  });

  it("盲区维度进 blindSpots、不进 targets 的 dims，且权重重归一后的口径与 AI 侧一致", () => {
    const s = snapshot({
      files: [...filler(), file("src/a.ts")],
      metrics: [metric("src/a.ts", 40)],
      gitChurn: [], // 无 Git → 变更频率盲区
    });
    const r = computeRiskCorrelation(s);
    const report = buildScanFocusReport(s, "a1");

    // 盲区维度在盲点清单里
    const keys = report.blindSpots.map((d) => d.key);
    expect(keys).toContain("churn");
    expect(report.blindSpots.find((d) => d.key === "churn")?.reason).toBeTruthy();

    // targets 的命中维度里不该出现盲区维度
    for (const t of report.targets) {
      for (const k of Object.keys(t.dims)) {
        expect(keys).not.toContain(k);
      }
    }
    // AI 侧排除了同样的维度：两份榜单口径一致
    expect(r.dimensions.map((d) => d.key)).not.toContain("churn");
  });

  it("小项目兜底：文件太少时前两名仍算高位，人侧榜包含它们", () => {
    const s = snapshot({
      files: [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")],
      metrics: [metric("src/a.ts", 40), metric("src/b.ts", 20), metric("src/c.ts", 1)],
      gitChurn: [churn("src/a.ts", 30)],
    });
    const report = buildScanFocusReport(s, "small");
    expect(report.targets[0].filePath).toBe("src/a.ts");
    expect(report.targets[0].resonance).toBe(2);
    expect(report.hotRankLimit).toBeGreaterThanOrEqual(2);
  });

  it("完全没有扫描数据时不炸、targets 为空、盲区列全维度（与人侧同口径）", () => {
    const report = buildScanFocusReport(snapshot(), "empty");
    expect(report.targets).toHaveLength(0);
    expect(report.scoredFiles).toBe(0);
    expect(report.resonantFiles).toBe(0);
    expect(report.blindSpots).toHaveLength(RISK_DIMENSIONS.length);
  });

  it("targets 只带高位维度的明细——非高位维度不进给人读的表（与 AI 侧只回高位原值一致）", () => {
    const s = snapshot({
      files: [...filler(), file("src/a.ts"), file("src/b.ts")],
      metrics: [metric("src/a.ts", 60), metric("src/b.ts", 45)],
      clones: [clone("src/a.ts", 80)],
    });
    const report = buildScanFocusReport(s, "mix");
    const a = report.targets.find((t) => t.filePath === "src/a.ts")!;
    // a 在复杂度与重复两个维度高位；克隆未参与打分（无 Git/其他前置）→ 不得出现在 dims 里
    expect(Object.keys(a.dims).sort()).toEqual(["clones", "complexity"]);

    // 每个命中维度都带 label / unit / rank / pct（给人读需要的全部字段）
    for (const k of Object.keys(a.dims)) {
      const h = a.dims[k];
      expect(h.label).toBeTruthy();
      expect(h.unit).toBeTruthy();
      expect(h.rank).toBeGreaterThan(0);
      expect(h.pct).toBeGreaterThanOrEqual(0);
      expect(h.pct).toBeLessThanOrEqual(100);
    }
  });

  it("共现对必须带中文 label——渲染侧是模块无关的，拿到裸 key 只能把英文原样印给用户", () => {
    const s = snapshot({
      files: [...filler(), file("src/core/quiet.ts"), file("src/core/loud.ts")],
      metrics: [metric("src/core/quiet.ts", 80), metric("src/core/loud.ts", 70)],
      gitChurn: [churn("src/core/quiet.ts", 170), churn("src/core/loud.ts", 120)],
    });
    const report = buildScanFocusReport(s, "pairs");
    expect(report.cooccurrence.length).toBeGreaterThan(0);

    for (const p of report.cooccurrence) {
      // key 保留（下游可能要按 key 做逻辑），但 label 必须同时给出且是人能读的
      expect(p.a).toBeTruthy();
      expect(p.b).toBeTruthy();
      expect(p.aLabel).toBeTruthy();
      expect(p.bLabel).toBeTruthy();
      // label 不得等于 key：等于就说明翻译没落地，UI 会印出 "complexity × churn"
      expect(p.aLabel).not.toBe(p.a);
      expect(p.bLabel).not.toBe(p.b);
      expect(/^[a-z]+$/i.test(p.aLabel)).toBe(false);
    }
  });
});
