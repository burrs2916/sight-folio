/**
 * 模块下钻的动作层（连接纯布局 moduleDrill.ts 与 store / 持久化）
 *
 * 与 portraits.ts 的分工一致：布局算法留在纯函数里可单测，这里只负责
 * 「读 store → 调布局 → 批量落库 → 聚焦 → 持久化」。
 */

import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { useSceneStore } from "../../store/sceneStore";
import { currentInsights, fileConfig } from "./portraits";
import { emptyFileInsight } from "./fileInsights";
import { buildModuleDrillLayout, drillOrigin } from "./moduleDrill";
import { topDirOf } from "./architectureMetrics";
import { t } from "../../i18n";
import type { SceneComponent } from "../../types/editor";

export interface DrillOutcome {
  ok: boolean;
  message: string;
  severity: "success" | "info" | "warning";
  expanded: boolean;
}

/** 读实体 config 里的模块名（同步布局写的是 moduleName，画像路径可能只有 name） */
export function moduleNameOf(comp: SceneComponent): string | null {
  const cfg = (comp.config ?? {}) as Record<string, unknown>;
  if (typeof cfg.moduleName === "string" && cfg.moduleName) return cfg.moduleName;
  if (typeof cfg.name === "string" && cfg.name) return cfg.name;
  return comp.name || null;
}

/** 该实体是否是「可下钻的模块实体」（符号实体也用 module 类型渲染，要排除） */
export function isDrillableModule(comp: SceneComponent | null | undefined): boolean {
  if (!comp || comp.type !== "module") return false;
  const cfg = (comp.config ?? {}) as Record<string, unknown>;
  if (typeof cfg.symbolKind === "string" && cfg.symbolKind) return false;
  return true;
}

/** 当前是否已展开（config.drillExpanded 为真且画布上确实还有子实体） */
export function isModuleExpanded(comp: SceneComponent, components: readonly SceneComponent[]): boolean {
  const cfg = (comp.config ?? {}) as Record<string, unknown>;
  if (!cfg.drillExpanded) return false;
  return components.some((c) => (c.config as any)?.drillOwnerId === comp.id);
}

async function persist(analysisId: string | null | undefined, tag: string) {
  if (!analysisId) return;
  try {
    const { views, globalComponents, activeViewId } = useEditorStore.getState().exportSceneWithViews();
    await useSceneStore.getState().updateScene(analysisId, {
      views,
      globalComponents,
      activeViewId,
    } as any);
  } catch (e) {
    console.error(`[drill] persist ${tag} failed`, e);
  }
}

/** 折叠：清除该模块实体产生的全部子实体 */
export async function collapseModuleDrill(
  comp: SceneComponent,
  analysisId?: string | null
): Promise<DrillOutcome> {
  const est = useEditorStore.getState();
  const ids = est.components.filter((c) => (c.config as any)?.drillOwnerId === comp.id).map((c) => c.id);
  const removed = ids.length > 0 ? est.removeComponentsBulk(ids) : 0;
  est.updateComponentConfig(comp.id, { drillExpanded: false, drillChildCount: 0 });
  await persist(analysisId, "collapse");
  return {
    ok: true,
    expanded: false,
    severity: "info",
    message: removed > 0 ? t("editor.drillCollapsed", { n: removed }) : t("editor.drillNoSub"),
  };
}

/** 展开：在画布右侧生成该模块内部的文件子图 + 模块内依赖连线 */
export async function expandModuleDrill(
  comp: SceneComponent,
  analysisId?: string | null
): Promise<DrillOutcome> {
  const name = moduleNameOf(comp);
  if (!name) {
    return { ok: false, expanded: false, severity: "warning", message: t("editor.drillUnknown") };
  }

  const pst = useProjectStore.getState();
  const est = useEditorStore.getState();

  const files = pst.files.filter((f) => !f.isDirectory && topDirOf(f.relPath) === name);
  if (files.length === 0) {
    return {
      ok: false,
      expanded: false,
      severity: "warning",
      message: t("editor.drillNoFiles", { name }),
    };
  }

  // 已展开则先清掉旧子图，保证幂等（数据刷新后重新展开能拿到最新画像）
  const stale = est.components.filter((c) => (c.config as any)?.drillOwnerId === comp.id).map((c) => c.id);
  if (stale.length > 0) est.removeComponentsBulk(stale);

  const insights = currentInsights();
  const layout = buildModuleDrillLayout(
    name,
    comp.id,
    drillOrigin(useEditorStore.getState().components),
    files,
    pst.dependencies,
    (f) => fileConfig(f, insights.get(f.id) ?? emptyFileInsight(), "drill" as any),
    pst.symbolRefs
  );

  const bulk = [
    {
      type: "annotation-text",
      x: layout.frame.x,
      y: layout.frame.y,
      width: layout.frame.width,
      height: layout.frame.height,
      name: layout.frame.name,
      config: layout.frame.config,
    },
    ...layout.nodes.map((n) => ({
      type: "file",
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      name: n.name,
      config: n.config,
    })),
    ...layout.edges.map((e) => ({
      type: "dependency-edge",
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      name: e.name,
      config: e.config,
    })),
  ];

  const ids = est.addComponentsBulk(bulk);
  if (ids.length === 0) {
    return { ok: false, expanded: false, severity: "warning", message: t("editor.drillPersistFail") };
  }

  est.updateComponentConfig(comp.id, { drillExpanded: true, drillChildCount: ids.length });
  // 聚焦到子图标题框，让用户立刻看到展开结果
  est.focusComponent(ids[0]);
  await persist(analysisId, "expand");

  const s = layout.summary;
  return {
    ok: true,
    expanded: true,
    severity: "success",
    message: t("editor.drillExpanded", {
      name,
      files: s.files,
      edges: s.edges,
      trunc: s.internalEdgeTotal > s.edges ? t("editor.drillTrunc", { total: s.internalEdgeTotal, shown: s.edges }) : "",
      ext: s.externalEdges,
    }),
  };
}

/** 切换展开/折叠（画布角标按钮 / 右键菜单统一入口） */
export async function toggleModuleDrill(
  comp: SceneComponent,
  analysisId?: string | null
): Promise<DrillOutcome> {
  const components = useEditorStore.getState().components;
  return isModuleExpanded(comp, components)
    ? collapseModuleDrill(comp, analysisId)
    : expandModuleDrill(comp, analysisId);
}
