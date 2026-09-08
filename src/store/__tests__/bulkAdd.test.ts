import { describe, it, expect, beforeAll } from "vitest";
import { useEditorStore } from "../editorStore";
import { registerBuiltinComponents } from "../../editor/registry";

beforeAll(() => {
  // 与 main.tsx 一致的启动注册（实体类型/分析器插件）
  registerBuiltinComponents();
});

describe("editorStore 批量动作（同步到画布性能基础）", () => {
  it("addComponentsBulk 一次落库全部实体并返回 id 列表", () => {
    const store = useEditorStore.getState();
    store.clearScene();

    const ids = store.addComponentsBulk([
      { type: "file", name: "a.ts", x: 10, y: 20 },
      { type: "file", name: "b.ts", x: 30, y: 40, width: 180, height: 70 },
      { type: "dependency-edge", name: "a→b", x: 0, y: 0, config: { fromFileId: "f1", toFileId: "f2" } },
    ]);

    expect(ids).toHaveLength(3);
    const comps = useEditorStore.getState().components;
    expect(comps).toHaveLength(3);
    expect(comps.map((c) => c.name)).toEqual(["a.ts", "b.ts", "a→b"]);
    // 尺寸覆盖生效
    const b = comps.find((c) => c.name === "b.ts")!;
    expect(b.transform.width).toBe(180);
    expect(b.transform.height).toBe(70);
    // config 合并生效
    const edge = comps.find((c) => c.type === "dependency-edge")!;
    expect(edge.config.fromFileId).toBe("f1");
    // zIndex 顺序递增
    expect(comps.map((c) => c.zIndex)).toEqual([1, 2, 3]);
  });

  it("批量添加只产生一条历史记录（撤销可整体回退）", () => {
    const store = useEditorStore.getState();
    store.clearScene();
    const before = useEditorStore.getState().history.length;

    useEditorStore.getState().addComponentsBulk([
      { type: "file", name: "a.ts", x: 0, y: 0 },
      { type: "file", name: "b.ts", x: 0, y: 0 },
      { type: "file", name: "c.ts", x: 0, y: 0 },
    ]);

    const after = useEditorStore.getState().history.length;
    // 清空场景不记历史；批量添加只 +1 条
    expect(after - before).toBe(1);

    // 撤销一次即整体移除（批量语义）
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().components).toHaveLength(0);
  });

  it("updateComponentsConfig 一次 store 更新批量覆写 config/name/尺寸", () => {
    const store = useEditorStore.getState();
    store.clearScene();
    const ids = store.addComponentsBulk([
      { type: "file", name: "a.ts", x: 0, y: 0 },
      { type: "file", name: "b.ts", x: 0, y: 0 },
    ]);

    useEditorStore.getState().updateComponentsConfig([
      { id: ids[0], name: "a-renamed.ts", config: { complexity: 42, language: "rust" }, width: 200 },
      { id: ids[1], config: { deadCount: 3 } },
    ]);

    const comps = useEditorStore.getState().components;
    expect(comps[0].name).toBe("a-renamed.ts");
    expect(comps[0].config.complexity).toBe(42);
    expect(comps[0].config.language).toBe("rust");
    expect(comps[0].transform.width).toBe(200);
    expect(comps[1].config.deadCount).toBe(3);
    // 未更新的字段保持实体注册的默认值（merge 语义而非覆盖）
    expect(comps[0].config.fileName).toBe("untitled");
  });

  it("无图层时自动补默认图层并正常落库（修复同步到画布静默失败根因）", () => {
    const store = useEditorStore.getState();
    store.clearScene();
    // 删除唯一默认图层（removeLayer 保护 isDefault，直接置空模拟无图层）
    useEditorStore.setState((s) => {
      s.layers = [];
      s.activeLayerId = null;
    });
    const ids = store.addComponentsBulk([{ type: "file", name: "a.ts", x: 0, y: 0 }]);
    expect(ids).toHaveLength(1);
    expect(useEditorStore.getState().components).toHaveLength(1);
    // 自动补的默认图层可被后续批量添加复用
    expect(useEditorStore.getState().layers.length).toBe(1);
    expect(useEditorStore.getState().activeLayerId).toBe(useEditorStore.getState().layers[0].id);
    const ids2 = store.addComponentsBulk([{ type: "file", name: "b.ts", x: 10, y: 0 }]);
    expect(ids2).toHaveLength(1);
    expect(useEditorStore.getState().components).toHaveLength(2);
  });
});
