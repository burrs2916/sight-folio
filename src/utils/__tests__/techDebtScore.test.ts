import { describe, it, expect } from "vitest";
import {
  computeTechDebtScore,
  gradeOf,
  emptyTechDebtScore,
  EFFORT,
  type DebtScoreInput,
} from "../techDebtScore";
import type {
  ProjectFile,
  FileMetric,
  TechDebtItem,
  DeadSymbol,
  ReviewFinding,
} from "../../services/tauri";

function file(id: string, lines: number): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: `/tmp/${id}.ts`,
    relPath: `src/${id}.ts`,
    name: `${id}.ts`,
    extension: "ts",
    language: "typescript",
    size: lines * 30,
    lineCount: lines,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 60,
    metadata: "{}",
    scannedAt: 0,
  } as ProjectFile;
}

function metric(fileId: string, codeLines: number, level: string): FileMetric {
  return {
    id: `m_${fileId}`,
    analysisId: "a1",
    fileId,
    filePath: `src/${fileId}.ts`,
    totalLines: codeLines,
    codeLines,
    commentLines: 0,
    blankLines: 0,
    cyclomaticComplexity: level === "extreme" ? 30 : level === "high" ? 15 : 3,
    maxNesting: 2,
    complexityLevel: level,
    metadata: "{}",
    createdAt: 0,
  } as FileMetric;
}

function debt(severity: string): TechDebtItem {
  return {
    id: `d_${Math.random()}`,
    analysisId: "a1",
    fileId: "f1",
    filePath: "src/f1.ts",
    lineNo: 1,
    marker: severity === "critical" ? "FIXME" : severity === "warning" ? "OPTIMIZE" : "TODO",
    severity,
    snippet: "// TODO",
    createdAt: 0,
  } as TechDebtItem;
}

function dead(confidence: string): DeadSymbol {
  return {
    symbolId: `s_${Math.random()}`,
    analysisId: "a1",
    fileId: "f1",
    filePath: "src/f1.ts",
    name: "unused",
    kind: "function",
    lineStart: 1,
    lineEnd: 3,
    visibility: confidence === "high" ? "internal" : "exported",
    confidence,
    reason: "",
  };
}

function finding(severity: string, ruleId: string | null = "rule_x"): ReviewFinding {
  return {
    id: `fd_${Math.random()}`,
    analysisId: "a1",
    ruleId,
    targetId: "f1",
    targetType: "file",
    severity,
    message: "",
    suggestion: null,
    status: "open",
    foundAt: 0,
    fixedAt: null,
    metadata: "{}",
  } as ReviewFinding;
}

const emptyInput: DebtScoreInput = {
  files: [],
  metrics: [],
  techDebt: [],
  deadSymbols: [],
  findings: [],
};

describe("gradeOf", () => {
  it("按 SQALE 阈值分级", () => {
    expect(gradeOf(0)).toBe("A");
    expect(gradeOf(0.05)).toBe("A");
    expect(gradeOf(0.08)).toBe("B");
    expect(gradeOf(0.15)).toBe("C");
    expect(gradeOf(0.4)).toBe("D");
    expect(gradeOf(0.8)).toBe("E");
  });
});

describe("computeTechDebtScore", () => {
  it("无数据时返回零分且评级 A", () => {
    const r = computeTechDebtScore(emptyInput);
    expect(r.totalHours).toBe(0);
    expect(r.grade).toBe("A");
    expect(r.breakdown).toEqual([]);
  });

  it("按类别累加偿还工时", () => {
    const r = computeTechDebtScore({
      files: [file("f1", 1000)],
      metrics: [metric("f1", 1000, "extreme")],
      techDebt: [debt("critical"), debt("critical"), debt("info")],
      deadSymbols: [dead("high"), dead("medium")],
      findings: [finding("critical"), finding("warning")],
    });
    const expected =
      2 * EFFORT.markerCritical +
      1 * EFFORT.markerInfo +
      1 * EFFORT.complexityExtreme +
      1 * EFFORT.deadHigh +
      1 * EFFORT.deadMedium +
      1 * EFFORT.findingCritical +
      1 * EFFORT.findingWarning;
    expect(r.totalHours).toBeCloseTo(Math.round(expected * 10) / 10, 5);
    expect(r.totalIssues).toBe(8);
  });

  it("死代码 finding 不与死代码符号双算", () => {
    const withDeadFinding = computeTechDebtScore({
      ...emptyInput,
      files: [file("f1", 500)],
      metrics: [metric("f1", 500, "low")],
      deadSymbols: [dead("high")],
      findings: [finding("warning", "rule_dead_symbol")],
    });
    expect(withDeadFinding.totalHours).toBeCloseTo(EFFORT.deadHigh, 5);
  });

  it("明细按工时降序且过滤零项", () => {
    const r = computeTechDebtScore({
      ...emptyInput,
      files: [file("f1", 1000)],
      metrics: [metric("f1", 1000, "extreme")],
      techDebt: [debt("info")],
    });
    expect(r.breakdown[0].key).toBe("complexityExtreme");
    expect(r.breakdown.every((b) => b.count > 0)).toBe(true);
  });

  it("无度量数据时用文件行数兜底分母", () => {
    const r = computeTechDebtScore({
      ...emptyInput,
      files: [file("f1", 2000)],
      techDebt: [debt("critical")],
    });
    expect(r.totalLines).toBe(2000);
    expect(r.ratio).toBeGreaterThan(0);
    expect(r.ratio).toBeLessThan(1);
  });

  it("债务比率上限为 1", () => {
    const r = computeTechDebtScore({
      ...emptyInput,
      files: [file("f1", 10)],
      techDebt: Array.from({ length: 200 }, () => debt("critical")),
    });
    expect(r.ratio).toBe(1);
    expect(r.grade).toBe("E");
  });

  it("emptyTechDebtScore 与零输入一致", () => {
    const e = emptyTechDebtScore();
    const r = computeTechDebtScore(emptyInput);
    expect(e.grade).toBe(r.grade);
    expect(e.totalHours).toBe(r.totalHours);
  });
});
