import { describe, it, expect } from "vitest";
import { layeredLayout } from "../forceLayout";
import {
  forceDirectedLayout,
  separateOverlaps,
  degreeMap,
} from "../forceLayout";

describe("forceDirectedLayout", () => {
  it("空节点返回空结果且包围盒为 0", () => {
    const r = forceDirectedLayout([], []);
    expect(r.positions.size).toBe(0);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("单节点落在 origin 左上角", () => {
    const r = forceDirectedLayout([{ id: "a" }], [], { originX: 10, originY: 20 });
    expect(r.positions.get("a")).toEqual({ x: 10, y: 20 });
  });

  it("确定性：相同输入两次产出完全一致的坐标", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}` }));
    const edges = [
      { from: "n0", to: "n1" },
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" },
      { from: "n0", to: "n4" },
    ];
    const a = forceDirectedLayout(nodes, edges);
    const b = forceDirectedLayout(nodes, edges);
    expect(a.positions).toEqual(b.positions);
  });

  it("不同种子产生不同布局形态（非退化）", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}` }));
    const edges = [
      { from: "n0", to: "n1" },
      { from: "n2", to: "n3" },
      { from: "n4", to: "n5" },
    ];
    const a = forceDirectedLayout(nodes, edges, { seed: 1 });
    const b = forceDirectedLayout(nodes, edges, { seed: 999 });
    expect(a.positions).not.toEqual(b.positions);
  });

  it("有依赖边的节点最终距离更近（聚簇）", () => {
    // 两个分离簇：{a,b,c} 互相连，{x,y,z} 互相连，簇间无连
    const nodes = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "x" },
      { id: "y" },
      { id: "z" },
    ];
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
      { from: "x", to: "y" },
      { from: "y", to: "z" },
      { from: "x", to: "z" },
    ];
    const r = forceDirectedLayout(nodes, edges, { iterations: 400 });
    const dist = (p: string, q: string) => {
      const a = r.positions.get(p)!;
      const b = r.positions.get(q)!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const intraCluster = (dist("a", "b") + dist("x", "y")) / 2;
    const interCluster = dist("a", "x");
    expect(interCluster).toBeGreaterThan(intraCluster);
  });

  it("防重叠：输出节点矩形不相交（相邻边留间隙）", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      width: 170,
      height: 64,
    }));
    const edges: { from: string; to: string }[] = [];
    const r = forceDirectedLayout(nodes, edges, { separationPasses: 40 });
    const pts = nodes.map((n) => ({ ...r.positions.get(n.id)!, w: 170, h: 64 }));
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        const ox = (pts[i].w + pts[j].w) / 2 - Math.abs(pts[i].x - pts[j].x);
        const oy = (pts[i].h + pts[j].h) / 2 - Math.abs(pts[i].y - pts[j].y);
        expect(ox <= 0 || oy <= 0).toBe(true);
      }
    }
  });
});

describe("separateOverlaps", () => {
  it("重叠矩形被推开到不相交", () => {
    const items = [
      { id: "a", x: 0, y: 0, width: 100, height: 50 },
      { id: "b", x: 10, y: 5, width: 100, height: 50 }, // 与 a 重叠
    ];
    const out = separateOverlaps(items, 40);
    const pa = out.get("a")!;
    const pb = out.get("b")!;
    const ox = (100 + 100) / 2 - Math.abs(pa.x - pb.x);
    const oy = (50 + 50) / 2 - Math.abs(pa.y - pb.y);
    expect(ox <= 0 || oy <= 0).toBe(true);
  });

  it("原本不重叠则保持不动", () => {
    const items = [
      { id: "a", x: 0, y: 0, width: 100, height: 50 },
      { id: "b", x: 300, y: 200, width: 100, height: 50 },
    ];
    const out = separateOverlaps(items, 40);
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("b")).toEqual({ x: 300, y: 200 });
  });
});

describe("degreeMap", () => {
  it("统计每个节点的出+入度数", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c" },
    ];
    const m = degreeMap(edges);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(2);
    expect(m.get("c")).toBe(2);
  });
});

