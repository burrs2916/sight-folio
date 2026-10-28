// sight-folio: 画布平移/缩放 —— 脱离 React 渲染循环的实现
//
// 为什么要这么写（用户反复反馈「非常卡顿，不够流畅」的第三层根因）：
//
//   旧实现：onMouseMove → setPanOffset(...) → React 重渲染 ProjectCanvas
//           → 重跑 computeVisibleEntityIds（O(N)）
//           → 重跑 map 循环，逐实体重算 emphasis / layerColor
//           → 上百个 memo 节点做 props 浅比较
//   一次拖拽手势 = 上百次上述流程。实体上千时必然掉帧。
//
//   新实现：视口权威值存在 ref 里。手势期间用 rAF 合并，**直接写 DOM
//           style.transform**（浏览器合成层，零 React 参与）；只在节流点
//           （默认 120ms）与手势结束时 commit 一次 state，让视口虚拟化窗口
//           跟上。于是拖动 60fps 期间 React 渲染次数从 ~100 降到 ~8。
//
// 另外顺手修掉两个交互硬伤：
//   1. 缩放锚点：原来固定以容器左上角为原点缩放，鼠标指着的内容会飞走。
//      现在以光标为锚点（zoomAtPoint）。
//   2. 滚轮：原来必须 Ctrl+滚轮才有反应，普通滚轮什么都不做。现在普通滚轮
//      平移（支持触控板双指），Ctrl/Cmd+滚轮缩放。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  backgroundCss,
  clampScale,
  panBy,
  screenToCanvas,
  transformCss,
  viewportEquals,
  zoomAtPoint,
  type CanvasViewport,
  type ZoomLimits,
} from "../utils/panZoom";

export interface UseCanvasPanZoomOptions {
  /** 视口容器（事件源 + 网格背景载体） */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 变换容器（实体挂载点，transform 写在它身上） */
  contentRef: React.RefObject<HTMLDivElement | null>;
  limits?: ZoomLimits;
  zoomStep?: number;
  /** 手势期间 state commit 的最小间隔（ms），越大越省渲染、虚拟化窗口越滞后 */
  commitIntervalMs?: number;
  gridSize?: number;
  /** 触发平移的鼠标键：默认中键(1)/右键(2)；空格或 alt+左键也可由调用方补 */
  panButtons?: number[];
}

