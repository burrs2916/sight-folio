import { describe, it, expect } from "vitest";
import {
  generateReportHtml,
  generateReportJson,
  generateReportSvg,
  aggregateCallGraph,
  aggregateClones,
  type ReportData,
} from "../reportGenerator";
import type { AnalysisDSL } from "../../types/scene";
import type {
  ProjectFile,
  ProjectModule,
  ProjectDependency,
  ProjectLayer,
  ReviewFinding,
  FileMetric,
  TechDebtItem,
  PatternHit,
  DeadSymbol,
  CallEdge,
  GitChurn,
  CodeClone,
} from "../../services/tauri";

const analysis = {
  id: "a1",
  name: "示例分析",
  projectRoot: "/proj",
} as unknown as AnalysisDSL;

const file = (id: string, relPath: string): ProjectFile => ({
  id,
  analysisId: "a1",
  path: `/proj/${relPath}`,
  relPath,
  name: relPath.split("/").pop() || relPath,
  extension: "ts",
  language: "typescript",
  size: 100,
  lineCount: 20,
  contentHash: null,
  parentId: null,
  isDirectory: false,
  layerId: "l1",
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  metadata: "{}",
  scannedAt: 1,
});

const layer: ProjectLayer = {
  id: "l1",
  analysisId: "a1",
  name: "业务层",
  color: "#3b82f6",
  sortOrder: 0,
  yPosition: 0,
  description: null,
  rulePattern: null,
  metadata: "{}",
  createdAt: 1,
  updatedAt: 1,
};

const moduleA: ProjectModule = {
  id: "m_src",
  analysisId: "a1",
  name: "src",
  description: null,
  layerId: "l1",
  fileCount: 1,
  depCount: 0,
  beDepCount: 1,
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  color: "#3b82f6",
  metadata: "{}",
  createdAt: 1,
  updatedAt: 1,
};

const moduleB: ProjectModule = {
  ...moduleA,
  id: "m_lib",
  name: "lib",
  fileCount: 1,
  depCount: 1,
  beDepCount: 0,
};

const dep = (id: string, fromId: string, toId: string, isCircular = false): ProjectDependency => ({
  id,
  analysisId: "a1",
  fromId,
  fromType: "file",
  toId,
  toType: "file",
  kind: "import",
  lineNo: 1,
  isCircular,
  weight: 1,
  metadata: "{}",
  detectedAt: 1,
});

const finding = (id: string, severity: string): ReviewFinding => ({
  id,
  analysisId: "a1",
  ruleId: "r1",
  targetId: "f1",
  targetType: "file",
  severity,
  message: `问题 ${id}`,
  suggestion: "建议修复",
  status: "open",
  foundAt: 1,
  fixedAt: null,
  metadata: "{}",
});

const metric = (fileId: string, cc: number, level: string): FileMetric => ({
  id: `m_${fileId}`,
  analysisId: "a1",
  fileId,
  filePath: "",
  totalLines: 20,
  codeLines: 15,
  commentLines: 2,
  blankLines: 3,
  cyclomaticComplexity: cc,
  complexityLevel: level,
  metadata: "{}",
  createdAt: 1,
  engine: "heuristic",
  maxNesting: 0,
  functionCount: 0,
  maxFunctionCc: 0,
  hotFunction: "",
  magicNumberCount: 0,
});

const debt = (id: string, fileId: string, marker: string, severity: string): TechDebtItem => ({
  id,
  analysisId: "a1",
  fileId,
  filePath: "src/a.ts",
  lineNo: 5,
  marker,
  severity,
  snippet: "// TODO: fix me",
  createdAt: 1,
});

const deadSymbol = (
  symbolId: string,
  name: string,
  fileId: string,
  filePath: string,
  visibility: string,
  confidence: string
): DeadSymbol => ({
  symbolId,
  analysisId: "a1",
  fileId,
  filePath,
  name,
  kind: "function",
  lineStart: 1,
  lineEnd: 10,
  visibility,
  confidence,
  reason: "未在任何调用点出现",
});

