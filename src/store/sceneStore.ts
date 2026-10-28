import { create } from "zustand";
import type { AnalysisDSL, AnalysisCategory } from "../types/scene";
import { createDefaultAnalysis, createAnalysisFromTemplate, ANALYSIS_TEMPLATES } from "../types/scene";
import { analysisApi, aiContextApi } from "../services/tauri";
import { logger } from "../utils/logger";
import { t } from "../i18n";
import { generateReportHtml, generateReportJson, generateReportSvg, type ReportData, type ReportFormat } from "../utils/reportGenerator";
import { useProjectStore } from "./projectStore";
import { aiContextRegistry } from "../ai/contextRegistry";
import type { AiContextQualityReport } from "../ai/contextTypes";
import type { ReportInsightInput } from "../ai/insightReport";

/** 报告里 AI 章节的数据源模块。当前唯一供给者；未来多模块时按注册表逐个取即可 */
const REPORT_CONTEXT_MODULE = "project-scan";

/**
 * 为报告收集 AI 结论与数据可信度。
 *
 * 两处都做了「失败即降级」：导出报告是用户的主目标，AI 章节是增益。
 * 任何一处抛错都只让报告少一块内容，绝不能把整个导出弄失败 ——
 * 那等于用一个可选功能劫持了一个必需功能。
 */
