import { describe, it, expect } from "vitest";
import { buildCommentHealthSection } from "../scanSectionBuilders";
import { countCommentedCode } from "../../../editor/utils/portraits";
import type { ScanSnapshot } from "../scanSections";

function snapshot(overrides: Partial<ScanSnapshot> = {}): ScanSnapshot {
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
    ...overrides,
  };
}

describe("buildCommentHealthSection（R42 注释卫生分节）", () => {
  it("聚合注释率分布与无 doc 符号", () => {
    const metric = (id: string, path: string, code: number, comment: number, cc: number, level: string) => ({
      id, analysisId: "a1", fileId: id, filePath: path, totalLines: code + comment, codeLines: code, commentLines: comment, blankLines: 0,
      cyclomaticComplexity: cc, complexityLevel: level, metadata: "", createdAt: 0, engine: "ast" as const, maxNesting: 0,
      functionCount: 1, maxFunctionCc: cc, hotFunction: "f", magicNumberCount: 0,
    });
    const s = snapshot({
      metrics: [
        metric("m1", "src/a.ts", 190, 10, 12, "high"),
        metric("m2", "src/b.ts", 100, 100, 3, "low"),
      ],
      symbols: [
        { id: "s1", analysisId: "a1", fileId: "f1", filePath: "src/a.ts", name: "run", kind: "function", lineStart: 1, lineEnd: 5, signature: "", doc: null, modifiers: "export", patterns: "", metadata: "", createdAt: 0 },
        { id: "s2", analysisId: "a1", fileId: "f1", filePath: "src/a.ts", name: "helper", kind: "function", lineStart: 6, lineEnd: 9, signature: "", doc: "有文档", modifiers: "export", patterns: "", metadata: "", createdAt: 0 },
      ],
    });
    const sec = buildCommentHealthSection(s);
    // a.ts 注释率 10/200=5%，b.ts 100/200=50%
    expect(sec.content).toContain("50%");
    // 无 doc 的导出符号被点名
    expect(sec.content).toContain("src/a.ts");
    expect(sec.facts?.lowCount).toBe(0); // a.ts 恰 5% 不 <5%，b.ts 健康
  });
});

describe("countCommentedCode（R42 注释掉的死代码检测）", () => {
  it("识别注释掉的代码行", () => {
    const lines = [
      "// if (user) {",
      "//   doSomething();",
      "// }",
      "const a = 1;",
    ];
    expect(countCommentedCode(lines)).toBe(3);
  });

  it("忽略文档型与中文说明注释", () => {
    const lines = [
      "// TODO 修复边界",
      "// 这里是中文说明",
      "// 增加缓存以提升性能",
      "const a = 1;",
    ];
    expect(countCommentedCode(lines)).toBe(0);
  });

  it("识别行尾代码式注释（含分号/大括号）", () => {
    const lines = [
      "// return null;",
      "// console.log(x);",
      "const a = 1;",
    ];
    expect(countCommentedCode(lines)).toBe(2);
  });
});
