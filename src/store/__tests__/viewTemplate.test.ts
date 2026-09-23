// sight-folio: 视角模板应用到新建视图（需求文档 §4.5）单测
// 验证 addView 的第二参数 template（ViewTemplateOptions）：
//   defaultLayers → 新视图 LayerNode[]（首层为默认层）
//   layout → viewport 缩放/平移 + canvasConfig.grid.visible

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";
import { typescriptAnalyzerManifest } from "../../editor/analyzer/typescriptAnalyzer";

function templateArgsOf(tpl: (typeof typescriptAnalyzerManifest.viewTemplates)[number]) {
  return {
    layers: tpl.defaultLayers.map((l) => ({ name: l.name, color: l.color })),
    layout: { scale: tpl.layout.scale, panX: tpl.layout.panX, panY: tpl.layout.panY, grid: tpl.layout.grid },
  };
}

describe("addView 视角模板应用（§4.5）", () => {
  beforeEach(() => {
    useEditorStore.getState().clearScene();
  });

  it("带模板时应用 defaultLayers：数量/名称/颜色/首层默认", () => {
    const tpl = typescriptAnalyzerManifest.viewTemplates[0]; // 架构总览：4 层
    const viewId = useEditorStore.getState().addView(tpl.name, templateArgsOf(tpl));

    const state = useEditorStore.getState();
    const view = state.views.find((v) => v.id === viewId)!;
    expect(view.layers).toHaveLength(tpl.defaultLayers.length);
    expect(view.layers.map((l) => l.name)).toEqual(tpl.defaultLayers.map((l) => l.name));
    expect(view.layers.map((l) => l.color)).toEqual(tpl.defaultLayers.map((l) => l.color));
    expect(view.layers[0].isDefault).toBe(true);

    // 当前激活状态同步为新视图
    expect(state.activeViewId).toBe(viewId);
    expect(state.layers).toHaveLength(tpl.defaultLayers.length);
    expect(state.activeLayerId).toBe(view.layers[0].id);
  });

  it("带模板时应用 layout：viewport 缩放/平移 + 网格可见性", () => {
    const tpl = typescriptAnalyzerManifest.viewTemplates[1]; // 依赖关系图：scale 0.9, grid true
    useEditorStore.getState().addView(tpl.name, templateArgsOf(tpl));

    const state = useEditorStore.getState();
    expect(state.viewport.scale).toBe(tpl.layout.scale);
    expect(state.viewport.offset.x).toBe(tpl.layout.panX);
    expect(state.viewport.offset.y).toBe(tpl.layout.panY);
    expect(state.canvasConfig.grid.visible).toBe(tpl.layout.grid);
  });

  it("无模板时保持原行为：单个默认图层 + 沿用当前画布", () => {
    const store = useEditorStore.getState();
    const prevViewport = { ...store.viewport };
    const prevGrid = store.canvasConfig.grid.visible;
    const viewId = store.addView("视图 2");

    const state = useEditorStore.getState();
    const view = state.views.find((v) => v.id === viewId)!;
    expect(view.layers).toHaveLength(1);
    expect(view.layers[0].name).toBe("viewTab.defaultLayer");
    expect(view.layers[0].isDefault).toBe(true);
    expect(state.viewport.scale).toBe(prevViewport.scale);
    expect(state.canvasConfig.grid.visible).toBe(prevGrid);
  });

  it("切换视图不丢失模板图层（原视图状态被保存）", () => {
    const tpl = typescriptAnalyzerManifest.viewTemplates[0];
    useEditorStore.getState().addView(tpl.name, templateArgsOf(tpl));
    const newViewId = useEditorStore.getState().activeViewId;

    useEditorStore.getState().switchView("default");
    expect(useEditorStore.getState().layers).toHaveLength(1);

    useEditorStore.getState().switchView(newViewId);
    expect(useEditorStore.getState().layers).toHaveLength(tpl.defaultLayers.length);
  });
});
