// 「正文视图 ↔ 章详情/设定卡」切换的滚动位置记忆（2026-10-31 第六轮）
//
// 病灶：编辑器滚动容器（editorScrollRef 那个 Box）与 EditorContent 同在 rightTab==='body'
// 分支里——切到「章详情」或打开设定卡时整个分支被卸载，切回「正文」时是**全新挂载的 DOM**
// （scrollTop 归零）。而批次③ 的「按章记忆滚动位置」只在换章 effect 里记录/恢复，
// 同一章内切视图根本走不到那个 effect（loadedChapterIdRef 未变）——
// 长文滚到中部，点一下「章详情」看一眼再回来，正文直接跳回顶部。
//
// 修法：滚动容器随 body 分支挂载/卸载这一生命周期就是事实来源，按它记账：
// - body 可见期间监听 scroll 实时把位置写进 memory（rAF 节流）；
// - 卸载前（切去章详情/设定卡，或换章）cleanup 定格最新值；
// - 重新挂载（切回正文）时按当前章恢复——恢复走 rAF，等浏览器完成内容布局再跳位。
// 与换章 effect 共用同一个 memory Map：换章路径由旧 effect 恢复（零回归），
// 同章切视图路径由本 hook 补齐（正是要修的洞）。
import { useEffect, type RefObject } from 'react';

export interface EditorScrollMemoryOptions {
  /** 滚动容器 ref：随「正文」分支挂载/卸载（切章详情/设定卡即卸载） */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 正文分支是否处于挂载可见态（rightTab==='body' 且未被设定卡顶掉） */
  bodyVisible: boolean;
  /** 当前激活章 id（null = 未选章，不记账） */
  chapterId: string | null;
  /** 跨章位置记忆 Map（与换章 effect 共用引用；ref.current 传入，稳定） */
  memory: Map<string, number>;
}

export function useEditorScrollMemory({ scrollRef, bodyVisible, chapterId, memory }: EditorScrollMemoryOptions) {
  useEffect(() => {
    if (!bodyVisible || !chapterId) return;
    const el = scrollRef.current;
    if (!el) return;
    // 回到正文视图：先恢复离开时定格的位置
    const saved = memory.get(chapterId);
    if (saved && saved > 0) {
      requestAnimationFrame(() => {
        if (scrollRef.current === el) el.scrollTop = saved;
      });
    }
    // 滚动实时落账（rAF 节流）；卸载（切走视图/换章）前再定格一次最新值
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (scrollRef.current) memory.set(chapterId, scrollRef.current.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      memory.set(chapterId, el.scrollTop);
    };
  }, [scrollRef, bodyVisible, chapterId, memory]);
}
