import { describe, it, expect } from "vitest";
import {
  buildSymbolLayout,
  buildModuleDeps,
  buildInheritanceEdges,
  computeFileCohesion,
  detectModuleCycles,
  detectSymbolCycles,
  entityTypeForSymbolKind,
  pickHubSymbols,
  summarizeModuleDeps,
  MAX_DIRS,
  MAX_FILES_PER_DIR,
  MAX_SYMBOLS_PER_FILE,
} from "../symbolLayout";
import type { ProjectFile, ProjectSymbol, ProjectSymbolRef } from "../../../services/tauri";
import { hasLegacySymbolBands } from "../portraits";

function makeFile(id: string, relPath: string, language = "typescript"): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: relPath,
    relPath,
    name: relPath.split("/").pop() || id,
    extension: "ts",
    language,
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

function makeSymbol(id: string, fileId: string, name: string, kind: string, lineStart: number, filePath: string): ProjectSymbol {
  return {
    id,
    analysisId: "a1",
    fileId,
    filePath,
    name,
    kind,
    lineStart,
    lineEnd: lineStart + 5,
    signature: `${name}()`,
    doc: null,
    modifiers: "",
    patterns: "",
    metadata: "{}",
    createdAt: 0,
  };
}

function makeRef(id: string, toSymbolId: string | null): ProjectSymbolRef {
  return {
    id,
    analysisId: "a1",
    fromFileId: "f_other",
    fromFilePath: "other.ts",
    toSymbolId,
    toFileId: "f1",
    toFilePath: "a.ts",
    symbolName: "x",
    refLine: 1,
    refText: "import { x } from './a'",
    kind: "import",
    createdAt: 0,
  };
}

describe("entityTypeForSymbolKind", () => {
  it("精确映射 class/function/interface", () => {
    expect(entityTypeForSymbolKind("class")).toBe("class");
    expect(entityTypeForSymbolKind("function")).toBe("function");
    expect(entityTypeForSymbolKind("interface")).toBe("interface");
  });

  it("其余 kind 归并为 module 通用卡片（大小写不敏感）", () => {
    expect(entityTypeForSymbolKind("struct")).toBe("module");
    expect(entityTypeForSymbolKind("enum")).toBe("module");
    expect(entityTypeForSymbolKind("trait")).toBe("module");
    expect(entityTypeForSymbolKind("const")).toBe("module");
    expect(entityTypeForSymbolKind("module")).toBe("module");
    expect(entityTypeForSymbolKind("type_alias")).toBe("module");
    expect(entityTypeForSymbolKind("Class")).toBe("class");
  });
});

