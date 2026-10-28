import { describe, it, expect } from "vitest";
import {
  computeVisibleEntityIds,
  cullOffscreenEntities,
  entityScreenBounds,
  type VirtualViewport,
} from "../viewportCulling";

const VP: VirtualViewport = { scale: 1, offset: { x: 0, y: 0 } };

function comp(id: string, x: number, y: number, width = 100, height = 60, visible = true) {
  return {
    id,
    visible,
    transform: { x, y, width, height, rotation: 0, scale: { x: 1, y: 1 } },
  };
}

describe("entityScreenBounds", () => {
  it("画布坐标投影到屏幕坐标", () => {
    const b = entityScreenBounds(comp("a", 10, 20, 100, 60), VP);
    expect(b).toEqual({ x: 10, y: 20, width: 100, height: 60 });
  });

  it("带 offset 与 scale 的投影", () => {
    const b = entityScreenBounds(comp("a", 100, 50, 200, 100), {
      scale: 2,
      offset: { x: 10, y: -20 },
    });
    expect(b).toEqual({ x: 210, y: 80, width: 400, height: 200 });
  });

  it("旋转实体 AABB 上界放大", () => {
    const b = entityScreenBounds(
      { ...comp("a", 0, 0, 100, 100), transform: { x: 0, y: 0, width: 100, height: 100, rotation: 45, scale: { x: 1, y: 1 } } },
      VP
    );
    expect(b.width).toBe(150);
  });
});

describe("computeVisibleEntityIds", () => {
  it("视口内实体可见，视口外不可见", () => {
    const comps = [comp("in", 10, 10), comp("out", 5000, 5000)];
    const ids = computeVisibleEntityIds(comps, VP, { width: 800, height: 600 });
    expect(ids.has("in")).toBe(true);
    expect(ids.has("out")).toBe(false);
  });

  it("padding 缓冲内实体仍可见", () => {
    const comps = [comp("near", 700, 10)]; // 视口 800 宽，实体 700+100=800 在边界
    const ids = computeVisibleEntityIds(comps, VP, { width: 800, height: 600 });
    expect(ids.has("near")).toBe(true);
  });

  it("选中/悬停实体无条件可见（即使视口外）", () => {
    const comps = [comp("sel", 99999, 0), comp("hov", 0, 99999), comp("plain", 99999, 99999)];
    const ids = computeVisibleEntityIds(comps, VP, { width: 800, height: 600 }, {
      selectedIds: ["sel"],
      hoveredId: "hov",
    });
    expect(ids.has("sel")).toBe(true);
    expect(ids.has("hov")).toBe(true);
    expect(ids.has("plain")).toBe(false);
  });

  it("隐藏实体不渲染", () => {
    const comps = [comp("hidden", 10, 10, 100, 60, false)];
    const ids = computeVisibleEntityIds(comps, VP, { width: 800, height: 600 });
    expect(ids.has("hidden")).toBe(false);
  });

  it("空容器/空数据不抛错", () => {
    expect(computeVisibleEntityIds([], VP, { width: 0, height: 0 }).size).toBe(0);
  });
});

describe("cullOffscreenEntities", () => {
  it("保持输入顺序并只保留可见实体", () => {
    const comps = [comp("a", 0, 0), comp("b", 99999, 0), comp("c", 0, 0)];
    const out = cullOffscreenEntities(comps, VP, { width: 800, height: 600 });
    expect(out.map((c) => c.id)).toEqual(["a", "c"]);
  });
});
