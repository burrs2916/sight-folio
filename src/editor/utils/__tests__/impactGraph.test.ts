import { describe, it, expect } from "vitest";
import {
  buildCallIndex,
  traverseImpact,
  analyzeImpact,
  analyzeFileImpact,
  impactLevelOf,
  impactCandidates,
  summarizeImpact,
} from "../impactGraph";
import type { CallEdge, ProjectSymbol } from "../../../services/tauri";

/** 造一条调用边：caller 调用 callee */
function edge(
  caller: string,
  callee: string,
  opts?: { callerFile?: string; calleeFile?: string; line?: number }
): CallEdge {
  const cf = opts?.callerFile ?? `f-${caller}`;
  const ef = opts?.calleeFile ?? `f-${callee}`;
  return {
    id: `${caller}->${callee}`,
    analysisId: "a1",
    callerSymbolId: caller,
    callerName: caller,
    callerFileId: cf,
    callerFilePath: `${cf}.ts`,
    calleeSymbolId: callee,
    calleeName: callee,
    calleeFileId: ef,
    calleeFilePath: `${ef}.ts`,
    lineNo: opts?.line ?? 1,
    kind: cf === ef ? "internal" : "cross-file",
    createdAt: 0,
  };
}

function sym(id: string, fileId: string, kind = "function", line = 1): ProjectSymbol {
  return {
    id,
    analysisId: "a1",
    fileId,
    filePath: `${fileId}.ts`,
    name: id,
    kind,
    lineStart: line,
    lineEnd: line + 5,
    signature: "",
    doc: null,
    modifiers: "",
    patterns: "",
    metadata: "",
    createdAt: 0,
  };
}

describe("buildCallIndex", () => {
  it("正反向邻接表与元信息都建起来", () => {
    const idx = buildCallIndex([edge("a", "b"), edge("c", "b")]);
    expect(idx.totalEdges).toBe(2);
    expect(idx.byCaller.get("a")).toHaveLength(1);
    expect(idx.byCallee.get("b")).toHaveLength(2);
    expect(idx.meta.get("b")?.filePath).toBe("f-b.ts");
  });

  it("跳过缺失符号 id 的脏边", () => {
    const bad = { ...edge("a", "b"), calleeSymbolId: "" };
    const idx = buildCallIndex([bad, edge("a", "c")]);
    expect(idx.totalEdges).toBe(2);
    expect(idx.byCaller.get("a")).toHaveLength(1);
  });
});