describe("buildSymbolLayout（目录横带 + 文件子带）", () => {
  const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "src/b.rs", "rust"), makeFile("f3", "src/dir.ts")];
  const symbols: ProjectSymbol[] = [
    makeSymbol("s1", "f1", "App", "class", 10, "src/a.ts"),
    makeSymbol("s2", "f1", "render", "function", 20, "src/a.ts"),
    makeSymbol("s3", "f1", "IProps", "interface", 30, "src/a.ts"),
    makeSymbol("s4", "f2", "Main", "struct", 5, "src/b.rs"),
  ];

  it("按目录分组：目录横带 + 文件子带 + 符号带业务字段", () => {
    const layout = buildSymbolLayout(symbols, [], files);
    // 目录横带
    const dirG = layout.groups.find((g) => g.level === "dir" && g.name === "src");
    expect(dirG).toBeDefined();
    expect(dirG?.renderedCount).toBe(4); // 该目录下全部 4 个符号
    // 文件子带
    expect(layout.groups.some((g) => g.level === "file" && g.name === "a.ts")).toBe(true);
    expect(layout.groups.some((g) => g.level === "file" && g.name === "b.rs")).toBe(true);
    // 符号
    expect(layout.nodes.length).toBe(4);
    expect(layout.summary.dirs).toBe(1);

    const app = layout.nodes.find((n) => n.name === "App");
    expect(app?.entityType).toBe("class");
    expect(app?.fileId).toBe("f1");
    expect(app?.lineStart).toBe(10);
    expect(app?.centrality).toBe(0); // 无引用 → 0
    // 符号相对所属文件头标缩进
    const fileG = layout.groups.find((g) => g.level === "file" && g.name === "a.ts")!;
    expect(app?.x).toBeGreaterThan(fileG.x);
  });

  it("引用计数聚合 + 承重归一化", () => {
    const refs = [makeRef("r1", "s1"), makeRef("r2", "s1"), makeRef("r3", null)];
    const layout = buildSymbolLayout(symbols, refs, files);
    const app = layout.nodes.find((n) => n.name === "App")!;
    expect(app.refCount).toBe(2);
    expect(layout.nodes.find((n) => n.name === "render")?.refCount).toBe(0);
    // 最大引用 2 → App centrality = 1，热力红
    expect(app.centrality).toBe(1);
    expect(app.centralityColor).toBe("#ef4444");
  });

  it("同文件符号按定义行号升序", () => {
    const layout = buildSymbolLayout(symbols, [], files);
    const aFile = layout.nodes.filter((n) => n.fileId === "f1");
    expect(aFile.map((n) => n.lineStart)).toEqual([10, 20, 30]);
  });

  it("上限截断：目录数 / 每目录文件数 / 每文件符号数 都限流并计入 truncated", () => {
    // 目录数上限：超过 MAX_DIRS 的目录只保留符号最多的前 MAX_DIRS 个
    const manyFiles = Array.from({ length: MAX_DIRS + 3 }, (_, i) => makeFile(`f${i}`, `m${i}/x.ts`));
    const manySymbols = manyFiles.map((f, i) => makeSymbol(`s_${i}`, f.id, `S${i}`, "class", 1, `m${i}/x.ts`));
    const layout = buildSymbolLayout(manySymbols, [], manyFiles);
    expect(layout.groups.filter((g) => g.level === "dir").length).toBe(MAX_DIRS);
    expect(layout.summary.dirs).toBe(MAX_DIRS);

    // 每文件符号数上限
    const hotSymbols = Array.from({ length: MAX_SYMBOLS_PER_FILE + 3 }, (_, i) =>
      makeSymbol(`h${i}`, "f1", `H${i}`, "function", i + 1, "src/a.ts")
    );
    const layout2 = buildSymbolLayout(hotSymbols, [], files);
    const f1Nodes = layout2.nodes.filter((n) => n.fileId === "f1");
    expect(f1Nodes.length).toBe(MAX_SYMBOLS_PER_FILE);
    expect(layout2.summary.truncated).toBe(3);

    // 每目录文件数上限（用单一目录塞很多文件）
    const manyFilesOneDir = Array.from({ length: MAX_FILES_PER_DIR + 4 }, (_, i) =>
      makeFile(`g${i}`, `p/x${i}.ts`)
    );
    const manySymsOneDir = manyFilesOneDir.map((f) => makeSymbol(`k${f.id}`, f.id, "C", "class", 1, `p/x${f.id.slice(1)}.ts`));
    const layout3 = buildSymbolLayout(manySymsOneDir, [], manyFilesOneDir);
    const pDir = layout3.groups.find((g) => g.level === "dir" && g.name === "p")!;
    expect(pDir.renderedCount).toBeLessThanOrEqual(MAX_FILES_PER_DIR * MAX_SYMBOLS_PER_FILE);
  });

  it("目录文件（isDirectory）不参与分组", () => {
    const dirFile: ProjectFile = { ...makeFile("fd", "src/"), isDirectory: true };
    const layout = buildSymbolLayout(
      [...symbols, makeSymbol("sd", "fd", "D", "class", 1, "src/")],
      [],
      [...files, dirFile]
    );
    // src 目录横带仍存在（由普通文件贡献），但目录符号被过滤
    expect(layout.groups.filter((g) => g.level === "dir" && g.name === "src")).toHaveLength(1);
    expect(layout.nodes.length).toBe(4);
  });

  it("坐标布局：目录横带 → 文件子带 → 符号，逐级向下、逐级右缩进", () => {
    const layout = buildSymbolLayout(symbols, [], files);
    const dirG = layout.groups.find((g) => g.level === "dir" && g.name === "src")!;
    const fileG = layout.groups.find((g) => g.level === "file" && g.name === "a.ts")!;
    const row0 = layout.nodes.find((n) => n.fileId === "f1" && n.lineStart === 10)!;
    expect(fileG.y).toBeGreaterThan(dirG.y + dirG.height); // 文件在目录下方
    expect(row0.y).toBeGreaterThan(fileG.y + fileG.height); // 符号在文件头标下方
    expect(row0.x).toBeGreaterThan(fileG.x); // 符号相对文件头标右缩进
  });
});

