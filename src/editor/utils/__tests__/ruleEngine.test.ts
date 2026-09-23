// sight-folio: 插件规则执行引擎单测（ruleEngine.ts）
import { describe, it, expect } from "vitest";
import type { AnalyzerManifest } from "../../analyzer/types";
import type { FileMetric } from "../../../services/tauri";
import {
  evaluatePluginRules,
  summarizeRuleEvals,
  type RuleEngineData,
} from "../ruleEngine";

/**
 * FileMetric 夹具。
 * 默认 engine="heuristic"（行级估算），AST 类规则在这种数据上应当诚实标 unsupported；
 * 传 engine="ast" + meta 才代表 tree-sitter 真解析过。
 */
function fm(over: Partial<FileMetric> = {}): FileMetric {
  return {
    id: "m1",
    analysisId: "a",
    fileId: "f1",
    filePath: "src/a.ts",
    totalLines: 100,
    codeLines: 80,
    commentLines: 10,
    blankLines: 10,
    cyclomaticComplexity: 1,
    complexityLevel: "low",
    metadata: "",
    createdAt: 0,
    engine: "heuristic",
    maxNesting: 0,
    functionCount: 0,
    maxFunctionCc: 0,
    hotFunction: "",
    magicNumberCount: 0,
    ...over,
  };
}

function makeManifest(rules: AnalyzerManifest["rules"]): AnalyzerManifest {
  return {
    id: "test-analyzer",
    name: "测试分析器",
    version: "1.0.0",
    language: "TypeScript",
    capabilities: { scanning: true, rules: true, dependencyAnalysis: true, rendering: true },
    entityTypes: [],
    viewTemplates: [],
    layerTypes: [],
    eventHandlers: [],
    rules,
  };
}

const emptyData: RuleEngineData = {
  files: [],
  fileMetrics: [],
  modules: [],
  deps: [],
  layers: [],
  deadSymbols: [],
  findings: [],
};