export async function collectAiReportInputs(analysisId: string): Promise<{
  aiInsights?: ReportInsightInput[];
  contextQuality?: AiContextQualityReport | null;
}> {
  let aiInsights: ReportInsightInput[] | undefined;
  try {
    const rows = await aiContextApi.listAiInsights(analysisId);
    if (rows.length > 0) aiInsights = rows;
  } catch (err) {
    logger.warn("SceneStore", "读取 AI 洞察失败，报告将不含 AI 结论章节", {
      analysisId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let contextQuality: AiContextQualityReport | null = null;
  try {
    // describeQuality 读的是内存快照，只有当前装载的正是该分析时才有结论；
    // 装载的是别的分析时它返回 null，报告就不带这段声明 —— 不猜比猜错好。
    contextQuality =
      aiContextRegistry.get(REPORT_CONTEXT_MODULE)?.describeQuality?.(analysisId) ?? null;
  } catch (err) {
    logger.warn("SceneStore", "生成数据可信度体检失败，报告将不含该声明", {
      analysisId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { aiInsights, contextQuality };
}

const DEFAULT_CATEGORY_ID = "cat_default";

const DEFAULT_CATEGORY: AnalysisCategory = {
  id: DEFAULT_CATEGORY_ID,
  name: "默认分组",
  icon: "folder",
  color: "#757575",
  sortOrder: -1,
  description: "未指定分类的分析",
  createdAt: Math.floor(Date.now() / 1000),
  updatedAt: Math.floor(Date.now() / 1000),
};

interface SceneState {
  scenes: AnalysisDSL[];
  categories: AnalysisCategory[];
  activeSceneId: string | null;
  isLoading: boolean;
  error: string | null;

  loadScenes: () => Promise<void>;
  loadCategories: () => Promise<void>;
  setActiveScene: (id: string) => void;
  getActiveScene: () => AnalysisDSL | null;

  createScene: (partial?: Partial<AnalysisDSL>, templateId?: string) => Promise<AnalysisDSL>;
  updateScene: (id: string, updates: Partial<AnalysisDSL>) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  duplicateScene: (id: string) => Promise<AnalysisDSL | null>;

  createCategory: (partial?: Partial<AnalysisCategory>) => Promise<AnalysisCategory>;
  updateCategory: (id: string, updates: Partial<AnalysisCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  saveScene: (scene: AnalysisDSL) => Promise<void>;
  /** 导出分析报告（format: html | json，默认 html） */
  publishScene: (id: string, format?: ReportFormat) => Promise<void>;
  unpublishScene: (id: string) => Promise<void>;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scenes: [],
  categories: [],
  activeSceneId: null,
  isLoading: false,
  error: null,

  loadScenes: async () => {
    set({ isLoading: true, error: null });
    try {
      const scenes = await analysisApi.list();
      logger.info("SceneStore", "Scenes loaded", { count: scenes.length });
      set({ scenes, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("SceneStore", "Failed to load scenes", { error: msg });
      set({ error: msg, isLoading: false });
    }
  },

  loadCategories: async () => {
    try {
      let categories = await analysisApi.listCategories();

      const hasDefault = categories.some((c) => c.id === DEFAULT_CATEGORY_ID);
      if (!hasDefault) {
        try {
          await analysisApi.saveCategory(DEFAULT_CATEGORY);
          categories = [DEFAULT_CATEGORY, ...categories];
        } catch {
          categories = [DEFAULT_CATEGORY, ...categories];
        }
      }

      set({ categories });
    } catch (err) {
      set({ categories: [DEFAULT_CATEGORY], error: err instanceof Error ? err.message : String(err) });
    }
  },

  setActiveScene: (id: string) => {
    set({ activeSceneId: id });
  },

  getActiveScene: () => {
    const { scenes, activeSceneId } = get();
    if (!activeSceneId) return null;
    return scenes.find((s) => s.id === activeSceneId) ?? null;
  },

  createScene: async (partial?: Partial<AnalysisDSL>, templateId?: string) => {
    let scene: AnalysisDSL;
    if (templateId) {
      const template = ANALYSIS_TEMPLATES.find((t) => t.id === templateId);
      if (template) {
        scene = createAnalysisFromTemplate(template, partial);
      } else {
        scene = createDefaultAnalysis(partial);
      }
    } else {
      scene = createDefaultAnalysis(partial);
    }

    if (!scene.categoryId) {
      scene.categoryId = DEFAULT_CATEGORY_ID;
    }

    try {
      await analysisApi.create(scene);
      logger.info("SceneStore", "Scene created via API", { sceneId: scene.id, name: scene.name });
      set((state) => ({
        scenes: [scene, ...state.scenes],
        activeSceneId: scene.id,
      }));
      return scene;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  updateScene: async (id: string, updates: Partial<AnalysisDSL>) => {
    const { scenes } = get();
    const index = scenes.findIndex((s) => s.id === id);
    if (index === -1) return;

    const originalScene = scenes[index];
    const updatedScene = {
      ...originalScene,
      ...updates,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? updatedScene : s)),
    }));

    try {
      await analysisApi.update(updatedScene);
      logger.info("SceneStore", "Scene updated via API", { sceneId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("SceneStore", "Failed to update scene via API", { sceneId: id, error: msg });
      set((state) => ({
        scenes: state.scenes.map((s) => (s.id === id ? originalScene : s)),
        error: msg,
      }));
      // 不回滚画布：编辑器是打开中场景的权威。此前失败会 loadSceneWithViews
      // 把画布重置到上一个持久化版本 —— 新分析场景下等于清空刚同步的
      // 全部实体（「实体渲染不出来」的终结一击）。现在画布保持当前内容与
      // 脏标，由 SceneEditor 自动/手动保存重试落库。
      throw err;
    }
  },

  deleteScene: async (id: string) => {
    const { scenes, activeSceneId } = get();
    const sceneToDelete = scenes.find((s) => s.id === id);
    if (!sceneToDelete) return;

    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
      activeSceneId: activeSceneId === id ? null : state.activeSceneId,
    }));

    try {
      await analysisApi.delete(id);
    } catch (err) {
      set((state) => ({
        scenes: [sceneToDelete, ...state.scenes].sort((a, b) => b.updatedAt - a.updatedAt),
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  duplicateScene: async (id: string) => {
    const { scenes } = get();
    const source = scenes.find((s) => s.id === id);
    if (!source) return null;

    const now = Date.now();
    const duplicated: AnalysisDSL = {
      ...source,
      id: `scene_${now}_${Math.random().toString(36).substring(2, 8)}`,
      name: `${source.name} ${t('scene.copySuffix')}`,
      status: "draft",
      createdAt: Math.floor(now / 1000),
      updatedAt: Math.floor(now / 1000),
      views: source.views ? JSON.parse(JSON.stringify(source.views)) : undefined,
      globalComponents: source.globalComponents ? JSON.parse(JSON.stringify(source.globalComponents)) : undefined,
      editorComponents: source.editorComponents ? JSON.parse(JSON.stringify(source.editorComponents)) : undefined,
      editorLayers: source.editorLayers ? JSON.parse(JSON.stringify(source.editorLayers)) : undefined,
      canvasConfig: source.canvasConfig ? JSON.parse(JSON.stringify(source.canvasConfig)) : undefined,
    };

    try {
      await analysisApi.create(duplicated);
      set((state) => ({
        scenes: [duplicated, ...state.scenes],
      }));
      return duplicated;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  createCategory: async (partial?: Partial<AnalysisCategory>) => {
    const now = Math.floor(Date.now() / 1000);
    const category: AnalysisCategory = {
      id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: t("scene.newGroup"),
      icon: "folder",
      sortOrder: get().categories.length,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };

    try {
      await analysisApi.saveCategory(category);
      set((state) => ({
        categories: [...state.categories, category],
      }));
      return category;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  updateCategory: async (id: string, updates: Partial<AnalysisCategory>) => {
    const { categories } = get();
    const index = categories.findIndex((c) => c.id === id);
    if (index === -1) return;

    const updatedCategory = {
      ...categories[index],
      ...updates,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    set((state) => ({
      categories: state.categories.map((c) => (c.id === id ? updatedCategory : c)),
    }));

    try {
      await analysisApi.saveCategory(updatedCategory);
    } catch (err) {
      set((state) => ({
        categories: state.categories.map((c) => (c.id === id ? categories[index] : c)),
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  deleteCategory: async (id: string) => {
    if (id === DEFAULT_CATEGORY_ID) return;

    const { categories, scenes } = get();
    const categoryToDelete = categories.find((c) => c.id === id);
    if (!categoryToDelete) return;

    const affectedScenes = scenes.filter((s) => s.categoryId === id);
    const updatedScenes = affectedScenes.map((s) => ({
      ...s,
      categoryId: DEFAULT_CATEGORY_ID,
    }));

    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      scenes: state.scenes.map((s) => {
        const updated = updatedScenes.find((u) => u.id === s.id);
        return updated || s;
      }),
    }));

    try {
      await analysisApi.deleteCategory(id);
      for (const scene of updatedScenes) {
        await analysisApi.update(scene);
      }
    } catch (err) {
      set((state) => ({
        categories: [categoryToDelete, ...state.categories].sort((a, b) => a.sortOrder - b.sortOrder),
        scenes: state.scenes.map((s) => {
          const original = scenes.find((o) => o.id === s.id);
          return original || s;
        }),
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  saveScene: async (scene: AnalysisDSL) => {
    try {
      const synced: AnalysisDSL = {
        ...scene,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await analysisApi.update(synced);
      set((state) => ({
        scenes: state.scenes.map((s) => (s.id === synced.id ? synced : s)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  publishScene: async (id: string, format: ReportFormat = "html") => {
    const { scenes } = get();
    const scene = scenes.find((s) => s.id === id);
    if (!scene) return;

    const updatedScene: AnalysisDSL = {
      ...scene,
      status: "published",
      publishedAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
    };

    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? updatedScene : s)),
    }));

    try {
      // 生成分析报告并触发下载（HTML / JSON / SVG，需求 §7.3 报告导出器）
      const projectStore = useProjectStore.getState();
      // 让导出的文档同时承载「机器测量的事实」与「AI 判断的结论」：
      // 只有事实，报告停在数据阶段；只有结论，读者无从验证。
      const aiInputs = await collectAiReportInputs(updatedScene.id);
      const reportData: ReportData = {
        ...aiInputs,
        analysis: updatedScene,
        files: projectStore.files,
        modules: projectStore.modules,
        dependencies: projectStore.dependencies,
        layers: projectStore.layers,
        findings: projectStore.findings,
        symbols: projectStore.symbols,
        patternHits: projectStore.patternHits,
        symbolRefs: projectStore.symbolRefs,
        metrics: projectStore.metrics,
        techDebt: projectStore.techDebt,
        deadSymbols: projectStore.deadSymbols,
        callEdges: projectStore.callEdges,
        gitChurn: projectStore.gitChurn,
        clones: projectStore.clones,
      };
      const fileNameBase = updatedScene.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_");
      if (format === "json") {
        const json = generateReportJson(reportData);
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileNameBase}${t("preview.exportJson")}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else if (format === "svg") {
        // SVG 报告：一屏可读的架构画像（需求 §7.3 三格式中的 SVG）
        const svg = generateReportSvg(reportData);
        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileNameBase}${t("preview.exportSvg")}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        const html = generateReportHtml(reportData);
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileNameBase}${t("preview.exportHtml")}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }

      await analysisApi.update(updatedScene);
      logger.info("SceneStore", "Analysis exported with report", { sceneId: id, format });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("SceneStore", "Failed to export analysis", { sceneId: id, error: msg });
      set((state) => ({
        scenes: state.scenes.map((s) => (s.id === id ? scene : s)),
        error: msg,
      }));
    }
  },

  unpublishScene: async (id: string) => {
    const { scenes } = get();
    const scene = scenes.find((s) => s.id === id);
    if (!scene) return;

    const updatedScene: AnalysisDSL = {
      ...scene,
      status: "draft",
      updatedAt: Math.floor(Date.now() / 1000),
    };

    set((state) => ({
      scenes: state.scenes.map((s) => (s.id === id ? updatedScene : s)),
    }));

    try {
      await analysisApi.update(updatedScene);
      logger.info("SceneStore", "Analysis export revoked", { sceneId: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("SceneStore", "Failed to revoke analysis export", { sceneId: id, error: msg });
      set((state) => ({
        scenes: state.scenes.map((s) => (s.id === id ? scene : s)),
        error: msg,
      }));
    }
  },
}));


// 开发模式暴露到 window
if (typeof window !== "undefined") {
  (window as any).__sceneStore = useSceneStore;
}