describe("结构体检三件套（v2.1）", () => {
  function files3() {
    return [
      makeFile("fa", "src/a.ts"),
      makeFile("fb", "src/b.ts"),
      makeFile("fc", "core/c.ts"),
      makeFile("fd", "core/d.ts"),
      makeFile("fx", "lib/x.ts"),
    ];
  }
  function edge(caller: string, callee: string, callerFile: string, calleeFile: string, kind = "cross-file") {
    return {
      callerSymbolId: caller,
      calleeSymbolId: callee,
      callerFileId: callerFile,
      calleeFileId: calleeFile,
      callerName: caller,
      calleeName: callee,
      kind,
    };
  }

  it("buildModuleDeps：跨模块调用聚合为 dir→dir，模块内部调用忽略", () => {
    const files = files3();
    const deps = buildModuleDeps(
      [
        edge("s1", "s2", "fa", "fc"), // src → core
        edge("s3", "s4", "fb", "fd"), // src → core
        edge("s5", "s6", "fa", "fx"), // src → lib
        edge("s7", "s8", "fa", "fb"), // src 内部（同模块）→ 忽略
        edge("s9", "s10", "fc", "fa"), // core → src（反向依赖）
      ],
      files
    );
    const key = (f: string, t: string) => deps.find((d) => d.fromDir === f && d.toDir === t);
    expect(key("src", "core")?.count).toBe(2);
    expect(key("src", "lib")?.count).toBe(1);
    expect(key("core", "src")?.count).toBe(1);
    expect(deps.some((d) => d.fromDir === "src" && d.toDir === "src")).toBe(false);
  });

  it("summarizeModuleDeps：出/入依赖计数", () => {
    const deps = buildModuleDeps(
      [
        edge("s1", "s2", "fa", "fc"),
        edge("s3", "s4", "fa", "fc"),
        edge("s5", "s6", "fc", "fx"),
      ],
      files3()
    );
    const m = summarizeModuleDeps(deps);
    expect(m.get("src")).toEqual({ out: 2, in: 0 });
    expect(m.get("core")).toEqual({ out: 1, in: 2 });
    expect(m.get("lib")).toEqual({ out: 0, in: 1 });
  });

  it("detectSymbolCycles：A→B→C→A 标环，链式调用不标", () => {
    const nodes = [
      makeNode("s1", "src/a.ts"), makeNode("s2", "src/b.ts"),
      makeNode("s3", "core/c.ts"), makeNode("s4", "core/d.ts"),
    ];
    const cyc = detectSymbolCycles(nodes, [
      edge("s1", "s2", "fa", "fb"),
      edge("s2", "s3", "fb", "fc"),
      edge("s3", "s1", "fc", "fa"), // 闭环
      edge("s1", "s4", "fa", "fd"), // 链式，不进环
    ]);
    expect(cyc.cycleSymbolIds.has("s1")).toBe(true);
    expect(cyc.cycleSymbolIds.has("s2")).toBe(true);
    expect(cyc.cycleSymbolIds.has("s3")).toBe(true);
    expect(cyc.cycleSymbolIds.has("s4")).toBe(false);
    // 环上符号所属目录：src、core
    expect(cyc.cycleDirs).toContain("src");
    expect(cyc.cycleDirs).toContain("core");
  });

  it("detectSymbolCycles：无环时集合为空", () => {
    const nodes = [makeNode("s1", "src/a.ts"), makeNode("s2", "src/b.ts")];
    const cyc = detectSymbolCycles(nodes, [edge("s1", "s2", "fa", "fb")]);
    expect(cyc.cycleSymbolIds.size).toBe(0);
    expect(cyc.cycleDirs.length).toBe(0);
  });

  it("pickHubSymbols：按 refCount 取前 N 且排除零引用", () => {
    const nodes = [
      { ...makeNode("s1", "src/a.ts"), refCount: 5 },
      { ...makeNode("s2", "src/b.ts"), refCount: 20 },
      { ...makeNode("s3", "core/c.ts"), refCount: 8 },
      { ...makeNode("s4", "core/d.ts"), refCount: 0 },
    ];
    const hubs = pickHubSymbols(nodes, 2);
    expect(hubs).toEqual(["s2", "s3"]);
  });

  it("buildSymbolLayout 传入 callEdges 后 summary 携带体检三件套", () => {
    const files = files3();
    const symbols = [
      makeSymbol("s1", "fa", "fnA", "function", 1, "src/a.ts"),
      makeSymbol("s2", "fb", "fnB", "function", 1, "src/b.ts"),
      makeSymbol("s3", "fc", "ClsC", "class", 1, "core/c.ts"),
      makeSymbol("s4", "fd", "fnD", "function", 1, "core/d.ts"),
    ];
    const layout = buildSymbolLayout(symbols, [], files, [
      edge("s1", "s2", "fa", "fb"),
      edge("s2", "s3", "fb", "fc"),
      edge("s3", "s1", "fc", "fa"),
    ]);
    expect(layout.summary.moduleDeps.length).toBeGreaterThan(0);
    expect(layout.summary.cycleDirs).toContain("src");
    expect(layout.summary.hubSymbolIds).toBeInstanceOf(Array);
  });
});

