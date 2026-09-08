import { describe, it, expect } from "vitest";
import {
  buildFileInsights,
  complexityLevelOf,
  duplicationLevelOf,
  patternLabel,
  emptyFileInsight,
  COMPLEXITY_COLORS,
  DUPLICATION_COLORS,
  normalizeSeverity,
} from "../fileInsights";
import type {
  ProjectFile,
  ProjectSymbol,
  PatternHit,
  ProjectSymbolRef,
  FileMetric,
  TechDebtItem,
  ReviewFinding,
  CodeClone,
} from "../../../services/tauri";

const clone = (
  id: string,
  fileId: string,
  groupId: string,
  startLine: number,
  endLine: number
): CodeClone => ({
  id,
  analysisId: "a1",
  groupId,
  fileId,
  filePath: `src/${fileId}.ts`,
  startLine,
  endLine,
  lineCount: endLine - startLine + 1,
  groupSize: 2,
  snippet: "dup",
  language: "typescript",
  cloneType: "type1",
  createdAt: 1,
});

const finding = (
  id: string,
  targetId: string,
  severity: string,
  targetType = "file"
): ReviewFinding => ({
  id,
  analysisId: "a1",
  ruleId: "r1",
  targetId,
  targetType,
  severity,
  message: "msg",
  suggestion: null,
  status: "open",
  foundAt: 1,
  fixedAt: null,
  metadata: "{}",
});

const file = (id: string, relPath: string): ProjectFile => ({
  id,
  analysisId: "a1",
  path: `/proj/${relPath}`,
  relPath,
  name: relPath.split("/").pop() || relPath,
  extension: "ts",
  language: "typescript",
  size: 100,
  lineCount: 10,
  contentHash: null,
  parentId: null,
  isDirectory: false,
  layerId: null,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  metadata: "{}",
  scannedAt: 1,
});

const symbol = (id: string, fileId: string, name: string, kind: string): ProjectSymbol => ({
  id,
  analysisId: "a1",
  fileId,
  filePath: "",
  name,
  kind,
  lineStart: 1,
  lineEnd: 2,
  signature: name,
  doc: null,
  modifiers: "",
  patterns: "[]",
  metadata: "{}",
  createdAt: 1,
});

const hit = (pattern: string, filePath: string): PatternHit => ({
  pattern,
  name: pattern,
  symbolName: "S",
  filePath,
  line: 1,
  evidence: "e",
  confidence: 0.9,
  signals: ["test"],
  category: "structural",
});

const ref = (id: string, toFileId: string, symbolName: string): ProjectSymbolRef => ({
  id,
  analysisId: "a1",
  fromFileId: "f_src",
  fromFilePath: "src.ts",
  toSymbolId: null,
  toFileId,
  toFilePath: "x.ts",
  symbolName,
  refLine: 1,
  refText: "import",
  kind: "import",
  createdAt: 1,
});

const metric = (fileId: string, cc: number, level: string, codeLines = 8): FileMetric => ({
  id: `m_${fileId}`,
  analysisId: "a1",
  fileId,
  filePath: "",
  totalLines: 10,
  codeLines,
  commentLines: 1,
  blankLines: 1,
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
  filePath: "",
  lineNo: 1,
  marker,
  severity,
  snippet: "// TODO: fix",
  createdAt: 1,
});

