import { create } from "zustand";
import { aiContextApi } from "../services/tauri";
import { contextPackId } from "../ai/contextPersist";

/**
 * 需求基线存储（前端镜像）。
 *
 * 客户在「需求分析」面板模式里产出的结构化需求规格（requirements-spec），
 * 既要在内存里供 `requirementsSpecProvider.buildPack` 同步读取（AiContextProvider
 * 协议要求 buildPack 是同步的），也要落库以保证重载后仍在——落库走的是项目既有的
 * `ai_context_sections` 通道（`save_ai_context_pack` / `get_ai_context_section`），
 * 与扫描上下文同一套后端，不新增任何表或命令。
 *
 * 数据流：
 *   - 保存：`setBaseline(analysisId, content)` 写内存 → 调用方再 `persistModuleContext`
 *     把整包落库（复用扫描收尾的同一套增量写库）。
 *   - 读取：`buildPack` 同步读 `getBaseline`；`loadBaseline` 在面板进入需求模式 /
 *     切换分析时从库水合，保证自动编排扫描也能把基线带进包。
 */
export const REQUIREMENTS_SPEC_SECTION_KEY = "requirements-spec";
export const REQUIREMENTS_SPEC_MODULE_ID = "requirements-spec";

export interface RequirementsBaseline {
  /** 客户陈述的需求规格正文（Markdown） */
  content: string;
  /** 最后更新时间（ms） */
  updatedAt: number;
}

interface RequirementsState {
  baselines: Record<string, RequirementsBaseline>;
  setBaseline: (analysisId: string, content: string) => void;
  getBaseline: (analysisId: string) => RequirementsBaseline | undefined;
  hasBaseline: (analysisId: string) => boolean;
  removeBaseline: (analysisId: string) => void;
  /** 从库水合某个作用域的基线（库里没有则清掉内存态）。失败静默降级。 */
  loadBaseline: (analysisId: string) => Promise<void>;
}

export const useRequirementsStore = create<RequirementsState>((set, get) => ({
  baselines: {},

  setBaseline: (analysisId, content) =>
    set((state) => ({
      baselines: { ...state.baselines, [analysisId]: { content, updatedAt: Date.now() } },
    })),

  getBaseline: (analysisId) => get().baselines[analysisId],

  hasBaseline: (analysisId) => {
    const b = get().baselines[analysisId];
    return !!b && b.content.trim().length > 0;
  },

  removeBaseline: (analysisId) =>
    set((state) => {
      const next = { ...state.baselines };
      delete next[analysisId];
      return { baselines: next };
    }),

  loadBaseline: async (analysisId) => {
    if (!analysisId) return;
    try {
      const packId = contextPackId(REQUIREMENTS_SPEC_MODULE_ID, analysisId);
      const section = await aiContextApi.getAiContextSection(packId, REQUIREMENTS_SPEC_SECTION_KEY);
      set((state) => {
        const next = { ...state.baselines };
        if (section && section.content && section.content.trim().length > 0) {
          next[analysisId] = { content: section.content, updatedAt: section.updatedAt ?? Date.now() };
        } else {
          delete next[analysisId];
        }
        return { baselines: next };
      });
    } catch (err) {
      // 水合失败非致命：最坏只是本次把基线当「无」，下一次保存会重建。
      // 不抛，避免打断面板渲染或扫描流程。
      console.warn("[requirementsStore] 水合需求基线失败", { analysisId, error: err });
    }
  },
}));
