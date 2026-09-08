// project-sight: 左侧面板联动单测
// 验证「实体/文件/插件与画布分析数据联动」核心逻辑：
//   1. findComponentForFile / findComponentForModule：按 config.filePath/moduleName 匹配画布实体
//   2. locateFileInCanvas / focusComponent：定位时选中 + 发出居中请求
//   3. focusRequest 单调递增（画布据此居中，防重复触发）
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";
import { componentRegistry } from "../../editor/registry";
import { registerProjectEntities } from "../../editor/registerProjectEntities";
import {
  findComponentForFile,
  findComponentForModule,
  locateFileInCanvas,
} from "../../editor/utils/canvasLink";
import type { ProjectFile } from "../../services/tauri";

// 注册项目实体（file/folder/module/dependency-edge/layer-marker）
beforeEach(() => {
  useEditorStore.getState().clearScene();
  if (componentRegistry.get("file") === undefined) {
    registerProjectEntities();
  }
});

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: "file_1",
    analysisId: "a1",
    path: "/proj/src/App.tsx",
    relPath: "src/App.tsx",
    name: "App.tsx",
    extension: "tsx",
    language: "typescript",
    size: 1024,
    lineCount: 120,
    contentHash: null,
    parentId: null,
    isDirectory: false,
    layerId: null,
    x: 0, y: 0, width: 160, height: 48,
    metadata: "{}",
    scannedAt: 0,
    ...overrides,
  };
}

/** 辅助：往画布添加一个文件实体并回填 config */
function addCanvasFile(relPath: string, name: string) {
  const st = useEditorStore.getState();
  const comp = st.addComponent("file", undefined, { x: 100, y: 100 });
  if (!comp) throw new Error("addComponent failed (需要默认图层)");
  useEditorStore.setState((s: any) => {
    const found = s.components.find((c: any) => c.id === comp.id);
    if (found) {
      found.name = name;
      found.config = { ...found.config, filePath: relPath, fileName: name, language: "typescript" };
    }
  });
  return comp.id;
}

describe("findComponentForFile / findComponentForModule（实体↔画布匹配）", () => {
  it("通过 config.filePath 精确匹配画布文件实体", () => {
    addCanvasFile("src/App.tsx", "App.tsx");
    const file = makeFile();
    const comp = findComponentForFile(file);
    expect(comp).toBeDefined();
    expect(comp!.config?.filePath).toBe("src/App.tsx");
  });

  it("filePath 不匹配时退化到文件名匹配", () => {
    addCanvasFile("src/other.tsx", "Main.tsx");
    const file = makeFile({ relPath: "lib/Main.tsx", name: "Main.tsx" });
    const comp = findComponentForFile(file);
    expect(comp).toBeDefined();
    expect(comp!.name).toBe("Main.tsx");
  });

  it("无匹配时返回 undefined", () => {
    const comp = findComponentForFile(makeFile());
    expect(comp).toBeUndefined();
  });

  it("模块按 moduleName/name 匹配画布 module 实体", () => {
    const st = useEditorStore.getState();
    const mod = st.addComponent("module", undefined, { x: 10, y: 10 });
    if (!mod) throw new Error("addComponent failed");
    useEditorStore.setState((s: any) => {
      const found = s.components.find((c: any) => c.id === mod.id);
      if (found) {
        found.name = "src";
        found.config = { ...found.config, name: "src", moduleName: "src" };
      }
    });
    const comp = findComponentForModule("src");
    expect(comp).toBeDefined();
    expect(comp!.type).toBe("module");
  });
});

describe("locateFileInCanvas / focusComponent（定位联动）", () => {
  it("定位成功：选中目标实体并发出 focusRequest", () => {
    const compId = addCanvasFile("src/App.tsx", "App.tsx");
    const ok = locateFileInCanvas(makeFile());
    expect(ok).toBe(true);

    const state = useEditorStore.getState();
    expect(state.selection.selectedIds).toEqual([compId]);
    expect(state.focusRequest?.id).toBe(compId);
  });

  it("定位失败：不选中、不发出请求，返回 false", () => {
    const ok = locateFileInCanvas(makeFile());
    expect(ok).toBe(false);
    const state = useEditorStore.getState();
    expect(state.selection.selectedIds).toHaveLength(0);
    expect(state.focusRequest).toBeNull();
  });

  it("focusRequest.ts 单调递增（画布据此防重复居中）", () => {
    const compId = addCanvasFile("src/App.tsx", "App.tsx");
    useEditorStore.getState().focusComponent(compId);
    const first = useEditorStore.getState().focusRequest!.ts;
    useEditorStore.getState().focusComponent(compId);
    const second = useEditorStore.getState().focusRequest!.ts;
    expect(second).toBeGreaterThan(first);
  });
});

describe("requestFit（画布统筹全局：同步/画像后自动适应视口）", () => {
  it("发出 fitRequest 且 ts 单调递增（画布据此自动缩放全览）", () => {
    expect(useEditorStore.getState().fitRequest).toBeNull();
    useEditorStore.getState().requestFit();
    const first = useEditorStore.getState().fitRequest!.ts;
    expect(first).toBeGreaterThan(0);
    useEditorStore.getState().requestFit();
    const second = useEditorStore.getState().fitRequest!.ts;
    expect(second).toBeGreaterThan(first);
  });

  it("clearScene 后 fitRequest 复位为 null", () => {
    useEditorStore.getState().requestFit();
    expect(useEditorStore.getState().fitRequest).not.toBeNull();
    useEditorStore.getState().clearScene();
    expect(useEditorStore.getState().fitRequest).toBeNull();
  });
});
