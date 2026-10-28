import { describe, it, expect } from "vitest";
import { buildSyncLayout, MAX_EDGES, FILE_W, FILE_H, symbolNamesForEdge } from "../syncLayout";
import type { ProjectDependency, ProjectFile } from "../../../services/tauri";

function makeFile(id: string, relPath: string, lineCount = 10): ProjectFile {
  return {
    id,
    analysisId: "a1",
    path: relPath,
    relPath,
    name: relPath.split("/").pop() || id,
    extension: "ts",
    language: "typescript",
    size: 100,
    lineCount,
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

function makeDep(from: string, to: string, weight = 1, circular = false): ProjectDependency {
  return {
    id: `d_${from}_${to}`,
    analysisId: "a1",
    fromId: from,
    fromType: "file",
    toId: to,
    toType: "file",
    kind: "import",
    lineNo: null,
    isCircular: circular,
    weight,
    metadata: "{}",
    detectedAt: 0,
  };
}

const configFor = (f: ProjectFile) => ({ language: f.language, lineCount: f.lineCount });

describe("buildSyncLayout（同步到画布纯布局引擎）", () => {
  it("按顶层目录分组网格排布，目录项不落画布", () => {
    const files = [
      makeFile("f1", "src/a.ts"),
      makeFile("f2", "src/b.ts"),
      makeFile("f3", "tests/c.ts"),
      { ...makeFile("f4", "src"), isDirectory: true } as ProjectFile,
    ];
    const layout = buildSyncLayout(files, [], configFor);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.summary.groups).toBe(2);
    // src 组两文件同行两列
    const [n1, n2] = layout.nodes;
    expect(n1.x).toBe(40);
    expect(n1.y).toBe(40 + 40); // HEADER_H 偏移
    expect(n2.x).toBe(40 + 180); // 第二列
    expect(n2.y).toBe(n1.y);
    // tests 组在第二组（组间距）
    expect(layout.nodes[2].y).toBeGreaterThan(n1.y);
    // 尺寸与注册定义一致
    expect(n1.width).toBe(FILE_W);
    expect(n1.height).toBe(FILE_H);
  });

  it("config 注入 + 自动写入 fileId/filePath（画布业务联动锚点）", () => {
    const files = [makeFile("f1", "src/a.ts")];
    const layout = buildSyncLayout(files, [], configFor);
    const cfg = layout.nodes[0].config as Record<string, unknown>;
    expect(cfg.fileId).toBe("f1");
    expect(cfg.filePath).toBe("src/a.ts");
    expect(cfg.language).toBe("typescript");
  });

  it("同一对文件的多条依赖聚合为一条边，weight 累加、circular 取或", () => {
    const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "src/b.ts")];
    const deps = [makeDep("f1", "f2", 2), makeDep("f1", "f2", 3), makeDep("f2", "f1", 1, true)];
    const layout = buildSyncLayout(files, deps, configFor);

    // 三条边 → f1->f2（w=5, 非环）+ f2->f1（w=1, 环）= 两条聚合边
    expect(layout.edges).toHaveLength(2);
    const fwd = layout.edges.find((e) => e.fromFileId === "f1" && e.toFileId === "f2")!;
    expect(fwd.config.edgeCount).toBe(2);
    expect(fwd.config.isCircular).toBe(false);
    const back = layout.edges.find((e) => e.fromFileId === "f2" && e.toFileId === "f1")!;
    expect(back.config.isCircular).toBe(true);
  });

  it("自引用边被丢弃；未上画布的文件不产生边", () => {
    const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "src/b.ts")];
    const deps = [
      makeDep("f1", "f1", 1), // 自引用
      makeDep("f1", "fX", 1), // 目标不在画布
    ];
    const layout = buildSyncLayout(files, deps, configFor);
    expect(layout.edges).toHaveLength(0);
  });

  it("边数超过上限按 weight 降序截断", () => {
    const files: ProjectFile[] = [];
    const deps: ProjectDependency[] = [];
    for (let i = 0; i < 40; i++) {
      files.push(makeFile(`f${i}`, `m${i}/x.ts`));
    }
    // 40 个文件两两有边 → 远超上限
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        if (i === j) continue;
        deps.push(makeDep(`f${i}`, `f${j}`, (i + j) % 100));
      }
    }
    const layout = buildSyncLayout(files, deps, configFor);
    expect(layout.edges.length).toBeLessThanOrEqual(MAX_EDGES);
    expect(layout.summary.edgeTotal).toBeGreaterThan(MAX_EDGES);
    // 截断后仍是按 weight 排序的（第一条 weight ≥ 最后一条）
    const weights = layout.edges.map((e) => (e.config.weight as number) ?? 0);
    expect(Math.max(...weights)).toBeGreaterThanOrEqual(Math.min(...weights));
  });

  it("每个顶层目录生成一个模块分组头实体（带模块内文件 id 供画布联动）", () => {
    const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "src/b.ts"), makeFile("f3", "tests/c.ts")];
    const layout = buildSyncLayout(files, [], configFor);

    expect(layout.modules).toHaveLength(2);
    const srcMod = layout.modules.find((m) => m.name === "src")!;
    const testsMod = layout.modules.find((m) => m.name === "tests")!;
    // 模块绑定其下全部文件 id
    expect(srcMod.fileIds.sort()).toEqual(["f1", "f2"]);
    expect(testsMod.fileIds).toEqual(["f3"]);
    // config 携带联动锚点（moduleName + fileIds）
    const cfg = srcMod.config as Record<string, unknown>;
    expect(cfg.moduleName).toBe("src");
    expect(cfg.fileIds).toEqual(["f1", "f2"]);
    // 模块头位于组内顶部区域（y 小于组内文件 y）
    expect(srcMod.y).toBeLessThan(layout.nodes[0].y);
    // 宽度覆盖整组列宽
    expect(srcMod.width).toBe(8 * 180);
  });

  it("无文件时模块列表为空，不产生分组头", () => {
    const layout = buildSyncLayout([], [], configFor);
    expect(layout.modules).toHaveLength(0);
    expect(layout.nodes).toHaveLength(0);
  });

  it("symbolRefs 聚合：依赖边写入具体符号名（去重保序、上限 12）", () => {
    const files = [makeFile("f1", "src/a.ts"), makeFile("f2", "src/b.ts")];
    const deps = [makeDep("f1", "f2", 1)];
    const refs = [
      { fromFileId: "f1", toFileId: "f2", symbolName: "UserService" },
      { fromFileId: "f1", toFileId: "f2", symbolName: "UserService" }, // 重复去重
      { fromFileId: "f1", toFileId: "f2", symbolName: "buildQuery" },
      { fromFileId: "f1", toFileId: "fX", symbolName: "Other" }, // 目标不在画布
      { fromFileId: "f2", toFileId: "f1", symbolName: "reverse" }, // 反向边
    ];
    const layout = buildSyncLayout(files, deps, configFor, refs);
    const edge = layout.edges.find((e) => e.fromFileId === "f1" && e.toFileId === "f2")!;
    const names = edge.config.symbolNames as string[];
    expect(names).toEqual(["UserService", "buildQuery"]);
  });

  it("symbolNamesForEdge：无引用/空名/方向不匹配均返回空数组", () => {
    const refs = [
      { fromFileId: "f1", toFileId: "f2", symbolName: "" },
      { fromFileId: "f1", toFileId: "f2", symbolName: "  " },
      { fromFileId: "f9", toFileId: "f2", symbolName: "A" },
    ];
    expect(symbolNamesForEdge(refs, "f1", "f2")).toEqual([]);
    expect(symbolNamesForEdge(undefined, "f1", "f2")).toEqual([]);
  });
});
