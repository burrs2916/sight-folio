import { describe, it, expect } from "vitest";
import {
  backgroundCss,
  clampScale,
  contentBounds,
  fitViewport,
  panBy,
  screenToCanvas,
  transformCss,
  viewportEquals,
  zoomAtPoint,
  type CanvasViewport,
} from "../panZoom";

const LIMITS = { min: 0.2, max: 3 };

describe("clampScale", () => {
  it("钳制到区间并归一到 2 位小数", () => {
    expect(clampScale(5, LIMITS)).toBe(3);
    expect(clampScale(0.01, LIMITS)).toBe(0.2);
    expect(clampScale(1.23456, LIMITS)).toBe(1.23);
  });
});

describe("zoomAtPoint", () => {
  it("锚点在缩放前后指向同一个画布坐标（鼠标指着哪就放大哪）", () => {
    const vp: CanvasViewport = { scale: 1, offset: { x: 30, y: -20 } };
    const anchor = { x: 400, y: 250 };
    const before = screenToCanvas(vp, anchor.x, anchor.y);
    const next = zoomAtPoint(vp, 1.6, anchor, LIMITS);
    const after = screenToCanvas(next, anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.scale).toBe(1.6);
  });

  it("触顶时返回原对象（不产生无意义的 state 变更）", () => {
    const vp: CanvasViewport = { scale: 3, offset: { x: 0, y: 0 } };
    expect(zoomAtPoint(vp, 4, { x: 10, y: 10 }, LIMITS)).toBe(vp);
  });
});

describe("panBy / screenToCanvas", () => {
  it("平移只改 offset", () => {
    const vp: CanvasViewport = { scale: 2, offset: { x: 10, y: 10 } };
    const next = panBy(vp, -5, 25);
    expect(next).toEqual({ scale: 2, offset: { x: 5, y: 35 } });
  });

  it("屏幕坐标反算画布坐标", () => {
    const vp: CanvasViewport = { scale: 2, offset: { x: 100, y: 50 } };
    expect(screenToCanvas(vp, 300, 150)).toEqual({ x: 100, y: 50 });
  });
});

describe("transformCss / backgroundCss", () => {
  it("DOM 直写与 React 渲染共用同一公式", () => {
    const vp: CanvasViewport = { scale: 1.5, offset: { x: 12, y: -8 } };
    expect(transformCss(vp)).toBe("translate(12px, -8px) scale(1.5)");
    expect(backgroundCss(vp)).toEqual({
      backgroundSize: "30px 30px",
      backgroundPosition: "12px -8px",
    });
  });
});

describe("viewportEquals", () => {
  it("亚像素差异视为相等，避免节流 commit 触发无谓重渲染", () => {
    const a: CanvasViewport = { scale: 1, offset: { x: 0, y: 0 } };
    expect(viewportEquals(a, { scale: 1, offset: { x: 0.2, y: -0.3 } })).toBe(true);
    expect(viewportEquals(a, { scale: 1, offset: { x: 2, y: 0 } })).toBe(false);
    expect(viewportEquals(a, { scale: 1.1, offset: { x: 0, y: 0 } })).toBe(false);
  });
});

describe("contentBounds / fitViewport", () => {
  const items = [
    { transform: { x: 0, y: 0, width: 100, height: 50 } },
    { transform: { x: 400, y: 200, width: 100, height: 50 } },
  ];

  it("包围盒覆盖全部实体", () => {
    expect(contentBounds(items)).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 250 });
    expect(contentBounds([])).toBeNull();
  });

  it("全览把内容居中于视口", () => {
    const vp = fitViewport(contentBounds(items), { width: 1000, height: 600 }, LIMITS, 80);
    expect(vp).not.toBeNull();
    // 内容中心 (250,125) 应落在视口中心 (500,300)
    const cx = 250 * vp!.scale + vp!.offset.x;
    const cy = 125 * vp!.scale + vp!.offset.y;
    expect(cx).toBeCloseTo(500, 6);
    expect(cy).toBeCloseTo(300, 6);
  });

  it("无内容 / 视口未就绪时返回 null（回退全量渲染，不炸）", () => {
    expect(fitViewport(null, { width: 1000, height: 600 }, LIMITS)).toBeNull();
    expect(fitViewport(contentBounds(items), { width: 0, height: 0 }, LIMITS)).toBeNull();
  });
});
