import { describe, it, expect } from "vitest";
import {
  topDirOf,
  buildModuleGraph,
  findCycles,
  zoneOf,
  computeModuleCoupling,
  computeArchitectureHealth,
  ZONE_LABEL,
} from "../architectureMetrics";
import type {
  ProjectFile,
  ProjectDependency,
  ProjectSymbol,
} from "../../../services/tauri";

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

const dep = (
  id: string,
  fromId: string,
  toId: string,
  isCircular = false
): ProjectDependency => ({
  id,
  analysisId: "a1",
  fromId,
  fromType: "file",
  toId,
  toType: "file",
  kind: "import",
  lineNo: null,
  isCircular,
  weight: 1,
  metadata: "{}",
  detectedAt: 1,
});

const sym = (
  id: string,
  fileId: string,
  filePath: string,
  kind: string
): ProjectSymbol => ({
  id,
  analysisId: "a1",
  fileId,
  filePath,
  name: `${kind}-${id}`,
  kind,
  lineStart: 1,
  lineEnd: 2,
  signature: "",
  doc: null,
  modifiers: "",
  patterns: "[]",
  metadata: "{}",
  createdAt: 1,
});

describe("topDirOf", () => {
  it("取顶层目录名作为模块口径", () => {
    expect(topDirOf("src/foo/bar.ts")).toBe("src");
    expect(topDirOf("auth/login.ts")).toBe("auth");
  });
  it("无斜杠时归到 root", () => {
    expect(topDirOf("index.ts")).toBe("root");
  });
});

describe("buildModuleGraph", () => {
  it("把文件级依赖聚合成模块级跨模块边，并统计文件数", () => {
    const files = [
      file("f1", "auth/login.ts"),
      file("f2", "auth/guard.ts"),
      file("f3", "store/user.ts"),
    ];
    const deps = [
      dep("d1", "f1", "f3"), // auth -> store
      dep("d2", "f2", "f1"), // auth 内部，不计耦合
      dep("d3", "f3", "f1"), // store -> auth
    ];
    const g = buildModuleGraph(files, deps);
    const names = g.nodes.map((n) => n.name).sort();
    expect(names).toEqual(["auth", "store"]);
    const auth = g.nodes.find((n) => n.name === "auth")!;
    expect(auth.fileCount).toBe(2);
    // 仅 1 条跨模块边（auth->store），store->auth 是另一条
    expect(g.edges.length).toBe(2);
    const cross = g.edges.find((e) => e.from === "auth" && e.to === "store")!;
    expect(cross.weight).toBe(1);
  });

  it("过滤外部依赖（不在 files 里的 toId）", () => {
    const files = [file("f1", "auth/login.ts")];
    const deps = [dep("d1", "f1", "external:react")];
    const g = buildModuleGraph(files, deps);
    expect(g.edges.length).toBe(0);
  });
});

describe("findCycles (Tarjan SCC)", () => {
  it("发现三元环并整条挖出，节点按字典序", () => {
    const nodes = ["a", "b", "c"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    const cycles = findCycles(nodes, edges);
    expect(cycles.length).toBe(1);
    expect(cycles[0].size).toBe(3);
    expect([...cycles[0].nodes].sort()).toEqual(["a", "b", "c"]);
    expect(cycles[0].edgeCount).toBe(3);
  });

  it("二元环与独立链区分", () => {
    const nodes = ["a", "b", "c", "d"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" }, // 二元环
      { from: "c", to: "d" }, // 无环
    ];
    const cycles = findCycles(nodes, edges);
    expect(cycles.length).toBe(1);
    expect(cycles[0].nodes.sort()).toEqual(["a", "b"]);
  });

  it("无环时返回空", () => {
    const nodes = ["a", "b", "c"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ];
    expect(findCycles(nodes, edges).length).toBe(0);
  });

  it("自环单独成环（模块聚合口径）", () => {
    const nodes = ["a", "b"];
    const edges = [
      { from: "a", to: "a" },
      { from: "a", to: "b" },
    ];
    const cycles = findCycles(nodes, edges);
    expect(cycles.length).toBe(1);
    expect(cycles[0].nodes).toEqual(["a"]);
    expect(cycles[0].size).toBe(1);
  });

  it("多环按大小降序排序，结果确定", () => {
    const nodes = ["a", "b", "c", "d", "e"];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" }, // 二元环
      { from: "c", to: "d" },
      { from: "d", to: "e" },
      { from: "e", to: "c" }, // 三元环
    ];
    const cycles = findCycles(nodes, edges);
    expect(cycles.map((c) => c.size)).toEqual([3, 2]);
  });
});

describe("zoneOf", () => {
  it("主序附近：D 小", () => {
    expect(zoneOf(0.5, 0.5)).toBe("mainSequence"); // D = |1-1| = 0
    expect(zoneOf(0.2, 0.8)).toBe("mainSequence"); // D = 0
  });
  it("痛苦区：低抽象 + 低不稳定且偏离主序", () => {
    // A=0.1, I=0.1 → D=|0.2-1|=0.8 > 0.45, I<0.5
    expect(zoneOf(0.1, 0.1)).toBe("painful");
  });
  it("无用区：高抽象 + 高不稳定且偏离主序", () => {
    // A=0.9, I=0.9 → D=0.8 > 0.45, I>=0.5
    expect(zoneOf(0.9, 0.9)).toBe("useless");
  });
  it("阈值边界：D=0.45 仍算主序附近", () => {
    expect(zoneOf(0.25, 0.3)).toBe("mainSequence"); // D=|0.55-1|=0.45
  });
});