const callEdge = (
  id: string,
  callerName: string,
  callerFile: string,
  calleeName: string,
  calleeFile: string,
  kind: string
): CallEdge => ({
  id,
  analysisId: "a1",
  callerSymbolId: `cs_${id}`,
  callerName,
  callerFileId: `cf_${id}`,
  callerFilePath: callerFile,
  calleeSymbolId: `ce_${id}`,
  calleeName,
  calleeFileId: `ef_${id}`,
  calleeFilePath: calleeFile,
  lineNo: 1,
  kind,
  createdAt: 1,
});

const churn = (fileId: string, filePath: string, score: number, level: string): GitChurn => ({
  id: `g_${fileId}`,
  analysisId: "a1",
  fileId,
  filePath,
  commitCount: 10,
  addedLines: 100,
  deletedLines: 50,
  authorCount: 3,
  lastCommitAt: 1,
  firstCommitAt: 1,
  churnScore: score,
  hotspotLevel: level,
  createdAt: 1,
});

const clone = (
  id: string,
  fileId: string,
  filePath: string,
  groupId: string,
  startLine: number,
  lineCount: number,
  groupSize: number
): CodeClone => ({
  id,
  analysisId: "a1",
  groupId,
  fileId,
  filePath,
  startLine,
  endLine: startLine + lineCount - 1,
  lineCount,
  groupSize,
  snippet: "const a = 1;\nconst b = 2;",
  language: "typescript",
  cloneType: "type1",
  createdAt: 1,
});

const data: ReportData = {
  analysis,
  files: [file("f1", "src/a.ts"), file("f2", "lib/b.ts")],
  modules: [moduleA, moduleB],
  dependencies: [dep("d1", "f2", "f1"), dep("d2", "f1", "f2", true)],
  layers: [layer],
  findings: [finding("f1", "critical"), finding("f2", "warning")],
  metrics: [metric("f1", 25, "extreme"), metric("f2", 4, "low")],
  techDebt: [debt("t1", "f1", "FIXME", "critical"), debt("t2", "f2", "TODO", "info")],
  patternHits: [{ pattern: "singleton", name: "singleton", symbolName: "S", filePath: "src/a.ts", line: 1, evidence: "e" } as PatternHit],
  deadSymbols: [
    deadSymbol("ds1", "unusedFn", "f1", "src/a.ts", "internal", "high"),
    deadSymbol("ds2", "oldHelper", "f2", "lib/b.ts", "internal", "medium"),
  ],
  callEdges: [
    { ...callEdge("e1", "main", "src/a.ts", "fetchData", "lib/b.ts", "cross-file"), callerSymbolId: "cs_main", calleeSymbolId: "cs_fetch" },
    { ...callEdge("e2", "main", "src/a.ts", "helper", "src/a.ts", "internal"), callerSymbolId: "cs_main", calleeSymbolId: "cs_helper" },
    { ...callEdge("e3", "render", "lib/b.ts", "fetchData", "lib/b.ts", "internal"), callerSymbolId: "cs_render", calleeSymbolId: "cs_fetch" },
  ],
  gitChurn: [churn("f1", "src/a.ts", 80, "high"), churn("f2", "lib/b.ts", 20, "high")],
  clones: [
    clone("c1", "f1", "src/a.ts", "g1", 10, 30, 2),
    clone("c2", "f2", "lib/b.ts", "g1", 60, 30, 2),
    clone("c3", "f1", "src/a.ts", "g2", 100, 8, 3),
    clone("c4", "f2", "lib/b.ts", "g2", 4, 8, 3),
    clone("c5", "f2", "lib/b.ts", "g2", 200, 8, 3),
  ],
};