describe("traverseImpact 多跳传播", () => {
  // a → b → c → d 链式调用
  const chain = [edge("a", "b"), edge("b", "c"), edge("c", "d")];

  it("上游：找到调用我的人，depth 逐跳递增", () => {
    const idx = buildCallIndex(chain);
    const { nodes } = traverseImpact(idx, "d", "upstream", 3);
    expect(nodes.map((n) => `${n.name}@${n.depth}`)).toEqual(["c@1", "b@2", "a@3"]);
  });

  it("下游：找到我调用的人", () => {
    const idx = buildCallIndex(chain);
    const { nodes } = traverseImpact(idx, "a", "downstream", 3);
    expect(nodes.map((n) => n.name)).toEqual(["b", "c", "d"]);
  });

  it("携带 receiverTarget：影响面按接收者类型区分同名方法（joern 动态分派超近似会丢失）", () => {
    // root 同时调用 ClassA.foo 与 ClassB.foo（同名 foo，不同接收者类型）
    const e1 = { ...edge("root", "A.foo"), calleeName: "foo", receiverTarget: "ClassA" };
    const e2 = { ...edge("root", "B.foo"), calleeName: "foo", receiverTarget: "ClassB" };
    const idx = buildCallIndex([e1, e2]);
    const { nodes } = traverseImpact(idx, "root", "downstream", 3);
    const a = nodes.find((n) => n.symbolId === "A.foo");
    const b = nodes.find((n) => n.symbolId === "B.foo");
    expect(a?.receiverType).toBe("ClassA");
    expect(b?.receiverType).toBe("ClassB");
  });

  it("maxDepth 截断传播", () => {
    const idx = buildCallIndex(chain);
    const { nodes } = traverseImpact(idx, "d", "upstream", 1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("c");
  });

  it("记录 via 链路（经由谁传过来）", () => {
    const idx = buildCallIndex(chain);
    const { nodes } = traverseImpact(idx, "d", "upstream", 3);
    const a = nodes.find((n) => n.name === "a")!;
    expect(a.viaName).toBe("b");
  });

  it("调用环不会死循环，且标记 cyclic", () => {
    const idx = buildCallIndex([edge("a", "b"), edge("b", "c"), edge("c", "a")]);
    const { nodes, cyclic } = traverseImpact(idx, "a", "downstream", 10);
    expect(cyclic).toBe(true);
    expect(nodes.map((n) => n.name).sort()).toEqual(["b", "c"]);
  });

  it("自递归标记为环且不产生节点", () => {
    const idx = buildCallIndex([edge("a", "a")]);
    const { nodes, cyclic } = traverseImpact(idx, "a", "downstream", 3);
    expect(cyclic).toBe(true);
    expect(nodes).toHaveLength(0);
  });
});

describe("analyzeImpact 爆炸半径", () => {
  it("被三个不同文件调用 → 半径含 3 个文件", () => {
    const edges = [
      edge("x", "core", { callerFile: "f1" }),
      edge("y", "core", { callerFile: "f2" }),
      edge("z", "core", { callerFile: "f3" }),
    ];
    const r = analyzeImpact(edges, "core");
    expect(r.directCallers).toBe(3);
    expect(r.blastRadius.symbols).toBe(3);
    expect(r.blastRadius.files).toBe(3);
    expect(r.level).toBe("wide");
  });

  it("零调用者 → isolated 且摘要提示无人调用", () => {
    const r = analyzeImpact([edge("lonely", "helper")], "lonely");
    expect(r.upstream).toHaveLength(0);
    expect(r.level).toBe("isolated");
    expect(summarizeImpact(r)).toContain("无人调用");
  });

  it("按 depth 分层，索引 0 是直接调用者", () => {
    const r = analyzeImpact([edge("a", "b"), edge("b", "c")], "c", { maxDepth: 3 });
    expect(r.upstreamByDepth).toHaveLength(2);
    expect(r.upstreamByDepth[0][0].name).toBe("b");
    expect(r.upstreamByDepth[1][0].name).toBe("a");
  });

  it("符号表补全根节点的 kind 与路径（根不在调用图中时）", () => {
    const r = analyzeImpact([], "s1", { symbols: [sym("s1", "fA", "class")] });
    expect(r.rootName).toBe("s1");
    expect(r.rootKind).toBe("class");
    expect(r.rootFilePath).toBe("fA.ts");
    expect(r.affectedFileIds).toEqual(["fA"]);
  });

  it("超过 20 个调用者判为 critical", () => {
    const edges = Array.from({ length: 22 }, (_, i) =>
      edge(`c${i}`, "hub", { callerFile: `f${i}` })
    );
    expect(analyzeImpact(edges, "hub").level).toBe("critical");
  });
});

describe("impactLevelOf 阈值", () => {
  it.each([
    [0, 0, "isolated"],
    [3, 1, "local"],
    [6, 2, "wide"],
    [2, 3, "wide"],
    [20, 1, "critical"],
    [5, 8, "critical"],
  ])("符号 %i / 文件 %i → %s", (s, f, expected) => {
    expect(impactLevelOf(s as number, f as number)).toBe(expected);
  });
});

describe("analyzeFileImpact 文件级聚合", () => {
  it("聚合文件内所有符号的上下游，按符号数降序", () => {
    const edges = [
      // 目标文件 fT 内有两个符号 t1 / t2
      edge("u1", "t1", { callerFile: "fA", calleeFile: "fT" }),
      edge("u2", "t1", { callerFile: "fA", calleeFile: "fT" }),
      edge("u3", "t2", { callerFile: "fB", calleeFile: "fT" }),
      edge("t1", "d1", { callerFile: "fT", calleeFile: "fC" }),
    ];
    const r = analyzeFileImpact(edges, "fT");
    expect(r.activeSymbols).toBe(2);
    expect(r.affectedFiles.map((f) => f.fileId)).toEqual(["fA", "fB"]);
    expect(r.affectedFiles[0].symbolCount).toBe(2);
    expect(r.dependsOnFiles.map((f) => f.fileId)).toEqual(["fC"]);
    expect(r.blastRadius).toEqual({ symbols: 3, files: 2 });
  });

  it("文件内自调用不计入影响面", () => {
    const edges = [edge("t1", "t2", { callerFile: "fT", calleeFile: "fT" })];
    const r = analyzeFileImpact(edges, "fT");
    expect(r.affectedFiles).toHaveLength(0);
    expect(r.level).toBe("isolated");
  });

  it("不存在的文件返回空报告不抛错", () => {
    const r = analyzeFileImpact([edge("a", "b")], "nope");
    expect(r.activeSymbols).toBe(0);
    expect(r.affectedFiles).toHaveLength(0);
  });
});

describe("impactCandidates", () => {
  it("只挑可调用体并按定义行排序", () => {
    const symbols = [
      sym("fn2", "f1", "function", 30),
      sym("CONST", "f1", "const", 5),
      sym("fn1", "f1", "function", 10),
      sym("Other", "f2", "class", 1),
    ];
    expect(impactCandidates(symbols, "f1").map((s) => s.name)).toEqual(["fn1", "fn2"]);
  });
});
