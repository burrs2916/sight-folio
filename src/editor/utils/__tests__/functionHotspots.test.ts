// project-sight: 函数热点布局引擎单测（functionHotspots.ts）
import { describe, it, expect } from "vitest";
import type { FileMetric, ProjectFile, ProjectSymbol } from "../../../services/tauri";
import {
  buildFunctionHotspots,
  riskScoreOf,
  levelOfRisk,
  MIN_RISK,
  MAX_PER_MODULE,
  MAX_TOTAL,
  DEGRADED_TOP_N,
} from "../functionHotspots";

interface FnSpec {
  name: string;
  line: number;
  lines?: number;
  cc?: number;
  params?: number;
  maxNesting?: number;
}

function astMetric(fileId: string, filePath: string, fns: FnSpec[]): FileMetric {
  const functions = fns.map((f) => ({
    name: f.name,
    line: f.line,
    endLine: f.line + (f.lines ?? 10),
    lines: f.lines ?? 10,
    cc: f.cc ?? 1,
    params: f.params ?? 0,
    maxNesting: f.maxNesting ?? 1,
  }));
  return {
    id: `m_${fileId}`,
    analysisId: "a1",
    fileId,
    filePath,
    totalLines: 200,
    codeLines: 160,
    commentLines: 20,
    blankLines: 20,
    cyclomaticComplexity: functions.reduce((acc, f) => acc + f.cc, 1),
    complexityLevel: "medium",
    metadata: JSON.stringify({ language: "typescript", engine: "ast", functions, magicNumbers: [] }),
    createdAt: 1,
    engine: "ast",
    maxNesting: Math.max(0, ...functions.map((f) => f.maxNesting)),
    functionCount: functions.length,
    maxFunctionCc: Math.max(0, ...functions.map((f) => f.cc)),
    hotFunction: functions[0]?.name ?? "",
    magicNumberCount: 0,
  };
}

function file(id: string, relPath: string): ProjectFile {
  return { id, relPath, name: relPath.split("/").pop()!, isDirectory: false } as any;
}

describe("riskScoreOf / levelOfRisk", () => {
  it("嵌套权重高于圈复杂度（同等「难度」下嵌套更致命）", () => {
    const flat = riskScoreOf({ cc: 10, lines: 20, params: 2, maxNesting: 1 });
    const nested = riskScoreOf({ cc: 5, lines: 20, params: 2, maxNesting: 4 });
    expect(nested).toBeGreaterThan(flat);
  });

  it("形参 5 个以内不计分，超出部分才加权", () => {
    const base = { cc: 1, lines: 0, maxNesting: 0 };
    expect(riskScoreOf({ ...base, params: 5 })).toBe(riskScoreOf({ ...base, params: 0 }));
    expect(riskScoreOf({ ...base, params: 7 })).toBe(riskScoreOf({ ...base, params: 5 }) + 6);
  });

  it("等级阈值单调：极端函数 → extreme，平凡函数 → low", () => {
    expect(levelOfRisk(riskScoreOf({ cc: 31, lines: 129, params: 7, maxNesting: 6 }))).toBe("extreme");
    expect(levelOfRisk(riskScoreOf({ cc: 2, lines: 12, params: 1, maxNesting: 1 }))).toBe("low");
  });
});