export interface CanvasPanZoomApi {
  /** 用于虚拟化裁剪与 UI 显示的视口快照（节流更新，不是每帧） */
  viewport: CanvasViewport;
  /** 权威实时视口（ref，读取不触发渲染；事件处理里用它） */
  viewportRef: React.MutableRefObject<CanvasViewport>;
  isPanning: boolean;
  /** 直接设置视口（fit / 按钮缩放）—— 立即应用并 commit */
  setViewport: (next: CanvasViewport) => void;
  /** 平滑设置视口（聚焦联动居中）—— easeOutCubic 插值滑入，默认 320ms */
  setViewportAnimated: (next: CanvasViewport, durationMs?: number) => void;
  /** 以视口中心为锚点按步长缩放（工具条 +/- 按钮） */
  zoomByStep: (direction: 1 | -1) => void;
  resetViewport: () => void;
  /** 屏幕坐标（clientX/clientY）→ 画布坐标，供拖放落点计算 */
  clientToCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  /** 挂到视口容器上的鼠标事件（wheel 用原生监听器，不在这里） */
  handlers: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

const DEFAULT_LIMITS: ZoomLimits = { min: 0.2, max: 3 };

export function useCanvasPanZoom(options: UseCanvasPanZoomOptions): CanvasPanZoomApi {
  const {
    containerRef,
    contentRef,
    limits = DEFAULT_LIMITS,
    zoomStep = 0.1,
    commitIntervalMs = 120,
    gridSize = 20,
    panButtons = [1, 2],
  } = options;

  const [viewport, setViewportState] = useState<CanvasViewport>({ scale: 1, offset: { x: 0, y: 0 } });
  const [isPanning, setIsPanning] = useState(false);

  const liveRef = useRef<CanvasViewport>(viewport);
  const rafRef = useRef<number | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitAtRef = useRef(0);
  const panningRef = useRef(false);
  const panOriginRef = useRef({ x: 0, y: 0 });
  // 聚焦联动的平滑居中动画帧（与 scheduleDom 的 rafRef 分离，互不干扰）
  const animRafRef = useRef<number | null>(null);

  /** 把 live 视口直接写进 DOM（零 React） */
  const applyDom = useCallback(() => {
    const vp = liveRef.current;
    const content = contentRef.current;
    if (content) content.style.transform = transformCss(vp);
    const container = containerRef.current;
    if (container) {
      const bg = backgroundCss(vp, gridSize);
      container.style.backgroundSize = bg.backgroundSize;
      container.style.backgroundPosition = bg.backgroundPosition;
    }
  }, [containerRef, contentRef, gridSize]);

  const scheduleDom = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyDom();
    });
  }, [applyDom]);

  /** 节流 commit：让虚拟化窗口跟上，但不是每帧 */
  const commit = useCallback(
    (force = false) => {
      const now = performance.now();
      const doCommit = () => {
        lastCommitAtRef.current = performance.now();
        commitTimerRef.current = null;
        setViewportState((prev) => (viewportEquals(prev, liveRef.current) ? prev : { ...liveRef.current }));
      };
      if (force) {
        if (commitTimerRef.current) {
          clearTimeout(commitTimerRef.current);
          commitTimerRef.current = null;
        }
        doCommit();
        return;
      }
      if (now - lastCommitAtRef.current >= commitIntervalMs) {
        doCommit();
        return;
      }
      if (commitTimerRef.current == null) {
        commitTimerRef.current = setTimeout(doCommit, commitIntervalMs - (now - lastCommitAtRef.current));
      }
    },
    [commitIntervalMs]
  );

  /** 手势内更新：DOM 立即（rAF 合并），state 节流 */
  const applyLive = useCallback(
    (next: CanvasViewport, forceCommit = false) => {
      liveRef.current = next;
      scheduleDom();
      commit(forceCommit);
    },
    [commit, scheduleDom]
  );

  const setViewport = useCallback(
    (next: CanvasViewport) => {
      applyLive({ scale: clampScale(next.scale, limits), offset: { ...next.offset } }, true);
    },
    [applyLive, limits]
  );

  // 聚焦联动：把当前视口 easeOutCubic 插值到目标，平滑滑入而非瞬移。
  // 每帧 applyLive（节流 commit 让虚拟化窗口跟随滑动），结束强制 commit；
  // 过程中新请求到来取消上一动画，避免多段居中互相抢帧。
  const setViewportAnimated = useCallback(
    (next: CanvasViewport, durationMs = 320) => {
      if (animRafRef.current != null) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
      const from = liveRef.current;
      const to = { scale: clampScale(next.scale, limits), offset: { ...next.offset } };
      // 起点终点几乎一致则直接落位，省去无谓 rAF
      if (
        Math.abs(from.scale - to.scale) < 1e-3 &&
        Math.abs(from.offset.x - to.offset.x) < 0.5 &&
        Math.abs(from.offset.y - to.offset.y) < 0.5
      ) {
        applyLive(to, true);
        return;
      }
      const t0 = performance.now();
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / durationMs);
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic：先快后缓，落位自然
        applyLive(
          {
            scale: lerp(from.scale, to.scale, e),
            offset: { x: lerp(from.offset.x, to.offset.x, e), y: lerp(from.offset.y, to.offset.y, e) },
          },
          false
        );
        if (p < 1) {
          animRafRef.current = requestAnimationFrame(step);
        } else {
          applyLive(to, true);
          animRafRef.current = null;
        }
      };
      animRafRef.current = requestAnimationFrame(step);
    },
    [applyLive, limits]
  );

  const zoomByStep = useCallback(
    (direction: 1 | -1) => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const anchor = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
      applyLive(zoomAtPoint(liveRef.current, liveRef.current.scale + direction * zoomStep, anchor, limits), true);
    },
    [applyLive, containerRef, limits, zoomStep]
  );

  const resetViewport = useCallback(() => {
    applyLive({ scale: 1, offset: { x: 0, y: 0 } }, true);
  }, [applyLive]);

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sx = rect ? clientX - rect.left : clientX;
      const sy = rect ? clientY - rect.top : clientY;
      return screenToCanvas(liveRef.current, sx, sy);
    },
    [containerRef]
  );

  // ─── 原生 wheel 监听（React 的 onWheel 是 passive，无法 preventDefault）───
  // G1 止血（载体设计视图不可滚诊断）：事件 target 存在「实际可滚动」的祖先元素时
  // 放行原生滚动——此前无条件 preventDefault 把载体卡内 overflowY 列表的滚动
  // 整个杀掉（内容一多列表永远滚不动，滚轮全变成平移画布）。
  // 判定标准：祖先 overflow 为 auto/scroll/overlay 且内容确有溢出；
  // 再校验滚轮方向上是否还有滚动余量（到边缘则回落画布平移，不白吃手势）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const findScrollableAncestor = (start: EventTarget | null): HTMLElement | null => {
      let node = start instanceof HTMLElement ? start : null;
      while (node && node !== el && node !== document.body) {
        const style = window.getComputedStyle(node);
        const overflowRe = /(auto|scroll|overlay)/;
        const canY = overflowRe.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
        const canX = overflowRe.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
        if (canY || canX) return node;
        node = node.parentElement;
      }
      return null;
    };
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // deltaY<0 = 向上滚 = 放大
        const dir = e.deltaY > 0 ? -1 : 1;
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        applyLive(zoomAtPoint(liveRef.current, liveRef.current.scale + dir * zoomStep, anchor, limits));
        return;
      }
      // 普通滚轮/触控板双指：命中可滚动祖先（且该方向有滚动余量）→ 放行原生滚动
      const scrollable = findScrollableAncestor(e.target);
      if (scrollable) {
        const hasRoomY =
          scrollable.scrollHeight > scrollable.clientHeight + 1 &&
          ((e.deltaY < 0 && scrollable.scrollTop > 0) ||
            (e.deltaY > 0 && scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 1) ||
            e.deltaY === 0);
        const hasRoomX =
          scrollable.scrollWidth > scrollable.clientWidth + 1 &&
          ((e.deltaX < 0 && scrollable.scrollLeft > 0) ||
            (e.deltaX > 0 && scrollable.scrollLeft + scrollable.clientWidth < scrollable.scrollWidth - 1) ||
            e.deltaX === 0);
        if (hasRoomY || hasRoomX) return; // 不 preventDefault，交还原生滚动
      }
      // 否则 = 平移画布（原实现完全无响应的历史行为保留）
      e.preventDefault();
      applyLive(panBy(liveRef.current, -e.deltaX, -e.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyLive, containerRef, limits, zoomStep]);

  // ─── 平移手势：window 级监听，鼠标移出容器也不中断 ───
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!panButtons.includes(e.button)) return;
      e.preventDefault();
      panningRef.current = true;
      setIsPanning(true);
      panOriginRef.current = { x: e.clientX, y: e.clientY };
    },
    [panButtons]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panningRef.current) return;
      const dx = e.clientX - panOriginRef.current.x;
      const dy = e.clientY - panOriginRef.current.y;
      panOriginRef.current = { x: e.clientX, y: e.clientY };
      applyLive(panBy(liveRef.current, dx, dy));
    };
    const onUp = () => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setIsPanning(false);
      commit(true); // 手势结束立即校准虚拟化窗口
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [applyLive, commit]);

  // 任何一次 React 渲染后都把 live 值重新写回 DOM。
  // 原因：外部 store 更新（选中变化/实体增删）会触发重渲染，若 sx 里带着
  // 滞后的 state transform，画面会「回弹」。这里兜底保证 DOM 永远是 live 值。
  useLayoutEffect(() => {
    applyDom();
  });

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (animRafRef.current != null) cancelAnimationFrame(animRafRef.current);
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    },
    []
  );

  return {
    viewport,
    viewportRef: liveRef,
    isPanning,
    setViewport,
    setViewportAnimated,
    zoomByStep,
    resetViewport,
    clientToCanvas,
    handlers: { onMouseDown },
  };
}
