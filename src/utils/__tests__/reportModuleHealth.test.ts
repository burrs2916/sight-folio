// project-sight: 报告生成器「模块依赖体检」单测
import { describe, it, expect } from "vitest";
import { buildModuleHealth } from "../reportGenerator";
import type { ProjectFile, CallEdge, ProjectSymbol, ProjectSymbolRef } from "../../services/tauri";

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

function edge(caller: string, callee: string, callerFile: string, calleeFile: string, kind = "cross-file"): CallEdge {
  return {
    id: `${caller}-${callee}`,
    analysisId: "a1",
    callerSymbolId: caller,
    callerName: caller,
    callerFileId: callerFile,
    callerFilePath: "",
    calleeSymbolId: callee,
    calleeName: callee,
    calleeFileId: calleeFile,
    calleeFilePath: "",
    lineNo: 1,
    kind,
    createdAt: 0,
  };
}

describe("buildModuleHealth（v2.5 报告模块依赖体检）", () => {
  it("聚合模块数/边数/跨模块调用/环，口径与画布一致", () => {
    const files = [
      makeFile("fa", "src/a.ts"),
      makeFile("fb", "src/b.ts"),
      makeFile("fc", "core/c.ts"),
      makeFile("fd", "core/d.ts"),
      makeFile("fe", "lib/e.ts"),
    ];
    const edges = [
      edge("s1", "s2", "fa", "fc"), // src → core
      edge("s3", "s4", "fb", "fd"), // src → core
      edge("s5", "s6", "fc", "fa"), // core → src（成环）
      edge("s7", "s8", "fe", "fa"), // lib → src
    ];
    const symbols = [
      { id: "symHub", name: "UserService", kind: "class", fileId: "fa", filePath: "src/a.ts" } as ProjectSymbol,
    ];
    const refs = [
      { id: "r1", analysisId: "a1", fromFileId: "fb", fromFilePath: "src/b.ts", toSymbolId: "symHub", toFileId: "fa", toFilePath: "src/a.ts", symbolName: "UserService", refLine: 1, refText: "import", kind: "import", createdAt: 0 } as ProjectSymbolRef,
    ];
    const h = buildModuleHealth(edges, files, symbols, refs);
    // 模块：src/core/lib 参与调用；边 4 条（src→core 聚合成 1 条）
    expect(h.moduleCount).toBe(3);
    expect(h.edgeCount).toBe(3); // src→core(2 合 1) + core→src + lib→src
    expect(h.crossMod).toBe(3);
    // src↔core 成环
    expect(h.cycleDirs).toContain("src");
    expect(h.cycleDirs).toContain("core");
    expect(h.cycleDirs).not.toContain("lib");
    // 枢纽：import 引用聚合，UserService 命中
    expect(h.hubs).toEqual([{ name: "UserService", n: 1 }]);
  });

  it("空调用图：零统计，环/枢纽为空", () => {
    const h = buildModuleHealth([], [makeFile("fa", "src/a.ts")], [], []);
    expect(h.moduleCount).toBe(0);
    expect(h.edgeCount).toBe(0);
    expect(h.cycleDirs.length).toBe(0);
    expect(h.hubs.length).toBe(0);
  });
});
