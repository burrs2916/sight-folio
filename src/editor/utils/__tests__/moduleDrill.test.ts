import { describe, it, expect } from "vitest";
import { buildModuleDrillLayout, drillColumns, drillOrigin, MAX_DRILL_EDGES } from "../moduleDrill";
import type { ProjectDependency, ProjectFile } from "../../../services/tauri";

function file(id: string, relPath: string): ProjectFile {
  return {
    id,
    analysisId: "a1",
    relPath,
    name: relPath.split("/").pop() || relPath,
    extension: "ts",
    language: "typescript",
    size: 100,
    lineCount: 10,
    isDirectory: false,
    layerId: null,
    moduleId: null,
    hash: null,
    updatedAt: null,
  } as unknown as ProjectFile;
}

function dep(from: string, to: string, extra: Partial<ProjectDependency> = {}): ProjectDependency {
  return {
    id: `${from}->${to}`,
    analysisId: "a1",
    fromId: from,
    toId: to,
    kind: "import",
    weight: 1,
    isCircular: false,
    ...extra,
  } as unknown as ProjectDependency;
}

const cfgFor = (f: ProjectFile) => ({ fileName: f.name });

describe("drillColumns", () => {
  it("列数随文件数开方增长，钳制在 [2,8]", () => {
    expect(drillColumns(0)).toBe(1);
    expect(drillColumns(1)).toBe(1);
    expect(drillColumns(4)).toBe(2);
    expect(drillColumns(30)).toBe(6);
    expect(drillColumns(1000)).toBe(8);
  });
});

describe("drillOrigin", () => {
  it("落在现有内容右侧，避免与既有布局重叠", () => {
    const items = [
      { transform: { x: 0, y: 100, width: 100, height: 50 } },
      { transform: { x: 300, y: 40, width: 200, height: 50 } },
    ];
    expect(drillOrigin(items, 200)).toEqual({ x: 700, y: 40 });
  });

  it("空画布时落在原点附近", () => {
    expect(drillOrigin([])).toEqual({ x: 40, y: 40 });
  });
});

describe("buildModuleDrillLayout", () => {
  const files = [
    file("f1", "src/a.ts"),
    file("f2", "src/b.ts"),
    file("f3", "src/c.ts"),
  ];
  const deps = [
    dep("f1", "f2"),
    dep("f1", "f2"), // 同一对聚合
    dep("f2", "f3", { isCircular: true }),
    dep("f1", "other"), // 外部耦合，不画线
  ];

  it("生成文件节点 + 内部依赖连线 + 分组框，并统计外部耦合", () => {
    const layout = buildModuleDrillLayout("src", "owner-1", { x: 1000, y: 40 }, files, deps, cfgFor);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    expect(layout.summary).toMatchObject({ files: 3, edges: 2, internalEdgeTotal: 2, externalEdges: 1 });
    expect(layout.frame.config.drillFrame).toBe(true);
  });

  it("所有子实体带 drillOwnerId，折叠时可精确回收", () => {
    const layout = buildModuleDrillLayout("src", "owner-1", { x: 0, y: 0 }, files, deps, cfgFor);
    for (const n of layout.nodes) expect(n.config.drillOwnerId).toBe("owner-1");
    for (const e of layout.edges) expect(e.config.drillOwnerId).toBe("owner-1");
    expect(layout.frame.config.drillOwnerId).toBe("owner-1");
  });

  it("聚合同一对文件的多条依赖（edgeCount 累加）", () => {
    const layout = buildModuleDrillLayout("src", "o", { x: 0, y: 0 }, files, deps, cfgFor);
    const e = layout.edges.find((x) => x.fromFileId === "f1" && x.toFileId === "f2")!;
    expect(e.config.edgeCount).toBe(2);
    expect(e.config.weight).toBe(2);
  });

  it("环依赖标记透传给渲染器", () => {
    const layout = buildModuleDrillLayout("src", "o", { x: 0, y: 0 }, files, deps, cfgFor);
    const e = layout.edges.find((x) => x.fromFileId === "f2" && x.toFileId === "f3")!;
    expect(e.config.isCircular).toBe(true);
    expect(e.config.depType).toBe("circular");
  });

  it("节点全部落在分组框内（框尺寸包住网格）", () => {
    const many = Array.from({ length: 17 }, (_, i) => file(`m${i}`, `src/f${i}.ts`));
    const layout = buildModuleDrillLayout("src", "o", { x: 500, y: 200 }, many, [], cfgFor);
    const { x, y, width, height } = layout.bounds;
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(x);
      expect(n.y).toBeGreaterThanOrEqual(y);
      expect(n.x + n.width).toBeLessThanOrEqual(x + width + 1);
      expect(n.y + n.height).toBeLessThanOrEqual(y + height + 1);
    }
  });

  it("内部依赖过多时按权重截断，画布不变毛线团", () => {
    const many = Array.from({ length: 40 }, (_, i) => file(`n${i}`, `src/f${i}.ts`));
    const heavy: ProjectDependency[] = [];
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        if (i !== j) heavy.push(dep(`n${i}`, `n${j}`, { weight: i + j }));
      }
    }
    const layout = buildModuleDrillLayout("src", "o", { x: 0, y: 0 }, many, heavy, cfgFor);
    expect(layout.edges).toHaveLength(MAX_DRILL_EDGES);
    expect(layout.summary.internalEdgeTotal).toBeGreaterThan(MAX_DRILL_EDGES);
  });

  it("目录项被忽略（只画真实文件）", () => {
    const withDir = [...files, { ...file("d1", "src/sub"), isDirectory: true } as ProjectFile];
    const layout = buildModuleDrillLayout("src", "o", { x: 0, y: 0 }, withDir, [], cfgFor);
    expect(layout.nodes).toHaveLength(3);
  });
});