// v2.1 测试辅助：最小 SymbolNode
function makeNode(id: string, filePath: string) {
  return {
    symbolId: id,
    entityType: "function",
    name: id,
    symbolKind: "function",
    fileId: id,
    fileName: filePath.split("/").pop() || id,
    filePath,
    lineStart: 1,
    lineEnd: 5,
    signature: "",
    refCount: 0,
    centrality: 0,
    centralityColor: "#22c55e",
    x: 0,
    y: 0,
    width: 140,
    height: 84,
  };
}

describe("buildInheritanceEdges（v2.2 继承连线）", () => {
  function inheritRef(sig: { fromPath: string; line: number; parent: string; kind: string; toSymbolId?: string | null }) {
    return {
      id: "r1",
      analysisId: "a1",
      fromFileId: "ff",
      fromFilePath: sig.fromPath,
      toSymbolId: sig.toSymbolId ?? null,
      toFileId: "tf",
      toFilePath: "target.ts",
      symbolName: sig.parent,
      refLine: sig.line,
      refText: "class A extends B",
      kind: sig.kind,
      createdAt: 0,
    };
  }

  const nodes = [
    { ...makeNode("c1", "src/a.ts"), name: "Base", lineStart: 10, lineEnd: 60, refCount: 9 },
    { ...makeNode("c2", "src/b.ts"), name: "ChildA", lineStart: 5, lineEnd: 40, refCount: 1 },
    { ...makeNode("c3", "src/c.ts"), name: "ChildB", lineStart: 7, lineEnd: 30, refCount: 0 },
  ];

  it("extends 边：from=声明行符号，to=父类同名符号，kind 透传", () => {
    const edges = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/b.ts", line: 5, parent: "Base", kind: "extends" }),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].fromSymbolId).toBe("c2");
    expect(edges[0].toSymbolId).toBe("c1");
    expect(edges[0].kind).toBe("extends");
    expect(edges[0].config.depType).toBe("inherits");
  });

  it("implements 边：虚线实现关系同样成边", () => {
    const edges = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/c.ts", line: 7, parent: "Base", kind: "implements" }),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("implements");
  });

  it("toSymbolId 直接命中优先；两端不在画布或自继承跳过", () => {
    // toSymbolId 命中（即使符号名不同也画）
    const e1 = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/b.ts", line: 5, parent: "RenamedBase", kind: "extends", toSymbolId: "c1" }),
    ]);
    expect(e1).toHaveLength(1);
    expect(e1[0].toSymbolId).toBe("c1");
    // 自继承跳过
    const e2 = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/b.ts", line: 5, parent: "ChildA", kind: "extends" }),
    ]);
    expect(e2).toHaveLength(0);
    // from 不在画布（行不匹配）跳过
    const e3 = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/b.ts", line: 999, parent: "Base", kind: "extends" }),
    ]);
    expect(e3).toHaveLength(0);
  });

  it("import kind 不产生继承边（refCount 过滤也保证 hub 口径干净）", () => {
    const edges = buildInheritanceEdges(nodes, [
      inheritRef({ fromPath: "src/b.ts", line: 5, parent: "Base", kind: "import" }),
    ]);
    expect(edges).toHaveLength(0);
  });
});

