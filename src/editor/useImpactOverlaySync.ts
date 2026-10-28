/**
 * useImpactOverlaySync —— 影响面（爆炸半径）的跨窗口广播 / 接收（R18）。
 *
 * ─── 为什么需要它 ───────────────────────────────────────────────────────
 * AI 面板（含影响面计算）跑在「代码工作台」窗口，而画布在项目主窗口——两者是 Tauri
 * 的两个独立 webview，普通 zustand store 不跨窗口。影响面是会话级的即时认知
 * （由当前焦点的调用图反向闭包算出），不落库，所以用 Tauri 全局事件做实时广播：
 * 面板 emit，主窗口 listen 后写本地 store，渲染器照常 O(1) 查表。
 *
 * ─── 与 useVerifyOverlaySync 的关系 ───────────────────────────────────
 * 两者在 SceneEditor 并列挂载。verify 管「本次 AI 改动的即时效应」，impact 管
 * 「改动此焦点的爆炸半径」——数据性质不同，传输机制同源（Tauri 全局事件）。
 */
import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useImpactOverlayStore } from "../store/impactOverlayStore";

/** Tauri 全局事件名（面板广播、画布接收共用） */
export const AI_IMPACT_EVENT = "ai-impact-update";

/**
 * 把当前窗口算出的影响面 relPath 集合广播给所有窗口（含主窗口画布）。
 * 无 Tauri 运行时（纯 web 预览）时静默失败，不影响面板自身逻辑。
 * 携带 `enabled`：画布标注开关必须由面板经此跨窗口下发（store 是每窗口独立实例，
 * 面板本地 setEnabled 不影响画布窗口），否则开关永远只作用于本窗口。
 */
export async function broadcastImpact(relPaths: string[], enabled?: boolean): Promise<void> {
  try {
    await emit(AI_IMPACT_EVENT, { relPaths, enabled });
  } catch {
    /* ignore: not in Tauri runtime */
  }
}

/**
 * 挂载在画布所在窗口（SceneEditor）：监听跨窗口广播，写本地 store。
 * 幂等——同窗口内面板也会直接 setPaths，事件到达时覆盖一次，结果一致。
 */
export function useImpactOverlayListener(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<{ relPaths: string[]; enabled?: boolean }>(AI_IMPACT_EVENT, (e) => {
      const relPaths = e.payload?.relPaths;
      if (relPaths) useImpactOverlayStore.getState().applyRemote(relPaths, e.payload.enabled);
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* ignore: listener not available */
      });
    return () => {
      unlisten?.();
    };
  }, []);
}
