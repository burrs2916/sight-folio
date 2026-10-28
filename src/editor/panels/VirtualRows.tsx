/**
 * 定高虚拟列表容器（R32）
 *
 * 用途：左侧实体面板里那些动辄几千条的分组（审查发现 3800+、符号 5200+、
 * 技术债、死代码、变更耦合）。此前靠 `slice(0, 40)` 硬截断才不卡，
 * 代价是 99% 的分析结果用户永远看不到。
 *
 * 设计取舍：
 * - **只支持定高行**。面板行本来就是统一样式（图标 + 标题 + 副标题），
 *   定高换来的是零测量、零 ResizeObserver、算术即可，滚动不会抖。
 * - **小列表不虚拟化**。`threshold` 以下直接全量渲染，避免为 5 条数据
 *   套一层内滚动容器（内滚动在窄面板里是种打扰）。
 * - **内滚动 + maxHeight**。每个分组自带滚动区，长分组不再把其它分组
 *   挤到外层滚动条的几千像素以下 —— 这比一条超长外滚动更好找东西。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { computeVirtualWindow } from "../utils/virtualList";

export interface VirtualRowsProps<T> {
  items: readonly T[];
  /** 单行高度（px），必须与 renderRow 实际渲染高度一致 */
  rowHeight: number;
  /** 滚动区最大高度（px），超过则内部滚动 */
  maxHeight?: number;
  /** 条目数 ≤ threshold 时不启用虚拟化，直接平铺 */
  threshold?: number;
  keyOf: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => React.ReactNode;
  /** 空列表时展示的内容 */
  empty?: React.ReactNode;
}

export function VirtualRows<T>({
  items,
  rowHeight,
  maxHeight = 280,
  threshold = 30,
  keyOf,
  renderRow,
  empty,
}: VirtualRowsProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const ticking = useRef(false);

  // 滚动事件走 rAF 节流：滚动可以每帧几十次触发，直接 setState 会让
  // 大列表在快速滚动时反复重渲染（与 R29 画布视口直写 DOM 同一思路）。
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      setScrollTop(top);
    });
  }, []);

  const virtualized = items.length > threshold;

  const win = useMemo(
    () =>
      computeVirtualWindow({
        itemCount: items.length,
        rowHeight,
        scrollTop,
        viewportHeight: maxHeight,
      }),
    [items.length, rowHeight, scrollTop, maxHeight]
  );

  if (items.length === 0) return <>{empty ?? null}</>;

  if (!virtualized) {
    return (
      <>
        {items.map((it, i) => (
          <Box key={keyOf(it, i)} sx={{ height: rowHeight, overflow: "hidden" }}>
            {renderRow(it, i)}
          </Box>
        ))}
      </>
    );
  }

  const slice = items.slice(win.startIndex, win.endIndex);

  return (
    <Box
      onScroll={handleScroll}
      sx={{
        maxHeight,
        overflowY: "auto",
        overflowX: "hidden",
        // 与外层面板滚动条风格一致（4px 细条）
        "&::-webkit-scrollbar": { width: 4 },
      }}
    >
      <Box sx={{ height: win.totalHeight, position: "relative" }}>
        <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${win.offsetY}px)` }}>
          {slice.map((it, i) => (
            <Box key={keyOf(it, win.startIndex + i)} sx={{ height: rowHeight, overflow: "hidden" }}>
              {renderRow(it, win.startIndex + i)}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default VirtualRows;