describe("computeFileCohesion（v2.2 文件内聚度）", () => {
  it("纯文件内调用 → 内聚 100%；纯跨文件调用 → 0%", () => {
    const nodes = [
      { ...makeNode("s1", "src/a.ts"), fileId: "fa" },
      { ...makeNode("s2", "src/a.ts"), fileId: "fa" },
      { ...makeNode("s3", "src/b.ts"), fileId: "fb" },
      { ...makeNode("s4", "src/b.ts"), fileId: "fb" },
    ];
    const edges = [
      { callerSymbolId: "s1", calleeSymbolId: "s2", callerFileId: "fa", calleeFileId: "fa", callerName: "s1", calleeName: "s2", kind: "internal" },
      { callerSymbolId: "s3", calleeSymbolId: "s4", callerFileId: "fb", calleeFileId: "fb", callerName: "s3", calleeName: "s4", kind: "internal" },
    ];
    const m = computeFileCohesion(nodes, edges);
    expect(m.get("fa")).toMatchObject({ internal: 1, external: 0, ratio: 1, participated: true });
    // 跨文件调用：fa → fb
    const cross = [
      { callerSymbolId: "s1", calleeSymbolId: "s3", callerFileId: "fa", calleeFileId: "fb", callerName: "s1", calleeName: "s3", kind: "cross-file" },
    ];
    const m2 = computeFileCohesion(nodes, cross);
    expect(m2.get("fa")).toMatchObject({ internal: 0, external: 1, ratio: 0, participated: true });
    expect(m2.get("fb")).toMatchObject({ internal: 0, external: 1, ratio: 0, participated: true });
  });

  it("混合调用：ratio = 内部 / 全部；未参与调用不计徽标", () => {
    const nodes = [
      { ...makeNode("s1", "src/a.ts"), fileId: "fa" },
      { ...makeNode("s2", "src/a.ts"), fileId: "fa" },
      { ...makeNode("s3", "src/b.ts"), fileId: "fb" },
      { ...makeNode("s4", "src/c.ts"), fileId: "fc" },
    ];
    const edges = [
      { callerSymbolId: "s1", calleeSymbolId: "s2", callerFileId: "fa", calleeFileId: "fa", callerName: "s1", calleeName: "s2", kind: "internal" },
      { callerSymbolId: "s1", calleeSymbolId: "s3", callerFileId: "fa", calleeFileId: "fb", callerName: "s1", calleeName: "s3", kind: "cross-file" },
    ];
    const m = computeFileCohesion(nodes, edges);
    expect(m.get("fa")?.ratio).toBeCloseTo(0.5);
    expect(m.get("fa")?.participated).toBe(true);
    // fc 未参与任何调用
    expect(m.get("fc")?.participated).toBe(false);
    expect(m.get("fc")?.ratio).toBe(0);
  });

  it("两端符号不在画布文件的调用不计入（截断符号不算）", () => {
    const nodes = [{ ...makeNode("s1", "src/a.ts"), fileId: "fa" }];
    const edges = [
      { callerSymbolId: "s1", calleeSymbolId: "x", callerFileId: "fa", calleeFileId: "fx", callerName: "s1", calleeName: "x", kind: "cross-file" },
    ];
    const m = computeFileCohesion(nodes, edges);
    expect(m.get("fa")?.participated).toBe(false);
  });
});

