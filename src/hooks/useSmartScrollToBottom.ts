import { useCallback, useEffect, useRef } from 'react';

/**
 * 智能滚底（对标 AiAgentPage 先例）：
 * - 仅在用户「接近底部」时自动滚底；用户上翻阅读历史/中间产物时不被强拉回底部；
 * - 60ms 防抖吸收流式高频更新，避免每 chunk 抖动。
 * 返回 containerRef（挂到滚动容器）与 handleScroll（挂到容器 onScroll）。
 * @param deps 触发滚动检查的依赖（如 [messages, streamingContent, isStreaming]）
 */
export function useSmartScrollToBottom<T extends HTMLElement = HTMLDivElement>(deps: readonly unknown[]) {
  const containerRef = useRef<T | null>(null);
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(() => {
      const el = containerRef.current;
      if (el && isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }, 60);
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
    // deps 由调用方显式提供，禁止隐式推断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { containerRef, handleScroll };
}