describe("layeredLayout（v2.17 依赖画像拓扑分层布局）", () => {
  const opts = { width: 2000, height: 1600, nodeWidth: 180, nodeHeight: 66, originX: 60, originY: 40 };

  it("DAG：入口在左、底座在右（depth 递增 → x 递增）", () => {
    const depth = new Map<string, number>([["a", 0], ["b", 1], ["c", 2]]);
    const pos = layeredLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      depth,
      opts
    );
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBeLessThan(pos.get("c")!.x);
    // 同层左右间距 = 列宽 + 层间距（180+24+120=324）
    expect(pos.get("c")!.x - pos.get("b")!.x).toBe(324);
  });

  it("环内节点同层同列（红虚线回流直观呈现）", () => {
    const depth = new Map<string, number>([["a", 3], ["b", 3], ["c", 3]]);
    const pos = layeredLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      depth,
      opts
    );
    const xs = new Set(["a", "b", "c"].map((id) => pos.get(id)!.x));
    expect(xs.size).toBe(1);
  });

  it("同层内按度数降序（枢纽置顶 → y 更小）", () => {
    const depth = new Map<string, number>([["hub", 1], ["leaf", 1]]);
    const pos = layeredLayout(
      [{ id: "hub", weight: 20 }, { id: "leaf", weight: 1 }],
      depth,
      opts
    );
    expect(pos.get("hub")!.y).toBeLessThan(pos.get("leaf")!.y);
  });

  it("depth 缺失的节点归入最后一层，不抛异常", () => {
    const depth = new Map<string, number>([["a", 0]]);
    const pos = layeredLayout([{ id: "a" }, { id: "unknown" }], depth, opts);
    expect(pos.has("a")).toBe(true);
    expect(pos.has("unknown")).toBe(true);
  });
});

describe("layeredLayout 层内分列（maxRowsPerLayer）", () => {
  const opts = {
    width: 2000, height: 1600, nodeWidth: 180, nodeHeight: 66,
    originX: 60, originY: 40, layerGap: 120, nodeGap: 10,
  };

  it("默认不传 maxRowsPerLayer → 每层仍是单列（既有调用方零回归）", () => {
    const depth = new Map<string, number>([["a", 0], ["b", 0], ["c", 0]]);
    const pos = layeredLayout([{ id: "a" }, { id: "b" }, { id: "c" }], depth, opts);
    const xs = new Set(["a", "b", "c"].map((id) => pos.get(id)!.x));
    expect(xs.size).toBe(1); // 三个节点同一列
  });

  it("超出阈值的层横向分列，且层内 y 换列后归位", () => {
    const depth = new Map<string, number>([["a", 0], ["b", 0], ["c", 0], ["d", 0]]);
    const pos = layeredLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      depth,
      { ...opts, maxRowsPerLayer: 2 }
    );
    // 每 2 个一列：a,b 在第 1 子列；c,d 在第 2 子列
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    expect(pos.get("c")!.x).toBe(pos.get("d")!.x);
    expect(pos.get("c")!.x).toBeGreaterThan(pos.get("a")!.x);
    // 换子列后 y 归位：c 与 a 同高，d 与 b 同高
    expect(pos.get("c")!.y).toBe(pos.get("a")!.y);
    expect(pos.get("d")!.y).toBe(pos.get("b")!.y);
  });

  it("不同层按 depth 升序累加列偏移，不因子列而错位", () => {
    // byLayer 的迭代顺序是插入顺序而非 depth 序：若边遍历边累加会把偏移算到错误的层。
    // 这里故意让 nodes 顺序与 depth 逆序，验证排序兜底。
    const depth = new Map<string, number>([["deep", 2], ["mid", 1], ["root", 0]]);
    const pos = layeredLayout(
      [{ id: "deep" }, { id: "mid" }, { id: "root" }],
      depth,
      opts
    );
    expect(pos.get("root")!.x).toBeLessThan(pos.get("mid")!.x);
    expect(pos.get("mid")!.x).toBeLessThan(pos.get("deep")!.x);
  });

  it("分列后层高按单个子列算，纵向受控（原实现按整层节点数撑高会溢出）", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
    const depth = new Map<string, number>(ids.map((id) => [id, 0]));
    const pos = layeredLayout(ids.map((id) => ({ id })), depth, { ...opts, maxRowsPerLayer: 10 });
    const maxY = Math.max(...ids.map((id) => pos.get(id)!.y));
    // 10 行 × (66+10) + 层内微下沉 ≈ 800px，而非 40 行 ≈ 3080px
    expect(maxY).toBeLessThan(1000);
  });
});