describe("报告生成器（SVG / JSON 技术债）", () => {
  it("JSON 报告包含技术债分布与明细", () => {
    const parsed = JSON.parse(generateReportJson(data));
    expect(parsed.summary.techDebtCount).toBe(2);
    expect(parsed.summary.techDebtByMarker).toEqual({ FIXME: 1, TODO: 1 });
    expect(parsed.summary.techDebtBySeverity).toEqual({ critical: 1, info: 1 });
    expect(parsed.summary.complexityDistribution).toEqual({ extreme: 1, low: 1 });
    expect(parsed.techDebt).toHaveLength(2);
    expect(parsed.techDebt[0]).toMatchObject({ marker: "FIXME", severity: "critical", lineNo: 5 });
  });

  it("SVG 报告包含架构分层、模块、依赖连线与循环标记", () => {
    const svg = generateReportSvg(data);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("示例分析");
    expect(svg).toContain("业务层");
    expect(svg).toContain("src");
    expect(svg).toContain("lib");
    expect(svg).toContain("marker-end=\"url(#dep-arrow)\"");
    expect(svg).toContain("循环");
  });

  it("SVG 报告包含复杂度热力条、技术债与设计模式、审查汇总", () => {
    const svg = generateReportSvg(data);
    expect(svg).toContain("复杂度热力条");
    expect(svg).toContain("CC 均值 25.0");
    expect(svg).toContain("⚠ 1");
    expect(svg).toContain("FIXME");
    expect(svg).toContain("TODO");
    expect(svg).toContain("单例");
    expect(svg).toContain("审查发现汇总");
    expect(svg).toContain("严重");
  });

  it("SVG 报告对异常/空数据不抛错", () => {
    const empty = generateReportSvg({
      analysis,
      files: [],
      modules: [],
      dependencies: [],
      layers: [],
      findings: [],
      metrics: [],
      techDebt: [],
    });
    expect(empty).toContain("<svg");
  });
});

describe("报告生成器（死代码 / 调用图 / git 变更）", () => {
  it("JSON 报告聚合调用图、死代码、git 变更与重构象限", () => {
    const parsed = JSON.parse(generateReportJson(data));
    // 调用图：e1 跨文件
    expect(parsed.summary.callEdges).toBe(3);
    expect(parsed.summary.crossFileCallEdges).toBe(1);
    // fetchData 被 main 与 render 调用 → 高 fan-in
    expect(parsed.summary.topCallers.some((c: any) => c.name === "fetchData" && c.count === 2)).toBe(true);
    // main 调出 2 处 → 高 fan-out
    expect(parsed.summary.topCallees.some((c: any) => c.name === "main" && c.count === 2)).toBe(true);
    // 死代码计数
    expect(parsed.summary.deadSymbolCount).toBe(2);
    expect(parsed.deadSymbols).toHaveLength(2);
    expect(parsed.deadSymbols[0]).toMatchObject({ name: "unusedFn", confidence: "high" });
    // git 变更热点
    expect(parsed.summary.gitChurnFiles).toBe(2);
    expect(parsed.summary.highChurnFiles).toBe(2);
    expect(parsed.gitChurn[0]).toMatchObject({ filePath: "src/a.ts", churnScore: 80, hotspotLevel: "high" });
    // 重构象限：f1 极端复杂 × 高变更 = 优先重构；f2 低复杂 × 中变更 = 活跃开发
    expect(parsed.summary.quadrantDistribution).toMatchObject({
      refactorFirst: 1,
      activeSimple: 1,
    });
  });

  it("SVG 报告包含函数调用热点、死代码与变更热点章节", () => {
    const svg = generateReportSvg(data);
    expect(svg).toContain("函数调用热点");
    expect(svg).toContain("跨文件");
    expect(svg).toContain("被调用最多");
    expect(svg).toContain("调出最多");
    expect(svg).toContain("死代码");
    expect(svg).toContain("unusedFn");
    expect(svg).toContain("git 变更热点与重构象限");
    expect(svg).toContain("优先重构");
  });

  it("HTML 报告包含调用热点、死代码与变更热点章节", () => {
    const html = generateReportHtml(data);
    expect(html).toContain("函数调用热点");
    expect(html).toContain("死代码");
    expect(html).toContain("git 变更热点与重构象限");
    expect(html).toContain("fetchData");
    expect(html).toContain("unusedFn");
  });
});

