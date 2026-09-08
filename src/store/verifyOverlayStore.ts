/**
 * verifyOverlayStore —— 验证结论在「视图侧」的唯一数据源（画布角标消费它）。
 *
 * 与 insightOverlayStore 同源模式：渲染器用 `selectVerifyMark(path)` 做 O(1) 查表，
 * 无标记时取到 undefined → 几百个文件实体一个都不重渲染。区别在数据源——
 * insight 来自后端库（load 取库），verify 来自本次会话的实时结算（面板 setEntries
 * 写入 + 跨窗口 Tauri 全局事件广播 applyRemote），不落库。
 *
 * 为什么单独立一个 store：验证角标与洞察角标是两个独立信息（客观度量变化 vs 模型
 * 判断），且生命周期不同（验证随会话、洞察跨会话），混在一起会让两边刷新互相拖累。
 */
import { create } from "zustand";
import {
  computeVerifyMarks,
  bubbleDirVerifyMarks,
  type VerifyEntryLite,
  type VerifyFileMark,
} from "../ai/verifyOverlay";

interface VerifyOverlayState {
  /** relPath → 验证标记 */
  fileMarks: Record<string, VerifyFileMark>;
  /** 目录路径 → 验证标记（文件标记沿路径冒泡聚合，见 bubbleDirVerifyMarks） */
  dirMarks: Record<string, VerifyFileMark>;
  /** 画布是否显示验证角标（用户可关，避免与洞察角标抢注意力） */
  enabled: boolean;
  /** 面板每次结算后写入完整条目列表（上限 20），store 内部一次性聚合 */
  setEntries: (entries: readonly VerifyEntryLite[]) => void;
  /** 跨窗口事件收到的远端标记（直接覆盖，保持与来源窗口一致） */
  applyRemote: (marks: Record<string, VerifyFileMark>, enabled?: boolean) => void;
  setEnabled: (v: boolean) => void;
  clear: () => void;
}

const initialVerifyCanvas = (() => {
  try {
    const v = localStorage.getItem("ps.workbench.verifyCanvas");
    return v === null ? false : v === "1";
  } catch {
    return false;
  }
})();

export const useVerifyOverlayStore = create<VerifyOverlayState>((set) => ({
  fileMarks: {},
  dirMarks: {},
  // Opt-in by default (VS Code-style): AI verification marks do not stain the
  // canvas unless the user enables the "画布标注" toggle in the panel.
  // A previously enabled choice is restored from localStorage.
  enabled: initialVerifyCanvas,

  setEntries: (entries) => {
    const fileMarks = computeVerifyMarks(entries);
    set({ fileMarks, dirMarks: bubbleDirVerifyMarks(fileMarks) });
  },

  applyRemote: (marks, enabled) =>
    set((s) => ({
      fileMarks: marks,
      dirMarks: bubbleDirVerifyMarks(marks),
      enabled: enabled === undefined ? s.enabled : enabled,
    })),

  setEnabled: (v) => {
    try {
      localStorage.setItem("ps.workbench.verifyCanvas", v ? "1" : "0");
    } catch {
      /* ignore persistence failure */
    }
    set({ enabled: v });
  },

  clear: () => set({ fileMarks: {}, dirMarks: {} }),
}));

/**
 * 渲染器专用选择器：关掉画布标注时直接返回 undefined，
 * 让几百个渲染器在「开关关闭」这个常见状态下彻底不参与重渲染。
 */
export function selectVerifyMark(path: string | undefined) {
  return (s: VerifyOverlayState): VerifyFileMark | undefined =>
    !path || !s.enabled ? undefined : s.fileMarks[path];
}

/**
 * 目录级验证标记选择器：返回该目录子树内「最坏 verdict」的聚合标记。
 * 关掉画布标注或该目录无子树改动时取到 undefined → 目录卡零重渲染（与 selectVerifyMark 同源）。
 */
export function selectDirVerifyMark(dirPath: string | undefined) {
  return (s: VerifyOverlayState): VerifyFileMark | undefined =>
    !dirPath || !s.enabled ? undefined : s.dirMarks[dirPath];
}
