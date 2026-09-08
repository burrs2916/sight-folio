/**
 * useVerifyOverlaySync —— 验证结论的跨窗口广播 / 接收。
 *
 * ─── 为什么需要它 ───────────────────────────────────────────────────────
 * AI 面板（含验证闭环）跑在「代码工作台」窗口，而画布在项目主窗口——两者是 Tauri
 * 的两个独立 webview，普通 zustand store 不跨窗口。洞察角标靠「后端落库 + 画布
 * load 取库」解决了跨窗口；验证结论是会话级的即时效应、不落库，所以用 Tauri 全局
 * 事件做实时广播：面板 emit，主窗口 listen 后写本地 store，渲染器照常 O(1) 查表。
 *
 * ─── 与 useInsightOverlaySync 的关系 ───────────────────────────────────
 * 两者在 SceneEditor 并列挂载：insight 管「模型结论长期落库」，verify 管「本次会话
 * AI 改动的即时效应」。数据性质不同，传输机制也不同，但画布消费侧高度同源。
 */
import { useEffect } from "react";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useVerifyOverlayStore } from "../store/verifyOverlayStore";
import type { VerifyFileMark } from "../ai/verifyOverlay";

/** Tauri 全局事件名（面板广播、画布接收共用） */
export const VERIFY_OVERLAY_EVENT = "verify-overlay-update";

/**
 * 把当前窗口聚合出的验证标记广播给所有窗口（含主窗口画布）。
 * 无 Tauri 运行时（纯 web 预览）时静默失败，不影响面板自身逻辑。
 * 携带 `enabled`：画布标注开关必须由面板经此跨窗口下发（store 是每窗口独立实例，
 * 面板本地 setEnabled 不影响画布窗口），否则开关永远是死状态。
 */
export async function broadcastVerify(
  marks: Record<string, VerifyFileMark>,
  enabled?: boolean,
): Promise<void> {
  try {
    await emit(VERIFY_OVERLAY_EVENT, { fileMarks: marks, enabled });
  } catch {
    /* ignore: not in Tauri runtime */
  }
}

/**
 * 挂载在画布所在窗口（SceneEditor）：监听跨窗口广播，写本地 store。
 * 幂等——同窗口内面板也会直接 setEntries，事件到达时覆盖一次，结果一致。
 */
export function useVerifyOverlayListener(): void {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<{ fileMarks: Record<string, VerifyFileMark>; enabled?: boolean }>(VERIFY_OVERLAY_EVENT, (e) => {
      const marks = e.payload?.fileMarks;
      if (marks) useVerifyOverlayStore.getState().applyRemote(marks, e.payload.enabled);
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