describe("aggregateCallGraph", () => {
  it("空输入返回零值", () => {
    const agg = aggregateCallGraph([]);
    expect(agg.total).toBe(0);
    expect(agg.hotTargets).toHaveLength(0);
  });

  it("聚合被调用最多 / 调出最多并统计跨文件边数", () => {
    const edges = [
      { ...callEdge("e1", "main", "a.ts", "fetchData", "b.ts", "cross-file"), callerSymbolId: "cs_main", calleeSymbolId: "cs_fetch" },
      { ...callEdge("e2", "main", "a.ts", "helper", "a.ts", "internal"), callerSymbolId: "cs_main", calleeSymbolId: "cs_helper" },
      { ...callEdge("e3", "render", "b.ts", "fetchData", "b.ts", "internal"), callerSymbolId: "cs_render", calleeSymbolId: "cs_fetch" },
    ];
    const agg = aggregateCallGraph(edges);
    expect(agg.total).toBe(3);
    expect(agg.crossFile).toBe(1);
    expect(agg.hotTargets[0]).toMatchObject({ name: "fetchData", count: 2 });
    expect(agg.hotSources[0]).toMatchObject({ name: "main", count: 2 });
  });
});

describe("aggregateClones（重复代码聚合）", () => {
  it("空输入返回零值", () => {
    const agg = aggregateClones([]);
    expect(agg.groups).toBe(0);
    expect(agg.wasteLines).toBe(0);
    expect(agg.topGroups).toHaveLength(0);
  });

  it("按组聚合，冗余行 = 块行数 ×（副本数-1），并按冗余降序", () => {
    const agg = aggregateClones(data.clones);
    expect(agg.groups).toBe(2);
    expect(agg.instances).toBe(5);
    expect(agg.affectedFiles).toBe(2);
    // g1：30 行 × 1 = 30；g2：8 行 × 2 = 16
    expect(agg.wasteLines).toBe(46);
    expect(agg.topGroups[0]).toMatchObject({ groupId: "g1", size: 2, lines: 30, waste: 30 });
    expect(agg.topGroups[1]).toMatchObject({ groupId: "g2", size: 3, lines: 8, waste: 16 });
    expect(agg.topGroups[0].places[0]).toMatchObject({ filePath: "src/a.ts", startLine: 10, endLine: 39 });
  });

  it("topN 截断只影响明细，不影响总量统计", () => {
    const agg = aggregateClones(data.clones, 1);
    expect(agg.groups).toBe(2);
    expect(agg.wasteLines).toBe(46);
    expect(agg.topGroups).toHaveLength(1);
  });

  it("Type-2 参数化克隆被单独计数并标到组上", () => {
    const base = data.clones ?? [];
    const withT2 = [
      ...base,
      clone("c6", "f1", "src/a.ts", "g3", 300, 12, 2),
      { ...clone("c7", "f3", "lib/c.ts", "g3", 340, 12, 2), cloneType: "type2" },
    ];
    const agg = aggregateClones(withT2);
    expect(agg.type2Instances).toBe(1);
    const g3 = agg.topGroups.find((g) => g.groupId === "g3");
    expect(g3).toBeDefined();
    expect(g3!.type2Count).toBe(1);
    // 组内 type2 的副本同样参与冗余行计算
    expect(g3!.waste).toBe(12);
  });

  it("JSON 报告输出 Type-2 克隆汇总与明细标记", () => {
    const withT2 = {
      ...data,
      clones: [
        ...(data.clones ?? []),
        { ...clone("c6", "f1", "src/a.ts", "g3", 300, 12, 2), cloneType: "type2" },
        clone("c7", "f3", "lib/c.ts", "g3", 340, 12, 2),
      ],
    };
    const parsed = JSON.parse(generateReportJson(withT2));
    expect(parsed.summary.cloneType2Instances).toBe(1);
    const g3 = parsed.codeClones.find((g: any) => g.groupId === "g3");
    expect(g3.type2Count).toBe(1);
  });

  it("HTML/SVG 报告含参数化克隆标注", () => {
    const withT2 = {
      ...data,
      clones: [
        ...(data.clones ?? []),
        { ...clone("c6", "f1", "src/a.ts", "g3", 300, 12, 2), cloneType: "type2" },
        clone("c7", "f3", "lib/c.ts", "g3", 340, 12, 2),
      ],
    };
    const html = generateReportHtml(withT2);
    expect(html).toContain("参数化克隆 1 处");
    expect(html).toContain("参数化 1");
    const svg = generateReportSvg(withT2);
    expect(svg).toContain("参数化克隆 1 处");
  });
});

