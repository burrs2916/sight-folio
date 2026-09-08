/**
 * useInsightOverlaySync —— 让「AI 洞察」这份数据在任何入口都保持新鲜的同步钩子。
 *
 * ─── 为什么不能把加载逻辑留在洞察面板里 ────────────────────────────────
 * 洞察面板（AiInsightsPanel）挂在编辑器右侧栏的第 6 个 tab 下，只有用户切到
 * 那个 tab 才会挂载。但画布上的 AI 角标是**默认就该看得见**的 —— 如果加载逻辑
 * 长在面板里，用户不点开那个 tab，画布就永远是空的，而他根本不会知道自己
 * 少看了什么。所以同步逻辑必须独立于任何一个展示组件。
 *
 * 现在画布（SceneEditor）和面板各挂一次本钩子，store 内部按 scope 幂等去重，
 * 挂两次也只查一次库。
 *
 * ─── 三个刷新时机 ──────────────────────────────────────────────────────
 *   1. 切换分析      → 回库取新 scope 的洞察
 *   2. 文件清单变化  → 不查库，只按新的 relPath 清单重新对齐角标
 *                     （刚扫完时 files 才有值，这一步决定角标能不能点亮）
 *   3. Agent 跑完    → 强制回库：isStreaming 由 true 转 false 正是洞察落库的时刻
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "../store/projectStore";
import { useAgentStore } from "../store/agentStore";
import { useInsightOverlayStore } from "../store/insightOverlayStore";

export interface InsightOverlaySync {
  /** 当前同步的分析 id */
  scopeId: string;
  /** 已扫描文件的相对路径清单（洞察引用对齐的基准） */
  knownPaths: string[];
  /** 强制回库刷新（刷新按钮用） */
  reload: () => Promise<void>;
}

export function useInsightOverlaySync(analysisId?: string): InsightOverlaySync {
  const activeAnalysisId = useProjectStore((s) => s.activeAnalysisId);
  const projectFiles = useProjectStore((s) => s.files);
  const isStreaming = useAgentStore((s) => s.isStreaming);

  const scopeId = analysisId ?? activeAnalysisId ?? "";
  const knownPaths = useMemo(() => projectFiles.map((f) => f.relPath), [projectFiles]);
  const prevStreaming = useRef(isStreaming);

  // ① 切换分析：回库。这里刻意用 getState() 读文件清单而不是把 knownPaths 放进
  //    依赖 —— 扫描过程中 files 会被整体替换几十次，进依赖就是几十次重复查询。
  useEffect(() => {
    const paths = useProjectStore.getState().files.map((f) => f.relPath);
    void useInsightOverlayStore.getState().load(scopeId, paths);
  }, [scopeId]);

  // ② 文件清单变化：洞察本身没变，纯内存重新对齐即可
  useEffect(() => {
    if (knownPaths.length === 0) return;
    useInsightOverlayStore.getState().rebuild(knownPaths);
  }, [knownPaths]);

  // ③ Agent 一次运行结束：强制回库，把刚沉淀的结论立刻投到画布与列表
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && scopeId) {
      void useInsightOverlayStore.getState().load(scopeId, knownPaths, true);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, scopeId, knownPaths]);

  const reload = useCallback(
    () => useInsightOverlayStore.getState().load(scopeId, knownPaths, true),
    [scopeId, knownPaths],
  );

  return { scopeId, knownPaths, reload };
}
