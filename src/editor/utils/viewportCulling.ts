// sight-folio: 画布实体视口虚拟化（性能优化）
//
// 大项目（数百实体）同步到画布后，EditorCanvas 会对每个实体渲染完整
// EditorCanvasComponent（含 renderer 渲染器）。视口外实体仍在 DOM 中，
// 拖拽/缩放/平移时全量参与布局与绘制 → 卡顿根因。
//
// 本模块提供纯函数 computeVisibleEntityIds：按 viewport（offset+scale）
// 将实体画布坐标投影到屏幕坐标，与容器视口（含 padding 缓冲）相交者
// 才返回为可见。选中/悬停实体始终可见（用户正在交互，必须保持渲染）。
// 纯函数零依赖，便于单测。

import type { SceneComponent } from "../../types/editor";

export interface VirtualViewport {
  scale: number;
  offset: { x: number; y: number };
}

export interface VirtualContainer {
  width: number;
  height: number;
}

export interface VirtualCullingOptions {
  /** 视口外缓冲（px），避免边缘实体闪烁，默认 400 */
  padding?: number;
  selectedIds?: readonly string[];
  hoveredId?: string | null;
}

/** 实体在画布坐标系中的包围盒（rotation 忽略，取 AABB 上界近似） */
export function entityScreenBounds(
  comp: Pick<SceneComponent, "transform">,
  vp: VirtualViewport
): { x: number; y: number; width: number; height: number } {
  const { x, y, width, height } = comp.transform;
  // 旋转 45° 时 AABB 扩大约 1.414 倍；简单按对角线放大上界处理
  const rot = (comp.transform.rotation || 0) % 360;
  const hasRotation = Math.abs(rot) > 0.01 && Math.abs(Math.abs(rot) - 180) > 0.01;
  const inflate = hasRotation ? 1.5 : 1;
  return {
    x: vp.offset.x + x * vp.scale,
    y: vp.offset.y + y * vp.scale,
    width: width * vp.scale * inflate,
    height: height * vp.scale * inflate,
  };
}

/**
 * 计算应渲染的实体 id 集合。
 * - 投影到屏幕坐标，与 [−padding, w+padding]×[−padding, h+padding] 相交才可见
 * - 选中/悬停实体无条件可见（交互必须保持）
 */
export function computeVisibleEntityIds(
  components: readonly Pick<SceneComponent, "id" | "transform" | "visible">[],
  vp: VirtualViewport,
  container: VirtualContainer,
  options: VirtualCullingOptions = {}
): Set<string> {
  const { padding = 400, selectedIds = [], hoveredId = null } = options;
  const sel = new Set(selectedIds as readonly string[]);
  const minX = -padding;
  const minY = -padding;
  const maxX = container.width + padding;
  const maxY = container.height + padding;
  const visible = new Set<string>();

  for (const comp of components) {
    if (!comp.visible) continue;
    if (sel.has(comp.id) || comp.id === hoveredId) {
      visible.add(comp.id);
      continue;
    }
    const b = entityScreenBounds(comp, vp);
    // AABB 相交判定
    if (b.x + b.width < minX || b.x > maxX || b.y + b.height < minY || b.y > maxY) {
      continue;
    }
    visible.add(comp.id);
  }
  return visible;
}

/**
 * 从画布组件数组中筛出「需要渲染」的子集（可见 + 选中/悬停 + 保底阈值）。
 * components 已按 zIndex 排序时返回顺序不变。
 */
export function cullOffscreenEntities<T extends Pick<SceneComponent, "id" | "transform" | "visible">>(
  components: readonly T[],
  vp: VirtualViewport,
  container: VirtualContainer,
  options: VirtualCullingOptions = {}
): T[] {
  const visible = computeVisibleEntityIds(components, vp, container, options);
  return components.filter((c) => visible.has(c.id));
}
