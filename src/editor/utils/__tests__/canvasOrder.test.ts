// sight-folio: 画布渲染顺序辅助函数测试
//
// 回归覆盖 2026-08-19 那个隐蔽 bug：单数组分桶在 [F1 F2 E1 E2] 这种
// 「非边在前、边在后」的常见情况下，会互相覆盖写丢非边，观感即「实体突然
// 看不见」。三关（tsc/vitest/vite build）跑过也无法发现，所以必须有针对性测试。
import { describe, it, expect } from "vitest";
import { sortComponentsEdgesFirst } from "../canvasOrder";
import type { SceneComponent } from "../../../types/editor";

function comp(id: string, type: SceneComponent["type"]): SceneComponent {
  return {
    id,
    type,
    name: id,
    transform: { x: 0, y: 0, width: 100, height: 60, scale: { x: 1, y: 1 }, rotation: 0 },
    layerId: "L1",
    zIndex: 0,
    visible: true,
    locked: false,
    config: {},
  };
}

describe("sortComponentsEdgesFirst", () => {
  it("典型顺序：实体在前、边在后 → 所有元素仍在输出", () => {
    // 之前 bug 的典型触发形态
    const input = [comp("F1", "file"), comp("F2", "file"), comp("E1", "dependency-edge"), comp("E2", "dependency-edge")];
    const out = sortComponentsEdgesFirst(input, null);
    expect(out.map((c) => c.id)).toEqual(["E1", "E2", "F1", "F2"]);
  });

  it("边在前、实体在后 → 仅重排，元素全留", () => {
    const input = [comp("E1", "dependency-edge"), comp("E2", "dependency-edge"), comp("F1", "file"), comp("F2", "folder")];
    const out = sortComponentsEdgesFirst(input, null);
    expect(out.map((c) => c.id)).toEqual(["E1", "E2", "F1", "F2"]);
  });

  it("交替排列（最坏情形）→ 严格每个元素都在输出一次", () => {
    // 这是单数组分桶 bug 的触发形态：[F1, E1, F2, E2] 走完老算法会变成 [E1, E2]（F1/F2 丢失）。
    const input = [comp("F1", "file"), comp("E1", "dependency-edge"), comp("F2", "folder"), comp("E2", "dependency-edge")];
    const out = sortComponentsEdgesFirst(input, null);
    expect(out.length).toBe(4);
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(["F1", "E1", "F2", "E2"]));
    // 边应在所有非边前面
    const firstNonEdgeIdx = out.findIndex((c) => c.type !== "dependency-edge");
    const lastEdgeIdx = out.map((c) => c.type).lastIndexOf("dependency-edge");
    expect(firstNonEdgeIdx).toBeGreaterThan(lastEdgeIdx);
  });

  it("空数组 → 空数组", () => {
    expect(sortComponentsEdgesFirst([], null)).toEqual([]);
  });

  it("仅实体（无边） → 原顺序透传", () => {
    const input = [comp("F1", "file"), comp("M1", "module"), comp("C1", "class")];
    const out = sortComponentsEdgesFirst(input, null);
    expect(out.map((c) => c.id)).toEqual(["F1", "M1", "C1"]);
  });

  it("仅边 → 原顺序透传", () => {
    const input = [comp("E1", "dependency-edge"), comp("E2", "dependency-edge")];
    const out = sortComponentsEdgesFirst(input, null);
    expect(out.map((c) => c.id)).toEqual(["E1", "E2"]);
  });

  it("visibleEntityIds 过滤：仅渲染视口内 + 排序", () => {
    const input = [comp("F1", "file"), comp("F2", "file"), comp("E1", "dependency-edge"), comp("E2", "dependency-edge")];
    const out = sortComponentsEdgesFirst(input, new Set(["F1", "E1"]));
    expect(out.map((c) => c.id)).toEqual(["E1", "F1"]);
  });

  it("不修改入参数组（pure）", () => {
    const input = [comp("F1", "file"), comp("E1", "dependency-edge"), comp("F2", "file")];
    const snapshot = input.map((c) => c.id);
    sortComponentsEdgesFirst(input, null);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });
});