describe("buildFunctionHotspots", () => {
  it("heuristic 度量不参与（没有函数明细，不能假装有）", () => {
    const m = astMetric("f1", "src/a.ts", [{ name: "big", line: 1, cc: 40, maxNesting: 8, lines: 200 }]);
    const heuristic: FileMetric = { ...m, engine: "heuristic" };
    const layout = buildFunctionHotspots([heuristic], [file("f1", "src/a.ts")]);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.summary.astFiles).toBe(0);
  });

  it("只放行达到关注阈值的函数，健康函数不上画布", () => {
    const layout = buildFunctionHotspots(
      [
        astMetric("f1", "src/a.ts", [
          { name: "monster", line: 10, cc: 31, params: 7, maxNesting: 6, lines: 129 },
          { name: "tiny", line: 200, cc: 1, params: 1, maxNesting: 1, lines: 5 },
        ]),
      ],
      [file("f1", "src/a.ts")]
    );
    expect(layout.summary.totalFunctions).toBe(2);
    expect(layout.nodes.map((n) => n.name)).toEqual(["monster"]);
    expect(layout.nodes[0].risk).toBeGreaterThanOrEqual(MIN_RISK);
    expect(layout.summary.degraded).toBe(false);
  });

  it("全项目都健康时降级展示 Top-N，而不是给一张空画布", () => {
    const fns = Array.from({ length: 40 }, (_, i) => ({
      name: `ok${i}`,
      line: i * 10 + 1,
      cc: 2,
      params: 1,
      maxNesting: 1,
      lines: 8,
    }));
    const layout = buildFunctionHotspots([astMetric("f1", "src/a.ts", fns)], [file("f1", "src/a.ts")]);
    expect(layout.summary.degraded).toBe(true);
    expect(layout.nodes.length).toBe(Math.min(DEGRADED_TOP_N, MAX_PER_MODULE));
    expect(layout.nodes.every((n) => n.level === "low")).toBe(true);
  });

  it("按模块分组，风险总和高的模块排在前面", () => {
    const layout = buildFunctionHotspots(
      [
        astMetric("f1", "util/mild.ts", [{ name: "mild", line: 1, cc: 11, maxNesting: 2, lines: 40 }]),
        astMetric("f2", "core/hot.ts", [
          { name: "hotA", line: 1, cc: 25, maxNesting: 5, lines: 120 },
          { name: "hotB", line: 200, cc: 18, maxNesting: 4, lines: 90 },
        ]),
      ],
      [file("f1", "util/mild.ts"), file("f2", "core/hot.ts")]
    );
    expect(layout.groups.map((g) => g.name)).toEqual(["core", "util"]);
    expect(layout.groups[0].riskSum).toBeGreaterThan(layout.groups[1].riskSum);
    // 分组头 y 递增，卡片落在各自分组头下方
    expect(layout.groups[1].y).toBeGreaterThan(layout.groups[0].y);
    const coreNodes = layout.nodes.filter((n) => n.moduleName === "core");
    expect(coreNodes.every((n) => n.y > layout.groups[0].y)).toBe(true);
  });

  it("组内截断：单模块最多 MAX_PER_MODULE 个，truncated 如实计数", () => {
    const fns = Array.from({ length: MAX_PER_MODULE + 7 }, (_, i) => ({
      name: `f${i}`,
      line: i * 100 + 1,
      cc: 20,
      maxNesting: 5,
      lines: 100,
    }));
    const layout = buildFunctionHotspots([astMetric("f1", "core/a.ts", fns)], [file("f1", "core/a.ts")]);
    expect(layout.nodes).toHaveLength(MAX_PER_MODULE);
    expect(layout.summary.candidates).toBe(MAX_PER_MODULE + 7);
    expect(layout.summary.truncated).toBe(7);
    expect(layout.groups[0].functionCount).toBe(MAX_PER_MODULE + 7);
    expect(layout.groups[0].renderedCount).toBe(MAX_PER_MODULE);
  });

  it("全局上限 MAX_TOTAL 生效（画布实体数受控，保住帧率）", () => {
    const metrics: FileMetric[] = [];
    const files: ProjectFile[] = [];
    for (let m = 0; m < 30; m++) {
      const p = `mod${m}/a.ts`;
      const fns = Array.from({ length: MAX_PER_MODULE }, (_, i) => ({
        name: `f${m}_${i}`,
        line: i * 100 + 1,
        cc: 20,
        maxNesting: 5,
        lines: 100,
      }));
      metrics.push(astMetric(`f${m}`, p, fns));
      files.push(file(`f${m}`, p));
    }
    const layout = buildFunctionHotspots(metrics, files);
    expect(layout.nodes.length).toBeLessThanOrEqual(MAX_TOTAL);
    expect(layout.nodes.length).toBeGreaterThan(0);
  });

  it("每个节点都带定位信息与上榜理由（业务联动的前提）", () => {
    const layout = buildFunctionHotspots(
      [astMetric("f1", "src/server.ts", [{ name: "handle", line: 12, cc: 31, params: 7, maxNesting: 6, lines: 129 }])],
      [file("f1", "src/server.ts")]
    );
    const n = layout.nodes[0];
    expect(n.fileId).toBe("f1");
    expect(n.filePath).toBe("src/server.ts");
    expect(n.line).toBe(12);
    expect(n.endLine).toBe(12 + 129);
    expect(n.key).toBe("f1:12");
    // 理由按「实际贡献分」排序（不是按单位权重）：CC 31×2=62 > 嵌套 6×4=24
    expect(n.reasons[0]).toContain("圈复杂度 31");
    expect(n.reasons.join()).toContain("嵌套 6 层");
    expect(n.reasons.length).toBeLessThanOrEqual(3);
  });

  it("脏 metadata 不崩，按无函数处理", () => {
    const m = astMetric("f1", "src/a.ts", [{ name: "x", line: 1 }]);
    const dirty: FileMetric = { ...m, metadata: "{坏JSON" };
    const layout = buildFunctionHotspots([dirty], [file("f1", "src/a.ts")]);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.summary.totalFunctions).toBe(0);
  });

  it("文件不在 files 列表里时退化用 metric.filePath，不丢数据", () => {
    const layout = buildFunctionHotspots(
      [astMetric("ghost", "legacy/old.ts", [{ name: "zombie", line: 3, cc: 30, maxNesting: 6, lines: 150 }])],
      []
    );
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].filePath).toBe("legacy/old.ts");
    expect(layout.nodes[0].moduleName).toBe("legacy");
    expect(layout.nodes[0].fileName).toBe("old.ts");
  });
});