describe("evaluatePluginRules", () => {
  it("复杂度过高 → 按文件报违规，value=圈复杂度", () => {
    const manifest = makeManifest([
      { id: "ts-complexity", name: "圈复杂度检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "src/a.ts" } as any],
      fileMetrics: [
        fm({ cyclomaticComplexity: 24, complexityLevel: "extreme" }),
        fm({ id: "m2", fileId: "missing", filePath: "gone.ts", cyclomaticComplexity: 5 }),
      ],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.supported).toBe(true);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].target).toBe("src/a.ts");
    expect(ev.violations[0].value).toBe(24);
    expect(ev.violations[0].threshold).toBe(10);
  });

  it("模块耦合度过高 → 按模块报违规（入+出度）", () => {
    const manifest = makeManifest([
      { id: "ts-coupling", name: "模块耦合度检测", description: "x", severity: "warning", category: "coupling" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      modules: [{ id: "mod-a", name: "core" } as any, { id: "mod-b", name: "util" } as any],
      deps: Array.from({ length: 14 }, (_, i) => ({
        id: `d${i}`, fromId: "mod-a", fromType: "module", toId: `mod-b`, toType: "module",
      } as any)),
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.violations).toHaveLength(2);
    expect(ev.violations.map((v) => v.target).sort()).toEqual(["core", "util"]);
    expect(ev.violations[0].value).toBe(14);
  });

  it("下层反向依赖上层 → 分层违规（sortOrder 小=上层）", () => {
    const manifest = makeManifest([
      { id: "ts-layering", name: "分层违规检测", description: "x", severity: "critical", category: "layering" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [
        { id: "infra", relPath: "src/infra/db.ts", layerId: "L2" } as any,
        { id: "domain", relPath: "src/domain/order.ts", layerId: "L1" } as any,
      ],
      layers: [
        { id: "L1", name: "领域层", sortOrder: 0 } as any,
        { id: "L2", name: "基础设施层", sortOrder: 1 } as any,
      ],
      deps: [{ id: "d1", fromId: "infra", toId: "domain", fromType: "file", toType: "file", isCircular: false } as any],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].target).toBe("src/infra/db.ts");
    expect(ev.violations[0].detail).toContain("反向依赖");
  });

  it("上层依赖下层不算违规", () => {
    const manifest = makeManifest([
      { id: "ts-layering", name: "分层违规检测", description: "x", severity: "critical", category: "layering" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [
        { id: "infra", relPath: "src/infra/db.ts", layerId: "L2" } as any,
        { id: "domain", relPath: "src/domain/order.ts", layerId: "L1" } as any,
      ],
      layers: [
        { id: "L1", name: "领域层", sortOrder: 0 } as any,
        { id: "L2", name: "基础设施层", sortOrder: 1 } as any,
      ],
      deps: [{ id: "d1", fromId: "domain", toId: "infra", fromType: "file", toType: "file", isCircular: false } as any],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.violations).toHaveLength(0);
  });

  it("未使用导出 → 按文件聚合死符号", () => {
    const manifest = makeManifest([
      { id: "ts-unused", name: "未使用导出检测", description: "x", severity: "info", category: "metadata" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "src/legacy.ts" } as any],
      deadSymbols: [
        { symbolId: "s1", analysisId: "a", fileId: "f1", filePath: "src/legacy.ts", name: "oldFn", kind: "function", lineStart: 1, lineEnd: 3, visibility: "exported", confidence: "high", reason: "x" },
        { symbolId: "s2", analysisId: "a", fileId: "f1", filePath: "src/legacy.ts", name: "deadConst", kind: "const", lineStart: 5, lineEnd: 5, visibility: "internal", confidence: "medium", reason: "y" },
      ],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(2);
    expect(ev.violations[0].detail).toContain("oldFn");
  });

  it("循环依赖规则 → 优先取后端 findings（ruleId 命中）", () => {
    const manifest = makeManifest([
      { id: "py-import-cycle", name: "循环导入检测", description: "x", severity: "warning", category: "metadata" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "src/a.py" } as any],
      findings: [
        { id: "fd1", analysisId: "a", ruleId: "py-import-cycle", targetId: "f1", targetType: "file", severity: "warning", message: "循环导入 a ↔ b", suggestion: null, status: "open", foundAt: 0, fixedAt: null, metadata: "" },
        { id: "fd2", analysisId: "a", ruleId: "py-import-cycle", targetId: "f1", targetType: "file", severity: "warning", message: "循环导入 a ↔ c", suggestion: null, status: "open", foundAt: 0, fixedAt: null, metadata: "" },
      ],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(2);
  });

  it("unsafe 规则 → 从 findings 提取", () => {
    const manifest = makeManifest([
      { id: "rs-unsafe", name: "unsafe 块检测", description: "x", severity: "critical", category: "metric" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "src/main.rs" } as any],
      findings: [
        { id: "fd1", analysisId: "a", ruleId: "rs-unsafe", targetId: "f1", targetType: "file", severity: "critical", message: "存在 unsafe 块", suggestion: null, status: "open", foundAt: 0, fixedAt: null, metadata: "" },
      ],
    };
    const [ev] = evaluatePluginRules(manifest, data);
    expect(ev.supported).toBe(true);
    expect(ev.violations).toHaveLength(1);
  });

  it("无 AST 度量时 → AST 类规则诚实标 unsupported（不假装执行）", () => {
    const manifest = makeManifest([
      { id: "ts-magic-number", name: "魔法数字检测", description: "x", severity: "info", category: "metadata" },
      { id: "ts-deep-nesting", name: "深层嵌套检测", description: "x", severity: "warning", category: "complexity" },
      { id: "ts-long-function", name: "超长函数检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    // heuristic 度量存在也不算数：engine 必须是 ast
    const data: RuleEngineData = { ...emptyData, fileMetrics: [fm()] };
    for (const ev of evaluatePluginRules(manifest, data)) {
      expect(ev.supported).toBe(false);
      expect(ev.unsupportedReason).toContain("AST");
      expect(ev.violations).toHaveLength(0);
    }
  });

  it("命名规范规则 → 始终 unsupported，原因不提 AST", () => {
    const manifest = makeManifest([
      { id: "ts-naming", name: "命名规范检测", description: "x", severity: "info", category: "metadata" },
    ]);
    const [ev] = evaluatePluginRules(manifest, emptyData);
    expect(ev.supported).toBe(false);
    expect(ev.unsupportedReason).toContain("命名规范");
  });
});

// ───────────────────────── R31：AST 度量驱动的规则 ─────────────────────────

describe("evaluatePluginRules · AST 规则", () => {
  const astMeta = JSON.stringify({
    language: "typescript",
    engine: "ast",
    functions: [
      { name: "handleRequest", line: 12, endLine: 140, lines: 129, cc: 31, params: 7, maxNesting: 6 },
      { name: "tiny", line: 200, endLine: 204, lines: 5, cc: 1, params: 1, maxNesting: 1 },
    ],
    magicNumbers: [
      { line: 20, value: "37", snippet: "if (retry > 37)" },
      { line: 44, value: "8640", snippet: "if (age > 8640)" },
    ],
  });

  const astData: RuleEngineData = {
    ...emptyData,
    files: [{ id: "f1", relPath: "src/server.ts" } as any],
    fileMetrics: [
      fm({
        filePath: "src/server.ts",
        engine: "ast",
        cyclomaticComplexity: 33,
        complexityLevel: "extreme",
        maxNesting: 6,
        functionCount: 2,
        maxFunctionCc: 31,
        hotFunction: "handleRequest",
        magicNumberCount: 2,
        metadata: astMeta,
      }),
    ],
  };

  it("魔法数字 → 真实执行并列出取值与行号", () => {
    const manifest = makeManifest([
      { id: "ts-magic-number", name: "魔法数字检测", description: "x", severity: "info", category: "metadata" },
    ]);
    const [ev] = evaluatePluginRules(manifest, astData);
    expect(ev.supported).toBe(true);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(2);
    expect(ev.violations[0].detail).toContain("37@L20");
  });

  it("深层嵌套 → 超阈值报违规并指到最深函数", () => {
    const manifest = makeManifest([
      { id: "ts-deep-nesting", name: "深层嵌套检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const [ev] = evaluatePluginRules(manifest, astData);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(6);
    expect(ev.violations[0].threshold).toBe(4);
    expect(ev.violations[0].detail).toContain("handleRequest");
  });

  it("超长函数 → 只算超阈值的那个，短函数不计入", () => {
    const manifest = makeManifest([
      { id: "ts-long-function", name: "超长函数检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const [ev] = evaluatePluginRules(manifest, astData);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(129);
    expect(ev.violations[0].detail).toContain("1 个函数超过 80 行");
  });

  it("参数过多 → 命中 7 个形参的函数", () => {
    const manifest = makeManifest([
      { id: "ts-too-many-params", name: "参数过多检测", description: "x", severity: "info", category: "metadata" },
    ]);
    const [ev] = evaluatePluginRules(manifest, astData);
    expect(ev.violations).toHaveLength(1);
    expect(ev.violations[0].value).toBe(7);
    expect(ev.violations[0].detail).toContain("handleRequest");
  });

  it("AST 时复杂度违规会附带最复杂函数（比「文件 CC 高」有用得多）", () => {
    const manifest = makeManifest([
      { id: "ts-complexity", name: "圈复杂度检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const [ev] = evaluatePluginRules(manifest, astData);
    expect(ev.violations[0].detail).toContain("handleRequest()");
    expect(ev.violations[0].detail).toContain("CC 31");
  });

  it("metadata 是脏数据时不崩，按 0 违规处理", () => {
    const manifest = makeManifest([
      { id: "ts-long-function", name: "超长函数检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const dirty: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "src/x.ts" } as any],
      fileMetrics: [fm({ engine: "ast", metadata: "{不是JSON" })],
    };
    const [ev] = evaluatePluginRules(manifest, dirty);
    expect(ev.supported).toBe(true);
    expect(ev.violations).toHaveLength(0);
  });

  it("空数据 → 已支持规则 0 违规，不抛异常", () => {
    const manifest = makeManifest([
      { id: "ts-complexity", name: "圈复杂度检测", description: "x", severity: "warning", category: "complexity" },
      { id: "ts-layering", name: "分层违规检测", description: "x", severity: "critical", category: "layering" },
    ]);
    const evals = evaluatePluginRules(manifest, emptyData);
    expect(evals.every((e) => e.violations.length === 0)).toBe(true);
  });
});

describe("summarizeRuleEvals", () => {
  it("聚合执行/违规/失败规则数", () => {
    const manifest = makeManifest([
      { id: "ts-complexity", name: "圈复杂度检测", description: "x", severity: "warning", category: "complexity" },
      { id: "ts-magic-number", name: "魔法数字检测", description: "x", severity: "info", category: "metadata" },
    ]);
    const data: RuleEngineData = {
      ...emptyData,
      files: [{ id: "f1", relPath: "a.ts" } as any],
      fileMetrics: [fm({ filePath: "a.ts", cyclomaticComplexity: 30, complexityLevel: "extreme" })],
    };
    const evals = evaluatePluginRules(manifest, data);
    const s = summarizeRuleEvals(evals);
    expect(s.total).toBe(2);
    expect(s.executed).toBe(1);
    expect(s.unsupported).toBe(1);
    expect(s.violationCount).toBe(1);
    expect(s.failingRules).toBe(1);
  });

  it("全部通过 → failingRules=0", () => {
    const manifest = makeManifest([
      { id: "ts-complexity", name: "圈复杂度检测", description: "x", severity: "warning", category: "complexity" },
    ]);
    const s = summarizeRuleEvals(evaluatePluginRules(manifest, emptyData));
    expect(s.executed).toBe(1);
    expect(s.violationCount).toBe(0);
    expect(s.failingRules).toBe(0);
  });
});
