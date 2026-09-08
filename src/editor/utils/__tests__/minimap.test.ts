import { describe, it, expect } from "vitest";
import {
  computeProjection,
  projectRect,
  minimapToWorld,
  viewportWorldRect,
  centerViewportOn,
  riskTierOf,
  buildMinimapDots,
  summarizeTiers,
  RISK_TIER_COLORS,
} from "../minimap";
import type { SceneComponent } from "../../../types/editor";

const SIZE = { width: 200, height: 100 };

function comp(over: Partial<SceneComponent> & { id: string }): SceneComponent {
  return {
    id: over.id,
    type: over.type ?? "file",
    name: over.name ?? over.id,
    transform: over.transform ?? { x: 0, y: 0, width: 100, height: 50, rotation: 0, scale: { x: 1, y: 1 } },
    config: over.config ?? {},
    style: over.style ?? {},
    visible: true,
    locked: false,
  } as unknown as SceneComponent;
}

describe("computeProjection", () => {
  it("无包围盒 / 容器未就绪时返回 null（宁可不画也不画错位的图）", () => {
    expect(computeProjection(null, SIZE)).toBeNull();
    expect(computeProjection({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 })).toBeNull();
  });

  it("等比缩放取宽高中较小的比例，不拉伸", () => {
    // 世界 1000x100，容器 200x100（padding 4 → 可用 192x92）
    const p = computeProjection({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, SIZE)!;
    expect(p.scale).toBeCloseTo(Math.min(192 / 1000, 92 / 100), 6);
    expect(p.scale).toBeCloseTo(0.192, 6);
  });

  it("等比后的剩余空间平分到两侧（内容居中）", () => {
    const p = computeProjection({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, SIZE)!;
    // 宽度撑满 → offsetX 只剩 padding；高度有富余 → offsetY 居中
    expect(p.offsetX).toBeCloseTo(4, 6);
    expect(p.offsetY).toBeCloseTo(4 + (92 - 100 * 0.192) / 2, 6);
  });

  it("退化包围盒（单个实体，宽高为 0）不产生 Infinity", () => {
    const p = computeProjection({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, SIZE)!;
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.scale).toBeGreaterThan(0);
  });
});

describe("projectRect / minimapToWorld", () => {
  const proj = computeProjection({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, SIZE)!;

  it("世界矩形按投影落到小地图坐标", () => {
    const r = projectRect({ x: 0, y: 0, width: 1000, height: 500 }, proj);
    expect(r.x).toBeCloseTo(proj.offsetX, 6);
    expect(r.y).toBeCloseTo(proj.offsetY, 6);
    expect(r.w).toBeCloseTo(1000 * proj.scale, 6);
  });

  it("极小实体保底 1.5px，不会在俯瞰图上凭空消失", () => {
    const r = projectRect({ x: 0, y: 0, width: 1, height: 1 }, proj);
    expect(r.w).toBe(1.5);
    expect(r.h).toBe(1.5);
  });

  it("投影与反投影往返一致（点击导航不会跳错位置）", () => {
    const world = { x: 640, y: 320 };
    const r = projectRect({ x: world.x, y: world.y, width: 0, height: 0 }, proj);
    const back = minimapToWorld(r.x, r.y, proj);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });
});

describe("viewportWorldRect / centerViewportOn", () => {
  it("视口世界矩形 = 屏幕矩形按 scale/offset 反变换", () => {
    const r = viewportWorldRect({ scale: 2, offset: { x: -100, y: -50 } }, { width: 800, height: 600 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(25);
    expect(r.width).toBe(400);
    expect(r.height).toBe(300);
  });

  it("centerViewportOn 让目标世界点正好落到容器中心，且不改变缩放", () => {
    const container = { width: 800, height: 600 };
    const vp = centerViewportOn({ x: 1000, y: 500 }, 1.5, container);
    expect(vp.scale).toBe(1.5);
    // 反算：世界点投到屏幕应等于容器中心
    const sx = 1000 * vp.scale + vp.offset.x;
    const sy = 500 * vp.scale + vp.offset.y;
    expect(sx).toBeCloseTo(400, 6);
    expect(sy).toBeCloseTo(300, 6);
  });
});

describe("riskTierOf", () => {
  it("无画像字段判为 neutral（灰=没体检，不能冒充绿=健康）", () => {
    expect(riskTierOf(undefined)).toBe("neutral");
    expect(riskTierOf({ moduleName: "src" })).toBe("neutral");
  });

  it("refactorFirst 象限与 extreme 复杂度必红", () => {
    expect(riskTierOf({ quadrant: "refactorFirst", complexityLevel: "low" })).toBe("critical");
    expect(riskTierOf({ complexityLevel: "extreme" })).toBe("critical");
  });

  it("high 复杂度 / 死代码 / 多处克隆降到 warning", () => {
    expect(riskTierOf({ complexityLevel: "high" })).toBe("warning");
    expect(riskTierOf({ complexityLevel: "low", deadCount: 2 })).toBe("warning");
    expect(riskTierOf({ complexityLevel: "low", cloneCount: 3 })).toBe("warning");
  });

  it("技术债 / 单处克隆 / medium 复杂度为 watch，干净文件为 healthy", () => {
    expect(riskTierOf({ complexityLevel: "low", techDebtCount: 1 })).toBe("watch");
    expect(riskTierOf({ complexityLevel: "medium" })).toBe("watch");
    expect(riskTierOf({ complexityLevel: "low", symbolCount: 3 })).toBe("healthy");
  });
});

describe("buildMinimapDots", () => {
  const proj = computeProjection({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, SIZE)!;

  it("过滤依赖连线实体（其包围盒会糊成大色块盖住真实体）", () => {
    const dots = buildMinimapDots(
      [
        comp({ id: "f1", type: "file", config: { complexityLevel: "low", symbolCount: 1 } }),
        comp({ id: "e1", type: "dependency-edge", transform: { x: 0, y: 0, width: 900, height: 400, rotation: 0, scale: { x: 1, y: 1 } } }),
      ],
      proj
    );
    expect(dots.map((d) => d.id)).toEqual(["f1"]);
  });

  it("风险模式按档位配色，选中实体带 selected 标记", () => {
    const dots = buildMinimapDots(
      [comp({ id: "f1", config: { complexityLevel: "extreme" } }), comp({ id: "f2", config: { complexityLevel: "low", symbolCount: 1 } })],
      proj,
      { selectedIds: ["f2"] }
    );
    expect(dots[0].color).toBe(RISK_TIER_COLORS.critical);
    expect(dots[0].selected).toBe(false);
    expect(dots[1].color).toBe(RISK_TIER_COLORS.healthy);
    expect(dots[1].selected).toBe(true);
  });

  it("分层模式用分层色，取不到分层时回退 neutral", () => {
    const dots = buildMinimapDots(
      [comp({ id: "f1", config: { projectLayerId: "L1" } }), comp({ id: "f2", config: {} })],
      proj,
      { colorMode: "layer", layerColorOf: (c) => ((c.config as any).projectLayerId === "L1" ? "#123456" : undefined) }
    );
    expect(dots[0].color).toBe("#123456");
    expect(dots[1].color).toBe(RISK_TIER_COLORS.neutral);
  });

  it("summarizeTiers 汇总各档位数量", () => {
    const dots = buildMinimapDots(
      [
        comp({ id: "a", config: { complexityLevel: "extreme" } }),
        comp({ id: "b", config: { complexityLevel: "high" } }),
        comp({ id: "c", config: { complexityLevel: "low", symbolCount: 1 } }),
        comp({ id: "d", config: {} }),
      ],
      proj
    );
    const t = summarizeTiers(dots);
    expect(t.critical).toBe(1);
    expect(t.warning).toBe(1);
    expect(t.healthy).toBe(1);
    expect(t.neutral).toBe(1);
  });
});