describe("截断按重要性（v2.3）", () => {
  it("高引用的行号靠后符号在截断时被保留（行序截断会误杀核心符号）", () => {
    // 8 个上限 + 3 个超限；核心符号 Core 行号最靠后但 refCount 最高
    const syms = [
      ...Array.from({ length: MAX_SYMBOLS_PER_FILE + 2 }, (_, i) =>
        makeSymbol(`z${i}`, "f1", `Z${i}`, "function", i + 1, "src/a.ts")
      ),
      makeSymbol("core", "f1", "Core", "class", 999, "src/a.ts"),
    ];
    const refs = Array.from({ length: 50 }, (_, i) =>
      makeRef(`ref${i}`, "core")
    );
    const layout = buildSymbolLayout(syms, refs, [makeFile("f1", "src/a.ts")]);
    const f1Nodes = layout.nodes.filter((n) => n.fileId === "f1");
    // 截断后核心符号必须在
    expect(f1Nodes.some((n) => n.symbolId === "core")).toBe(true);
    // 且排在网格首位（重要度序）
    expect(f1Nodes[0].symbolId).toBe("core");
    expect(layout.summary.truncated).toBe(MAX_SYMBOLS_PER_FILE + 2 - (MAX_SYMBOLS_PER_FILE - 1));
  });

  it("同引用数时保持行序（排序稳定）", () => {
    const syms = [
      makeSymbol("a", "f1", "A", "function", 1, "src/a.ts"),
      makeSymbol("b", "f1", "B", "function", 5, "src/a.ts"),
      makeSymbol("c", "f1", "C", "function", 10, "src/a.ts"),
    ];
    const layout = buildSymbolLayout(syms, [], [makeFile("f1", "src/a.ts")]);
    const f1Nodes = layout.nodes.filter((n) => n.fileId === "f1");
    expect(f1Nodes.map((n) => n.symbolId)).toEqual(["a", "b", "c"]);
  });
});

describe("画像内符号过滤（v2.3）", () => {
  const syms = [
    makeSymbol("s1", "f1", "UserService", "class", 1, "src/a.ts"),
    makeSymbol("s2", "f1", "fetchProfile", "function", 5, "src/a.ts"),
    makeSymbol("s3", "f1", "buildThing", "function", 10, "src/a.ts"),
    makeSymbol("s4", "f2", "Other", "class", 1, "core/b.ts"),
  ];
  const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "core/b.ts")];

  it("query 子串过滤：只布局命中符号，未命中目录/文件不出现", () => {
    const layout = buildSymbolLayout(syms, [], files, [], { query: "user" });
    const ids = layout.nodes.map((n) => n.symbolId);
    expect(ids).toContain("s1"); // UserService
    expect(ids).not.toContain("s2"); // fetchUser
    expect(ids).not.toContain("s4"); // Other（src/b.ts 整个文件无命中）
    // 只保留有命中的文件子带与目录横带
    expect(layout.groups.some((g) => g.level === "file" && g.name === "b.ts")).toBe(false);
    expect(layout.groups.some((g) => g.level === "dir" && g.name === "core")).toBe(false);
    expect(layout.groups.some((g) => g.level === "dir" && g.name === "src")).toBe(true);
  });

  it("kind 过滤：只保留指定 kind", () => {
    const layout = buildSymbolLayout(syms, [], files, [], { kinds: ["class"] });
    const ids = layout.nodes.map((n) => n.symbolId);
    expect(ids).toEqual(["s1", "s4"]);
  });

  it("query 与 kinds 同时过滤（AND）", () => {
    const layout = buildSymbolLayout(syms, [], files, [], { query: "s", kinds: ["class"] });
    const ids = layout.nodes.map((n) => n.symbolId);
    expect(ids).toEqual(["s1"]); // UserService 含 's' 且 class；Other 不含 's'
  });

  it("空 filter / 空 query 不过滤（全量）", () => {
    const layout = buildSymbolLayout(syms, [], files, [], { query: "" });
    expect(layout.nodes.length).toBe(4);
  });
});

describe("detectModuleCycles（v2.3 模块级环）", () => {
  it("A→B→C→A 成环；链式不成环", () => {
    const deps = [
      { fromDir: "a", toDir: "b", count: 1, crossFile: false },
      { fromDir: "b", toDir: "c", count: 1, crossFile: false },
      { fromDir: "c", toDir: "a", count: 1, crossFile: false }, // 闭环
      { fromDir: "a", toDir: "x", count: 1, crossFile: false }, // 链式
    ];
    const cyc = detectModuleCycles(deps as any);
    expect(cyc.has("a")).toBe(true);
    expect(cyc.has("b")).toBe(true);
    expect(cyc.has("c")).toBe(true);
    expect(cyc.has("x")).toBe(false);
  });

  it("无环返回空集；自环不算结构环", () => {
    const cyc1 = detectModuleCycles([
      { fromDir: "a", toDir: "b", count: 1, crossFile: false },
    ] as any);
    expect(cyc1.size).toBe(0);
    const cyc2 = detectModuleCycles([
      { fromDir: "a", toDir: "a", count: 3, crossFile: false },
    ] as any);
    expect(cyc2.size).toBe(0);
  });
});