describe("三格式报告的重复代码分区", () => {
  it("JSON 报告输出克隆汇总与明细", () => {
    const parsed = JSON.parse(generateReportJson(data));
    expect(parsed.summary.cloneGroups).toBe(2);
    expect(parsed.summary.cloneInstances).toBe(5);
    expect(parsed.summary.duplicationWasteLines).toBe(46);
    expect(parsed.codeClones).toHaveLength(2);
    expect(parsed.codeClones[0]).toMatchObject({ groupId: "g1", instances: 2, wasteLines: 30 });
  });

  it("HTML 报告含重复代码分区与位置", () => {
    const html = generateReportHtml(data);
    expect(html).toContain("重复代码");
    expect(html).toContain("可省 46 行");
    expect(html).toContain("src/a.ts:10-39");
  });

  it("SVG 报告含重复代码统计条与分区", () => {
    const svg = generateReportSvg(data);
    expect(svg).toContain("重复冗余行");
    expect(svg).toContain("⧉ 重复代码（克隆检测）");
    expect(svg).toContain("抽公共实现可省约 46 行");
  });

  it("无克隆数据时三格式均不报错且给出空态", () => {
    const empty = { ...data, clones: [] };
    expect(() => generateReportSvg(empty)).not.toThrow();
    expect(generateReportHtml(empty)).toContain("未检测到重复代码块");
    expect(JSON.parse(generateReportJson(empty)).summary.cloneGroups).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI 分析结论 × 扫描事实：交付文档里两者必须同时在场
// ═══════════════════════════════════════════════════════════════

const insights: NonNullable<ReportData["aiInsights"]> = [
  {
    id: "n1",
    title: "订单服务承担了过多职责",
    body: "OrderService 同时处理支付、库存与通知，建议按边界拆分。",
    kind: "risk",
    severity: "critical",
    refs: ["src/a.ts:12", "lib/b.ts"],
    agentId: "my-reviewer",
    seenCount: 4,
    firstSeen: 1700000000,
    lastSeen: 1700600000,
    // 证据文件内容已变 —— 这条结论现在站不住，要复核
    freshness: "stale",
    changedRefs: ["src/a.ts"],
  },
  {
    id: "n2",
    title: "工具层缺少单元测试",
    body: "",
    kind: "recommendation",
    severity: "medium",
    refs: ["src/ghost/NotThere.ts:88"],
    agentId: "my-reviewer",
    seenCount: 1,
    // 引用的文件已不存在（删除或迁移）—— 结论很可能已随代码一起消失
    freshness: "orphaned",
    missingRefs: ["src/ghost/NotThere.ts"],
  },
];

const qualityReport: NonNullable<ReportData["contextQuality"]> = {
  moduleId: "project-scan",
  scopeId: "a1",
  overall: "unavailable",
  dimensions: [
    { key: "files", label: "文件枚举", observed: 2, quality: { status: "ok", observed: 2 } },
    {
      key: "dataFlow",
      label: "数据流",
      observed: 0,
      quality: { status: "unavailable", observed: 0, reason: "该语言暂不支持数据流分析", caveat: "不得断言无数据流风险" },
    },
  ],
};

const aiData: ReportData = { ...data, aiInsights: insights, contextQuality: qualityReport };

describe("报告承载 AI 结论", () => {
  it("HTML 报告含结论章节、严重度、来源 Agent 与稳定性", () => {
    const html = generateReportHtml(aiData);
    expect(html).toContain("AI 深度分析结论");
    expect(html).toContain("订单服务承担了过多职责");
    // Agent 来自用户配置，报告要写清结论出处
    expect(html).toContain("my-reviewer");
    expect(html).toContain("已被 4 轮分析确认");
  });

  it("HTML 报告对无法核实的引用显式打标，而不是原样当成证据印出去", () => {
    const html = generateReportHtml(aiData);
    expect(html).toContain("⚠未核实");
    expect(html).toContain("条引用无法在本次扫描结果中核实");
  });

  it("HTML 报告列出被结论点名最多的文件", () => {
    const html = generateReportHtml(aiData);
    expect(html).toContain("被结论点名最多的文件");
  });

  it("JSON 报告把结论作为机器可读节点带出，版本升到 2", () => {
    const parsed = JSON.parse(generateReportJson(aiData));
    expect(parsed.version).toBe(2);
    expect(parsed.aiAnalysis.total).toBe(2);
    expect(parsed.aiAnalysis.actionable).toBe(1);
    expect(parsed.aiAnalysis.agents).toEqual(["my-reviewer"]);
    expect(parsed.aiAnalysis.items[0].id).toBe("n1");
    expect(parsed.aiAnalysis.items[0].refs[0]).toMatchObject({
      path: "src/a.ts",
      line: 12,
      verified: true,
    });
    expect(parsed.aiAnalysis.unverifiedRefs).toEqual(["src/ghost/NotThere.ts:88"]);
  });

  it("SVG 一屏画像加入 AI 待办统计与结论摘要", () => {
    const svg = generateReportSvg(aiData);
    expect(svg).toContain("AI 待办结论");
    expect(svg).toContain("AI 深度分析结论");
    expect(svg).toContain("订单服务承担了过多职责");
  });

  it("没有 AI 结论时三格式完全不出现相关章节，不留空壳", () => {
    const html = generateReportHtml(data);
    expect(html).not.toContain("AI 深度分析结论");
    const parsed = JSON.parse(generateReportJson(data));
    expect(parsed.aiAnalysis).toBeNull();
    expect(generateReportSvg(data)).not.toContain("AI 待办结论");
  });
});

describe("报告承载数据可信度声明", () => {
  it("HTML 报告点名盲区维度并声明沉默不等于健康", () => {
    const html = generateReportHtml(aiData);
    expect(html).toContain("数据可信度声明");
    expect(html).toContain("盲区维度");
    expect(html).toContain("数据流");
    expect(html).toContain("不得断言无数据流风险");
  });

  it("JSON 报告输出结构化可信度，供下游程序判定能否采信", () => {
    const parsed = JSON.parse(generateReportJson(aiData));
    expect(parsed.dataQuality.overall).toBe("unavailable");
    expect(parsed.dataQuality.blindSpots).toEqual(["数据流"]);
    expect(parsed.dataQuality.dimensions).toHaveLength(2);
  });

  it("SVG 一屏画像顶部直接标出盲区，避免被当成体检合格证", () => {
    const svg = generateReportSvg(aiData);
    expect(svg).toContain("数据盲区");
    expect(svg).toContain("不代表健康");
  });

  it("无体检数据时不渲染该章节", () => {
    const html = generateReportHtml(data);
    expect(html).not.toContain("数据可信度声明");
    expect(JSON.parse(generateReportJson(data)).dataQuality).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// AI 结论时效：沉淀会随代码变化而失效，报告必须把「还能信」与「要复核」分开
// ═══════════════════════════════════════════════════
describe("报告承载 AI 结论时效", () => {
  it("HTML 报告给 stale/orphaned 结论盖时效徽标并说明变化证据", () => {
    const html = generateReportHtml(aiData);
    // stale → 琥珀色「证据已变 · 待复核」徽标
    expect(html).toContain("证据已变 · 待复核");
    // orphaned → 灰「证据已消失」徽标
    expect(html).toContain("证据已消失");
    // 复核前先点明「多少条结论的证据变了」—— 否则读者以为沉淀全是金科玉律
    expect(html).toContain("条结论所引用的代码在产出后已发生变动");
    // 把具体变化的文件摆出来，让人一眼知道去哪复核
    expect(html).toContain("src/a.ts");
    expect(html).toContain("src/ghost/NotThere.ts");
  });

  it("JSON 报告输出 byFreshness 分桶与 needsReview 计数，并透传每条的时效证据", () => {
    const parsed = JSON.parse(generateReportJson(aiData));
    expect(parsed.aiAnalysis.needsReview).toBe(2);
    expect(parsed.aiAnalysis.byFreshness.stale).toBe(1);
    expect(parsed.aiAnalysis.byFreshness.orphaned).toBe(1);
    const n1 = parsed.aiAnalysis.items.find((x: { id: string }) => x.id === "n1");
    const n2 = parsed.aiAnalysis.items.find((x: { id: string }) => x.id === "n2");
    expect(n1.freshness).toBe("stale");
    expect(n1.changedRefs).toEqual(["src/a.ts"]);
    expect(n2.freshness).toBe("orphaned");
    expect(n2.missingRefs).toEqual(["src/ghost/NotThere.ts"]);
  });

  it("SVG 一屏画像在标题与底部都点出待复核数量", () => {
    const svg = generateReportSvg(aiData);
    // 标题后缀「· 待复核 2」
    expect(svg).toContain("待复核 2");
    // 底部「采信前需复核」警示行
    expect(svg).toContain("采信前需复核");
  });
});

describe("报告承载 AI 结论收口（resolve 生命周期）", () => {
  const resolvedInsights: NonNullable<ReportData["aiInsights"]> = [
    {
      id: "open-1",
      title: "开放结论：订单服务耦合过高",
      body: "建议拆分",
      kind: "recommendation",
      severity: "high",
      refs: ["src/a.ts:12"],
      agentId: "my-reviewer",
      seenCount: 3,
      status: "open",
    },
    {
      id: "res-1",
      title: "已收口结论：遗留的同步竞态",
      body: "旧逻辑已移除",
      kind: "finding",
      severity: "critical",
      refs: ["src/b.ts:30"],
      agentId: "my-reviewer",
      seenCount: 2,
      status: "resolved",
      resolvedReason: "已在 v2 重构中消除",
      resolvedBy: "user",
    },
  ];
  const resolvedData: ReportData = { ...data, aiInsights: resolvedInsights };

  it("HTML 报告把 resolved 单列「已收口」节，不污染待办统计", () => {
    const html = generateReportHtml(resolvedData);
    // 主统计只算 open：待办 1、已收口 1
    expect(html).toContain("待办 1");
    expect(html).toContain("已收口 1");
    // resolved 单独成节且带收口理由
    expect(html).toContain("已收口结论（1 条");
    expect(html).toContain("已在 v2 重构中消除");
    expect(html).toContain("操作人：user");
    // 开放结论仍在主清单，已收口结论不在主清单标题行（只出现在已收口节）
    expect(html).toContain("开放结论：订单服务耦合过高");
  });

  it("JSON 报告 resolvedCount 与 items / resolvedItems 分流正确", () => {
    const parsed = JSON.parse(generateReportJson(resolvedData));
    expect(parsed.aiAnalysis.total).toBe(1);
    expect(parsed.aiAnalysis.resolvedCount).toBe(1);
    expect(parsed.aiAnalysis.items).toHaveLength(1);
    expect(parsed.aiAnalysis.items[0].id).toBe("open-1");
    expect(parsed.aiAnalysis.items[0].status).toBe("open");
    expect(parsed.aiAnalysis.resolvedItems).toHaveLength(1);
    expect(parsed.aiAnalysis.resolvedItems[0]).toMatchObject({
      id: "res-1",
      resolvedReason: "已在 v2 重构中消除",
      resolvedBy: "user",
    });
  });

  it("SVG 一屏画像标题带「已收口 N」后缀", () => {
    const svg = generateReportSvg(resolvedData);
    expect(svg).toContain("已收口 1");
  });
});
