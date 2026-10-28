import { describe, it, expect } from "vitest";
import { countEntitiesPerLayer } from "../CanvasLayerPanel";
import { createDefaultLayer, type LayerNode } from "../../../types/editor";

function layer(partial: Partial<LayerNode> & { id: string }): LayerNode {
  return {
    ...createDefaultLayer(partial.name, (partial.type as "layer" | "group") || "layer"),
    ...partial,
  } as LayerNode;
}

describe("CanvasLayerPanel countEntitiesPerLayer", () => {
  it("统计单图层实体数", () => {
    const layers = [layer({ id: "L1" })];
    const comps = [
      { layerId: "L1" },
      { layerId: "L1" },
      { layerId: "L2" },
      { layerId: "L2" },
    ];
    const counts = countEntitiesPerLayer(layers, comps);
    expect(counts["L1"]).toBe(2);
  });

  it("分组图层统计含子图层实体（getLayerDescendants 聚合）", () => {
    const g = layer({ id: "G1", type: "group", children: ["L1", "L2"] });
    const l1 = layer({ id: "L1", parentId: "G1" });
    const l2 = layer({ id: "L2", parentId: "G1" });
    const layers = [g, l1, l2];
    const comps = [
      { layerId: "L1" },
      { layerId: "L2" },
      { layerId: "L1" },
      { layerId: "OTHER" },
    ];
    const counts = countEntitiesPerLayer(layers, comps);
    // 分组本身不算实体数，但子图层各自统计
    expect(counts["L1"]).toBe(2);
    expect(counts["L2"]).toBe(1);
    expect(counts["G1"]).toBeUndefined();
  });

  it("未挂任何图层的实体不计入", () => {
    const layers = [layer({ id: "L1" })];
    const counts = countEntitiesPerLayer(layers, [{ layerId: null as unknown as string }]);
    expect(counts["L1"]).toBe(0);
  });

  it("空数据不抛错", () => {
    const counts = countEntitiesPerLayer([], []);
    expect(counts).toEqual({});
  });
});