describe("目录层级树（v2.12）", () => {
  it("多层路径拆段：完整父链横带 + name 取最后一段 + path 完整 + depth 递增", () => {
    const files = [
      makeFile("f1", "src-tauri/src/app/cms_service.rs"),
      makeFile("f2", "src-tauri/src/app/db.rs"),
    ];
    const syms = [
      makeSymbol("s1", "f1", "CmsService", "class", 1, "src-tauri/src/app/cms_service.rs"),
      makeSymbol("s2", "f1", "load", "method", 10, "src-tauri/src/app/cms_service.rs"),
      makeSymbol("s3", "f2", "connect", "function", 1, "src-tauri/src/app/db.rs"),
    ];
    const layout = buildSymbolLayout(syms, [], files, []);
    // 三层横带：src-tauri(0) → src(1) → app(2)，中间目录无 ownFiles 也有横带
    const root = layout.groups.find((g) => g.level === "dir" && g.name === "src-tauri")!;
    const mid = layout.groups.find((g) => g.level === "dir" && g.name === "src")!;
    const leaf = layout.groups.find((g) => g.level === "dir" && g.name === "app")!;
    expect(root).toBeTruthy();
    expect(mid).toBeTruthy();
    expect(leaf).toBeTruthy();
    expect(root.depth).toBe(0);
    expect(mid.depth).toBe(1);
    expect(leaf.depth).toBe(2);
    // name 是最后一段，path 是完整路径
    expect(root.name).toBe("src-tauri");
    expect(root.path).toBe("src-tauri");
    expect(leaf.name).toBe("app");
    expect(leaf.path).toBe("src-tauri/src/app");
    // topDir 一律是顶层模块
    expect(leaf.topDir).toBe("src-tauri");
    // 层级缩进：子目录 x 右移
    expect(mid.x).toBeGreaterThan(root.x);
    expect(leaf.x).toBeGreaterThan(mid.x);
    // 目录全量符号数（子树聚合）与画布渲染数
    expect(leaf.symbolCount).toBe(3);
    expect(leaf.renderedCount).toBe(3);
  });

  it("文件子带带完整路径（同名文件可辨）+ 符号相对目录缩进", () => {
    const files = [
      makeFile("f1", "src/a/logger.ts"),
      makeFile("f2", "src/b/logger.ts"),
    ];
    const syms = [
      makeSymbol("s1", "f1", "logA", "function", 1, "src/a/logger.ts"),
      makeSymbol("s2", "f2", "logB", "function", 1, "src/b/logger.ts"),
    ];
    const layout = buildSymbolLayout(syms, [], files, []);
    const g1 = layout.groups.find((g) => g.level === "file" && g.name === "logger.ts" && g.path === "src/a/logger.ts");
    const g2 = layout.groups.find((g) => g.level === "file" && g.name === "logger.ts" && g.path === "src/b/logger.ts");
    expect(g1).toBeTruthy();
    expect(g2).toBeTruthy();
    // 符号 x 在文件子带 x 右侧（层级缩进 + SYM_INDENT）
    const n1 = layout.nodes.find((n) => n.name === "logA")!;
    expect(n1.x).toBeGreaterThan(g1!.x);
  });

  it("总目录横带不超 MAX_DIR_BANDS（超限裁整棵较次要子树）", () => {
    const files: ProjectFile[] = [];
    const syms: ProjectSymbol[] = [];
    // 20 个顶层目录 × 每目录 1 个文件 2 个符号
    for (let i = 0; i < 20; i++) {
      const fid = `f${i}`;
      files.push(makeFile(fid, `mod${i}/a.ts`));
      syms.push(makeSymbol(`s${i}a`, fid, `FnA${i}`, "function", 1, `mod${i}/a.ts`));
      syms.push(makeSymbol(`s${i}b`, fid, `FnB${i}`, "function", 5, `mod${i}/a.ts`));
    }
    const layout = buildSymbolLayout(syms, [], files, []);
    expect(layout.groups.filter((g) => g.level === "dir").length).toBeLessThanOrEqual(20);
    expect(layout.groups.filter((g) => g.level === "dir").length).toBeGreaterThan(0);
    // 顶层只取符号最多的前 MAX_DIRS
    const topNames = layout.groups.filter((g) => g.level === "dir" && g.depth === 0).map((g) => g.name);
    expect(topNames.length).toBeLessThanOrEqual(MAX_DIRS);
    expect(topNames[0]).toBe("mod0"); // 全对称时按插入序稳定
  });
});

