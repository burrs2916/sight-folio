/**
 * insightOverlayStore —— AI 洞察在「视图侧」的唯一数据源。
 *
 * ─── 为什么要单独立一个 store ───────────────────────────────────────────
 * 洞察此前由 AiInsightsPanel 用局部 useState 自己拉自己存。只要消费方从一个
 * 变成两个（右侧列表 + 画布角标），局部 state 立刻出两个问题：
 *   1. **重复查库**：面板拉一次、画布拉一次，同一份数据取两遍还可能取到不同快照；
 *   2. **刷新不同步**：Agent 跑完只有面板知道要刷新，画布上的角标还停在上一轮，
 *      用户看到列表里冒出新的严重问题、画布却纹丝不动 —— 比不显示更糟。
 * 所以把「洞察原始列表 + 已对齐到实体的标记表 + 画布开关」收拢到一处，
 * 谁需要谁订阅，一次加载全员同步。
 *
 * ─── 性能上的取舍 ───────────────────────────────────────────────────────
 * FileRenderer 是画布上实例最多的组件（几百个），它订阅本 store 的方式是
 * `s.fileMarks[path]`：没有洞察时全员取到 undefined，Object.is 相等，
 * 不会触发任何重渲染；加载完成后按需渲染一次。标记表在 load 时**一次性算好**
 * （见 insightOverlay.buildInsightMarks），渲染期只做 O(1) 查表，
 * 不在渲染路径上跑路径匹配 —— 那是 O(实体数 × 引用数) 的账，画布扛不住。
 */
import { create } from "zustand";
import { aiContextApi, type AiInsightDto } from "../services/tauri";
import {
  EMPTY_MARK_INDEX,
  buildInsightMarks,
  type InsightMark,
  type InsightSeverity,
} from "../ai/insightOverlay";
import { logger } from "../utils/logger";

interface InsightOverlayState {
  /** 当前已加载的分析 id（scope） */
  scopeId: string;
  /** 原始洞察列表（面板直接消费，避免二次查库） */
  insights: AiInsightDto[];
  /** 文件相对路径 → 标记 */
  fileMarks: Record<string, InsightMark>;
  /** 目录相对路径 → 标记（子树聚合） */
  dirMarks: Record<string, InsightMark>;
  /** 未能对齐到实体的引用原文 */
  unresolved: string[];
  /** 画布是否显示洞察角标（用户可关，避免与既有风险角标抢注意力） */
  canvasEnabled: boolean;
  /** 上画布的最低严重度（低于它的结论只进列表） */
  minSeverity: InsightSeverity;
  loading: boolean;

  /** 已完成加载的分析 id（用于幂等：多个挂载点共用一份数据，不重复查库） */
  loadedScope: string;

  /**
   * 拉取指定分析的洞察并重建标记；scopeId 为空时清空。
   * @param force 强制回库（Agent 跑完 / 用户点刷新时用）。缺省时同一 scope 只查一次 ——
   *        画布与面板会同时挂同步钩子，不去重就是每次进画布都打两遍库。
   */
  load: (scopeId: string, knownPaths: readonly string[], force?: boolean) => Promise<void>;
  /** 已有洞察不变，仅按新的文件清单重算标记（扫描后文件表变化时用） */
  rebuild: (knownPaths: readonly string[]) => void;
  setCanvasEnabled: (v: boolean) => void;
  setMinSeverity: (v: InsightSeverity) => void;
  clear: () => void;
}

export const useInsightOverlayStore = create<InsightOverlayState>((set, get) => ({
  scopeId: "",
  loadedScope: "",
  insights: [],
  fileMarks: {},
  dirMarks: {},
  unresolved: [],
  canvasEnabled: true,
  minSeverity: "medium",
  loading: false,

  load: async (scopeId, knownPaths, force = false) => {
    if (!scopeId) {
      get().clear();
      return;
    }
    const st = get();
    if (!force && st.loadedScope === scopeId) {
      // 已经有这份数据了，只按当前文件清单对齐一次即可（纯内存计算）
      if (knownPaths.length > 0) get().rebuild(knownPaths);
      return;
    }
    if (st.loading && st.scopeId === scopeId) return;
    set({ loading: true });
    try {
      const rows = await aiContextApi.listAiInsights(scopeId);
      const marks = buildInsightMarks(rows, knownPaths, { minSeverity: get().minSeverity });
      set({
        scopeId,
        loadedScope: scopeId,
        insights: rows,
        fileMarks: marks.files,
        dirMarks: marks.dirs,
        unresolved: marks.unresolved,
        loading: false,
      });
    } catch (e) {
      // 洞察是增强信息：取不到不该打断画布或面板的主流程
      logger.error("insightOverlay", "load insights failed", { error: e, scopeId });
      set({ loading: false });
    }
  },

  rebuild: (knownPaths) => {
    const { insights, minSeverity } = get();
    const marks = buildInsightMarks(insights, knownPaths, { minSeverity });
    set({ fileMarks: marks.files, dirMarks: marks.dirs, unresolved: marks.unresolved });
  },

  setCanvasEnabled: (v) => set({ canvasEnabled: v }),

  setMinSeverity: (v) => {
    set({ minSeverity: v });
    // 阈值变化要立刻反映到画布，但这里拿不到文件清单 —— 用已解析出的 key 兜底重算，
    // 调用方（面板）随后会带真实清单再 rebuild 一次，两次结果一致。
    const { insights, fileMarks } = get();
    const marks = buildInsightMarks(insights, Object.keys(fileMarks), { minSeverity: v });
    set({ fileMarks: marks.files, dirMarks: marks.dirs, unresolved: marks.unresolved });
  },

  clear: () =>
    set({
      scopeId: "",
      loadedScope: "",
      insights: [],
      fileMarks: EMPTY_MARK_INDEX.files,
      dirMarks: EMPTY_MARK_INDEX.dirs,
      unresolved: [],
      loading: false,
    }),
}));

/**
 * 渲染器专用选择器：关掉画布标注时直接返回 undefined，
 * 让几百个渲染器在「开关关闭」这个常见状态下彻底不参与重渲染。
 */
export function selectFileMark(path: string | undefined) {
  return (s: InsightOverlayState): InsightMark | undefined =>
    !path || !s.canvasEnabled ? undefined : s.fileMarks[path];
}

export function selectDirMark(path: string | undefined) {
  return (s: InsightOverlayState): InsightMark | undefined =>
    !path || !s.canvasEnabled ? undefined : s.dirMarks[path];
}