describe("fileInsights 画布画像数据聚合", () => {
  it("聚合符号数量与符号名列表", () => {
    const files = [file("f1", "src/a.ts")];
    const symbols = [
      symbol("s1", "f1", "App", "class"),
      symbol("s2", "f1", "render", "function"),
    ];
    const map = buildFileInsights(files, symbols, [], [], []);
    const insight = map.get("f1")!;
    expect(insight.symbolCount).toBe(2);
    expect(insight.symbolNames).toEqual(["App", "render"]);
  });

  it("设计模式按文件路径聚合且去重、中文化", () => {
    const files = [file("f1", "src/service.ts")];
    const hits = [
      hit("singleton", "src/service.ts"),
      hit("singleton", "src/service.ts"),
      hit("factory", "src/service.ts"),
    ];
    const map = buildFileInsights(files, [], hits, [], []);
    const insight = map.get("f1")!;
    expect(insight.patternNames.sort()).toEqual(["单例", "工厂"]);
  });

  it("入向引用按 toFileId 计数", () => {
    const files = [file("f1", "src/a.ts")];
    const refs = [ref("r1", "f1", "A"), ref("r2", "f1", "B"), ref("r3", "f_other", "C")];
    const map = buildFileInsights(files, [], [], refs, []);
    expect(map.get("f1")!.refCount).toBe(2);
  });

  it("复杂度取度量数据并映射等级", () => {
    const files = [file("f1", "src/a.ts"), file("f2", "src/b.ts")];
    const metrics = [metric("f1", 3, "low"), metric("f2", 22, "extreme")];
    const map = buildFileInsights(files, [], [], [], metrics);
    expect(map.get("f1")!.complexity).toBe(3);
    expect(map.get("f1")!.complexityLevel).toBe("low");
    expect(map.get("f2")!.complexityLevel).toBe("extreme");
  });

  it("无任何分析数据时返回兜底值，目录文件被跳过", () => {
    const dir: ProjectFile = { ...file("d1", "src"), isDirectory: true };
    const map = buildFileInsights([dir], [], [], [], []);
    expect(map.has("d1")).toBe(false);
    expect(emptyFileInsight()).toEqual({
      symbolCount: 0,
      patternNames: [],
      refCount: 0,
      complexity: 1,
      complexityLevel: "low",
      complexityEngine: undefined,
      syntaxErrorCount: 0,
      syntaxErrorLines: [],
      symbolNames: [],
      techDebtCount: 0,
      techDebtMarkers: [],
      churnScore: 0,
      churnLevel: "low",
      commitCount: 0,
      authorCount: 0,
      callOut: 0,
      callIn: 0,
      deadCount: 0,
      cloneCount: 0,
      cloneType2Count: 0,
      duplicatedLines: 0,
      duplicationRatio: 0,
      quadrant: "healthy",
      findingCount: 0,
      riskScore: 0,
      findingSeverities: { error: 0, warning: 0, info: 0 },
    });
  });

  it("技术债按 fileId 聚合：数量与标记类型去重", () => {
    const files = [file("f1", "src/a.ts"), file("f2", "src/b.ts")];
    const debts = [
      debt("d1", "f1", "TODO", "info"),
      debt("d2", "f1", "FIXME", "critical"),
      debt("d3", "f1", "TODO", "info"),
      debt("d4", "f2", "HACK", "critical"),
    ];
    const map = buildFileInsights(files, [], [], [], [], debts);
    expect(map.get("f1")!.techDebtCount).toBe(3);
    expect(map.get("f1")!.techDebtMarkers.sort()).toEqual(["FIXME", "TODO"]);
    expect(map.get("f2")!.techDebtCount).toBe(1);
    expect(map.get("f2")!.techDebtMarkers).toEqual(["HACK"]);
    expect(map.get("f2")!.techDebtMarkers.length).toBe(1);
  });

  it("审查发现按 targetId 聚合为严重度计数与加权风险分", () => {
    const files = [file("f1", "src/a.ts"), file("f2", "src/b.ts")];
    const findings = [
      finding("v1", "f1", "error"),
      finding("v2", "f1", "critical"), // critical 归一化为 error
      finding("v3", "f1", "warning"),
      finding("v4", "f2", "info"),
      finding("v5", "m1", "error", "module"), // 非 file 目标不计入文件画像
    ];
    const map = buildFileInsights(files, [], [], [], [], [], [], [], [], findings);
    const f1 = map.get("f1")!;
    expect(f1.findingSeverities).toEqual({ error: 2, warning: 1, info: 0 });
    expect(f1.findingCount).toBe(3);
    expect(f1.riskScore).toBe(2 * 5 + 1 * 2); // error=5 warning=2
    const f2 = map.get("f2")!;
    expect(f2.findingCount).toBe(1);
    expect(f2.riskScore).toBe(1);
  });

  it("严重度别名归一化：warn→warning、hint→info", () => {
    expect(normalizeSeverity("WARN")).toBe("warning");
    expect(normalizeSeverity("Critical")).toBe("error");
    expect(normalizeSeverity("hint")).toBe("info");
    expect(normalizeSeverity("")).toBe("info");
  });

  it("重复代码按 fileId 聚合：块数累加、重叠行去重", () => {
    const files = [
      { ...file("f1", "src/a.ts"), lineCount: 100 },
      { ...file("f2", "src/b.ts"), lineCount: 100 },
    ];
    const clones = [
      // f1 上两个克隆块行号重叠（10-19 与 15-24）→ 并集应为 10-24 共 15 行
      clone("c1", "f1", "g1", 10, 19),
      clone("c2", "f1", "g2", 15, 24),
      clone("c3", "f2", "g1", 40, 49),
    ];
    const map = buildFileInsights(files, [], [], [], [], [], [], [], [], [], clones);
    const f1 = map.get("f1")!;
    expect(f1.cloneCount).toBe(2);
    expect(f1.duplicatedLines).toBe(15); // 去重后，而不是 10+10=20
    expect(f1.duplicationRatio).toBeCloseTo(0.15, 5);
    const f2 = map.get("f2")!;
    expect(f2.cloneCount).toBe(1);
    expect(f2.duplicatedLines).toBe(10);
  });

  it("Type-2 参数化克隆单独计数，且与逐字克隆分开统计", () => {
    const files = [{ ...file("f1", "src/a.ts"), lineCount: 100 }];
    const clones = [
      clone("c1", "f1", "g1", 10, 19),
      { ...clone("c2", "f1", "g2", 30, 39), cloneType: "type2" },
      { ...clone("c3", "f1", "g3", 50, 59), cloneType: "type2" },
    ];
    const map = buildFileInsights(files, [], [], [], [], [], [], [], [], [], clones);
    const f1 = map.get("f1")!;
    expect(f1.cloneCount).toBe(3);
    expect(f1.cloneType2Count).toBe(2);
    // type2 块同样计入重复行（去重并集）
    expect(f1.duplicatedLines).toBe(30);
  });

  it("重复率以度量的代码行为分母，且永不超过 100%", () => {
    const files = [{ ...file("f1", "src/a.ts"), lineCount: 200 }];
    // 度量给出代码行 50（去掉空行注释），克隆覆盖 1-80 行
    const metrics = [metric("f1", 3, "low", 50)];
    const clones = [clone("c1", "f1", "g1", 1, 80)];
    const map = buildFileInsights(files, [], [], [], metrics, [], [], [], [], [], clones);
    expect(map.get("f1")!.duplicationRatio).toBe(1); // 截断到 100%，不会出现 160%
  });

  it("无克隆数据时重复指标保持为零（旧分析不受影响）", () => {
    const files = [file("f1", "src/a.ts")];
    const map = buildFileInsights(files, [], [], [], []);
    expect(map.get("f1")!.cloneCount).toBe(0);
    expect(map.get("f1")!.duplicationRatio).toBe(0);
  });

  it("重复率分级阈值对齐 SonarQube 3% 告警线", () => {
    expect(duplicationLevelOf(0)).toBe("none");
    expect(duplicationLevelOf(0.03)).toBe("none");
    expect(duplicationLevelOf(0.05)).toBe("low");
    expect(duplicationLevelOf(0.2)).toBe("medium");
    expect(duplicationLevelOf(0.4)).toBe("high");
    expect(duplicationLevelOf(0.8)).toBe("extreme");
    expect(DUPLICATION_COLORS.extreme).toBe("#ef4444");
  });

  it("等级映射与热力色一致", () => {
    expect(complexityLevelOf(1)).toBe("low");
    expect(complexityLevelOf(6)).toBe("medium");
    expect(complexityLevelOf(11)).toBe("high");
    expect(complexityLevelOf(30)).toBe("extreme");
    expect(COMPLEXITY_COLORS.low).toBe("#22c55e");
    expect(patternLabel("repository")).toBe("仓储");
    expect(patternLabel("unknown")).toBe("unknown");
  });
});