describe("目录层级树 · 根目录边界（v2.12）", () => {
  it("文件直接在项目根：目录横带显示 (root)，不产生空名", () => {
    const files = [makeFile("f1", "vite.config.ts")];
    const syms = [makeSymbol("s1", "f1", "defineConfig", "function", 1, "vite.config.ts")];
    const layout = buildSymbolLayout(syms, [], files, []);
    const root = layout.groups.find((g) => g.level === "dir")!;
    expect(root).toBeTruthy();
    expect(root.name).toBe("(root)");
    expect(root.depth).toBe(0);
    expect(layout.groups.filter((g) => g.level === "dir")).toHaveLength(1);
  });
});

describe("hasLegacySymbolBands（v2.12 旧版横带迁移检测）", () => {
  it("旧版 `a/b 符号` 模板命中（目录/文件横带）", () => {
    expect(
      hasLegacySymbolBands([
        { type: "layer-marker", config: { layerName: "目录 src-tauri/src/app · 40/135 符号" } },
      ])
    ).toBe(true);
    expect(
      hasLegacySymbolBands([
        { type: "layer-marker", config: { layerName: "licensing.ts · 3/3 符号" } },
      ])
    ).toBe(true);
  });

  it("新版 `符号 · 画布` 副行不命中；非 marker / 无 layerName 不命中", () => {
    expect(
      hasLegacySymbolBands([
        { type: "layer-marker", config: { layerName: "licensing.ts", subtitle: "src/features/licensing/licensing.ts · 3 符号 · 画布 3" } },
      ])
    ).toBe(false);
    expect(hasLegacySymbolBands([{ type: "file", config: { layerName: "a.ts · 3/3 符号" } }])).toBe(false);
    expect(hasLegacySymbolBands([{ type: "layer-marker", config: {} }])).toBe(false);
    expect(hasLegacySymbolBands([])).toBe(false);
  });
});

describe("buildSymbolLayout scope（v2.13 层级钻取裁剪）", () => {
  const files = [
    makeFile("f1", "src-tauri/src/app/cms.rs"),
    makeFile("f2", "src-tauri/src/app/db.rs"),
    makeFile("f3", "web/panel/panel.ts"),
  ];
  const syms = [
    makeSymbol("s1", "f1", "Cms", "class", 1, "src-tauri/src/app/cms.rs"),
    makeSymbol("s2", "f2", "Db", "class", 1, "src-tauri/src/app/db.rs"),
    makeSymbol("s3", "f3", "Panel", "class", 1, "web/panel/panel.ts"),
  ];

  it("scope.moduleDir 只保留该顶层目录子树", () => {
    const layout = buildSymbolLayout(syms, [], files, [], undefined, { moduleDir: "src-tauri" });
    const names = layout.nodes.map((n) => n.name);
    expect(names).toContain("Cms");
    expect(names).toContain("Db");
    expect(names).not.toContain("Panel");
    // 目录树收缩到该模块内（app 横带存在，web 横带不存在）
    expect(layout.groups.some((g) => g.level === "dir" && g.name === "app")).toBe(true);
    expect(layout.groups.some((g) => g.level === "dir" && g.name === "web")).toBe(false);
  });

  it("scope.fileId 只保留单文件符号", () => {
    const layout = buildSymbolLayout(syms, [], files, [], undefined, {
      moduleDir: "src-tauri",
      fileId: "f1",
    });
    const names = layout.nodes.map((n) => n.name);
    expect(names).toEqual(["Cms"]);
    expect(layout.groups.filter((g) => g.level === "file")).toHaveLength(1);
  });
});
