// 画布缩放/虚拟化常量
export const ZOOM_STEP = 0.1;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3.0;
/**
 * 虚拟化缓冲。视口 state 是节流提交的（手势期间最多滞后 commitIntervalMs），
 * 缓冲要覆盖这段时间内可能划过的距离，否则快速平移时边缘会闪白。
 */
export const CULL_PADDING = 700;