describe("computeModuleCoupling", () => {
  it("计算 Ca/Ce/I/A/D/zone", () => {
    // auth 依赖 store；ui 仅依赖 auth
    const files = [
      file("f1", "auth/login.ts"),
      file("f2", "store/user.ts"),
      file("f3", "ui/page.ts"),
    ];
    const deps = [dep("d1", "f1", "f2"), dep("d2", "f3", "f1")];
    const g = buildModuleGraph(files, deps);
    const symbols = [
      sym("s1", "f2", "store/user.ts", "interface"), // store 抽象
      sym("s2", "f1", "auth/login.ts", "function"),
      sym("s3", "f3", "ui/page.ts", "class"),
    ];
    const coupling = computeModuleCoupling(g, symbols);
    const byName = Object.fromEntries(coupling.map((c) => [c.name, c]));

    // store 被 auth 依赖 → ca=1, ce=0, I=0
    expect(byName.store.ca).toBe(1);
    expect(byName.store.ce).toBe(0);
    expect(byName.store.instability).toBe(0);
    expect(byName.store.abstractness).toBe(1); // 1 个 interface / 1 个 symbol
    // ui 依赖 auth → ce=1, ca=0, I=1
    expect(byName.ui.ca).toBe(0);
    expect(byName.ui.ce).toBe(1);
    expect(byName.ui.instability).toBe(1);
    expect(byName.ui.abstractness).toBe(0);
    // auth 依赖 store 且被 ui 依赖 → ca=1, ce=1, I=0.5
    expect(byName.auth.ca).toBe(1);
    expect(byName.auth.ce).toBe(1);
    expect(byName.auth.instability).toBeCloseTo(0.5, 6);
  });

  it("标记落入循环依赖环的模块", () => {
    const files = [file("f1", "auth/a.ts"), file("f2", "store/b.ts")];
    const deps = [dep("d1", "f1", "f2"), dep("d2", "f2", "f1")];
    const g = buildModuleGraph(files, deps);
    const cycles = findCycles(
      g.nodes.map((n) => n.name),
      g.edges
    );
    const coupling = computeModuleCoupling(g, [], cycles);
    expect(coupling.every((c) => c.inCycle)).toBe(true);
  });
});

describe("computeArchitectureHealth", () => {
  it("无问题数据给出满分 A", () => {
    const health = computeArchitectureHealth({
      coupling: [],
      cycles: [],
      highComplexityFiles: 0,
      totalFiles: 10,
      techDebtCount: 0,
      totalLines: 1000,
      deadSymbolCount: 0,
      totalSymbols: 50,
    });
    expect(health.score).toBe(100);
    expect(health.grade).toBe("A");
    expect(health.cycleCount).toBe(0);
    expect(health.deductions).toHaveLength(5);
  });

  it("三元环按 size 扣分（封顶 16），并计入循环模块数", () => {
    const cycles = [
      { nodes: ["a", "b", "c"], size: 3, edgeCount: 3, weight: 3 },
    ];
    const health = computeArchitectureHealth({
      coupling: [],
      cycles,
      highComplexityFiles: 0,
      totalFiles: 10,
      techDebtCount: 0,
      totalLines: 1000,
      deadSymbolCount: 0,
      totalSymbols: 50,
    });
    const cycleDeduction = health.deductions.find((d) => d.key === "cycles")!;
    expect(cycleDeduction.points).toBe(12); // min(4*3,16)=12
    expect(health.cycleModuleCount).toBe(3);
    expect(health.score).toBe(88); // 100-12
  });

  it("复杂度占比推高扣分", () => {
    const health = computeArchitectureHealth({
      coupling: [],
      cycles: [],
      highComplexityFiles: 5,
      totalFiles: 10, // 50% → 30 分，封顶 20
      techDebtCount: 0,
      totalLines: 1000,
      deadSymbolCount: 0,
      totalSymbols: 50,
    });
    const d = health.deductions.find((x) => x.key === "complexity")!;
    expect(d.points).toBe(20);
    expect(health.score).toBe(80);
  });

  it("五项扣分叠加且总分不为负", () => {
    const health = computeArchitectureHealth({
      coupling: [],
      cycles: [{ nodes: ["a", "b"], size: 2, edgeCount: 2, weight: 2 }],
      highComplexityFiles: 10,
      totalFiles: 10,
      techDebtCount: 1000,
      totalLines: 1000, // 1 KLOC → 密度 1000/1*3 远超封顶 15
      deadSymbolCount: 50,
      totalSymbols: 50, // 100% → 40 远超封顶 10
    });
    const total = health.deductions.reduce((acc, d) => acc + d.points, 0);
    // 8(2元环 min(4*2,16)) + 0(无耦合 distance) + 20 + 15 + 10 = 53
    expect(total).toBe(53);
    expect(health.score).toBe(47);
    expect(health.grade).toBe("D");
  });

  it("扣分明细带人话解释", () => {
    const health = computeArchitectureHealth({
      coupling: [],
      cycles: [],
      highComplexityFiles: 0,
      totalFiles: 10,
      techDebtCount: 0,
      totalLines: 1000,
      deadSymbolCount: 0,
      totalSymbols: 50,
    });
    for (const d of health.deductions) {
      expect(typeof d.detail).toBe("string");
      expect(d.detail.length).toBeGreaterThan(0);
    }
    expect(ZONE_LABEL.painful).toBeTruthy();
  });
});
