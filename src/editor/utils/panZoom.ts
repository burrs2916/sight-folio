// project-sight: 画布视口变换纯函数（平移 / 锚点缩放 / 钳制）
//
// 背景（卡顿根因第三刀）：
// ProjectCanvas 原先把 scale/panOffset 直接放在 React state 里，鼠标每移动一
// 像素就 setState 一次 —— 一次平移手势会触发上百次 React reconciliation，每次
// 都要重跑虚拟化裁剪、重算全部可见实体的强调态、重建 map 循环。数百实体时
// 必然掉帧。
//
// 解决思路（画布类应用标准做法）：把「视口权威值」放进 ref，手势期间用 rAF
// 直接写 DOM transform（零 React 渲染），只在节流点/手势结束时 commit 一次
// state 让虚拟化窗口跟上。本模块提供其中**与 React 无关的纯计算**，便于单测：
//
// - clampScale：缩放钳制 + 精度归一
// - zoomAtPoint：以光标为锚点缩放（原实现固定以左上角为原点，缩放时内容会
//   飞走，是体验上的硬伤）
// - panBy：平移
// - transformCss / backgroundPositionCss：把视口转成 CSS 字符串，DOM 直写与
//   React 渲染两条路径共用同一份公式，避免 commit 时画面跳变

export interface CanvasViewport {
  scale: number;
  offset: { x: number; y: number };
}

export interface ZoomLimits {
  min: number;
  max: number;
}

/** 缩放钳制到 [min, max]，并归一到 2 位小数（避免浮点尾数导致 transform 抖动） */
export function clampScale(value: number, limits: ZoomLimits): number {
  const v = Math.max(limits.min, Math.min(limits.max, value));
  return Math.round(v * 100) / 100;
}

/**
 * 以容器内某点（相对容器左上角的像素坐标）为锚点缩放。
 * 锚点在缩放前后指向同一个画布坐标 —— 即「鼠标指着哪就放大哪」。
 *
 * 推导：canvasPt = (screenPt - offset) / scale；要求缩放后 canvasPt 不变，
 * 则 offset' = screenPt - (screenPt - offset) * (scale' / scale)。
 */
export function zoomAtPoint(
  vp: CanvasViewport,
  nextScaleRaw: number,
  anchor: { x: number; y: number },
  limits: ZoomLimits
): CanvasViewport {
  const nextScale = clampScale(nextScaleRaw, limits);
  if (nextScale === vp.scale) return vp;
  const ratio = nextScale / vp.scale;
  return {
    scale: nextScale,
    offset: {
      x: anchor.x - (anchor.x - vp.offset.x) * ratio,
      y: anchor.y - (anchor.y - vp.offset.y) * ratio,
    },
  };
}

/** 平移（屏幕像素增量） */
export function panBy(vp: CanvasViewport, dx: number, dy: number): CanvasViewport {
  return { scale: vp.scale, offset: { x: vp.offset.x + dx, y: vp.offset.y + dy } };
}

/** 屏幕坐标（相对容器）→ 画布坐标 */
export function screenToCanvas(vp: CanvasViewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - vp.offset.x) / vp.scale, y: (sy - vp.offset.y) / vp.scale };
}

/** 变换容器的 CSS transform（DOM 直写与 React 渲染共用同一公式） */
export function transformCss(vp: CanvasViewport): string {
  return `translate(${vp.offset.x}px, ${vp.offset.y}px) scale(${vp.scale})`;
}

/** 网格背景的 CSS（随视口移动，制造「画布在动」的空间感） */
export function backgroundCss(vp: CanvasViewport, gridSize = 20): {
  backgroundSize: string;
  backgroundPosition: string;
} {
  const s = gridSize * vp.scale;
  return {
    backgroundSize: `${s}px ${s}px`,
    backgroundPosition: `${vp.offset.x}px ${vp.offset.y}px`,
  };
}

/** 两个视口是否「实质相等」（避免 commit 无意义的 state 更新触发重渲染） */
export function viewportEquals(a: CanvasViewport, b: CanvasViewport, eps = 0.5): boolean {
  return (
    Math.abs(a.scale - b.scale) < 1e-4 &&
    Math.abs(a.offset.x - b.offset.x) < eps &&
    Math.abs(a.offset.y - b.offset.y) < eps
  );
}

/**
 * 计算「全览」视口：把内容包围盒缩放平移到视口内居中。
 * 返回 null 表示无内容 / 视口未就绪。
 */
export function fitViewport(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  container: { width: number; height: number },
  limits: ZoomLimits,
  padding = 80
): CanvasViewport | null {
  if (!bounds) return null;
  const boxW = bounds.maxX - bounds.minX;
  const boxH = bounds.maxY - bounds.minY;
  if (!(boxW > 0) || !(boxH > 0)) return null;
  if (!(container.width > 0) || !(container.height > 0)) return null;
  const scale = clampScale(
    Math.min((container.width - padding * 2) / boxW, (container.height - padding * 2) / boxH),
    limits
  );
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    offset: { x: container.width / 2 - cx * scale, y: container.height / 2 - cy * scale },
  };
}

/** 从实体列表求包围盒（fitViewport 的输入） */
export function contentBounds(
  items: readonly { transform: { x: number; y: number; width: number; height: number } }[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    const { x, y } = it.transform;
    const w = it.transform.width || 0;
    const h = it.transform.height || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!isFinite(minX) || !isFinite(maxX)) return null;
  return { minX, minY, maxX, maxY };
}