describe("heuristic 语言方法符号兜底（v2.5）", () => {
  const files = [makeFile("fa", "src/a.ts")];
  const emptyMetrics: FileMetric[] = [];

  it("无 AST 明细但有方法符号时，用调用入度生成方法级热点", () => {
    const symbols = [
      makeSymbol("m1", "fa", "save", "method", 10, "src/a.ts", 60),
      makeSymbol("m2", "fa", "helper", "function", 5, "src/a.ts", 12),
    ];
    const callEdges = [
      { callerSymbolId: "x1", calleeSymbolId: "m1" },
      { callerSymbolId: "x2", calleeSymbolId: "m1" },
      { callerSymbolId: "x3", calleeSymbolId: "m1" },
      { callerSymbolId: "x4", calleeSymbolId: "m1" },
      { callerSymbolId: "x5", calleeSymbolId: "m1" },
    ];
    const layout = buildFunctionHotspots(emptyMetrics, files, symbols, callEdges as any);
    expect(layout.nodes.length).toBeGreaterThan(0);
    // save 被调用 5 次 → 风险最高，排第一
    const save = layout.nodes.find((n) => n.name === "save");
    expect(save).toBeTruthy();
    expect(save!.reasons.some((r) => r.includes("5"))).toBe(true);
  });

  it("无符号也无 AST → 空布局（保留原有 hotNoAst 分支语义）", () => {
    const layout = buildFunctionHotspots(emptyMetrics, files, [], []);
    expect(layout.nodes.length).toBe(0);
    expect(layout.summary.totalFunctions).toBe(0);
  });

  it("有 AST 明细时符号兜底不干扰（AST 优先）", () => {
    const metrics: FileMetric[] = [
      {
        id: "mm",
        analysisId: "a1",
        fileId: "fa",
        filePath: "src/a.ts",
        totalLines: 100,
        codeLines: 80,
        commentLines: 10,
        blankLines: 10,
        cyclomaticComplexity: 5,
        complexityLevel: "medium",
        engine: "ast",
        metadata: JSON.stringify({
          functions: [
            { name: "realFn", line: 1, endLine: 20, lines: 20, cc: 12, params: 3, maxNesting: 2 },
          ],
        }),
      } as FileMetric,
    ];
    const symbols = [makeSymbol("m1", "fa", "save", "method", 10, "src/a.ts", 60)];
    const layout = buildFunctionHotspots(metrics, files, symbols, []);
    expect(layout.nodes.some((n) => n.name === "realFn")).toBe(true);
    expect(layout.nodes.some((n) => n.name === "save")).toBe(false); // AST 优先，兜底不混入
  });
});

function makeFile(id: string, relPath: string): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: relPath,
    relPath,
    name: relPath.split("/").pop() || id,
    extension: "ts",
    language: "typescript",
    size: 100,
    lineCount: 10,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: "l1",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    metadata: "{}",
    scannedAt: 0,
  };
}

function makeSymbol(
  id: string,
  fileId: string,
  name: string,
  kind: string,
  lineStart: number,
  filePath: string,
  lineEnd = lineStart + 10
): ProjectSymbol {
  return {
    id,
    analysisId: "a1",
    fileId,
    filePath,
    name,
    kind,
    lineStart,
    lineEnd,
    signature: `${name}()`,
    doc: null,
    modifiers: "",
    patterns: "",
    metadata: "{}",
    createdAt: 0,
  };
}
